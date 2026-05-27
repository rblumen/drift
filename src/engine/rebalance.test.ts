import { describe, it, expect } from 'vitest';
import type { Account, Position, AssetClass } from './types';
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

  it('ALTERNATIVES splits IRA:401k at 300:500 ratio', () => {
    const r = rebalance(BASE_ACCOUNTS, NO_POSITIONS, ZERO_TOL_STRATEGY);
    expect(tradeFor(r.trades, 'ira',  'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000 * (300 / 800), 0);
    expect(tradeFor(r.trades, 'k401', 'ALTERNATIVES')?.deltaUsd).toBeCloseTo(25_000 * (500 / 800), 0);
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
