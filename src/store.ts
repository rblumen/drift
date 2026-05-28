// Client-side persistence for the portfolio rebalancer.
//
// Storage paths:
//   1. localStorage primary key  — written on every state change (immediate).
//   2. localStorage backup slots — 3 rolling snapshots, written every 5 minutes.
//      If the primary slot fails validation on load (e.g. after a schema change),
//      the most-recent valid backup is used automatically and the UI shows a banner.
//   3. JSON file save/load       — portable backup the user controls.
//
// The on-disk format is versioned (version: 1) so future schema migrations can
// detect and upgrade old saves rather than silently failing.
//
// Hard guardrail: this module never makes network calls. All data stays
// in the browser. The JSON file export writes only to the user's filesystem.

import type { Account, AssetClass, FundDecomposition, Position, Strategy } from './engine/types';
import { DEFAULT_STRATEGY } from './engine/strategy';
import { appStateSchema, type AppState } from './ingest/schema';

export type { AppState };

const STORAGE_KEY    = 'rebalancer-v1';
const BACKUP_KEY     = 'rebalancer-v1-backups';
const BACKUP_LIMIT   = 3;
const SCHEMA_VERSION = 1 as const;

// ─── Default state ────────────────────────────────────────────────────────────

export const DEFAULT_APP_STATE: AppState = {
  version:         SCHEMA_VERSION,
  accounts:        [],
  positions:       [],
  strategy:        DEFAULT_STRATEGY,
  tickerOverrides: {},
  decompositions:  {},
  freeCash:        0,
};

// ─── Internal backup helpers ──────────────────────────────────────────────────

interface BackupEntry { ts: number; state: unknown; }

function readRawBackups(): BackupEntry[] {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as BackupEntry[]) : [];
  } catch {
    return [];
  }
}

// ─── Primary autosave ─────────────────────────────────────────────────────────

/** Persist the full app state immediately. Silently no-ops if storage is unavailable. */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // QuotaExceededError or SecurityError in private-browsing mode — ignore.
  }
}

// ─── Rolling backup (call every ~5 minutes) ───────────────────────────────────

/**
 * Write a timestamped backup snapshot, keeping the most recent BACKUP_LIMIT entries.
 * Called periodically from the app rather than on every state change to avoid
 * writing 3× the data on each keystroke.
 */
export function saveBackup(state: AppState): void {
  try {
    const entries = readRawBackups();
    entries.unshift({ ts: Date.now(), state });
    if (entries.length > BACKUP_LIMIT) entries.length = BACKUP_LIMIT;
    localStorage.setItem(BACKUP_KEY, JSON.stringify(entries));
  } catch {
    // Ignore — primary save already succeeded.
  }
}

// ─── Load with automatic fallback ────────────────────────────────────────────

export interface LoadResult {
  state: AppState;
  /** 'primary' = loaded from the main slot. 'backup' = primary was missing or
   *  invalid; restored from a timestamped backup. */
  source: 'primary' | 'backup';
  /** Unix ms timestamp of the backup used (only set when source = 'backup'). */
  backupTs?: number;
}

/**
 * Load and validate persisted state, falling back to the most recent valid
 * backup if the primary slot is missing, corrupt, or fails schema validation.
 * Returns null if no valid state exists anywhere.
 */
export function loadState(): LoadResult | null {
  // 1. Try primary slot.
  let primaryParseError: string | undefined;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      const r = appStateSchema.safeParse(parsed);
      if (r.success) return { state: r.data, source: 'primary' };
      primaryParseError = r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      console.warn('[rebalancer] Primary state failed schema validation — falling back to backups.\n', primaryParseError);
    }
  } catch (e) {
    // JSON.parse failure — fall through to backups.
    console.warn('[rebalancer] Primary state is not valid JSON — falling back to backups.', e);
  }

  // 2. Primary missing or invalid — try backups from newest to oldest.
  const backups = readRawBackups();
  for (const entry of backups) {
    try {
      const r = appStateSchema.safeParse(entry.state);
      if (r.success) return { state: r.data, source: 'backup', backupTs: entry.ts };
      console.warn('[rebalancer] Backup entry (ts=%d) failed schema validation — skipping.', entry.ts,
        r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    } catch {
      // Skip this backup entry.
    }
  }

  if (primaryParseError !== undefined || backups.length > 0) {
    // There WAS data but nothing parsed — surface a clear console error so it
    // doesn't silently vanish.
    console.error('[rebalancer] All saved states failed validation. App will start with defaults. '
      + 'Check the warnings above for details.');
  }

  return null;
}

// ─── Clear all persisted data ─────────────────────────────────────────────────

/** Wipe both the primary slot and all backups (used by "Reset / clear all"). */
export function clearState(): void {
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  try { localStorage.removeItem(BACKUP_KEY);  } catch { /* ignore */ }
}

// ─── JSON file save ───────────────────────────────────────────────────────────

/**
 * Serialise state to a JSON file and trigger a browser download.
 * Filename includes today's date for easy archiving.
 */
export function saveJson(state: AppState): void {
  const filename = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
  const blob     = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const anchor   = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── JSON file load ───────────────────────────────────────────────────────────

/**
 * Read a File object as text, parse and validate it.
 * Returns the parsed AppState on success, or a human-readable error string.
 */
export async function loadJson(
  file: File,
): Promise<AppState | { error: string }> {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const raw = JSON.parse(e.target?.result as string) as unknown;
        const result = appStateSchema.safeParse(raw);
        if (result.success) {
          resolve(result.data);
        } else {
          resolve({ error: `Invalid portfolio file: ${result.error.issues[0]?.message ?? 'unknown error'}` });
        }
      } catch {
        resolve({ error: 'File is not valid JSON.' });
      }
    };
    reader.onerror = () => resolve({ error: 'Could not read the file.' });
    reader.readAsText(file);
  });
}

// ─── Convenience state builder ────────────────────────────────────────────────

/** Assemble an AppState object from the individual state slices. */
export function buildState(
  accounts:        Account[],
  positions:       Position[],
  strategy:        Strategy,
  tickerOverrides: Record<string, AssetClass>,
  decompositions:  Record<string, FundDecomposition> = {},
  freeCash:        number = 0,
): AppState {
  return { version: SCHEMA_VERSION, accounts, positions, strategy, tickerOverrides, decompositions, freeCash };
}
