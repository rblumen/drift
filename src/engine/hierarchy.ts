import type { AssetClass, Strategy } from './types';

export interface ClassGroup {
  readonly children: readonly AssetClass[];
  // Default split weights used when migrating a parent-level target to child targets
  // (e.g. when loading an old save that only has ALTERNATIVES: 0.10 and no sub-class
  // entries). Must sum to 1.0. Weights also govern the rollup redistribution of
  // parent-class holdings into child-class currentValue buckets.
  readonly defaultWeights: Readonly<Record<string, number>>;
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
