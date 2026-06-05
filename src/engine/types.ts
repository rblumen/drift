export type AssetClass =
  | 'US_TOTAL_MARKET'
  | 'US_LARGE_CAP'
  | 'US_MID_CAP'
  | 'US_SMALL_CAP'
  | 'DEVELOPED_INTL'
  | 'DEVELOPED_EUROPE'
  | 'DEVELOPED_PACIFIC'
  | 'EMERGING_INTL'
  | 'FIXED_INCOME'
  | 'US_TREASURY'
  | 'US_CORP_BOND'
  | 'MUNI_BOND'
  | 'TIPS'
  | 'INTL_BOND'
  | 'REAL_ESTATE'
  | 'ALTERNATIVES'
  | 'CRYPTO'
  | 'PRECIOUS_METALS'
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
  'DEVELOPED_EUROPE',
  'DEVELOPED_PACIFIC',
  'EMERGING_INTL',
  'FIXED_INCOME',
  'US_TREASURY',
  'US_CORP_BOND',
  'MUNI_BOND',
  'TIPS',
  'INTL_BOND',
  'REAL_ESTATE',
  'ALTERNATIVES',
  'CRYPTO',
  'PRECIOUS_METALS',
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
  /** Aggregate cost basis for this holding, in dollars. Only meaningful for
   *  positions in TAXABLE accounts; ignored elsewhere. Used by the tax-adjusted
   *  allocation feature (issue #7) to value the position at
   *  `marketValue − marginalRateLTCG × max(0, marketValue − costBasis)`.
   *  When undefined for a taxable position with tax adjustment enabled, the
   *  engine falls back to `B = V` (no haircut, conservative) and emits
   *  MISSING_COST_BASIS so the user can fill it in. */
  costBasis?: number;
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
  /** Target band as a fraction of the trigger tolerance (issue #42). The trigger
   *  band (toleranceAbs / toleranceRel) decides *whether* a class has drifted far
   *  enough to rebalance; this fraction decides *how close to ideal* the engine
   *  lands once it does. The trade-count-minimization pass (step 8.6) may only drop
   *  a corrective trade if the class still sits within `targetTolerance` =
   *  fraction × effectiveTolerance — a tighter band than the trigger — so rebalances
   *  leave drift headroom instead of parking classes at the trigger edge (where the
   *  next tiny move re-triggers). Range (0, 1]; 1.0 reproduces the pre-#42 behavior
   *  (target band = trigger band). Optional; defaults to 0.5 (half the threshold). */
  rebalanceTargetFraction?: number;
  minTradeUsd: number;   // suppress dust trades below this dollar amount
  /** When true (default), exhaust rebalancing inside tax-advantaged accounts before
   *  recommending any taxable-account sale. Set false to disable the redirect and
   *  surface TAXABLE_REBALANCE_AVOIDABLE flags showing the gains that could be saved. */
  preferTaxAdvantagedRebalance?: boolean;
  /** Tax-adjusted allocation mode (issue #7). When enabled, account balances are
   *  scaled to their after-tax values before drift detection and target sizing,
   *  so a "60/40" allocation refers to 60/40 of *after-tax* wealth rather than
   *  nominal market value. Trades are emitted in nominal dollars (what the user
   *  actually transacts), but their sizing reflects the tax-adjusted targets.
   *  Per-account-type treatment:
   *    Roth / HSA / 529:  100% of face value (assumes qualified withdrawals).
   *    Traditional / 401k: V × (1 − effectiveRateAtRetirement).
   *    Taxable: V − marginalRateLTCG × max(0, V − costBasis), per position.
   *  See PRINCIPLES.md and engine/taxAdjust.ts. */
  taxAdjustment?: {
    enabled: boolean;
    /** Expected effective tax rate in retirement (not today's marginal), used to
     *  haircut Traditional / 401k balances. Typically lower than working-age
     *  marginal because the full balance is drawn across multiple brackets. */
    effectiveRateAtRetirement: number;
    /** Long-term capital gains rate applied to unrealized gains in taxable
     *  accounts. Federal LTCG only — state tax and NIIT are out of scope (v1). */
    marginalRateLTCG: number;
  };
}

export interface Trade {
  accountId: string;
  assetClass: AssetClass;
  deltaUsd: number;        // + = buy, − = sell
  inTaxableAccount: boolean;
  /** Blended-fund routing hint (issue #40). When set, the resolver routes this
   *  trade to the named ticker unconditionally. Used by Step 8.7 to bind sub-class
   *  sells to the specific blended fund being proportionally liquidated. */
  forceTicker?: string;
  /** Tickers the resolver must NOT consider for this trade. Set by Step 8.7 on
   *  compensating buys so the buy-back of an over-sold sub-class can't get routed
   *  back to the blended fund the engine just told the user to sell. */
  excludeTickers?: string[];
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
  /** Tax-adjusted parallel view (issue #7). Populated when
   *  strategy.taxAdjustment.enabled. Undefined otherwise so callers that don't
   *  care about the feature can ignore it entirely. All weights and values are
   *  expressed in after-tax dollars; trades themselves remain nominal. */
  taxAdjusted?: {
    householdValue: number;
    currentWeights: Record<AssetClass, number>;
    projectedWeights: Record<AssetClass, number>;
  };
  /** Per-account current value by asset class (before trades). Excludes unmapped positions.
   *  This is the engine's *allocation* lens: rollup redistributes parent holdings into
   *  children and consolidateParentClasses folds them back per target granularity. Correct
   *  for drift/trade math; use the native maps below for per-account display (issue #78). */
  currentValueByAccount: Record<string, Record<AssetClass, number>>;
  /** Per-account current value in the *holdings* lens — each position pinned to its
   *  classified class, no parent→child redistribution (issue #78). Granularity matches
   *  what the user holds (a parent-level TDF stays at the parent level), so this drives
   *  the per-account "Before" display. Per-account totals match currentValueByAccount.
   *  Each account's idle/free cash (newCash + its share of distributed freeCash) is
   *  included under CASH so the breakdown reconciles with household value (issue #83). */
  nativeValueByAccount: Record<string, Record<AssetClass, number>>;
  /** The holdings-lens allocation after the recommended trades execute (issue #78) —
   *  `nativeValueByAccount` with each resolved trade applied at its holding's pinned
   *  class. Drives the per-account "After trades" display. Idle/free cash that the
   *  trades deploy is consumed from CASH so "Before" and "After" totals match;
   *  undeployed cash remains under CASH (issue #83). */
  projectedNativeValueByAccount: Record<string, Record<AssetClass, number>>;
  /** Per-account dollars withdrawn to fund a planned withdrawal / RMD (issue #14).
   *  This is the cash that leaves each account — RMD plus discretionary draw — which
   *  may be met by selling or from idle cash, so it is not the same as net sells.
   *  Empty when not in drawdown mode. A transfer *out* of the account (issues #84/#87). */
  withdrawalByAccount: Record<string, number>;
  /** Per-account household free cash deposited into the account (Step 0b's freeCash
   *  distribution). A transfer *into* the account — new external money that changes
   *  the balance — as opposed to per-account `newCash`, which is in-account idle cash
   *  whose deployment is balance-neutral. The reported per-account Net is
   *  `depositByAccount − withdrawalByAccount` (issues #84/#87). Empty when no
   *  household freeCash was distributed. */
  depositByAccount: Record<string, number>;
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
  | { kind: 'WITHDRAWAL_SHORTFALL'; amountUsd: number }
  /** Blended funds (#40): a sub-class sale forced a proportional sale of a
   *  blended fund (TDF, balanced fund), over-selling another sub-class. The engine
   *  tried to compensate by routing a buy elsewhere; this flag fires when no
   *  eligible destination existed for the over-sold portion, so the household
   *  allocation drifts. amountUsd is the uncompensated over-sell. */
  | { kind: 'BLENDED_FUND_OVERSELL'; accountId: string; ticker: string; assetClass: AssetClass; amountUsd: number }
  /** Blended funds (#40): informational disclosure that the engine sold part of
   *  a blended fund this run. The engine has no symmetric buy mechanism for
   *  blended funds, so repeated rebalances will trend the allocation away from
   *  this position over time. Use position-level locking if you want a specific
   *  blended-fund holding preserved. amountUsd is the fund-level sale total. */
  | { kind: 'BLENDED_FUND_SOLD'; accountId: string; ticker: string; amountUsd: number }
  /** Tax adjustment (#7): a taxable-account position is missing costBasis while
   *  tax-adjusted allocation is enabled. The engine fell back to B = V (no
   *  haircut, conservative) for this position. Filling in basis will produce a
   *  more accurate after-tax view and may shift the recommended trades. */
  | { kind: 'MISSING_COST_BASIS'; accountId: string; ticker: string }
  /** Wash sale (#5): the engine recommends selling an asset class in a taxable
   *  account while buying the same class in another account in the same run.
   *  If the taxable sale realizes a loss, the IRS wash-sale rule disallows it
   *  (applies across IRA/401k and spouse accounts too). Emitted conservatively:
   *  suppressed only when cost basis is known for the sold class and the sale is
   *  a gain (no loss to disallow); kept when basis is missing/implausible. One
   *  flag per taxable-account × class × buy-account triple. */
  | { kind: 'WASH_SALE_RISK'; taxableAccountId: string; assetClass: AssetClass; buyAccountId: string };
