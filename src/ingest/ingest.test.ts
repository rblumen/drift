import { describe, it, expect } from 'vitest';
import { parsePosition, parseStrategy, safeParseStrategy, safeParsePosition, parsePortfolio, parseAccount } from './schema';
import { parseCsv, parseMoney } from './csv';
import { parseSchwabCsv } from './adapters/schwab';
import { parseFidelityCsv, parseFidelityMultiCsv } from './adapters/fidelity';
import { parseEmpowerCsv, parseEmpowerTotals, EMPOWER_TICKER } from './adapters/empower';
import { DEFAULT_STRATEGY } from '../engine/strategy';

import schwabCsv from '../data/fixtures/schwab-sample.csv?raw';
import fidelityCsv from '../data/fixtures/fidelity-sample.csv?raw';
import fidelityMultiCsv from '../data/fixtures/fidelity-multi-sample.csv?raw';
import empowerCsv from '../data/fixtures/empower-sample.csv?raw';

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

  it('accepts withdrawal fields (eligibility, limit, priority, RMD)', () => {
    const a = parseAccount({
      ...base, acceptsWithdrawals: true, withdrawalLimitUsd: 5000, withdrawalPriority: 20, rmdDueUsd: 3000,
    });
    expect(a.acceptsWithdrawals).toBe(true);
    expect(a.withdrawalLimitUsd).toBe(5000);
    expect(a.withdrawalPriority).toBe(20);
    expect(a.rmdDueUsd).toBe(3000);
  });
  it('rejects negative withdrawalLimitUsd / withdrawalPriority / rmdDueUsd', () => {
    expect(() => parseAccount({ ...base, withdrawalLimitUsd: -1 })).toThrow();
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

  it('skips the Cash & Cash Investments row (ticker "--")', () => {
    const r = parseSchwabCsv(schwabCsv, 'schwab-taxable');
    expect(r.positions.every(p => p.ticker !== '--')).toBe(true);
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
