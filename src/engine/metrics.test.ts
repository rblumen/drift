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
