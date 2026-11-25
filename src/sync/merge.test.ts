import { describe, it, expect } from 'vitest';
import { deepEqual, mergeAppState, resolveConflicts, MERGE_SECTIONS } from './merge';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { appStateSchema, type AppState } from '../ingest/schema';

const BASE: AppState = {
  version: 1,
  accounts: [{ id: 'a1', name: 'Joint Brokerage', institution: 'Brokerage A', type: 'TAXABLE' }],
  positions: [{ accountId: 'a1', ticker: 'VTI', marketValue: 1000 }],
  strategy: DEFAULT_STRATEGY,
  tickerOverrides: {},
  decompositions: {},
  freeCash: 0,
  plannedWithdrawal: 0,
  reminder: {},
  linkedPositionOverrides: {},
  people: [],
};

const with_ = (patch: Partial<AppState>): AppState => ({ ...BASE, ...patch });

describe('deepEqual', () => {
  it('ignores key order and undefined-valued keys', () => {
    expect(deepEqual({ a: 1, b: [1, { c: 2 }] }, { b: [1, { c: 2 }], a: 1 })).toBe(true);
    expect(deepEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
  });
  it('distinguishes values, array order and arrays from objects', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [2, 1])).toBe(false);
    expect(deepEqual([], {})).toBe(false);
    expect(deepEqual(null, {})).toBe(false);
  });
});

describe('mergeAppState', () => {
  it('is a no-op when neither side changed', () => {
    const r = mergeAppState(BASE, BASE, BASE);
    expect(r).toEqual({ merged: BASE, conflicts: [], fromLocal: [], fromRemote: [] });
  });

  it('takes sections only one side changed, from that side', () => {
    const local = with_({ tickerOverrides: { ABCD: 'CASH' } });
    const remote = with_({ positions: [{ accountId: 'a1', ticker: 'VTI', marketValue: 2000 }] });
    const r = mergeAppState(BASE, local, remote);
    expect(r.conflicts).toEqual([]);
    expect(r.fromLocal).toEqual(['tickerOverrides']);
    expect(r.fromRemote).toEqual(['positions']);
    expect(r.merged.tickerOverrides).toEqual({ ABCD: 'CASH' });
    expect(r.merged.positions[0].marketValue).toBe(2000);
  });

  it('reports a conflict when both sides changed the same section differently', () => {
    const local = with_({ accounts: [{ ...BASE.accounts[0], name: 'Ours' }] });
    const remote = with_({ accounts: [{ ...BASE.accounts[0], name: 'Shared' }] });
    const r = mergeAppState(BASE, local, remote);
    expect(r.conflicts).toEqual(['accounts']);
    // Placeholder until resolved: remote.
    expect(r.merged.accounts[0].name).toBe('Shared');
  });

  it('treats an identical change on both sides as clean', () => {
    const changed = with_({ people: [{ id: 'p1', name: 'Alex' }] });
    const r = mergeAppState(BASE, changed, { ...changed });
    expect(r.conflicts).toEqual([]);
    expect(r.merged.people).toEqual([{ id: 'p1', name: 'Alex' }]);
  });

  it('groups freeCash and plannedWithdrawal into one cash section', () => {
    expect(MERGE_SECTIONS.cash).toEqual(['freeCash', 'plannedWithdrawal']);
    const r1 = mergeAppState(BASE, with_({ freeCash: 100 }), with_({ plannedWithdrawal: 50 }));
    expect(r1.conflicts).toEqual(['cash']);
    const r2 = mergeAppState(BASE, with_({ freeCash: 100 }), BASE);
    expect(r2.merged).toMatchObject({ freeCash: 100, plannedWithdrawal: 0 });
  });

  it('covers every top-level AppState key except version', () => {
    const covered = new Set<string>(Object.values(MERGE_SECTIONS).flat());
    const keys = Object.keys(appStateSchema.shape).filter(k => k !== 'version');
    expect(keys.filter(k => !covered.has(k))).toEqual([]);
  });

  it('merges each spec section independently', () => {
    const local = with_({
      strategy: { ...DEFAULT_STRATEGY, toleranceAbs: 0.03 },
      decompositions: { ABCD: { US_LARGE_CAP: 1 } },
      reminder: { intervalMonths: 6 },
    });
    const remote = with_({
      linkedPositionOverrides: { 'a1:VTI': { locked: true } },
      people: [{ id: 'p1', name: 'Sam' }],
    });
    const r = mergeAppState(BASE, local, remote);
    expect(r.conflicts).toEqual([]);
    expect(r.fromLocal).toEqual(['strategy', 'decompositions', 'reminder']);
    expect(r.fromRemote).toEqual(['linkedPositionOverrides', 'people']);
    expect(r.merged.strategy.toleranceAbs).toBe(0.03);
    expect(r.merged.linkedPositionOverrides).toEqual({ 'a1:VTI': { locked: true } });
  });

  it('does not mutate its inputs', () => {
    const local = with_({ freeCash: 10 });
    const snapshot = JSON.stringify([BASE, local]);
    mergeAppState(BASE, local, BASE);
    expect(JSON.stringify([BASE, local])).toBe(snapshot);
  });
});

describe('resolveConflicts', () => {
  const local = with_({ accounts: [{ ...BASE.accounts[0], name: 'Ours' }], freeCash: 5 });
  const remote = with_({ accounts: [{ ...BASE.accounts[0], name: 'Shared' }], freeCash: 9 });
  const r = mergeAppState(BASE, local, remote);

  it('applies the chosen side per section', () => {
    expect(r.conflicts).toEqual(['accounts', 'cash']);
    const merged = resolveConflicts(r, local, remote, { accounts: 'local', cash: 'remote' });
    expect(merged.accounts[0].name).toBe('Ours');
    expect(merged.freeCash).toBe(9);
  });

  it('throws rather than guessing when a conflict has no choice', () => {
    expect(() => resolveConflicts(r, local, remote, { accounts: 'local' })).toThrow(/cash/);
  });
});
