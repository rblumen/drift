import { describe, it, expect } from 'vitest';
import type { Account, Position, Strategy, AssetClass, PlacementTarget } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';
import { parseStrategy } from '../ingest/schema';

// Issue #89 Phase 1: placement preferences can target tax-deferred (Traditional/401k)
// vs tax-free (Roth/HSA), not just the broad tax-advantaged bucket. These tests pin the
// engine behavior the subdivision depends on, including the nested-spillover semantics.

// ─── helpers ───────────────────────────────────────────────────────────────────────

function targets(partial: Partial<Record<AssetClass, number>>): Record<AssetClass, number> {
  const base = Object.fromEntries(
    (Object.keys(DEFAULT_STRATEGY.targets) as AssetClass[]).map(ac => [ac, 0]),
  ) as Record<AssetClass, number>;
  return { ...base, ...partial };
}

// Build a strategy with explicit placement overrides; zero tolerance + zero minTrade so
// every targeted class participates and we read raw placement output.
function strat(
  tg: Partial<Record<AssetClass, number>>,
  placement: Partial<Record<AssetClass, PlacementTarget[]>>,
): Strategy {
  return {
    ...DEFAULT_STRATEGY,
    targets: targets(tg),
    placement: { ...DEFAULT_STRATEGY.placement, ...placement } as Strategy['placement'],
    toleranceAbs: 0,
    minTradeUsd: 0,
  };
}

const tradeFor = (
  trades: ReturnType<typeof rebalance>['trades'],
  accountId: string,
  ac: AssetClass,
) => trades.find(t => t.accountId === accountId && t.assetClass === ac);

const spillovers = (flags: ReturnType<typeof rebalance>['flags']) =>
  flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER');

// Roth (small) · Traditional (large) → $100k household so target weights map directly to
// dollars. Greenfield: value is all newCash.
const ACCOUNTS: Account[] = [
  { id: 'roth', name: 'Roth IRA',     institution: 'Fid', type: 'ROTH_IRA',        newCash: 20_000 },
  { id: 'trad', name: 'Trad IRA',     institution: 'Fid', type: 'TRADITIONAL_IRA', newCash: 80_000 },
];
const NO_POSITIONS: Position[] = [];

// ─── subdivision: tax-deferred vs tax-free ───────────────────────────────────────────

describe('Goal 6: placement distinguishes tax-deferred from tax-free', () => {
  it('a TAX_FREE-preferred class lands only in the Roth, never the Traditional', () => {
    // 20% equity → TAX_FREE (Roth, $20k); 80% bonds → TAX_DEFERRED (Trad, $80k).
    const r = rebalance(
      ACCOUNTS,
      NO_POSITIONS,
      strat(
        { US_LARGE_CAP: 0.2, US_CORP_BOND: 0.8 },
        { US_LARGE_CAP: ['TAX_FREE'], US_CORP_BOND: ['TAX_DEFERRED'] },
      ),
    );
    expect(tradeFor(r.trades, 'roth', 'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(20_000, 0);
    // The engine may emit a zero-delta placeholder; assert no actionable buy in the Trad.
    expect(Math.abs(tradeFor(r.trades, 'trad', 'US_LARGE_CAP')?.deltaUsd ?? 0)).toBeLessThan(1);
    expect(spillovers(r.flags)).toHaveLength(0);
  });

  it('a TAX_DEFERRED-preferred class lands only in the Traditional, never the Roth', () => {
    const r = rebalance(
      ACCOUNTS,
      NO_POSITIONS,
      strat(
        { US_LARGE_CAP: 0.2, US_CORP_BOND: 0.8 },
        { US_LARGE_CAP: ['TAX_FREE'], US_CORP_BOND: ['TAX_DEFERRED'] },
      ),
    );
    expect(tradeFor(r.trades, 'trad', 'US_CORP_BOND')?.deltaUsd).toBeCloseTo(80_000, 0);
    expect(Math.abs(tradeFor(r.trades, 'roth', 'US_CORP_BOND')?.deltaUsd ?? 0)).toBeLessThan(1);
  });
});

// ─── nested spillover semantics ──────────────────────────────────────────────────────

describe('Goal 6: spillover fires only when the stated preference overflows', () => {
  it('a class preferring the broad TAX_ADVANTAGED bucket does NOT flag when it lands in the Roth', () => {
    // Roth and Trad both satisfy TAX_ADVANTAGED — the preference is met, never spilled.
    const r = rebalance(
      ACCOUNTS,
      NO_POSITIONS,
      strat({ US_LARGE_CAP: 1.0 }, { US_LARGE_CAP: ['TAX_ADVANTAGED'] }),
    );
    expect(spillovers(r.flags)).toHaveLength(0);
  });

  it('a class preferring TAX_FREE flags a spillover when the Roth is too small', () => {
    // 50% equity → TAX_FREE; Roth holds only $20k of the needed $50k, so $30k spills.
    const r = rebalance(
      ACCOUNTS,
      NO_POSITIONS,
      strat({ US_LARGE_CAP: 0.5, US_CORP_BOND: 0.5 }, {
        US_LARGE_CAP: ['TAX_FREE'],
        US_CORP_BOND: ['TAX_DEFERRED'],
      }),
    );
    expect(tradeFor(r.trades, 'roth', 'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(20_000, 0);
    const lcSpill = spillovers(r.flags).filter(
      f => f.kind === 'PLACEMENT_SPILLOVER' && f.assetClass === 'US_LARGE_CAP',
    );
    expect(lcSpill.length).toBeGreaterThan(0);
    const spilled = lcSpill.reduce((s, f) => s + (f.kind === 'PLACEMENT_SPILLOVER' ? f.amountUsd : 0), 0);
    expect(spilled).toBeCloseTo(30_000, 0);
  });

  it('no spillover flag when the preferred bucket simply does not exist in the household', () => {
    // No Roth/HSA in this household, so a TAX_FREE preference has no home. Falling back
    // to the next preference is forced placement, not an overflow — no spillover flag.
    const noRoth: Account[] = [
      { id: 'trad', name: 'Trad IRA', institution: 'F', type: 'TRADITIONAL_IRA', newCash: 100_000 },
    ];
    const r = rebalance(
      noRoth,
      NO_POSITIONS,
      strat({ US_LARGE_CAP: 1.0 }, { US_LARGE_CAP: ['TAX_FREE', 'TAX_DEFERRED'] }),
    );
    expect(tradeFor(r.trades, 'trad', 'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(100_000, 0);
    expect(spillovers(r.flags)).toHaveLength(0);
  });
});

// ─── migration: new defaults never overwrite a saved/imported placement ───────────────

describe('Migration (issue #89): asset-location defaults do not rewrite existing selections', () => {
  it('a saved class placement is preserved verbatim even when its default has changed', () => {
    // A pre-#89 save pinned corporate bonds to the broad TAX_ADVANTAGED bucket. The new
    // default is TAX_DEFERRED, but the user's explicit choice must survive the upgrade.
    const saved = {
      ...DEFAULT_STRATEGY,
      placement: { ...DEFAULT_STRATEGY.placement, US_CORP_BOND: ['TAX_ADVANTAGED'] },
    };
    const parsed = parseStrategy(saved);
    expect(parsed.placement.US_CORP_BOND).toEqual(['TAX_ADVANTAGED']);
  });

  it('a class missing from a saved placement is backfilled with the new default', () => {
    const saved = { ...DEFAULT_STRATEGY, placement: { US_LARGE_CAP: ['TAXABLE'] } } as unknown;
    const parsed = parseStrategy(saved);
    // Backfilled, not dropped.
    expect(parsed.placement.US_CORP_BOND).toBeDefined();
    expect(parsed.placement.US_CORP_BOND.length).toBeGreaterThan(0);
    // The explicitly-saved one is still honored.
    expect(parsed.placement.US_LARGE_CAP).toEqual(['TAXABLE']);
  });
});
