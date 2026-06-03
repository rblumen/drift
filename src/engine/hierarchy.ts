import type { AssetClass, Strategy } from './types';

export interface ClassGroup {
  readonly children: readonly AssetClass[];
  // Default split weights. Two uses:
  //   1. Rollup redistribution of parent-class *holdings* into child-class
  //      currentValue buckets (always applied — see rollup.ts).
  //   2. Migration of a parent-level *target* into child targets, but ONLY when
  //      `migrateSplit` is true (see below).
  // Must sum to 1.0.
  readonly defaultWeights: Readonly<Record<string, number>>;
  // When true, a parent-level target is auto-split into child targets on load
  // (schema migration). Reserve this for *synthetic* parents that are never held
  // at the parent level — US_TOTAL_MARKET is always expressed as its cap children,
  // so an old save with US_TOTAL_MARKET: 0.575 must split.
  //
  // When false/omitted (the default), a parent target is preserved as-is on load.
  // The class is held at the parent level; its children surface only via the
  // visibility rule (held or individually targeted) and the user opts into the
  // split explicitly in the Strategy panel. This keeps simple portfolios from
  // being force-subdivided on upgrade (e.g. a 20% FIXED_INCOME sleeve should not
  // silently fan out into five bond sub-classes the user never asked for).
  //
  // Note: rollup redistribution and `consolidateParentClasses` still operate
  // generically regardless of this flag — a parent-level holding (e.g. BND) is
  // redistributed to children for leaf-granular reasoning, then folded back to the
  // parent at drift time when the target sits at the parent level. The flag governs
  // *targets* only.
  readonly migrateSplit?: boolean;
}

/**
 * Declarative parent → children hierarchy.
 *
 * Adding a new relationship here is the only change needed to make rollup, resolve,
 * and schema migration all treat the new parent class generically. See:
 *   - rollup.ts  — four-map propagation of parent holdings to children
 *   - resolve.ts — coveredClasses() expansion; greenfield buy promotion
 *   - schema.ts  — migrateStrategyTargets() target split on load
 */
export const CLASS_HIERARCHY: Partial<Record<AssetClass, ClassGroup>> = {
  US_TOTAL_MARKET: {
    children: ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'],
    // Russell index cap weights: Russell 1000 (LC), Russell Midcap (MC), Russell 2000 (SC).
    defaultWeights: { US_LARGE_CAP: 0.67, US_MID_CAP: 0.25, US_SMALL_CAP: 0.08 },
    // Synthetic parent — a portfolio holds total-market funds, but the *target* is
    // always the cap split, so split parent targets on migration.
    migrateSplit: true,
  },
  // Developed-ex-US, sliced by region (MSCI EAFE ≈ Europe 62 / Pacific 38). Held at
  // the parent level by default (most holders own one broad fund like VXUS/VEA).
  DEVELOPED_INTL: {
    children: ['DEVELOPED_EUROPE', 'DEVELOPED_PACIFIC'],
    defaultWeights: { DEVELOPED_EUROPE: 0.62, DEVELOPED_PACIFIC: 0.38 },
  },
  // Fixed income, sliced by sector. Anchored on the Bloomberg US Aggregate
  // (Treasury ≈ ⅓, with MBS folded into US_TREASURY for v1), plus a muni sleeve
  // (the taxable-account vehicle) and TIPS/INTL the Agg omits. Held at the parent
  // level by default; sub-classing exists so munis place in taxable and the rest
  // shelter in tax-advantaged.
  FIXED_INCOME: {
    children: ['US_TREASURY', 'US_CORP_BOND', 'MUNI_BOND', 'TIPS', 'INTL_BOND'],
    defaultWeights: {
      US_TREASURY: 0.35, US_CORP_BOND: 0.25, MUNI_BOND: 0.20, TIPS: 0.10, INTL_BOND: 0.10,
    },
  },
  ALTERNATIVES: {
    children: ['CRYPTO', 'PRECIOUS_METALS'],
    defaultWeights: { CRYPTO: 0.50, PRECIOUS_METALS: 0.50 },
  },
};

// Reverse map: child → parent. Derived from CLASS_HIERARCHY — do not edit by hand.
export const PARENT_CLASS: Partial<Record<AssetClass, AssetClass>> = Object.fromEntries(
  Object.entries(CLASS_HIERARCHY).flatMap(([parent, group]) =>
    group!.children.map(child => [child, parent as AssetClass]),
  ),
) as Partial<Record<AssetClass, AssetClass>>;

/** True when `ac` is a parent class with declared children (e.g. ALTERNATIVES, US_TOTAL_MARKET). */
export function isParentClass(ac: AssetClass): boolean {
  return ac in CLASS_HIERARCHY;
}

/** True when `ac` is a sub-class nested under a parent (e.g. CRYPTO, US_LARGE_CAP). */
export function isChildClass(ac: AssetClass): boolean {
  return ac in PARENT_CLASS;
}

/** The children of `ac`, or an empty array when `ac` is not a parent class. */
export function childrenOf(ac: AssetClass): readonly AssetClass[] {
  return CLASS_HIERARCHY[ac]?.children ?? [];
}

/**
 * Consolidation pass — the inverse of the rollup redistribution.
 *
 * After rollup, parent-class holdings have been split into child-class buckets.
 * When the user's strategy targets the PARENT level (parent target > 0, all child
 * targets = 0), child-class values should count toward the parent for the purposes
 * of drift detection and trade sizing. Without this step, a user holding GLD
 * (PRECIOUS_METALS) with target ALTERNATIVES: 2.5% would show PRECIOUS_METALS
 * overshoot + ALTERNATIVES shortfall and generate spurious trades.
 *
 * Consolidation is skipped for US_TOTAL_MARKET (its target is always 0 and its
 * children are always the intended target level) and any parent whose children
 * already carry non-zero individual targets.
 *
 * Must be called on all four tracking maps together to preserve the invariant
 * that every map reflects the same logical state.
 */
export function consolidateParentClasses(
  targets: Strategy['targets'],
  currentValue: Record<AssetClass, number>,
  currentValueByAccount: Record<string, Record<AssetClass, number>>,
  lockedValueByAccount: Record<string, Record<AssetClass, number>>,
  blendedValueByAccount: Record<string, Record<AssetClass, number>>,
): void {
  for (const [parent, group] of Object.entries(CLASS_HIERARCHY)) {
    const parentAc = parent as AssetClass;
    const { children } = group!;

    // Only consolidate when the user is targeting at the parent level.
    if ((targets[parentAc] ?? 0) === 0) continue;
    if (children.some(c => (targets[c] ?? 0) > 0)) continue;

    // Sum child values into the parent across all four maps.
    for (const child of children) {
      currentValue[parentAc] += currentValue[child];
      currentValue[child] = 0;
    }

    for (const acctId of Object.keys(currentValueByAccount)) {
      for (const child of children) {
        currentValueByAccount[acctId][parentAc] += currentValueByAccount[acctId][child];
        currentValueByAccount[acctId][child] = 0;

        lockedValueByAccount[acctId][parentAc] += lockedValueByAccount[acctId][child];
        lockedValueByAccount[acctId][child] = 0;

        blendedValueByAccount[acctId][parentAc] += blendedValueByAccount[acctId][child];
        blendedValueByAccount[acctId][child] = 0;
      }
    }
  }
}
