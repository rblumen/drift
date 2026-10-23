import { describe, it, expect } from 'vitest';
import type { Account, Position, AssetClass, PlacementTarget, Strategy } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';
import { resolveTradeVehicles } from './resolve';
import { makeClassifier } from './classify';
import { zeroByClass } from './utils';

// â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function tradeFor(
  trades: ReturnType<typeof rebalance>['trades'],
  accountId: string,
  assetClass: AssetClass,
) {
  return trades.find(t => t.accountId === accountId && t.assetClass === assetClass);
}

function accountSum(trades: ReturnType<typeof rebalance>['trades'], accountId: string) {
  return trades.filter(t => t.accountId === accountId).reduce((s, t) => s + t.deltaUsd, 0);
}

// Within $1 â€” rounding from proportional splits; anything tighter is noise.
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// Zero-fill spread for target fixtures: `targets: { ...ZERO_TARGETS, X: 0.6 }`
// satisfies the complete Record<AssetClass, number> type while letting each
// fixture state only the classes it cares about. Runtime-identical to the old
// partial literals (the engine normalizes missing targets to 0 anyway).
const ZERO_TARGETS = zeroByClass();

// Placement fill that mirrors the engine's own fallback for a class missing
// from strategy.placement (['TAX_ADVANTAGED', 'TAXABLE']), so a fixture can
// state only the classes it cares about without changing engine behavior.
function fillPlacement(
  overrides: Partial<Record<AssetClass, PlacementTarget[]>>,
): Record<AssetClass, PlacementTarget[]> {
  const base = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, ['TAX_ADVANTAGED', 'TAXABLE'] as PlacementTarget[]]),
  ) as Record<AssetClass, PlacementTarget[]>;
  return { ...base, ...overrides };
}

// â”€â”€â”€ shared fixtures â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Greenfield accounts: value comes entirely from newCash, no existing positions.
const BASE_ACCOUNTS: Account[] = [
  { id: 'schwab', name: 'Schwab Brokerage',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
  { id: 'ira',    name: 'Fidelity Trad IRA',   institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
  { id: 'k401',   name: 'Empower 401k',        institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
];

const NO_POSITIONS: Position[] = [];

// Positions that exactly match the Â§9 target location â€” used for tolerance tests.
const ON_TARGET_POSITIONS: Position[] = [
  { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
  { accountId: 'ira',    ticker: 'GLD',   marketValue:   9_375 },
  { accountId: 'ira',    ticker: 'FPADX', marketValue:  11_250 },
  { accountId: 'ira',    ticker: 'FZILX', marketValue:  63_750 },
  { accountId: 'ira',    ticker: 'FZROX', marketValue: 215_625 },
  { accountId: 'k401',   ticker: 'GLD',   marketValue:  15_625 },
  { accountId: 'k401',   ticker: 'VWO',   marketValue:  18_750 },
  { accountId: 'k401',   ticker: 'VXUS',  marketValue: 106_250 },
  { accountId: 'k401',   ticker: 'FSKAX', marketValue: 359_375 },
];

const ACCOUNTS_NO_CASH: Account[] = BASE_ACCOUNTS.map(a => ({ ...a, newCash: undefined }));

// Zero-tolerance strategy: disables the Â±5% suppression band so all asset classes
// participate in placement. Needed for greenfield tests where small-target classes
// (ALTERNATIVES 2.5%, EMERGING_INTL 3%) would otherwise fall inside the default 5% band.
const ZERO_TOL_STRATEGY = { ...DEFAULT_STRATEGY, toleranceAbs: 0 };

// â”€â”€â”€ Â§9 base case: $200k taxable Â· $300k IRA Â· $500k 401k â†’ $1M â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 4: base case â€” Â§9 worked example (greenfield $1M)', () => {
  // Use ZERO_TOL_STRATEGY: ALTERNATIVES (2.5%) and EMERGING_INTL (3%) sit inside
  // the default 5% band, so they'd be suppressed with the default strategy. These
  // tests validate placement math, not tolerance behavior.

  it('householdValue = $1M', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.householdValue).toBe(1_000_000);
  });

  it('schwab receives all $200k as FIXED_INCOME', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'schwab', 'FIXED_INCOME')?.deltaUsd).toBeCloseTo(200_000, 0);
  });

  it('ALTERNATIVES goes entirely to k401 (largest-capacity TA account, backlog #17)', () => {
    // Concentrate-then-spill: k401 has the most TAX_ADVANTAGED capacity ($500k vs IRA $300k)
    // so it absorbs all $25k of ALTERNATIVES before IRA is touched.
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'ira',  'ALTERNATIVES')).toBeUndefined();
  });

  it('schwab holds nothing except FIXED_INCOME (taxable is exactly full)', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const schwabClasses = r.trades.filter(t => t.accountId === 'schwab').map(t => t.assetClass);
    expect(schwabClasses).toEqual(['FIXED_INCOME']);
  });

  it('each account trade sum matches its capacity', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });

  it('no PLACEMENT_SPILLOVER', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER')).toHaveLength(0);
  });
});

// â”€â”€â”€ Â§9 spillover case: $300k taxable Â· $300k IRA Â· $400k 401k â†’ $1M â”€â”€â”€â”€â”€â”€â”€â”€
// Taxable now exceeds the FI sleeve, so equities must land there.

describe('Goal 6: spillover case â€” taxable > FI target', () => {
  const ACCOUNTS_300K_TAXABLE: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 300_000 },
    { id: 'ira',    name: 'Fidelity Trad IRA',   institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    { id: 'k401',   name: 'Empower 401k',        institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 400_000 },
  ];

  it('some equity class spills into TAXABLE bucket', () => {
    // After Russell redistribution, US equity is placed as LC â†’ MC â†’ SC.
    // LC ($385k) fills first and fits entirely in the $475k of remaining TA capacity.
    // MC ($144k) then partially spills, followed by SC ($46k) â€” total ~$100k into taxable.
    const r = rebalance(ACCOUNTS_300K_TAXABLE, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(
      r.flags.some(f => f.kind === 'PLACEMENT_SPILLOVER' && f.bucket === 'TAXABLE'),
    ).toBe(true);
  });

  it('total equity spillover into taxable is ~$100k (leftover capacity after FI fill)', () => {
    const r = rebalance(ACCOUNTS_300K_TAXABLE, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const spillTotal = r.flags
      .filter(f => f.kind === 'PLACEMENT_SPILLOVER' && f.bucket === 'TAXABLE')
      .reduce((sum, f) => sum + (f.kind === 'PLACEMENT_SPILLOVER' ? f.amountUsd : 0), 0);
    expect(near(spillTotal, 100_000)).toBe(true);
  });

  it('schwab holds FIXED_INCOME plus at least one equity sub-class', () => {
    const r = rebalance(ACCOUNTS_300K_TAXABLE, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const classes = r.trades.filter(t => t.accountId === 'schwab').map(t => t.assetClass);
    expect(classes).toContain('FIXED_INCOME');
    const US_EQUITY = ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'] as const;
    expect(classes.some(c => (US_EQUITY as readonly string[]).includes(c))).toBe(true);
  });

  it('each account trade sum still matches its capacity', () => {
    const r = rebalance(ACCOUNTS_300K_TAXABLE, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   400_000)).toBe(true);
  });
});

// â”€â”€â”€ constrained 401k menu â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// 401k only has index-fund elections â€” no ALTERNATIVES ticker.

describe('Goal 2: constrained 401k â€” no ALTERNATIVES in fund menu', () => {
  const CONSTRAINED_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
    { id: 'ira',    name: 'Fidelity Trad IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    {
      id: 'k401', name: 'Empower 401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 500_000,
      // Typical 401k menu: cap-class index funds + INTL + bond + MM.
      // No alternatives/crypto/metals. Uses FXAIX/FSMDX/FSSNX for LC/MC/SC.
      availableTickers: ['FXAIX', 'FSMDX', 'FSSNX', 'VXUS', 'VWO', 'FXNAX', 'VMFXX'],
    },
  ];

  it('401k receives zero ALTERNATIVES', () => {
    const r = rebalance(CONSTRAINED_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')).toBeUndefined();
  });

  it('all $25k ALTERNATIVES go to IRA', () => {
    const r = rebalance(CONSTRAINED_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'ira', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
  });

  it('IRA trade total still equals its capacity ($300k)', () => {
    const r = rebalance(CONSTRAINED_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'ira'), 300_000)).toBe(true);
  });

  it('401k trade total still equals its capacity ($500k)', () => {
    const r = rebalance(CONSTRAINED_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'k401'), 500_000)).toBe(true);
  });
});

// â”€â”€â”€ tolerance suppression â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 5: tolerance â€” portfolio exactly at target', () => {
  it('returns no trades', () => {
    const r = rebalance(ACCOUNTS_NO_CASH, ON_TARGET_POSITIONS, DEFAULT_STRATEGY);
    expect(r.trades).toHaveLength(0);
  });

  it('emits WITHIN_TOLERANCE for every asset class', () => {
    const r = rebalance(ACCOUNTS_NO_CASH, ON_TARGET_POSITIONS, DEFAULT_STRATEGY);
    expect(r.flags.filter(f => f.kind === 'WITHIN_TOLERANCE')).toHaveLength(ALL_ASSET_CLASSES.length);
  });
});

// â”€â”€â”€ 5/25 rule â€” relative tolerance band (issue #2) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Bogleheads / Swedroe rule: a class is out of tolerance when its drift exceeds
// either of two bands â€” the *tighter* wins:
//   â€¢ absolute: Â±toleranceAbs  (e.g. Â±5pp)
//   â€¢ relative: Â±toleranceRel Ã— target  (e.g. 25% of target)
//
// For small sleeves the relative band fires first; for large sleeves the absolute
// band fires first.

describe('Goal 5: 5/25 rule â€” relative tolerance band', () => {
  // Two accounts, $1M household, simple two-class strategy.
  const TWO_ACCT: Account[] = [
    { id: 'ira',  name: 'IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    { id: 'tax', name: 'Taxable', institution: 'Schwab',   type: 'TAXABLE'        },
  ];

  // Target 90% LC / 10% FI. With toleranceAbs=0.05 and toleranceRel=0.25:
  //   LC eff tol = min(0.05, 0.25Ã—0.90) = 0.05  (absolute wins)
  //   FI eff tol = min(0.05, 0.25Ã—0.10) = 0.025 (relative wins â€” tighter)
  const LC90_FI10 = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.90, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.10, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0.05,
    toleranceRel: 0.25,
    minTradeUsd: 0,
  };

  it('relative band fires first for a small-target class (3pp drift on a 10% target)', () => {
    // FI = 7% (drift 3pp). Absolute (5pp) passes; relative (2.5pp) fails â†’ OOT.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 930_000 },  // LC = 93%
      { accountId: 'tax', ticker: 'MUNY',  marketValue:  70_000 },  // FI = 7%
    ];
    const r = rebalance(TWO_ACCT, positions, LC90_FI10);
    const fiTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME');
    expect(fiTolFlag).toBeUndefined();
    // The engine should generate trades to bring FI back to target.
    expect(r.trades.some(t => t.assetClass === 'FIXED_INCOME')).toBe(true);
  });

  it('relative band passes when drift stays within 25% of target', () => {
    // FI = 8% (drift 2pp). Relative band = 2.5pp â†’ still within.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 920_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue:  80_000 },
    ];
    const r = rebalance(TWO_ACCT, positions, LC90_FI10);
    const fiTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME');
    expect(fiTolFlag).toBeDefined();
  });

  it('absolute band dominates for a large-target class (4pp drift on a 90% target)', () => {
    // LC = 86% (drift 4pp). Absolute (5pp) passes; relative (22.5pp) would not
    // fire either â€” but it's the absolute band that determines suppression here.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 860_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue: 140_000 },  // FI = 14% (drift 4pp)
    ];
    const r = rebalance(TWO_ACCT, positions, LC90_FI10);
    // Both classes are out of tolerance â€” LC by absolute band, FI by relative band.
    // The point of this test: LC is the larger sleeve and is within absolute band.
    // But because they're paired in a single portfolio, FI's 4pp drift (>2.5pp relative)
    // makes it OOT. LC's 4pp drift (<5pp absolute) is the absolute-dominant case.
    const lcTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'US_LARGE_CAP');
    expect(lcTolFlag).toBeDefined();
  });

  it('disabling relative band (toleranceRel=1) reverts to absolute-only behaviour', () => {
    // FI = 7% (drift 3pp). With toleranceRel=1, eff = min(0.05, 0.10) = 0.05.
    // Drift (3pp) < 5pp â†’ within tolerance, no trades for FI.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 930_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue:  70_000 },
    ];
    const r = rebalance(TWO_ACCT, positions, { ...LC90_FI10, toleranceRel: 1.0 });
    const fiTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME');
    expect(fiTolFlag).toBeDefined();
  });

  it('legacy strategy without toleranceRel defaults to 0.25', () => {
    // Same drift as the first test (FI = 7% on a 10% target â†’ 3pp drift). With the
    // default toleranceRel of 0.25 implicit, the relative band (2.5pp) fires.
    const legacyStrategy = { ...LC90_FI10 };
    delete (legacyStrategy as { toleranceRel?: number }).toleranceRel;
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 930_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue:  70_000 },
    ];
    const r = rebalance(TWO_ACCT, positions, legacyStrategy);
    const fiTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME');
    expect(fiTolFlag).toBeUndefined();
  });
});

// â”€â”€â”€ UNMAPPED_HOLDING â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Disclosure: UNMAPPED_HOLDING flag', () => {
  it('emits one flag per unrecognized ticker', () => {
    const r = rebalance(
      BASE_ACCOUNTS,
      [{ accountId: 'schwab', ticker: 'MYSTERY_FUND', marketValue: 10_000 }],
      DEFAULT_STRATEGY,
    );
    const flags = r.flags.filter(f => f.kind === 'UNMAPPED_HOLDING');
    expect(flags).toHaveLength(1);
    expect(flags[0].kind === 'UNMAPPED_HOLDING' && flags[0].ticker).toBe('MYSTERY_FUND');
  });

  it('does not emit the same ticker twice', () => {
    const r = rebalance(
      BASE_ACCOUNTS,
      [
        { accountId: 'schwab', ticker: 'MYSTERY_FUND', marketValue: 5_000 },
        { accountId: 'ira',    ticker: 'MYSTERY_FUND', marketValue: 5_000 },
      ],
      DEFAULT_STRATEGY,
    );
    expect(r.flags.filter(f => f.kind === 'UNMAPPED_HOLDING')).toHaveLength(1);
  });
});

// â”€â”€â”€ minTradeUsd suppression â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 10: minTradeUsd suppression', () => {
  it('suppresses all trades when minTradeUsd exceeds every delta', () => {
    const strategy = { ...DEFAULT_STRATEGY, toleranceAbs: 0, minTradeUsd: 2_000_000 };
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, strategy);
    expect(r.trades).toHaveLength(0);
  });

  it('does not suppress trades when minTradeUsd is zero', () => {
    const strategy = { ...DEFAULT_STRATEGY, toleranceAbs: 0, minTradeUsd: 0 };
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, strategy);
    expect(r.trades.length).toBeGreaterThan(0);
  });
});

// â”€â”€â”€ zero-net-balance invariant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// With the tolerance-locking fix, Î£ trade deltas per account must equal newCash
// (i.e. sells and buys within an account cancel out, leaving only cash deployment).

describe('Goal 3: zero-net-balance invariant â€” tolerance with partial drift', () => {
  // Positions that are CLOSE to Â§9 targets but not exact; some classes
  // are within the default 5% band, some are out of tolerance. The old code
  // would generate non-zero net deltas per account; the fixed code must not.
  const DRIFTED_POSITIONS: Position[] = [
    // schwab: $210k FI (target $200k â€” $10k over, within 5% of $1M = $50k band)
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 210_000 },
    // IRA: slightly off across multiple classes
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 170_000 },  // US: short
    { accountId: 'ira',    ticker: 'FZILX', marketValue:  80_000 },  // INTL: over
    { accountId: 'ira',    ticker: 'FPADX', marketValue:  11_250 },
    { accountId: 'ira',    ticker: 'GLD',   marketValue:   9_375 },
    // 401k: slightly off
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 319_375 },  // US: short
    { accountId: 'k401',   ticker: 'VXUS',  marketValue: 106_250 },
    { accountId: 'k401',   ticker: 'VWO',   marketValue:  18_750 },
    { accountId: 'k401',   ticker: 'GLD',   marketValue:  15_625 },
  ];

  it('net trade delta per account = 0 (no new cash, out-of-tolerance classes)', () => {
    const strategy = { ...DEFAULT_STRATEGY, toleranceAbs: 0 };
    const r = rebalance(ACCOUNTS_NO_CASH, DRIFTED_POSITIONS, strategy);
    // Allow $2 rounding tolerance.
    expect(near(accountSum(r.trades, 'schwab'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   0, 2)).toBe(true);
  });

  it('net trade delta per account = 0 even when some classes are within tolerance', () => {
    // Default 5% tolerance suppresses some classes; the remaining must still balance.
    const r = rebalance(ACCOUNTS_NO_CASH, DRIFTED_POSITIONS, DEFAULT_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   0, 2)).toBe(true);
  });
});

// â”€â”€â”€ locked accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 1: locked accounts', () => {
  const LOCKED_IRA_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
    { id: 'ira',    name: 'Fidelity Trad IRA',   institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000, locked: true },
    { id: 'k401',   name: 'Empower 401k',        institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
  ];

  it('locked account contributes to householdValue', () => {
    const r = rebalance(LOCKED_IRA_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.householdValue).toBe(1_000_000);
  });

  it('locked account contributes to currentWeights', () => {
    // IRA has $300k in FIXED_INCOME; locked but still counted in weights.
    const POSITIONS_WITH_LOCKED_IRA: Position[] = [
      { accountId: 'ira', ticker: 'MUNY', marketValue: 300_000 },
    ];
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE',         newCash: 200_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
    ];
    const r = rebalance(accts, POSITIONS_WITH_LOCKED_IRA, ZERO_TOL_STRATEGY);
    expect(r.currentWeights.FIXED_INCOME).toBeCloseTo(0.3, 3);  // 300k/1M
  });

  it('generates zero trades for a locked account', () => {
    const r = rebalance(LOCKED_IRA_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const iraTrades = r.trades.filter(t => t.accountId === 'ira');
    expect(iraTrades).toHaveLength(0);
  });

  it('remaining (non-locked) accounts still balance to their capacity', () => {
    const r = rebalance(LOCKED_IRA_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    // schwab + k401 together have $700k of free capacity to deploy.
    expect(near(accountSum(r.trades, 'schwab') + accountSum(r.trades, 'k401'), 700_000)).toBe(true);
  });

  it('net trade delta per non-locked account = newCash only', () => {
    // greenfield: all new cash â†’ each account's net delta should equal its newCash
    const r = rebalance(LOCKED_IRA_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });
});

// â”€â”€â”€ locked positions â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 1: locked positions', () => {
  // On-target portfolio except FZROX in 401k is locked.
  const LOCKED_POS_ACCOUNTS: Account[] = ACCOUNTS_NO_CASH;
  const BASE_LOCKED_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
    { accountId: 'ira',    ticker: 'GLD',   marketValue:   9_375 },
    { accountId: 'ira',    ticker: 'FPADX', marketValue:  11_250 },
    { accountId: 'ira',    ticker: 'FZILX', marketValue:  63_750 },
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 215_625 },
    { accountId: 'k401',   ticker: 'GLD',   marketValue:  15_625 },
    { accountId: 'k401',   ticker: 'VWO',   marketValue:  18_750 },
    { accountId: 'k401',   ticker: 'VXUS',  marketValue: 106_250 },
    // FSKAX locked â€” should never appear in a sell trade
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 259_375, locked: true },
    // Extra cash overweight in US â€” needs to be rebalanced elsewhere
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 100_000 },
  ];

  it('locked position still counted in currentWeights (via cap sub-classes)', () => {
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    // US_TOTAL_MARKET is redistributed to LC/MC/SC via RUSSELL_CAP_SPLIT.
    // Total US equity: 259375 + 100000 (k401) + 215625 (ira) = 575000 â†’ ~57.5% combined.
    const usEquityWeight =
      r.currentWeights.US_LARGE_CAP +
      r.currentWeights.US_MID_CAP  +
      r.currentWeights.US_SMALL_CAP;
    expect(usEquityWeight).toBeGreaterThan(0.5);
  });

  it('no trade reduces cap sub-class beyond the unlocked portion', () => {
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    // k401 FSKAX: $259k locked + $100k unlocked â†’ redistributed via Russell weights.
    // Unlocked cap capacity: LC â‰ˆ $67k, MC â‰ˆ $25k, SC â‰ˆ $8k.
    const lcSell = r.trades.find(t => t.accountId === 'k401' && t.assetClass === 'US_LARGE_CAP');
    if (lcSell && lcSell.deltaUsd < 0) {
      expect(Math.abs(lcSell.deltaUsd)).toBeLessThanOrEqual(100_000 * 0.67 + 1);
    }
    const mcSell = r.trades.find(t => t.accountId === 'k401' && t.assetClass === 'US_MID_CAP');
    if (mcSell && mcSell.deltaUsd < 0) {
      expect(Math.abs(mcSell.deltaUsd)).toBeLessThanOrEqual(100_000 * 0.25 + 1);
    }
    const scSell = r.trades.find(t => t.accountId === 'k401' && t.assetClass === 'US_SMALL_CAP');
    if (scSell && scSell.deltaUsd < 0) {
      expect(Math.abs(scSell.deltaUsd)).toBeLessThanOrEqual(100_000 * 0.08 + 1);
    }
  });

  it('net trade delta per account = 0 (no new cash)', () => {
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   0, 2)).toBe(true);
  });

  it('projectedWeights reach targets despite locked positions (immovable correction)', () => {
    // Regression: without the immovable subtraction in step 5, locked FSKAX ($259k)
    // caused cap sub-classes to be over-bought. projectedWeights would exceed targets
    // by the locked fraction (~25.9% of $1M total), pushing e.g. US_LARGE_CAP
    // to ~56% instead of the 38.5% target.
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    const tol = 0.02; // allow 2% rounding slack
    expect(Math.abs(r.projectedWeights.US_LARGE_CAP - ZERO_TOL_STRATEGY.targets.US_LARGE_CAP)).toBeLessThan(tol);
    expect(Math.abs(r.projectedWeights.US_MID_CAP   - ZERO_TOL_STRATEGY.targets.US_MID_CAP  )).toBeLessThan(tol);
    expect(Math.abs(r.projectedWeights.US_SMALL_CAP - ZERO_TOL_STRATEGY.targets.US_SMALL_CAP)).toBeLessThan(tol);
    expect(Math.abs(r.projectedWeights.FIXED_INCOME  - ZERO_TOL_STRATEGY.targets.FIXED_INCOME )).toBeLessThan(tol);
  });

  it('locked account holdings are also treated as immovable', () => {
    // A fully-locked account's INTL position must not cause the unlocked accounts
    // to over-buy INTL. projectedWeights[DEVELOPED_INTL] should equal the target.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
    ];
    // IRA holds $100k of INTL (locked account â€” immovable). Household = $800k.
    // DEVELOPED_INTL target = 17% â†’ $136k total; $100k already locked in IRA.
    // Trades should only buy $36k of INTL, not $136k.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FZILX', marketValue: 100_000 },
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.17, EMERGING_INTL: 0, FIXED_INCOME: 0.25, ALTERNATIVES: 0.08, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
    };
    const r = rebalance(accts, positions, strategy);
    // Without the fix: projected DEVELOPED_INTL â‰ˆ 17% + 100k/800k = 29.5%.
    // With the fix: projected DEVELOPED_INTL â‰ˆ 17%.
    expect(Math.abs(r.projectedWeights.DEVELOPED_INTL - 0.17)).toBeLessThan(0.02);
    expect(near(accountSum(r.trades, 'schwab'), 200_000, 5)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000, 5)).toBe(true);
  });
});

// â”€â”€â”€ concentrateClasses â€” fill designated account first â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 9: concentrateClasses â€” fill designated account first', () => {
  // Two IRAs: Roth IRA concentrates ALTERNATIVES.
  // The default strategy spreads ALTERNATIVES proportionally across all TA accounts;
  // with concentrateClasses the Roth must absorb as much as its capacity allows first.
  const CONCENTRATE_ACCOUNTS: Account[] = [
    { id: 'schwab',   name: 'Schwab',       institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
    { id: 'trad_ira', name: 'Trad IRA',     institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 150_000 },
    { id: 'roth',     name: 'Roth IRA',     institution: 'Fidelity', type: 'ROTH_IRA',         newCash: 150_000,
      concentrateClasses: ['ALTERNATIVES'] as AssetClass[] },
    { id: 'k401',     name: 'Empower 401k', institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
  ];

  it('all ALTERNATIVES go to Roth IRA when it has sufficient capacity', () => {
    const r = rebalance(CONCENTRATE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    // ALTERNATIVES target = 2.5% Ã— $1M = $25k. Roth has $150k capacity â†’ absorbs all of it.
    expect(tradeFor(r.trades, 'roth',     'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'trad_ira', 'ALTERNATIVES')).toBeUndefined();
    expect(tradeFor(r.trades, 'k401',     'ALTERNATIVES')).toBeUndefined();
  });

  it('spills to other TA accounts when Roth IRA capacity is exhausted', () => {
    const SMALL_ROTH: Account[] = [
      { id: 'schwab',   name: 'Schwab',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'trad_ira', name: 'Trad IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 795_000 },
      { id: 'roth',     name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA',         newCash:   5_000,
        concentrateClasses: ['ALTERNATIVES'] as AssetClass[] },
    ];
    const r = rebalance(SMALL_ROTH, NO_POSITIONS, ZERO_TOL_STRATEGY);
    // Roth has $5k â€” fills with ALTERNATIVES first, then capacity is gone.
    expect(tradeFor(r.trades, 'roth', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(5_000, 0);
    // Remaining $20k of ALTERNATIVES spills to trad IRA.
    expect(tradeFor(r.trades, 'trad_ira', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(20_000, 0);
  });

  it('each account trade sum matches its capacity', () => {
    const r = rebalance(CONCENTRATE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'),   200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'trad_ira'), 150_000)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),     150_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),     500_000)).toBe(true);
  });
});

// â”€â”€â”€ allowedAssetClasses â€” explicit class whitelist â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 2: allowedAssetClasses â€” explicit class whitelist', () => {
  const EXPLICIT_CONSTRAINED: Account[] = [
    { id: 'schwab', name: 'Schwab',    institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
    { id: 'ira',    name: 'Trad IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    {
      id: 'k401', name: 'Empower 401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 500_000,
      // Direct class whitelist â€” same effective constraint as the availableTickers test
      // but expressed without a ticker list.
      allowedAssetClasses: [
        'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
        'DEVELOPED_INTL', 'EMERGING_INTL', 'FIXED_INCOME', 'CASH',
      ] as AssetClass[],
    },
  ];

  it('401k receives no ALTERNATIVES when excluded via allowedAssetClasses', () => {
    const r = rebalance(EXPLICIT_CONSTRAINED, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')).toBeUndefined();
  });

  it('all $25k ALTERNATIVES go to IRA', () => {
    const r = rebalance(EXPLICIT_CONSTRAINED, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'ira', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
  });

  it('each account trade sum still matches its capacity', () => {
    const r = rebalance(EXPLICIT_CONSTRAINED, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });

  it('allowedAssetClasses takes precedence over availableTickers', () => {
    // availableTickers includes GLD (â†’ ALTERNATIVES), but allowedAssetClasses overrides it.
    const accts: Account[] = [{
      id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 500_000,
      availableTickers: ['GLD'],
      allowedAssetClasses: ['US_LARGE_CAP'] as AssetClass[],
    }];
    const r = rebalance(accts, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'ira', 'ALTERNATIVES')).toBeUndefined();
    expect(tradeFor(r.trades, 'ira', 'US_LARGE_CAP')).toBeDefined();
  });
});

// â”€â”€â”€ per-account net-zero when NO_ELIGIBLE_ACCOUNT fires â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// An account restricted to one asset class must not produce surplus-cash trades
// (net-negative) when the offsetting class has no eligible home anywhere.

describe('Goal 3: per-account net-zero â€” NO_ELIGIBLE_ACCOUNT with restricted account', () => {
  // Roth holds US_LARGE_CAP; target shifts 50% to FIXED_INCOME.
  // Roth's allowedAssetClasses excludes FI â†’ NO_ELIGIBLE_ACCOUNT fires.
  // Before the step-7.5 fix, Roth would receive a sell-only trade for $50k LC
  // with no intra-account buy to absorb it (net = âˆ’$50k, surplus cash).
  // After the fix, the gap is returned to LC so net = 0 and no trade is emitted.
  const RESTRICTED_ROTH: Account[] = [
    {
      id: 'roth', name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA',
      allowedAssetClasses: ['US_LARGE_CAP'] as AssetClass[],
    },
  ];
  const ROTH_POSITIONS: Position[] = [
    { accountId: 'roth', ticker: 'FXAIX', marketValue: 100_000 },
  ];
  const HALF_LC_HALF_FI = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0,
  };

  it('net trade delta for restricted account is 0, not âˆ’$50k', () => {
    const r = rebalance(RESTRICTED_ROTH, ROTH_POSITIONS, HALF_LC_HALF_FI);
    expect(near(accountSum(r.trades, 'roth'), 0, 1)).toBe(true);
  });

  it('NO_ELIGIBLE_ACCOUNT flag is still emitted for the unplaceable class', () => {
    const r = rebalance(RESTRICTED_ROTH, ROTH_POSITIONS, HALF_LC_HALF_FI);
    expect(r.flags.some(f => f.kind === 'NO_ELIGIBLE_ACCOUNT')).toBe(true);
  });

  it('account with full capacity access still rebalances when paired with restricted account', () => {
    // Add an unrestricted taxable account that CAN hold FI.
    // Taxable should sell equity and buy FI (net 0); Roth should have no trades.
    const accts: Account[] = [
      {
        id: 'roth', name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA',
        allowedAssetClasses: ['US_LARGE_CAP'] as AssetClass[],
      },
      { id: 'taxable', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
    ];
    const positions: Position[] = [
      { accountId: 'roth',    ticker: 'FXAIX', marketValue: 100_000 },
      { accountId: 'taxable', ticker: 'FXAIX', marketValue: 100_000 },
    ];
    const r = rebalance(accts, positions, HALF_LC_HALF_FI);
    expect(near(accountSum(r.trades, 'roth'),    0, 1)).toBe(true);
    expect(near(accountSum(r.trades, 'taxable'), 0, 1)).toBe(true);
  });
});

// â”€â”€â”€ TAXABLE_SALE flag â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 7: TAXABLE_SALE flag', () => {
  // Start with more FI than target in taxable â†’ engine must sell some.
  const OVER_FI_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 300_000 },  // $100k over target
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 215_625 },
    { accountId: 'ira',    ticker: 'FZILX', marketValue:  63_750 },
    { accountId: 'ira',    ticker: 'FPADX', marketValue:  11_250 },
    { accountId: 'ira',    ticker: 'GLD',   marketValue:   9_375 },
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 259_375 },
    { accountId: 'k401',   ticker: 'VXUS',  marketValue: 106_250 },
    { accountId: 'k401',   ticker: 'VWO',   marketValue:  18_750 },
    { accountId: 'k401',   ticker: 'GLD',   marketValue:  15_625 },
  ];

  it('emits TAXABLE_SALE when a sell lands in a taxable account', () => {
    const strategy = { ...DEFAULT_STRATEGY, toleranceAbs: 0 };
    const r = rebalance(ACCOUNTS_NO_CASH, OVER_FI_POSITIONS, strategy);
    const flag = r.flags.find(f => f.kind === 'TAXABLE_SALE');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'TAXABLE_SALE' && flag.accountId).toBe('schwab');
    expect(flag?.kind === 'TAXABLE_SALE' && flag.assetClass).toBe('FIXED_INCOME');
  });

  it('does not emit TAXABLE_SALE for a cash position reduced in a taxable account (issue #56)', () => {
    const accounts: Account[] = [
      { id: 'taxable', name: 'Taxable', institution: 'X', type: 'TAXABLE' },
      { id: 'ira',     name: 'IRA',     institution: 'X', type: 'TRADITIONAL_IRA' },
    ];
    // CASH target is 0 → engine must sell the SPAXX position.
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'SPAXX', marketValue:  20_000 },
      { accountId: 'ira',     ticker: 'BND',   marketValue: 200_000 },
      { accountId: 'ira',     ticker: 'VOO',   marketValue: 780_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY);
    const cashSell = r.trades.find(t => t.assetClass === 'CASH' && t.deltaUsd < 0);
    expect(cashSell).toBeDefined();
    expect(r.flags.some(f => f.kind === 'TAXABLE_SALE' && f.assetClass === 'CASH')).toBe(false);
  });
});

// â”€â”€â”€ step 8.5 â€” post-minTradeUsd balance correction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When minTradeUsd filtering drops a trade on one side of the ledger but not the
// other, the per-account net would become nonzero. Step 8.5 absorbs the residual
// into the largest kept trade on the imbalanced side.

describe('Goal 3: step 8.5 â€” minTradeUsd balance correction', () => {
  // Single account; $75k existing positions (no new cash).
  // LC is over-weight, FI is under-weight, ALT is slightly over-weight.
  // With minTradeUsd = $10 000, the ALT sell ($1 250) is filtered out.
  // Before correction: net = âˆ’$17 500 + $18 750 = +$1 250 (surplus buy).
  // After correction:  FI buy shrunk to $17 500; net = 0.
  const SINGLE_ACCT: Account[] = [
    { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
  ];
  const POSITIONS_75K: Position[] = [
    { accountId: 'ira', ticker: 'FXAIX', marketValue: 55_000 },  // US_LARGE_CAP
    { accountId: 'ira', ticker: 'MUNY',  marketValue: 15_000 },  // FIXED_INCOME
    { accountId: 'ira', ticker: 'GLD',   marketValue:  5_000 },  // ALTERNATIVES
  ];
  // Household = $75k; targets: 50% LC, 45% FI, 5% ALT â†’ $37 500, $33 750, $3 750.
  // LC delta = âˆ’$17 500 (sell, survives).
  // FI delta = +$18 750 (buy, survives).
  // ALT delta = âˆ’$1 250 (sell, filtered by $10 000).
  const HIGH_MIN_TRADE_STRATEGY = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.50, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.45, ALTERNATIVES: 0.05, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0,
    minTradeUsd: 10_000,
  };

  it('net trade delta is 0 after correction despite asymmetric filtering', () => {
    const r = rebalance(SINGLE_ACCT, POSITIONS_75K, HIGH_MIN_TRADE_STRATEGY);
    expect(near(accountSum(r.trades, 'ira'), 0, 1)).toBe(true);
  });

  it('the filtered-out class has no trade', () => {
    const r = rebalance(SINGLE_ACCT, POSITIONS_75K, HIGH_MIN_TRADE_STRATEGY);
    // ALT sell is only âˆ’$1 250, below the $10 000 minTradeUsd.
    expect(tradeFor(r.trades, 'ira', 'ALTERNATIVES')).toBeUndefined();
  });

  it('surviving buy is shrunk to absorb the gap left by the dropped sell', () => {
    const r = rebalance(SINGLE_ACCT, POSITIONS_75K, HIGH_MIN_TRADE_STRATEGY);
    const fiBuy = tradeFor(r.trades, 'ira', 'FIXED_INCOME');
    expect(fiBuy).toBeDefined();
    // FI buy should be $17 500 (= $18 750 âˆ’ $1 250 residual), not $18 750.
    expect(fiBuy!.deltaUsd).toBeCloseTo(17_500, -2);
  });

  it('net = newCash (not zero) when the account has a contribution', () => {
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 5_000 },
    ];
    const r = rebalance(accts, POSITIONS_75K, HIGH_MIN_TRADE_STRATEGY);
    // Net should equal newCash ($5 000), not zero.
    expect(near(accountSum(r.trades, 'ira'), 5_000, 100)).toBe(true);
  });
});

// â”€â”€â”€ freeCash â€” household-level free cash distribution â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 4: freeCash â€” household-level cash distribution', () => {
  // Two deposit-eligible accounts: $200k taxable, $300k IRA.
  const ACCOUNTS_NO_CASH_ELIGIBLE: Account[] = [
    { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         },
    { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', },
  ];
  const POSITIONS_TWO_ACCOUNTS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 300_000 },
  ];

  it('concentrates freeCash into the largest-capacity account (#37)', () => {
    // ira ($300k) has more capacity than schwab ($200k), so all $50k of free cash
    // lands in ira; schwab receives none. Concentrate-then-spill minimizes the
    // number of accounts touched rather than spreading the cash pro-rata.
    const r = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(near(accountSum(r.trades, 'ira'),    50_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), 0,      100)).toBe(true);
  });

  it('householdValue includes freeCash', () => {
    const r = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(r.householdValue).toBeCloseTo(550_000, 0);
  });

  it('freeCash=0 is a no-op (backward compatible)', () => {
    const withZero    = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 0);
    const withDefault = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY);
    expect(withZero.trades).toEqual(withDefault.trades);
    expect(withZero.householdValue).toBe(withDefault.householdValue);
  });

  it('account with acceptsDeposits=false receives no freeCash share', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE' },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA', acceptsDeposits: false },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'roth',   ticker: 'FZROX', marketValue: 200_000 },
    ];
    // freeCash $20k â€” only schwab is eligible.
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 20_000);
    // schwab gets all $20k; roth net = 0.
    expect(near(accountSum(r.trades, 'schwab'), 20_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),   0, 100)).toBe(true);
  });

  it('freeCash stacks with per-account newCash', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 5_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 5_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'ira',    ticker: 'FZROX', marketValue: 300_000 },
    ];
    // freeCash $50k concentrates into the larger account (ira): ira net = $5k own
    // + $50k = $55k; schwab keeps just its own $5k.
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(near(accountSum(r.trades, 'schwab'), 5_000,  100)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    55_000, 100)).toBe(true);
  });

  it('emits EXCESS_CASH flag when all accounts are ineligible', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',  acceptsDeposits: false },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA', locked: true },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'roth',   ticker: 'FZROX', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 10_000);
    const flag = r.flags.find(f => f.kind === 'EXCESS_CASH');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'EXCESS_CASH' && flag.amountUsd).toBe(10_000);
  });

  it('concentrates into the first account by id when all eligible accounts are zero value (greenfield)', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA'        },
    ];
    // Both accounts have zero value, so capacity ties and the id tie-break decides:
    // 'roth' < 'schwab', so all $20k concentrates into roth (deterministic).
    const r = rebalance(accounts, NO_POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 20_000);
    expect(near(accountSum(r.trades, 'roth'),   20_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), 0,      100)).toBe(true);
  });

  it('spills to additional accounts only when a deposit cap forces it, touching fewer accounts than pro-rata (#37)', () => {
    // ira ($300k) is largest. Without a cap, $50k all lands in ira (one account).
    // With a $30k cap on ira, $30k fills ira and the remaining $20k spills to schwab.
    const uncapped = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    const fundedUncapped = ['schwab', 'ira'].filter(id => Math.abs(accountSum(uncapped.trades, id)) > 1);
    expect(fundedUncapped).toEqual(['ira']); // a single account touched

    const capped: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', depositLimitUsd: 30_000 },
    ];
    const r = rebalance(capped, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(near(accountSum(r.trades, 'ira'),    30_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), 20_000, 100)).toBe(true);
  });

  it('caps a limited account at depositLimitUsd; remainder spills to the unlimited account', () => {
    // schwab $200k (unlimited), roth $300k (limited to $10k). Pro-rata would send
    // roth 60% = $30k, but its cap clamps it to $10k; the remaining $40k goes to schwab.
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'  },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA', depositLimitUsd: 10_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'roth',   ticker: 'FZROX', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(near(accountSum(r.trades, 'roth'),   10_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), 40_000, 100)).toBe(true);
    expect(r.flags.some(f => f.kind === 'EXCESS_CASH')).toBe(false);
  });

  it('emits EXCESS_CASH for free cash exceeding the sum of all caps', () => {
    // Both accounts limited: schwab $5k, roth $8k â†’ $13k total capacity. $20k free
    // cash leaves $7k un-allocatable.
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',  depositLimitUsd: 5_000 },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA', depositLimitUsd: 8_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'roth',   ticker: 'FZROX', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 20_000);
    expect(near(accountSum(r.trades, 'schwab'), 5_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),   8_000, 100)).toBe(true);
    const flag = r.flags.find(f => f.kind === 'EXCESS_CASH');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'EXCESS_CASH' && near(flag.amountUsd, 7_000, 1)).toBe(true);
  });

  it('deploys per-account newCash in full regardless of the deposit cap', () => {
    // roth has a tight $1k free-cash cap but $9k of its own newCash. The cap governs
    // only household free-cash routing â€” the $9k must still deploy in full.
    const accounts: Account[] = [
      { id: 'roth', name: 'Roth', institution: 'Fidelity', type: 'ROTH_IRA', newCash: 9_000, depositLimitUsd: 1_000 },
    ];
    const positions: Position[] = [
      { accountId: 'roth', ticker: 'FZROX', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 0);
    expect(near(accountSum(r.trades, 'roth'), 9_000, 100)).toBe(true);
  });

  it('treats depositLimitUsd === 0 as closed', () => {
    // roth capped at $0 is functionally closed â†’ all free cash goes to schwab.
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'  },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA', depositLimitUsd: 0 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'roth',   ticker: 'FZROX', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 20_000);
    expect(near(accountSum(r.trades, 'schwab'), 20_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),   0, 100)).toBe(true);
  });
});

// â”€â”€â”€ plannedWithdrawal â€” drawdown / spending mode (issue #14) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 4: plannedWithdrawal â€” drawdown', () => {
  // schwab (taxable, eligible by default) $200k; ira (traditional, RESTRICTED by
  // default) $300k. Net trade delta per account == its (negative) withdrawal.
  const ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
    { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
  ];
  const POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 300_000 },
  ];

  it('raises the full planned amount from the eligible account; net flow = âˆ’W', () => {
    // Only schwab is eligible (ira is tax-advantaged â†’ restricted by default), so
    // it funds the whole $50k. Household value drops by the withdrawal.
    const r = rebalance(ACCOUNTS, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 50_000);
    expect(near(accountSum(r.trades, 'schwab'), -50_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    0,       200)).toBe(true);
    expect(r.householdValue).toBeCloseTo(450_000, 0);
    expect(near(r.contributionSummary.withdrawalRaised, 50_000, 200)).toBe(true);
    expect(r.flags.some(f => f.kind === 'WITHDRAWAL_SHORTFALL')).toBe(false);
  });

  it('drains eligible accounts in withdrawalPriority order, spilling when exhausted', () => {
    const accounts: Account[] = [
      { id: 'a', name: 'A', institution: 'Schwab', type: 'TAXABLE', withdrawalPriority: 10 },
      { id: 'b', name: 'B', institution: 'Schwab', type: 'TAXABLE', withdrawalPriority: 20 },
    ];
    const positions: Position[] = [
      { accountId: 'a', ticker: 'MUNY', marketValue: 30_000 },
      { accountId: 'b', ticker: 'MUNY', marketValue: 100_000 },
    ];
    // $50k: a (priority 10) drains its full $30k sellable, b (priority 20) covers $20k.
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 0, 50_000);
    expect(near(accountSum(r.trades, 'a'), -30_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'b'), -20_000, 200)).toBe(true);
  });

  it('withdraws Î£ RMD + the additional amount (RMDs are additive, not a ceiling)', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', rmdDueUsd: 20_000 },
    ];
    // $20k RMD (ira) + $30k additional (drains the eligible taxable account) = $50k.
    const r = rebalance(accounts, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 30_000);
    expect(near(accountSum(r.trades, 'ira'),    -20_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), -30_000, 200)).toBe(true);
    expect(r.householdValue).toBeCloseTo(450_000, 0);
  });

  it('routes no discretionary withdrawal to a restricted (tax-advantaged) account', () => {
    // ira is restricted by default â†’ all $40k comes from the taxable account.
    const r = rebalance(ACCOUNTS, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 40_000);
    expect(near(accountSum(r.trades, 'schwab'), -40_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    0,       200)).toBe(true);
  });

  it('takes a forced RMD even from a restricted account, with no additional amount', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', rmdDueUsd: 25_000 },
    ];
    // additional = 0, so only the $25k RMD is taken â€” from the restricted ira.
    const r = rebalance(accounts, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 0);
    expect(near(accountSum(r.trades, 'ira'),    -25_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), 0,       200)).toBe(true);
  });

  it('processes a withdrawal and free-cash deposit independently in the same run', () => {
    // Deposits and withdrawals are independent passes that net per account.
    // a (lower id) drains the $30k withdrawal â†’ net âˆ’$30k. The $30k of free cash
    // routes to the largest-capacity account b (concentrate-then-spill) â†’ net +$30k.
    const accounts: Account[] = [
      { id: 'a', name: 'A', institution: 'Schwab', type: 'TAXABLE' },
      { id: 'b', name: 'B', institution: 'Schwab', type: 'TAXABLE' },
    ];
    const positions: Position[] = [
      { accountId: 'a', ticker: 'MUNY', marketValue: 100_000 },
      { accountId: 'b', ticker: 'MUNY', marketValue: 300_000 },
    ];
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 30_000, 30_000);
    expect(near(accountSum(r.trades, 'a'), -30_000, 200)).toBe(true);
    expect(near(accountSum(r.trades, 'b'),  30_000, 200)).toBe(true);
    expect(r.flags.some(f => f.kind === 'EXCESS_CASH')).toBe(false);
    // Household value is unchanged: +$30k deposit âˆ’ $30k withdrawal.
    expect(r.householdValue).toBeCloseTo(400_000, 0);
  });

  it('emits WITHDRAWAL_SHORTFALL when the additional amount exceeds eligible capacity', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 30_000, locked: true },
      { accountId: 'schwab', ticker: 'FZROX', marketValue: 70_000 },
    ];
    // Only the $70k FZROX is sellable (MUNY is locked); a $90k additional withdrawal
    // leaves a $20k shortfall.
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 0, 90_000);
    const flag = r.flags.find(f => f.kind === 'WITHDRAWAL_SHORTFALL');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'WITHDRAWAL_SHORTFALL' && near(flag.amountUsd, 20_000, 1)).toBe(true);
    expect(near(accountSum(r.trades, 'schwab'), -70_000, 200)).toBe(true);
  });

  it('still lands the household on target after a withdrawal (allocation-preserving)', () => {
    // With zero tolerance the engine rebalances to the (reduced) post-withdrawal
    // targets, so the drawdown does not knock the household off its allocation.
    const r = rebalance(ACCOUNTS, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 50_000);
    for (const ac of ['US_LARGE_CAP', 'FIXED_INCOME'] as const) {
      expect(near(r.projectedWeights[ac], ZERO_TOL_STRATEGY.targets[ac], 0.01)).toBe(true);
    }
  });

  it('plannedWithdrawal=0 with no RMD is a no-op', () => {
    const withZero    = rebalance(ACCOUNTS, POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 0, 0);
    const withDefault = rebalance(ACCOUNTS, POSITIONS, ZERO_TOL_STRATEGY);
    expect(withZero.trades).toEqual(withDefault.trades);
    expect(withZero.householdValue).toBe(withDefault.householdValue);
  });
});

// â”€â”€â”€ step 7.7 â€” redirect taxable equity sells to tax-advantaged accounts â”€â”€â”€â”€â”€
//
// Scenario: taxable holds equity that is overweight at household level. Without
// the redirect, the engine would sell equity in taxable (bad: triggers capital
// gains). With step 7.7, the sell is moved to the TA account instead.

describe('Goal 7: step 7.7 â€” redirectTaxableSells', () => {
  // â”€â”€ shared fixture â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Household $200k: taxable $60k US_LARGE_CAP, Roth $80k US_LARGE_CAP + $60k FI.
  // Target 50% LC / 50% FI â†’ need to sell $40k LC and buy $40k FI.
  // greedyPlace routes: all LC to Roth (TAX_ADVANTAGED first), FI split Taxable $60k / Roth $40k.
  // Without redirect: taxable sells $60k LC and buys $60k FI; Roth buys $20k LC and sells $20k FI.
  // With redirect: taxable keeps its LC; Roth sells $40k LC and buys $40k FI; taxable has 0 trades.
  const REDIRECT_ACCOUNTS: Account[] = [
    { id: 'taxable', name: 'Schwab',   institution: 'Schwab',   type: 'TAXABLE'  },
    { id: 'roth',    name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA' },
  ];
  const REDIRECT_POSITIONS: Position[] = [
    { accountId: 'taxable', ticker: 'FXAIX', marketValue:  60_000 },  // US_LARGE_CAP
    { accountId: 'roth',    ticker: 'FXAIX', marketValue:  80_000 },  // US_LARGE_CAP
    { accountId: 'roth',    ticker: 'MUNY',  marketValue:  60_000 },  // FIXED_INCOME
  ];
  // Strategy: 50% US_LARGE_CAP / 50% FIXED_INCOME, zero tolerance.
  const REDIRECT_STRATEGY = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0,
    minTradeUsd: 0,
  };

  it('emits no TAXABLE_SALE â€” equity sell fully redirected to Roth', () => {
    const r = rebalance(REDIRECT_ACCOUNTS, REDIRECT_POSITIONS, REDIRECT_STRATEGY);
    expect(r.flags.filter(f => f.kind === 'TAXABLE_SALE')).toHaveLength(0);
  });

  it('taxable account has no sell trades at all', () => {
    const r = rebalance(REDIRECT_ACCOUNTS, REDIRECT_POSITIONS, REDIRECT_STRATEGY);
    const taxableSells = r.trades.filter(t => t.accountId === 'taxable' && t.deltaUsd < 0);
    expect(taxableSells).toHaveLength(0);
  });

  it('Roth sells US_LARGE_CAP (TA sell absorbs the rebalancing)', () => {
    const r = rebalance(REDIRECT_ACCOUNTS, REDIRECT_POSITIONS, REDIRECT_STRATEGY);
    const rothLcSell = r.trades.find(t => t.accountId === 'roth' && t.assetClass === 'US_LARGE_CAP');
    expect(rothLcSell).toBeDefined();
    expect(rothLcSell!.deltaUsd).toBeLessThan(0);
    expect(rothLcSell!.inTaxableAccount).toBe(false);
  });

  it('per-account net = 0 (no new cash)', () => {
    const r = rebalance(REDIRECT_ACCOUNTS, REDIRECT_POSITIONS, REDIRECT_STRATEGY);
    expect(near(accountSum(r.trades, 'taxable'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),    0, 2)).toBe(true);
  });

  it('projected weights reach target after redirect', () => {
    const r = rebalance(REDIRECT_ACCOUNTS, REDIRECT_POSITIONS, REDIRECT_STRATEGY);
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.5, 2);
    expect(r.projectedWeights.FIXED_INCOME).toBeCloseTo(0.5, 2);
  });

  // â”€â”€ partial redirect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Roth holds only $10k LC (not enough to absorb the full $60k taxable sell).
  // Redirect absorbs $10k; taxable still sells the remaining $50k.
  it('partial redirect â€” taxable sell shrinks when TA can only absorb part of it', () => {
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'FXAIX', marketValue:  60_000 },  // LC
      { accountId: 'roth',    ticker: 'FXAIX', marketValue:  10_000 },  // LC (small)
      { accountId: 'roth',    ticker: 'MUNY',  marketValue: 130_000 },  // FI
    ];
    // Household $200k; target 25% LC ($50k) / 75% FI ($150k).
    // LC overweight by $20k: sell $20k. FI underweight by $20k: buy $20k.
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.25, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.75, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(REDIRECT_ACCOUNTS, positions, strategy);
    // Roth can absorb up to its target for LC. Any taxable sell should be â‰¤ original.
    const taxableLcSell = r.trades.find(t => t.accountId === 'taxable' && t.assetClass === 'US_LARGE_CAP');
    // Household is only $20k overweight LC overall. Any remaining taxable sell must be < $20k.
    if (taxableLcSell) {
      expect(Math.abs(taxableLcSell.deltaUsd)).toBeLessThan(20_000 + 1);
    }
    // Per-account net must still be 0.
    expect(near(accountSum(r.trades, 'taxable'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),    0, 2)).toBe(true);
  });

  // â”€â”€ FIXED_INCOME sells in taxable are NOT redirected â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // FI prefers TAXABLE, so selling FI in taxable is correct behaviour.
  // (This is the existing OVER_FI_POSITIONS test scenario.)
  it('does not redirect FIXED_INCOME sells â€” FI prefers TAXABLE', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 300_000 },  // FI, $100k over
      { accountId: 'ira',    ticker: 'FZROX', marketValue: 700_000 },  // US_LARGE_CAP
    ];
    // Target: 20% FI ($200k), 80% LC ($800k). FI oversold.
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.8, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.2, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accounts, positions, strategy);
    // The TAXABLE_SALE flag for FI should still be emitted.
    const fiSaleFlag = r.flags.find(f => f.kind === 'TAXABLE_SALE' && f.assetClass === 'FIXED_INCOME');
    expect(fiSaleFlag).toBeDefined();
  });

  // â”€â”€ TAXABLE-preferred class must not be used as compensating Y â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Setup: taxable holds LC (overweight) + FI; 401k holds LC + FI.
  // FI target is 60% â€” greedyPlace routes all $180k FI to taxable (fits within
  // the $200k taxable capacity). The taxable LC surplus ($130k) wouldâ€”without the
  // guardâ€”be redirected using FI as the compensating Y class, pushing $100k of FI
  // into the 401k and leaving taxable with only $30k of FI. The guard must prevent
  // FI from ever being used as Y because its primary placement preference is TAXABLE.
  it('FI-as-Y guard: FIXED_INCOME never used as redirect compensator', () => {
    const accts: Account[] = [
      { id: 'taxable', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
      { id: 'k401',    name: '401k',   institution: 'Empower', type: 'FOUR_OH_ONE_K',
        allowedAssetClasses: ['US_LARGE_CAP', 'FIXED_INCOME'] as AssetClass[] },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'FXAIX', marketValue: 150_000 }, // US_LARGE_CAP
      { accountId: 'taxable', ticker: 'MUNY',  marketValue:  50_000 }, // FIXED_INCOME
      { accountId: 'k401',    ticker: 'FXAIX', marketValue:  50_000 }, // US_LARGE_CAP
      { accountId: 'k401',    ticker: 'FXNAX', marketValue:  50_000 }, // FIXED_INCOME
    ];
    // Total $300k. Target: 40% LC ($120k), 60% FI ($180k).
    // Placement: FI â†’ TAXABLE only; LC â†’ TAX_ADVANTAGED first.
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.4, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.6, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accts, positions, strategy);

    // FI buy must land in taxable â€” not in the 401k.
    const taxableFiBuy = tradeFor(r.trades, 'taxable', 'FIXED_INCOME');
    expect(taxableFiBuy).toBeDefined();
    expect(taxableFiBuy!.deltaUsd).toBeGreaterThan(0);

    // 401k must not buy FI. It may sell its existing position (delta < 0) or have no trade.
    // A positive delta means FI was incorrectly swapped into the 401k as compensating Y.
    const k401FiTrade = tradeFor(r.trades, 'k401', 'FIXED_INCOME');
    expect(k401FiTrade?.deltaUsd ?? -1).toBeLessThan(0);

    // Projected weights must still reach targets despite the constrained redirect.
    expect(r.projectedWeights.FIXED_INCOME).toBeCloseTo(0.6, 2);
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.4, 2);

    // Per-account net = 0 (no new cash).
    expect(near(accountSum(r.trades, 'taxable'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),    0, 2)).toBe(true);
  });

  // â”€â”€ invariants survive redirect â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('multi-account net-zero preserved across all accounts after redirect', () => {
    const accounts: Account[] = [
      { id: 'taxable', name: 'Taxable', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'tira',    name: 'Trad IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
      { id: 'roth',    name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA'        },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'FXAIX', marketValue:  50_000 },  // LC
      { accountId: 'tira',    ticker: 'FXAIX', marketValue: 100_000 },  // LC
      { accountId: 'tira',    ticker: 'MUNY',  marketValue:  50_000 },  // FI
      { accountId: 'roth',    ticker: 'FXAIX', marketValue:  75_000 },  // LC
      { accountId: 'roth',    ticker: 'MUNY',  marketValue:  25_000 },  // FI
    ];
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.6, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.4, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accounts, positions, strategy);
    expect(near(accountSum(r.trades, 'taxable'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'tira'),    0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),    0, 2)).toBe(true);
    // Projected weights must still match targets.
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.6, 2);
    expect(r.projectedWeights.FIXED_INCOME).toBeCloseTo(0.4, 2);
  });
});

// â”€â”€â”€ backlog #17 â€” account-count minimization (concentrate-then-spill) â”€â”€â”€â”€â”€â”€â”€â”€
//
// greedyPlace now fills the largest-capacity eligible account first, spilling to
// additional accounts only when the first is exhausted.  Proportional spreading
// across all same-bucket accounts is replaced by this "waterfall" logic.

describe('Goal 11: account-count minimization â€” concentrate-then-spill (backlog #17)', () => {
  // â”€â”€ single-account fill â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // 401k ($500k) and IRA ($300k) are both TAX_ADVANTAGED.  ALTERNATIVES target
  // is $25k â€” easily fits inside either account alone.  The engine should send
  // it entirely to the larger account (401k) and leave IRA untouched for ALTS.
  it('small ALTERNATIVES sleeve fits in one account â€” IRA receives no ALTS', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'ira',  'ALTERNATIVES')).toBeUndefined();
  });

  // â”€â”€ per-account balance still preserved â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('account totals still match newCash after concentrate-then-spill', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });

  // â”€â”€ spill fires when single account is insufficient â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // US_LARGE_CAP target ($385k) > 401k remaining capacity after prior fills,
  // so it spills to IRA.  Verify that the two accounts together receive the
  // full LC target and the capacity invariant holds.
  it('US_LARGE_CAP spills to IRA after k401 is partially filled', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const k401Lc = tradeFor(r.trades, 'k401', 'US_LARGE_CAP')?.deltaUsd ?? 0;
    const iraLc  = tradeFor(r.trades, 'ira',  'US_LARGE_CAP')?.deltaUsd ?? 0;
    // Combined LC allocation must equal the target ($385k scaled to free capacity).
    // (greenfield â‡’ scale = 1, total = $385k)
    expect(near(k401Lc + iraLc, 385_000, 2)).toBe(true);
    // IRA receives the larger LC share: by the time LC is placed, k401 has already
    // absorbed ALTS + EMINTL + DEVINTL ($225k), leaving it with $275k â€” less than
    // IRA's untouched $300k â€” so IRA is filled first and gets the bulk of LC.
    expect(iraLc).toBeGreaterThan(k401Lc);
  });

  // â”€â”€ three TA accounts â€” fills cascade from largest to smallest â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('three TA accounts: ALTS fills largest first, never touches smallest', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab',  institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'big',    name: 'Big IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 600_000 },
      { id: 'mid',    name: 'Mid 401', institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 150_000 },
      { id: 'tiny',   name: 'Tiny Roth', institution: 'Fidelity', type: 'ROTH_IRA',       newCash:  50_000 },
    ];
    // ALTS target = 2.5% Ã— $1M = $25k.  big IRA ($600k) absorbs it all.
    // Pin ALTS to the broad tax-advantaged bucket so this exercises capacity ordering
    // (Goal 11), not the issue-#89 asset-location default (which prefers the Roth).
    const strategy: Strategy = {
      ...ZERO_TOL_STRATEGY,
      placement: { ...ZERO_TOL_STRATEGY.placement, ALTERNATIVES: ['TAX_ADVANTAGED'] },
    };
    const r = rebalance(accounts, NO_POSITIONS, strategy);
    expect(tradeFor(r.trades, 'big',  'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'mid',  'ALTERNATIVES')).toBeUndefined();
    expect(tradeFor(r.trades, 'tiny', 'ALTERNATIVES')).toBeUndefined();
    // Balance invariants.
    expect(near(accountSum(r.trades, 'big'),  600_000)).toBe(true);
    expect(near(accountSum(r.trades, 'mid'),  150_000)).toBe(true);
    expect(near(accountSum(r.trades, 'tiny'),  50_000)).toBe(true);
  });

  // â”€â”€ concentrateClasses accounts still get priority within their group â”€â”€â”€â”€â”€â”€
  // This verifies that the existing concentrateClasses feature interacts
  // correctly with the new concentrate-then-spill logic: a designated account
  // still wins even if a larger non-designated account exists.
  it('concentrateClasses account takes ALTS before a larger plain account', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab',       institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'big',    name: 'Big IRA',      institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 700_000 },
      { id: 'roth',   name: 'Roth IRA',     institution: 'Fidelity', type: 'ROTH_IRA',         newCash: 100_000,
        concentrateClasses: ['ALTERNATIVES'] as AssetClass[] },
    ];
    // ALTS target = $25k.  Roth (smaller, $100k) is the concentrate account and
    // wins over big IRA ($700k).
    const r = rebalance(accounts, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'roth', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'big',  'ALTERNATIVES')).toBeUndefined();
    // Balance invariants.
    expect(near(accountSum(r.trades, 'big'),  700_000)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'), 100_000)).toBe(true);
  });
});

// â”€â”€â”€ backlog #16 â€” trade-count minimization (post-placement consolidation) â”€â”€â”€â”€
//
// After all trades are balanced, the engine greedily drops small trades whose
// removal (plus a compensating adjustment to the opposite-sign partner trade in
// the same account) keeps every asset-class projected weight within toleranceAbs.

describe('Goal 10: trade-count minimization â€” drop marginal trades (backlog #16)', () => {
  // â”€â”€ small-account pair collapses when both classes stay within tolerance â”€â”€â”€
  //
  // Portfolio:
  //   A1 (TAX_ADVANTAGED, $900k): LC $780k, FI $120k
  //   A2 (TAX_ADVANTAGED, $100k): LC $80k,  FI $20k
  //   Household $1M. Target: LC 70%, FI 30%. toleranceAbs = 5%.
  //
  // Trades before minimization:
  //   A1: sell LC $100k, buy FI $100k        (needed â€” 8% drift)
  //   A2: sell LC $10k,  buy FI $10k         (marginal)
  //
  // Dropping A2 buy FI (+$10k) â†’ projected FI = 31% (within 5% of 30%).
  //   Compensation: shrink A2 sell LC from -$10k to $0 â†’ projected LC = 69% (within 5%).
  // Both checks pass â†’ both A2 trades are eliminated.

  const A1A2_ACCOUNTS: Account[] = [
    { id: 'a1', name: 'A1', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    { id: 'a2', name: 'A2', institution: 'Fidelity', type: 'ROTH_IRA'        },
  ];
  const A1A2_POSITIONS: Position[] = [
    { accountId: 'a1', ticker: 'FXAIX', marketValue: 780_000 },  // US_LARGE_CAP
    { accountId: 'a1', ticker: 'MUNY',  marketValue: 120_000 },  // FIXED_INCOME
    { accountId: 'a2', ticker: 'FXAIX', marketValue:  80_000 },  // US_LARGE_CAP
    { accountId: 'a2', ticker: 'MUNY',  marketValue:  20_000 },  // FIXED_INCOME
  ];
  const LC70_FI30_STRATEGY = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.7, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.3, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0.05,  // 5% band â€” both A2 trades end up within it after compensation
    minTradeUsd: 0,
  };

  it('A2 trades are eliminated when both classes stay within 5% tolerance', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    // A2's small trades should be gone.
    expect(r.trades.filter(t => t.accountId === 'a2')).toHaveLength(0);
  });

  it('A1 trades survive (large correction still required)', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    expect(tradeFor(r.trades, 'a1', 'US_LARGE_CAP')).toBeDefined();
    expect(tradeFor(r.trades, 'a1', 'FIXED_INCOME')).toBeDefined();
  });

  it('projected weights stay within toleranceAbs after minimization', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    expect(Math.abs(r.projectedWeights.US_LARGE_CAP - 0.7)).toBeLessThanOrEqual(0.05 + 0.001);
    expect(Math.abs(r.projectedWeights.FIXED_INCOME  - 0.3)).toBeLessThanOrEqual(0.05 + 0.001);
  });

  it('per-account net = 0 after minimization (no new cash)', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    expect(near(accountSum(r.trades, 'a1'), 0, 1)).toBe(true);
    expect(near(accountSum(r.trades, 'a2'), 0, 1)).toBe(true);
  });

  // â”€â”€ zero-tolerance disables minimization â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // With toleranceAbs = 0 every trade is needed to hit exact targets.
  it('does NOT drop trades when toleranceAbs = 0', () => {
    const strictStrategy = { ...LC70_FI30_STRATEGY, toleranceAbs: 0 };
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, strictStrategy);
    // Both accounts should still have trades (A2 has $10k drift that must be corrected).
    expect(r.trades.filter(t => t.accountId === 'a2').length).toBeGreaterThan(0);
  });

  // â”€â”€ trade too large to drop stays â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // If dropping a trade would push projected weight beyond toleranceAbs, it must
  // be kept regardless of its size.
  it('does NOT drop A1 trades â€” removal would breach tolerance', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    // A1 has $100k sell of LC ($780kâ†’$700k target). Without it, LC projected â‰ˆ 78%,
    // which is 8% away from the 70% target â€” outside the 5% band.
    const a1LcSell = tradeFor(r.trades, 'a1', 'US_LARGE_CAP');
    expect(a1LcSell).toBeDefined();
    expect(Math.abs(a1LcSell!.deltaUsd)).toBeGreaterThan(50_000);
  });

  // â”€â”€ no compensating trade â†’ cannot drop â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // When all trades in an account have the same sign (pure contribution deployment),
  // there is nothing to compensate with so no trade can be dropped.
  it('does not drop trades when the account has no opposite-sign partner', () => {
    // Greenfield: all trades are buys (deploying newCash).  Nothing can be dropped.
    const accounts: Account[] = [
      { id: 'ira',  name: 'IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 800_000 },
      { id: 'tiny', name: 'Tiny', institution: 'Fidelity', type: 'ROTH_IRA',         newCash:  10_000 },
    ];
    const r = rebalance(accounts, NO_POSITIONS, { ...LC70_FI30_STRATEGY, toleranceAbs: 0.05 });
    // Tiny account still receives at least one trade (its newCash must go somewhere).
    expect(r.trades.filter(t => t.accountId === 'tiny').length).toBeGreaterThan(0);
    // All account nets equal newCash (no dropped-trade imbalance).
    expect(near(accountSum(r.trades, 'ira'),  800_000, 10)).toBe(true);
    expect(near(accountSum(r.trades, 'tiny'),  10_000, 10)).toBe(true);
  });
});

// â”€â”€â”€ post-trade accuracy â€” stress scenarios â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// These tests verify the end-to-end invariant: projectedWeights for every
// out-of-tolerance class must land within toleranceAbs of the target after trades,
// and the PROJECTED_OFF_TARGET flag must fire whenever a hard constraint prevents
// that.  They complement the unit tests above by exercising full pipelines
// (placement â†’ trades â†’ minimization â†’ Step 11 validation) under varied stress.

// Shared helper: assert every OOT class projects within strategy.toleranceAbs,
// and that no PROJECTED_OFF_TARGET flags were emitted.
function assertAllOnTarget(
  r: ReturnType<typeof rebalance>,
  strategy: { targets: Record<AssetClass, number>; toleranceAbs: number },
) {
  const tol = strategy.toleranceAbs + 0.001; // tiny rounding buffer
  for (const ac of ALL_ASSET_CLASSES) {
    const tgt = strategy.targets[ac] ?? 0;
    // Only check OOT classes â€” within-tolerance classes intentionally stay at current.
    const isWithinTolNow =
      Math.abs(r.currentWeights[ac] - tgt) <= strategy.toleranceAbs;
    if (isWithinTolNow) continue;
    expect(
      Math.abs(r.projectedWeights[ac] - tgt),
      `${ac}: projected ${(r.projectedWeights[ac] * 100).toFixed(2)}% should be within ` +
      `${(strategy.toleranceAbs * 100).toFixed(1)}% of target ${(tgt * 100).toFixed(2)}%`,
    ).toBeLessThanOrEqual(tol);
  }
  expect(
    r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET'),
    'expected no PROJECTED_OFF_TARGET flags',
  ).toHaveLength(0);
}

describe('Goal 4: post-trade accuracy â€” stress scenarios', () => {
  // â”€â”€ S1: large single-class imbalance, 3 unconstrained accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Portfolio holds only SPY (US Large Cap). Every other class needs to be bought
  // from scratch. Verifies the full household rebalance reaches every target.
  it('S1: large single-class imbalance â€” all OOT classes reach target', () => {
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K'   },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'FXAIX', marketValue: 200_000 },
      { accountId: 'ira',    ticker: 'FXAIX', marketValue: 400_000 },
      { accountId: 'k401',   ticker: 'FXAIX', marketValue: 400_000 },
    ];
    const strategy = { ...ZERO_TOL_STRATEGY, toleranceAbs: 0.01 };
    assertAllOnTarget(rebalance(accts, positions, strategy), strategy);
  });

  // â”€â”€ S2: multi-class drift across 5 accounts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Each account holds exactly one asset class that is not its preferred home.
  // Full rebalance must correctly swap assets across account boundaries.
  it('S2: multi-class drift across 5 accounts â€” all OOT classes within 1% after trades', () => {
    const accts: Account[] = [
      { id: 't1', name: 'Taxable 1', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 't2', name: 'Taxable 2', institution: 'Fidelity', type: 'TAXABLE'         },
      { id: 'ir', name: 'Trad IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
      { id: 'ro', name: 'Roth IRA',  institution: 'Fidelity', type: 'ROTH_IRA'        },
      { id: 'k4', name: '401k',      institution: 'Empower',  type: 'FOUR_OH_ONE_K'   },
    ];
    const positions: Position[] = [
      // Taxable: heavy equity (wrong bucket) and no fixed income
      { accountId: 't1', ticker: 'FXAIX', marketValue: 120_000 },  // LC
      { accountId: 't2', ticker: 'FXAIX', marketValue:  80_000 },  // LC
      // TA accounts: all US Large Cap, need redistribution to intl + alts + FI
      { accountId: 'ir', ticker: 'FXAIX', marketValue: 280_000 },
      { accountId: 'ro', ticker: 'FXAIX', marketValue: 120_000 },
      { accountId: 'k4', ticker: 'FXAIX', marketValue: 400_000 },
    ];
    const strategy = { ...ZERO_TOL_STRATEGY, toleranceAbs: 0.01 };
    assertAllOnTarget(rebalance(accts, positions, strategy), strategy);
  });

  // â”€â”€ S3: greenfield with spillover â€” targets still met despite non-preferred placement
  it('S3: placement spillover (taxable > FI target) â€” no PROJECTED_OFF_TARGET', () => {
    // Taxable = 30% of household, FI target = 20% â†’ equities spill into taxable, but all class targets are still reachable.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 300_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 400_000 },
    ];
    const strategy = { ...ZERO_TOL_STRATEGY, toleranceAbs: 0.01 };
    const r = rebalance(accts, NO_POSITIONS, strategy);
    assertAllOnTarget(r, strategy);
  });

  // â”€â”€ S4: NO_ELIGIBLE_ACCOUNT â†’ PROJECTED_OFF_TARGET fires for constrained class
  it('S4: NO_ELIGIBLE_ACCOUNT â€” PROJECTED_OFF_TARGET fires for the blocked class', () => {
    // Single IRA that explicitly excludes ALTERNATIVES.
    // ALTERNATIVES (target 8%) cannot be placed anywhere â†’ NO_ELIGIBLE_ACCOUNT.
    // Step 7.5 gap-fill then redistributes the unplaceable $80k back to the
    // account's existing OOT holdings (LC, DEVINTL, FI) proportionally to keep
    // the account balanced. Those classes end up above their own targets too, so
    // PROJECTED_OFF_TARGET fires for all affected classes â€” not just ALTS.
    const accts: Account[] = [{
      id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA',
      allowedAssetClasses: ['US_LARGE_CAP', 'DEVELOPED_INTL', 'FIXED_INCOME'] as AssetClass[],
    }];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 600_000 },  // LC
      { accountId: 'ira', ticker: 'FZILX', marketValue: 200_000 },  // DEVINTL
      { accountId: 'ira', ticker: 'MUNY',  marketValue: 200_000 },  // FI
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.55, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.25, EMERGING_INTL: 0, FIXED_INCOME: 0.12, ALTERNATIVES: 0.08, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
    };
    const r = rebalance(accts, positions, strategy);

    // ALTS is the primary constrained class.
    expect(r.flags.some(f => f.kind === 'NO_ELIGIBLE_ACCOUNT' && f.assetClass === 'ALTERNATIVES')).toBe(true);
    expect(r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'ALTERNATIVES')).toBe(true);

    // Every PROJECTED_OFF_TARGET flag must be accurate: the stated projectedWeight
    // must match what the engine actually computed, and the deviation must genuinely
    // exceed toleranceAbs (no false positives).
    for (const flag of r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')) {
      if (flag.kind !== 'PROJECTED_OFF_TARGET') continue;
      expect(flag.projectedWeight).toBeCloseTo(r.projectedWeights[flag.assetClass], 6);
      expect(Math.abs(flag.projectedWeight - flag.targetWeight)).toBeGreaterThan(strategy.toleranceAbs);
    }

    // Classes with no PROJECTED_OFF_TARGET flag must be within tolerance.
    for (const ac of ALL_ASSET_CLASSES) {
      const tgt = strategy.targets[ac] ?? 0;
      const hasPOT = r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === ac);
      const withinNow = Math.abs(r.currentWeights[ac] - tgt) <= strategy.toleranceAbs;
      if (!hasPOT && !withinNow) {
        expect(Math.abs(r.projectedWeights[ac] - tgt)).toBeLessThanOrEqual(strategy.toleranceAbs + 0.001);
      }
    }
  });

  // â”€â”€ S5: locked position below target â€” must reach target (regression for fix) â”€
  it('S5: locked position below target â€” projected reaches target, no PROJECTED_OFF_TARGET', () => {
    // IRA holds $60k of DEVINTL locked + $540k of LC. Taxable has $200k FI.
    // DEVINTL target 20% of $800k = $160k. $60k is locked; engine must buy $100k more.
    // Old bug: engine would over-buy DEVINTL by the locked amount ($60k), giving 27.5% not 20%.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'ira',    ticker: 'FZILX', marketValue:  60_000, locked: true },
      { accountId: 'ira',    ticker: 'FXAIX', marketValue: 540_000 },
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.55, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.20, EMERGING_INTL: 0, FIXED_INCOME: 0.20, ALTERNATIVES: 0.05, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
    };
    assertAllOnTarget(rebalance(accts, positions, strategy), strategy);
  });

  // â”€â”€ S6: locked position exceeds target â†’ PROJECTED_OFF_TARGET fires â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('S6: locked position above target â€” PROJECTED_OFF_TARGET fires for that class', () => {
    // IRA has $250k DEVINTL locked (25% of $1M). Target is 10%. Cannot reduce.
    // After trades: DEVINTL projected â‰¥ 25% >> 10% target.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K'   },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
      { accountId: 'ira',    ticker: 'FZILX', marketValue: 250_000, locked: true },  // DEVINTL, locked
      { accountId: 'ira',    ticker: 'FXAIX', marketValue: 250_000 },
      { accountId: 'k401',   ticker: 'FXAIX', marketValue: 300_000 },
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.50, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.10, EMERGING_INTL: 0, FIXED_INCOME: 0.25, ALTERNATIVES: 0.15, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
    };
    const r = rebalance(accts, positions, strategy);

    const devFlag = r.flags.find(
      f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'DEVELOPED_INTL',
    );
    expect(devFlag).toBeDefined();
    // Projected must be above target (locked enforces a floor above target).
    expect(r.projectedWeights.DEVELOPED_INTL).toBeGreaterThan(0.10);
    // The flag captures the actual projected and target values.
    if (devFlag?.kind === 'PROJECTED_OFF_TARGET') {
      expect(devFlag.projectedWeight).toBeCloseTo(r.projectedWeights.DEVELOPED_INTL, 4);
      expect(devFlag.targetWeight).toBe(0.10);
    }
  });

  // -- S7: minTradeUsd larger than the needed trade -> drift tolerated, no flag -----
  it('S7: minTradeUsd larger than the needed trade -- residual drift is tolerated, no PROJECTED_OFF_TARGET', () => {
    // $10k portfolio; LC needs a $500 sell, FI a $500 buy. minTradeUsd = $1000, so
    // both trades fall below the threshold and are filtered out. Because the user has
    // opted out of trades smaller than $1000, the residual <$1000 drift is not
    // actionable and is tolerated rather than flagged (issue #57). |50% - 55%| = 5%
    // exceeds the 0% tolerance band, but the $500 dollar gap is below minTradeUsd.
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 5_500 },  // LC -- 55%, target 50%
      { accountId: 'ira', ticker: 'MUNY',  marketValue: 4_500 },  // FI -- 45%, target 50%
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 1_000,  // $500 trades are filtered out
    };
    const r = rebalance(accts, positions, strategy);
    expect(r.trades).toHaveLength(0);  // both trades suppressed
    // The drift each class would need to close ($500) is below minTradeUsd, so the
    // engine cannot act on it and does not flag it.
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  // â”€â”€ S8: locked account â€” unlocked accounts reach target, locked stays put â”€â”€â”€â”€â”€
  it('S8: locked account â€” unlocked accounts trade to target; locked account untouched', () => {
    // IRA is locked (whole account). 401k and taxable handle all trades.
    // IRA's holdings still count in household weights but create no trades.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
    ];
    const positions: Position[] = [
      // Locked IRA holds a fixed-income slug that skews the household baseline.
      { accountId: 'ira', ticker: 'MUNY', marketValue: 150_000 },
    ];
    const strategy = { ...ZERO_TOL_STRATEGY, toleranceAbs: 0.01 };
    const r = rebalance(accts, positions, strategy);

    // No trades for the locked account.
    expect(r.trades.filter(t => t.accountId === 'ira')).toHaveLength(0);
    // Projected weights must account for the locked IRA FI position being immovable.
    // Given it's locked below its target portion, the unlocked accounts compensate.
    // All unconstrained OOT classes should be within 1% after trades.
    for (const ac of ALL_ASSET_CLASSES) {
      const withinNow = Math.abs(r.currentWeights[ac] - strategy.targets[ac]) <= strategy.toleranceAbs;
      if (withinNow) continue;
      expect(
        Math.abs(r.projectedWeights[ac] - strategy.targets[ac]),
        `${ac} projected off target`,
      ).toBeLessThanOrEqual(strategy.toleranceAbs + 0.001);
    }
    expect(r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET')).toHaveLength(0);
  });

  // â”€â”€ S9: PROJECTED_OFF_TARGET values are accurate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  it('S9: PROJECTED_OFF_TARGET carries correct projectedWeight and targetWeight', () => {
    // Reproduce S4 minimal case; verify flag fields round-trip correctly.
    const accts: Account[] = [{
      id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA',
      allowedAssetClasses: ['US_LARGE_CAP', 'FIXED_INCOME'] as AssetClass[],
    }];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 800_000 },
      { accountId: 'ira', ticker: 'MUNY',  marketValue: 200_000 },
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.7, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.2, ALTERNATIVES: 0.1, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
    };
    const r = rebalance(accts, positions, strategy);
    const flag = r.flags.find(
      f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'ALTERNATIVES',
    );
    expect(flag).toBeDefined();
    if (flag?.kind === 'PROJECTED_OFF_TARGET') {
      expect(flag.projectedWeight).toBeCloseTo(r.projectedWeights.ALTERNATIVES, 6);
      expect(flag.targetWeight).toBe(0.1);
      // Projected must be below target (can't buy ALTS â€” below target, not above).
      expect(flag.projectedWeight).toBeLessThan(flag.targetWeight);
    }
  });
});

// â”€â”€â”€ "No preference" placement (issue #21) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// An empty bucket list for a class means it has no required home. The greedy fill
// places it wherever capacity is largest, across any account type, and treats those
// placements as intentional â€” no PLACEMENT_SPILLOVER is emitted. A no-preference
// class is the least constrained, so it is placed *after* classes with a required
// home.

describe('Goal 6: no-preference placement â€” empty bucket list', () => {
  it('places a no-preference class by capacity, largest account first, with no spillover flag', () => {
    // LC has no preference; taxable ($700k) is larger than the IRA ($300k).
    // Under a normal TAX_ADVANTAGED-first rule, LC would fill the IRA first and the
    // $700k taxable portion would be flagged as spillover. With no preference, the
    // largest account is simply filled first and nothing is flagged.
    const accts: Account[] = [
      { id: 'taxable', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 700_000 },
      { id: 'ira',     name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    ];
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 1.0, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      placement: { ...DEFAULT_STRATEGY.placement, US_LARGE_CAP: [] },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accts, NO_POSITIONS, strategy);

    expect(tradeFor(r.trades, 'taxable', 'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(700_000, 0);
    expect(tradeFor(r.trades, 'ira',     'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(300_000, 0);
    expect(r.flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER')).toHaveLength(0);
  });

  it('a no-preference class is placed after classes with a required home', () => {
    // FI is restricted to TAXABLE; LC has no preference. Both target 50% of $1M.
    // Correct order places FI first (it claims the only taxable account), leaving the
    // IRA for LC. If LC (no preference, largest-first) were placed first it would grab
    // the taxable account and strand FI with no eligible home.
    const accts: Account[] = [
      { id: 'taxable', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 500_000 },
      { id: 'ira',     name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 500_000 },
    ];
    const strategy: Strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      placement: { ...DEFAULT_STRATEGY.placement, FIXED_INCOME: ['TAXABLE'], US_LARGE_CAP: [] },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accts, NO_POSITIONS, strategy);

    expect(tradeFor(r.trades, 'taxable', 'FIXED_INCOME')?.deltaUsd).toBeCloseTo(500_000, 0);
    expect(tradeFor(r.trades, 'ira',     'US_LARGE_CAP')?.deltaUsd).toBeCloseTo(500_000, 0);
    expect(r.flags.filter(f => f.kind === 'NO_ELIGIBLE_ACCOUNT')).toHaveLength(0);
    expect(r.flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER')).toHaveLength(0);
  });

  it('still emits NO_ELIGIBLE_ACCOUNT when a no-preference class cannot be placed anywhere', () => {
    // The only account restricts itself to FIXED_INCOME, so a no-preference LC target
    // has nowhere to land. Relaxing the placement preference does not relax the hard
    // per-account eligibility constraint.
    const accts: Account[] = [{
      id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA',
      newCash: 100_000, allowedAssetClasses: ['FIXED_INCOME'] as AssetClass[],
    }];
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 1.0, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      placement: { ...DEFAULT_STRATEGY.placement, US_LARGE_CAP: [] },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accts, NO_POSITIONS, strategy);

    const flag = r.flags.find(f => f.kind === 'NO_ELIGIBLE_ACCOUNT' && f.assetClass === 'US_LARGE_CAP');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'NO_ELIGIBLE_ACCOUNT' && flag.amountUsd).toBeCloseTo(100_000, 0);
  });
});

// â”€â”€â”€ Contribution-first funding summary (issue #3) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Reporting: contributionSummary', () => {
  it('is all zeros for an empty portfolio', () => {
    const r = rebalance([], [], DEFAULT_STRATEGY);
    expect(r.contributionSummary).toEqual({ newCashDeployed: 0, buysUsd: 0, sellsUsd: 0, withdrawalRaised: 0 });
  });

  it('counts new contributions as rebalanced-with-new-money', () => {
    const accounts: Account[] = [
      { id: 'a1', name: 'Taxable', institution: 'X', type: 'TAXABLE', newCash: 5_000 },
    ];
    const positions: Position[] = [{ accountId: 'a1', ticker: 'VOO', marketValue: 10_000 }];
    const cs = rebalance(accounts, positions, DEFAULT_STRATEGY).contributionSummary;
    expect(cs.newCashDeployed).toBeGreaterThan(0);
    // buys = sells + newCashDeployed (per-account net flow equals new cash).
    expect(cs.buysUsd).toBeCloseTo(cs.sellsUsd + cs.newCashDeployed, 2);
  });

  it('attributes a no-new-cash rebalance entirely to sales', () => {
    const accounts: Account[] = [
      { id: 'taxable', name: 'Taxable', institution: 'X', type: 'TAXABLE' },
      { id: 'ira',     name: 'IRA',     institution: 'X', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'VOO', marketValue: 60_000 },
      { accountId: 'ira',     ticker: 'BND', marketValue: 40_000 },
    ];
    const cs = rebalance(accounts, positions, DEFAULT_STRATEGY).contributionSummary;
    expect(cs.sellsUsd).toBeGreaterThan(0);
    // With no new cash, buys are fully funded by sells.
    expect(cs.newCashDeployed).toBeLessThan(1);
    expect(cs.buysUsd).toBeCloseTo(cs.sellsUsd, 2);
  });

  it('treats a cash position reduction as free cash, not a sale (issue #56)', () => {
    // Single taxable account holding only SPAXX; target is 100% FIXED_INCOME.
    // The engine sells the CASH position and buys FIXED_INCOME — net account flow is
    // zero (no new contribution). After the fix, CASH sells are excluded from sellsUsd
    // and appear in newCashDeployed instead.
    const accounts: Account[] = [
      { id: 'taxable', name: 'Taxable', institution: 'X', type: 'TAXABLE' },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'SPAXX', marketValue: 100_000 },
    ];
    const targets = Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, ac === 'FIXED_INCOME' ? 1.0 : 0.0]),
    ) as Record<AssetClass, number>;
    const strategy: Strategy = { ...DEFAULT_STRATEGY, targets, toleranceAbs: 0 };
    const r = rebalance(accounts, positions, strategy);
    const cashSell = r.trades.find(t => t.assetClass === 'CASH' && t.deltaUsd < 0);
    expect(cashSell).toBeDefined();
    // CASH sell is free cash — it should NOT count as sellsUsd.
    expect(r.contributionSummary.sellsUsd).toBeCloseTo(0, 0);
    // Instead it shows up as new/free cash deployed.
    expect(r.contributionSummary.newCashDeployed).toBeCloseTo(100_000, -2);
  });
});

// â”€â”€â”€ Tax-advantaged-first rebalancing toggle (issue #4) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 6: tax-advantaged-first rebalancing', () => {
  // Reuses the step 7.7 fully-redirectable scenario: taxable $60k large-cap +
  // Roth $80k large-cap + $60k fixed income, with a 50/50 LC/FI target.
  const ACCOUNTS: Account[] = [
    { id: 'taxable', name: 'Schwab',   institution: 'Schwab',   type: 'TAXABLE'  },
    { id: 'roth',    name: 'Roth IRA', institution: 'Fidelity', type: 'ROTH_IRA' },
  ];
  const POSITIONS: Position[] = [
    { accountId: 'taxable', ticker: 'FXAIX', marketValue: 60_000 },
    { accountId: 'roth',    ticker: 'FXAIX', marketValue: 80_000 },
    { accountId: 'roth',    ticker: 'MUNY',  marketValue: 60_000 },
  ];
  const STRAT: Strategy = {
    ...DEFAULT_STRATEGY,
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    toleranceAbs: 0,
    minTradeUsd: 0,
  };

  const taxableSold = (flags: ReturnType<typeof rebalance>['flags']) =>
    flags.reduce((s, f) => s + (f.kind === 'TAXABLE_SALE' ? f.amountUsd : 0), 0);

  it('default (preference on) redirects the equity sell â€” no taxable sale, no avoidable flag', () => {
    const r = rebalance(ACCOUNTS, POSITIONS, STRAT);
    expect(taxableSold(r.flags)).toBe(0);
    expect(r.flags.some(f => f.kind === 'TAXABLE_REBALANCE_AVOIDABLE')).toBe(false);
  });

  it('disabling the preference produces a taxable sale and flags it as avoidable', () => {
    const r = rebalance(ACCOUNTS, POSITIONS, { ...STRAT, preferTaxAdvantagedRebalance: false });
    expect(taxableSold(r.flags)).toBeGreaterThan(0);
    expect(r.flags.some(f => f.kind === 'TAXABLE_REBALANCE_AVOIDABLE')).toBe(true);
  });

  it('never sells more in taxable with the preference on than off', () => {
    const on  = rebalance(ACCOUNTS, POSITIONS, { ...STRAT, preferTaxAdvantagedRebalance: true });
    const off = rebalance(ACCOUNTS, POSITIONS, { ...STRAT, preferTaxAdvantagedRebalance: false });
    expect(taxableSold(on.flags)).toBeLessThanOrEqual(taxableSold(off.flags) + 1e-6);
  });
});

// â”€â”€â”€ Blended-fund composite sells (issue #40) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// A blended fund (TDF, balanced fund) is a single position whose composition is
// fixed â€” selling N% of it sells N% of every sub-class proportionally. Before
// #40 the engine treated all decomposed positions as frozen; now they are
// sellable as a whole, with Step 8.7 enforcing the proportionality constraint
// and routing compensating buys to keep per-account net invariants intact.

describe('Goal 4: blended-fund sells â€” issue #40', () => {
  // 60% US large cap, 30% INTL developed, 10% fixed income.
  const TDF_DECOMP = {
    US_LARGE_CAP:   0.60,
    DEVELOPED_INTL: 0.30,
    FIXED_INCOME:   0.10,
  };
  const TDF: Record<string, typeof TDF_DECOMP> = { FDKLX: TDF_DECOMP };

  // No-frills strategy: only large-cap, INTL, and FI. No targets to over-spec.
  const SIMPLE_STRAT: Strategy = {
    targets: { ...ZERO_TARGETS,
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.60, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL:  0.30, EMERGING_INTL: 0,
      FIXED_INCOME:    0.10, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
    },
    placement: fillPlacement({
      FIXED_INCOME:    ['TAXABLE'],
      ALTERNATIVES:    ['TAX_ADVANTAGED'],
      CASH:            ['TAXABLE', 'TAX_ADVANTAGED'],
    }),
    toleranceAbs: 0,
    minTradeUsd:  0,
  };

  describe('drawdown â€” TDF-only 401k funds an RMD', () => {
    // A 401k holding only FDKLX. An RMD is due. The engine must sell FDKLX
    // proportionally to raise the cash â€” pre-#40 this was impossible because
    // decomposed funds were excluded from sellable.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', rmdDueUsd: 10_000 },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('raises the RMD via a proportional sale of the blended fund', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      expect(near(r.withdrawalByAccount['k401'] ?? 0, 10_000, 200)).toBe(true);
      expect(near(accountSum(r.trades, 'k401'), -10_000, 200)).toBe(true);
    });

    it('emits sells across every sub-class of the fund, all forced to its ticker', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const sells = r.trades.filter(t => t.accountId === 'k401' && t.deltaUsd < 0);
      const subClasses = new Set(sells.map(t => t.assetClass));
      expect(subClasses.has('US_LARGE_CAP')).toBe(true);
      expect(subClasses.has('DEVELOPED_INTL')).toBe(true);
      expect(subClasses.has('FIXED_INCOME')).toBe(true);
      // Every sell ought to be pinned to the blended fund.
      for (const s of sells) expect(s.forceTicker).toBe('FDKLX');
    });

    it('per-sub-class sell amounts respect the 60/30/10 composition', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const usSell = r.trades
        .filter(t => t.accountId === 'k401' && t.assetClass === 'US_LARGE_CAP' && t.deltaUsd < 0)
        .reduce((s, t) => s + -t.deltaUsd, 0);
      const intlSell = r.trades
        .filter(t => t.accountId === 'k401' && t.assetClass === 'DEVELOPED_INTL' && t.deltaUsd < 0)
        .reduce((s, t) => s + -t.deltaUsd, 0);
      const fiSell = r.trades
        .filter(t => t.accountId === 'k401' && t.assetClass === 'FIXED_INCOME' && t.deltaUsd < 0)
        .reduce((s, t) => s + -t.deltaUsd, 0);
      const total = usSell + intlSell + fiSell;
      expect(usSell / total).toBeCloseTo(0.60, 2);
      expect(intlSell / total).toBeCloseTo(0.30, 2);
      expect(fiSell / total).toBeCloseTo(0.10, 2);
    });
  });

  describe('drift within tolerance â€” blended fund untouched', () => {
    // Household is already at target (FDKLX's 60/30/10 split lines up exactly
    // with the strategy). No drift, no trades, no fund disturbance â€” the
    // tolerance band naturally protects the fund when there's nothing to fix.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K' },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];
    const STRAT_WITH_TOL: Strategy = { ...SIMPLE_STRAT, toleranceAbs: 0.05 };

    it('does not touch the fund when drift is within tolerance', () => {
      const r = rebalance(accts, positions, STRAT_WITH_TOL, {}, TDF, 0, 0);
      expect(r.trades.filter(t => t.forceTicker === 'FDKLX')).toHaveLength(0);
      expect(r.flags.some(f => f.kind === 'BLENDED_FUND_OVERSELL')).toBe(false);
    });
  });

  describe('large drift â€” engine sells the fund to fix the allocation', () => {
    // 401k holds only FDKLX (60/30/10) but the strategy targets 80/15/5 â€” the
    // user's TDF doesn't fit. The only path to the target is to sell the fund
    // and reallocate. Without #40 the engine silently refused; now it acts.
    // (The 401k menu carries non-blended tickers so the engine can route the
    // compensating sub-class buys.)
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K',
        availableTickers: ['FDKLX', 'FXAIX', 'VXUS', 'BND'] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];
    const AGGRESSIVE: Strategy = {
      ...SIMPLE_STRAT,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.80, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL:  0.15, EMERGING_INTL: 0,
        FIXED_INCOME:    0.05, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0.05,
    };

    it('emits forced sells against the blended fund when drift exceeds tolerance', () => {
      const r = rebalance(accts, positions, AGGRESSIVE, {}, TDF, 0, 0);
      const fundSells = r.trades.filter(t => t.forceTicker === 'FDKLX' && t.deltaUsd < 0);
      expect(fundSells.length).toBeGreaterThan(0);
    });

    it('per-account net delta remains zero (Principle #3) â€” compensating buys balance', () => {
      const r = rebalance(accts, positions, AGGRESSIVE, {}, TDF, 0, 0);
      expect(near(accountSum(r.trades, 'k401'), 0, 5)).toBe(true);
    });
  });

  describe('drawdown over-sell with in-place compensation', () => {
    // 401k holds FDKLX plus FXAIX as a non-blended FI offset isn't possible
    // (no MUNY here) â€” the FI sub-class can only be raised by selling FDKLX.
    // availableTickers includes FXAIX/VXUS so the equity/INTL over-sells get
    // compensated in-place by buys against those tickers.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K',
        rmdDueUsd: 2_000,
        availableTickers: ['FDKLX', 'FXAIX', 'VXUS'] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('preserves per-account net trade delta = newCash âˆ’ withdrawal (Principle #3)', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      // expected net per account = -RMD = -$2k
      expect(near(accountSum(r.trades, 'k401'), -2_000, 5)).toBe(true);
    });

    it('pairs every FDKLX-forced over-sell with a compensating buy', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      for (const ac of ['US_LARGE_CAP', 'DEVELOPED_INTL'] as const) {
        const sellFromFund = r.trades
          .filter(t => t.accountId === 'k401' && t.assetClass === ac && t.forceTicker === 'FDKLX')
          .reduce((s, t) => s + -t.deltaUsd, 0);
        const compensatingBuy = r.trades
          .filter(t => t.accountId === 'k401' && t.assetClass === ac && (t.excludeTickers ?? []).includes('FDKLX'))
          .reduce((s, t) => s + t.deltaUsd, 0);
        // The forced sell on a non-binding sub-class always exceeds the engine's
        // residual demand (which is 0 here â€” engine wasn't trying to sell US_LC).
        // The full forced amount should be compensated by a matching buy.
        expect(near(compensatingBuy, sellFromFund, 5)).toBe(true);
      }
    });

    it('does not emit BLENDED_FUND_OVERSELL when compensation succeeds', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      expect(r.flags.some(f => f.kind === 'BLENDED_FUND_OVERSELL')).toBe(false);
    });
  });

  describe('drawdown over-sell without compensation path â€” flag emitted', () => {
    // 401k holds FDKLX (60/30/10) plus a standalone FXAIX (US_LARGE_CAP) lot.
    // The mixed-position composition skews the engine's per-class sell demand
    // away from the fund's composition: most of the US_LC over-target sits in
    // FXAIX, so when the RMD-driven FDKLX sale happens, INTL and FI get
    // over-sold relative to the engine's intent. The 401k menu restricts to
    // FDKLX only (allowedAssetClasses limits effectiveAllowed), so no
    // non-blended ticker exists to compensate the over-sells.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K',
        rmdDueUsd: 2_000,
        allowedAssetClasses: [] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
      { accountId: 'k401', ticker: 'FXAIX', marketValue:  20_000 },
    ];

    it('emits BLENDED_FUND_OVERSELL when an over-sold class has no buy-back path', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const oversells = r.flags.filter(f => f.kind === 'BLENDED_FUND_OVERSELL');
      expect(oversells.length).toBeGreaterThan(0);
    });
  });

  describe('locked blended fund stays frozen even in drawdown', () => {
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', rmdDueUsd: 5_000 },
      { id: 'schwab', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
    ];
    const positions: Position[] = [
      { accountId: 'k401',   ticker: 'FDKLX', marketValue: 100_000, locked: true },
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 50_000 },
    ];

    it('locked blended fund is never sold, even for an RMD', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const fundTrades = r.trades.filter(t => t.accountId === 'k401' && t.forceTicker === 'FDKLX');
      expect(fundTrades).toHaveLength(0);
    });
  });

  describe('BLENDED_FUND_SOLD disclosure', () => {
    // Whenever the engine touches a blended fund, it surfaces a one-per-fund
    // informational flag carrying the total fund-level sale amount, so the
    // user sees the position was disturbed. (Composite buys — issue #49 —
    // replenish a still-fitting fund on later rebalances.)
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K',
        availableTickers: ['FDKLX', 'FXAIX', 'VXUS', 'BND'] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];
    const AGGRESSIVE: Strategy = {
      ...SIMPLE_STRAT,
      targets: { ...ZERO_TARGETS,
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.80, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL:  0.15, EMERGING_INTL: 0,
        FIXED_INCOME:    0.05, ALTERNATIVES: 0, CRYPTO: 0, PRECIOUS_METALS: 0, CASH: 0,
      },
      toleranceAbs: 0.05,
    };

    it('emits exactly one BLENDED_FUND_SOLD flag per touched fund', () => {
      const r = rebalance(accts, positions, AGGRESSIVE, {}, TDF, 0, 0);
      const sold = r.flags.filter(f => f.kind === 'BLENDED_FUND_SOLD');
      expect(sold).toHaveLength(1);
      expect(sold[0].kind === 'BLENDED_FUND_SOLD' && sold[0].ticker).toBe('FDKLX');
      expect(sold[0].kind === 'BLENDED_FUND_SOLD' && sold[0].accountId).toBe('k401');
      expect(sold[0].kind === 'BLENDED_FUND_SOLD' && sold[0].amountUsd).toBeGreaterThan(0);
    });

    it('does not emit BLENDED_FUND_SOLD when the fund is untouched', () => {
      const STRAT_WITH_TOL: Strategy = { ...SIMPLE_STRAT, toleranceAbs: 0.05 };
      const onTargetAccts: Account[] = [{ id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K' }];
      const r = rebalance(onTargetAccts, positions, STRAT_WITH_TOL, {}, TDF, 0, 0);
      expect(r.flags.some(f => f.kind === 'BLENDED_FUND_SOLD')).toBe(false);
    });
  });

  describe('blended fund in taxable â€” TAXABLE_SALE flags per sub-class', () => {
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE', rmdDueUsd: 0 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('emits TAXABLE_SALE per sub-class with proportional amounts', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 5_000);
      const ts = r.flags.filter(f => f.kind === 'TAXABLE_SALE');
      const subClasses = new Set(ts.map(f => f.kind === 'TAXABLE_SALE' ? f.assetClass : null));
      expect(subClasses.has('US_LARGE_CAP')).toBe(true);
      expect(subClasses.has('DEVELOPED_INTL')).toBe(true);
      expect(subClasses.has('FIXED_INCOME')).toBe(true);
    });
  });
});

// â”€â”€â”€ tax-adjusted allocation (issue #7) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

describe('Goal 4: tax-adjusted allocation â€” issue #7', () => {
  const TA_STRAT: Strategy = {
    ...DEFAULT_STRATEGY,
    toleranceAbs: 0,
    taxAdjustment: {
      enabled: true,
      effectiveRateAtRetirement: 0.20,
      marginalRateLTCG: 0.15,
    },
  };

  it('result includes both nominal and tax-adjusted views when enabled', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, TA_STRAT);
    expect(r.taxAdjusted).toBeDefined();
    expect(r.taxAdjusted!.currentWeights).toBeDefined();
    expect(r.taxAdjusted!.projectedWeights).toBeDefined();
    // Nominal household value is the sum of newCash ($1M).
    expect(r.householdValue).toBeCloseTo(1_000_000, 0);
    // TA household value is reduced by the Trad/401k haircut: 200k Taxable +
    // 300k Ã— 0.8 + 500k Ã— 0.8 = 840_000.
    expect(r.taxAdjusted!.householdValue).toBeCloseTo(840_000, 0);
  });

  it('omits taxAdjusted view when disabled (back-compat)', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.taxAdjusted).toBeUndefined();
    expect(r.householdValue).toBe(1_000_000);
  });

  it('emits MISSING_COST_BASIS for taxable positions without basis', () => {
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY',  marketValue: 100_000 }, // no basis
      { accountId: 'schwab', ticker: 'BND',   marketValue: 100_000, costBasis: 95_000 },
      { accountId: 'ira',    ticker: 'FZROX', marketValue: 100_000 }, // not taxable â€” no flag
    ];
    const r = rebalance(
      BASE_ACCOUNTS.map(a => ({ ...a, newCash: undefined })),
      positions,
      TA_STRAT,
    );
    const missing = r.flags.filter(f => f.kind === 'MISSING_COST_BASIS');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ kind: 'MISSING_COST_BASIS', ticker: 'MUNY' });
  });

  it('per-account trade sum still matches newCash after TA conversion', () => {
    // Greenfield deposit-only run: per-account net trades must equal newCash
    // (no positions to sell, so all trades are buys at contribTaf â€” clean nominal).
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, TA_STRAT);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });

  it('TA mode shifts target sizing â€” Trad equities buy is larger than nominal mode', () => {
    // With TA on, the household TA value is smaller (Trad accounts haircut), so
    // hitting target weights in TA dollars requires a different nominal trade
    // distribution. Concretely: total TA = 840k, FIXED_INCOME target 20% of TA
    // = 168k â€” but the Taxable account has $200k of capacity, so FIXED_INCOME
    // gets fully placed there. The remainder of Taxable (32k) spills into other
    // classes via the engine's gap-fill / redirect logic.
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, TA_STRAT);
    // Per-account totals still must match newCash (invariant preserved).
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    // Some FIXED_INCOME lands in the taxable account.
    const fi = tradeFor(r.trades, 'schwab', 'FIXED_INCOME');
    expect(fi?.deltaUsd).toBeGreaterThan(0);
  });

  // ─── issue #125 / audit m11: Strategy panel "pre-tax vs tax-adjusted" bars ───
  //
  // The Strategy panel compare bars (StrategyPanel AllocationCompareBars) plot the
  // stated target (strategy.targets) against `taxAdjustedTargetWeights`, which
  // App.tsx wires to result.projectedWeights — the NOMINAL projected view, on
  // purpose. The audit flagged this as a suspected slip (should it be
  // result.taxAdjusted.projectedWeights?). It should NOT: the after-tax projected
  // view converges back onto the target by construction, so wiring it into the
  // bars would collapse them into one identical row. This test pins the intended
  // behaviour — the nominal view diverges from the target while the after-tax view
  // tracks it — so a future "fix" that swaps in taxAdjusted.projectedWeights fails.
  it('compare-bar inputs: nominal projected diverges from target, after-tax tracks it', () => {
    // FIXED_INCOME (munis) is placed in the taxable account, which takes no
    // Trad/401k haircut. Target 20% of the smaller TA base (840k) = 168k nominal,
    // which is only 16.8% of the 1M nominal base — so the nominal share reads LOW
    // versus the 20% target, while the after-tax share sits right on 20%.
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, TA_STRAT);
    expect(r.taxAdjusted).toBeDefined();

    const target = TA_STRAT.targets.FIXED_INCOME; // 0.20

    // After-tax projected (result.taxAdjusted.projectedWeights) tracks the target.
    expect(r.taxAdjusted!.projectedWeights.FIXED_INCOME).toBeCloseTo(target, 2);

    // Nominal projected (what the bars actually plot) diverges from the target...
    expect(r.projectedWeights.FIXED_INCOME).toBeCloseTo(168_000 / 1_000_000, 2);
    expect(Math.abs(r.projectedWeights.FIXED_INCOME - target)).toBeGreaterThan(0.02);

    // ...which means the two bar inputs (target vs nominal projected) genuinely
    // differ, whereas target vs after-tax projected would be near-identical. Guard
    // against a regression that wires taxAdjusted.projectedWeights into the bars.
    expect(Math.abs(r.projectedWeights.FIXED_INCOME - r.taxAdjusted!.projectedWeights.FIXED_INCOME))
      .toBeGreaterThan(0.02);
  });
});

// ─── Goal 10 / issue #42: rebalance target band tighter than the trigger ──────
//
// The trigger band (toleranceAbs / toleranceRel) decides WHETHER a class has
// drifted enough to rebalance. rebalanceTargetFraction decides HOW CLOSE to ideal
// it lands once it does — the trade-count-minimization pass (step 8.6) may only
// drop a corrective trade if the class still sits within the tighter target band.
//
// Fixture: household $150k across a taxable + a traditional IRA. US_LARGE_CAP is
// 25k underweight and EMERGING_INTL is 25k overweight (each drifts 16.7pp, well
// past the 5pp trigger); FIXED_INCOME (held as munis) is exactly on target. The
// full correction is a 25k LARGE-for-EM swap: 20k fits in the IRA (tax-preferred)
// and 5k spills to the taxable account. Whether the engine keeps that small
// taxable spill is what the target band controls.
describe('Goal 10 / issue #42: rebalance lands within the target band, not the trigger edge', () => {
  const ACCTS: Account[] = [
    { id: 'tax', name: 'Taxable',         institution: 'Schwab',   type: 'TAXABLE' },
    { id: 'ira', name: 'Traditional IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
  ];
  const HOLDINGS: Position[] = [
    { accountId: 'tax', ticker: 'VOO', marketValue: 20_000 },
    { accountId: 'tax', ticker: 'VWO', marketValue: 35_000 },
    { accountId: 'tax', ticker: 'MUB', marketValue: 45_000 },
    { accountId: 'ira', ticker: 'VOO', marketValue: 30_000 },
    { accountId: 'ira', ticker: 'VWO', marketValue: 20_000 },
  ];
  // toleranceRel = 1.0 so the 5pp absolute band always wins (keeps the math about
  // the absolute band, not the relative one). targets sum to 1.0.
  const STRAT = (rebalanceTargetFraction?: number): Strategy => ({
    targets: Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>,
    placement: {
      US_LARGE_CAP: ['TAX_ADVANTAGED', 'TAXABLE'],
      EMERGING_INTL: ['TAX_ADVANTAGED', 'TAXABLE'],
      FIXED_INCOME: ['TAXABLE'],
    } as Strategy['placement'],
    toleranceAbs: 0.05,
    toleranceRel: 1.0,
    minTradeUsd: 100,
    ...(rebalanceTargetFraction !== undefined ? { rebalanceTargetFraction } : {}),
  });
  const withTargets = (s: Strategy): Strategy => ({
    ...s,
    targets: { ...s.targets, US_LARGE_CAP: 0.5, EMERGING_INTL: 0.2, FIXED_INCOME: 0.3 },
  });

  it('default (half band): drives US_LARGE_CAP / EMERGING_INTL exactly to target, keeping the small taxable spill', () => {
    const r = rebalance(ACCTS, HOLDINGS, withTargets(STRAT()));
    // Both out-of-tolerance classes land on target (0pp drift), not at the edge.
    expect(near(r.projectedWeights.US_LARGE_CAP * 150_000, 75_000)).toBe(true);
    expect(near(r.projectedWeights.EMERGING_INTL * 150_000, 30_000)).toBe(true);
    // The 5k taxable swap is retained (not consolidated away).
    expect(near(tradeFor(r.trades, 'tax', 'US_LARGE_CAP')?.deltaUsd ?? 0, 5_000)).toBe(true);
    expect(near(tradeFor(r.trades, 'tax', 'EMERGING_INTL')?.deltaUsd ?? 0, -5_000)).toBe(true);
    // Per-account net is balance-preserving (no new cash).
    expect(near(accountSum(r.trades, 'tax'), 0)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'), 0)).toBe(true);
  });

  it('fraction = 1.0 reproduces pre-#42 behavior: consolidation drops the spill, leaving 3.33pp drift', () => {
    const r = rebalance(ACCTS, HOLDINGS, withTargets(STRAT(1.0)));
    // Only the IRA leg survives; the taxable spill is consolidated away because
    // the resulting 3.33pp drift is still within the 5pp trigger band.
    expect(tradeFor(r.trades, 'tax', 'US_LARGE_CAP')).toBeUndefined();
    expect(near(r.projectedWeights.US_LARGE_CAP * 150_000, 70_000)).toBe(true); // 46.67%
    expect(near(r.projectedWeights.EMERGING_INTL * 150_000, 35_000)).toBe(true); // 23.33%
    // Drift exceeds the half band (2.5pp) but stays inside the trigger band (5pp).
    expect(Math.abs(r.projectedWeights.US_LARGE_CAP - 0.5)).toBeGreaterThan(0.025);
    expect(Math.abs(r.projectedWeights.US_LARGE_CAP - 0.5)).toBeLessThan(0.05);
  });

  it('tighter fraction keeps a result at least as close to target as a looser one', () => {
    const dev = (frac: number) => {
      const r = rebalance(ACCTS, HOLDINGS, withTargets(STRAT(frac)));
      return Math.abs(r.projectedWeights.US_LARGE_CAP - 0.5);
    };
    expect(dev(0.5)).toBeLessThanOrEqual(dev(1.0));
  });
});

// ─── Issue #49: composite buys — Step 8.8 ────────────────────────────────────
//
// The buy-side mirror of Step 8.7. When an account's per-class buys point in
// the direction of a blended fund the account ALREADY HOLDS (composition
// known), one purchase of the fund replaces several individual buys. Only held
// funds are candidates — the engine never assumes outside knowledge of an
// account's fund menu. Substitutions are spend-neutral, must collapse at least
// two buy legs, and every perturbed class must stay within the Step 8.6 target
// band (or move toward target, or deviate by less than minTradeUsd).

describe('Goal 4: composite buys — issue #49', () => {
  // 60% US large cap, 30% INTL developed, 10% fixed income.
  const TDF_DECOMP = {
    US_LARGE_CAP:   0.60,
    DEVELOPED_INTL: 0.30,
    FIXED_INCOME:   0.10,
  };
  const TDF = { FDKLX: TDF_DECOMP };

  const SIMPLE_STRAT: Strategy = {
    targets: { ...ZERO_TARGETS,
      US_LARGE_CAP: 0.60, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.10,
    },
    placement: fillPlacement({}),
    toleranceAbs: 0,
    minTradeUsd:  0,
  };

  const compositeBuys = (r: ReturnType<typeof rebalance>, ticker = 'FDKLX') =>
    r.trades.filter(t => t.forceTicker === ticker && t.deltaUsd > 0);
  const boughtFlags = (r: ReturnType<typeof rebalance>) =>
    r.flags.filter(f => f.kind === 'BLENDED_FUND_BOUGHT');

  describe('perfect cover — one composite replaces three individual buys', () => {
    // 401k holds only FDKLX, already at target proportions. A $10k contribution
    // buys 60/30/10 — exactly the fund's composition. The engine should emit a
    // single composite purchase of the fund instead of three per-class buys.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 10_000 },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('routes the whole contribution through the held blended fund', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const legs = compositeBuys(r);
      expect(legs.length).toBe(3);
      expect(near(legs.reduce((s, t) => s + t.deltaUsd, 0), 10_000, 5)).toBe(true);
      // No stray per-class buys remain.
      expect(r.trades.filter(t => t.deltaUsd > 0 && !t.forceTicker)).toHaveLength(0);
    });

    it('legs respect the 60/30/10 composition', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const leg = (ac: AssetClass) =>
        compositeBuys(r).find(t => t.assetClass === ac)?.deltaUsd ?? 0;
      expect(near(leg('US_LARGE_CAP'),   6_000, 5)).toBe(true);
      expect(near(leg('DEVELOPED_INTL'), 3_000, 5)).toBe(true);
      expect(near(leg('FIXED_INCOME'),   1_000, 5)).toBe(true);
    });

    it('emits one BLENDED_FUND_BOUGHT flag with the fund-level total', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const bought = boughtFlags(r);
      expect(bought).toHaveLength(1);
      expect(bought[0].kind === 'BLENDED_FUND_BOUGHT' && bought[0].ticker).toBe('FDKLX');
      expect(bought[0].kind === 'BLENDED_FUND_BOUGHT' && bought[0].accountId).toBe('k401');
      expect(bought[0].kind === 'BLENDED_FUND_BOUGHT' &&
        near(bought[0].amountUsd, 10_000, 5)).toBe(true);
    });

    it('preserves the per-account net (Principle #3)', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      expect(near(accountSum(r.trades, 'k401'), 10_000, 5)).toBe(true);
    });
  });

  describe('close-but-not-exact — composite covers the binding portion, residual stays individual', () => {
    // Buy demand is 30k/15k/10k (US_LC/INTL/FI) against a 60/30/10 fund: the
    // first two legs absorb exactly at s = $50k, leaving a $5k FI residual that
    // must remain an individual buy.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 55_000 },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];
    const SKEWED: Strategy = {
      ...SIMPLE_STRAT,
      // Household after deposit = $155k. Targets put US_LC at 90k, INTL at 45k,
      // FI at 20k → buys of 30k/15k/10k on top of the fund's 60k/30k/10k.
      targets: { ...ZERO_TARGETS,
        US_LARGE_CAP: 90 / 155, DEVELOPED_INTL: 45 / 155, FIXED_INCOME: 20 / 155,
      },
    };

    it('emits a $50k composite plus a $5k individual FI buy', () => {
      const r = rebalance(accts, positions, SKEWED, {}, TDF, 0, 0);
      const legs = compositeBuys(r);
      expect(near(legs.reduce((s, t) => s + t.deltaUsd, 0), 50_000, 10)).toBe(true);
      const residual = r.trades.filter(t => t.deltaUsd > 0 && !t.forceTicker);
      expect(residual).toHaveLength(1);
      expect(residual[0].assetClass).toBe('FIXED_INCOME');
      expect(near(residual[0].deltaUsd, 5_000, 10)).toBe(true);
    });

    it('total spend equals the contribution (spend-neutral substitution)', () => {
      const r = rebalance(accts, positions, SKEWED, {}, TDF, 0, 0);
      expect(near(accountSum(r.trades, 'k401'), 55_000, 10)).toBe(true);
    });
  });

  describe('overbuy tolerance — target band gates the substitution', () => {
    // FDKC has a 3% cash sleeve the strategy targets at 0%. A zero-target class
    // has a zero-width band, so the only allowance is the minTradeUsd dust
    // clause (mirroring Step 11): the composite fires when the forced cash
    // slice is dust, and falls back to individual buys when it is material.
    //
    // The FDKC position is kept small (its $150 embedded cash is itself below
    // minTradeUsd) and the non-blended positions sit at the 60/30/10 target,
    // so the only engine action is deploying the contribution.
    const CASH_TDF = {
      FDKC: { US_LARGE_CAP: 0.58, DEVELOPED_INTL: 0.29, FIXED_INCOME: 0.10, CASH: 0.03 },
    };
    const accts = (cash: number): Account[] => [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: cash },
    ];
    // Invested mix is exactly 60/30/10: US_LC 18k, INTL 9k, FI 3k (incl. FDKC's slices).
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKC',  marketValue:  5_000 },
      { accountId: 'k401', ticker: 'FXAIX', marketValue: 15_100 },
      { accountId: 'k401', ticker: 'VXUS',  marketValue:  7_550 },
      { accountId: 'k401', ticker: 'BND',   marketValue:  2_500 },
    ];
    const STRAT_250: Strategy = { ...SIMPLE_STRAT, minTradeUsd: 250 };

    it('fires when the forced cash over-buy is below minTradeUsd', () => {
      // $3k contribution → composite's cash slice ≈ $90; with the $150 already
      // embedded in the held FDKC, projected CASH lands at ≈ $240 < $250: the
      // dust allowance passes.
      const r = rebalance(accts(3_000), positions, STRAT_250, {}, CASH_TDF, 0, 0);
      expect(boughtFlags(r)).toHaveLength(1);
      expect(near(
        compositeBuys(r, 'FDKC').reduce((s, t) => s + t.deltaUsd, 0), 3_000, 25,
      )).toBe(true);
    });

    it('falls back to individual buys when the over-buy exceeds the band', () => {
      // $50k contribution → composite's cash slice ≈ $1.5k ≥ $250 and outside
      // the zero-width band for a 0%-target class: no composite.
      const r = rebalance(accts(50_000), positions, STRAT_250, {}, CASH_TDF, 0, 0);
      expect(boughtFlags(r)).toHaveLength(0);
      expect(compositeBuys(r, 'FDKC')).toHaveLength(0);
      // The three individual buys still execute.
      expect(r.trades.filter(t => t.deltaUsd > 0)).toHaveLength(3);
    });
  });

  describe('two competing blended funds — better fit wins', () => {
    // FDKLX (60/30/10) matches the buy direction exactly; FBAL (40/40/20) does
    // not. Only FDKLX should be bought.
    const TWO_FUNDS = {
      FDKLX: TDF_DECOMP,
      FBAL:  { US_LARGE_CAP: 0.40, DEVELOPED_INTL: 0.40, FIXED_INCOME: 0.20 },
    };
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 10_000 },
    ];
    // Current mix: US_LC 50k, INTL 35k, FI 15k. Targets sized so the $10k of
    // buys split exactly 60/30/10 — FDKLX's composition, not FBAL's.
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 50_000 },
      { accountId: 'k401', ticker: 'FBAL',  marketValue: 50_000 },
    ];
    const STRAT: Strategy = {
      ...SIMPLE_STRAT,
      targets: { ...ZERO_TARGETS,
        US_LARGE_CAP: 56 / 110, DEVELOPED_INTL: 38 / 110, FIXED_INCOME: 16 / 110,
      },
    };

    it('buys the fund whose composition matches the buy vector', () => {
      const r = rebalance(accts, positions, STRAT, {}, TWO_FUNDS, 0, 0);
      const bought = boughtFlags(r);
      expect(bought).toHaveLength(1);
      expect(bought[0].kind === 'BLENDED_FUND_BOUGHT' && bought[0].ticker).toBe('FDKLX');
      expect(compositeBuys(r, 'FBAL')).toHaveLength(0);
    });
  });

  describe('preferCompositeBuys: false disables the substitution', () => {
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 10_000 },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('emits only individual per-class buys', () => {
      const OFF: Strategy = { ...SIMPLE_STRAT, preferCompositeBuys: false };
      const r = rebalance(accts, positions, OFF, {}, TDF, 0, 0);
      expect(compositeBuys(r)).toHaveLength(0);
      expect(boughtFlags(r)).toHaveLength(0);
      expect(r.trades.filter(t => t.deltaUsd > 0)).toHaveLength(3);
    });
  });

  describe('fit threshold — a single-class match never substitutes', () => {
    // Only US_LC is under target, so the account's buy vector has one leg. A
    // composite would not reduce trade count; the buy stays individual.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 10_000 },
    ];
    // INTL and FI sit exactly at their post-deposit targets; the whole $10k is
    // US_LC demand.
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 50_000 },
      { accountId: 'k401', ticker: 'VXUS',  marketValue: 18_000 },
      { accountId: 'k401', ticker: 'BND',   marketValue: 12_000 },
    ];
    const STRAT: Strategy = {
      ...SIMPLE_STRAT,
      // Household after deposit = $90k. Current: US_LC 30k, INTL 33k, FI 17k.
      targets: { ...ZERO_TARGETS,
        US_LARGE_CAP: 40 / 90, DEVELOPED_INTL: 33 / 90, FIXED_INCOME: 17 / 90,
      },
    };

    it('leaves the lone buy leg as an individual trade', () => {
      const r = rebalance(accts, positions, STRAT, {}, TDF, 0, 0);
      expect(compositeBuys(r)).toHaveLength(0);
      expect(boughtFlags(r)).toHaveLength(0);
    });
  });

  describe('composite buy + non-blended sell in the same account nets correctly', () => {
    // GLD must be sold (0% alternatives target); the proceeds fund a 60/30/10
    // multi-class buy that FDKLX covers exactly. The sell and the composite
    // must net to zero through Step 8.5.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K' },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 50_000 },
      { accountId: 'k401', ticker: 'GLD',   marketValue: 10_000 },
    ];

    it('sells GLD, buys the fund, per-account net stays zero', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      const sell = r.trades.find(t => t.deltaUsd < 0);
      expect(sell).toBeDefined();
      expect(near(sell!.deltaUsd, -10_000, 10)).toBe(true);
      expect(near(
        compositeBuys(r).reduce((s, t) => s + t.deltaUsd, 0), 10_000, 10,
      )).toBe(true);
      expect(near(accountSum(r.trades, 'k401'), 0, 10)).toBe(true);
    });
  });

  describe('no same-run buy+sell of one fund — Step 8.7 interaction', () => {
    // Drawdown forces a proportional FDKLX sale with compensating buys (the
    // Step 8.7 over-sell path). Those buy-backs must never route back into
    // FDKLX as a composite purchase — that would recommend buying and selling
    // the same fund in one run.
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K',
        rmdDueUsd: 2_000,
        availableTickers: ['FDKLX', 'FXAIX', 'VXUS'] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('never emits a buy leg against the fund being sold', () => {
      const r = rebalance(accts, positions, SIMPLE_STRAT, {}, TDF, 0, 0);
      expect(r.trades.some(t => t.forceTicker === 'FDKLX' && t.deltaUsd < 0)).toBe(true);
      expect(compositeBuys(r)).toHaveLength(0);
      expect(boughtFlags(r)).toHaveLength(0);
    });
  });

  describe('parent-level decomposition maps to child-level targeting', () => {
    // Real TDF decompositions use US_TOTAL_MARKET; the default strategy targets
    // the cap children. The effective composition must redistribute the parent
    // slice by the Russell weights so the composite lines up with child-level
    // buy demand.
    const PARENT_TDF = {
      FDKLX: { US_TOTAL_MARKET: 0.60, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.10 },
    };
    // Child-level targets: the 60% US sleeve splits 67/25/8 (Russell weights).
    const CHILD_STRAT: Strategy = {
      ...SIMPLE_STRAT,
      targets: { ...ZERO_TARGETS,
        US_LARGE_CAP: 0.60 * 0.67, US_MID_CAP: 0.60 * 0.25, US_SMALL_CAP: 0.60 * 0.08,
        DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.10,
      },
    };
    const accts: Account[] = [
      { id: 'k401', name: '401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 10_000 },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];

    it('routes the contribution through the fund with cap-child legs', () => {
      const r = rebalance(accts, positions, CHILD_STRAT, {}, PARENT_TDF, 0, 0);
      const legs = compositeBuys(r);
      expect(near(legs.reduce((s, t) => s + t.deltaUsd, 0), 10_000, 10)).toBe(true);
      const classes = new Set(legs.map(t => t.assetClass));
      expect(classes.has('US_LARGE_CAP')).toBe(true);
      expect(classes.has('US_MID_CAP')).toBe(true);
      expect(classes.has('US_SMALL_CAP')).toBe(true);
      expect(classes.has('US_TOTAL_MARKET')).toBe(false);
    });
  });
});

// ── Issue #215: held broad funds are implicit blended funds ──────────────────
//
// A held fund that classifies to a PARENT class (SWTSX → US_TOTAL_MARKET, BND →
// FIXED_INCOME) is really a blend of that parent's sleeves. Before #215 a lone
// sleeve trade was pinned to the fund with a misleading single-sleeve label and an
// unexecutable dollar amount. Now the fund flows through the blended-fund path:
// Step 8.7 sells it as a unit with composition-preserving buy-backs, and the
// resolver labels the merged sale by the fund's own class.
describe('Issue #215: broad fund treated as an implicit blended fund', () => {
  const classify = makeClassifier();

  const CAP_TILT: Strategy = {
    targets: { ...ZERO_TARGETS, US_LARGE_CAP: 0.79, US_MID_CAP: 0.05, US_SMALL_CAP: 0.16 },
    placement: fillPlacement({}),
    toleranceAbs: 0.05, toleranceRel: 0.25, minTradeUsd: 100,
  };
  // Single taxable account: SWTSX (total market) is the only mid-cap vehicle, while
  // FXAIX/VB absorb the large/small buy-backs. A custom cap tilt drives mid-cap
  // overweight, so only the mid sleeve needs to be sold.
  const capAccts: Account[] = [
    { id: 'tax', name: 'Taxable', institution: 'Schwab', type: 'TAXABLE' },
  ];
  const capPositions: Position[] = [
    { accountId: 'tax', ticker: 'SWTSX', marketValue: 100_000 },
    { accountId: 'tax', ticker: 'FXAIX', marketValue: 50_000 },
    { accountId: 'tax', ticker: 'VB',    marketValue: 10_000 },
  ];

  it('sells SWTSX as a unit labeled US_TOTAL_MARKET, not "SWTSX · Mid Cap"', () => {
    const r = rebalance(capAccts, capPositions, CAP_TILT, {}, {}, 0, 0);
    const resolved = resolveTradeVehicles(r.trades, capPositions, {}, classify, CAP_TILT.targets);
    const swtsx = resolved.find(t => t.ticker === 'SWTSX');
    expect(swtsx).toBeDefined();
    // The bug: a lone mid-cap sleeve mislabeled the SWTSX trade. Post-fix the merged
    // SWTSX sale carries the fund's true class and spans all three cap sleeves.
    expect(swtsx!.assetClass).toBe('US_TOTAL_MARKET');
    expect(swtsx!.deltaUsd).toBeLessThan(0);
    expect(new Set(swtsx!.mergedFrom!.map(m => m.assetClass)))
      .toEqual(new Set(['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP']));
    // No resolved trade is a lone SWTSX mid-cap sleeve.
    expect(resolved.some(t => t.ticker === 'SWTSX' && t.assetClass === 'US_MID_CAP' && !t.mergedFrom)).toBe(false);
  });

  it('emits BLENDED_FUND_SOLD for SWTSX, preserves account net, and hits target', () => {
    const r = rebalance(capAccts, capPositions, CAP_TILT, {}, {}, 0, 0);
    expect(r.flags.some(f => f.kind === 'BLENDED_FUND_SOLD' && f.ticker === 'SWTSX')).toBe(true);
    expect(r.flags.some(f => f.kind === 'BLENDED_FUND_OVERSELL')).toBe(false);
    expect(near(accountSum(r.trades, 'tax'), 0, 1)).toBe(true);
    expect(r.projectedWeights.US_LARGE_CAP).toBeCloseTo(0.79, 3);
    expect(r.projectedWeights.US_MID_CAP).toBeCloseTo(0.05, 3);
    expect(r.projectedWeights.US_SMALL_CAP).toBeCloseTo(0.16, 3);
  });

  // Broadened scope: a broad FIXED_INCOME fund with INDIVIDUAL child targets engages
  // the same composition-preserving machinery, labeled by its parent class.
  it('sells a broad FI fund (BND) as a unit labeled FIXED_INCOME under child targets', () => {
    const strat: Strategy = {
      targets: { ...ZERO_TARGETS,
        US_TREASURY: 0.50, US_CORP_BOND: 0.05, MUNI_BOND: 0.35, TIPS: 0.05, INTL_BOND: 0.05 },
      placement: fillPlacement({}),
      toleranceAbs: 0.05, toleranceRel: 0.25, minTradeUsd: 100,
    };
    const accts: Account[] = [{ id: 'tax', name: 'Taxable', institution: 'Schwab', type: 'TAXABLE' }];
    const positions: Position[] = [
      { accountId: 'tax', ticker: 'BND',  marketValue: 100_000 }, // FIXED_INCOME (only corp/tips/intl source)
      { accountId: 'tax', ticker: 'GOVT', marketValue:  40_000 }, // US_TREASURY
      { accountId: 'tax', ticker: 'MUNY', marketValue:  40_000 }, // MUNI_BOND
    ];
    const r = rebalance(accts, positions, strat, {}, {}, 0, 0);
    expect(r.flags.some(f => f.kind === 'BLENDED_FUND_SOLD' && f.ticker === 'BND')).toBe(true);
    expect(near(accountSum(r.trades, 'tax'), 0, 1)).toBe(true);
    const resolved = resolveTradeVehicles(r.trades, positions, {}, classify, strat.targets);
    const bnd = resolved.find(t => t.ticker === 'BND');
    expect(bnd).toBeDefined();
    expect(bnd!.assetClass).toBe('FIXED_INCOME');
    expect(bnd!.deltaUsd).toBeLessThan(0);
    expect(bnd!.mergedFrom!.length).toBeGreaterThan(1);
  });

  // Acceptance criterion: a broad fund targeted at the PARENT (family) level must
  // stay byte-identical to pre-#215 behavior — the fund's effective decomposition
  // folds back to a single class, so Step 8.7 no-ops (no spurious flag, no churn).
  it('simple portfolio unchanged: parent-targeted BND sell raises no BLENDED_FUND_SOLD flag', () => {
    const strat: Strategy = {
      targets: { ...ZERO_TARGETS, FIXED_INCOME: 0.30, US_LARGE_CAP: 0.70 },
      placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'] }),
      toleranceAbs: 0.05, toleranceRel: 0.25, minTradeUsd: 100,
    };
    const accts: Account[] = [{ id: 'tax', name: 'Taxable', institution: 'Schwab', type: 'TAXABLE' }];
    // 60% BND / 40% FXAIX — FI overweight vs a 30% target, so BND must be sold.
    const positions: Position[] = [
      { accountId: 'tax', ticker: 'BND',   marketValue: 60_000 },
      { accountId: 'tax', ticker: 'FXAIX', marketValue: 40_000 },
    ];
    const r = rebalance(accts, positions, strat, {}, {}, 0, 0);
    // The broad bond fund is sold, but as a single effective class — no composite
    // synthesis, no disclosure flag, no over-sell churn.
    expect(r.flags.some(f => f.kind === 'BLENDED_FUND_SOLD')).toBe(false);
    expect(r.flags.some(f => f.kind === 'BLENDED_FUND_OVERSELL')).toBe(false);
    // The FI sell still routes cleanly to BND, labeled by the targeted class.
    const resolved = resolveTradeVehicles(r.trades, positions, {}, classify, strat.targets);
    const fiSell = resolved.find(t => t.assetClass === 'FIXED_INCOME' && t.deltaUsd < 0);
    expect(fiSell?.ticker).toBe('BND');
    expect(fiSell?.mergedFrom).toBeUndefined();
    expect(near(accountSum(r.trades, 'tax'), 0, 1)).toBe(true);
  });
});

