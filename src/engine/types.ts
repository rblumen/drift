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
  /** Cap on the household free-cash share this account may receive, in dollars.
   *  undefined = unlimited (the default). 0 is functionally equivalent to closed.
   *  Ignored when acceptsDeposits === false. Does not constrain per-account newCash
   *  (a fact the user asserts) or internal rebalancing buys — only the Step 0
   *  free-cash distribution. A static "remaining capacity" figure the user maintains;
   *  there is no calendar/year awareness. */
  depositLimitUsd?: number;
  /** Withdrawal-side mirror of acceptsDeposits (issue #14). When false, the
   *  account is Restricted: no *additional* (discretionary) drawdown sells are
   *  routed here. When undefined the engine derives a default from the account
   *  type — taxable is eligible, tax-advantaged is restricted (early-withdrawal
   *  penalties). RMDs (rmdDueUsd) are still taken regardless of this flag. */
  acceptsWithdrawals?: boolean;
  /** Drain order for the additional (discretionary) drawdown — lower is drained
   *  first. Seeded from the account type (taxable → traditional → Roth) but
   *  user-editable to deviate. */
  withdrawalPriority?: number;
  /** Required Minimum Distribution due this year, entered manually (no age model).
   *  Taken first, before any additional drawdown, regardless of eligibility; added
   *  on top of the additional amount to form the total withdrawal. */
  rmdDueUsd?: number;
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
  /** Set when a field on this position was hand-edited after import. Display-only. */
  edited?: boolean;
}

export interface Strategy {
  targets: Record<AssetClass, number>;           // weights summing to 1.0
  // Preferred buckets, in order. An empty array means "no preference" — the class
  // has no required placement and the greedy fill assigns it wherever capacity is
  // largest, without emitting a PLACEMENT_SPILLOVER flag. A missing entry falls
  // back to the default two-bucket preference.
  placement: Record<AssetClass, PlacementBucket[]>;
  toleranceAbs: number;  // e.g. 0.05 → ignore drift within ±5 percentage points
  /** Relative band: a class drifts by this fraction of its own target weight
   *  (e.g. 0.25 ⇒ 25% of target). Effective per-class tolerance is
   *  min(toleranceAbs, toleranceRel × target[ac]) — the tighter of the two
   *  bands wins. Optional; defaults to 0.25 (the Bogleheads / Swedroe 5/25 rule). */
  toleranceRel?: number;
  minTradeUsd: number;   // suppress dust trades below this dollar amount
  /** When true (default), exhaust rebalancing inside tax-advantaged accounts before
   *  recommending any taxable-account sale. Set false to disable the redirect and
   *  surface TAXABLE_REBALANCE_AVOIDABLE flags showing the gains that could be saved. */
  preferTaxAdvantagedRebalance?: boolean;
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
  /** Per-account dollars withdrawn to fund a planned withdrawal / RMD (issue #14).
   *  This is the cash that leaves each account — RMD plus discretionary draw — which
   *  may be met by selling or from idle cash, so it is not the same as net sells.
   *  Empty when not in drawdown mode. */
  withdrawalByAccount: Record<string, number>;
  trades: Trade[];
  flags: Flag[];
  /** Contribution-first funding breakdown of the recommended trades.
   *  buysUsd = newCashDeployed + sellsUsd (sale proceeds are reinvested as buys). */
  contributionSummary: {
    /** New contributions deployed to underweight classes (buys not funded by sells). */
    newCashDeployed: number;
    /** Total dollars bought across all accounts. */
    buysUsd: number;
    /** Total dollars sold across all accounts. */
    sellsUsd: number;
    /** Cash raised by a net drawdown (sells in excess of buys). 0 unless a planned
     *  withdrawal or RMD is being funded (issue #14). Mirror of newCashDeployed. */
    withdrawalRaised: number;
  };
}

export type Flag =
  | { kind: 'WITHIN_TOLERANCE'; assetClass: AssetClass }
  | { kind: 'TAXABLE_SALE'; accountId: string; assetClass: AssetClass; amountUsd: number }
  | { kind: 'UNMAPPED_HOLDING'; ticker: string }
  | { kind: 'PLACEMENT_SPILLOVER'; assetClass: AssetClass; bucket: PlacementBucket; amountUsd: number }
  | { kind: 'REVISIT_PLACEMENT'; taxableShare: number; fixedIncomeTarget: number }
  | { kind: 'NO_ELIGIBLE_ACCOUNT'; assetClass: AssetClass; amountUsd: number }
  | { kind: 'EXCESS_CASH'; amountUsd: number }
  /** Emitted when tax-advantaged-first rebalancing is disabled and a taxable sale
   *  could have been reduced/avoided by redirecting it into a tax-advantaged account. */
  | { kind: 'TAXABLE_REBALANCE_AVOIDABLE'; accountId: string; assetClass: AssetClass; amountUsd: number }
  /** Emitted when an OOT class's post-trade projected weight still exceeds toleranceAbs
   *  from its target. Indicates a hard constraint (locked positions above target,
   *  no eligible account, or minTradeUsd too large) that the engine could not overcome. */
  | { kind: 'PROJECTED_OFF_TARGET'; assetClass: AssetClass; projectedWeight: number; targetWeight: number }
  /** Drawdown (#14): the additional withdrawal could not be fully funded — every
   *  withdrawal-eligible account is restricted, locked, or has hit its sellable
   *  capacity. amountUsd is the un-raisable remainder. */
  | { kind: 'WITHDRAWAL_SHORTFALL'; amountUsd: number };
