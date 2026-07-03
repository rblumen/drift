import { describe, it, expect } from 'vitest';
import { aggressiveness, diversification, LIVE_ASSET_CLASSES } from './metrics';
import type { AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';

function w(partial: Partial<Record<AssetClass, number>>): Record<AssetClass, number> {
  return Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, partial[ac] ?? 0]),
  ) as Record<AssetClass, number>;
}

describe('Metrics (non-goal display concern): portfolio aggressiveness score', () => {
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

describe('Metrics (non-goal display concern): portfolio diversification score', () => {
  it('is 0 when concentrated in a single class', () => {
    expect(diversification(w({ US_TOTAL_MARKET: 1 }))).toBe(0);
  });

  it('is at/near the floor for a single-class portfolio expressed at a leaf', () => {
    expect(diversification(w({ US_LARGE_CAP: 1 }))).toBeCloseTo(0, 5);
  });

  // #134: LIVE_ASSET_CLASSES excludes the synthetic US_TOTAL_MARKET parent (always
  // 0 by invariant) and every other parent that has children (DEVELOPED_INTL,
  // FIXED_INCOME, ALTERNATIVES) — those families are counted once, via their
  // children, not as parent + children slots.
  it('derives the live-class count by excluding the synthetic parent and absorbing parent/children families', () => {
    expect(LIVE_ASSET_CLASSES).not.toContain('US_TOTAL_MARKET');
    expect(LIVE_ASSET_CLASSES).not.toContain('DEVELOPED_INTL');
    expect(LIVE_ASSET_CLASSES).not.toContain('FIXED_INCOME');
    expect(LIVE_ASSET_CLASSES).not.toContain('ALTERNATIVES');
    // Every ALL_ASSET_CLASSES entry that isn't a parent-with-children survives.
    expect(LIVE_ASSET_CLASSES.length).toBe(ALL_ASSET_CLASSES.length - 4);
    expect(LIVE_ASSET_CLASSES).toEqual(
      expect.arrayContaining(['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
        'DEVELOPED_EUROPE', 'DEVELOPED_PACIFIC', 'EMERGING_INTL',
        'US_TREASURY', 'US_CORP_BOND', 'MUNI_BOND', 'TIPS', 'INTL_BOND',
        'REAL_ESTATE', 'CRYPTO', 'PRECIOUS_METALS', 'CASH']),
    );
  });

  it('is 1 when perfectly equal-weighted across all live classes', () => {
    const n = LIVE_ASSET_CLASSES.length;
    const equal = Object.fromEntries(
      LIVE_ASSET_CLASSES.map(ac => [ac, 1 / n]),
    ) as Record<AssetClass, number>;
    expect(diversification(w(equal))).toBeCloseTo(1);
  });

  it('reaches 1 for an equal-weighted spread whether classes are expressed as parent or as children', () => {
    // Sanity: the theoretical max is actually reachable post-#134, unlike the old
    // N=19 denominator where parent+children double-counting made 1.0 unreachable.
    const n = LIVE_ASSET_CLASSES.length;
    const equal = Object.fromEntries(
      LIVE_ASSET_CLASSES.map(ac => [ac, 1 / n]),
    ) as Record<AssetClass, number>;
    expect(diversification(w(equal))).toBeGreaterThanOrEqual(0.999);
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
