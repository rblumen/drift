import { describe, it, expect } from 'vitest';
import fixture from './fixtures/snaptrade-synthetic.json';
import {
  normalizeSnapTrade, parseDecimal, cashKey, secKey,
  type SnapTradeAccountData, type SnapTradePosition,
} from './snaptrade';
import { classifyTicker } from '../../engine/classify';

const ACCOUNTS = fixture.accounts as unknown as SnapTradeAccountData[];

function oneAccount(
  results: SnapTradePosition[],
  overrides: Partial<SnapTradeAccountData> = {},
): SnapTradeAccountData {
  return {
    account: { id: 'acct-x', brokerage_authorization: 'login-x', institution_name: 'Brokerage A' },
    positions: { results, data_freshness: { as_of: '2026-11-20T00:00:00Z' } },
    balances: [],
    ...overrides,
  };
}

describe('parseDecimal', () => {
  it('parses decimal strings and finite numbers', () => {
    expect(parseDecimal('161.803')).toBe(161.803);
    expect(parseDecimal(' -2.5 ')).toBe(-2.5);
    expect(parseDecimal('1e3')).toBe(1000);
    expect(parseDecimal('.5')).toBe(0.5);
    expect(parseDecimal(42)).toBe(42);
  });
  it('returns null for null/undefined and NaN for anything unparseable', () => {
    expect(parseDecimal(null)).toBeNull();
    expect(parseDecimal(undefined)).toBeNull();
    for (const bad of ['', 'N/A', '1,000', '12abc', 'Infinity', Infinity, {}, true]) {
      expect(parseDecimal(bad)).toBeNaN();
    }
  });
});

describe('normalizeSnapTrade — synthetic fixture', () => {
  const out = normalizeSnapTrade(ACCOUNTS);

  it('emits one login per brokerage authorization', () => {
    expect(out.logins).toEqual([
      { id: 'login-a-0001', institution: 'Brokerage A', status: 'ok' },
      { id: 'login-b-0002', institution: 'Recordkeeper B', status: 'needs_reauth' },
    ]);
  });

  it('emits a linked_accounts row per account, with mask = last 4 of number', () => {
    expect(out.accounts).toEqual([
      {
        id: 'acct-roth-0001', login_id: 'login-a-0001', institution: 'Brokerage A',
        name: 'Alex Roth IRA', account_type: 'Roth IRA', mask: '1234',
        last_synced_at: '2026-11-20T12:00:00Z',
      },
      {
        id: 'acct-401k-0002', login_id: 'login-b-0002', institution: 'Recordkeeper B',
        name: null, account_type: '401K', mask: '5678',
        // No data_freshness: falls back to sync_status.holdings.last_successful_sync.
        last_synced_at: '2026-11-18T08:00:00Z',
      },
      {
        id: 'acct-ira-0003', login_id: 'login-a-0001', institution: 'Brokerage A',
        name: 'Sam Traditional IRA', account_type: 'investmentAccount', mask: '9999',
        last_synced_at: null,
      },
    ]);
  });

  it('normalizes supported positions, storing market_value (units × price) and no price', () => {
    const vti = out.holdings.find(h => h.security_id === 'sec-vti');
    expect(vti).toEqual({
      linked_account_id: 'acct-roth-0001', security_id: 'sec-vti', ticker: 'VTI',
      figi: 'BBG000000VTI', kind: 'etf', cusip: null, description: 'Total Stock Market ETF',
      units: 50.5, market_value: 10100, cost_basis: 8000, as_of: '2026-11-20T12:00:00Z',
    });
    expect(vti).not.toHaveProperty('price');
  });

  it('keeps a ticker-less holding with ticker null (composition keys it SEC:<id>)', () => {
    const cit = out.holdings.find(h => h.security_id === 'sec-cit-2050');
    expect(cit?.ticker).toBeNull();
    expect(cit?.market_value).toBe(3000);
    expect(cit?.cost_basis).toBeNull();
    expect(cit?.description).toBe('Collective Trust 2050');
  });

  it('treats a money-market fund as an ordinary fund (missing cash_equivalent is fine)', () => {
    const mm = out.holdings.find(h => h.security_id === 'sec-vmfxx');
    expect(mm).toMatchObject({ ticker: 'VMFXX', kind: 'mutualfund', market_value: 1000 });
  });

  it('takes cash from balances as CASH:<currency>, and does not double-count a kind:cash position', () => {
    const cash = out.holdings.filter(h => h.linked_account_id === 'acct-roth-0001' && h.kind === 'cash');
    expect(cash).toEqual([expect.objectContaining({
      security_id: 'CASH:USD', ticker: 'CASH:USD', market_value: 500, units: 500,
    })]);
  });

  it('classifies CASH:USD as CASH', () => {
    expect(classifyTicker(cashKey('usd'))).toBe('CASH');
  });

  it('sends unsupported kinds and unparseable rows to errors, keeping the rest', () => {
    const roth = out.holdings.filter(h => h.linked_account_id === 'acct-roth-0001').map(h => h.security_id);
    expect(roth.sort()).toEqual(['CASH:USD', 'sec-cit-2050', 'sec-vmfxx', 'sec-vti']);
    expect(out.errors).toEqual(expect.arrayContaining([
      expect.stringMatching(/acct-roth-0001: position 4 \(sec-opt-1\): unsupported kind "option"/),
      expect.stringMatching(/acct-roth-0001: position 5 \(sec-bad-units\): units unparseable/),
    ]));
  });

  it('gives an account with missing positions/balances no holdings and an error', () => {
    expect(out.holdings.some(h => h.linked_account_id === 'acct-ira-0003')).toBe(false);
    expect(out.errors).toContain('account acct-ira-0003: positions unavailable; holdings not updated');
  });

  it('keeps errors free of amounts, names and account numbers', () => {
    const text = out.errors.join('\n');
    for (const secret of ['Alex', 'Sam', '1234', 'XX0000', '50.5', '8000', 'Bad units', 'BADU']) {
      expect(text).not.toContain(secret);
    }
  });

  it('every holding passes positionSchema under its composition key', async () => {
    const { positionSchema } = await import('../schema');
    for (const h of out.holdings) {
      const r = positionSchema.safeParse({
        accountId: h.linked_account_id, ticker: h.ticker ?? secKey(h.security_id),
        marketValue: h.market_value, ...(h.cost_basis !== null ? { costBasis: h.cost_basis } : {}),
      });
      expect(r.success).toBe(true);
    }
  });
});

describe('normalizeSnapTrade — edge cases', () => {
  it('uses a kind:cash position when balances report no cash for that currency', () => {
    const out = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'cash', code: 'USD' }, units: '250', price: '1' },
    ])]);
    expect(out.holdings).toEqual([expect.objectContaining({ security_id: 'CASH:USD', market_value: 250 })]);
  });

  it('skips zero cash and balance entries with null cash', () => {
    const out = normalizeSnapTrade([oneAccount([], {
      balances: [{ currency: { code: 'USD' }, cash: 0 }, { currency: 'CAD', cash: null }],
    })]);
    expect(out.holdings).toEqual([]);
    expect(out.errors).toEqual([]);
    expect(out.accounts[0].last_synced_at).toBe('2026-11-20T00:00:00Z');
  });

  it('accepts a string cash balance and a plain-string currency', () => {
    const out = normalizeSnapTrade([oneAccount([], { balances: [{ currency: 'usd', cash: '12.34' }] })]);
    expect(out.holdings[0]).toMatchObject({ security_id: 'CASH:USD', market_value: 12.34 });
  });

  it('rejects negative cash (margin debit) and negative positions', () => {
    const out = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'stock', id: 's1', symbol: 'VTI' }, units: '-10', price: '200' },
    ], { balances: [{ currency: { code: 'USD' }, cash: '-100' }] })]);
    expect(out.holdings).toEqual([]);
    expect(out.errors).toHaveLength(2);
  });

  it('rejects unparseable price and cost_basis, missing kind, unknown kind and missing id', () => {
    const out = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'stock', id: 'a', symbol: 'A' }, units: '1', price: 'x' },
      { instrument: { kind: 'stock', id: 'b', symbol: 'B' }, units: '1', price: '1', cost_basis: '?' },
      { instrument: { id: 'c', symbol: 'C' }, units: '1', price: '1' },
      { instrument: { kind: 'crypto', id: 'd', symbol: 'D' }, units: '1', price: '1' },
      { instrument: { kind: 'tokenized_asset', id: 'e', symbol: 'E' }, units: '1', price: '1' },
      { instrument: { kind: 'etf', symbol: 'F' }, units: '1', price: '1' },
      { instrument: null, units: '1', price: '1' },
    ])]);
    expect(out.holdings).toEqual([]);
    expect(out.errors).toEqual([
      'account acct-x: position 0 (a): price unparseable; skipped',
      'account acct-x: position 1 (b): cost_basis unparseable; skipped',
      'account acct-x: position 2 (c): no instrument kind; skipped',
      'account acct-x: position 3 (d): unknown kind "crypto"; skipped',
      'account acct-x: position 4 (e): unsupported kind "tokenized_asset"; skipped',
      'account acct-x: position 5: no instrument id; skipped',
      'account acct-x: position 6: no instrument kind; skipped',
    ]);
  });

  it('accepts every supported kind, case-insensitively', () => {
    const kinds = ['stock', 'ETF', 'mutualfund', 'cef', 'adr', 'preferred_stock', 'bond', 'other'];
    const out = normalizeSnapTrade([oneAccount(kinds.map((kind, i) => ({
      instrument: { kind, id: `s${i}`, symbol: `T${i}` }, units: '1', price: '1',
    })))]);
    expect(out.holdings.map(h => h.kind)).toEqual(kinds.map(k => k.toLowerCase()));
    expect(out.errors).toEqual([]);
  });

  it('sums repeated rows for one security (PK is account + security)', () => {
    const out = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'etf', id: 's1', symbol: 'VTI' }, units: '1', price: '100', cost_basis: '90' },
      { instrument: { kind: 'etf', id: 's1', symbol: 'VTI' }, units: '2', price: '100', cost_basis: '150' },
      { instrument: { kind: 'etf', id: 's2', symbol: 'BND' }, units: '1', price: '70', cost_basis: '60' },
      { instrument: { kind: 'etf', id: 's2', symbol: 'BND' }, units: '1', price: '70' },
    ])]);
    expect(out.holdings).toEqual([
      expect.objectContaining({ security_id: 's1', units: 3, market_value: 300, cost_basis: 240 }),
      // One lot without a basis: the aggregate is unknown.
      expect.objectContaining({ security_id: 's2', units: 2, market_value: 140, cost_basis: null }),
    ]);
  });

  it('tolerates extra fields, nulls and a null results array', () => {
    const out = normalizeSnapTrade([oneAccount([], {
      positions: { results: null, data_freshness: { as_of: '2026-11-20T00:00:00Z' } },
      account: {
        id: 'acct-x', brokerage_authorization: 'login-x', name: null, number: null,
        institution_name: null, raw_type: null, status: null, sync_status: null,
      },
      connection: { brokerage: { name: 'Brokerage A' } },
    })]);
    expect(out.accounts).toEqual([{
      id: 'acct-x', login_id: 'login-x', institution: 'Brokerage A', name: null,
      account_type: null, mask: null, last_synced_at: '2026-11-20T00:00:00Z',
    }]);
    expect(out.logins).toEqual([{ id: 'login-x', institution: 'Brokerage A', status: 'ok' }]);
    expect(out.errors).toEqual([]);
  });

  it('falls back to fetchedAt, and errors when no usable timestamp exists', () => {
    const withFetched = normalizeSnapTrade([oneAccount([], {
      positions: { results: [], data_freshness: { as_of: 'not a date' } },
      fetchedAt: '2026-11-21T00:00:00Z',
    })]);
    expect(withFetched.accounts[0].last_synced_at).toBe('2026-11-21T00:00:00Z');

    const without = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'etf', id: 's1', symbol: 'VTI' }, units: '1', price: '1' },
    ], { positions: { results: [] } })]);
    expect(without.holdings).toEqual([]);
    expect(without.accounts[0].last_synced_at).toBeNull();
    expect(without.errors).toEqual(['account acct-x: no holdings timestamp; holdings not updated']);
  });

  it('skips accounts with no id, no login, or a duplicate id', () => {
    const out = normalizeSnapTrade([
      { account: { id: '' } },
      { account: { id: 'acct-y' } },
      oneAccount([]),
      oneAccount([]),
    ]);
    expect(out.accounts.map(a => a.id)).toEqual(['acct-x']);
    expect(out.errors).toEqual([
      'account: missing id; skipped',
      'account acct-y: no brokerage_authorization; skipped',
      'account acct-x: duplicate in input; skipped',
    ]);
  });

  it('flags missing balances as incomplete', () => {
    const out = normalizeSnapTrade([oneAccount([
      { instrument: { kind: 'etf', id: 's1', symbol: 'VTI' }, units: '1', price: '1' },
    ], { balances: undefined })]);
    expect(out.holdings).toEqual([]);
    expect(out.errors).toEqual(['account acct-x: balances unavailable; holdings not updated']);
  });

  it('returns empty output for empty input', () => {
    expect(normalizeSnapTrade([])).toEqual({ logins: [], accounts: [], holdings: [], errors: [] });
  });
});
