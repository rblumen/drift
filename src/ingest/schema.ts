import { z } from 'zod';
import type { Position, Account, Strategy } from '../engine/types';
import { CLASS_HIERARCHY } from '../engine/hierarchy';

const ACCOUNT_TYPES = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
] as const;

const PLACEMENT_BUCKETS = ['TAXABLE', 'TAX_ADVANTAGED', 'EDUCATION'] as const;

const ASSET_CLASSES = [
  'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'DEVELOPED_INTL', 'DEVELOPED_EUROPE', 'DEVELOPED_PACIFIC', 'EMERGING_INTL',
  'FIXED_INCOME', 'US_TREASURY', 'US_CORP_BOND', 'MUNI_BOND', 'TIPS', 'INTL_BOND',
  'REAL_ESTATE', 'ALTERNATIVES', 'CRYPTO', 'PRECIOUS_METALS', 'CASH',
] as const;

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

const targetsSchema = z.object({
  US_TOTAL_MARKET:  z.number().min(0).max(1),
  US_LARGE_CAP:     z.number().min(0).max(1).optional().default(0),
  US_MID_CAP:       z.number().min(0).max(1).optional().default(0),
  US_SMALL_CAP:     z.number().min(0).max(1).optional().default(0),
  DEVELOPED_INTL:   z.number().min(0).max(1),
  DEVELOPED_EUROPE: z.number().min(0).max(1).optional().default(0),
  DEVELOPED_PACIFIC: z.number().min(0).max(1).optional().default(0),
  EMERGING_INTL:    z.number().min(0).max(1),
  FIXED_INCOME:     z.number().min(0).max(1),
  US_TREASURY:      z.number().min(0).max(1).optional().default(0),
  US_CORP_BOND:     z.number().min(0).max(1).optional().default(0),
  MUNI_BOND:        z.number().min(0).max(1).optional().default(0),
  TIPS:             z.number().min(0).max(1).optional().default(0),
  INTL_BOND:        z.number().min(0).max(1).optional().default(0),
  REAL_ESTATE:      z.number().min(0).max(1).optional().default(0),
  ALTERNATIVES:     z.number().min(0).max(1),
  CRYPTO:           z.number().min(0).max(1).optional().default(0),
  PRECIOUS_METALS:  z.number().min(0).max(1).optional().default(0),
  CASH:             z.number().min(0).max(1),
}).refine(
  t => {
    const sum = t.US_TOTAL_MARKET + (t.US_LARGE_CAP ?? 0) + (t.US_MID_CAP ?? 0) + (t.US_SMALL_CAP ?? 0)
              + t.DEVELOPED_INTL + (t.DEVELOPED_EUROPE ?? 0) + (t.DEVELOPED_PACIFIC ?? 0) + t.EMERGING_INTL
              + t.FIXED_INCOME + (t.US_TREASURY ?? 0) + (t.US_CORP_BOND ?? 0) + (t.MUNI_BOND ?? 0)
              + (t.TIPS ?? 0) + (t.INTL_BOND ?? 0)
              + (t.REAL_ESTATE ?? 0)
              + t.ALTERNATIVES + (t.CRYPTO ?? 0) + (t.PRECIOUS_METALS ?? 0) + t.CASH;
    return Math.abs(sum - 1.0) <= 0.001;
  },
  { message: 'Target weights must sum to 1.0 (±0.001)' },
);

// Default placement for any asset class missing from an old saved strategy.
const DEFAULT_PLACEMENT: Record<string, string[]> = {
  US_TOTAL_MARKET:  ['TAX_ADVANTAGED', 'TAXABLE'],
  US_LARGE_CAP:     ['TAX_ADVANTAGED', 'TAXABLE'],
  US_MID_CAP:       ['TAX_ADVANTAGED', 'TAXABLE'],
  US_SMALL_CAP:     ['TAX_ADVANTAGED', 'TAXABLE'],
  DEVELOPED_INTL:   ['TAX_ADVANTAGED', 'TAXABLE'],
  DEVELOPED_EUROPE: ['TAX_ADVANTAGED', 'TAXABLE'],
  DEVELOPED_PACIFIC: ['TAX_ADVANTAGED', 'TAXABLE'],
  EMERGING_INTL:    ['TAX_ADVANTAGED', 'TAXABLE'],
  // FIXED_INCOME parent → taxable (muni intent). Subdivided: munis stay taxable;
  // taxable-coupon sleeves (treasury/corp/tips/intl) shelter in tax-advantaged.
  FIXED_INCOME:     ['TAXABLE'],
  US_TREASURY:      ['TAX_ADVANTAGED', 'TAXABLE'],
  US_CORP_BOND:     ['TAX_ADVANTAGED'],
  MUNI_BOND:        ['TAXABLE'],
  TIPS:             ['TAX_ADVANTAGED'],
  INTL_BOND:        ['TAX_ADVANTAGED'],
  // REITs — non-qualified dividends → shelter.
  REAL_ESTATE:      ['TAX_ADVANTAGED'],
  ALTERNATIVES:     ['TAX_ADVANTAGED'],
  CRYPTO:           ['TAX_ADVANTAGED'],
  PRECIOUS_METALS:  ['TAX_ADVANTAGED'],
  CASH:             ['TAXABLE', 'TAX_ADVANTAGED'],
};

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
  placement: z.record(
    z.string(),
    z.array(z.enum(PLACEMENT_BUCKETS)),
  ),
  toleranceAbs: z.number().min(0).max(1),
  toleranceRel: z.number().min(0).max(1).optional(),
  // Target band as a fraction of the trigger tolerance (issue #42). (0, 1]; the
  // engine defaults a missing value to 0.5. 0 is excluded — it would demand exact
  // targets, defeating trade-count minimization.
  rebalanceTargetFraction: z.number().gt(0).max(1).optional(),
  minTradeUsd:  z.number().nonnegative(),
  preferTaxAdvantagedRebalance: z.boolean().optional(),
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

export type AppState = z.infer<typeof appStateSchema>;

export function parseAppState(raw: unknown): AppState {
  return appStateSchema.parse(raw);
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
