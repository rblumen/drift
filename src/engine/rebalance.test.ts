import { describe, it, expect } from 'vitest';
import type { Account, Position, AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { DEFAULT_STRATEGY } from './strategy';
import { rebalance } from './rebalance';

// ─── helpers ────────────────────────────────────────────────────────────────

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

// Within $1 — rounding from proportional splits; anything tighter is noise.
const near = (a: number, b: number, tol = 1) => Math.abs(a - b) <= tol;

// ─── shared fixtures ────────────────────────────────────────────────────────

// Greenfield accounts: value comes entirely from newCash, no existing positions.
const BASE_ACCOUNTS: Account[] = [
  { id: 'schwab', name: 'Schwab Brokerage',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
  { id: 'ira',    name: 'Fidelity Trad IRA',   institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
  { id: 'k401',   name: 'Empower 401k',        institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 500_000 },
];

const NO_POSITIONS: Position[] = [];

// Positions that exactly match the §9 target location — used for tolerance tests.
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

// Zero-tolerance strategy: disables the ±5% suppression band so all asset classes
// participate in placement. Needed for greenfield tests where small-target classes
// (ALTERNATIVES 2.5%, EMERGING_INTL 3%) would otherwise fall inside the default 5% band.
const ZERO_TOL_STRATEGY = { ...DEFAULT_STRATEGY, toleranceAbs: 0 };

// ─── §9 base case: $200k taxable · $300k IRA · $500k 401k → $1M ─────────────

describe('base case — §9 worked example (greenfield $1M)', () => {
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

  it('REVISIT_PLACEMENT does not fire (taxable 20% = FI target, not >)', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.flags.find(f => f.kind === 'REVISIT_PLACEMENT')).toBeUndefined();
  });

  it('no PLACEMENT_SPILLOVER', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(r.flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER')).toHaveLength(0);
  });
});

// ─── §9 spillover case: $300k taxable · $300k IRA · $400k 401k → $1M ────────
// Taxable now exceeds the FI sleeve, so equities must land there.

describe('spillover case — taxable > FI target', () => {
  const ACCOUNTS_300K_TAXABLE: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage',   institution: 'Schwab',   type: 'TAXABLE',         newCash: 300_000 },
    { id: 'ira',    name: 'Fidelity Trad IRA',   institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    { id: 'k401',   name: 'Empower 401k',        institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 400_000 },
  ];

  it('REVISIT_PLACEMENT fires with taxableShare = 0.30', () => {
    const r = rebalance(ACCOUNTS_300K_TAXABLE, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const flag = r.flags.find(f => f.kind === 'REVISIT_PLACEMENT');
    expect(flag).toBeDefined();
    expect(flag?.kind === 'REVISIT_PLACEMENT' && flag.taxableShare).toBeCloseTo(0.3, 5);
    expect(flag?.kind === 'REVISIT_PLACEMENT' && flag.fixedIncomeTarget).toBe(0.2);
  });

  it('some equity class spills into TAXABLE bucket', () => {
    // After Russell redistribution, US equity is placed as LC → MC → SC.
    // LC ($385k) fills first and fits entirely in the $475k of remaining TA capacity.
    // MC ($144k) then partially spills, followed by SC ($46k) — total ~$100k into taxable.
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

// ─── constrained 401k menu ───────────────────────────────────────────────────
// 401k only has index-fund elections — no ALTERNATIVES ticker.

describe('constrained 401k — no ALTERNATIVES in fund menu', () => {
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

// ─── tolerance suppression ───────────────────────────────────────────────────

describe('tolerance — portfolio exactly at target', () => {
  it('returns no trades', () => {
    const r = rebalance(ACCOUNTS_NO_CASH, ON_TARGET_POSITIONS, DEFAULT_STRATEGY);
    expect(r.trades).toHaveLength(0);
  });

  it('emits WITHIN_TOLERANCE for every asset class', () => {
    const r = rebalance(ACCOUNTS_NO_CASH, ON_TARGET_POSITIONS, DEFAULT_STRATEGY);
    // ALL_ASSET_CLASSES now has 9 entries (added US_LARGE_CAP, US_MID_CAP, US_SMALL_CAP).
    expect(r.flags.filter(f => f.kind === 'WITHIN_TOLERANCE')).toHaveLength(9);
  });
});

// ─── 5/25 rule — relative tolerance band (issue #2) ──────────────────────────
//
// Bogleheads / Swedroe rule: a class is out of tolerance when its drift exceeds
// either of two bands — the *tighter* wins:
//   • absolute: ±toleranceAbs  (e.g. ±5pp)
//   • relative: ±toleranceRel × target  (e.g. 25% of target)
//
// For small sleeves the relative band fires first; for large sleeves the absolute
// band fires first.

describe('5/25 rule — relative tolerance band', () => {
  // Two accounts, $1M household, simple two-class strategy.
  const TWO_ACCT: Account[] = [
    { id: 'ira',  name: 'IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    { id: 'tax', name: 'Taxable', institution: 'Schwab',   type: 'TAXABLE'        },
  ];

  // Target 90% LC / 10% FI. With toleranceAbs=0.05 and toleranceRel=0.25:
  //   LC eff tol = min(0.05, 0.25×0.90) = 0.05  (absolute wins)
  //   FI eff tol = min(0.05, 0.25×0.10) = 0.025 (relative wins — tighter)
  const LC90_FI10 = {
    ...DEFAULT_STRATEGY,
    targets: {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.90, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.10, ALTERNATIVES: 0, CASH: 0,
    },
    toleranceAbs: 0.05,
    toleranceRel: 0.25,
    minTradeUsd: 0,
  };

  it('relative band fires first for a small-target class (3pp drift on a 10% target)', () => {
    // FI = 7% (drift 3pp). Absolute (5pp) passes; relative (2.5pp) fails → OOT.
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
    // FI = 8% (drift 2pp). Relative band = 2.5pp → still within.
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
    // fire either — but it's the absolute band that determines suppression here.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 860_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue: 140_000 },  // FI = 14% (drift 4pp)
    ];
    const r = rebalance(TWO_ACCT, positions, LC90_FI10);
    // Both classes are out of tolerance — LC by absolute band, FI by relative band.
    // The point of this test: LC is the larger sleeve and is within absolute band.
    // But because they're paired in a single portfolio, FI's 4pp drift (>2.5pp relative)
    // makes it OOT. LC's 4pp drift (<5pp absolute) is the absolute-dominant case.
    const lcTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'US_LARGE_CAP');
    expect(lcTolFlag).toBeDefined();
  });

  it('disabling relative band (toleranceRel=1) reverts to absolute-only behaviour', () => {
    // FI = 7% (drift 3pp). With toleranceRel=1, eff = min(0.05, 0.10) = 0.05.
    // Drift (3pp) < 5pp → within tolerance, no trades for FI.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 930_000 },
      { accountId: 'tax', ticker: 'MUNY',  marketValue:  70_000 },
    ];
    const r = rebalance(TWO_ACCT, positions, { ...LC90_FI10, toleranceRel: 1.0 });
    const fiTolFlag = r.flags.find(f => f.kind === 'WITHIN_TOLERANCE' && f.assetClass === 'FIXED_INCOME');
    expect(fiTolFlag).toBeDefined();
  });

  it('legacy strategy without toleranceRel defaults to 0.25', () => {
    // Same drift as the first test (FI = 7% on a 10% target → 3pp drift). With the
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

// ─── UNMAPPED_HOLDING ────────────────────────────────────────────────────────

describe('UNMAPPED_HOLDING flag', () => {
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

// ─── minTradeUsd suppression ─────────────────────────────────────────────────

describe('minTradeUsd suppression', () => {
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

// ─── zero-net-balance invariant ──────────────────────────────────────────────
// With the tolerance-locking fix, Σ trade deltas per account must equal newCash
// (i.e. sells and buys within an account cancel out, leaving only cash deployment).

describe('zero-net-balance invariant — tolerance with partial drift', () => {
  // Positions that are CLOSE to §9 targets but not exact; some classes
  // are within the default 5% band, some are out of tolerance. The old code
  // would generate non-zero net deltas per account; the fixed code must not.
  const DRIFTED_POSITIONS: Position[] = [
    // schwab: $210k FI (target $200k — $10k over, within 5% of $1M = $50k band)
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

// ─── locked accounts ─────────────────────────────────────────────────────────

describe('locked accounts', () => {
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
    // greenfield: all new cash → each account's net delta should equal its newCash
    const r = rebalance(LOCKED_IRA_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });
});

// ─── locked positions ────────────────────────────────────────────────────────

describe('locked positions', () => {
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
    // FSKAX locked — should never appear in a sell trade
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 259_375, locked: true },
    // Extra cash overweight in US — needs to be rebalanced elsewhere
    { accountId: 'k401',   ticker: 'FSKAX', marketValue: 100_000 },
  ];

  it('locked position still counted in currentWeights (via cap sub-classes)', () => {
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    // US_TOTAL_MARKET is redistributed to LC/MC/SC via RUSSELL_CAP_SPLIT.
    // Total US equity: 259375 + 100000 (k401) + 215625 (ira) = 575000 → ~57.5% combined.
    const usEquityWeight =
      r.currentWeights.US_LARGE_CAP +
      r.currentWeights.US_MID_CAP  +
      r.currentWeights.US_SMALL_CAP;
    expect(usEquityWeight).toBeGreaterThan(0.5);
  });

  it('no trade reduces cap sub-class beyond the unlocked portion', () => {
    const r = rebalance(LOCKED_POS_ACCOUNTS, BASE_LOCKED_POSITIONS, ZERO_TOL_STRATEGY);
    // k401 FSKAX: $259k locked + $100k unlocked → redistributed via Russell weights.
    // Unlocked cap capacity: LC ≈ $67k, MC ≈ $25k, SC ≈ $8k.
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
    // IRA holds $100k of INTL (locked account — immovable). Household = $800k.
    // DEVELOPED_INTL target = 17% → $136k total; $100k already locked in IRA.
    // Trades should only buy $36k of INTL, not $136k.
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FZILX', marketValue: 100_000 },
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.17, EMERGING_INTL: 0, FIXED_INCOME: 0.25, ALTERNATIVES: 0.08, CASH: 0,
      },
    };
    const r = rebalance(accts, positions, strategy);
    // Without the fix: projected DEVELOPED_INTL ≈ 17% + 100k/800k = 29.5%.
    // With the fix: projected DEVELOPED_INTL ≈ 17%.
    expect(Math.abs(r.projectedWeights.DEVELOPED_INTL - 0.17)).toBeLessThan(0.02);
    expect(near(accountSum(r.trades, 'schwab'), 200_000, 5)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000, 5)).toBe(true);
  });
});

// ─── concentrateClasses — fill designated account first ──────────────────────

describe('concentrateClasses — fill designated account first', () => {
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
    // ALTERNATIVES target = 2.5% × $1M = $25k. Roth has $150k capacity → absorbs all of it.
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
    // Roth has $5k — fills with ALTERNATIVES first, then capacity is gone.
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

// ─── allowedAssetClasses — explicit class whitelist ──────────────────────────

describe('allowedAssetClasses — explicit class whitelist', () => {
  const EXPLICIT_CONSTRAINED: Account[] = [
    { id: 'schwab', name: 'Schwab',    institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
    { id: 'ira',    name: 'Trad IRA',  institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
    {
      id: 'k401', name: 'Empower 401k', institution: 'Empower', type: 'FOUR_OH_ONE_K', newCash: 500_000,
      // Direct class whitelist — same effective constraint as the availableTickers test
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
    // availableTickers includes GLD (→ ALTERNATIVES), but allowedAssetClasses overrides it.
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

// ─── per-account net-zero when NO_ELIGIBLE_ACCOUNT fires ─────────────────────
// An account restricted to one asset class must not produce surplus-cash trades
// (net-negative) when the offsetting class has no eligible home anywhere.

describe('per-account net-zero — NO_ELIGIBLE_ACCOUNT with restricted account', () => {
  // Roth holds US_LARGE_CAP; target shifts 50% to FIXED_INCOME.
  // Roth's allowedAssetClasses excludes FI → NO_ELIGIBLE_ACCOUNT fires.
  // Before the step-7.5 fix, Roth would receive a sell-only trade for $50k LC
  // with no intra-account buy to absorb it (net = −$50k, surplus cash).
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
    targets: {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CASH: 0,
    },
    toleranceAbs: 0,
  };

  it('net trade delta for restricted account is 0, not −$50k', () => {
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

// ─── TAXABLE_SALE flag ───────────────────────────────────────────────────────

describe('TAXABLE_SALE flag', () => {
  // Start with more FI than target in taxable → engine must sell some.
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
});

// ─── step 8.5 — post-minTradeUsd balance correction ─────────────────────────
// When minTradeUsd filtering drops a trade on one side of the ledger but not the
// other, the per-account net would become nonzero. Step 8.5 absorbs the residual
// into the largest kept trade on the imbalanced side.

describe('step 8.5 — minTradeUsd balance correction', () => {
  // Single account; $75k existing positions (no new cash).
  // LC is over-weight, FI is under-weight, ALT is slightly over-weight.
  // With minTradeUsd = $10 000, the ALT sell ($1 250) is filtered out.
  // Before correction: net = −$17 500 + $18 750 = +$1 250 (surplus buy).
  // After correction:  FI buy shrunk to $17 500; net = 0.
  const SINGLE_ACCT: Account[] = [
    { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
  ];
  const POSITIONS_75K: Position[] = [
    { accountId: 'ira', ticker: 'FXAIX', marketValue: 55_000 },  // US_LARGE_CAP
    { accountId: 'ira', ticker: 'MUNY',  marketValue: 15_000 },  // FIXED_INCOME
    { accountId: 'ira', ticker: 'GLD',   marketValue:  5_000 },  // ALTERNATIVES
  ];
  // Household = $75k; targets: 50% LC, 45% FI, 5% ALT → $37 500, $33 750, $3 750.
  // LC delta = −$17 500 (sell, survives).
  // FI delta = +$18 750 (buy, survives).
  // ALT delta = −$1 250 (sell, filtered by $10 000).
  const HIGH_MIN_TRADE_STRATEGY = {
    ...DEFAULT_STRATEGY,
    targets: {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.50, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.45, ALTERNATIVES: 0.05, CASH: 0,
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
    // ALT sell is only −$1 250, below the $10 000 minTradeUsd.
    expect(tradeFor(r.trades, 'ira', 'ALTERNATIVES')).toBeUndefined();
  });

  it('surviving buy is shrunk to absorb the gap left by the dropped sell', () => {
    const r = rebalance(SINGLE_ACCT, POSITIONS_75K, HIGH_MIN_TRADE_STRATEGY);
    const fiBuy = tradeFor(r.trades, 'ira', 'FIXED_INCOME');
    expect(fiBuy).toBeDefined();
    // FI buy should be $17 500 (= $18 750 − $1 250 residual), not $18 750.
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

// ─── freeCash — household-level free cash distribution ───────────────────────

describe('freeCash — household-level cash distribution', () => {
  // Two deposit-eligible accounts: $200k taxable, $300k IRA.
  const ACCOUNTS_NO_CASH_ELIGIBLE: Account[] = [
    { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         },
    { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', },
  ];
  const POSITIONS_TWO_ACCOUNTS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY',  marketValue: 200_000 },
    { accountId: 'ira',    ticker: 'FZROX', marketValue: 300_000 },
  ];

  it('distributes freeCash proportionally to account value', () => {
    // Total value $500k; schwab 40%, ira 60%. freeCash $50k → schwab gets $20k, ira gets $30k.
    const r = rebalance(ACCOUNTS_NO_CASH_ELIGIBLE, POSITIONS_TWO_ACCOUNTS, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    // Net trade delta per account must equal its share of freeCash.
    expect(near(accountSum(r.trades, 'schwab'), 20_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    30_000, 100)).toBe(true);
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
    // freeCash $20k — only schwab is eligible.
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
    // freeCash $50k; schwab gets 40% = $20k + $5k existing = $25k net; ira gets $30k + $5k = $35k.
    const r = rebalance(accounts, positions, ZERO_TOL_STRATEGY, {}, {}, 50_000);
    expect(near(accountSum(r.trades, 'schwab'), 25_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    35_000, 100)).toBe(true);
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

  it('distributes equally when all eligible accounts have zero value (greenfield)', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE'         },
      { id: 'roth',   name: 'Roth',   institution: 'Fidelity', type: 'ROTH_IRA'        },
    ];
    // $20k freeCash split equally between two zero-value accounts → $10k each.
    const r = rebalance(accounts, NO_POSITIONS, ZERO_TOL_STRATEGY, {}, {}, 20_000);
    expect(near(accountSum(r.trades, 'schwab'), 10_000, 100)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),   10_000, 100)).toBe(true);
  });
});

// ─── step 7.7 — redirect taxable equity sells to tax-advantaged accounts ─────
//
// Scenario: taxable holds equity that is overweight at household level. Without
// the redirect, the engine would sell equity in taxable (bad: triggers capital
// gains). With step 7.7, the sell is moved to the TA account instead.

describe('step 7.7 — redirectTaxableSells', () => {
  // ── shared fixture ──────────────────────────────────────────────────────────
  // Household $200k: taxable $60k US_LARGE_CAP, Roth $80k US_LARGE_CAP + $60k FI.
  // Target 50% LC / 50% FI → need to sell $40k LC and buy $40k FI.
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
    targets: {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CASH: 0,
    },
    toleranceAbs: 0,
    minTradeUsd: 0,
  };

  it('emits no TAXABLE_SALE — equity sell fully redirected to Roth', () => {
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

  // ── partial redirect ─────────────────────────────────────────────────────────
  // Roth holds only $10k LC (not enough to absorb the full $60k taxable sell).
  // Redirect absorbs $10k; taxable still sells the remaining $50k.
  it('partial redirect — taxable sell shrinks when TA can only absorb part of it', () => {
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'FXAIX', marketValue:  60_000 },  // LC
      { accountId: 'roth',    ticker: 'FXAIX', marketValue:  10_000 },  // LC (small)
      { accountId: 'roth',    ticker: 'MUNY',  marketValue: 130_000 },  // FI
    ];
    // Household $200k; target 25% LC ($50k) / 75% FI ($150k).
    // LC overweight by $20k: sell $20k. FI underweight by $20k: buy $20k.
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.25, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.75, ALTERNATIVES: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(REDIRECT_ACCOUNTS, positions, strategy);
    // Roth can absorb up to its target for LC. Any taxable sell should be ≤ original.
    const taxableLcSell = r.trades.find(t => t.accountId === 'taxable' && t.assetClass === 'US_LARGE_CAP');
    // Household is only $20k overweight LC overall. Any remaining taxable sell must be < $20k.
    if (taxableLcSell) {
      expect(Math.abs(taxableLcSell.deltaUsd)).toBeLessThan(20_000 + 1);
    }
    // Per-account net must still be 0.
    expect(near(accountSum(r.trades, 'taxable'), 0, 2)).toBe(true);
    expect(near(accountSum(r.trades, 'roth'),    0, 2)).toBe(true);
  });

  // ── FIXED_INCOME sells in taxable are NOT redirected ─────────────────────────
  // FI prefers TAXABLE, so selling FI in taxable is correct behaviour.
  // (This is the existing OVER_FI_POSITIONS test scenario.)
  it('does not redirect FIXED_INCOME sells — FI prefers TAXABLE', () => {
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.8, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.2, ALTERNATIVES: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accounts, positions, strategy);
    // The TAXABLE_SALE flag for FI should still be emitted.
    const fiSaleFlag = r.flags.find(f => f.kind === 'TAXABLE_SALE' && f.assetClass === 'FIXED_INCOME');
    expect(fiSaleFlag).toBeDefined();
  });

  // ── TAXABLE-preferred class must not be used as compensating Y ───────────────
  // Setup: taxable holds LC (overweight) + FI; 401k holds LC + FI.
  // FI target is 60% — greedyPlace routes all $180k FI to taxable (fits within
  // the $200k taxable capacity). The taxable LC surplus ($130k) would—without the
  // guard—be redirected using FI as the compensating Y class, pushing $100k of FI
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
    // Placement: FI → TAXABLE only; LC → TAX_ADVANTAGED first.
    const strategy = {
      ...DEFAULT_STRATEGY,
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.4, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.6, ALTERNATIVES: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 0,
    };
    const r = rebalance(accts, positions, strategy);

    // FI buy must land in taxable — not in the 401k.
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

  // ── invariants survive redirect ───────────────────────────────────────────────
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.6, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.4, ALTERNATIVES: 0, CASH: 0,
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

// ─── backlog #17 — account-count minimization (concentrate-then-spill) ────────
//
// greedyPlace now fills the largest-capacity eligible account first, spilling to
// additional accounts only when the first is exhausted.  Proportional spreading
// across all same-bucket accounts is replaced by this "waterfall" logic.

describe('account-count minimization — concentrate-then-spill (backlog #17)', () => {
  // ── single-account fill ────────────────────────────────────────────────────
  // 401k ($500k) and IRA ($300k) are both TAX_ADVANTAGED.  ALTERNATIVES target
  // is $25k — easily fits inside either account alone.  The engine should send
  // it entirely to the larger account (401k) and leave IRA untouched for ALTS.
  it('small ALTERNATIVES sleeve fits in one account — IRA receives no ALTS', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'ira',  'ALTERNATIVES')).toBeUndefined();
  });

  // ── per-account balance still preserved ───────────────────────────────────
  it('account totals still match newCash after concentrate-then-spill', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(near(accountSum(r.trades, 'schwab'), 200_000)).toBe(true);
    expect(near(accountSum(r.trades, 'ira'),    300_000)).toBe(true);
    expect(near(accountSum(r.trades, 'k401'),   500_000)).toBe(true);
  });

  // ── spill fires when single account is insufficient ────────────────────────
  // US_LARGE_CAP target ($385k) > 401k remaining capacity after prior fills,
  // so it spills to IRA.  Verify that the two accounts together receive the
  // full LC target and the capacity invariant holds.
  it('US_LARGE_CAP spills to IRA after k401 is partially filled', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    const k401Lc = tradeFor(r.trades, 'k401', 'US_LARGE_CAP')?.deltaUsd ?? 0;
    const iraLc  = tradeFor(r.trades, 'ira',  'US_LARGE_CAP')?.deltaUsd ?? 0;
    // Combined LC allocation must equal the target ($385k scaled to free capacity).
    // (greenfield ⇒ scale = 1, total = $385k)
    expect(near(k401Lc + iraLc, 385_000, 2)).toBe(true);
    // IRA receives the larger LC share: by the time LC is placed, k401 has already
    // absorbed ALTS + EMINTL + DEVINTL ($225k), leaving it with $275k — less than
    // IRA's untouched $300k — so IRA is filled first and gets the bulk of LC.
    expect(iraLc).toBeGreaterThan(k401Lc);
  });

  // ── three TA accounts — fills cascade from largest to smallest ────────────
  it('three TA accounts: ALTS fills largest first, never touches smallest', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab',  institution: 'Schwab',   type: 'TAXABLE',         newCash: 200_000 },
      { id: 'big',    name: 'Big IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 600_000 },
      { id: 'mid',    name: 'Mid 401', institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 150_000 },
      { id: 'tiny',   name: 'Tiny Roth', institution: 'Fidelity', type: 'ROTH_IRA',       newCash:  50_000 },
    ];
    // ALTS target = 2.5% × $1M = $25k.  big IRA ($600k) absorbs it all.
    const r = rebalance(accounts, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'big',  'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000, 0);
    expect(tradeFor(r.trades, 'mid',  'ALTERNATIVES')).toBeUndefined();
    expect(tradeFor(r.trades, 'tiny', 'ALTERNATIVES')).toBeUndefined();
    // Balance invariants.
    expect(near(accountSum(r.trades, 'big'),  600_000)).toBe(true);
    expect(near(accountSum(r.trades, 'mid'),  150_000)).toBe(true);
    expect(near(accountSum(r.trades, 'tiny'),  50_000)).toBe(true);
  });

  // ── concentrateClasses accounts still get priority within their group ──────
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

// ─── backlog #16 — trade-count minimization (post-placement consolidation) ────
//
// After all trades are balanced, the engine greedily drops small trades whose
// removal (plus a compensating adjustment to the opposite-sign partner trade in
// the same account) keeps every asset-class projected weight within toleranceAbs.

describe('trade-count minimization — drop marginal trades (backlog #16)', () => {
  // ── small-account pair collapses when both classes stay within tolerance ───
  //
  // Portfolio:
  //   A1 (TAX_ADVANTAGED, $900k): LC $780k, FI $120k
  //   A2 (TAX_ADVANTAGED, $100k): LC $80k,  FI $20k
  //   Household $1M. Target: LC 70%, FI 30%. toleranceAbs = 5%.
  //
  // Trades before minimization:
  //   A1: sell LC $100k, buy FI $100k        (needed — 8% drift)
  //   A2: sell LC $10k,  buy FI $10k         (marginal)
  //
  // Dropping A2 buy FI (+$10k) → projected FI = 31% (within 5% of 30%).
  //   Compensation: shrink A2 sell LC from -$10k to $0 → projected LC = 69% (within 5%).
  // Both checks pass → both A2 trades are eliminated.

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
    targets: {
      US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.7, US_MID_CAP: 0, US_SMALL_CAP: 0,
      DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.3, ALTERNATIVES: 0, CASH: 0,
    },
    toleranceAbs: 0.05,  // 5% band — both A2 trades end up within it after compensation
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

  // ── zero-tolerance disables minimization ──────────────────────────────────
  // With toleranceAbs = 0 every trade is needed to hit exact targets.
  it('does NOT drop trades when toleranceAbs = 0', () => {
    const strictStrategy = { ...LC70_FI30_STRATEGY, toleranceAbs: 0 };
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, strictStrategy);
    // Both accounts should still have trades (A2 has $10k drift that must be corrected).
    expect(r.trades.filter(t => t.accountId === 'a2').length).toBeGreaterThan(0);
  });

  // ── trade too large to drop stays ─────────────────────────────────────────
  // If dropping a trade would push projected weight beyond toleranceAbs, it must
  // be kept regardless of its size.
  it('does NOT drop A1 trades — removal would breach tolerance', () => {
    const r = rebalance(A1A2_ACCOUNTS, A1A2_POSITIONS, LC70_FI30_STRATEGY);
    // A1 has $100k sell of LC ($780k→$700k target). Without it, LC projected ≈ 78%,
    // which is 8% away from the 70% target — outside the 5% band.
    const a1LcSell = tradeFor(r.trades, 'a1', 'US_LARGE_CAP');
    expect(a1LcSell).toBeDefined();
    expect(Math.abs(a1LcSell!.deltaUsd)).toBeGreaterThan(50_000);
  });

  // ── no compensating trade → cannot drop ───────────────────────────────────
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

// ─── post-trade accuracy — stress scenarios ───────────────────────────────────
//
// These tests verify the end-to-end invariant: projectedWeights for every
// out-of-tolerance class must land within toleranceAbs of the target after trades,
// and the PROJECTED_OFF_TARGET flag must fire whenever a hard constraint prevents
// that.  They complement the unit tests above by exercising full pipelines
// (placement → trades → minimization → Step 11 validation) under varied stress.

// Shared helper: assert every OOT class projects within strategy.toleranceAbs,
// and that no PROJECTED_OFF_TARGET flags were emitted.
function assertAllOnTarget(
  r: ReturnType<typeof rebalance>,
  strategy: { targets: Record<AssetClass, number>; toleranceAbs: number },
) {
  const tol = strategy.toleranceAbs + 0.001; // tiny rounding buffer
  for (const ac of ALL_ASSET_CLASSES) {
    // Only check OOT classes — within-tolerance classes intentionally stay at current.
    const isWithinTolNow =
      Math.abs(r.currentWeights[ac] - strategy.targets[ac]) <= strategy.toleranceAbs;
    if (isWithinTolNow) continue;
    expect(
      Math.abs(r.projectedWeights[ac] - strategy.targets[ac]),
      `${ac}: projected ${(r.projectedWeights[ac] * 100).toFixed(2)}% should be within ` +
      `${(strategy.toleranceAbs * 100).toFixed(1)}% of target ${(strategy.targets[ac] * 100).toFixed(2)}%`,
    ).toBeLessThanOrEqual(tol);
  }
  expect(
    r.flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET'),
    'expected no PROJECTED_OFF_TARGET flags',
  ).toHaveLength(0);
}

describe('post-trade accuracy — stress scenarios', () => {
  // ── S1: large single-class imbalance, 3 unconstrained accounts ───────────────
  // Portfolio holds only SPY (US Large Cap). Every other class needs to be bought
  // from scratch. Verifies the full household rebalance reaches every target.
  it('S1: large single-class imbalance — all OOT classes reach target', () => {
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

  // ── S2: multi-class drift across 5 accounts ───────────────────────────────────
  // Each account holds exactly one asset class that is not its preferred home.
  // Full rebalance must correctly swap assets across account boundaries.
  it('S2: multi-class drift across 5 accounts — all OOT classes within 1% after trades', () => {
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

  // ── S3: greenfield with spillover — targets still met despite non-preferred placement
  it('S3: placement spillover (taxable > FI target) — no PROJECTED_OFF_TARGET', () => {
    // Taxable = 30% of household, FI target = 20% → REVISIT_PLACEMENT fires and
    // equities spill into taxable, but all class targets are still reachable.
    const accts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab',   type: 'TAXABLE',         newCash: 300_000 },
      { id: 'ira',    name: 'IRA',    institution: 'Fidelity', type: 'TRADITIONAL_IRA', newCash: 300_000 },
      { id: 'k401',   name: '401k',   institution: 'Empower',  type: 'FOUR_OH_ONE_K',   newCash: 400_000 },
    ];
    const strategy = { ...ZERO_TOL_STRATEGY, toleranceAbs: 0.01 };
    const r = rebalance(accts, NO_POSITIONS, strategy);
    expect(r.flags.some(f => f.kind === 'REVISIT_PLACEMENT')).toBe(true);
    assertAllOnTarget(r, strategy);
  });

  // ── S4: NO_ELIGIBLE_ACCOUNT → PROJECTED_OFF_TARGET fires for constrained class
  it('S4: NO_ELIGIBLE_ACCOUNT — PROJECTED_OFF_TARGET fires for the blocked class', () => {
    // Single IRA that explicitly excludes ALTERNATIVES.
    // ALTERNATIVES (target 8%) cannot be placed anywhere → NO_ELIGIBLE_ACCOUNT.
    // Step 7.5 gap-fill then redistributes the unplaceable $80k back to the
    // account's existing OOT holdings (LC, DEVINTL, FI) proportionally to keep
    // the account balanced. Those classes end up above their own targets too, so
    // PROJECTED_OFF_TARGET fires for all affected classes — not just ALTS.
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.55, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.25, EMERGING_INTL: 0, FIXED_INCOME: 0.12, ALTERNATIVES: 0.08, CASH: 0,
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
      const hasPOT = r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === ac);
      const withinNow = Math.abs(r.currentWeights[ac] - strategy.targets[ac]) <= strategy.toleranceAbs;
      if (!hasPOT && !withinNow) {
        expect(Math.abs(r.projectedWeights[ac] - strategy.targets[ac])).toBeLessThanOrEqual(strategy.toleranceAbs + 0.001);
      }
    }
  });

  // ── S5: locked position below target — must reach target (regression for fix) ─
  it('S5: locked position below target — projected reaches target, no PROJECTED_OFF_TARGET', () => {
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.55, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.20, EMERGING_INTL: 0, FIXED_INCOME: 0.20, ALTERNATIVES: 0.05, CASH: 0,
      },
    };
    assertAllOnTarget(rebalance(accts, positions, strategy), strategy);
  });

  // ── S6: locked position exceeds target → PROJECTED_OFF_TARGET fires ──────────
  it('S6: locked position above target — PROJECTED_OFF_TARGET fires for that class', () => {
    // IRA has $250k DEVINTL locked (25% of $1M). Target is 10%. Cannot reduce.
    // After trades: DEVINTL projected ≥ 25% >> 10% target.
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.50, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0.10, EMERGING_INTL: 0, FIXED_INCOME: 0.25, ALTERNATIVES: 0.15, CASH: 0,
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

  // ── S7: minTradeUsd suppresses needed trade → PROJECTED_OFF_TARGET ────────────
  it('S7: minTradeUsd too large — PROJECTED_OFF_TARGET fires when adjustment is suppressed', () => {
    // $10k portfolio; LC needs $500 sell, FI needs $500 buy.
    // minTradeUsd = $1000 → both trades filtered. Portfolio stays at current.
    // |50% - 55%| = 5% > toleranceAbs (0%) → PROJECTED_OFF_TARGET for both.
    const accts: Account[] = [
      { id: 'ira', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 5_500 },  // LC — 55%, target 50%
      { accountId: 'ira', ticker: 'MUNY',  marketValue: 4_500 },  // FI — 45%, target 50%
    ];
    const strategy = {
      ...ZERO_TOL_STRATEGY,
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.5, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.5, ALTERNATIVES: 0, CASH: 0,
      },
      toleranceAbs: 0,
      minTradeUsd: 1_000,  // $500 trades are filtered out
    };
    const r = rebalance(accts, positions, strategy);
    expect(r.trades).toHaveLength(0);  // both trades suppressed
    expect(r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'US_LARGE_CAP')).toBe(true);
    expect(r.flags.some(f => f.kind === 'PROJECTED_OFF_TARGET' && f.assetClass === 'FIXED_INCOME')).toBe(true);
  });

  // ── S8: locked account — unlocked accounts reach target, locked stays put ─────
  it('S8: locked account — unlocked accounts trade to target; locked account untouched', () => {
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

  // ── S9: PROJECTED_OFF_TARGET values are accurate ─────────────────────────────
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
      targets: {
        US_TOTAL_MARKET: 0, US_LARGE_CAP: 0.7, US_MID_CAP: 0, US_SMALL_CAP: 0,
        DEVELOPED_INTL: 0, EMERGING_INTL: 0, FIXED_INCOME: 0.2, ALTERNATIVES: 0.1, CASH: 0,
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
      // Projected must be below target (can't buy ALTS — below target, not above).
      expect(flag.projectedWeight).toBeLessThan(flag.targetWeight);
    }
  });
});
