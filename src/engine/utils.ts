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
