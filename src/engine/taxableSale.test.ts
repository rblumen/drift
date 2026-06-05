import { describe, it, expect } from 'vitest';
import { isTaxableSale } from './taxableSale';
import type { AssetClass } from './types';

// Single source of truth for the TAXABLE_SALE engine flag and the per-trade
// "⚠ taxable sale" badge in the Results table and exported HTML report. Pinning
// the predicate here guards against #56 regressing in any one of those callers.
describe('isTaxableSale', () => {
  const sell = (assetClass: AssetClass, inTaxableAccount = true) =>
    ({ deltaUsd: -1000, inTaxableAccount, assetClass });

  it('flags a non-cash sell in a taxable account', () => {
    expect(isTaxableSale(sell('US_TOTAL_MARKET'))).toBe(true);
  });

  it('does not flag a cash position reduced in a taxable account (issue #56)', () => {
    expect(isTaxableSale(sell('CASH'))).toBe(false);
  });

  it('does not flag a sell in a tax-advantaged account', () => {
    expect(isTaxableSale(sell('US_TOTAL_MARKET', false))).toBe(false);
  });

  it('does not flag a buy in a taxable account', () => {
    expect(isTaxableSale({ deltaUsd: 1000, inTaxableAccount: true, assetClass: 'US_TOTAL_MARKET' })).toBe(false);
  });
});
