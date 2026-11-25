// src/ingest/adapters/snaptrade.ts — SnapTrade normalization (spec-account-linking §6.1).
//
// Pure: no network, no SDK, no React, no Supabase. The server (`api/`, M5) fetches
// each account's positions (`getAllAccountPositions`) and balances
// (`getUserAccountBalance`), bundles them as SnapTradeAccountData, and calls
// normalizeSnapTrade to get rows for the `brokerage_logins`, `linked_accounts` and
// `holdings` tables (§4.2).
//
// The input types below are a *minimal local* description of the SnapTrade responses
// (only the fields used), so `src/` never depends on the SnapTrade SDK. Real responses
// carry extra fields and unexpected nulls; every field is read defensively.
//
// Error strings carry only IDs, kinds and reasons — never amounts, names, account
// numbers or descriptions — so they are safe to put in `sync_runs` or a log (D21/D22).

import { positionSchema } from '../schema';

// ─── Input: minimal SnapTrade shapes ─────────────────────────────────────────

/** A decimal string as SnapTrade sends it ("161.803"); numbers are accepted too. */
export type SnapTradeDecimal = string | number | null | undefined;

export interface SnapTradeInstrument {
  /** stock, etf, mutualfund, cef, adr, preferred_stock, bond, other, cash, option, … */
  kind?: string | null;
  id?: string | null;
  symbol?: string | null;
  raw_symbol?: string | null;
  description?: string | null;
  /** Currency code; present on `kind: cash` instruments. */
  code?: string | null;
  figi_instrument?: { figi_code?: string | null } | null;
}

export interface SnapTradePosition {
  instrument?: SnapTradeInstrument | null;
  units?: SnapTradeDecimal;
  price?: SnapTradeDecimal;
  cost_basis?: SnapTradeDecimal;
  currency?: string | null;
  /** Sometimes missing; missing means false. Not used for classification. */
  cash_equivalent?: boolean | null;
}

/** `getAllAccountPositions` response. */
export interface SnapTradePositionsResponse {
  results?: SnapTradePosition[] | null;
  data_freshness?: { as_of?: string | null } | null;
}

/** One entry of the `getUserAccountBalance` response. */
export interface SnapTradeBalance {
  currency?: { code?: string | null } | string | null;
  cash?: SnapTradeDecimal;
}

export interface SnapTradeAccount {
  id: string;
  /** The brokerage authorization (connection) this account belongs to. */
  brokerage_authorization?: string | null;
  name?: string | null;
  number?: string | null;
  institution_name?: string | null;
  raw_type?: string | null;
  /** Account status; can be null in real responses. Not used. */
  status?: string | null;
  sync_status?: {
    holdings?: { last_successful_sync?: string | null } | null;
  } | null;
}

/** The connection (brokerage authorization) an account belongs to, when the caller has it. */
export interface SnapTradeConnection {
  id?: string | null;
  disabled?: boolean | null;
  brokerage?: { name?: string | null; display_name?: string | null } | null;
}

/**
 * One account plus its positions and balances responses. `positions` / `balances`
 * are null or undefined when the call failed or wasn't made.
 */
export interface SnapTradeAccountData {
  account: SnapTradeAccount;
  connection?: SnapTradeConnection | null;
  positions?: SnapTradePositionsResponse | null;
  balances?: SnapTradeBalance[] | null;
  /** When the server fetched this data (ISO). Last-resort `as_of` when SnapTrade gives none. */
  fetchedAt?: string | null;
}

// ─── Output: rows for the §4.2 tables ────────────────────────────────────────
// Columns the server fills itself (`user_id`, `created_at`) are not produced here.

export type BrokerageLoginStatus = 'ok' | 'needs_reauth' | 'error';

/** `brokerage_logins` row, minus server-filled `user_id` / `created_at`. */
export interface BrokerageLoginRow {
  id: string;
  institution: string;
  status: BrokerageLoginStatus;
}

/** `linked_accounts` row, minus server-filled `user_id`. */
export interface LinkedAccountRow {
  id: string;
  login_id: string;
  institution: string;
  name: string | null;
  account_type: string | null;
  mask: string | null;
  /**
   * The holdings timestamp, or null when this account's holdings could not be
   * normalized (positions or balances missing, no usable timestamp). A caller must
   * not replace stored holdings for an account whose `last_synced_at` is null.
   */
  last_synced_at: string | null;
}

/** `holdings` row. Price is deliberately not stored (§4.2, §11 Q6). */
export interface HoldingRow {
  linked_account_id: string;
  /** `instrument.id`, or `CASH:<currency>` for cash. */
  security_id: string;
  /** `instrument.symbol`; `CASH:<currency>` for cash; null when the holding has no ticker. */
  ticker: string | null;
  figi: string | null;
  kind: string;
  /** SnapTrade has no CUSIP; always null here (kept for a Plaid adapter, D20). */
  cusip: string | null;
  description: string | null;
  units: number | null;
  market_value: number;
  cost_basis: number | null;
  as_of: string;
}

export interface SnapTradeNormalized {
  logins: BrokerageLoginRow[];
  accounts: LinkedAccountRow[];
  holdings: HoldingRow[];
  errors: string[];
}

// ─── Kinds ───────────────────────────────────────────────────────────────────

export const SUPPORTED_KINDS: ReadonlySet<string> = new Set([
  'stock', 'etf', 'mutualfund', 'cef', 'adr', 'preferred_stock', 'bond', 'other',
]);
/** Explicitly unsupported in v1 (§6.1). Any kind in neither set is also rejected. */
export const UNSUPPORTED_KINDS: ReadonlySet<string> = new Set([
  'option', 'future', 'future_option', 'cfd', 'tokenized_asset',
]);

/** The synthetic security id / ticker for a currency's cash balance. */
export function cashKey(currency: string): string {
  return `CASH:${currency.trim().toUpperCase()}`;
}

/** The composition key for a holding with no ticker (§4.2). */
export function secKey(securityId: string): string {
  return `SEC:${securityId}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DECIMAL_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** Parse a SnapTrade decimal. null/undefined → null; anything unparseable → NaN. */
export function parseDecimal(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : NaN;
  if (typeof v !== 'string') return NaN;
  const t = v.trim();
  if (!DECIMAL_RE.test(t)) return NaN;
  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t === '' ? null : t;
}

function isTimestamp(v: string | null): v is string {
  return v !== null && !Number.isNaN(Date.parse(v));
}

function maskOf(number: unknown): string | null {
  const n = str(number);
  if (n === null) return null;
  const compact = n.replace(/\s+/g, '');
  return compact.length === 0 ? null : compact.slice(-4);
}

function balanceCurrency(b: SnapTradeBalance): string | null {
  const c = b.currency;
  if (typeof c === 'string') return str(c);
  if (c && typeof c === 'object') return str(c.code);
  return null;
}

/** Validate a holding the way composition will see it (rows failing positionSchema go to errors). */
function failsPositionSchema(h: HoldingRow): boolean {
  return !positionSchema.safeParse({
    accountId: h.linked_account_id,
    ticker: h.ticker ?? secKey(h.security_id),
    marketValue: h.market_value,
    ...(h.cost_basis !== null ? { costBasis: h.cost_basis } : {}),
  }).success;
}

/** Sum two holdings of the same security in one account (lots or repeated rows). */
function combine(a: HoldingRow, b: HoldingRow): HoldingRow {
  return {
    ...a,
    units: a.units !== null && b.units !== null ? a.units + b.units : null,
    market_value: a.market_value + b.market_value,
    // An aggregate is only meaningful when every part has one.
    cost_basis: a.cost_basis !== null && b.cost_basis !== null ? a.cost_basis + b.cost_basis : null,
    description: a.description ?? b.description,
    figi: a.figi ?? b.figi,
  };
}

// ─── Normalization ───────────────────────────────────────────────────────────

/**
 * Normalize SnapTrade accounts into `brokerage_logins`, `linked_accounts` and
 * `holdings` rows (§6.1).
 *
 * - Securities come from `positions.results[]`, filtered by `instrument.kind`.
 *   Unsupported kinds and unparseable rows go to `errors`; the rest of the account
 *   is still returned.
 * - Cash comes from the balances response, one `CASH:<currency>` holding per
 *   currency with non-zero cash. A `kind: cash` position is used only for a currency
 *   the balances response doesn't report, so cash is never counted twice.
 * - An account whose positions or balances response is missing, or that has no
 *   usable timestamp, gets its `linked_accounts` row (with `last_synced_at: null`)
 *   but no holdings, and an error, so a partial sync never looks like an emptied account.
 */
export function normalizeSnapTrade(accounts: SnapTradeAccountData[]): SnapTradeNormalized {
  const logins = new Map<string, BrokerageLoginRow>();
  const outAccounts: LinkedAccountRow[] = [];
  const holdings: HoldingRow[] = [];
  const errors: string[] = [];
  const seenAccounts = new Set<string>();

  for (const data of accounts ?? []) {
    const acct = data?.account;
    const accountId = str(acct?.id);
    if (!acct || accountId === null) {
      errors.push('account: missing id; skipped');
      continue;
    }
    if (seenAccounts.has(accountId)) {
      errors.push(`account ${accountId}: duplicate in input; skipped`);
      continue;
    }
    seenAccounts.add(accountId);

    const loginId = str(acct.brokerage_authorization) ?? str(data.connection?.id);
    if (loginId === null) {
      errors.push(`account ${accountId}: no brokerage_authorization; skipped`);
      continue;
    }

    const conn = data.connection ?? null;
    const brokerageName = str(conn?.brokerage?.display_name) ?? str(conn?.brokerage?.name);
    const institution = str(acct.institution_name) ?? brokerageName ?? 'Unknown';

    if (!logins.has(loginId)) {
      logins.set(loginId, {
        id: loginId,
        institution: brokerageName ?? institution,
        status: conn?.disabled === true ? 'needs_reauth' : 'ok',
      });
    }

    const accountRow: LinkedAccountRow = {
      id: accountId,
      login_id: loginId,
      institution,
      name: str(acct.name),
      account_type: str(acct.raw_type),
      mask: maskOf(acct.number),
      last_synced_at: null,
    };
    outAccounts.push(accountRow);

    const positions = data.positions;
    const balances = data.balances;
    if (!positions || typeof positions !== 'object') {
      errors.push(`account ${accountId}: positions unavailable; holdings not updated`);
      continue;
    }
    if (!Array.isArray(balances)) {
      errors.push(`account ${accountId}: balances unavailable; holdings not updated`);
      continue;
    }

    const asOfCandidates = [
      str(positions.data_freshness?.as_of),
      str(acct.sync_status?.holdings?.last_successful_sync),
      str(data.fetchedAt),
    ];
    const asOf = asOfCandidates.find(isTimestamp) ?? null;
    if (asOf === null) {
      errors.push(`account ${accountId}: no holdings timestamp; holdings not updated`);
      continue;
    }

    const byId = new Map<string, HoldingRow>();
    const add = (h: HoldingRow) => {
      const prev = byId.get(h.security_id);
      byId.set(h.security_id, prev ? combine(prev, h) : h);
    };

    // Cash from balances.
    const cashFromBalances = new Set<string>();
    for (const b of balances) {
      if (!b || typeof b !== 'object') continue;
      const ccy = balanceCurrency(b);
      const cash = parseDecimal(b.cash);
      if (cash === null) continue; // no cash figure for this currency
      if (ccy === null) {
        errors.push(`account ${accountId}: balance with no currency; skipped`);
        continue;
      }
      if (Number.isNaN(cash)) {
        errors.push(`account ${accountId}: ${cashKey(ccy)} cash unparseable; skipped`);
        continue;
      }
      cashFromBalances.add(cashKey(ccy));
      if (cash === 0) continue;
      const row: HoldingRow = {
        linked_account_id: accountId, security_id: cashKey(ccy), ticker: cashKey(ccy),
        figi: null, kind: 'cash', cusip: null, description: null,
        units: cash, market_value: cash, cost_basis: null, as_of: asOf,
      };
      if (failsPositionSchema(row)) {
        errors.push(`account ${accountId}: ${cashKey(ccy)} cash is negative; skipped`);
        continue;
      }
      add(row);
    }

    const results = Array.isArray(positions.results) ? positions.results : [];
    results.forEach((p, i) => {
      const where = `account ${accountId}: position ${i}`;
      const inst = p?.instrument ?? null;
      const kind = str(inst?.kind)?.toLowerCase() ?? null;

      if (kind === 'cash') {
        const ccy = str(inst?.code) ?? str(p?.currency);
        if (ccy === null) { errors.push(`${where}: cash with no currency; skipped`); return; }
        if (cashFromBalances.has(cashKey(ccy))) return; // balances already reported it
        const units = parseDecimal(p?.units);
        const price = parseDecimal(p?.price);
        if (units === null || Number.isNaN(units) || (price !== null && Number.isNaN(price))) {
          errors.push(`${where}: ${cashKey(ccy)} amount unparseable; skipped`);
          return;
        }
        const value = units * (price ?? 1);
        if (value === 0) return;
        const row: HoldingRow = {
          linked_account_id: accountId, security_id: cashKey(ccy), ticker: cashKey(ccy),
          figi: null, kind: 'cash', cusip: null, description: null,
          units: value, market_value: value, cost_basis: null, as_of: asOf,
        };
        if (failsPositionSchema(row)) { errors.push(`${where}: ${cashKey(ccy)} invalid amount; skipped`); return; }
        add(row);
        return;
      }

      const securityId = str(inst?.id);
      const label = securityId !== null ? `${where} (${securityId})` : where;
      if (kind === null || !SUPPORTED_KINDS.has(kind)) {
        const why = kind === null ? 'no instrument kind'
          : UNSUPPORTED_KINDS.has(kind) ? `unsupported kind "${kind}"`
          : `unknown kind "${kind}"`;
        errors.push(`${label}: ${why}; skipped`);
        return;
      }
      if (securityId === null) { errors.push(`${where}: no instrument id; skipped`); return; }

      const units = parseDecimal(p?.units);
      const price = parseDecimal(p?.price);
      const costBasis = parseDecimal(p?.cost_basis);
      if (units === null || Number.isNaN(units)) { errors.push(`${label}: units unparseable; skipped`); return; }
      if (price === null || Number.isNaN(price)) { errors.push(`${label}: price unparseable; skipped`); return; }
      if (Number.isNaN(costBasis)) { errors.push(`${label}: cost_basis unparseable; skipped`); return; }

      const row: HoldingRow = {
        linked_account_id: accountId,
        security_id: securityId,
        ticker: str(inst?.symbol),
        figi: str(inst?.figi_instrument?.figi_code),
        kind,
        cusip: null,
        description: str(inst?.description),
        units,
        market_value: units * price,
        cost_basis: costBasis,
        as_of: asOf,
      };
      if (failsPositionSchema(row)) {
        errors.push(`${label}: invalid position (negative value or cost basis); skipped`);
        return;
      }
      add(row);
    });

    holdings.push(...byId.values());
    accountRow.last_synced_at = asOf;
  }

  return { logins: [...logins.values()], accounts: outAccounts, holdings, errors };
}
