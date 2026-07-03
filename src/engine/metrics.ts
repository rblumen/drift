import type { AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';
import { CLASS_HIERARCHY } from './hierarchy';

// Defensive classes: FIXED_INCOME + all its hierarchy children + CASH.
// Derived once at module load so the set stays in sync with the hierarchy
// without requiring manual updates when new FI sub-classes are added.
const FI_CHILDREN = new Set<AssetClass>(CLASS_HIERARCHY['FIXED_INCOME']?.children ?? []);
function isDefensive(ac: AssetClass): boolean {
  return ac === 'FIXED_INCOME' || FI_CHILDREN.has(ac) || ac === 'CASH';
}

// #134: "Live" classes for the diversification denominator — the set of asset
// classes that can plausibly carry non-zero weight *simultaneously* in a single
// portfolio snapshot. ALL_ASSET_CLASSES over-counts two ways:
//   1. US_TOTAL_MARKET is a synthetic parent (see hierarchy.ts migrateSplit) —
//      it is always expressed via its cap children after schema migration, so its
//      weight is always 0. Counting it in N makes the theoretical max (perfectly
//      equal-weighted) unreachable, permanently compressing the [0,1] reading.
//   2. Every other parent/children pair (DEVELOPED_INTL, FIXED_INCOME,
//      ALTERNATIVES) is held EITHER at the parent level OR split across its
//      children, never both at once — consolidateParentClasses() enforces this
//      as an invariant. Counting parent + children as separate slots again makes
//      the max unreachable and shrinks the reading further every time a new
//      sub-class is added to the hierarchy, even though nothing changed about
//      how diversified a portfolio can be.
// LIVE_ASSET_CLASSES counts each mutually-exclusive family once (its children,
// since that's the finer, more informative granularity) and drops always-zero
// synthetic parents entirely. Derived from CLASS_HIERARCHY so the count stays
// correct as classes are added/removed — never hardcode the length.
const SYNTHETIC_ZERO_PARENTS = new Set<AssetClass>(['US_TOTAL_MARKET']);
const ABSORBED_PARENTS = new Set<AssetClass>(
  Object.keys(CLASS_HIERARCHY).filter(ac => !SYNTHETIC_ZERO_PARENTS.has(ac as AssetClass)) as AssetClass[],
);
export const LIVE_ASSET_CLASSES: readonly AssetClass[] = ALL_ASSET_CLASSES.filter(
  ac => !SYNTHETIC_ZERO_PARENTS.has(ac) && !ABSORBED_PARENTS.has(ac),
);

/** Risk-asset share: equities + alternatives + real estate (everything except
 *  fixed income, its sub-classes, and cash).
 *  Range [0, 1]. 0 = pure conservative, 1 = pure aggressive.
 *  Stable across split/merge: whether FIXED_INCOME is held at the parent level
 *  or split into US_TREASURY / MUNI_BOND / etc., the defensive total is the same. */
export function aggressiveness(weights: Record<AssetClass, number>): number {
  const total = ALL_ASSET_CLASSES.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
  if (total <= 0) return 0;
  const defensive = ALL_ASSET_CLASSES
    .filter(isDefensive)
    .reduce((s, ac) => s + (weights[ac] ?? 0), 0);
  return clamp01((total - defensive) / total);
}

/** Normalized inverse Herfindahl across asset classes.
 *  Range [0, 1]. 0 = everything in one class, 1 = perfectly even across all "live" classes.
 *  #134: the HHI sum still runs over every held class (a parent-level FIXED_INCOME
 *  weight contributes its own w² whether or not the user has split it into
 *  sub-classes — rollup/consolidation is a display/trade concern, not this metric's),
 *  but N in the normalizer is LIVE_ASSET_CLASSES.length rather than
 *  ALL_ASSET_CLASSES.length. That keeps the theoretical max — an equal-weighted
 *  spread across every class that can actually coexist in one portfolio — reachable,
 *  so the axis doesn't compress every time a new sub-class is added to the hierarchy. */
export function diversification(weights: Record<AssetClass, number>): number {
  const total = ALL_ASSET_CLASSES.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
  if (total <= 0) return 0;
  let hhi = 0;
  for (const ac of ALL_ASSET_CLASSES) {
    const w = (weights[ac] ?? 0) / total;
    hhi += w * w;
  }
  const n = LIVE_ASSET_CLASSES.length;
  // (1 - HHI) reaches its max of (1 - 1/N) when fully equal-weighted; normalize to [0,1].
  return clamp01((1 - hhi) / (1 - 1 / n));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
