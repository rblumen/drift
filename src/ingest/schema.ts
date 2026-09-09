import { z } from 'zod';
import type { AssetClass, Position, Account, Strategy } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { CLASS_HIERARCHY } from '../engine/hierarchy';
import { DEFAULT_PLACEMENT as ENGINE_DEFAULT_PLACEMENT } from '../engine/strategy';

const ACCOUNT_TYPES = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
] as const;

// Placement targets a strategy may express (issue #89). Beyond the three coarse
// tax-treatment buckets, a preference may name an intermediate bucket (TAX_DEFERRED /
// TAX_FREE) or a specific account type. Mirrors the PlacementTarget union in engine/types.
const PLACEMENT_TARGETS = [
  'TAXABLE', 'TAX_ADVANTAGED', 'EDUCATION', 'TAX_DEFERRED', 'TAX_FREE',
  'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K', 'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
] as const;

// Derived from the engine's ALL_ASSET_CLASSES source of truth (issue #127) so the
// z.enum member list never drifts from the AssetClass union. The cast supplies the
// non-empty tuple shape z.enum requires; the array is `as const` at its definition.
const ASSET_CLASSES = ALL_ASSET_CLASSES as unknown as [AssetClass, ...AssetClass[]];

// Classes whose target weight is required in a strategy (no default). Every other
// class defaults to 0 when omitted. This preserves the exact per-field constraints the
// hand-written targetsSchema encoded before #127 (US_TOTAL_MARKET, DEVELOPED_INTL,
// EMERGING_INTL, FIXED_INCOME, ALTERNATIVES, CASH were required; the rest .default(0)).
const REQUIRED_TARGET_CLASSES = new Set<AssetClass>([
  'US_TOTAL_MARKET', 'DEVELOPED_INTL', 'EMERGING_INTL', 'FIXED_INCOME', 'ALTERNATIVES', 'CASH',
]);

export const positionSchema = z.object({
  accountId: z.string().min(1),
  ticker: z.string().min(1),
  description: z.string().optional(),
  marketValue: z.number().nonnegative(),
  price: z.number().positive().optional(),
  locked: z.boolean().optional(),
  edited: z.boolean().optional(),
  // Aggregate cost basis, in dollars. Only meaningful for positions in TAXABLE
  // accounts (see Position docstring in engine/types.ts).
  costBasis: z.number().nonnegative().optional(),
  // Epoch ms when this position was last created/confirmed by an import or hand-edited
  // (issue #212). Optional — absent on legacy saves; no migration backfill needed.
  lastUpdatedAt: z.number().optional(),
});

export const accountSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  institution: z.string().min(1),
  type: z.enum(ACCOUNT_TYPES),
  newCash: z.number().nonnegative().optional(),
  availableTickers: z.array(z.string().min(1)).optional(),
  allowedAssetClasses: z.array(z.enum(ASSET_CLASSES)).optional(),
  concentrateClasses: z.array(z.enum(ASSET_CLASSES)).optional(),
  locked: z.boolean().optional(),
  acceptsDeposits: z.boolean().optional(),
  depositLimitUsd: z.number().nonnegative().optional(),
  acceptsWithdrawals: z.boolean().optional(),
  withdrawalPriority: z.number().nonnegative().optional(),
  rmdDueUsd: z.number().nonnegative().optional(),
});

// Per-class target-weight schema, derived from ALL_ASSET_CLASSES (issue #127). Each
// class is a 0..1 weight; the six REQUIRED_TARGET_CLASSES must be present, every other
// class defaults to 0 when omitted — exactly the constraints the hand-written object
// encoded before #127. The generic sum-refine (±0.001) below replaces the fully
// spelled-out sum expression while preserving its tolerance precisely.
//
// The `as` cast restores the precise per-key shape that Object.fromEntries erases: the
// output type is Record<AssetClass, number> (defaults fill every optional key), so the
// inferred strategy still flows soundly into the engine's Strategy.targets (issue #113).
const targetShape = Object.fromEntries(
  ALL_ASSET_CLASSES.map(ac => {
    const base = z.number().min(0).max(1);
    return [ac, REQUIRED_TARGET_CLASSES.has(ac) ? base : base.optional().default(0)];
  }),
) as unknown as Record<AssetClass, z.ZodType<number, z.ZodTypeDef, number | undefined>>;

const targetsSchema = z.object(targetShape).refine(
  t => {
    const sum = ALL_ASSET_CLASSES.reduce((s, ac) => s + ((t as Record<AssetClass, number>)[ac] ?? 0), 0);
    return Math.abs(sum - 1.0) <= 0.001;
  },
  { message: 'Target weights must sum to 1.0 (±0.001)' },
);

// Default placement for any asset class missing from an old saved strategy (issue #89
// asset-location defaults). Single-sourced from the engine's DEFAULT_PLACEMENT (issues
// #119, #127) so the migration backfill and DEFAULT_STRATEGY.placement can never drift
// apart. These are *starting points* — the migration in migrateStrategyTargets only
// backfills classes a saved strategy never specified, so adopting these never overwrites
// an existing/imported selection (see that function).
const DEFAULT_PLACEMENT: Record<string, string[]> = ENGINE_DEFAULT_PLACEMENT;

// Migration: upgrades old saves when new asset classes are added.
//   1. Targets: for each parent class in CLASS_HIERARCHY, if the parent has a
//      non-trivial target (> 0.001) and all children sum to < 0.001, split the
//      parent target into children using defaultWeights.
//      Condition guards against re-splitting saves that already have child targets.
//   2. Placement: any asset class missing from placement gets a default entry,
//      so StrategyPanel never sees an undefined bucket array.
const migrateStrategyTargets = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw;
  let r = raw as Record<string, unknown>;

  // 1. Targets migration — generic over all parent classes.
  //    Only *synthetic* parents (migrateSplit: true, e.g. US_TOTAL_MARKET) auto-split
  //    a parent-level target into children on load. Parents that are legitimately held
  //    at the parent level (FIXED_INCOME, DEVELOPED_INTL, ALTERNATIVES) are preserved
  //    as-is; their children surface only via the visibility rule or an explicit split
  //    in the Strategy panel, so simple portfolios aren't force-subdivided on upgrade.
  const targets = r['targets'];
  if (typeof targets === 'object' && targets !== null) {
    let t = targets as Record<string, number>;
    for (const [parent, group] of Object.entries(CLASS_HIERARCHY)) {
      if (!group!.migrateSplit) continue;
      const parentVal = t[parent] ?? 0;
      const childSum = group!.children.reduce((s, c) => s + (t[c] ?? 0), 0);
      if (parentVal > 0.001 && childSum < 0.001) {
        const { children, defaultWeights } = group!;
        const splits: Record<string, number> = {};
        let allocated = 0;
        for (let i = 0; i < children.length - 1; i++) {
          const w = defaultWeights[children[i]] ?? 0;
          splits[children[i]] = Math.round(parentVal * w * 1000) / 1000;
          allocated += splits[children[i]];
        }
        // Last child absorbs rounding remainder so total stays exact.
        splits[children[children.length - 1]] = Math.round((parentVal - allocated) * 1000) / 1000;
        t = { ...t, [parent]: 0, ...splits };
      }
    }
    r = { ...r, targets: t };
  }

  // 2. Placement migration: fill in defaults for any missing asset class.
  const placement = r['placement'];
  if (typeof placement === 'object' && placement !== null) {
    r = { ...r, placement: { ...DEFAULT_PLACEMENT, ...(placement as Record<string, unknown>) } };
  }

  return r;
};

export const strategySchema = z.preprocess(migrateStrategyTargets, z.object({
  targets: targetsSchema,
  // An empty bucket array means "no preference" — the engine places the class
  // wherever capacity is largest. A missing entry is backfilled by the migration.
  // A placement target is a tier/bucket/account-type enum value, or an `account:<id>`
  // leaf naming a specific account (issue #89 Phase 2).
  placement: z.record(
    z.string(),
    z.array(z.union([z.enum(PLACEMENT_TARGETS), z.string().startsWith('account:')])),
  ),
  toleranceAbs: z.number().min(0).max(1),
  toleranceRel: z.number().min(0).max(1).optional(),
  // Target band as a fraction of the trigger tolerance (issue #42). (0, 1]; the
  // engine defaults a missing value to 0.5. 0 is excluded — it would demand exact
  // targets, defeating trade-count minimization.
  rebalanceTargetFraction: z.number().gt(0).max(1).optional(),
  minTradeUsd:  z.number().nonnegative(),
  preferTaxAdvantagedRebalance: z.boolean().optional(),
  // Composite buys of held blended funds (issue #49). Optional; the engine
  // defaults a missing value to true.
  preferCompositeBuys: z.boolean().optional(),
  taxAdjustment: z.object({
    enabled: z.boolean(),
    effectiveRateAtRetirement: z.number().min(0).max(1),
    marginalRateLTCG:          z.number().min(0).max(1),
  }).optional(),
}));

export const portfolioSchema = z.object({
  accounts:  z.array(accountSchema),
  positions: z.array(positionSchema),
});

// Convenience parse functions — throw ZodError on invalid input.
export function parsePosition(raw: unknown): Position {
  return positionSchema.parse(raw) as Position;
}
export function parseAccount(raw: unknown): Account {
  return accountSchema.parse(raw) as Account;
}
export function parseStrategy(raw: unknown): Strategy {
  return strategySchema.parse(raw) as Strategy;
}
export function parsePortfolio(raw: unknown): { accounts: Account[]; positions: Position[] } {
  const r = portfolioSchema.parse(raw);
  return { accounts: r.accounts as Account[], positions: r.positions as Position[] };
}

// A single fund's asset-class breakdown: { US_LARGE_CAP: 0.54, FIXED_INCOME: 0.09, … }
export const fundDecompositionSchema = z.record(
  z.enum(ASSET_CLASSES),
  z.number().min(0).max(1),
);

// The full decompositions map stored in AppState: ticker → FundDecomposition
export const decompositionsSchema = z.record(z.string(), fundDecompositionSchema);

// Next-rebalance reminder. All fields optional so old saves remain valid.
//   - nextDueAt: unix ms — the date the user picked for their next rebalance.
//   - intervalMonths: when present, "Mark as rebalanced" advances nextDueAt by
//     this many months from today. Absent = one-shot reminder.
//   - lastRebalancedAt: unix ms when the user last clicked "Mark as rebalanced".
export const reminderSchema = z.object({
  nextDueAt:        z.number().int().positive().optional(),
  intervalMonths:   z.number().int().min(1).max(120).optional(),
  lastRebalancedAt: z.number().int().positive().optional(),
});

export type Reminder = z.infer<typeof reminderSchema>;

// Full persisted app state — used for localStorage and JSON file export/import.
export const appStateSchema = z.object({
  version:        z.literal(1),
  accounts:       z.array(accountSchema),
  positions:      z.array(positionSchema),
  strategy:       strategySchema,
  tickerOverrides: z.record(z.string(), z.enum(ASSET_CLASSES)),
  decompositions: decompositionsSchema.optional().default({}),
  freeCash:       z.number().nonnegative().optional().default(0),
  plannedWithdrawal: z.number().nonnegative().optional().default(0),
  reminder:       reminderSchema.optional().default({}),
});

// The persisted shape, with `strategy` expressed as the engine's Strategy type.
// The Zod-inferred strategy is structurally looser (placement is a plain string
// record), but the migration in strategySchema backfills every asset class from
// DEFAULT_PLACEMENT and targetsSchema defaults every weight, so a parsed object
// always satisfies the engine type at runtime. The cast in parseAppState (and
// the safeParse call sites in store.ts) is where that guarantee is asserted.
export type AppState = Omit<z.infer<typeof appStateSchema>, 'strategy'> & { strategy: Strategy };

export function parseAppState(raw: unknown): AppState {
  return appStateSchema.parse(raw) as AppState;
}

// Safe variants — return { ok, data } | { ok, error } without throwing.
export function safeParsePosition(raw: unknown):
  | { ok: true; data: Position }
  | { ok: false; error: string } {
  const r = positionSchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data as Position } : { ok: false, error: r.error.message };
}
export function safeParseStrategy(raw: unknown):
  | { ok: true; data: Strategy }
  | { ok: false; error: string } {
  const r = strategySchema.safeParse(raw);
  return r.success ? { ok: true, data: r.data as Strategy } : { ok: false, error: r.error.message };
}
