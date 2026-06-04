// Tax-adjusted allocation helpers (issue #7).
//
// Account-type treatment, in order of precedence:
//   • ROTH_IRA, HSA, FIVE_TWENTY_NINE → 1.0  (post-tax / qualified withdrawals)
//   • TRADITIONAL_IRA, FOUR_OH_ONE_K  → (1 − effectiveRateAtRetirement)
//   • TAXABLE                         → per-position: 1 − LTCG × max(0, 1 − B/V)
//   • OTHER                           → 1.0  (no tax treatment defined; conservative)
//
// All functions are pure, side-effect-free, and safe to call when the feature is
// disabled (they return 1.0 / unaltered values). The engine guards on
// strategy.taxAdjustment?.enabled before invoking the scaling pipeline.

import type { Account, AccountType, AssetClass, FundDecomposition, Position, Strategy } from './types';
import type { ClassifyFn } from './classify';

/**
 * Per-position tax-adjustment factor (0..1]. Multiply marketValue by this to get
 * after-tax value.
 *
 * For taxable positions with missing or unusable costBasis (undefined, NaN,
 * negative, or > marketValue), falls back to B = V — i.e. no embedded gain, no
 * haircut. This is the conservative direction: it slightly understates the tax
 * drag rather than overstating it. The engine surfaces a MISSING_COST_BASIS flag
 * separately so the user can fill in basis and tighten the estimate.
 */
export function positionTaxFactor(
  position: Position,
  account: Account,
  taxAdjustment: NonNullable<Strategy['taxAdjustment']>,
): number {
  switch (account.type) {
    case 'ROTH_IRA':
    case 'HSA':
    case 'FIVE_TWENTY_NINE':
    case 'OTHER':
      return 1.0;
    case 'TRADITIONAL_IRA':
    case 'FOUR_OH_ONE_K':
      return clamp01(1 - taxAdjustment.effectiveRateAtRetirement);
    case 'TAXABLE': {
      const V = position.marketValue;
      if (V <= 0) return 1.0;
      const B = position.costBasis;
      // Fallback to B = V (no haircut) when basis is missing or implausible.
      if (B === undefined || !Number.isFinite(B) || B < 0 || B > V) return 1.0;
      const gain = V - B;
      const tax = taxAdjustment.marginalRateLTCG * gain;
      return clamp01(1 - tax / V);
    }
  }
}

/** After-tax value of a single position. Equivalent to marketValue × factor. */
export function positionAfterTaxValue(
  position: Position,
  account: Account,
  taxAdjustment: NonNullable<Strategy['taxAdjustment']>,
): number {
  return position.marketValue * positionTaxFactor(position, account, taxAdjustment);
}

/**
 * Account-level effective tax factor for *new contributions* (no embedded gain).
 *
 * Used to convert tax-adjusted *buy* deltas back to nominal dollars: a $D buy in
 * after-tax terms requires D / contributionTaxFactor nominal dollars to execute.
 * Independent of any existing position because new cash deployed today has B = V
 * (zero unrealized gain).
 */
export function contributionTaxFactor(
  accountType: AccountType,
  taxAdjustment: NonNullable<Strategy['taxAdjustment']>,
): number {
  switch (accountType) {
    case 'ROTH_IRA':
    case 'HSA':
    case 'FIVE_TWENTY_NINE':
    case 'TAXABLE':
    case 'OTHER':
      return 1.0;
    case 'TRADITIONAL_IRA':
    case 'FOUR_OH_ONE_K':
      return clamp01(1 - taxAdjustment.effectiveRateAtRetirement);
  }
}

/**
 * Returns the list of taxable positions that lack a usable costBasis. Drives
 * MISSING_COST_BASIS flag emission. Positions with marketValue ≤ 0 are skipped
 * (no tax drag to estimate anyway).
 */
export function findMissingCostBasis(
  accounts: Account[],
  positions: Position[],
): Array<{ accountId: string; ticker: string }> {
  const taxableIds = new Set(accounts.filter(a => a.type === 'TAXABLE').map(a => a.id));
  const out: Array<{ accountId: string; ticker: string }> = [];
  for (const p of positions) {
    if (!taxableIds.has(p.accountId)) continue;
    if (p.marketValue <= 0) continue;
    const B = p.costBasis;
    if (B === undefined || !Number.isFinite(B) || B < 0 || B > p.marketValue) {
      out.push({ accountId: p.accountId, ticker: p.ticker });
    }
  }
  return out;
}

/**
 * Wash-sale gain test (issue #5). Returns true only when we can confirm that
 * selling `assetClass` in account `accountId` realizes a *gain* — meaning there
 * is no loss for the wash-sale rule to disallow, so the warning can be safely
 * suppressed.
 *
 * Conservative by construction — returns false (i.e. "keep the warning") unless
 * every contributing holding has a usable cost basis and the aggregate is a gain:
 *   • Only plain (non-blended) positions whose classified class equals
 *     `assetClass` are considered. Blended funds (in `decompositions`) split
 *     across classes with no per-class basis, so a class held via a blended fund
 *     counts as unknown → keep the warning.
 *   • If no such position exists, or any contributing position lacks a usable
 *     basis (undefined, NaN, or negative), basis is unknown → keep the warning.
 *   • Otherwise suppress only when aggregate marketValue > aggregate costBasis.
 *
 * Pass nominal (pre-tax-scaling) positions so marketValue and costBasis line up.
 */
export function taxableClassSaleIsKnownGain(
  accountId: string,
  assetClass: AssetClass,
  positions: Position[],
  classify: ClassifyFn,
  decompositions: Record<string, FundDecomposition>,
): boolean {
  let sumV = 0;
  let sumB = 0;
  let sawPosition = false;
  for (const p of positions) {
    if (p.accountId !== accountId) continue;
    if (decompositions[p.ticker.toUpperCase()]) continue;   // blended — per-class basis unknown
    if (classify(p.ticker) !== assetClass) continue;
    if (p.marketValue <= 0) continue;
    const B = p.costBasis;
    if (B === undefined || !Number.isFinite(B) || B < 0) return false;  // basis unknown
    sawPosition = true;
    sumV += p.marketValue;
    sumB += B;
  }
  if (!sawPosition) return false;
  return sumV > sumB;
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 1.0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}
