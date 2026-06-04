import type { AssetClass, Strategy } from './types';
import { ALL_ASSET_CLASSES } from './types';

// Dollar threshold below which a value difference is treated as floating-point noise.
export const EPSILON = 0.005;

export function zeroByClass(): Record<AssetClass, number> {
  return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>;
}

/** Bogleheads / Swedroe 5/25 rule: a class is "out of tolerance" when its drift
 *  exceeds either band — the tighter wins. For small targets the relative band
 *  (toleranceRel × target) is tighter; for large targets the absolute band wins. */
export function effectiveTolerance(ac: AssetClass, strategy: Strategy): number {
  const rel = strategy.toleranceRel ?? 0.25;
  return Math.min(strategy.toleranceAbs, rel * strategy.targets[ac]);
}

/** Target band for rebalancing (issue #42): a tightened fraction of the trigger
 *  tolerance used by the trade-count-minimization pass as its acceptance band, so
 *  rebalanced classes land near ideal rather than at the trigger edge. The trigger
 *  band (effectiveTolerance) still governs *whether* to act; this governs *how
 *  close* to settle. Defaults to half the trigger band (rebalanceTargetFraction
 *  ?? 0.5); a fraction of 1.0 collapses it back to the trigger band. */
export function targetTolerance(ac: AssetClass, strategy: Strategy): number {
  const fraction = strategy.rebalanceTargetFraction ?? 0.5;
  return fraction * effectiveTolerance(ac, strategy);
}
