export type AssetClass =
  | 'US_TOTAL_MARKET'
  | 'US_LARGE_CAP'
  | 'US_MID_CAP'
  | 'US_SMALL_CAP'
  | 'DEVELOPED_INTL'
  | 'EMERGING_INTL'
  | 'FIXED_INCOME'
  | 'ALTERNATIVES'  // extension point: split into CRYPTO + PRECIOUS_METALS in a future version
  | 'CASH';

export type FundDecomposition = Partial<Record<AssetClass, number>>;

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
  'US_LARGE_CAP',
  'US_MID_CAP',
  'US_SMALL_CAP',
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
  // Explicit asset-class whitelist. Takes precedence over availableTickers when set.
  // Use when you know which classes an account permits without a full ticker list.
  allowedAssetClasses?: AssetClass[];
  // Classes to fill in this account before other eligible accounts within the same
  // bucket. Use to concentrate a low-liquidity class (e.g. ALTERNATIVES) in one
  // specific account. Gracefully spills to other eligible accounts if capacity is
  // exhausted.
  concentrateClasses?: AssetClass[];
  /** When true, the account is counted in all totals/weights but excluded from
   *  trade suggestions entirely (zero rebalancing capacity). */
  locked?: boolean;
  /** When false, this account will not receive a share of household free cash.
   *  Use when a contribution limit is reached (e.g. Roth IRA maxed for the year).
   *  Per-account newCash already in the account is still deployed normally. */
  acceptsDeposits?: boolean;
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

export interface ResolvedTrade extends Trade {
  // The specific fund to execute this trade against, when uniquely determinable
  // from the account's current holdings. Absent for greenfield buys (no existing
  // position covers the class) or when multiple positions are ambiguous.
  ticker?: string;
  // Set when a single blended fund (e.g. a US_TOTAL_MARKET ETF) covers several
  // engine-level asset-class trades. Lists each constituent trade so the UI can
  // explain what the merged amount represents.
  mergedFrom?: Array<{ assetClass: AssetClass; deltaUsd: number }>;
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
  | { kind: 'NO_ELIGIBLE_ACCOUNT'; assetClass: AssetClass; amountUsd: number }
  | { kind: 'EXCESS_CASH'; amountUsd: number }
  /** Emitted when an OOT class's post-trade projected weight still exceeds toleranceAbs
   *  from its target. Indicates a hard constraint (locked positions above target,
   *  no eligible account, or minTradeUsd too large) that the engine could not overcome. */
  | { kind: 'PROJECTED_OFF_TARGET'; assetClass: AssetClass; projectedWeight: number; targetWeight: number };
