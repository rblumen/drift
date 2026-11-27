// src/sync/merge.ts — section-level three-way merge of a portfolio's AppState for
// cross-device / cross-member saves (spec-account-linking §5.4, households R6).
//
// Pure: no React, no Supabase, no network. The caller (remoteStore, M4) supplies:
//   base   — the revision this device last loaded or saved,
//   local  — this device's current state (base + unsaved local edits),
//   remote — the newer revision another device or member saved.
//
// A section that only one side changed merges automatically. A section both sides
// changed, to different values, is a conflict the user resolves by picking a side
// per section. Nothing is ever discarded silently.

import type { AppState } from '../ingest/schema';

/**
 * Merge sections. The spec's list (strategy, accounts, positions, tickerOverrides,
 * decompositions, linkedPositionOverrides, and the cash/withdrawal fields) plus the
 * remaining top-level AppState keys (reminder, people), so no edit can be lost.
 */
export const MERGE_SECTIONS = {
  strategy:                ['strategy'],
  accounts:                ['accounts'],
  positions:               ['positions'],
  tickerOverrides:         ['tickerOverrides'],
  decompositions:          ['decompositions'],
  linkedPositionOverrides: ['linkedPositionOverrides'],
  cash:                    ['freeCash', 'plannedWithdrawal'],
  reminder:                ['reminder'],
  people:                  ['people'],
} as const satisfies Record<string, readonly (keyof AppState)[]>;

export type MergeSection = keyof typeof MERGE_SECTIONS;
export type MergeSide = 'local' | 'remote';

const SECTION_NAMES = Object.keys(MERGE_SECTIONS) as MergeSection[];

export interface MergeResult {
  /**
   * The merged state. Sections only one side changed take that side; unchanged
   * sections and identical changes are kept. Conflicting sections hold the
   * **remote** value until resolved with `resolveConflicts`.
   */
  merged: AppState;
  /** Sections both sides changed to different values. Empty means the merge is clean. */
  conflicts: MergeSection[];
  /** Sections taken from local (local changed them, remote didn't). */
  fromLocal: MergeSection[];
  /** Sections taken from remote (remote changed them, local didn't). */
  fromRemote: MergeSection[];
}

/** Structural equality for JSON-like data. Object key order and `undefined`-valued keys are ignored. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => deepEqual(v, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) {
    if (!deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

function pick(state: AppState, section: MergeSection): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of MERGE_SECTIONS[section]) out[key] = state[key];
  return out;
}

function assign(target: AppState, source: AppState, section: MergeSection): AppState {
  return { ...target, ...pick(source, section) } as AppState;
}

/** Three-way merge of `local` and `remote` against their common `base`, by section. */
export function mergeAppState(base: AppState, local: AppState, remote: AppState): MergeResult {
  let merged: AppState = { ...remote };
  const conflicts: MergeSection[] = [];
  const fromLocal: MergeSection[] = [];
  const fromRemote: MergeSection[] = [];

  for (const section of SECTION_NAMES) {
    const b = pick(base, section);
    const l = pick(local, section);
    const r = pick(remote, section);
    const localChanged = !deepEqual(b, l);
    const remoteChanged = !deepEqual(b, r);

    if (localChanged && remoteChanged) {
      if (!deepEqual(l, r)) conflicts.push(section);
      // Same change on both sides (or a conflict awaiting a choice): remote stands.
    } else if (localChanged) {
      merged = assign(merged, local, section);
      fromLocal.push(section);
    } else if (remoteChanged) {
      fromRemote.push(section);
    }
  }

  return { merged, conflicts, fromLocal, fromRemote };
}

/**
 * Apply the user's per-section choice to a conflicted merge. Every conflict must
 * have a choice; a missing one throws rather than guessing.
 */
export function resolveConflicts(
  result: MergeResult,
  local: AppState,
  remote: AppState,
  choices: Partial<Record<MergeSection, MergeSide>>,
): AppState {
  let merged = result.merged;
  for (const section of result.conflicts) {
    const side = choices[section];
    if (side === undefined) throw new Error(`No choice given for conflicting section "${section}"`);
    merged = assign(merged, side === 'local' ? local : remote, section);
  }
  return merged;
}
