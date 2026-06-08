import type { AccountType, PlacementBucket, PlacementTarget } from './types';

export interface PlacementGroup {
  // Direct children of this node, in display order. Children are either intermediate
  // buckets (themselves keys in PLACEMENT_HIERARCHY) or leaf account types.
  readonly children: readonly PlacementTarget[];
}

/**
 * Declarative placement-target tree (issue #89).
 *
 * The placement-side analog of CLASS_HIERARCHY: a single source of truth that
 * generalizes the flat TAXABLE | TAX_ADVANTAGED | EDUCATION bucket into a tree whose
 * interior nodes are tax-treatment buckets and whose leaves are account types. A
 * strategy can express a placement preference at any level of this tree.
 *
 * Membership (accountSatisfiesTarget) is the only primitive the engine needs: an account
 * satisfies a target when its type is a leaf descendant of that target node. There is no
 * value redistribution here — unlike the asset-class hierarchy, the placement tree only
 * decides which accounts are *eligible* for a class during the greedy fill.
 *
 * Notes:
 *  - TAXABLE is both a bucket and its sole leaf account type (harmless name reuse).
 *  - OTHER is a direct leaf under TAX_ADVANTAGED — it has no clear deferred/free
 *    disposition, so it satisfies TAX_ADVANTAGED but neither TAX_DEFERRED nor TAX_FREE,
 *    preserving the pre-#89 behavior for OTHER accounts.
 *  - HSA shelters like Roth (qualified withdrawals untaxed), so it sits under TAX_FREE.
 */
export const PLACEMENT_HIERARCHY: Partial<Record<PlacementTarget, PlacementGroup>> = {
  TAXABLE:        { children: ['TAXABLE'] },
  TAX_ADVANTAGED: { children: ['TAX_DEFERRED', 'TAX_FREE', 'OTHER'] },
  TAX_DEFERRED:   { children: ['TRADITIONAL_IRA', 'FOUR_OH_ONE_K'] },
  TAX_FREE:       { children: ['ROTH_IRA', 'HSA'] },
  EDUCATION:      { children: ['FIVE_TWENTY_NINE'] },
};

/** True when `target` is an interior bucket node (has children other than itself). */
export function isPlacementBucket(target: PlacementTarget): boolean {
  const group = PLACEMENT_HIERARCHY[target];
  if (!group) return false;
  // TAXABLE is its own only child — treat it as a leaf for UI grouping purposes.
  return !(group.children.length === 1 && group.children[0] === target);
}

// Memoized leaf-flattening — the tree is tiny and static, so cache the walk.
const descendantCache = new Map<PlacementTarget, AccountType[]>();

/**
 * Flatten a target node to the leaf AccountTypes beneath it. A leaf account type
 * flattens to itself; a bucket flattens to every account type in its subtree.
 */
export function descendantAccountTypes(target: PlacementTarget): AccountType[] {
  const cached = descendantCache.get(target);
  if (cached) return cached;

  const group = PLACEMENT_HIERARCHY[target];
  let result: AccountType[];
  if (!group) {
    // No children declared → `target` is itself a leaf account type.
    result = [target as AccountType];
  } else if (group.children.length === 1 && group.children[0] === target) {
    // Self-referential leaf bucket (TAXABLE).
    result = [target as AccountType];
  } else {
    result = group.children.flatMap(child => descendantAccountTypes(child));
  }

  descendantCache.set(target, result);
  return result;
}

/**
 * Membership primitive: an account of `type` satisfies placement `target` when its type
 * is a leaf descendant of the target node. The engine's greedy fill filters eligible
 * accounts with this. A broad preference is satisfied by any descendant (so a Roth
 * satisfies TAX_ADVANTAGED), which is why landing a TAX_ADVANTAGED-preferred class in a
 * Roth is not a spillover.
 */
export function accountSatisfiesTarget(type: AccountType, target: PlacementTarget): boolean {
  return descendantAccountTypes(target).includes(type);
}

/**
 * The coarse tax-treatment bucket a placement target lives under — the target-level
 * mirror of `accountBucket()`. Every node in the TAX_ADVANTAGED subtree (the bucket
 * itself, TAX_DEFERRED, TAX_FREE, and their account-type leaves) maps to TAX_ADVANTAGED;
 * the 529 leaf maps to EDUCATION; TAXABLE maps to TAXABLE. Used by the taxable-sell
 * redirect (Goal 7), which keys on whether a class prefers a sheltered home regardless of
 * how specific the preference is (TAX_FREE and TAX_DEFERRED are still tax-advantaged).
 */
export function targetTaxTreatment(target: PlacementTarget): PlacementBucket {
  if (target === 'TAXABLE') return 'TAXABLE';
  if (target === 'EDUCATION' || target === 'FIVE_TWENTY_NINE') return 'EDUCATION';
  return 'TAX_ADVANTAGED';
}
