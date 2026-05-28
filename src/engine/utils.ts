import type { AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';

// Dollar threshold below which a value difference is treated as floating-point noise.
export const EPSILON = 0.005;

export function zeroByClass(): Record<AssetClass, number> {
  return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => [ac, 0])) as Record<AssetClass, number>;
}
