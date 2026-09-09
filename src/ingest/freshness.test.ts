import { describe, it, expect } from 'vitest';
import { accountFreshness, formatRelativeUpdate, isLagging, LAG_TOLERANCE_MS } from './freshness';
import type { Position } from '../engine/types';

const HOUR = 60 * 60 * 1000;

function pos(accountId: string, ticker: string, lastUpdatedAt?: number): Position {
  return { accountId, ticker, marketValue: 1000, lastUpdatedAt };
}

// ─── accountFreshness ───────────────────────────────────────────────────────

describe('accountFreshness', () => {
  it('returns undefined when the account has no positions', () => {
    expect(accountFreshness([], 'a1')).toBeUndefined();
  });

  it('returns undefined when the account has positions but none are tracked (legacy)', () => {
    const positions = [pos('a1', 'VTI'), pos('a1', 'BND')];
    expect(accountFreshness(positions, 'a1')).toBeUndefined();
  });

  it('returns the max lastUpdatedAt among the account\'s positions', () => {
    const positions = [
      pos('a1', 'VTI', 1000),
      pos('a1', 'BND', 3000),
      pos('a1', 'VXUS', 2000),
    ];
    expect(accountFreshness(positions, 'a1')).toBe(3000);
  });

  it('ignores positions belonging to other accounts', () => {
    const positions = [pos('a1', 'VTI', 1000), pos('a2', 'BND', 9999)];
    expect(accountFreshness(positions, 'a1')).toBe(1000);
  });

  it('mixes tracked and untracked positions within the same account', () => {
    const positions = [pos('a1', 'VTI', 5000), pos('a1', 'BND')];
    expect(accountFreshness(positions, 'a1')).toBe(5000);
  });
});

// ─── formatRelativeUpdate ───────────────────────────────────────────────────

describe('formatRelativeUpdate', () => {
  const now = new Date(2026, 8, 7, 15, 0, 0).getTime(); // Sep 7, 2026, 3:00 PM local

  it('reads "Not tracked yet" when undefined', () => {
    expect(formatRelativeUpdate(now, undefined)).toBe('Not tracked yet');
  });

  it('reads "Updated just now" for a timestamp seconds old', () => {
    expect(formatRelativeUpdate(now, now - 10_000)).toBe('Updated just now');
  });

  it('reads "Updated today" for an older same-day timestamp', () => {
    const earlierToday = new Date(2026, 8, 7, 9, 0, 0).getTime(); // 9 AM same day
    expect(formatRelativeUpdate(now, earlierToday)).toBe('Updated today');
  });

  it('reads "Updated yesterday" for a timestamp on the previous calendar day', () => {
    const yesterday = new Date(2026, 8, 6, 15, 0, 0).getTime();
    expect(formatRelativeUpdate(now, yesterday)).toBe('Updated yesterday');
  });

  it('reads "Updated N days ago" for older timestamps', () => {
    const fiveDaysAgo = new Date(2026, 8, 2, 15, 0, 0).getTime();
    expect(formatRelativeUpdate(now, fiveDaysAgo)).toBe('Updated 5 days ago');
  });
});

// ─── isLagging ──────────────────────────────────────────────────────────────

describe('isLagging', () => {
  it('never flags when the account has no tracked positions at all', () => {
    expect(isLagging(undefined, undefined)).toBe(false);
  });

  it('flags an untracked position in an account that has tracked ones', () => {
    expect(isLagging(undefined, Date.now())).toBe(true);
  });

  it('does not flag the freshest position itself', () => {
    const t = Date.now();
    expect(isLagging(t, t)).toBe(false);
  });

  it('does not flag two edits made seconds apart in the same pass', () => {
    const freshest = Date.now();
    expect(isLagging(freshest - 5_000, freshest)).toBe(false);
  });

  it('does not flag a position within the tolerance window, same day', () => {
    // Anchor well inside a single day so the -1hr probe can't cross midnight.
    const freshest = new Date(2026, 8, 7, 15, 0, 0).getTime();
    expect(isLagging(freshest - HOUR, freshest)).toBe(false);
  });

  it('flags a position older than the tolerance window, same day', () => {
    const freshest = new Date(2026, 8, 7, 20, 0, 0).getTime(); // 8 PM
    const stale = freshest - (LAG_TOLERANCE_MS + HOUR); // > 4h earlier, still same calendar day
    expect(isLagging(stale, freshest)).toBe(true);
  });

  it('flags a position from an earlier calendar day even within the ms tolerance', () => {
    // 11:58 PM one day vs 12:02 AM the next — 4 minutes apart, but different days.
    const freshest = new Date(2026, 8, 7, 0, 2, 0).getTime();
    const lateNightBefore = new Date(2026, 8, 6, 23, 58, 0).getTime();
    expect(isLagging(lateNightBefore, freshest)).toBe(true);
  });

  it('flags nothing across a fresh CSV import where every row shares one stamp', () => {
    const stampedAt = Date.now();
    expect(isLagging(stampedAt, stampedAt)).toBe(false);
  });
});
