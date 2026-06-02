import { describe, it, expect } from 'vitest';
import type { Account, Position, Strategy } from './types';
import {
  positionTaxFactor,
  positionAfterTaxValue,
  contributionTaxFactor,
  findMissingCostBasis,
} from './taxAdjust';

const TA: NonNullable<Strategy['taxAdjustment']> = {
  enabled: true,
  effectiveRateAtRetirement: 0.20,
  marginalRateLTCG: 0.15,
};

function acct(type: Account['type'], id = 'a1'): Account {
  return { id, name: id, institution: 'x', type };
}

function pos(overrides: Partial<Position> = {}): Position {
  return {
    accountId: 'a1',
    ticker: 'VTI',
    marketValue: 10_000,
    ...overrides,
  };
}

describe('positionTaxFactor', () => {
  it('returns 1.0 for Roth, HSA, 529, OTHER', () => {
    for (const t of ['ROTH_IRA', 'HSA', 'FIVE_TWENTY_NINE', 'OTHER'] as const) {
      expect(positionTaxFactor(pos(), acct(t), TA)).toBe(1.0);
    }
  });

  it('applies effective-rate haircut for Trad / 401k', () => {
    expect(positionTaxFactor(pos(), acct('TRADITIONAL_IRA'), TA)).toBeCloseTo(0.80);
    expect(positionTaxFactor(pos(), acct('FOUR_OH_ONE_K'), TA)).toBeCloseTo(0.80);
  });

  it('applies per-position LTCG haircut for Taxable with basis', () => {
    // V=10k, B=2k → gain 8k → tax 1.2k → after-tax 8.8k → factor 0.88
    const f = positionTaxFactor(pos({ costBasis: 2000 }), acct('TAXABLE'), TA);
    expect(f).toBeCloseTo(0.88);
  });

  it('Taxable position with B = V has no haircut', () => {
    expect(positionTaxFactor(pos({ costBasis: 10_000 }), acct('TAXABLE'), TA)).toBe(1.0);
  });

  it('Taxable position at a loss (B > V) clamps to no-haircut', () => {
    expect(positionTaxFactor(pos({ costBasis: 12_000 }), acct('TAXABLE'), TA)).toBe(1.0);
  });

  it('Taxable position with missing basis falls back to no-haircut', () => {
    expect(positionTaxFactor(pos(), acct('TAXABLE'), TA)).toBe(1.0);
  });

  it('Taxable position with implausible basis (NaN, negative) falls back', () => {
    expect(positionTaxFactor(pos({ costBasis: NaN }), acct('TAXABLE'), TA)).toBe(1.0);
    expect(positionTaxFactor(pos({ costBasis: -500 }), acct('TAXABLE'), TA)).toBe(1.0);
  });

  it('zero market value position is a no-op (factor 1.0)', () => {
    expect(positionTaxFactor(pos({ marketValue: 0 }), acct('TAXABLE'), TA)).toBe(1.0);
  });

  it('extreme effective rate clamps to [0, 1]', () => {
    const high = { ...TA, effectiveRateAtRetirement: 1.5 };
    expect(positionTaxFactor(pos(), acct('TRADITIONAL_IRA'), high)).toBe(0);
    const neg = { ...TA, effectiveRateAtRetirement: -0.1 };
    expect(positionTaxFactor(pos(), acct('TRADITIONAL_IRA'), neg)).toBe(1.0);
  });
});

describe('positionAfterTaxValue', () => {
  it('multiplies marketValue by the factor', () => {
    expect(positionAfterTaxValue(pos({ costBasis: 2000 }), acct('TAXABLE'), TA))
      .toBeCloseTo(8_800);
    expect(positionAfterTaxValue(pos(), acct('TRADITIONAL_IRA'), TA))
      .toBeCloseTo(8_000);
    expect(positionAfterTaxValue(pos(), acct('ROTH_IRA'), TA))
      .toBe(10_000);
  });
});

describe('contributionTaxFactor', () => {
  it('Roth/HSA/529/Taxable/OTHER all 1.0 (new buys have B=V)', () => {
    for (const t of ['ROTH_IRA', 'HSA', 'FIVE_TWENTY_NINE', 'TAXABLE', 'OTHER'] as const) {
      expect(contributionTaxFactor(t, TA)).toBe(1.0);
    }
  });
  it('Trad/401k apply effective-rate haircut', () => {
    expect(contributionTaxFactor('TRADITIONAL_IRA', TA)).toBeCloseTo(0.80);
    expect(contributionTaxFactor('FOUR_OH_ONE_K', TA)).toBeCloseTo(0.80);
  });
});

describe('findMissingCostBasis', () => {
  const accounts: Account[] = [
    { id: 'tax', name: 'Tax', institution: 'x', type: 'TAXABLE' },
    { id: 'roth', name: 'Roth', institution: 'x', type: 'ROTH_IRA' },
    { id: 'trad', name: 'Trad', institution: 'x', type: 'TRADITIONAL_IRA' },
  ];

  it('flags taxable positions without basis', () => {
    const missing = findMissingCostBasis(accounts, [
      { accountId: 'tax', ticker: 'VTI', marketValue: 1000 },
      { accountId: 'tax', ticker: 'BND', marketValue: 500, costBasis: 480 },
    ]);
    expect(missing).toEqual([{ accountId: 'tax', ticker: 'VTI' }]);
  });

  it('ignores positions in non-taxable accounts', () => {
    const missing = findMissingCostBasis(accounts, [
      { accountId: 'roth', ticker: 'VTI', marketValue: 1000 },
      { accountId: 'trad', ticker: 'BND', marketValue: 1000 },
    ]);
    expect(missing).toEqual([]);
  });

  it('flags implausible basis the same as missing', () => {
    const missing = findMissingCostBasis(accounts, [
      { accountId: 'tax', ticker: 'A', marketValue: 1000, costBasis: -1 },
      { accountId: 'tax', ticker: 'B', marketValue: 1000, costBasis: 2000 }, // B > V
      { accountId: 'tax', ticker: 'C', marketValue: 1000, costBasis: NaN },
    ]);
    expect(missing.map(m => m.ticker)).toEqual(['A', 'B', 'C']);
  });

  it('skips zero-value positions', () => {
    const missing = findMissingCostBasis(accounts, [
      { accountId: 'tax', ticker: 'A', marketValue: 0 },
    ]);
    expect(missing).toEqual([]);
  });
});
