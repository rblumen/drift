// Scenario fixture schema (issue #33).
//
// A scenario is a self-contained spec: "given this realistic portfolio +
// strategy, the engine should produce these trades and flags." Fixtures live in
// `*.scenario.json` files under principle-numbered subfolders and are validated
// against this schema before the engine runs (see scenarios.test.ts).
//
// This module is *test infrastructure*. It reuses the canonical engine-input
// schemas from src/ingest/schema.ts — the same precedent as
// engine/phase2-hierarchy.test.ts, which already imports parseStrategy. The
// engine's runtime code never imports this file or ingest.

import { z } from 'zod';
import { accountSchema, positionSchema, strategySchema } from '../../ingest/schema';
import { ALL_ASSET_CLASSES } from '../types';
import type { AssetClass } from '../types';

const ASSET_CLASS = z.enum(ALL_ASSET_CLASSES as unknown as [AssetClass, ...AssetClass[]]);

// A single expected trade. accountId + assetClass + deltaUsd are required and
// compared exactly (deltaUsd within rounding tolerance). inTaxableAccount is
// optional; when present it is also asserted.
const expectedTradeSchema = z
  .object({
    accountId: z.string().min(1),
    assetClass: ASSET_CLASS,
    deltaUsd: z.number(),
    inTaxableAccount: z.boolean().optional(),
  })
  .strict();

// An expected flag. `kind` is required; any flag-specific fields (assetClass,
// amountUsd, taxableShare, …) are matched when present. Extra scalar fields are
// allowed so each flag kind can carry its own shape, but values are type-checked.
const expectedFlagSchema = z
  .object({ kind: z.string().min(1) })
  .catchall(z.union([z.string(), z.number(), z.boolean()]));

// The `expected` block. Every field is optional; an assertion only runs for a
// field that is present. `.strict()` rejects typo'd assertion keys.
const expectedSchema = z
  .object({
    // Exhaustive: the engine must emit exactly these trades (order-independent).
    trades: z.array(expectedTradeSchema).optional(),
    // Presence (subset): each listed trade must appear (deltaUsd within
    // tolerance). Use to pin a specific trade in a large set without
    // enumerating all of them — the complement of forbiddenTrades.
    requiredTrades: z.array(expectedTradeSchema).optional(),
    // Presence (subset): each listed flag must appear in the result. Other flags
    // the engine emits (e.g. WITHIN_TOLERANCE) are not asserted against.
    flags: z.array(expectedFlagSchema).optional(),
    // Absence: none of these flags may appear — e.g. asserting a class is NOT
    // within tolerance (the 5/25 relative band fired) or that no
    // PLACEMENT_SPILLOVER was raised for a no-preference class.
    absentFlags: z.array(expectedFlagSchema).optional(),
    // Partial: only the listed asset classes are checked against
    // result.projectedWeights (post-trade household weights, as fractions).
    projectedWeights: z.record(ASSET_CLASS, z.number()).optional(),
    // Partial: only the listed asset classes are checked against
    // result.currentWeights (pre-trade household weights, as fractions). Mirror of
    // projectedWeights. Idle/free cash surfaces under CASH here (issue #83), so the
    // weights sum to ~1.0 rather than hiding uninvested cash.
    currentWeights: z.record(ASSET_CLASS, z.number()).optional(),
    // Per-account holdings-lens breakdown BEFORE trades (result.nativeValueByAccount),
    // in dollars. Each listed account checks only its listed classes; an account's
    // idle/free cash (newCash + its share of distributed freeCash) appears under
    // CASH alongside cash-classified holdings (issue #83). Use to assert what a
    // per-account "Before" pie shows.
    nativeByAccount: z.record(z.string(), z.record(ASSET_CLASS, z.number())).optional(),
    // Per-account holdings-lens breakdown AFTER trades
    // (result.projectedNativeValueByAccount), in dollars. Same partial semantics as
    // nativeByAccount; use to assert deployment (e.g. free cash consumed from CASH)
    // and that "Before"/"After" reconcile.
    projectedNativeByAccount: z.record(z.string(), z.record(ASSET_CLASS, z.number())).optional(),
    // Per-account total balance in dollars — the sum of the holdings-lens breakdown
    // (positions + idle/free cash), matching the account's investable value. Only
    // the listed accounts are checked.
    accountValueByAccount: z.record(z.string(), z.number()).optional(),
    // Whether every class's post-trade weight sits within its effective
    // tolerance band min(toleranceAbs, toleranceRel × target).
    projectedDriftWithinTolerance: z.boolean().optional(),
    // Per-account net trade delta (sum of deltaUsd). The balance-preserving
    // invariant (Goal 3): 0 for a pure rebalance, an account's contribution for
    // a deployment. Only the listed accounts are checked.
    netByAccount: z.record(z.string(), z.number()).optional(),
    // Count of actionable (non-zero) trades per account. Use to assert a locked
    // account is untouched ({ "ira": 0 }) or that trades concentrate in one
    // account (Goal 1, Goal 11). Only the listed accounts are checked.
    tradeCountByAccount: z.record(z.string(), z.number()).optional(),
    // Account/class pairs that must NOT receive an actionable trade — e.g. a
    // class excluded from an account by allowedAssetClasses or availableTickers
    // (Goal 2), or a class barred from a bucket (Goal 6/9).
    forbiddenTrades: z
      .array(z.object({ accountId: z.string(), assetClass: ASSET_CLASS }).strict())
      .optional(),
  })
  .strict();

export const scenarioSchema = z
  .object({
    // Short identifier (kebab/title-case). Used as a fallback test title.
    name: z.string().min(1),
    // A full sentence describing the behavior under verification. Shown as the
    // test name in the HTML report and printed on failure.
    description: z.string().min(1),
    // The PRINCIPLES.md goal number(s) this scenario verifies. A single number,
    // a list, or a free-text label for non-goal supporting concerns.
    principle: z.union([
      z.number(),
      z.array(z.number()),
      z.string(),
      z.array(z.string()),
    ]),

    // ── Engine inputs ──────────────────────────────────────────────────────
    accounts: z.array(accountSchema),
    holdings: z.array(positionSchema),
    strategy: strategySchema,
    // Optional inputs, defaulted by the engine when omitted.
    tickerOverrides: z.record(z.string(), ASSET_CLASS).optional(),
    decompositions: z.record(z.string(), z.record(ASSET_CLASS, z.number())).optional(),
    freeCash: z.number().nonnegative().optional(),
    plannedWithdrawal: z.number().nonnegative().optional(),

    expected: expectedSchema,
  })
  .strict();

export type Scenario = z.infer<typeof scenarioSchema>;
export type ExpectedTrade = z.infer<typeof expectedTradeSchema>;
export type ExpectedFlag = z.infer<typeof expectedFlagSchema>;
