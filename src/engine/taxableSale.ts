import type { AssetClass } from './types';

/** A sell that carries capital-gains exposure: a reduction of a non-cash asset
 *  class held in a taxable account. Depleting a cash / money-market position
 *  (assetClass CASH, e.g. SPAXX) to fund purchases is not a sale and realizes no
 *  gain (issue #56).
 *
 *  Single source of truth for the `TAXABLE_SALE` engine flag and the per-trade
 *  "⚠ taxable sale" badge rendered in the Results table and the exported HTML
 *  report. Keep all three reading this predicate — duplicating the condition is
 *  what let #56 regress in the UI/report after the engine flag was fixed. */
export function isTaxableSale(trade: {
  deltaUsd: number;
  inTaxableAccount: boolean;
  assetClass: AssetClass;
}): boolean {
  return trade.deltaUsd < 0 && trade.inTaxableAccount && trade.assetClass !== 'CASH';
}
