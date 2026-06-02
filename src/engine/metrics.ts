import type { AssetClass } from './types';
import { ALL_ASSET_CLASSES } from './types';

/** Risk-asset share: equities + alternatives (everything except fixed income and cash).
 *  Range [0, 1]. 0 = pure conservative, 1 = pure aggressive. */
export function aggressiveness(weights: Record<AssetClass, number>): number {
  const total = ALL_ASSET_CLASSES.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
  if (total <= 0) return 0;
  const defensive = (weights.FIXED_INCOME ?? 0) + (weights.CASH ?? 0);
  return clamp01((total - defensive) / total);
}

/** Normalized inverse Herfindahl across asset classes.
 *  Range [0, 1]. 0 = everything in one class, 1 = perfectly even across all N classes. */
export function diversification(weights: Record<AssetClass, number>): number {
  const total = ALL_ASSET_CLASSES.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
  if (total <= 0) return 0;
  let hhi = 0;
  for (const ac of ALL_ASSET_CLASSES) {
    const w = (weights[ac] ?? 0) / total;
    hhi += w * w;
  }
  const n = ALL_ASSET_CLASSES.length;
  // (1 - HHI) reaches its max of (1 - 1/N) when fully equal-weighted; normalize to [0,1].
  return clamp01((1 - hhi) / (1 - 1 / n));
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
