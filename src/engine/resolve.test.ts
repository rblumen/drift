import { describe, it, expect } from 'vitest';
import { resolveTradeVehicles } from './resolve';
import { makeClassifier } from './classify';
import type { Trade, Position } from './types';

const classify = makeClassifier();

// ─── single-class fund ───────────────────────────────────────────────────────

describe('Resolution (supports Goal 4): single-class fund maps to its asset class', () => {
  it('annotates a sell trade with the holding ticker', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 100_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.ticker).toBe('FXAIX');
    expect(r.deltaUsd).toBe(-20_000);
    expect(r.mergedFrom).toBeUndefined();
  });

  it('annotates a buy trade with the holding ticker', () => {
    const trades: Trade[] = [
      { accountId: 'taxable', assetClass: 'FIXED_INCOME', deltaUsd: 10_000, inTaxableAccount: true },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'MUNY', marketValue: 50_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.ticker).toBe('MUNY');
  });

  it('preserves all Trade fields on the resolved output', () => {
    const trades: Trade[] = [
      { accountId: 'taxable', assetClass: 'FIXED_INCOME', deltaUsd: -5_000, inTaxableAccount: true },
    ];
    const positions: Position[] = [
      { accountId: 'taxable', ticker: 'MUNY', marketValue: 20_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.accountId).toBe('taxable');
    expect(r.assetClass).toBe('FIXED_INCOME');
    expect(r.inTaxableAccount).toBe(true);
  });
});

// ─── blended fund merging (US_TOTAL_MARKET) ──────────────────────────────────

describe('Resolution (supports Goal 4): blended fund merges into US_TOTAL_MARKET', () => {
  it('merges LC + MC + SC trades into one FSKAX trade', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'US_MID_CAP',   deltaUsd:  -7_500, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'US_SMALL_CAP', deltaUsd:  -2_400, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FSKAX', marketValue: 300_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, {}, classify);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('FSKAX');
    expect(result[0].deltaUsd).toBeCloseTo(-29_900, 0);
    expect(result[0].assetClass).toBe('US_TOTAL_MARKET');
    expect(result[0].mergedFrom).toHaveLength(3);
  });

  it('mergedFrom records each constituent class and amount', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'US_MID_CAP',   deltaUsd:  -7_500, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FSKAX', marketValue: 200_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    const classes = r.mergedFrom!.map(m => m.assetClass);
    expect(classes).toContain('US_LARGE_CAP');
    expect(classes).toContain('US_MID_CAP');
  });

  it('preserves inTaxableAccount from source trades', () => {
    const trades: Trade[] = [
      { accountId: 'schwab', assetClass: 'US_LARGE_CAP', deltaUsd: -10_000, inTaxableAccount: true },
      { accountId: 'schwab', assetClass: 'US_MID_CAP',   deltaUsd:  -3_000, inTaxableAccount: true },
    ];
    const positions: Position[] = [
      { accountId: 'schwab', ticker: 'VTI', marketValue: 100_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.inTaxableAccount).toBe(true);
  });

  it('does not merge trades that belong to different tickers', () => {
    // FSKAX covers LC/MC/SC; MUNY covers FIXED_INCOME — two separate resolved trades.
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -10_000, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'FIXED_INCOME', deltaUsd:   5_000, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FSKAX', marketValue: 100_000 },
      { accountId: 'ira', ticker: 'MUNY',  marketValue:  50_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, {}, classify);
    expect(result).toHaveLength(2);
    // Single LC trade via FSKAX — no merge, assetClass stays as the engine-level class.
    expect(result.find(r => r.ticker === 'FSKAX')?.assetClass).toBe('US_LARGE_CAP');
    expect(result.find(r => r.ticker === 'MUNY')?.assetClass).toBe('FIXED_INCOME');
  });
});

// ─── greenfield (no current positions) ───────────────────────────────────────

describe('Resolution (supports Goal 4): greenfield with no current positions', () => {
  it('emits trade without ticker when no holding covers the class', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: 50_000, inTaxableAccount: false },
    ];
    const [r] = resolveTradeVehicles(trades, [], {}, classify);
    expect(r.ticker).toBeUndefined();
    expect(r.deltaUsd).toBe(50_000);
  });

  it('still returns one result per unresolved trade', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP',  deltaUsd: 50_000, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'FIXED_INCOME',  deltaUsd: 20_000, inTaxableAccount: false },
    ];
    const result = resolveTradeVehicles(trades, [], {}, classify);
    expect(result).toHaveLength(2);
    result.forEach(r => expect(r.ticker).toBeUndefined());
  });
});

// ─── ambiguous resolution (multiple tickers cover the same class) ─────────────

describe('Resolution (supports Goal 4): ambiguous — multiple tickers cover the same class', () => {
  it('emits trade without ticker when two exact-class funds (FXAIX, VOO) both cover LC', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 50_000 },  // US_LARGE_CAP
      { accountId: 'ira', ticker: 'VOO',   marketValue: 50_000 },  // US_LARGE_CAP
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.ticker).toBeUndefined();
  });

  it('still resolves unambiguous classes in the same account', () => {
    // MUNY covers only FIXED_INCOME → unambiguous; FXAIX+VOO both exactly LC → ambiguous.
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'FIXED_INCOME', deltaUsd:  10_000, inTaxableAccount: false },
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'MUNY',  marketValue: 50_000 },
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 30_000 },
      { accountId: 'ira', ticker: 'VOO',   marketValue: 30_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, {}, classify);
    const fi = result.find(r => r.assetClass === 'FIXED_INCOME');
    const lc = result.find(r => r.assetClass === 'US_LARGE_CAP');
    expect(fi?.ticker).toBe('MUNY');
    expect(lc?.ticker).toBeUndefined();
  });
});

// ─── exact-class holding beats a parent fund (issue #228) ────────────────────

describe('Resolution (supports Goal 4): exact-class holding preferred over a parent fund (#228)', () => {
  it('routes a LC sell to FXAIX, not the total-market fund that only covers LC via the hierarchy', () => {
    const trades: Trade[] = [
      { accountId: 'ira', assetClass: 'US_LARGE_CAP', deltaUsd: -20_000, inTaxableAccount: false },
    ];
    const positions: Position[] = [
      { accountId: 'ira', ticker: 'FXAIX', marketValue: 50_000 },  // US_LARGE_CAP
      { accountId: 'ira', ticker: 'FSKAX', marketValue: 50_000 },  // US_TOTAL_MARKET → LC/MC/SC
    ];
    const [r] = resolveTradeVehicles(trades, positions, {}, classify);
    expect(r.ticker).toBe('FXAIX');
  });

  it('labels the sub-class sell and merges the buy-back with the plain LC buy into one VOO trade', () => {
    // Mirrors the #228 report: SCHB liquidated as a unit (forceTicker), its LC
    // sleeve bought back via VOO (excludeTickers), plus an ordinary LC buy and a
    // MC sell that previously came out ticker-less.
    const trades: Trade[] = [
      { accountId: 'k401', assetClass: 'US_MID_CAP',   deltaUsd:  -6_000, inTaxableAccount: false },
      { accountId: 'k401', assetClass: 'US_LARGE_CAP', deltaUsd:  12_500, inTaxableAccount: false },
      { accountId: 'k401', assetClass: 'US_LARGE_CAP', deltaUsd: -17_420, inTaxableAccount: false, forceTicker: 'SCHB' },
      { accountId: 'k401', assetClass: 'US_LARGE_CAP', deltaUsd:  17_420, inTaxableAccount: false, excludeTickers: ['SCHB'] },
      { accountId: 'k401', assetClass: 'US_MID_CAP',   deltaUsd:  -6_500, inTaxableAccount: false, forceTicker: 'SCHB' },
      { accountId: 'k401', assetClass: 'US_SMALL_CAP', deltaUsd:  -2_080, inTaxableAccount: false, forceTicker: 'SCHB' },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'SCHB', marketValue: 26_000 },
      { accountId: 'k401', ticker: 'VOO',  marketValue: 25_000 },
      { accountId: 'k401', ticker: 'VO',   marketValue:  6_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, {}, classify);
    expect(result.every(r => r.ticker !== undefined)).toBe(true);
    expect(result.find(r => r.ticker === 'VO')?.deltaUsd).toBeCloseTo(-6_000, 0);
    expect(result.find(r => r.ticker === 'VOO')?.deltaUsd).toBeCloseTo(29_920, 0);
    expect(result.find(r => r.ticker === 'SCHB')?.deltaUsd).toBeCloseTo(-26_000, 0);
    expect(result).toHaveLength(3);
  });
});

// ─── blended fund — explicit decomposition (issue #40) ──────────────────────

describe('Resolution (supports Goal 4): blended fund decomposed by ticker (#40)', () => {
  it('merges per-sub-class sells targeting the same blended-fund ticker', () => {
    const decomp = { US_LARGE_CAP: 0.60, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.10 };
    const trades: Trade[] = [
      { accountId: 'k401', assetClass: 'US_LARGE_CAP',  deltaUsd: -6_000, inTaxableAccount: false, forceTicker: 'FDKLX' },
      { accountId: 'k401', assetClass: 'DEVELOPED_INTL', deltaUsd: -3_000, inTaxableAccount: false, forceTicker: 'FDKLX' },
      { accountId: 'k401', assetClass: 'FIXED_INCOME',  deltaUsd: -1_000, inTaxableAccount: false, forceTicker: 'FDKLX' },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, { FDKLX: decomp }, classify);
    expect(result).toHaveLength(1);
    expect(result[0].ticker).toBe('FDKLX');
    expect(result[0].deltaUsd).toBeCloseTo(-10_000, 0);
    expect(result[0].mergedFrom).toHaveLength(3);
  });

  it('excludeTickers strips a candidate ticker from resolution', () => {
    const decomp = { US_LARGE_CAP: 0.60, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.10 };
    // Compensating buy that must NOT route back to the blended fund being sold.
    const trades: Trade[] = [
      { accountId: 'k401', assetClass: 'US_LARGE_CAP', deltaUsd: 5_000, inTaxableAccount: false, excludeTickers: ['FDKLX'] },
    ];
    const positions: Position[] = [
      { accountId: 'k401', ticker: 'FDKLX', marketValue: 100_000 },
      { accountId: 'k401', ticker: 'FXAIX', marketValue:  20_000 },
    ];
    const [r] = resolveTradeVehicles(trades, positions, { FDKLX: decomp }, classify);
    expect(r.ticker).toBe('FXAIX');
  });
});

// ─── multi-account trades ────────────────────────────────────────────────────

describe('Resolution (supports Goal 4): each account resolved independently', () => {
  it('resolves tickers per account without cross-contamination', () => {
    const trades: Trade[] = [
      { accountId: 'ira',    assetClass: 'US_LARGE_CAP', deltaUsd: -10_000, inTaxableAccount: false },
      { accountId: 'taxable', assetClass: 'US_LARGE_CAP', deltaUsd:   5_000, inTaxableAccount: true  },
    ];
    const positions: Position[] = [
      { accountId: 'ira',    ticker: 'FXAIX', marketValue: 50_000 },
      { accountId: 'taxable', ticker: 'FSKAX', marketValue: 80_000 },
    ];
    const result = resolveTradeVehicles(trades, positions, {}, classify);
    expect(result.find(r => r.accountId === 'ira')?.ticker).toBe('FXAIX');
    // taxable holds FSKAX (US_TOTAL_MARKET) and only has an LC trade — single-class result
    expect(result.find(r => r.accountId === 'taxable')?.ticker).toBe('FSKAX');
  });
});
