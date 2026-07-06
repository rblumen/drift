import { describe, it, expect } from 'vitest';
import type { Account, Position, Strategy, AssetClass, PlacementTarget, Flag } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';

// Issue #199: PLACEMENT_SPILLOVER carries preferredBucket + occupiedBy so the UI
// can say what fills the overflowed home ("$10,000 locked (VOO) and $2,000 cash
// occupy taxable") instead of a bare "preferred bucket full".

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
  toleranceAbs = 0,
): Strategy {
  return {
    ...DEFAULT_STRATEGY,
    targets: targets(tg),
    placement: { ...DEFAULT_STRATEGY.placement, ...placement } as Strategy['placement'],
    toleranceAbs,
    minTradeUsd: 0,
  };
}

type SpilloverFlag = Extract<Flag, { kind: 'PLACEMENT_SPILLOVER' }>;

const spillovers = (flags: Flag[]): SpilloverFlag[] =>
  flags.filter((f): f is SpilloverFlag => f.kind === 'PLACEMENT_SPILLOVER');

// ─── locked position + in-band cash occupy the preferred taxable bucket ─────────────

describe('Issue #199: spillover names what occupies the preferred bucket', () => {
  // $50k household. Taxable $20k: $10k locked VOO + $2k money market (CASH exactly
  // on target → in band) + $8k bonds. FI targets $20k but only $8k of taxable is
  // placeable, so $12k spills into the IRA.
  const ACCOUNTS: Account[] = [
    { id: 'taxable', name: 'Schwab Taxable', institution: 'Schwab', type: 'TAXABLE' },
    { id: 'ira',     name: 'Trad IRA',       institution: 'Fid',    type: 'TRADITIONAL_IRA' },
  ];
  const POSITIONS: Position[] = [
    { accountId: 'taxable', ticker: 'VOO',   marketValue: 10_000, locked: true },
    { accountId: 'taxable', ticker: 'VMFXX', marketValue: 2_000 },
    { accountId: 'taxable', ticker: 'AGG',   marketValue: 8_000 },
    { accountId: 'ira',     ticker: 'SPY',   marketValue: 30_000 },
  ];
  const OVERRIDES: Record<string, AssetClass> = {
    VOO: 'US_LARGE_CAP', VMFXX: 'CASH', AGG: 'FIXED_INCOME', SPY: 'US_LARGE_CAP',
  };
  const STRATEGY = strat(
    { FIXED_INCOME: 0.40, US_LARGE_CAP: 0.56, CASH: 0.04 },
    { FIXED_INCOME: ['TAXABLE'], US_LARGE_CAP: ['TAX_ADVANTAGED', 'TAXABLE'] },
    0.05, // CASH sits exactly on target → within tolerance → frozen occupant
  );

  it('FI spillover into the IRA carries preferredBucket TAXABLE and the blocking occupants', () => {
    const r = rebalance(ACCOUNTS, POSITIONS, STRATEGY, OVERRIDES);
    const fiSpills = spillovers(r.flags).filter(f => f.assetClass === 'FIXED_INCOME');
    expect(fiSpills).toHaveLength(1);

    const flag = fiSpills[0];
    expect(flag.bucket).toBe('TAX_ADVANTAGED');
    expect(flag.amountUsd).toBeCloseTo(12_000, 0);
    expect(flag.preferredBucket).toBe('TAXABLE');

    const locked = flag.occupiedBy?.find(o => o.kind === 'LOCKED_POSITION');
    expect(locked).toMatchObject({ assetClass: 'US_LARGE_CAP', tickers: ['VOO'] });
    expect(locked?.amountUsd).toBeCloseTo(10_000, 0);

    const cash = flag.occupiedBy?.find(o => o.kind === 'HELD_IN_BAND');
    expect(cash).toMatchObject({ assetClass: 'CASH' });
    expect(cash?.amountUsd).toBeCloseTo(2_000, 0);
  });

  it('occupants are sorted largest-first', () => {
    const r = rebalance(ACCOUNTS, POSITIONS, STRATEGY, OVERRIDES);
    const flag = spillovers(r.flags).find(f => f.assetClass === 'FIXED_INCOME');
    const amounts = flag?.occupiedBy?.map(o => o.amountUsd) ?? [];
    expect(amounts).toEqual([...amounts].sort((a, b) => b - a));
  });
});

// ─── a locked account occupies its bucket ────────────────────────────────────────────

describe('Issue #199: locked accounts appear as bucket occupants', () => {
  it('FI spilling past a small open taxable account names the locked taxable account', () => {
    // Two taxable accounts: one fully locked ($10k), one open but small ($5k).
    // FI wants $20k of taxable — the locked account is why the bucket is short.
    const accounts: Account[] = [
      { id: 'tx-locked', name: 'Old Brokerage', institution: 'S', type: 'TAXABLE', locked: true },
      { id: 'tx-open',   name: 'New Brokerage', institution: 'S', type: 'TAXABLE' },
      { id: 'ira',       name: 'IRA',           institution: 'F', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'tx-locked', ticker: 'SPY', marketValue: 10_000 },
      { accountId: 'tx-open',   ticker: 'AGG', marketValue: 5_000 },
      { accountId: 'ira',       ticker: 'SPY', marketValue: 25_000 },
    ];
    const r = rebalance(
      accounts, positions,
      strat({ FIXED_INCOME: 0.5, US_LARGE_CAP: 0.5 }, { FIXED_INCOME: ['TAXABLE'] }),
      { SPY: 'US_LARGE_CAP', AGG: 'FIXED_INCOME' },
    );
    const flag = spillovers(r.flags).find(f => f.assetClass === 'FIXED_INCOME');
    expect(flag?.preferredBucket).toBe('TAXABLE');
    const lockedAcct = flag?.occupiedBy?.find(o => o.kind === 'LOCKED_ACCOUNT');
    expect(lockedAcct).toMatchObject({ accountId: 'tx-locked' });
    expect(lockedAcct?.amountUsd).toBeCloseTo(10_000, 0);
  });
});

// ─── earlier placements occupy the bucket; own-class fill does not ───────────────────

describe('Issue #199: already-placed classes count as occupants, own-class fill does not', () => {
  const GREENFIELD: Account[] = [
    { id: 'roth', name: 'Roth IRA', institution: 'Fid', type: 'ROTH_IRA',        newCash: 20_000 },
    { id: 'trad', name: 'Trad IRA', institution: 'Fid', type: 'TRADITIONAL_IRA', newCash: 80_000 },
  ];

  it('a pass-1 spill names the class that filled the preferred home first', () => {
    // ALTERNATIVES (1 target) claims the whole Roth before LARGE_CAP (2 targets)
    // gets a turn, so LC's TAX_FREE→TAX_DEFERRED spill is explained by ALTS.
    const r = rebalance(GREENFIELD, [], strat(
      { ALTERNATIVES: 0.2, US_LARGE_CAP: 0.3, US_CORP_BOND: 0.5 },
      {
        ALTERNATIVES: ['TAX_FREE'],
        US_LARGE_CAP: ['TAX_FREE', 'TAX_DEFERRED'],
        US_CORP_BOND: ['TAX_DEFERRED'],
      },
    ));
    const flag = spillovers(r.flags).find(f => f.assetClass === 'US_LARGE_CAP');
    expect(flag?.preferredBucket).toBe('TAX_FREE');
    expect(flag?.bucket).toBe('TAX_DEFERRED');
    const placedAlts = flag?.occupiedBy?.find(o => o.kind === 'PLACED_CLASS');
    expect(placedAlts).toMatchObject({ assetClass: 'ALTERNATIVES' });
    expect(placedAlts?.amountUsd).toBeCloseTo(20_000, 0);
  });

  it('no occupancy payload when the preferred home holds only the spilled class itself', () => {
    // LC fills the Roth with its own dollars, then spills. Nothing *else*
    // occupies the bucket, so the flag falls back to the bare form.
    const r = rebalance(GREENFIELD, [], strat(
      { US_LARGE_CAP: 0.5, US_CORP_BOND: 0.5 },
      { US_LARGE_CAP: ['TAX_FREE'], US_CORP_BOND: ['TAX_DEFERRED'] },
    ));
    const flag = spillovers(r.flags).find(f => f.assetClass === 'US_LARGE_CAP');
    expect(flag).toBeDefined();
    expect(flag?.preferredBucket).toBeUndefined();
    expect(flag?.occupiedBy).toBeUndefined();
  });
});
