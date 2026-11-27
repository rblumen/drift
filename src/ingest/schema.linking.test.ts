// AppState additions for account linking (spec-account-linking §4.4): all optional
// with defaults, no schema-version bump, so existing saves and fixtures still parse.
import { describe, it, expect } from 'vitest';
import { appStateSchema } from './schema';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import samplePortfolio from '../data/sample-portfolio.json';
import demo529 from '../data/fixtures/529-rebalance-limit-demo.json';

const LEGACY = {
  version: 1,
  accounts: [{ id: 'a1', name: 'Brokerage', institution: 'Schwab', type: 'TAXABLE' }],
  positions: [{ accountId: 'a1', ticker: 'VTI', marketValue: 100 }],
  strategy: DEFAULT_STRATEGY,
  tickerOverrides: {},
};

describe('appStateSchema linking additions', () => {
  it('parses a save from before the additions, defaulting the new fields', () => {
    const r = appStateSchema.parse(LEGACY);
    expect(r.version).toBe(1);
    expect(r.linkedPositionOverrides).toEqual({});
    expect(r.people).toEqual([]);
    expect(r.accounts[0]).not.toHaveProperty('ownerPersonIds');
  });

  it('still parses the shipped sample and fixture files', () => {
    expect(appStateSchema.safeParse(samplePortfolio).success).toBe(true);
    expect(appStateSchema.safeParse(demo529).success).toBe(true);
  });

  it('round-trips people, owner labels and linked position overrides', () => {
    const state = {
      ...LEGACY,
      accounts: [{ ...LEGACY.accounts[0], ownerPersonIds: ['p1', 'p2'] }],
      people: [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Sam' }],
      linkedPositionOverrides: { 'a1:VTI': { locked: true }, 'a1:SEC:abc': { locked: false } },
    };
    const r = appStateSchema.parse(JSON.parse(JSON.stringify(state)));
    expect(r.accounts[0].ownerPersonIds).toEqual(['p1', 'p2']);
    expect(r.people).toEqual(state.people);
    expect(r.linkedPositionOverrides).toEqual(state.linkedPositionOverrides);
  });

  it('rejects malformed additions', () => {
    expect(appStateSchema.safeParse({ ...LEGACY, people: [{ id: 'p1' }] }).success).toBe(false);
    expect(appStateSchema.safeParse({ ...LEGACY, linkedPositionOverrides: { k: { locked: 'yes' } } }).success).toBe(false);
    expect(appStateSchema.safeParse({
      ...LEGACY, accounts: [{ ...LEGACY.accounts[0], ownerPersonIds: 'p1' }],
    }).success).toBe(false);
  });
});
