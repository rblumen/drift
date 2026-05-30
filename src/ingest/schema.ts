import { z } from 'zod';
import type { Position, Account, Strategy } from '../engine/types';

const ACCOUNT_TYPES = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
] as const;

const PLACEMENT_BUCKETS = ['TAXABLE', 'TAX_ADVANTAGED', 'EDUCATION'] as const;

const ASSET_CLASSES = [
  'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'DEVELOPED_INTL', 'EMERGING_INTL',
  'FIXED_INCOME', 'ALTERNATIVES', 'CASH',
] as const;

export const positionSchema = z.object({
  accountId: z.string().min(1),
  ticker: z.string().min(1),
  description: z.string().optional(),
  marketValue: z.number().nonnegative(),
  price: z.number().positive().optional(),
  locked: z.boolean().optional(),
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
});

const targetsSchema = z.object({
  US_TOTAL_MARKET: z.number().min(0).max(1),
  US_LARGE_CAP:    z.number().min(0).max(1).optional().default(0),
  US_MID_CAP:      z.number().min(0).max(1).optional().default(0),
  US_SMALL_CAP:    z.number().min(0).max(1).optional().default(0),
  DEVELOPED_INTL:  z.number().min(0).max(1),
  EMERGING_INTL:   z.number().min(0).max(1),
  FIXED_INCOME:    z.number().min(0).max(1),
  ALTERNATIVES:    z.number().min(0).max(1),
  CASH:            z.number().min(0).max(1),
}).refine(
  t => {
    const sum = t.US_TOTAL_MARKET + (t.US_LARGE_CAP ?? 0) + (t.US_MID_CAP ?? 0) + (t.US_SMALL_CAP ?? 0)
              + t.DEVELOPED_INTL + t.EMERGING_INTL
              + t.FIXED_INCOME + t.ALTERNATIVES + t.CASH;
    return Math.abs(sum - 1.0) <= 0.001;
  },
  { message: 'Target weights must sum to 1.0 (±0.001)' },
);

// Default placement for any asset class missing from an old saved strategy.
const DEFAULT_PLACEMENT: Record<string, string[]> = {
  US_TOTAL_MARKET: ['TAX_ADVANTAGED', 'TAXABLE'],
  US_LARGE_CAP:    ['TAX_ADVANTAGED', 'TAXABLE'],
  US_MID_CAP:      ['TAX_ADVANTAGED', 'TAXABLE'],
  US_SMALL_CAP:    ['TAX_ADVANTAGED', 'TAXABLE'],
  DEVELOPED_INTL:  ['TAX_ADVANTAGED', 'TAXABLE'],
  EMERGING_INTL:   ['TAX_ADVANTAGED', 'TAXABLE'],
  FIXED_INCOME:    ['TAXABLE'],
  ALTERNATIVES:    ['TAX_ADVANTAGED'],
  CASH:            ['TAXABLE', 'TAX_ADVANTAGED'],
};

// Migration: upgrades old saves when new asset classes are added.
//   1. Targets: US_TOTAL_MARKET → cap sub-class split (Russell weights).
//      Condition: US_TOTAL_MARKET > 0.001 AND sub-classes sum to < 0.001.
//   2. Placement: any asset class missing from placement gets a default entry,
//      so StrategyPanel never sees an undefined bucket array.
const migrateStrategyTargets = (raw: unknown): unknown => {
  if (typeof raw !== 'object' || raw === null) return raw;
  let r = raw as Record<string, unknown>;

  // 1. Targets migration.
  const targets = r['targets'];
  if (typeof targets === 'object' && targets !== null) {
    const t = targets as Record<string, number>;
    const utm = t['US_TOTAL_MARKET'] ?? 0;
    const subSum = (t['US_LARGE_CAP'] ?? 0) + (t['US_MID_CAP'] ?? 0) + (t['US_SMALL_CAP'] ?? 0);
    if (utm > 0.001 && subSum < 0.001) {
      const lc = Math.round(utm * 0.67 * 1000) / 1000;
      const mc = Math.round(utm * 0.25 * 1000) / 1000;
      const sc = Math.round((utm - lc - mc) * 1000) / 1000;
      r = { ...r, targets: { ...t, US_TOTAL_MARKET: 0, US_LARGE_CAP: lc, US_MID_CAP: mc, US_SMALL_CAP: sc } };
    }
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
  placement: z.record(
    z.string(),
    z.array(z.enum(PLACEMENT_BUCKETS)).min(1),
  ),
  toleranceAbs: z.number().min(0).max(1),
  toleranceRel: z.number().min(0).max(1).optional(),
  minTradeUsd:  z.number().nonnegative(),
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

// Full persisted app state — used for localStorage and JSON file export/import.
export const appStateSchema = z.object({
  version:        z.literal(1),
  accounts:       z.array(accountSchema),
  positions:      z.array(positionSchema),
  strategy:       strategySchema,
  tickerOverrides: z.record(z.string(), z.enum(ASSET_CLASSES)),
  decompositions: decompositionsSchema.optional().default({}),
  freeCash:       z.number().nonnegative().optional().default(0),
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
