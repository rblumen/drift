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

// Places `toPlace` dollars across all `eligible` accounts regardless of bucket,
// filling concentrate accounts first then the rest, largest-capacity-first within
// each group. Returns the dollars placed per destination bucket so the caller can
// decide whether to flag a spillover. Mutates remainingCapacity and targetLocation.
function distributeAnywhere(
  eligible: Account[],
  toPlace: number,
  assetClass: AssetClass,
  remainingCapacity: Record<string, number>,
  targetLocation: Record<string, Record<AssetClass, number>>,
): Map<PlacementBucket, number> {
  const placedByBucket = new Map<PlacementBucket, number>();
  const [conc, rest] = partition(eligible, a => !!a.concentrateClasses?.includes(assetClass));
  let remaining = toPlace;
  for (const group of [conc, rest]) {
    if (group.length === 0 || remaining <= EPSILON) continue;
    const sorted = [...group].sort((a, b) => remainingCapacity[b.id] - remainingCapacity[a.id]);
    for (const acct of sorted) {
      if (remaining <= EPSILON) break;
      const take = Math.min(remaining, remainingCapacity[acct.id]);
      if (take <= EPSILON) continue;
      targetLocation[acct.id][assetClass] += take;
      remainingCapacity[acct.id] -= take;
      const bkt = accountBucket(acct.type);
      placedByBucket.set(bkt, (placedByBucket.get(bkt) ?? 0) + take);
      remaining -= take;
    }
  }
  return placedByBucket;
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

  // Constraint count drives placement order: fewer eligible buckets = more
  // constrained = placed first. A missing entry defaults to the two-bucket
  // preference; an empty array ("no preference") is the least constrained of all
  // and is placed last (sentinel 99, safely above any real bucket count) so that
  // classes with a required home claim their preferred capacity first.
  const constraintCount = (ac: AssetClass): number => {
    const buckets = strategy.placement[ac];
    if (buckets === undefined) return 2;
    if (buckets.length === 0) return 99;
    return buckets.length;
  };

  // Sort most-constrained classes first. Equal counts preserve PLACEMENT_TIEBREAK_ORDER.
  const tiebreakIndex = Object.fromEntries(PLACEMENT_TIEBREAK_ORDER.map((ac, i) => [ac, i]));
  const sortedClasses = [...PLACEMENT_TIEBREAK_ORDER].sort(
    (a, b) =>
      constraintCount(a) - constraintCount(b) ||
      (tiebreakIndex[a] ?? 999) - (tiebreakIndex[b] ?? 999),
  );

  for (const ac of sortedClasses) {
    if (remainingNeed[ac] <= EPSILON) continue;

    const placementBuckets = strategy.placement[ac] ?? ['TAX_ADVANTAGED', 'TAXABLE'];

    // No preference (empty bucket list): the class has no required home, so place
    // it freely across every eligible account wherever capacity is largest. No
    // PLACEMENT_SPILLOVER flag — there is no preferred bucket to overflow from.
    // A genuine NO_ELIGIBLE_ACCOUNT still fires if no account can hold the class.
    if (placementBuckets.length === 0) {
      const eligible = accounts.filter(
        a => effectiveAllowed[a.id].has(ac) && remainingCapacity[a.id] > EPSILON,
      );
      if (eligible.length > 0) {
        const cap = eligible.reduce((s, a) => s + remainingCapacity[a.id], 0);
        const toPlace = Math.min(remainingNeed[ac], cap);
        distributeAnywhere(eligible, toPlace, ac, remainingCapacity, targetLocation);
        remainingNeed[ac] -= toPlace;
      }
      if (remainingNeed[ac] > EPSILON) {
        flags.push({ kind: 'NO_ELIGIBLE_ACCOUNT', assetClass: ac, amountUsd: remainingNeed[ac] });
        remainingNeed[ac] = 0;
      }
      continue;
    }

    // Pass 1 — try preferred buckets in order.
    // Filling any bucket beyond the first (index > 0) is a spillover and gets flagged,
    // because the asset class didn't fully fit in its primary home.
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

      // Fill concentrated accounts first, then the rest — largest-capacity first
      // within each group (concentrate-then-spill, backlog #17). Every dollar
      // placed here is a spillover out of the preferred buckets, so flag it.
      const cap = anyEligible.reduce((s, a) => s + remainingCapacity[a.id], 0);
      const toPlace = Math.min(remainingNeed[ac], cap);
      const spillByBucket = distributeAnywhere(anyEligible, toPlace, ac, remainingCapacity, targetLocation);
      remainingNeed[ac] -= toPlace;

      for (const [bucket, amountUsd] of spillByBucket) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket, amountUsd });
      }
    }
  }

  return { targetLocation, placementFlags: flags };
}
