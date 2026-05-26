import type { FundDecomposition } from '../engine/types';

// Approximate glide-path compositions by target year for major fund families.
// Source: published fund fact sheets as of early 2026.
// Compositions shift ~1-2% per year; verify annually.
// US equity expressed as US_TOTAL_MARKET (total-market index internally).

interface GlidePoint { yearsOut: number; comp: FundDecomposition; }

// Helper: linear interpolation between two glide path points.
function interp(a: FundDecomposition, b: FundDecomposition, t: number): FundDecomposition {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const result: FundDecomposition = {};
  for (const k of keys) {
    const av = (a as Record<string, number>)[k] ?? 0;
    const bv = (b as Record<string, number>)[k] ?? 0;
    const v = av * (1 - t) + bv * t;
    if (v > 0.001) (result as Record<string, number>)[k] = Math.round(v * 1000) / 1000;
  }
  return result;
}

function lookupGlidePath(path: GlidePoint[], yearsOut: number): FundDecomposition {
  // Clamp to endpoints
  if (yearsOut >= path[0].yearsOut) return path[0].comp;
  if (yearsOut <= path[path.length - 1].yearsOut) return path[path.length - 1].comp;
  // Find bracketing entries
  for (let i = 0; i < path.length - 1; i++) {
    const hi = path[i];
    const lo = path[i + 1];
    if (yearsOut <= hi.yearsOut && yearsOut >= lo.yearsOut) {
      const t = (hi.yearsOut - yearsOut) / (hi.yearsOut - lo.yearsOut);
      return interp(hi.comp, lo.comp, t);
    }
  }
  return path[path.length - 1].comp;
}

// Fidelity Freedom Index glide path (confirmed against published fact sheets).
const FIDELITY_GLIDE: GlidePoint[] = [
  { yearsOut: 40, comp: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.37, FIXED_INCOME: 0.09 } },
  { yearsOut: 25, comp: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.37, FIXED_INCOME: 0.09 } },
  { yearsOut: 20, comp: { US_TOTAL_MARKET: 0.49, DEVELOPED_INTL: 0.33, FIXED_INCOME: 0.18 } },
  { yearsOut: 15, comp: { US_TOTAL_MARKET: 0.44, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.26 } },
  { yearsOut: 10, comp: { US_TOTAL_MARKET: 0.37, DEVELOPED_INTL: 0.25, FIXED_INCOME: 0.38 } },
  { yearsOut:  5, comp: { US_TOTAL_MARKET: 0.27, DEVELOPED_INTL: 0.18, FIXED_INCOME: 0.52, CASH: 0.03 } },
  { yearsOut:  0, comp: { US_TOTAL_MARKET: 0.21, DEVELOPED_INTL: 0.14, FIXED_INCOME: 0.62, CASH: 0.03 } },
  { yearsOut: -10, comp: { US_TOTAL_MARKET: 0.17, DEVELOPED_INTL: 0.12, FIXED_INCOME: 0.68, CASH: 0.03 } },
];

// Vanguard Target Retirement glide path.
const VANGUARD_GLIDE: GlidePoint[] = [
  { yearsOut: 40, comp: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  { yearsOut: 25, comp: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  { yearsOut: 20, comp: { US_TOTAL_MARKET: 0.50, DEVELOPED_INTL: 0.33, FIXED_INCOME: 0.17 } },
  { yearsOut: 15, comp: { US_TOTAL_MARKET: 0.45, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.25 } },
  { yearsOut: 10, comp: { US_TOTAL_MARKET: 0.38, DEVELOPED_INTL: 0.26, FIXED_INCOME: 0.36 } },
  { yearsOut:  5, comp: { US_TOTAL_MARKET: 0.31, DEVELOPED_INTL: 0.21, FIXED_INCOME: 0.48 } },
  { yearsOut:  0, comp: { US_TOTAL_MARKET: 0.24, DEVELOPED_INTL: 0.16, FIXED_INCOME: 0.60 } },
  { yearsOut: -10, comp: { US_TOTAL_MARKET: 0.18, DEVELOPED_INTL: 0.12, FIXED_INCOME: 0.70 } },
];

// Generic / unknown fund family — conservative midpoint between major providers.
const GENERIC_GLIDE: GlidePoint[] = [
  { yearsOut: 40, comp: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  { yearsOut: 20, comp: { US_TOTAL_MARKET: 0.49, DEVELOPED_INTL: 0.33, FIXED_INCOME: 0.18 } },
  { yearsOut: 10, comp: { US_TOTAL_MARKET: 0.38, DEVELOPED_INTL: 0.25, FIXED_INCOME: 0.37 } },
  { yearsOut:  0, comp: { US_TOTAL_MARKET: 0.22, DEVELOPED_INTL: 0.15, FIXED_INCOME: 0.61, CASH: 0.02 } },
  { yearsOut: -10, comp: { US_TOTAL_MARKET: 0.17, DEVELOPED_INTL: 0.12, FIXED_INCOME: 0.68, CASH: 0.03 } },
];

// Known tickers with exact compositions (high confidence).
// Only include tickers verified against fund fact sheets.
interface KnownEntry { label: string; year: number | null; composition: FundDecomposition; }

export const KNOWN_TARGET_DATE_TICKERS: Record<string, KnownEntry> = {
  // Fidelity Freedom Index (confirmed from live portfolio exports)
  'FDKLX': { label: 'Fidelity Freedom Index 2060', year: 2060, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.37, FIXED_INCOME: 0.09 } },
  'FFLEX': { label: 'Fidelity Flex Freedom Index 2060', year: 2060, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.37, FIXED_INCOME: 0.09 } },
  // Vanguard Target Retirement
  'VTTSX': { label: 'Vanguard Target Retirement 2060', year: 2060, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  'VFFVX': { label: 'Vanguard Target Retirement 2055', year: 2055, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  'VFIFX': { label: 'Vanguard Target Retirement 2050', year: 2050, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
  'VTIVX': { label: 'Vanguard Target Retirement 2045', year: 2045, composition: { US_TOTAL_MARKET: 0.52, DEVELOPED_INTL: 0.35, FIXED_INCOME: 0.13 } },
  'VFORX': { label: 'Vanguard Target Retirement 2040', year: 2040, composition: { US_TOTAL_MARKET: 0.50, DEVELOPED_INTL: 0.33, FIXED_INCOME: 0.17 } },
  'VTENX': { label: 'Vanguard Target Retirement 2035', year: 2035, composition: { US_TOTAL_MARKET: 0.45, DEVELOPED_INTL: 0.30, FIXED_INCOME: 0.25 } },
  'VTHRX': { label: 'Vanguard Target Retirement 2030', year: 2030, composition: { US_TOTAL_MARKET: 0.38, DEVELOPED_INTL: 0.26, FIXED_INCOME: 0.36 } },
  'VTXVX': { label: 'Vanguard Target Retirement 2025', year: 2025, composition: { US_TOTAL_MARKET: 0.31, DEVELOPED_INTL: 0.21, FIXED_INCOME: 0.48 } },
  'VTWNX': { label: 'Vanguard Target Retirement 2020', year: 2020, composition: { US_TOTAL_MARKET: 0.24, DEVELOPED_INTL: 0.16, FIXED_INCOME: 0.60 } },
  'VTINX': { label: 'Vanguard Target Retirement Income', year: null, composition: { US_TOTAL_MARKET: 0.18, DEVELOPED_INTL: 0.12, FIXED_INCOME: 0.70 } },
  'VSNVX': { label: 'Vanguard Target Retirement 2065', year: 2065, composition: { US_TOTAL_MARKET: 0.54, DEVELOPED_INTL: 0.36, FIXED_INCOME: 0.10 } },
};

export interface DetectResult {
  composition: FundDecomposition;
  /** Human-readable source description shown in the UI. */
  label: string;
  /** Whether this came from the exact-ticker table (high) or glide-path estimate (estimated). */
  confidence: 'high' | 'estimated';
}

const CURRENT_YEAR = new Date().getFullYear();

/**
 * Try to identify a target date fund and return its approximate composition.
 * Returns null if the ticker/description don't match any known pattern.
 */
export function detectTargetDateFund(
  ticker: string,
  description?: string,
): DetectResult | null {
  const upper = ticker.toUpperCase();

  // 1. Exact ticker match (highest confidence).
  const known = KNOWN_TARGET_DATE_TICKERS[upper];
  if (known) {
    return { composition: known.composition, label: known.label, confidence: 'high' };
  }

  // 2. Description-based detection.
  if (!description) return null;
  const desc = description.toUpperCase();

  // Must contain a target year (2020–2070 in 5-year increments).
  const yearMatch = desc.match(/\b(20[2-7][05])\b/);
  if (!yearMatch) return null;

  // Must look like a lifecycle / target date fund.
  const isTDF =
    desc.includes('FREEDOM') ||
    desc.includes('TARGET RETIREMENT') ||
    desc.includes('TARGET DATE') ||
    desc.includes('LIFECYCLE') ||
    desc.includes('RETIREMENT INDEX') ||
    (desc.includes('RETIREMENT') && desc.includes('INDEX'));
  if (!isTDF) return null;

  const year = parseInt(yearMatch[1]);
  const yearsOut = year - CURRENT_YEAR;

  const isFidelity = desc.includes('FIDELITY') || desc.includes('FID ') || desc.includes('FIDEL');
  const isVanguard = desc.includes('VANGUARD') || desc.includes('TARGET RETIREMENT');

  const glide = isFidelity ? FIDELITY_GLIDE : isVanguard ? VANGUARD_GLIDE : GENERIC_GLIDE;
  const family = isFidelity ? 'Fidelity' : isVanguard ? 'Vanguard' : 'Generic';

  return {
    composition: lookupGlidePath(glide, yearsOut),
    label: `${year} Target Date Fund (${family} glide path estimate)`,
    confidence: 'estimated',
  };
}
