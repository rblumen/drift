import type { AssetClass } from './types';
import assetClassMapJson from '../data/assetclass-map.json';

const BASE_MAP = assetClassMapJson as Record<string, AssetClass>;

/** The seed ticker→AssetClass map shipped with the app. Exported for display purposes only. */
export const BUILTIN_CLASS_MAP: Readonly<Record<string, AssetClass>> = BASE_MAP;

export type ClassifyFn = (ticker: string) => AssetClass | null;

// Returns a classifier that checks user overrides first, then the seed map.
export function makeClassifier(overrides: Record<string, AssetClass> = {}): ClassifyFn {
  return (ticker: string): AssetClass | null => {
    const upper = ticker.toUpperCase();
    return overrides[upper] ?? BASE_MAP[upper] ?? null;
  };
}

export const classifyTicker: ClassifyFn = makeClassifier();
