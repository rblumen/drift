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
    for (let bucketIdx = 0; bucketIdx < strategy.placement[ac].length; bucketIdx++) {
      const bucket = strategy.placement[ac][bucketIdx];
      if (remainingNeed[ac] <= EPSILON) break;

      const eligible = accounts.filter(
        a => accountBucket(a.type) === bucket
          && effectiveAllowed[a.id].has(ac)
          && remainingCapacity[a.id] > EPSILON,
      );
      if (eligible.length === 0) continue;

      const totalCap = eligible.reduce((s, a) => s + remainingCapacity[a.id], 0);
      const toPlace = Math.min(remainingNeed[ac], totalCap);
      distributeProportional(eligible, toPlace, totalCap, ac, remainingCapacity, targetLocation);
      remainingNeed[ac] -= toPlace;

      if (bucketIdx > 0 && toPlace > EPSILON) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket, amountUsd: toPlace });
      }
    }

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

      const totalCap = anyEligible.reduce((s, a) => s + remainingCapacity[a.id], 0);
      const toPlace = Math.min(remainingNeed[ac], totalCap);

      // Track spill per destination bucket for flags.
      const spillByBucket = new Map<PlacementBucket, number>();
      for (const acct of anyEligible) {
        const share = (remainingCapacity[acct.id] / totalCap) * toPlace;
        targetLocation[acct.id][ac] += share;
        remainingCapacity[acct.id] -= share;
        const bkt = accountBucket(acct.type);
        spillByBucket.set(bkt, (spillByBucket.get(bkt) ?? 0) + share);
      }
      remainingNeed[ac] -= toPlace;

      for (const [bucket, amountUsd] of spillByBucket) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket, amountUsd });
      }
    }
  }

  return { targetLocation, placementFlags: flags };
}
