import { z } from 'zod';
import type { Position, Account, Strategy } from '../engine/types';

const ACCOUNT_TYPES = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
] as const;

const PLACEMENT_BUCKETS = ['TAXABLE', 'TAX_ADVANTAGED', 'EDUCATION'] as const;

const ASSET_CLASSES = [
  'US_TOTAL_MARKET', 'DEVELOPED_INTL', 'EMERGING_INTL',
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
  locked: z.boolean().optional(),
});

const targetsSchema = z.object({
  US_TOTAL_MARKET: z.number().min(0).max(1),
  DEVELOPED_INTL:  z.number().min(0).max(1),
  EMERGING_INTL:   z.number().min(0).max(1),
  FIXED_INCOME:    z.number().min(0).max(1),
  ALTERNATIVES:    z.number().min(0).max(1),
  CASH:            z.number().min(0).max(1),
}).refine(
  t => {
    const sum = t.US_TOTAL_MARKET + t.DEVELOPED_INTL + t.EMERGING_INTL
              + t.FIXED_INCOME + t.ALTERNATIVES + t.CASH;
    return Math.abs(sum - 1.0) <= 0.001;
  },
  { message: 'Target weights must sum to 1.0 (±0.001)' },
);

export const strategySchema = z.object({
  targets: targetsSchema,
  placement: z.record(
    z.enum(ASSET_CLASSES),
    z.array(z.enum(PLACEMENT_BUCKETS)).min(1),
  ),
  toleranceAbs: z.number().min(0).max(1),
  minTradeUsd:  z.number().nonnegative(),
});

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

// Full persisted app state — used for localStorage and JSON file export/import.
export const appStateSchema = z.object({
  version:        z.literal(1),
  accounts:       z.array(accountSchema),
  positions:      z.array(positionSchema),
  strategy:       strategySchema,
  tickerOverrides: z.record(z.string(), z.enum(ASSET_CLASSES)),
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
