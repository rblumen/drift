import { describe, it, expect } from 'vitest';
import type { Account, Position, Strategy, AssetClass, PlacementTarget } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';
import { parseStrategy } from '../ingest/schema';
import {
  accountTarget,
  isAccountTarget,
  accountIdOf,
  accountSatisfiesPlacement,
  targetTaxTreatment,
} from './placementHierarchy';

// Issue #89 Phase 2: a placement preference can name a *specific account*, not just a
// tax-treatment tier. Modeled as an `account:<id>` leaf target so the union stays
// string-based and Zod-validatable. The engine routes the class to that account, and a
// preference pointing at a since-deleted account degrades gracefully (the class is still
// placed, never dropped).

// ─── helpers ───────────────────────────────────────────────────────────────────────

function targets(partial: Partial<Record<AssetClass, number>>): Record<AssetClass, number> {
  const base = Object.fromEntries(
    (Object.keys(DEFAULT_STRATEGY.targets) as AssetClass[]).map(ac => [ac, 0]),
  ) as Record<AssetClass, number>;
  return { ...base, ...partial };
}

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

const NO_POSITIONS: Position[] = [];

// Two Roth accounts + one Traditional. Distinguishes "a specific account" from "the tier".
const ACCOUNTS: Account[] = [
  { id: 'roth_a', name: 'Roth A', institution: 'Fid', type: 'ROTH_IRA',        newCash: 40_000 },
  { id: 'roth_b', name: 'Roth B', institution: 'Sch', type: 'ROTH_IRA',        newCash: 40_000 },
  { id: 'trad',   name: 'Trad',   institution: 'Fid', type: 'TRADITIONAL_IRA', newCash: 20_000 },
];

// ─── account-target helpers ──────────────────────────────────────────────────────────

describe('Placement hierarchy (Phase 2): account-target helpers', () => {
  it('accountTarget builds an account:<id> leaf and the helpers round-trip it', () => {
    const t = accountTarget('roth_a');
    expect(t).toBe('account:roth_a');
    expect(isAccountTarget(t)).toBe(true);
    expect(accountIdOf(t)).toBe('roth_a');
  });

  it('tier and bucket targets are not account targets', () => {
    expect(isAccountTarget('TAX_FREE')).toBe(false);
    expect(isAccountTarget('TAX_ADVANTAGED')).toBe(false);
    expect(isAccountTarget('ROTH_IRA')).toBe(false);
    expect(accountIdOf('TAX_FREE')).toBeNull();
  });
});

// ─── membership ──────────────────────────────────────────────────────────────────────

describe('Placement hierarchy (Phase 2): accountSatisfiesPlacement', () => {
  const acct = { id: 'roth_a', type: 'ROTH_IRA' as const };

  it('an account satisfies its own account: target, but not another account’s', () => {
    expect(accountSatisfiesPlacement(acct, accountTarget('roth_a'))).toBe(true);
    expect(accountSatisfiesPlacement(acct, accountTarget('roth_b'))).toBe(false);
  });

  it('account: targets still defer to tier/bucket membership for non-account targets', () => {
    expect(accountSatisfiesPlacement(acct, 'TAX_FREE')).toBe(true);
    expect(accountSatisfiesPlacement(acct, 'TAX_DEFERRED')).toBe(false);
    expect(accountSatisfiesPlacement(acct, 'TAX_ADVANTAGED')).toBe(true);
  });
});

// ─── tax treatment resolution ────────────────────────────────────────────────────────

describe('Placement hierarchy (Phase 2): targetTaxTreatment resolves an account target via its account', () => {
  it('an account: target inherits the tax treatment of the named account', () => {
    expect(targetTaxTreatment(accountTarget('roth_a'), ACCOUNTS)).toBe('TAX_ADVANTAGED');
    expect(targetTaxTreatment(accountTarget('trad'), ACCOUNTS)).toBe('TAX_ADVANTAGED');
  });

  it('a taxable account: target resolves to TAXABLE', () => {
    const accts = [{ id: 'tax', type: 'TAXABLE' as const }];
    expect(targetTaxTreatment(accountTarget('tax'), accts)).toBe('TAXABLE');
  });
});

// ─── engine routing ──────────────────────────────────────────────────────────────────

describe('Goal 6 (Phase 2): a class targeting a specific account lands only there', () => {
  it('US_LARGE_CAP pinned to Roth B fills Roth B, not Roth A, despite both being tax-free', () => {
    // Both Roth accounts satisfy TAX_FREE, but the rule names Roth B specifically.
    const r = rebalance(
      ACCOUNTS,
      NO_POSITIONS,
      strat({ US_LARGE_CAP: 0.4, US_CORP_BOND: 0.6 }, {
        US_LARGE_CAP: [accountTarget('roth_b')],
        US_CORP_BOND: ['TAX_DEFERRED'],
      }),
    );
    expect(tradeFor(r.trades, 'roth_b', 'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(40_000, 0);
    expect(Math.abs(tradeFor(r.trades, 'roth_a', 'US_LARGE_CAP')?.deltaUsd ?? 0)).toBeLessThan(1);
  });
});

// ─── graceful degradation ────────────────────────────────────────────────────────────

describe('Goal 6 (Phase 2): a rule pointing at a deleted account degrades gracefully', () => {
  it('the class is still placed via the fallback tier (never dropped) when its account: target no longer exists', () => {
    // 'ghost' is not in the household — the rule must fall through to the next preference
    // (TAX_FREE), not strand the class. Roth capacity ($60k) exactly covers the $60k LC
    // target; the $40k bond sleeve fills the Traditional, so the fallback fully absorbs LC
    // and the Traditional is never touched by it.
    const accts: Account[] = [
      { id: 'roth_a', name: 'Roth A', institution: 'Fid', type: 'ROTH_IRA',        newCash: 30_000 },
      { id: 'roth_b', name: 'Roth B', institution: 'Sch', type: 'ROTH_IRA',        newCash: 30_000 },
      { id: 'trad',   name: 'Trad',   institution: 'Fid', type: 'TRADITIONAL_IRA', newCash: 40_000 },
    ];
    const r = rebalance(
      accts,
      NO_POSITIONS,
      strat({ US_LARGE_CAP: 0.6, US_CORP_BOND: 0.4 }, {
        US_LARGE_CAP: [accountTarget('ghost'), 'TAX_FREE'],
        US_CORP_BOND: ['TAX_DEFERRED'],
      }),
    );
    const placed =
      (tradeFor(r.trades, 'roth_a', 'US_LARGE_CAP')?.deltaUsd ?? 0) +
      (tradeFor(r.trades, 'roth_b', 'US_LARGE_CAP')?.deltaUsd ?? 0) +
      (tradeFor(r.trades, 'trad', 'US_LARGE_CAP')?.deltaUsd ?? 0);
    expect(placed).toBeCloseTo(60_000, 0);
    // It honored the fallback tier (TAX_FREE) — the two Roths, not the Traditional.
    expect(Math.abs(tradeFor(r.trades, 'trad', 'US_LARGE_CAP')?.deltaUsd ?? 0)).toBeLessThan(1);
  });
});

// ─── schema round-trip ───────────────────────────────────────────────────────────────

describe('Schema (Phase 2): account: placement targets parse and round-trip', () => {
  it('a saved placement naming a specific account survives parseStrategy unchanged', () => {
    const saved = {
      ...DEFAULT_STRATEGY,
      placement: { ...DEFAULT_STRATEGY.placement, US_LARGE_CAP: ['account:roth_b'] },
    };
    const parsed = parseStrategy(saved);
    expect(parsed.placement.US_LARGE_CAP).toEqual(['account:roth_b']);
  });
});
