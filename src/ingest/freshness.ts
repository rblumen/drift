// src/ingest/freshness.ts — import/update freshness derivation (issue #212).
//
// `Position.lastUpdatedAt` (engine/types.ts) is the single stored fact — a
// display-only stamp set when a position is created/confirmed by an import or
// hand-edited (see ImportPanel.tsx's confirm/add/edit paths). Everything else
// here is a *pure derivation* from that field: account-level freshness is the
// max over the account's positions, never a separately-stored value, so it can
// never drift out of sync with the positions themselves.
//
// Kept in src/ingest (not src/engine) because this is display/UI-adjacent
// metadata, not rebalance math — engine/types.ts explicitly calls out that the
// engine's math must never read lastUpdatedAt.

import type { Position } from '../engine/types';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Below this age, "Updated just now" reads better than "Updated today" — long
// enough to survive the render tick after a confirm click, short enough that
// it never lingers past the moment it's confirming.
const JUST_NOW_THRESHOLD_MS = 5 * MS_PER_MINUTE;

/** Whole calendar days between two timestamps (local time), positive when
 *  `thenMs` precedes `nowMs`. Mirrors the day-boundary logic in
 *  ReminderPanel.daysUntil, just oriented the other way (elapsed, not until). */
function calendarDaysElapsed(nowMs: number, thenMs: number): number {
  const now = new Date(nowMs);
  const then = new Date(thenMs);
  const a = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const b = Date.UTC(then.getFullYear(), then.getMonth(), then.getDate());
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * An account's freshness = the max `lastUpdatedAt` over its positions.
 * Derived, never stored — recomputes naturally as positions are added,
 * edited, or removed. Returns undefined when the account has no positions,
 * or none of them carry a timestamp yet (legacy/untracked data).
 */
export function accountFreshness(positions: Position[], accountId: string): number | undefined {
  let freshest: number | undefined;
  for (const p of positions) {
    if (p.accountId !== accountId || p.lastUpdatedAt === undefined) continue;
    if (freshest === undefined || p.lastUpdatedAt > freshest) freshest = p.lastUpdatedAt;
  }
  return freshest;
}

/**
 * Relative-time label for display next to an account or the Import screen's
 * target account. `lastUpdatedAt` undefined means "nothing tracked yet" —
 * rendered as a neutral "Not tracked yet" rather than any stale-looking date,
 * so legacy saves (no timestamps at all) never read as out of date.
 */
export function formatRelativeUpdate(nowMs: number, lastUpdatedAt: number | undefined): string {
  if (lastUpdatedAt === undefined) return 'Not tracked yet';
  if (nowMs - lastUpdatedAt < JUST_NOW_THRESHOLD_MS) return 'Updated just now';
  const days = calendarDaysElapsed(nowMs, lastUpdatedAt);
  if (days <= 0) return 'Updated today';
  if (days === 1) return 'Updated yesterday';
  return `Updated ${days} days ago`;
}

/**
 * "Same-pass" tolerance for the position-level lag marker: how far behind the
 * account's freshest position a row must fall before it's flagged as still
 * needing an update. Single named constant so it's easy to retune.
 *
 * Two edits made seconds or minutes apart while working through an account
 * one row at a time must never flag each other — 4 hours comfortably covers
 * one editing session. A row left for the *next day* should flag even if less
 * than 4 hours has technically elapsed (e.g. an 11pm edit followed by a
 * 1am edit) — isLagging's earlier-calendar-day check catches that case
 * independent of this constant.
 */
export const LAG_TOLERANCE_MS = 4 * 60 * 60 * 1000;

/**
 * Whether one position's timestamp lags its account's freshest position
 * enough to warrant the "still to update" row marker.
 *
 *   - No tracked positions in the account at all (`accountFreshestAt`
 *     undefined) → nothing flags; there's no freshness signal yet.
 *   - An untracked position (`lastUpdatedAt` undefined) in an account that
 *     DOES have tracked ones → always lags (it needs updating like any other
 *     stale row).
 *   - Otherwise: lags when older than the freshest by more than
 *     LAG_TOLERANCE_MS, OR when it falls on an earlier calendar day (catches
 *     the "just past midnight" case the raw ms diff alone would miss).
 *
 * A fresh CSV import stamps every row with the same `Date.now()`, so all rows
 * tie the freshest and none lag — exactly the "flags nothing" requirement.
 */
export function isLagging(lastUpdatedAt: number | undefined, accountFreshestAt: number | undefined): boolean {
  if (accountFreshestAt === undefined) return false;
  if (lastUpdatedAt === undefined) return true;
  if (lastUpdatedAt >= accountFreshestAt) return false;
  if (accountFreshestAt - lastUpdatedAt > LAG_TOLERANCE_MS) return true;
  return calendarDaysElapsed(accountFreshestAt, lastUpdatedAt) > 0;
}
