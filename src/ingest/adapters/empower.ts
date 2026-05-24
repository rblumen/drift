// Empower asset-class totals adapter.
//
// Fastest ingest path for Empower accounts: instead of exporting a CSV, the user
// reads dollar totals by asset class directly from the Empower dashboard
// (Investments → Holdings → Allocation view) and types them in.
//
// The adapter converts those totals into synthetic Position objects using
// the EMPOWER_* ticker convention (mapped in src/data/assetclass-map.json).
//
// Tradeoffs vs CSV export:
//   + Zero file-handling friction.
//   - Empower's taxonomy may not split Developed vs Emerging International;
//     if the dashboard shows a single "International" total, enter it under
//     DEVELOPED_INTL and leave EMERGING_INTL at 0 (or split manually).
//   - Per-account detail can blur when Empower aggregates sub-accounts.
import type { AssetClass, Position } from '../../engine/types';
import { ALL_ASSET_CLASSES } from '../../engine/types';

// Synthetic tickers that map to each AssetClass in assetclass-map.json.
// Using a consistent prefix makes them easy to identify and filter in the UI.
export const EMPOWER_TICKER: Record<AssetClass, string> = {
  US_TOTAL_MARKET: 'EMPOWER_US',
  DEVELOPED_INTL:  'EMPOWER_INTL',
  EMERGING_INTL:   'EMPOWER_EM',
  FIXED_INCOME:    'EMPOWER_FI',
  ALTERNATIVES:    'EMPOWER_ALT',
  CASH:            'EMPOWER_CASH',
};

// Convert a map of { AssetClass → dollars } into normalised Position objects.
// Classes with a zero or missing total are omitted.
export function parseEmpowerTotals(
  accountId: string,
  totals: Partial<Record<AssetClass, number>>,
): Position[] {
  return ALL_ASSET_CLASSES
    .filter(ac => (totals[ac] ?? 0) > 0)
    .map(ac => ({
      accountId,
      ticker:      EMPOWER_TICKER[ac],
      description: `Empower ${ac} (dashboard total)`,
      marketValue: totals[ac]!,
    }));
}
