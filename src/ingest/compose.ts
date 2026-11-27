// src/ingest/compose.ts — combine a portfolio's AppState with its linked holdings
// into the engine's Position[] (spec-account-linking D8, §4.5).
//
// Pure: no React, no Supabase, no network. Runs in the browser today and is
// importable by server code later.

import type { Position } from '../engine/types';
import type { AppState } from './schema';
import { secKey, type HoldingRow } from './adapters/snaptrade';

/**
 * One `holdings` row for the portfolio, joined with its `account_assignments.account_id`:
 * the Drift `Account.id` that the linked account feeds (null while unmapped).
 */
export type LinkedHolding = HoldingRow & { account_id: string | null };

/** The key a linked holding is known by: its ticker, or `SEC:<security_id>` when it has none (§4.2). */
export function linkedHoldingKey(h: Pick<HoldingRow, 'ticker' | 'security_id'>): string {
  const t = h.ticker?.trim();
  return t ? t : secKey(h.security_id);
}

/** The `linkedPositionOverrides` key for a position: `${accountId}:${tickerOrSecKey}`. */
export function linkedOverrideKey(accountId: string, key: string): string {
  return `${accountId}:${key}`;
}

/**
 * Compose the engine's positions.
 *
 * - An account fed by at least one linked account takes its positions **only** from
 *   linked holdings; its `AppState.positions` rows are ignored.
 * - Several linked accounts mapped to one account are **combined, not dropped**
 *   (#234). Holdings with the same key are summed into one position, so each
 *   (account, key) appears once — the Positions table and `linkedPositionOverrides`
 *   both address a position by account + ticker.
 * - Other accounts keep their `AppState.positions` (CSV/manual) unchanged and in order.
 * - `lastUpdatedAt` is the holding's `as_of` (the oldest, when holdings are combined,
 *   so a stale source is never hidden by a fresh one).
 * - `linkedPositionOverrides[accountId:key].locked` applies `locked`.
 * - Holdings that are unmapped (`account_id` null) or mapped to an account not in
 *   `state.accounts` are left out.
 *
 * `linkedAccountIds` optionally names Drift accounts that are linked even when they
 * currently have no holdings (an emptied account), so their stale manual rows are
 * not shown. Without it, "linked" means "has at least one holding in `linked`".
 */
export function composePositions(
  state: Pick<AppState, 'accounts' | 'positions' | 'linkedPositionOverrides'>,
  linked: LinkedHolding[],
  linkedAccountIds: Iterable<string> = [],
): Position[] {
  const known = new Set(state.accounts.map(a => a.id));
  const linkedAccounts = new Set<string>();
  for (const id of linkedAccountIds) if (known.has(id)) linkedAccounts.add(id);

  // accountId → key → combined position (Map keeps first-seen order).
  const byAccount = new Map<string, Map<string, Position>>();
  for (const h of linked) {
    const accountId = h.account_id;
    if (accountId === null || !known.has(accountId)) continue;
    linkedAccounts.add(accountId);

    const key = linkedHoldingKey(h);
    const asOf = Date.parse(h.as_of);
    const incoming: Position = {
      accountId,
      ticker: key,
      marketValue: h.market_value,
      ...(h.description ? { description: h.description } : {}),
      ...(h.cost_basis !== null ? { costBasis: h.cost_basis } : {}),
      ...(Number.isNaN(asOf) ? {} : { lastUpdatedAt: asOf }),
    };

    let positions = byAccount.get(accountId);
    if (!positions) { positions = new Map(); byAccount.set(accountId, positions); }
    const prev = positions.get(key);
    positions.set(key, prev ? combine(prev, incoming) : incoming);
  }

  const overrides = state.linkedPositionOverrides ?? {};
  const out: Position[] = state.positions.filter(p => !linkedAccounts.has(p.accountId));
  for (const account of state.accounts) {
    const positions = byAccount.get(account.id);
    if (!positions) continue;
    for (const p of positions.values()) {
      const locked = overrides[linkedOverrideKey(account.id, p.ticker)]?.locked;
      out.push(locked ? { ...p, locked: true } : p);
    }
  }
  return out;
}

function combine(a: Position, b: Position): Position {
  const costBasis = a.costBasis !== undefined && b.costBasis !== undefined
    ? a.costBasis + b.costBasis
    : undefined;
  const lastUpdatedAt = a.lastUpdatedAt !== undefined && b.lastUpdatedAt !== undefined
    ? Math.min(a.lastUpdatedAt, b.lastUpdatedAt)
    : (a.lastUpdatedAt ?? b.lastUpdatedAt);
  const description = a.description ?? b.description;
  return {
    accountId: a.accountId,
    ticker: a.ticker,
    marketValue: a.marketValue + b.marketValue,
    ...(description !== undefined ? { description } : {}),
    ...(costBasis !== undefined ? { costBasis } : {}),
    ...(lastUpdatedAt !== undefined ? { lastUpdatedAt } : {}),
  };
}
