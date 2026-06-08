import type { Account, AccountType, AssetClass, PlacementBucket, Strategy, Flag } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { accountSatisfiesTarget } from './placementHierarchy';
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

  // Sort most-constrained classes first, over EVERY asset class — not just the
  // tiebreak list. PLACEMENT_TIEBREAK_ORDER only resolves ties for equal constraint
  // counts; classes absent from it (e.g. the hierarchy sub-classes) still get placed,
  // ordered after the listed ones (sentinel 999). Iterating the tiebreak list directly
  // would silently drop any class not enumerated there.
  const tiebreakIndex = Object.fromEntries(PLACEMENT_TIEBREAK_ORDER.map((ac, i) => [ac, i]));
  const sortedClasses = [...ALL_ASSET_CLASSES].sort(
    (a, b) =>
      constraintCount(a) - constraintCount(b) ||
      (tiebreakIndex[a] ?? 999) - (tiebreakIndex[b] ?? 999) ||
      ALL_ASSET_CLASSES.indexOf(a) - ALL_ASSET_CLASSES.indexOf(b),
  );

  for (const ac of sortedClasses) {
    if (remainingNeed[ac] <= EPSILON) continue;

    const placementTargets = strategy.placement[ac] ?? ['TAX_ADVANTAGED', 'TAXABLE'];

    // No preference (empty target list): the class has no required home, so place
    // it freely across every eligible account wherever capacity is largest. No
    // PLACEMENT_SPILLOVER flag — there is no preferred bucket to overflow from.
    // A genuine NO_ELIGIBLE_ACCOUNT still fires if no account can hold the class.
    if (placementTargets.length === 0) {
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

    // Pass 1 — try preferred targets in order. A target may be a broad tax-treatment
    // bucket, an intermediate bucket (TAX_DEFERRED / TAX_FREE), or a specific account
    // type (issue #89); an account is eligible when its type satisfies the target node.
    //
    // Spillover semantics: filling a later target is a spillover *only when an earlier,
    // higher-priority target actually existed in the household and overflowed*. If an
    // earlier target had no eligible account at all (the household simply has no Roth,
    // say), falling through to the next preference is forced placement — the effective
    // primary — not an overflow, so it is not flagged. This is why a TAX_ADVANTAGED-
    // preferred class landing in a Roth never flags: the Roth satisfies the primary
    // target outright.
    let priorHomeOverflowed = false;
    for (let targetIdx = 0; targetIdx < placementTargets.length; targetIdx++) {
      const target = placementTargets[targetIdx];
      if (remainingNeed[ac] <= EPSILON) break;

      const eligible = accounts.filter(
        a => accountSatisfiesTarget(a.type, target)
          && effectiveAllowed[a.id].has(ac)
          && remainingCapacity[a.id] > EPSILON,
      );
      // A target with no account that can ever hold this class is not a "home" that
      // overflowed — distinguish "doesn't exist / already full" from a real overflow by
      // checking whether any account satisfies the target at all (capacity aside).
      const targetHasAnyAccount = accounts.some(
        a => accountSatisfiesTarget(a.type, target) && effectiveAllowed[a.id].has(ac),
      );
      if (eligible.length === 0) {
        // The home exists but is already full → a genuine overflow source for later spill.
        if (targetHasAnyAccount) priorHomeOverflowed = true;
        continue;
      }

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

      // Spillover only when a real higher-priority home overflowed into this one.
      if (priorHomeOverflowed && placed > EPSILON) {
        flags.push({ kind: 'PLACEMENT_SPILLOVER', assetClass: ac, bucket: target, amountUsd: placed });
      }
      // This target became a (possibly partial) home; if it can't absorb the remainder,
      // the next target down is a spill destination.
      if (remainingNeed[ac] > EPSILON) priorHomeOverflowed = true;
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
