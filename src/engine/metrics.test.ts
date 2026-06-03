import { describe, it, expect } from 'vitest';
import { aggressiveness, diversification } from './metrics';
import type { AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';

function w(partial: Partial<Record<AssetClass, number>>): Record<AssetClass, number> {
  return Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, partial[ac] ?? 0]),
  ) as Record<AssetClass, number>;
}

describe('aggressiveness', () => {
  it('is 1 when all-equity', () => {
    expect(aggressiveness(w({ US_TOTAL_MARKET: 1 }))).toBe(1);
  });

  it('is 0 when all-bonds', () => {
    expect(aggressiveness(w({ FIXED_INCOME: 1 }))).toBe(0);
  });

  it('is 0 when all-cash', () => {
    expect(aggressiveness(w({ CASH: 1 }))).toBe(0);
  });

  it('counts alternatives as aggressive', () => {
    expect(aggressiveness(w({ ALTERNATIVES: 0.5, FIXED_INCOME: 0.5 }))).toBeCloseTo(0.5);
  });

  it('returns 0 for an empty allocation', () => {
    expect(aggressiveness(w({}))).toBe(0);
  });

  it('normalizes over partial allocations', () => {
    // 60/40 of a 0.5-total portfolio still reads 60% aggressive.
    expect(aggressiveness(w({ US_LARGE_CAP: 0.3, FIXED_INCOME: 0.2 }))).toBeCloseTo(0.6);
  });

  it('is stable across FIXED_INCOME split/merge — FI children count as defensive', () => {
    // 60% equity / 40% bonds expressed at parent level.
    const parent = aggressiveness(w({ US_LARGE_CAP: 0.6, FIXED_INCOME: 0.4 }));
    // Same allocation with FIXED_INCOME split into sub-classes.
    const split = aggressiveness(w({
      US_LARGE_CAP:  0.6,
      US_TREASURY:   0.14,
      US_CORP_BOND:  0.10,
      MUNI_BOND:     0.08,
      TIPS:          0.04,
      INTL_BOND:     0.04,
    }));
    expect(split).toBeCloseTo(parent, 5);
  });

  it('counts DEVELOPED_EUROPE and DEVELOPED_PACIFIC as growth', () => {
    // Splitting DEVELOPED_INTL into sub-regions should not change aggressiveness.
    const parent = aggressiveness(w({ DEVELOPED_INTL: 0.5, FIXED_INCOME: 0.5 }));
    const split  = aggressiveness(w({ DEVELOPED_EUROPE: 0.31, DEVELOPED_PACIFIC: 0.19, FIXED_INCOME: 0.5 }));
    expect(split).toBeCloseTo(parent, 5);
  });

  it('counts REAL_ESTATE as growth', () => {
    expect(aggressiveness(w({ REAL_ESTATE: 1 }))).toBe(1);
  });

  it('counts CRYPTO and PRECIOUS_METALS as growth', () => {
    const parent = aggressiveness(w({ ALTERNATIVES: 0.5, FIXED_INCOME: 0.5 }));
    const split  = aggressiveness(w({ CRYPTO: 0.3, PRECIOUS_METALS: 0.2, FIXED_INCOME: 0.5 }));
    expect(split).toBeCloseTo(parent, 5);
  });
});

describe('diversification', () => {
  it('is 0 when concentrated in a single class', () => {
    expect(diversification(w({ US_TOTAL_MARKET: 1 }))).toBe(0);
  });

  it('is 1 when perfectly equal-weighted across all classes', () => {
    const n = ALL_ASSET_CLASSES.length;
    const equal = Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, 1 / n]),
    ) as Record<AssetClass, number>;
    expect(diversification(equal)).toBeCloseTo(1);
  });

  it('increases as a portfolio spreads across more classes', () => {
    const two = diversification(w({ US_LARGE_CAP: 0.5, FIXED_INCOME: 0.5 }));
    const three = diversification(w({ US_LARGE_CAP: 1 / 3, FIXED_INCOME: 1 / 3, DEVELOPED_INTL: 1 / 3 }));
    expect(three).toBeGreaterThan(two);
  });

  it('returns 0 for an empty allocation', () => {
    expect(diversification(w({}))).toBe(0);
  });
});
