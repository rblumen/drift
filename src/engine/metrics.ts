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
