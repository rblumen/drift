// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { buildState, DEFAULT_APP_STATE, saveState, loadState, clearState, saveBackup } from './store';
import { parseAppState } from './ingest/schema';
import { DEFAULT_STRATEGY } from './engine/strategy';

// ─── buildState ───────────────────────────────────────────────────────────────

describe('buildState', () => {
  it('produces a valid AppState from slices', () => {
    const state = buildState([], [], DEFAULT_STRATEGY, {});
    expect(state.version).toBe(1);
    expect(state.accounts).toEqual([]);
    expect(state.positions).toEqual([]);
    expect(state.strategy).toEqual(DEFAULT_STRATEGY);
    expect(state.tickerOverrides).toEqual({});
  });
});

// ─── parseAppState (schema validation) ───────────────────────────────────────

describe('parseAppState', () => {
  it('accepts the default state', () => {
    expect(() => parseAppState(DEFAULT_APP_STATE)).not.toThrow();
  });

  it('rejects a missing version field', () => {
    const { version: _v, ...noVersion } = DEFAULT_APP_STATE;
    expect(() => parseAppState(noVersion)).toThrow();
  });

  it('rejects an unknown version', () => {
    expect(() => parseAppState({ ...DEFAULT_APP_STATE, version: 99 })).toThrow();
  });

  it('rejects an invalid tickerOverride value', () => {
    expect(() => parseAppState({
      ...DEFAULT_APP_STATE,
      tickerOverrides: { VTI: 'BOND_FUND' }, // not a valid AssetClass
    })).toThrow();
  });

  it('accepts valid tickerOverrides', () => {
    const state = parseAppState({
      ...DEFAULT_APP_STATE,
      tickerOverrides: { MYMUTF: 'US_TOTAL_MARKET' },
    });
    expect(state.tickerOverrides['MYMUTF']).toBe('US_TOTAL_MARKET');
  });

  it('accepts a full account + position payload', () => {
    const state = parseAppState({
      ...DEFAULT_APP_STATE,
      accounts: [{ id: 'a1', name: 'Schwab', institution: 'Schwab', type: 'TAXABLE' }],
      positions: [{ accountId: 'a1', ticker: 'VTI', marketValue: 50000 }],
    });
    expect(state.accounts).toHaveLength(1);
    expect(state.positions).toHaveLength(1);
  });
});

// ─── localStorage round-trip ──────────────────────────────────────────────────

// jsdom provides a localStorage stub in the test environment.
describe('localStorage round-trip', () => {
  beforeEach(() => {
    clearState();
  });

  it('loadState returns null when nothing is saved', () => {
    expect(loadState()).toBeNull();
  });

  it('round-trips the default state', () => {
    saveState(DEFAULT_APP_STATE);
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.source).toBe('primary');
    expect(loaded!.state.version).toBe(1);
    expect(loaded!.state.accounts).toEqual([]);
    expect(loaded!.state.strategy.toleranceAbs).toBeCloseTo(0.05);
  });

  it('round-trips accounts and positions', () => {
    const state = buildState(
      [{ id: 'a1', name: 'IRA', institution: 'Fidelity', type: 'TRADITIONAL_IRA' }],
      [{ accountId: 'a1', ticker: 'FZROX', marketValue: 100_000 }],
      DEFAULT_STRATEGY,
      { XYZ: 'ALTERNATIVES' },
    );
    saveState(state);
    const loaded = loadState();
    expect(loaded!.state.accounts[0].name).toBe('IRA');
    expect(loaded!.state.positions[0].ticker).toBe('FZROX');
    expect(loaded!.state.tickerOverrides['XYZ']).toBe('ALTERNATIVES');
  });

  it('clearState makes loadState return null again', () => {
    saveState(DEFAULT_APP_STATE);
    clearState();
    expect(loadState()).toBeNull();
  });

  it('returns null for a corrupted stored value (with no backups)', () => {
    localStorage.setItem('rebalancer-v1', '{ not valid json }');
    expect(loadState()).toBeNull();
  });

  it('returns null when the saved version does not match (with no backups)', () => {
    localStorage.setItem('rebalancer-v1', JSON.stringify({ ...DEFAULT_APP_STATE, version: 2 }));
    expect(loadState()).toBeNull();
  });

  it('falls back to a valid backup when primary is corrupt', () => {
    saveBackup(DEFAULT_APP_STATE);
    localStorage.setItem('rebalancer-v1', '{ not valid json }');
    const loaded = loadState();
    expect(loaded).not.toBeNull();
    expect(loaded!.source).toBe('backup');
    expect(loaded!.backupTs).toBeDefined();
    expect(loaded!.state.version).toBe(1);
  });

  it('falls back to backup when primary has invalid version', () => {
    saveBackup(DEFAULT_APP_STATE);
    localStorage.setItem('rebalancer-v1', JSON.stringify({ ...DEFAULT_APP_STATE, version: 2 }));
    const loaded = loadState();
    expect(loaded!.source).toBe('backup');
  });
});
