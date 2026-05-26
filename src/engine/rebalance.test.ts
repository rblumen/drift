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
