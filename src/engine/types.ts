export type AssetClass =
  | 'US_TOTAL_MARKET'
  | 'DEVELOPED_INTL'
  | 'EMERGING_INTL'
  | 'FIXED_INCOME'
  | 'ALTERNATIVES'  // extension point: split into CRYPTO + PRECIOUS_METALS in a future version
  | 'CASH';

export type AccountType =
  | 'TAXABLE'
  | 'TRADITIONAL_IRA'
  | 'ROTH_IRA'
  | 'FOUR_OH_ONE_K'
  | 'FIVE_TWENTY_NINE'
  | 'HSA'
  | 'OTHER';

// Placement buckets group account types by tax treatment.
export type PlacementBucket = 'TAXABLE' | 'TAX_ADVANTAGED' | 'EDUCATION';

export const ALL_ASSET_CLASSES: readonly AssetClass[] = [
  'US_TOTAL_MARKET',
  'DEVELOPED_INTL',
  'EMERGING_INTL',
  'FIXED_INCOME',
  'ALTERNATIVES',
  'CASH',
] as const;

export interface Account {
  id: string;
  name: string;
  institution: string;
  type: AccountType;
  newCash?: number;
  // If set, only tickers on this list (and their derived asset classes) can be
  // held in this account. Absent = unrestricted. Use for 401k-style fixed menus.
  availableTickers?: string[];
  /** When true, the account is counted in all totals/weights but excluded from
   *  trade suggestions entirely (zero rebalancing capacity). */
  locked?: boolean;
}

export interface Position {
  accountId: string;
  ticker: string;
  description?: string;
  marketValue: number;
  price?: number;
  /** When true, this holding counts in totals but is excluded from trades —
   *  only the unlocked portion of each (account, class) slot is rebalanced. */
  locked?: boolean;
}

export interface Strategy {
  targets: Record<AssetClass, number>;           // weights summing to 1.0
  placement: Record<AssetClass, PlacementBucket[]>; // preferred buckets, in order
  toleranceAbs: number;  // e.g. 0.05 → ignore drift within ±5 percentage points
  minTradeUsd: number;   // suppress dust trades below this dollar amount
}

export interface Trade {
  accountId: string;
  assetClass: AssetClass;
  deltaUsd: number;        // + = buy, − = sell
  inTaxableAccount: boolean;
}

export interface RebalanceResult {
  householdValue: number;
  currentWeights: Record<AssetClass, number>;
  targetWeights: Record<AssetClass, number>;
  projectedWeights: Record<AssetClass, number>;
  /** Per-account current value by asset class (before trades). Excludes unmapped positions. */
  currentValueByAccount: Record<string, Record<AssetClass, number>>;
  trades: Trade[];
  flags: Flag[];
}

export type Flag =
  | { kind: 'WITHIN_TOLERANCE'; assetClass: AssetClass }
  | { kind: 'TAXABLE_SALE'; accountId: string; assetClass: AssetClass; amountUsd: number }
  | { kind: 'UNMAPPED_HOLDING'; ticker: string }
  | { kind: 'PLACEMENT_SPILLOVER'; assetClass: AssetClass; bucket: PlacementBucket; amountUsd: number }
  | { kind: 'REVISIT_PLACEMENT'; taxableShare: number; fixedIncomeTarget: number }
  | { kind: 'NO_ELIGIBLE_ACCOUNT'; assetClass: AssetClass; amountUsd: number };
