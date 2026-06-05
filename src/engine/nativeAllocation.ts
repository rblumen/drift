import type { Account, AssetClass, FundDecomposition, Position, ResolvedTrade } from './types';
import type { ClassifyFn } from './classify';
import { zeroByClass } from './utils';

// ── Holdings lens (issue #78) ─────────────────────────────────────────────────
//
// The engine reasons about allocation in a *mutable* lens: rollup() redistributes
// every parent-class holding into its children (for leaf-granular drift math) and
// consolidateParentClasses() folds them back, gated on the household *target*
// granularity. That lens is correct for trade sizing but wrong for per-account
// *display*: it can render a single parent-level fund as invented leaf sub-classes
// (a TDF's US_TOTAL_MARKET sliver shown as US_LARGE/MID/SMALL_CAP via default
// weights we don't actually have).
//
// The holdings lens below pins each position to the class(es) it is *classified*
// as, at that holding's natural hierarchy level, and never invents a sub-class:
//   • a blended fund (has a decomposition) → its decomposition keys, wherever they
//     sit (a TDF stays at US_TOTAL_MARKET / DEVELOPED_INTL / FIXED_INCOME);
//   • any other fund → its single classify() class (VTI → US_TOTAL_MARKET,
//     VOO → US_LARGE_CAP, BND → FIXED_INCOME).
//
// Unmapped tickers (classify → null, no decomposition) are skipped, mirroring
// rollup()'s exclusion so the holdings and allocation views agree on which
// holdings count toward an account's total.

/**
 * Apply a holding's value to a by-class bucket at the holding's pinned
 * granularity. Returns false when the ticker is unmapped (no decomposition and
 * classify → null), so callers can decide on a fallback.
 */
function applyHolding(
  bucket: Record<AssetClass, number>,
  ticker: string,
  value: number,
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition>,
): boolean {
  const decomp = decompositions[ticker.toUpperCase()];
  if (decomp) {
    for (const [ac, w] of Object.entries(decomp) as [AssetClass, number][]) {
      bucket[ac] += value * w;
    }
    return true;
  }
  const ac = classify(ticker);
  if (ac === null) return false;
  bucket[ac] += value;
  return true;
}

/**
 * Per-account allocation in the holdings lens — current positions rolled up to
 * each holding's pinned class, with no parent→child redistribution. This is the
 * "Before" view for the per-account display: its granularity matches what the
 * user actually holds. Per-account totals match rollup()'s currentValueByAccount;
 * only the granularity differs.
 *
 * newCash is excluded here — this function reports classified *holdings* only.
 * rebalance() layers idle/free cash onto the CASH bucket of its result
 * (`surfaceIdleCash`, issue #83) so the displayed breakdown reconciles with
 * household value; this function itself stays a pure holdings lens.
 */
export function nativeAllocationByAccount(
  accounts: Account[],
  positions: Position[],
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition> = {},
): Record<string, Record<AssetClass, number>> {
  const byAccount: Record<string, Record<AssetClass, number>> = {};
  for (const acct of accounts) byAccount[acct.id] = zeroByClass();

  for (const pos of positions) {
    const bucket = byAccount[pos.accountId] ?? (byAccount[pos.accountId] = zeroByClass());
    applyHolding(bucket, pos.ticker, pos.marketValue, classify, decompositions);
  }
  return byAccount;
}

/**
 * The "After" view: the holdings-lens allocation once the recommended trades
 * execute. Starts from `before` and applies each resolved trade at *its holding's*
 * pinned class, so granularity emerges from holdings + trades rather than a
 * heuristic:
 *   • a trade routed to a blended fund (a proportional TDF sale) spreads across
 *     that fund's decomposition → parent buckets shrink, staying parent-level;
 *   • a trade routed to a leaf-classified fund (e.g. VOO) lands at the leaf class;
 *   • a greenfield buy with no ticker lands at the trade's assetClass, which the
 *     resolver already promotes to the strategy's granularity — so a strategy that
 *     deliberately gets more granular shows finer-grained new holdings here.
 *
 * Resolved trades carry the executing ticker where known; ticker-less trades
 * (greenfield buys, ambiguous slots) fall back to the trade's assetClass.
 */
export function projectedNativeAllocationByAccount(
  before: Record<string, Record<AssetClass, number>>,
  resolvedTrades: ResolvedTrade[],
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition> = {},
): Record<string, Record<AssetClass, number>> {
  const after: Record<string, Record<AssetClass, number>> = {};
  for (const [id, byClass] of Object.entries(before)) after[id] = { ...byClass };

  for (const t of resolvedTrades) {
    const bucket = after[t.accountId] ?? (after[t.accountId] = zeroByClass());
    // A ticker'd trade lands at its holding's pinned class; if the ticker is
    // somehow unmapped, fall back to the engine's trade class so no value is lost.
    if (t.ticker && applyHolding(bucket, t.ticker, t.deltaUsd, classify, decompositions)) continue;
    bucket[t.assetClass] += t.deltaUsd;
  }
  return after;
}
