import { describe, it, expect } from 'vitest';
import { makeClassifier } from './classify';
import { nativeAllocationByAccount, projectedNativeAllocationByAccount } from './nativeAllocation';
import type { Account, FundDecomposition, Position, ResolvedTrade } from './types';

const acct = (id: string): Account => ({ id, name: id, institution: 'Test', type: 'OTHER' });

// VTTSX is a TDF decomposed only at the PARENT level; VOO is a direct leaf fund.
const decompositions: Record<string, FundDecomposition> = {
  VTTSX: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 },
};

// Classify VOO at the leaf level; ZZZZ is intentionally unmapped.
const classify = makeClassifier({ VOO: 'US_LARGE_CAP' });

describe('nativeAllocationByAccount (holdings lens)', () => {
  it('pins a parent-level TDF at the parent level — no invented sub-classes', () => {
    const positions: Position[] = [
      { accountId: 'a', ticker: 'VTTSX', marketValue: 100_000 },
    ];
    const native = nativeAllocationByAccount([acct('a')], positions, classify, decompositions);

    expect(native.a.US_TOTAL_MARKET).toBeCloseTo(54_000);
    expect(native.a.DEVELOPED_INTL).toBeCloseTo(36_000);
    expect(native.a.FIXED_INCOME).toBeCloseTo(10_000);
    // The cap and bond-sector children stay at zero — we don't have that info.
    expect(native.a.US_LARGE_CAP).toBe(0);
    expect(native.a.US_TREASURY).toBe(0);
    expect(native.a.DEVELOPED_EUROPE).toBe(0);
  });

  it('pins a direct leaf fund at the leaf level and skips unmapped holdings', () => {
    const positions: Position[] = [
      { accountId: 'a', ticker: 'VOO', marketValue: 10_000 },
      { accountId: 'a', ticker: 'ZZZZ', marketValue: 5_000 },   // unmapped → excluded
    ];
    const native = nativeAllocationByAccount([acct('a')], positions, classify, decompositions);

    expect(native.a.US_LARGE_CAP).toBeCloseTo(10_000);
    const total = Object.values(native.a).reduce((s, v) => s + v, 0);
    expect(total).toBeCloseTo(10_000); // ZZZZ contributes nothing
  });

  it('initializes every passed account, even with no positions', () => {
    const native = nativeAllocationByAccount([acct('a'), acct('b')], [], classify, decompositions);
    expect(native.a).toBeDefined();
    expect(native.b).toBeDefined();
    expect(Object.values(native.a).reduce((s, v) => s + v, 0)).toBe(0);
  });
});

describe('projectedNativeAllocationByAccount (post-trade holdings lens)', () => {
  it('applies trades at each holding\'s pinned class without mutating the before map', () => {
    const positions: Position[] = [
      { accountId: 'a', ticker: 'VTTSX', marketValue: 100_000 },
      { accountId: 'a', ticker: 'VOO', marketValue: 10_000 },
    ];
    const before = nativeAllocationByAccount([acct('a')], positions, classify, decompositions);
    const beforeSnapshot = { ...before.a };

    const resolvedTrades: ResolvedTrade[] = [
      // Greenfield buy — no ticker → lands at the trade's (promoted) class.
      { accountId: 'a', assetClass: 'EMERGING_INTL', deltaUsd: 5_000, inTaxableAccount: false },
      // Proportional TDF sale — routed to the blended fund → spreads across its decomposition.
      { accountId: 'a', assetClass: 'US_TOTAL_MARKET', ticker: 'VTTSX', deltaUsd: -10_000, inTaxableAccount: false },
      // Leaf-fund sale → lands at the leaf class.
      { accountId: 'a', assetClass: 'US_LARGE_CAP', ticker: 'VOO', deltaUsd: -2_000, inTaxableAccount: false },
    ];

    const after = projectedNativeAllocationByAccount(before, resolvedTrades, classify, decompositions);

    // TDF sale shrinks the PARENT buckets proportionally — never the synthetic children.
    expect(after.a.US_TOTAL_MARKET).toBeCloseTo(48_600);   // 54000 − 5400
    expect(after.a.DEVELOPED_INTL).toBeCloseTo(32_400);    // 36000 − 3600
    expect(after.a.FIXED_INCOME).toBeCloseTo(9_000);       // 10000 − 1000
    expect(after.a.US_LARGE_CAP).toBeCloseTo(8_000);       // 10000 − 2000
    expect(after.a.EMERGING_INTL).toBeCloseTo(5_000);      // greenfield buy

    // before must be untouched.
    expect(before.a).toEqual(beforeSnapshot);
  });

  it('falls back to the trade class when a ticker is unmapped', () => {
    const before = nativeAllocationByAccount([acct('a')], [], classify, decompositions);
    const resolvedTrades: ResolvedTrade[] = [
      { accountId: 'a', assetClass: 'REAL_ESTATE', ticker: 'UNKNOWN', deltaUsd: 3_000, inTaxableAccount: false },
    ];
    const after = projectedNativeAllocationByAccount(before, resolvedTrades, classify, decompositions);
    expect(after.a.REAL_ESTATE).toBeCloseTo(3_000);
  });
});
