// Unit tests for the #194 stage-4 "Normalize to 100%" control's pure core.
// normalizeToHundredWeights proportionally rescales the effective-leaf weights
// so they sum to exactly 100, formatted to one decimal, leaving non-leaf keys
// untouched. This is the math behind the new Strategy-tab footer button.
import { describe, it, expect } from 'vitest';
import { normalizeToHundredWeights } from './StrategyPanel';

describe('normalizeToHundredWeights (#194 Normalize to 100%)', () => {
  it('scales an under-100 set up so the leaves sum to exactly 100', () => {
    const out = normalizeToHundredWeights(
      { A: '30', B: '10', C: '10' }, // sums to 50
      ['A', 'B', 'C'],
    );
    const total = ['A', 'B', 'C'].reduce((s, k) => s + parseFloat(out[k]), 0);
    expect(total).toBeCloseTo(100, 5);
    // Proportions preserved: A was 60% of the pre-total, stays 60 of 100.
    expect(out.A).toBe('60.0');
    expect(out.B).toBe('20.0');
    expect(out.C).toBe('20.0');
  });

  it('scales an over-100 set down to 100', () => {
    const out = normalizeToHundredWeights(
      { A: '80', B: '80' }, // sums to 160
      ['A', 'B'],
    );
    expect(parseFloat(out.A) + parseFloat(out.B)).toBeCloseTo(100, 5);
    expect(out.A).toBe('50.0');
    expect(out.B).toBe('50.0');
  });

  it('leaves keys not in the leaf list untouched', () => {
    const out = normalizeToHundredWeights(
      { A: '25', B: '25', PARENT: '99' },
      ['A', 'B'],
    );
    // Only A and B are rescaled; PARENT passes through verbatim.
    expect(out.PARENT).toBe('99');
    expect(parseFloat(out.A) + parseFloat(out.B)).toBeCloseTo(100, 5);
  });

  it('is a no-op when the leaves sum to zero (nothing to scale)', () => {
    const input = { A: '0', B: '0' };
    const out = normalizeToHundredWeights(input, ['A', 'B']);
    expect(out).toEqual(input);
  });

  it('formats every rescaled leaf to one decimal place', () => {
    const out = normalizeToHundredWeights({ A: '1', B: '2' }, ['A', 'B']);
    // 1/3 → 33.3, 2/3 → 66.7 (each one-decimal string).
    expect(out.A).toMatch(/^\d+\.\d$/);
    expect(out.B).toMatch(/^\d+\.\d$/);
    expect(parseFloat(out.A) + parseFloat(out.B)).toBeCloseTo(100, 1);
  });
});
