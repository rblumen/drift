// Client-side persistence for the portfolio rebalancer.
//
// Two storage paths:
//   1. localStorage (auto-save) — persists across page reloads, same origin only.
//   2. JSON file export/import — portable backup; user controls the file.
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
const SCHEMA_VERSION = 1 as const;

// ─── Default state ────────────────────────────────────────────────────────────

export const DEFAULT_APP_STATE: AppState = {
  version:         SCHEMA_VERSION,
  accounts:        [],
  positions:       [],
  strategy:        DEFAULT_STRATEGY,
  tickerOverrides: {},
  decompositions:  {},
};

// ─── localStorage ─────────────────────────────────────────────────────────────

/** Persist the full app state. Silently no-ops if storage is unavailable. */
export function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // QuotaExceededError or SecurityError in private-browsing mode — ignore.
  }
}

/**
 * Load and validate persisted state.
 * Returns null if nothing is saved, the version doesn't match, or the data
 * fails schema validation — callers should fall back to DEFAULT_APP_STATE.
 */
export function loadState(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const result = appStateSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

/** Wipe the persisted state (used by "Reset / clear all"). */
export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── JSON file export ─────────────────────────────────────────────────────────

/**
 * Serialise state to a JSON file and trigger a browser download.
 * Filename includes today's date for easy archiving.
 */
export function exportJson(state: AppState): void {
  const filename = `portfolio-${new Date().toISOString().slice(0, 10)}.json`;
  const blob     = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url      = URL.createObjectURL(blob);
  const anchor   = document.createElement('a');
  anchor.href     = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

// ─── JSON file import ─────────────────────────────────────────────────────────

/**
 * Read a File object as text, parse and validate it.
 * Returns the parsed AppState on success, or a human-readable error string.
 */
export async function importJson(
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

/** Assemble an AppState object from the five individual state slices. */
export function buildState(
  accounts:        Account[],
  positions:       Position[],
  strategy:        Strategy,
  tickerOverrides: Record<string, AssetClass>,
  decompositions:  Record<string, FundDecomposition> = {},
): AppState {
  return { version: SCHEMA_VERSION, accounts, positions, strategy, tickerOverrides, decompositions };
}
