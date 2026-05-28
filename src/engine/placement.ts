import type { Account, AccountType, AssetClass, PlacementBucket, Strategy, Flag } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { EPSILON, zeroByClass } from './utils';

// Tiebreaker for classes with equal placement constraint counts.
// Primary sort is strategy.placement[ac].length ascending; this array resolves ties.
const PLACEMENT_TIEBREAK_ORDER: AssetClass[] = [
  'FIXED_INCOME',
  'ALTERNATIVES',
  'EMERGING_INTL',
  'DEVELOPED_INTL',
  'US_TOTAL_MARKET',
  'US_LARGE_CAP',
  'US_MID_CAP',
  'US_SMALL_CAP',
  'CASH',
];

export function accountBucket(type: AccountType): PlacementBucket {
  switch (type) {
    case 'TAXABLE':       return 'TAXABLE';
    case 'FIVE_TWENTY_NINE': return 'EDUCATION';
    default:              return 'TAX_ADVANTAGED';
  }
}

export interface PlacementResult {
  // targetLocation[accountId][assetClass] = target dollar amount
  targetLocation: Record<string, Record<AssetClass, number>>;
  placementFlags: Flag[];
}

function partition<T>(arr: T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [], no: T[] = [];
  for (const x of arr) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

// Distributes `toPlace` dollars across `eligible` accounts using a
// concentrate-then-spill strategy: fills the largest-capacity account first,
// then spills the remainder to the next-largest, and so on.  This minimises
// the number of accounts touched per asset class (backlog #17).
// Mutates remainingCapacity and targetLocation.
function distributeConcentrate(
  eligible: Account[],
  toPlace: number,
  assetClass: AssetClass,
  remainingCapacity: Record<string, number>,
  targetLocation: Record<string, Record<AssetClass, number>>,
): void {
  // Sort largest-capacity first so the single-account path is taken whenever
  // one account can absorb the entire need.
  const sorted = [...eligible].sort(
    (a, b) => remainingCapacity[b.id] - remainingCapacity[a.id],
  );
  let remaining = toPlace;
  for (const acct of sorted) {
    if (remaining <= EPSILON) break;
    const take = Math.min(remaining, remainingCapacity[acct.id]);
    targetLocation[acct.id][assetClass] += take;
    remainingCapacity[acct.id] -= take;
    remaining -= take;
  }
}

export function greedyPlace(
  accounts: Account[],
  accountCapacities: Record<string, number>,
  targetValue: Record<AssetClass, number>,
  effectiveAllowed: Record<string, Set<AssetClass>>,
  strategy: Strategy,
): PlacementResult {
  const remainingNeed: Record<AssetClass, number> = { ...targetValue };
  const remainingCapacity: Record<string, number> = { ...accountCapacities };
  const targetLocation: Record<string, Record<AssetClass, number>> = {};
  const flags: Flag[] = [];

  for (const acct of accounts) {
    targetLocation[acct.id] = zeroByClass();
  }

  // Sort most-constrained classes first (fewest placement bucket options).
  // Equal constraint counts preserve PLACEMENT_TIEBREAK_ORDER for stability.
  const tiebreakIndex = Object.fromEntries(PLACEMENT_TIEBREAK_ORDER.map((ac, i) => [ac, i]));
  const sortedClasses = [...PLACEMENT_TIEBREAK_ORDER].sort(
    (a, b) =>
      (strategy.placement[a]?.length ?? 2) - (strategy.placement[b]?.length ?? 2) ||
      (tiebreakIndex[a] ?? 999) - (tiebreakIndex[b] ?? 999),
  );

  for (const ac of sortedClasses) {
    if (remainingNeed[ac] <= EPSILON) continue;

    // Pass 1 — try preferred buckets in order.
    // Filling any bucket beyond the first (index > 0) is a spillover and gets flagged,
    // because the asset class didn't fully fit in its primary home.
    const placementBuckets = strategy.placement[ac] ?? ['TAX_ADVANTAGED', 'TAXABLE'];
    for (let bucketIdx = 0; bucketIdx < placementBuckets.length; bucketIdx++) {
      const bucket = placementBuckets[bucketIdx];
      if (remainingNeed[ac] <= EPSILON) break;

      const eligible = accounts.filter(
        a => accountBucket(a.type) === bucket
          && effectiveAllowed[a.id].has(ac)
          && remainingCapacity[a.id] > EPSILON,
      );
      if (eligible.length === 0) continue;

      // Fill accounts that concentrate this class first, then the rest.
      const [conc, rest] = partition(eligible, a => !!a.concentrateClasses?.includes(ac));
      let placed = 0;
      for (const group of [conc, rest]) {
        if (group.length === 0 || remainingNeed[ac] <= EPSILON) continue;
        const cap = group.reduce((s, a) => s + remainingCapacity[a.id], 0);
        if (cap <= EPSILON) continue;
        const toPlace = Math.min(remainingNeed[ac], cap);
        distributeConcentrate(group, toPlace, ac, remainingCapacity, targetLocation);
        remainingNeed[ac] -= toPlace;
        placed += toPlace;
      }

      if (bucketIdx > 0 && placed > EPSILON) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket, amountUsd: placed });
      }
    } // end pass 1

    // Pass 2 — spill into any eligible account (any bucket).
    if (remainingNeed[ac] > EPSILON) {
      const anyEligible = accounts.filter(
        a => effectiveAllowed[a.id].has(ac) && remainingCapacity[a.id] > EPSILON,
      );

      if (anyEligible.length === 0) {
        flags.push({ kind: 'NO_ELIGIBLE_ACCOUNT', assetClass: ac, amountUsd: remainingNeed[ac] });
        remainingNeed[ac] = 0;
        continue;
      }

      // Track spill per destination bucket for flags.
      // Fill concentrated accounts first, then the rest — largest-capacity first
      // within each group (concentrate-then-spill, backlog #17).
      const spillByBucket = new Map<PlacementBucket, number>();
      const [concSpill, restSpill] = partition(anyEligible, a => !!a.concentrateClasses?.includes(ac));
      for (const group of [concSpill, restSpill]) {
        if (group.length === 0 || remainingNeed[ac] <= EPSILON) continue;
        const cap = group.reduce((s, a) => s + remainingCapacity[a.id], 0);
        if (cap <= EPSILON) continue;
        const toPlace = Math.min(remainingNeed[ac], cap);
        const sorted = [...group].sort((a, b) => remainingCapacity[b.id] - remainingCapacity[a.id]);
        let remaining = toPlace;
        for (const acct of sorted) {
          if (remaining <= EPSILON) break;
          const take = Math.min(remaining, remainingCapacity[acct.id]);
          targetLocation[acct.id][ac] += take;
          remainingCapacity[acct.id] -= take;
          const bkt = accountBucket(acct.type);
          spillByBucket.set(bkt, (spillByBucket.get(bkt) ?? 0) + take);
          remaining -= take;
        }
        remainingNeed[ac] -= toPlace;
      }

      for (const [bucket, amountUsd] of spillByBucket) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket, amountUsd });
      }
    }
  }

  return { targetLocation, placementFlags: flags };
}
