import { describe, it, expect } from 'vitest';
import type { Account, Position, AssetClass, PlacementTarget } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { rebalance } from '../engine/rebalance';
import { resolveTradeVehicles } from '../engine/resolve';
import { makeClassifier } from '../engine/classify';
import { zeroByClass } from '../engine/utils';
import { buildHtml } from './exportReport';

// ─── helpers ──────────────────────────────────────────────────────────────────

const classify = makeClassifier();
const FIXED_NOW = new Date(2027, 0, 15, 9, 30); // Jan 15, 2027, 9:30am — deterministic for snapshot-ish assertions.

const ZERO_TARGETS = zeroByClass();

function fillPlacement(
  overrides: Partial<Record<AssetClass, PlacementTarget[]>>,
): Record<AssetClass, PlacementTarget[]> {
  const base = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, ['TAX_ADVANTAGED', 'TAXABLE'] as PlacementTarget[]]),
  ) as Record<AssetClass, PlacementTarget[]>;
  return { ...base, ...overrides };
}

// Zero-tolerance strategy so small drifts always produce trades in test fixtures,
// mirroring the pattern in rebalance.test.ts.
const ZERO_TOL_STRATEGY = { ...DEFAULT_STRATEGY, toleranceAbs: 0, minTradeUsd: 1 };

/** Runs the full engine + resolver pipeline used by the real app before handing
 *  off to exportReport, and returns everything buildHtml needs. */
function runScenario(
  accounts: Account[],
  positions: Position[],
  strategy = ZERO_TOL_STRATEGY,
  freeCash = 0,
  plannedWithdrawal = 0,
) {
  const result = rebalance(accounts, positions, strategy, {}, {}, freeCash, plannedWithdrawal);
  const resolvedTrades = resolveTradeVehicles(result.trades, positions, {}, classify, strategy.targets);
  return { result, resolvedTrades };
}

// ─── Scenario A: a household that needs real trades (buys + sells + taxable sale) ──

const SCHWAB: Account = { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' };
const IRA: Account = { id: 'ira', name: 'Fidelity Trad IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' };

const DRIFTED_ACCOUNTS: Account[] = [SCHWAB, IRA];

// Schwab holds too much equity (should be muni bonds per default placement);
// IRA holds an equity fund that's now overweight vs. target, needing a sell + buy.
const DRIFTED_POSITIONS: Position[] = [
  { accountId: 'schwab', ticker: 'FXAIX', marketValue: 200_000 }, // US_LARGE_CAP, taxable → taxable sale on rebalance
  { accountId: 'ira', ticker: 'FSKAX', marketValue: 300_000 },    // US_TOTAL_MARKET blended fund
  { accountId: 'ira', ticker: 'FZILX', marketValue: 50_000 },     // DEVELOPED_INTL
];

const SIMPLE_STRATEGY = {
  ...ZERO_TOL_STRATEGY,
  targets: {
    ...ZERO_TARGETS,
    US_LARGE_CAP: 0.30,
    DEVELOPED_INTL: 0.20,
    FIXED_INCOME: 0.50,
  },
  placement: fillPlacement({
    FIXED_INCOME: ['TAXABLE'],
    US_LARGE_CAP: ['TAX_ADVANTAGED', 'TAXABLE'],
    DEVELOPED_INTL: ['TAX_ADVANTAGED', 'TAXABLE'],
  }),
};

describe('exportReport buildHtml — trade scenario', () => {
  const { result, resolvedTrades } = runScenario(DRIFTED_ACCOUNTS, DRIFTED_POSITIONS, SIMPLE_STRATEGY);

  it('produces well-formed HTML with a title and doctype', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('Portfolio Rebalance Report');
  });

  it('includes the household value formatted via fmtUsd', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('$550,000');
  });

  it('includes the generation date and version tag', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('January 15, 2027');
    expect(html).toMatch(/v[\d.]+ · /); // __APP_VERSION__ · __COMMIT_SHA__
  });

  it('lists both account names and institutions', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Schwab Brokerage');
    expect(html).toContain('Fidelity Trad IRA');
    expect(html).toContain('Schwab');
    expect(html).toContain('Fidelity');
  });

  it('renders a BUY badge for buy trades and a SELL badge for sell trades', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    const hasBuy = resolvedTrades.some(t => t.deltaUsd > 0);
    const hasSell = resolvedTrades.some(t => t.deltaUsd < 0);
    expect(hasBuy).toBe(true);
    expect(hasSell).toBe(true);
    expect(html).toContain('>BUY<');
    expect(html).toContain('>SELL<');
  });

  it('flags a taxable sale with the warning marker on the FXAIX sell', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    const taxableSellExists = resolvedTrades.some(
      t => t.accountId === 'schwab' && t.deltaUsd < 0,
    );
    expect(taxableSellExists).toBe(true);
    expect(html).toContain('taxable sale');
  });

  it('emits a TAXABLE_SALE flag entry in the flags section', () => {
    const hasTaxableSaleFlag = result.flags.some(f => f.kind === 'TAXABLE_SALE');
    expect(hasTaxableSaleFlag).toBe(true);
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Taxable sale:');
  });

  it('shows "Recommended Trades" heading when trades exist', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Recommended Trades');
    expect(html).not.toContain('Portfolio is within tolerance — no trades needed.');
  });

  it('renders the household allocation table with current/target/drift columns', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Household Allocation');
    expect(html).toContain('Current');
    expect(html).toContain('Target');
    expect(html).toContain('Drift');
    expect(html).toContain('After Trades');
  });

  it('renders each ticker held in monospace with its asset class label', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('FXAIX');
  });

  it('formats trade deltas with the +/− delta convention', () => {
    const html = buildHtml(result, DRIFTED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    // fmtDelta prefixes buys with '+' and sells with the unicode minus '−'.
    expect(html).toMatch(/[+−]\$[\d,]+/);
  });
});

// ─── Scenario B: within-tolerance household (no trades) ─────────────────────

describe('exportReport buildHtml — no-trades scenario', () => {
  const ON_TARGET_ACCOUNTS: Account[] = [SCHWAB];
  const ON_TARGET_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
  ];
  const ALL_FI_STRATEGY = {
    ...DEFAULT_STRATEGY, // default (non-zero) tolerance — this position is exactly on target
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 1.0 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'] }),
  };
  const { result, resolvedTrades } = runScenario(ON_TARGET_ACCOUNTS, ON_TARGET_POSITIONS, ALL_FI_STRATEGY);

  it('produces zero trades', () => {
    expect(result.trades).toHaveLength(0);
    expect(resolvedTrades).toHaveLength(0);
  });

  it('renders the "within tolerance" banner instead of a trade list', () => {
    const html = buildHtml(result, ON_TARGET_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Portfolio is within tolerance — no trades needed.');
    expect(html).toContain('Account Allocations'); // heading swaps when there are no trades
  });

  it('shows the "no trades required" note in the per-account section', () => {
    const html = buildHtml(result, ON_TARGET_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Within tolerance — no trades required.');
  });

  it('does not render any BUY/SELL badges', () => {
    const html = buildHtml(result, ON_TARGET_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).not.toContain('>BUY<');
    expect(html).not.toContain('>SELL<');
  });

  it('does not emit any flags section content', () => {
    expect(result.flags.filter(f => f.kind !== 'WITHIN_TOLERANCE')).toHaveLength(0);
  });
});

// ─── Scenario C: sell-only household (drawdown / withdrawal) ────────────────

describe('exportReport buildHtml — sell-only / withdrawal scenario', () => {
  const WD_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' },
  ];
  const WD_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
  ];
  const WD_STRATEGY = {
    ...ZERO_TOL_STRATEGY,
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 1.0 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'] }),
  };
  const { result, resolvedTrades } = runScenario(WD_ACCOUNTS, WD_POSITIONS, WD_STRATEGY, 0, 20_000);

  it('raises the planned withdrawal entirely via sells (no buys)', () => {
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.trades.every(t => t.deltaUsd <= 0)).toBe(true);
  });

  it('renders the spending / withdrawal plan section with the raised amount', () => {
    const html = buildHtml(result, WD_ACCOUNTS, resolvedTrades, 0, 20_000, FIXED_NOW);
    expect(html).toContain('Spending / withdrawal plan');
    expect(html).toContain('$20,000 planned');
  });

  it('shows only SELL badges, never BUY', () => {
    const html = buildHtml(result, WD_ACCOUNTS, resolvedTrades, 0, 20_000, FIXED_NOW);
    expect(html).toContain('>SELL<');
    expect(html).not.toContain('>BUY<');
  });
});

// ─── Scenario D: cash deployment + free cash distribution ───────────────────

describe('exportReport buildHtml — free cash deployment', () => {
  const CASH_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' },
    { id: 'ira', name: 'Fidelity Trad IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', depositLimitUsd: 7_000 },
  ];
  const CASH_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY', marketValue: 50_000 },
    { accountId: 'ira', ticker: 'FSKAX', marketValue: 50_000 },
  ];
  const CASH_STRATEGY = {
    ...ZERO_TOL_STRATEGY,
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 0.5, US_TOTAL_MARKET: 0.5 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'], US_TOTAL_MARKET: ['TAX_ADVANTAGED', 'TAXABLE'] }),
  };
  const { result, resolvedTrades } = runScenario(CASH_ACCOUNTS, CASH_POSITIONS, CASH_STRATEGY, 10_000, 0);

  it('renders the cash deployment section with the free-cash total', () => {
    const html = buildHtml(result, CASH_ACCOUNTS, resolvedTrades, 10_000, 0, FIXED_NOW);
    expect(html).toContain('Cash deployment');
    expect(html).toContain('$10,000 household free cash distributed to deposit-eligible accounts');
  });

  it('shows a deposit-limited badge for the account with a depositLimitUsd', () => {
    const html = buildHtml(result, CASH_ACCOUNTS, resolvedTrades, 10_000, 0, FIXED_NOW);
    expect(html).toContain('$7,000 cap');
  });
});

// ─── Scenario E: locked account renders a lock badge and is excluded from trades ──

describe('exportReport buildHtml — locked account', () => {
  const LOCKED_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' },
    { id: 'locked-ira', name: 'Legacy IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true },
  ];
  const LOCKED_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
    { accountId: 'locked-ira', ticker: 'FSKAX', marketValue: 100_000 },
  ];
  const LOCKED_STRATEGY = {
    ...ZERO_TOL_STRATEGY,
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 0.5, US_TOTAL_MARKET: 0.5 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'], US_TOTAL_MARKET: ['TAX_ADVANTAGED', 'TAXABLE'] }),
  };
  const { result, resolvedTrades } = runScenario(LOCKED_ACCOUNTS, LOCKED_POSITIONS, LOCKED_STRATEGY);

  it('never routes a trade to the locked account', () => {
    expect(resolvedTrades.some(t => t.accountId === 'locked-ira')).toBe(false);
  });

  it('renders the locked badge in the account section', () => {
    const html = buildHtml(result, LOCKED_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('Legacy IRA');
    expect(html).toContain('locked');
  });
});

// ─── Scenario G: HTML escaping of untrusted-ish strings ─────────────────────

describe('exportReport buildHtml — HTML escaping', () => {
  const XSS_ACCOUNTS: Account[] = [
    { id: 'schwab', name: 'Schwab <script>alert(1)</script> & "Co"', institution: 'Schwab', type: 'TAXABLE' },
  ];
  const XSS_POSITIONS: Position[] = [
    { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
  ];
  const XSS_STRATEGY = {
    ...ZERO_TOL_STRATEGY,
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 1.0 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'] }),
  };
  const { result, resolvedTrades } = runScenario(XSS_ACCOUNTS, XSS_POSITIONS, XSS_STRATEGY);

  it('escapes angle brackets and ampersands in account names', () => {
    const html = buildHtml(result, XSS_ACCOUNTS, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&amp;');
    expect(html).toContain('&quot;Co&quot;');
  });

  it('escapes an unmapped-ticker holding name in the UNMAPPED_HOLDING flag', () => {
    const unmappedAccounts: Account[] = [
      { id: 'schwab', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
    ];
    const unmappedPositions: Position[] = [
      { accountId: 'schwab', ticker: '<WEIRD&TICKER>', marketValue: 1_000 },
    ];
    const { result: r2, resolvedTrades: rt2 } = runScenario(unmappedAccounts, unmappedPositions, XSS_STRATEGY);
    expect(r2.flags.some(f => f.kind === 'UNMAPPED_HOLDING')).toBe(true);
    const html = buildHtml(r2, unmappedAccounts, rt2, 0, 0, FIXED_NOW);
    expect(html).toContain('&lt;WEIRD&amp;TICKER&gt;');
    expect(html).not.toContain('<WEIRD&TICKER>');
  });
});

// ─── Scenario H: empty household (no accounts, no positions) ────────────────

describe('exportReport buildHtml — empty household edge case', () => {
  it('does not throw and still emits a valid HTML document', () => {
    const { result, resolvedTrades } = runScenario([], [], ZERO_TOL_STRATEGY);
    const html = buildHtml(result, [], resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('$0');
    expect(resolvedTrades).toHaveLength(0);
  });
});

// ─── Scenario I: locked accounts must not produce empty Cash/Withdrawal cards
// (issue #165 — render condition and row builder disagreed about which accounts
// to include, so a locked-only newCash/rmdDueUsd rendered a header with no rows) ──

describe('exportReport buildHtml — locked-only cash/withdrawal sources (issue #165)', () => {
  const FI_ONLY_STRATEGY = {
    ...ZERO_TOL_STRATEGY,
    targets: { ...ZERO_TARGETS, FIXED_INCOME: 1.0 },
    placement: fillPlacement({ FIXED_INCOME: ['TAXABLE'] }),
  };

  it('does not render a Cash deployment card when only a locked account has newCash', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' },
      { id: 'locked-ira', name: 'Legacy IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true, newCash: 5_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
      { accountId: 'locked-ira', ticker: 'FSKAX', marketValue: 50_000 },
    ];
    const { result, resolvedTrades } = runScenario(accounts, positions, FI_ONLY_STRATEGY);
    const html = buildHtml(result, accounts, resolvedTrades, 0, 0, FIXED_NOW);
    // Note: an HTML comment placeholder `<!-- Cash deployment -->` is always emitted
    // as a template marker, so assert on the actual card header markup, not the raw title text.
    expect(html).not.toContain('<span>Cash deployment</span>');
  });

  it('does not render a Spending / withdrawal plan card when only a locked account has rmdDueUsd', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE' },
      { id: 'locked-ira', name: 'Legacy IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true, rmdDueUsd: 5_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
      { accountId: 'locked-ira', ticker: 'FSKAX', marketValue: 50_000 },
    ];
    const { result, resolvedTrades } = runScenario(accounts, positions, FI_ONLY_STRATEGY);
    const html = buildHtml(result, accounts, resolvedTrades, 0, 0, FIXED_NOW);
    // Note: an HTML comment placeholder `<!-- Spending / withdrawal plan -->` is always
    // emitted as a template marker, so assert on the actual card header markup.
    expect(html).not.toContain('<span>Spending / withdrawal plan</span>');
  });

  it('renders Cash deployment with only the unlocked row when locked and unlocked accounts both have newCash', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE', newCash: 10_000 },
      { id: 'locked-ira', name: 'Legacy IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true, newCash: 5_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
      { accountId: 'locked-ira', ticker: 'FSKAX', marketValue: 50_000 },
    ];
    const { result, resolvedTrades } = runScenario(accounts, positions, FI_ONLY_STRATEGY);
    const html = buildHtml(result, accounts, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('<span>Cash deployment</span>');
    // Locked accounts still appear elsewhere in the report (per-account section), so
    // scope the "no locked row" check to just the Cash deployment card's own markup.
    const cashSection = html.slice(html.indexOf('<span>Cash deployment</span>'), html.indexOf('<!-- Spending / withdrawal plan -->'));
    expect(cashSection).toContain('Schwab Brokerage');
    expect(cashSection).not.toContain('Legacy IRA');
  });

  it('renders Spending / withdrawal plan with only the unlocked row when locked and unlocked accounts both have rmdDueUsd', () => {
    const accounts: Account[] = [
      { id: 'schwab', name: 'Schwab Brokerage', institution: 'Schwab', type: 'TAXABLE', rmdDueUsd: 3_000 },
      { id: 'locked-ira', name: 'Legacy IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA', locked: true, rmdDueUsd: 5_000 },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'MUNY', marketValue: 100_000 },
      { accountId: 'locked-ira', ticker: 'FSKAX', marketValue: 50_000 },
    ];
    const { result, resolvedTrades } = runScenario(accounts, positions, FI_ONLY_STRATEGY);
    const html = buildHtml(result, accounts, resolvedTrades, 0, 0, FIXED_NOW);
    expect(html).toContain('<span>Spending / withdrawal plan</span>');
    // Locked accounts still appear elsewhere in the report (per-account section), so
    // scope the "no locked row" check to just the withdrawal card's own markup.
    const wdSection = html.slice(html.indexOf('<span>Spending / withdrawal plan</span>'), html.indexOf('<!-- Allocation table -->'));
    expect(wdSection).toContain('Schwab Brokerage');
    expect(wdSection).not.toContain('Legacy IRA');
  });
});
