import { describe, it, expect } from 'vitest';
import { composePositions, linkedHoldingKey, linkedOverrideKey, type LinkedHolding } from './compose';
import { normalizeSnapTrade, type SnapTradeAccountData } from './adapters/snaptrade';
import fixture from './adapters/fixtures/snaptrade-synthetic.json';
import { accountFreshness } from './freshness';
import type { Account, Position } from '../engine/types';
import type { AppState } from './schema';

const ACCOUNTS: Account[] = [
  { id: 'brokerage', name: 'Joint Brokerage', institution: 'Brokerage A', type: 'TAXABLE' },
  { id: 'roth',      name: 'Alex Roth',       institution: 'Brokerage A', type: 'ROTH_IRA' },
  { id: '401k',      name: 'Sam 401(k)',      institution: 'Recordkeeper B', type: 'FOUR_OH_ONE_K' },
];

const MANUAL: Position[] = [
  { accountId: 'brokerage', ticker: 'VTI', marketValue: 1000 },
  { accountId: 'roth',      ticker: 'VXUS', marketValue: 999 },  // replaced by linked holdings
  { accountId: 'brokerage', ticker: 'BND', marketValue: 500, locked: true },
];

type ComposeState = Pick<AppState, 'accounts' | 'positions' | 'linkedPositionOverrides'>;
function state(overrides: Partial<ComposeState> = {}): ComposeState {
  return { accounts: ACCOUNTS, positions: MANUAL, linkedPositionOverrides: {}, ...overrides };
}

function holding(partial: Partial<LinkedHolding> & Pick<LinkedHolding, 'security_id'>): LinkedHolding {
  return {
    linked_account_id: 'la-1', account_id: 'roth', ticker: null, figi: null, kind: 'etf',
    cusip: null, description: null, units: 1, market_value: 100, cost_basis: null,
    as_of: '2026-11-20T12:00:00Z', ...partial,
  };
}

describe('composePositions', () => {
  it('returns AppState.positions unchanged when nothing is linked (guest mode)', () => {
    const out = composePositions(state(), []);
    expect(out).toEqual(MANUAL);
    out.forEach((p, i) => expect(p).toBe(MANUAL[i]));
  });

  it('takes a linked account’s positions only from holdings, ignoring its manual rows', () => {
    const out = composePositions(state(), [
      holding({ security_id: 's-vti', ticker: 'VTI', market_value: 2000, cost_basis: 1500, description: 'Total Market' }),
    ]);
    expect(out).toEqual([
      MANUAL[0], MANUAL[2],
      {
        accountId: 'roth', ticker: 'VTI', marketValue: 2000, costBasis: 1500,
        description: 'Total Market', lastUpdatedAt: Date.parse('2026-11-20T12:00:00Z'),
      },
    ]);
  });

  it('sets lastUpdatedAt from as_of so freshness shows the sync time', () => {
    const out = composePositions(state(), [holding({ security_id: 's1', ticker: 'VTI', as_of: '2026-11-18T08:00:00Z' })]);
    expect(accountFreshness(out, 'roth')).toBe(Date.parse('2026-11-18T08:00:00Z'));
  });

  it('keys a ticker-less holding as SEC:<security_id>', () => {
    const out = composePositions(state(), [holding({ security_id: 'sec-cit-2050', ticker: null })]);
    expect(out[out.length - 1]?.ticker).toBe('SEC:sec-cit-2050');
    expect(linkedHoldingKey({ ticker: '  ', security_id: 'x' })).toBe('SEC:x');
  });

  it('applies linkedPositionOverrides.locked by account + key', () => {
    const out = composePositions(
      state({
        linkedPositionOverrides: {
          [linkedOverrideKey('roth', 'VTI')]: { locked: true },
          [linkedOverrideKey('roth', 'SEC:s2')]: { locked: true },
          [linkedOverrideKey('roth', 'BND')]: { locked: false },
          [linkedOverrideKey('brokerage', 'VTI')]: { locked: true }, // manual account: not applied
        },
      }),
      [
        holding({ security_id: 's1', ticker: 'VTI' }),
        holding({ security_id: 's2', ticker: null }),
        holding({ security_id: 's3', ticker: 'BND' }),
      ],
    );
    const roth = out.filter(p => p.accountId === 'roth');
    expect(roth.map(p => [p.ticker, p.locked])).toEqual([
      ['VTI', true], ['SEC:s2', true], ['BND', undefined],
    ]);
    expect(out.find(p => p.accountId === 'brokerage' && p.ticker === 'VTI')?.locked).toBeUndefined();
  });

  it('combines several linked accounts mapped to one account instead of dropping any (#234)', () => {
    const out = composePositions(state(), [
      holding({ linked_account_id: 'la-1', security_id: 's-vti', ticker: 'VTI', market_value: 100, cost_basis: 80, as_of: '2026-11-20T00:00:00Z' }),
      holding({ linked_account_id: 'la-2', security_id: 's-vti', ticker: 'VTI', market_value: 50, cost_basis: 40, as_of: '2026-11-19T00:00:00Z' }),
      holding({ linked_account_id: 'la-2', security_id: 's-bnd', ticker: 'BND', market_value: 30 }),
      holding({ linked_account_id: 'la-1', security_id: 'CASH:USD', ticker: 'CASH:USD', kind: 'cash', market_value: 5 }),
      holding({ linked_account_id: 'la-2', security_id: 'CASH:USD', ticker: 'CASH:USD', kind: 'cash', market_value: 7 }),
    ]);
    const roth = out.filter(p => p.accountId === 'roth');
    expect(roth).toEqual([
      // Same ticker summed; the older sync time wins so staleness isn't hidden.
      { accountId: 'roth', ticker: 'VTI', marketValue: 150, costBasis: 120, lastUpdatedAt: Date.parse('2026-11-19T00:00:00Z') },
      { accountId: 'roth', ticker: 'BND', marketValue: 30, lastUpdatedAt: Date.parse('2026-11-20T12:00:00Z') },
      { accountId: 'roth', ticker: 'CASH:USD', marketValue: 12, lastUpdatedAt: Date.parse('2026-11-20T12:00:00Z') },
    ]);
    const total = roth.reduce((s, p) => s + p.marketValue, 0);
    expect(total).toBe(192);
  });

  it('drops an aggregate cost basis when any combined part lacks one', () => {
    const out = composePositions(state(), [
      holding({ linked_account_id: 'la-1', security_id: 's1', ticker: 'VTI', cost_basis: 80 }),
      holding({ linked_account_id: 'la-2', security_id: 's1', ticker: 'VTI', cost_basis: null }),
    ]);
    expect(out[out.length - 1]).not.toHaveProperty('costBasis');
  });

  it('ignores unmapped holdings and holdings for accounts not in the portfolio', () => {
    const out = composePositions(state(), [
      holding({ security_id: 's1', ticker: 'VTI', account_id: null }),
      holding({ security_id: 's2', ticker: 'VTI', account_id: 'deleted-account' }),
    ]);
    expect(out).toEqual(MANUAL);
  });

  it('honors linkedAccountIds for a linked account that currently has no holdings', () => {
    const out = composePositions(state(), [], ['roth', 'not-in-portfolio']);
    expect(out).toEqual([MANUAL[0], MANUAL[2]]);
  });

  it('orders linked positions by the portfolio’s account order', () => {
    const out = composePositions(state(), [
      holding({ security_id: 'a', ticker: 'BND', account_id: '401k' }),
      holding({ security_id: 'b', ticker: 'VTI', account_id: 'roth' }),
    ]);
    expect(out.map(p => p.accountId)).toEqual(['brokerage', 'brokerage', 'roth', '401k']);
  });

  it('composes the normalized synthetic SnapTrade fixture end to end', () => {
    const norm = normalizeSnapTrade(fixture.accounts as unknown as SnapTradeAccountData[]);
    const mapping: Record<string, string> = { 'acct-roth-0001': 'roth', 'acct-401k-0002': '401k' };
    const linked: LinkedHolding[] = norm.holdings.map(h => ({ ...h, account_id: mapping[h.linked_account_id] ?? null }));
    const out = composePositions(state({ positions: [] }), linked);
    expect(out.map(p => `${p.accountId}:${p.ticker}:${p.marketValue}`)).toEqual([
      'roth:CASH:USD:500',
      'roth:VTI:10100',
      'roth:SEC:sec-cit-2050:3000',
      'roth:VMFXX:1000',
      '401k:BND:14500',
    ]);
  });
});
