import { describe, it, expect } from 'vitest';
import { fillOrdered } from './cashfill';

describe('fillOrdered', () => {
  const uncapped = () => Infinity;

  it('concentrates the full amount into the first account when it has room', () => {
    const { alloc, residual } = fillOrdered(['a', 'b', 'c'], uncapped, 1000);
    expect(alloc).toEqual({ a: 1000 });
    expect(residual).toBe(0);
  });

  it('spills to the next account only when the current one is capped', () => {
    const cap: Record<string, number> = { a: 300, b: 400 };
    const { alloc, residual } = fillOrdered(['a', 'b', 'c'], id => cap[id] ?? Infinity, 1000);
    expect(alloc.a).toBe(300);
    expect(alloc.b).toBe(400);
    expect(alloc.c).toBe(300); // remainder lands in the first uncapped account
    expect(residual).toBe(0);
  });

  it('returns a residual when every account is exhausted', () => {
    const cap: Record<string, number> = { a: 300, b: 400 };
    const { alloc, residual } = fillOrdered(['a', 'b'], id => cap[id], 1000);
    expect(alloc).toEqual({ a: 300, b: 400 });
    expect(residual).toBe(300);
  });

  it('skips zero-room accounts without touching them', () => {
    const cap: Record<string, number> = { a: 0, b: 500 };
    const { alloc } = fillOrdered(['a', 'b'], id => cap[id], 200);
    expect(alloc.a).toBeUndefined();
    expect(alloc.b).toBe(200);
  });

  it('respects the given order, not insertion or value', () => {
    const { alloc } = fillOrdered(['b', 'a'], () => 100, 150);
    expect(alloc.b).toBe(100);
    expect(alloc.a).toBe(50);
  });

  it('is a no-op for zero or negative amounts', () => {
    expect(fillOrdered(['a'], uncapped, 0)).toEqual({ alloc: {}, residual: 0 });
    expect(fillOrdered(['a'], uncapped, -5)).toEqual({ alloc: {}, residual: 0 });
  });

  it('places nothing in accounts absent from the order', () => {
    const { alloc } = fillOrdered(['a'], uncapped, 100);
    expect(alloc.z).toBeUndefined();
  });
});
