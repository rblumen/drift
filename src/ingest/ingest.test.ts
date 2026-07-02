import { describe, it, expect } from 'vitest';
import { parsePosition, parseStrategy, safeParseStrategy, parsePortfolio, parseAccount } from './schema';
import { parseCsv, parseMoney } from './csv';
import { parseSchwabCsv, parseSchwabMultiCsv } from './adapters/schwab';
import { parseFidelityCsv, parseFidelityMultiCsv } from './adapters/fidelity';
import { parseEmpowerCsv, parseEmpowerTotals, EMPOWER_TICKER } from './adapters/empower';
import { parseVanguardCsv, parseVanguardMultiCsv } from './adapters/vanguard';
import { parseEtradeCsv } from './adapters/etrade';
import { parseMerrillCsv, parseMerrillMultiCsv } from './adapters/merrill';
import { detectFormat } from './detect';
import { DEFAULT_STRATEGY } from '../engine/strategy';

import schwabCsv from '../data/fixtures/schwab-sample.csv?raw';
import schwabMultiCsv from '../data/fixtures/schwab-multi-sample.csv?raw';
import fidelityCsv from '../data/fixtures/fidelity-sample.csv?raw';
import fidelityMultiCsv from '../data/fixtures/fidelity-multi-sample.csv?raw';
import empowerCsv from '../data/fixtures/empower-sample.csv?raw';
import vanguardCsv from '../data/fixtures/vanguard-sample.csv?raw';
import vanguardMultiCsv from '../data/fixtures/vanguard-multi-sample.csv?raw';
import etradeCsv from '../data/fixtures/etrade-sample.csv?raw';
import merrillCsv from '../data/fixtures/merrill-sample.csv?raw';
import merrillMultiCsv from '../data/fixtures/merrill-multi-sample.csv?raw';

// ─── parseMoney ──────────────────────────────────────────────────────────────

describe('parseMoney', () => {
  it('handles plain numbers', () => {
    expect(parseMoney('1234.56')).toBeCloseTo(1234.56);
  });
  it('strips dollar signs and commas', () => {
    expect(parseMoney('$24,050.00')).toBeCloseTo(24050);
  });
  it('handles negative values', () => {
    expect(parseMoney('$-50.00')).toBeCloseTo(-50);
  });
  it('returns NaN for empty/undefined', () => {
    expect(parseMoney('')).toBeNaN();
    expect(parseMoney(undefined)).toBeNaN();
  });
});

// ─── schema validation ────────────────────────────────────────────────────────

describe('parsePosition', () => {
  it('parses a valid position', () => {
    const pos = parsePosition({ accountId: 'a1', ticker: 'VTI', marketValue: 10000 });
    expect(pos.ticker).toBe('VTI');
    expect(pos.marketValue).toBe(10000);
  });
  it('throws on missing accountId', () => {
    expect(() => parsePosition({ ticker: 'VTI', marketValue: 1000 })).toThrow();
  });
  it('throws on negative marketValue', () => {
    expect(() => parsePosition({ accountId: 'a1', ticker: 'VTI', marketValue: -1 })).toThrow();
  });
  it('accepts zero marketValue', () => {
    const pos = parsePosition({ accountId: 'a1', ticker: 'CASH', marketValue: 0 });
    expect(pos.marketValue).toBe(0);
  });
  it('accepts optional price field', () => {
    const pos = parsePosition({ accountId: 'a1', ticker: 'VTI', marketValue: 1000, price: 240.50 });
    expect(pos.price).toBeCloseTo(240.50);
  });
});

describe('parseAccount — deposit eligibility', () => {
  const base = { id: 'a1', name: 'Roth', institution: 'Fidelity', type: 'ROTH_IRA' as const };

  it('accepts an account with no deposit fields (unlimited)', () => {
    const a = parseAccount(base);
    expect(a.acceptsDeposits).toBeUndefined();
    expect(a.depositLimitUsd).toBeUndefined();
  });
  it('accepts a non-negative depositLimitUsd', () => {
    expect(parseAccount({ ...base, depositLimitUsd: 4000 }).depositLimitUsd).toBe(4000);
    expect(parseAccount({ ...base, depositLimitUsd: 0 }).depositLimitUsd).toBe(0);
  });
  it('rejects a negative depositLimitUsd', () => {
    expect(() => parseAccount({ ...base, depositLimitUsd: -1 })).toThrow();
  });

  it('accepts withdrawal fields (eligibility, priority, RMD)', () => {
    const a = parseAccount({
      ...base, acceptsWithdrawals: true, withdrawalPriority: 20, rmdDueUsd: 3000,
    });
    expect(a.acceptsWithdrawals).toBe(true);
    expect(a.withdrawalPriority).toBe(20);
    expect(a.rmdDueUsd).toBe(3000);
  });
  it('rejects negative withdrawalPriority / rmdDueUsd', () => {
    expect(() => parseAccount({ ...base, withdrawalPriority: -1 })).toThrow();
    expect(() => parseAccount({ ...base, rmdDueUsd: -1 })).toThrow();
  });
});

describe('parseStrategy (sum-to-1 validation)', () => {
  it('accepts DEFAULT_STRATEGY', () => {
    expect(() => parseStrategy(DEFAULT_STRATEGY)).not.toThrow();
  });

  it('rejects weights that sum to less than 0.999', () => {
    const bad = {
      ...DEFAULT_STRATEGY,
      targets: { ...DEFAULT_STRATEGY.targets, CASH: 0.1 }, // now sums > 1.0
    };
    const r = safeParseStrategy(bad);
    expect(r.ok).toBe(false);
  });

  it('rejects weights that sum to more than 1.001', () => {
    const bad = {
      ...DEFAULT_STRATEGY,
      targets: { ...DEFAULT_STRATEGY.targets, US_TOTAL_MARKET: 0.70 }, // overshoots
    };
    const r = safeParseStrategy(bad);
    expect(r.ok).toBe(false);
  });

  it('accepts weights within ±0.001 of 1.0', () => {
    const slightly_off = {
      ...DEFAULT_STRATEGY,
      targets: { ...DEFAULT_STRATEGY.targets, CASH: 0.0005 }, // sum ≈ 1.0005
    };
    const r = safeParseStrategy(slightly_off);
    expect(r.ok).toBe(true);
  });
});

// Guards the issue #127 refactor: targetsSchema is now generated from
// ALL_ASSET_CLASSES via Object.fromEntries instead of a hand-typed object. These
// lock in the behavior the hand-written schema had, so the derivation can never
// silently relax field-level constraints (required classes, defaults, sum-refine).
describe('parseStrategy (derived targets schema — issue #127)', () => {
  it('rejects a strategy missing a required target class', () => {
    // US_TOTAL_MARKET has no default — omitting it must fail (it was required
    // before #127 and must stay required after).
    const { US_TOTAL_MARKET: _omit, ...rest } = DEFAULT_STRATEGY.targets;
    const bad = { ...DEFAULT_STRATEGY, targets: rest };
    const r = safeParseStrategy(bad);
    expect(r.ok).toBe(false);
  });

  it('defaults an omitted optional target class to 0', () => {
    // US_LARGE_CAP carries .default(0); dropping it must not fail, and the parsed
    // value must reappear as 0. Rebuild targets so the remaining weights still sum
    // to 1.0 (fold US_LARGE_CAP's 0.385 back into US_TOTAL_MARKET).
    const { US_LARGE_CAP, ...rest } = DEFAULT_STRATEGY.targets;
    const targets = { ...rest, US_TOTAL_MARKET: rest.US_TOTAL_MARKET + US_LARGE_CAP };
    const parsed = parseStrategy({ ...DEFAULT_STRATEGY, targets });
    expect(parsed.targets.US_LARGE_CAP).toBe(0);
  });

  it('still enforces the sum refine after derivation (0.9 rejected)', () => {
    // Scale every weight to 0.9 total — a config the old schema rejected and the
    // generic reduce-based refine must keep rejecting.
    const targets = Object.fromEntries(
      Object.entries(DEFAULT_STRATEGY.targets).map(([k, v]) => [k, v * 0.9]),
    ) as typeof DEFAULT_STRATEGY.targets;
    const r = safeParseStrategy({ ...DEFAULT_STRATEGY, targets });
    expect(r.ok).toBe(false);
  });

  it('strips unknown asset classes rather than accepting them', () => {
    // z.object strips unknown keys; a bogus class must not survive into the parsed
    // strategy (and must not be counted toward the sum). Fold its weight nowhere —
    // adding it on top would also break the sum, so keep the valid targets intact.
    const parsed = parseStrategy({
      ...DEFAULT_STRATEGY,
      targets: { ...DEFAULT_STRATEGY.targets, NOT_A_CLASS: 0.0 } as unknown as typeof DEFAULT_STRATEGY.targets,
    });
    expect('NOT_A_CLASS' in parsed.targets).toBe(false);
  });
});

describe('parsePortfolio', () => {
  it('parses the sample-portfolio.json shape', () => {
    const raw = {
      accounts: [
        { id: 'a', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' },
      ],
      positions: [
        { accountId: 'a', ticker: 'VTI', marketValue: 50000 },
      ],
    };
    const p = parsePortfolio(raw);
    expect(p.accounts).toHaveLength(1);
    expect(p.positions).toHaveLength(1);
  });

  it('throws when an account has an unknown type', () => {
    expect(() => parsePortfolio({
      accounts: [{ id: 'a', name: 'x', institution: 'x', type: 'SAVINGS' }],
      positions: [],
    })).toThrow();
  });
});

// ─── generic CSV parser ───────────────────────────────────────────────────────

describe('parseCsv — generic', () => {
  const CSV = [
    'Ticker,Market Value,Price',
    'VTI,"$24,050.00","$240.50"',
    'MUNY,"$10,420.00","$52.10"',
    '--,"$530.00",',          // placeholder row — should be skipped
    'Account Total,"$35,000.00",', // no ticker match after strip — skipped
  ].join('\n');

  it('parses valid rows', () => {
    const r = parseCsv(CSV, 'acct1', { ticker: 'Ticker', marketValue: 'Market Value', price: 'Price' });
    expect(r.positions).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it('correctly maps ticker and marketValue', () => {
    const r = parseCsv(CSV, 'acct1', { ticker: 'Ticker', marketValue: 'Market Value' });
    expect(r.positions[0].ticker).toBe('VTI');
    expect(r.positions[0].marketValue).toBeCloseTo(24050);
  });

  it('attaches accountId to every position', () => {
    const r = parseCsv(CSV, 'my-account', { ticker: 'Ticker', marketValue: 'Market Value' });
    expect(r.positions.every(p => p.accountId === 'my-account')).toBe(true);
  });

  it('skips rows with ticker "--"', () => {
    const r = parseCsv(CSV, 'acct1', { ticker: 'Ticker', marketValue: 'Market Value' });
    expect(r.positions.every(p => p.ticker !== '--')).toBe(true);
  });

  it('strips trailing asterisks from tickers', () => {
    const CSV_WITH_STAR = [
      'Ticker,Market Value',
      'FDRXX**,"$11,931.55"',
    ].join('\n');
    const r = parseCsv(CSV_WITH_STAR, 'acct1', { ticker: 'Ticker', marketValue: 'Market Value' });
    expect(r.positions[0].ticker).toBe('FDRXX');
  });

  it('skips rows with negative market value', () => {
    const CSV_NEG = [
      'Ticker,Market Value',
      'PENDING,"-$9,604.84"',
    ].join('\n');
    const r = parseCsv(CSV_NEG, 'acct1', { ticker: 'Ticker', marketValue: 'Market Value' });
    expect(r.positions).toHaveLength(0);
  });
});

// ─── Schwab adapter ───────────────────────────────────────────────────────────

describe('parseSchwabCsv', () => {
  it('returns at least one position from the sample fixture', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    expect(r.positions.length).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
  });

  it('parses MUNY with correct market value', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    const muny = r.positions.find(p => p.ticker === 'MUNY');
    expect(muny).toBeDefined();
    expect(muny!.marketValue).toBeCloseTo(200_012.90, 0);
  });

  it('captures the Cash & Cash Investments row as a SCHWAB_CASH position (#54)', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    const cash = r.positions.find(p => p.ticker === 'SCHWAB_CASH');
    expect(cash).toBeDefined();
    expect(cash!.marketValue).toBeCloseTo(12_750, 0);
  });

  it('SCHWAB_CASH classifies as CASH', async () => {
    const { classifyTicker } = await import('../engine/classify');
    expect(classifyTicker('SCHWAB_CASH')).toBe('CASH');
  });

  it('does not emit a position with a placeholder "--" ticker', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    expect(r.positions.every(p => p.ticker !== '--')).toBe(true);
  });

  it('omits the cash row when its balance is $0', () => {
    const zeroCash = schwabCsv.replace('"$12,750.00"', '"$0.00"');
    const r = parseSchwabCsv(zeroCash, 'schwab-taxable');
    expect(r.positions.some(p => p.ticker === 'SCHWAB_CASH')).toBe(false);
  });

  it('skips the Positions Total footer row', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    expect(r.positions.every(p => p.ticker !== 'Positions Total')).toBe(true);
  });

  it('parses price when present', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    const muny = r.positions.find(p => p.ticker === 'MUNY');
    expect(muny?.price).toBeCloseTo(52.10, 2);
  });

  it('parses cost basis when present (issue #7)', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    const muny = r.positions.find(p => p.ticker === 'MUNY');
    expect(muny?.costBasis).toBeCloseTo(198_000, 0);
  });
});

// ─── Schwab multi-account (all-accounts) adapter ──────────────────────────────

describe('parseSchwabMultiCsv', () => {
  it('discovers three accounts from the all-accounts fixture', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    expect(r.discovered).toHaveLength(3);
    expect(r.errors).toHaveLength(0);
  });

  it('preserves account order of first appearance', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    expect(r.discovered[0].accountNumber).toBe('...001');
    expect(r.discovered[1].accountNumber).toBe('...985');
    expect(r.discovered[2].accountNumber).toBe('...159');
  });

  it('parses account names (underscores → spaces, suffix stripped)', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    expect(r.discovered[0].accountName).toBe('Roth Contributory IRA');
    expect(r.discovered[1].accountName).toBe('Comm Prop with Right of Survivorship');
    expect(r.discovered[2].accountName).toBe('Contributory');
  });

  it('groups positions under each account, skipping footer rows', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    // ...001: SCHF, SWTSX, plus SCHWAB_CASH
    expect(r.positionsByNumber['...001'].map(p => p.ticker).sort())
      .toEqual(['SCHF', 'SCHWAB_CASH', 'SWTSX']);
    // ...985: MUNY, SWTSX, SWYXX, plus SCHWAB_CASH
    expect(r.positionsByNumber['...985']).toHaveLength(4);
  });

  it('captures each account\'s free cash as SCHWAB_CASH (#54 + #55)', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    const cash985 = r.positionsByNumber['...985'].find(p => p.ticker === 'SCHWAB_CASH');
    expect(cash985?.marketValue).toBeCloseTo(127_223.79, 2);
    // A tiny residual-cash account is still captured.
    const cash159 = r.positionsByNumber['...159'].find(p => p.ticker === 'SCHWAB_CASH');
    expect(cash159?.marketValue).toBeCloseTo(0.02, 2);
  });

  it('parses market value and cost basis per position', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    const muny = r.positionsByNumber['...985'].find(p => p.ticker === 'MUNY');
    expect(muny?.marketValue).toBeCloseTo(65_173.50, 2);
    expect(muny?.costBasis).toBeCloseTo(64_695.15, 2);
  });

  it('uses the masked account number as placeholder accountId', () => {
    const r = parseSchwabMultiCsv(schwabMultiCsv);
    expect(r.positionsByNumber['...001'].every(p => p.accountId === '...001')).toBe(true);
  });

  it('handles a single-account export (one discovered account)', () => {
    const r = parseSchwabMultiCsv(schwabCsv);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].accountName).toBe('XXXX-1234');
    const tickers = r.positionsByNumber[r.discovered[0].accountNumber].map(p => p.ticker);
    expect(tickers).toContain('MUNY');
    expect(tickers).toContain('SCHWAB_CASH');
  });
});

// ─── Fidelity adapter ─────────────────────────────────────────────────────────

describe('parseFidelityCsv', () => {
  it('returns four positions from the sample fixture', () => {
    const r = parseFidelityCsv(fidelityCsv, 'fidelity-ira');
    expect(r.positions).toHaveLength(4);
    expect(r.errors).toHaveLength(0);
  });

  it('parses FZROX with correct market value', () => {
    const r = parseFidelityCsv(fidelityCsv, 'fidelity-ira');
    const fzrox = r.positions.find(p => p.ticker === 'FZROX');
    expect(fzrox).toBeDefined();
    expect(fzrox!.marketValue).toBeCloseTo(215_495, 0);
  });

  it('skips the empty-symbol Pending Activity row', () => {
    const r = parseFidelityCsv(fidelityCsv, 'fidelity-ira');
    expect(r.positions.every(p => p.ticker !== '')).toBe(true);
  });

  it('attaches the supplied accountId', () => {
    const r = parseFidelityCsv(fidelityCsv, 'fidelity-ira');
    expect(r.positions.every(p => p.accountId === 'fidelity-ira')).toBe(true);
  });

  it('parses cost basis when present (issue #7)', () => {
    const r = parseFidelityCsv(fidelityCsv, 'fidelity-ira');
    const fzrox = r.positions.find(p => p.ticker === 'FZROX');
    expect(fzrox?.costBasis).toBeCloseTo(200_495, 0);
  });
});

// ─── Fidelity multi-account adapter ──────────────────────────────────────────

describe('parseFidelityMultiCsv', () => {
  it('discovers two accounts from the multi-account fixture', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.discovered).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it('preserves account order of first appearance', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.discovered[0].accountNumber).toBe('Z00000001');
    expect(r.discovered[1].accountNumber).toBe('Z00000002');
  });

  it('captures account names', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.discovered[0].accountName).toBe('Fidelity Traditional IRA');
    expect(r.discovered[1].accountName).toBe('Fidelity Roth IRA');
  });

  it('returns 2 positions for account Z00000001 (skips Pending Activity)', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.positionsByNumber['Z00000001']).toHaveLength(2);
  });

  it('returns 2 positions for account Z00000002', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.positionsByNumber['Z00000002']).toHaveLength(2);
  });

  it('parses market values correctly for each account', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    const trad = r.positionsByNumber['Z00000001'];
    const fzrox = trad.find(p => p.ticker === 'FZROX');
    expect(fzrox?.marketValue).toBeCloseTo(215_495, 0);

    const roth = r.positionsByNumber['Z00000002'];
    const fxnax = roth.find(p => p.ticker === 'FXNAX');
    expect(fxnax?.marketValue).toBeCloseTo(20_232, 0);
  });

  it('uses accountNumber as placeholder accountId', () => {
    const r = parseFidelityMultiCsv(fidelityMultiCsv);
    expect(r.positionsByNumber['Z00000001'].every(p => p.accountId === 'Z00000001')).toBe(true);
    expect(r.positionsByNumber['Z00000002'].every(p => p.accountId === 'Z00000002')).toBe(true);
  });

  it('single-account file returns one discovered account, no mapping UI needed', () => {
    const r = parseFidelityMultiCsv(fidelityCsv);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].accountNumber).toBe('Z00000001');
  });

  it('ignores footer disclaimer rows after the first blank line', () => {
    // Inline CSV that mimics a real Fidelity export with a footer block.
    const csv = [
      'Account Number,Account Name,Symbol,Description,Quantity,Last Price,Last Price Change,Current Value,Today\'s Gain/Loss Dollar,Today\'s Gain/Loss Percent,Total Gain/Loss Dollar,Total Gain/Loss Percent,Percent Of Account,Cost Basis Total,Average Cost Basis,Type',
      'Z99,Test IRA,FZROX,FIDELITY ZERO TOTAL MARKET INDEX FUND,100,$18.34,$0.12,"$1,834.00",,,,,,,,,',
      '',   // blank line — footer begins here
      '"The data and information in this spreadsheet is provided to you solely for your use."',
      '',
      '"Date downloaded May-25-2026 9:26 p.m ET"',
    ].join('\n');
    const r = parseFidelityMultiCsv(csv);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].accountNumber).toBe('Z99');
    expect(r.positionsByNumber['Z99']).toHaveLength(1);
    expect(r.errors).toHaveLength(0);
  });
});

// ─── Empower CSV adapter ──────────────────────────────────────────────────────

describe('parseEmpowerCsv', () => {
  it('returns positions for each fund in the sample fixture', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    expect(r.positions.length).toBeGreaterThan(0);
    expect(r.errors).toHaveLength(0);
  });

  it('returns two positions from the two-fund fixture', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    expect(r.positions).toHaveLength(2);
  });

  it('parses VTI with correct market value', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    const vti = r.positions.find(p => p.ticker === 'VTI');
    expect(vti).toBeDefined();
    expect(vti!.marketValue).toBeCloseTo(50_000, 0);
  });

  it('parses FXNAX with correct market value', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    const bond = r.positions.find(p => p.ticker === 'FXNAX');
    expect(bond).toBeDefined();
    expect(bond!.marketValue).toBeCloseTo(20_000, 0);
  });

  it('preserves fund description from row 1', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    const vti = r.positions.find(p => p.ticker === 'VTI');
    expect(vti?.description).toBe('Vanguard Total Stock Market ETF');
  });

  it('attaches the supplied accountId to all positions', () => {
    const r = parseEmpowerCsv(empowerCsv, 'empower-401k');
    expect(r.positions.every(p => p.accountId === 'empower-401k')).toBe(true);
  });

  it('skips funds with zero balance', () => {
    const csvWithZero = [
      'Holding,VTI,FXNAX',
      'Shares,Total Market,Bond Index',
      'Price,100.00,50.00',
      ',"$50,000.00","$0.00"',
    ].join('\n');
    const r = parseEmpowerCsv(csvWithZero, 'empower-401k');
    expect(r.positions).toHaveLength(1);
    expect(r.positions[0].ticker).toBe('VTI');
  });
});

// ─── Empower manual-entry adapter ────────────────────────────────────────────

describe('parseEmpowerTotals', () => {
  it('creates one position per non-zero class', () => {
    const positions = parseEmpowerTotals('empower-401k', {
      US_TOTAL_MARKET: 300_000,
      FIXED_INCOME:     50_000,
      CASH:             20_000,
    });
    expect(positions).toHaveLength(3);
  });

  it('omits classes with zero or missing totals', () => {
    const positions = parseEmpowerTotals('empower-401k', {
      US_TOTAL_MARKET: 100_000,
      FIXED_INCOME: 0,
    });
    expect(positions.every(p => p.marketValue > 0)).toBe(true);
    expect(positions).toHaveLength(1);
  });

  it('uses the EMPOWER_* ticker convention', () => {
    const positions = parseEmpowerTotals('empower-401k', { US_TOTAL_MARKET: 100_000 });
    expect(positions[0].ticker).toBe(EMPOWER_TICKER.US_TOTAL_MARKET);
  });

  it('attaches the supplied accountId', () => {
    const positions = parseEmpowerTotals('empower-401k', { FIXED_INCOME: 50_000 });
    expect(positions[0].accountId).toBe('empower-401k');
  });

  it('EMPOWER_* tickers are in assetclass-map so classify resolves them', async () => {
    const { classifyTicker } = await import('../engine/classify');
    expect(classifyTicker('EMPOWER_US')).toBe('US_TOTAL_MARKET');
    expect(classifyTicker('EMPOWER_INTL')).toBe('DEVELOPED_INTL');
    expect(classifyTicker('EMPOWER_EM')).toBe('EMERGING_INTL');
    expect(classifyTicker('EMPOWER_FI')).toBe('FIXED_INCOME');
    expect(classifyTicker('EMPOWER_ALT')).toBe('ALTERNATIVES');
    expect(classifyTicker('EMPOWER_CASH')).toBe('CASH');
  });
});

// ─── Vanguard adapter ─────────────────────────────────────────────────────────

describe('parseVanguardCsv', () => {
  it('returns four positions from the sample fixture', () => {
    const r = parseVanguardCsv(vanguardCsv, 'vanguard-brokerage');
    expect(r.positions).toHaveLength(4);
    expect(r.errors).toHaveLength(0);
  });

  it('parses VTI market value, price, and description', () => {
    const r = parseVanguardCsv(vanguardCsv, 'vanguard-brokerage');
    const vti = r.positions.find(p => p.ticker === 'VTI');
    expect(vti).toBeDefined();
    expect(vti!.marketValue).toBeCloseTo(19_830.50, 2);
    expect(vti!.price).toBeCloseTo(198.305, 3);
    expect(vti!.description).toBe('VANGUARD TOTAL STOCK MARKET ETF');
  });

  it('captures the VMFXX money-market line (classifies as CASH)', async () => {
    const r = parseVanguardCsv(vanguardCsv, 'vanguard-brokerage');
    const cash = r.positions.find(p => p.ticker === 'VMFXX');
    expect(cash?.marketValue).toBeCloseTo(1_500, 2);
    const { classifyTicker } = await import('../engine/classify');
    expect(classifyTicker('VMFXX')).toBe('CASH');
  });

  it('attaches the supplied accountId (trailing comma column ignored)', () => {
    const r = parseVanguardCsv(vanguardCsv, 'vanguard-brokerage');
    expect(r.positions.every(p => p.accountId === 'vanguard-brokerage')).toBe(true);
  });

  it('rejects the legacy mutual-fund export (no Symbol column)', () => {
    const legacy = [
      'Fund Account Number,Fund Name,Price,Shares,Total Value,',
      '0584-12345678,Vanguard Total Bond Market Index Fund Admiral Shares,9.49,10,94.90,',
    ].join('\n');
    const r = parseVanguardCsv(legacy, 'vanguard-brokerage');
    expect(r.positions).toHaveLength(0);
    expect(r.errors[0]).toMatch(/legacy Vanguard mutual-fund/i);
  });
});

describe('parseVanguardMultiCsv', () => {
  it('discovers two accounts separated by a blank line', () => {
    const r = parseVanguardMultiCsv(vanguardMultiCsv);
    expect(r.discovered).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it('preserves account order and falls back to the number as the name', () => {
    const r = parseVanguardMultiCsv(vanguardMultiCsv);
    expect(r.discovered[0].accountNumber).toBe('11112222');
    // Vanguard's CSV has no account-name column, so name == number.
    expect(r.discovered[0].accountName).toBe('11112222');
    expect(r.discovered[1].accountNumber).toBe('33334444');
  });

  it('groups positions under each account', () => {
    const r = parseVanguardMultiCsv(vanguardMultiCsv);
    expect(r.positionsByNumber['11112222'].map(p => p.ticker).sort())
      .toEqual(['VMFXX', 'VTI']);
    expect(r.positionsByNumber['33334444'].map(p => p.ticker).sort())
      .toEqual(['BND', 'VXUS']);
  });

  it('uses the account number as placeholder accountId', () => {
    const r = parseVanguardMultiCsv(vanguardMultiCsv);
    expect(r.positionsByNumber['33334444'].every(p => p.accountId === '33334444')).toBe(true);
  });

  it('single-account file returns one discovered account', () => {
    const r = parseVanguardMultiCsv(vanguardCsv);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].accountNumber).toBe('12345678');
  });
});

// ─── E*TRADE adapter ──────────────────────────────────────────────────────────

describe('parseEtradeCsv', () => {
  it('finds the positions header past the variable-length preamble', () => {
    const r = parseEtradeCsv(etradeCsv, 'etrade-brokerage');
    // VTI, VXUS, ETRADE_CASH — the TOTAL and Generated-at rows are dropped.
    expect(r.positions).toHaveLength(3);
    expect(r.errors).toHaveLength(0);
  });

  it('parses VTI market value from the "Value $" column and price from "Last Price $"', () => {
    const r = parseEtradeCsv(etradeCsv, 'etrade-brokerage');
    const vti = r.positions.find(p => p.ticker === 'VTI');
    expect(vti?.marketValue).toBeCloseTo(200_770, 0);
    expect(vti?.price).toBeCloseTo(200.77, 2);
  });

  it('drops the TOTAL subtotal row', () => {
    const r = parseEtradeCsv(etradeCsv, 'etrade-brokerage');
    expect(r.positions.some(p => p.ticker === 'TOTAL')).toBe(false);
  });

  it('captures the CASH sweep row as ETRADE_CASH (classifies as CASH)', async () => {
    const r = parseEtradeCsv(etradeCsv, 'etrade-brokerage');
    const cash = r.positions.find(p => p.ticker === 'ETRADE_CASH');
    expect(cash?.marketValue).toBeCloseTo(1_225, 0);
    const { classifyTicker } = await import('../engine/classify');
    expect(classifyTicker('ETRADE_CASH')).toBe('CASH');
  });

  it('does not mistake the preamble filter row (Symbol,Security type(s)) for the header', () => {
    const r = parseEtradeCsv(etradeCsv, 'etrade-brokerage');
    expect(r.positions.map(p => p.ticker).sort()).toEqual(['ETRADE_CASH', 'VTI', 'VXUS']);
  });

  it('errors clearly when no positions header is present', () => {
    const r = parseEtradeCsv('just,some,preamble\nwith,no,header', 'etrade-brokerage');
    expect(r.positions).toHaveLength(0);
    expect(r.errors[0]).toMatch(/could not find the positions header/i);
  });
});

// ─── Merrill Edge adapter ─────────────────────────────────────────────────────

describe('parseMerrillCsv', () => {
  it('returns three positions from the sample fixture', () => {
    const r = parseMerrillCsv(merrillCsv, 'merrill-brokerage');
    expect(r.positions).toHaveLength(3);
    expect(r.errors).toHaveLength(0);
  });

  it('parses value (commas stripped), price, and description', () => {
    const r = parseMerrillCsv(merrillCsv, 'merrill-brokerage');
    const vti = r.positions.find(p => p.ticker === 'VTI');
    expect(vti?.marketValue).toBeCloseTo(19_830, 0);
    expect(vti?.price).toBeCloseTo(198.30, 2);
    expect(vti?.description).toBe('VANGUARD TOTAL STOCK MARKET ETF');
  });

  it('attaches the supplied accountId', () => {
    const r = parseMerrillCsv(merrillCsv, 'merrill-brokerage');
    expect(r.positions.every(p => p.accountId === 'merrill-brokerage')).toBe(true);
  });
});

describe('parseMerrillMultiCsv', () => {
  it('discovers two accounts by Account #', () => {
    const r = parseMerrillMultiCsv(merrillMultiCsv);
    expect(r.discovered).toHaveLength(2);
    expect(r.errors).toHaveLength(0);
  });

  it('captures the Account Nickname as the account name', () => {
    const r = parseMerrillMultiCsv(merrillMultiCsv);
    expect(r.discovered[0]).toMatchObject({ accountNumber: '99X-11111', accountName: 'Joint Brokerage' });
    expect(r.discovered[1]).toMatchObject({ accountNumber: '99X-22222', accountName: 'Roth IRA' });
  });

  it('groups positions under each account', () => {
    const r = parseMerrillMultiCsv(merrillMultiCsv);
    expect(r.positionsByNumber['99X-11111'].map(p => p.ticker).sort()).toEqual(['BND', 'VTI']);
    expect(r.positionsByNumber['99X-22222'].map(p => p.ticker).sort()).toEqual(['VWIUX', 'VXUS']);
  });

  it('single-account file returns one discovered account', () => {
    const r = parseMerrillMultiCsv(merrillCsv);
    expect(r.discovered).toHaveLength(1);
    expect(r.discovered[0].accountNumber).toBe('99X-12345');
  });
});

// ─── Content-based format detection ──────────────────────────────────────────

describe('detectFormat', () => {
  it('detects Schwab (single and all-accounts exports)', () => {
    expect(detectFormat(schwabCsv)).toBe('schwab');
    expect(detectFormat(schwabMultiCsv)).toBe('schwab');
  });

  it('detects Fidelity (single and multi-account exports)', () => {
    expect(detectFormat(fidelityCsv)).toBe('fidelity');
    expect(detectFormat(fidelityMultiCsv)).toBe('fidelity');
  });

  it('detects Vanguard (single and multi-account exports)', () => {
    expect(detectFormat(vanguardCsv)).toBe('vanguard');
    expect(detectFormat(vanguardMultiCsv)).toBe('vanguard');
  });

  it('detects E*TRADE past its preamble', () => {
    expect(detectFormat(etradeCsv)).toBe('etrade');
  });

  it('detects Merrill Edge (single and multi-account exports)', () => {
    expect(detectFormat(merrillCsv)).toBe('merrill');
    expect(detectFormat(merrillMultiCsv)).toBe('merrill');
  });

  it('detects Empower transposed layout', () => {
    expect(detectFormat(empowerCsv)).toBe('empower');
  });

  it('returns null for an unrecognised file', () => {
    expect(detectFormat('Foo,Bar,Baz\n1,2,3')).toBeNull();
    expect(detectFormat('')).toBeNull();
  });

  it('does not confuse Vanguard and Fidelity (both carry "Account Number")', () => {
    // Vanguard uses "Investment Name"/"Total Value"; Fidelity "Description"/"Current Value".
    expect(detectFormat(vanguardCsv)).not.toBe('fidelity');
    expect(detectFormat(fidelityCsv)).not.toBe('vanguard');
  });
});
