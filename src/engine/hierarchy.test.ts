import { describe, it, expect } from 'vitest';
import { synthesizeImplicitDecompositions } from './hierarchy';
import { makeClassifier } from './classify';
import type { Position, FundDecomposition } from './types';

const classify = makeClassifier();

// synthesizeImplicitDecompositions turns a held broad fund (one that classifies
// to a PARENT class) into an implicit single-sleeve blended fund { P: 1.0 }, so
// it flows through the existing blended-fund machinery (issue #215).
describe('synthesizeImplicitDecompositions (issue #215)', () => {
  it('synthesizes { US_TOTAL_MARKET: 1 } for a held total-market fund', () => {
    const positions: Position[] = [{ accountId: 'a', ticker: 'SWTSX', marketValue: 100_000 }];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.SWTSX).toEqual({ US_TOTAL_MARKET: 1 });
  });

  it('synthesizes broad FI and developed-intl funds; skips a child-class fund', () => {
    const positions: Position[] = [
      { accountId: 'a', ticker: 'BND', marketValue: 10_000 },  // FIXED_INCOME (parent)
      { accountId: 'a', ticker: 'VXUS', marketValue: 10_000 }, // DEVELOPED_INTL (parent)
      { accountId: 'a', ticker: 'GLD', marketValue: 10_000 },  // PRECIOUS_METALS (a child of ALTERNATIVES)
    ];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.BND).toEqual({ FIXED_INCOME: 1 });
    expect(out.VXUS).toEqual({ DEVELOPED_INTL: 1 });
    // GLD classifies to PRECIOUS_METALS (a CHILD), so it is NOT synthesized —
    // trading a single-sleeve fund is already exact.
    expect(out.GLD).toBeUndefined();
  });

  it('does NOT synthesize for a leaf-class fund (FXAIX → US_LARGE_CAP)', () => {
    const positions: Position[] = [{ accountId: 'a', ticker: 'FXAIX', marketValue: 100_000 }];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.FXAIX).toBeUndefined();
  });

  it('leaves an explicit decomposition untouched (explicit wins)', () => {
    const explicit: Record<string, FundDecomposition> = { SWTSX: { US_LARGE_CAP: 0.5, FIXED_INCOME: 0.5 } };
    const positions: Position[] = [{ accountId: 'a', ticker: 'SWTSX', marketValue: 100_000 }];
    const out = synthesizeImplicitDecompositions(positions, explicit, classify);
    expect(out.SWTSX).toEqual({ US_LARGE_CAP: 0.5, FIXED_INCOME: 0.5 });
  });

  it('does NOT synthesize for a locked broad-fund position', () => {
    const positions: Position[] = [{ accountId: 'a', ticker: 'SWTSX', marketValue: 100_000, locked: true }];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.SWTSX).toBeUndefined();
  });

  it('does NOT synthesize for an unmapped ticker', () => {
    const positions: Position[] = [{ accountId: 'a', ticker: 'NOPE', marketValue: 100_000 }];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.NOPE).toBeUndefined();
  });

  it('returns the SAME map reference when nothing is synthesized (simple portfolios unchanged)', () => {
    const decomps: Record<string, FundDecomposition> = {};
    const positions: Position[] = [{ accountId: 'a', ticker: 'FXAIX', marketValue: 100_000 }];
    expect(synthesizeImplicitDecompositions(positions, decomps, classify)).toBe(decomps);
  });

  it('is case-insensitive on the ticker key', () => {
    const positions: Position[] = [{ accountId: 'a', ticker: 'swtsx', marketValue: 100_000 }];
    const out = synthesizeImplicitDecompositions(positions, {}, classify);
    expect(out.SWTSX).toEqual({ US_TOTAL_MARKET: 1 });
  });
});
