import type { Account, AccountType, AssetClass, PlacementBucket, Strategy, Flag } from './types';
import { ALL_ASSET_CLASSES } from './types';

// Processing order: most-placement-constrained class first.
// FIXED_INCOME and ALTERNATIVES have a single preferred bucket; equities are flexible.
const PLACEMENT_ORDER: AssetClass[] = [
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

function zeroByClass(): Record<AssetClass, number> {
  return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>;
}

function partition<T>(arr: T[], pred: (x: T) => boolean): [T[], T[]] {
  const yes: T[] = [], no: T[] = [];
  for (const x of arr) (pred(x) ? yes : no).push(x);
  return [yes, no];
}

// Distributes `toPlace` dollars across `eligible` accounts proportionally to
// each account's remaining capacity. Mutates remainingCapacity and targetLocation.
function distributeProportional(
  eligible: Account[],
  toPlace: number,
  totalCap: number,
  assetClass: AssetClass,
  remainingCapacity: Record<string, number>,
  targetLocation: Record<string, Record<AssetClass, number>>,
): void {
  for (const acct of eligible) {
    const share = (remainingCapacity[acct.id] / totalCap) * toPlace;
    targetLocation[acct.id][assetClass] += share;
    remainingCapacity[acct.id] -= share;
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
  const EPSILON = 0.005;

  for (const acct of accounts) {
    targetLocation[acct.id] = zeroByClass();
  }

  for (const ac of PLACEMENT_ORDER) {
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
        distributeProportional(group, toPlace, cap, ac, remainingCapacity, targetLocation);
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
      // Fill concentrated accounts first, then the rest.
      const spillByBucket = new Map<PlacementBucket, number>();
      const [concSpill, restSpill] = partition(anyEligible, a => !!a.concentrateClasses?.includes(ac));
      for (const group of [concSpill, restSpill]) {
        if (group.length === 0 || remainingNeed[ac] <= EPSILON) continue;
        const cap = group.reduce((s, a) => s + remainingCapacity[a.id], 0);
        if (cap <= EPSILON) continue;
        const toPlace = Math.min(remainingNeed[ac], cap);
        for (const acct of group) {
          const share = (remainingCapacity[acct.id] / cap) * toPlace;
          targetLocation[acct.id][ac] += share;
          remainingCapacity[acct.id] -= share;
          const bkt = accountBucket(acct.type);
          spillByBucket.set(bkt, (spillByBucket.get(bkt) ?? 0) + share);
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
