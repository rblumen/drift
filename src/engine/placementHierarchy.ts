import type { Account, AccountPlacementTarget, AccountType, PlacementBucket, PlacementTarget } from './types';

const ACCOUNT_TARGET_PREFIX = 'account:';

/** Build a specific-account placement leaf, e.g. accountTarget('roth1') → 'account:roth1'. */
export function accountTarget(accountId: string): AccountPlacementTarget {
  return `${ACCOUNT_TARGET_PREFIX}${accountId}`;
}

/** True when `target` names a specific account (issue #89 Phase 2) rather than a tier/bucket/type. */
export function isAccountTarget(target: PlacementTarget): target is AccountPlacementTarget {
  return typeof target === 'string' && target.startsWith(ACCOUNT_TARGET_PREFIX);
}

/** The account id inside an `account:<id>` leaf, or null for any other target. */
export function accountIdOf(target: PlacementTarget): string | null {
  return isAccountTarget(target) ? target.slice(ACCOUNT_TARGET_PREFIX.length) : null;
}

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

  // A specific-account leaf has no static account *type* — it matches by id, handled in
  // accountSatisfiesPlacement — so it flattens to nothing here.
  if (isAccountTarget(target)) {
    descendantCache.set(target, []);
    return [];
  }

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
 * Full membership check used by the engine (issue #89 Phase 2): does this *account*
 * satisfy the placement `target`? A specific-account leaf matches by id; every other
 * target matches by the account's type via accountSatisfiesTarget. A target naming an
 * account that isn't in the household simply matches nothing — the class falls through to
 * the next preference, degrading gracefully rather than being stranded.
 */
export function accountSatisfiesPlacement(
  account: Pick<Account, 'id' | 'type'>,
  target: PlacementTarget,
): boolean {
  if (isAccountTarget(target)) return account.id === accountIdOf(target);
  return accountSatisfiesTarget(account.type, target);
}

/**
 * The coarse tax-treatment bucket a placement target lives under — the target-level
 * mirror of `accountBucket()`. Every node in the TAX_ADVANTAGED subtree (the bucket
 * itself, TAX_DEFERRED, TAX_FREE, and their account-type leaves) maps to TAX_ADVANTAGED;
 * the 529 leaf maps to EDUCATION; TAXABLE maps to TAXABLE. Used by the taxable-sell
 * redirect (Goal 7), which keys on whether a class prefers a sheltered home regardless of
 * how specific the preference is (TAX_FREE and TAX_DEFERRED are still tax-advantaged).
 *
 * A specific-account leaf (Phase 2) inherits the treatment of the named account, so the
 * caller must pass the household `accounts`. An unresolvable account target (deleted) is
 * treated conservatively as TAX_ADVANTAGED — it matches no account during placement
 * anyway, so this only affects whether the redirect bothers to consider the class.
 */
export function targetTaxTreatment(
  target: PlacementTarget,
  accounts: ReadonlyArray<Pick<Account, 'id' | 'type'>> = [],
): PlacementBucket {
  if (isAccountTarget(target)) {
    const acct = accounts.find(a => a.id === accountIdOf(target));
    return acct ? accountTypeTreatment(acct.type) : 'TAX_ADVANTAGED';
  }
  return accountTypeTreatment(target);
}

// Shared coarse mapping for a target that is a bucket/tier/account-type string. Account
// types and their like-named bucket strings (TAXABLE, FIVE_TWENTY_NINE) resolve here too.
function accountTypeTreatment(target: PlacementTarget): PlacementBucket {
  if (target === 'TAXABLE') return 'TAXABLE';
  if (target === 'EDUCATION' || target === 'FIVE_TWENTY_NINE') return 'EDUCATION';
  return 'TAX_ADVANTAGED';
}
