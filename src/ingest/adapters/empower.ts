// Empower 401k adapter — two ingest paths:
//
// 1. parseEmpowerCsv  — parses the copy-pasted "My Investments" CSV export.
//    Empower's export is TRANSPOSED: tickers run across row 0, descriptions
//    across row 1, and the dollar balances appear in the last row whose label
//    column is empty.  This function handles that layout automatically.
//
//    How to export: My Investments → (copy table contents into a .csv file).
//    Save as CSV; do not reorder or add columns.
//
// 2. parseEmpowerTotals — manual-entry path.
//    Read dollar totals by asset class from the Empower dashboard
//    (Investments → Holdings → Allocation view) and pass them in as a map.
//    Useful when the CSV export is unavailable or too messy.
//
// Both paths emit normalised Position objects using the fund's own ticker
// symbol (CSV path) or the EMPOWER_* synthetic tickers (manual path).

import Papa from 'papaparse';
import { parseMoney, type CsvParseResult } from '../csv';
import type { AssetClass, Position } from '../../engine/types';
import { ALL_ASSET_CLASSES } from '../../engine/types';

// ─── CSV path ────────────────────────────────────────────────────────────────

// Parse Empower's transposed holdings CSV into normalised Position objects.
//
// Expected layout (columns map to individual funds):
//   Row 0:  "Holding"  | TICKER_A  | TICKER_B  | …
//   Row 1:  "Shares"   | Fund Name | Fund Name | …   ← used as description
//   Row N:  (empty)    | $value_A  | $value_B  | …   ← balance row (last match)
export function parseEmpowerCsv(csvText: string, accountId: string): CsvParseResult {
  const normalised = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  const { data, errors: parseErrors } = Papa.parse<string[]>(
    normalised,
    { header: false, skipEmptyLines: true },
  );

  const errors: string[] = parseErrors.map(e => `CSV parse error: ${e.message}`);

  if (data.length < 2) {
    return { positions: [], errors: [...errors, 'Empower CSV has too few rows'] };
  }

  // Row 0: ["Holding", "TICKER_A", "TICKER_B", ...]
  const headerRow = data[0] as string[];
  const tickers = headerRow.slice(1).map(t => t.trim()).filter(Boolean);
  if (!tickers.length) {
    return { positions: [], errors: [...errors, 'No tickers found in Empower CSV header row'] };
  }

  // Row 1: ["Shares", "Fund Name A", "Fund Name B", ...]
  const descRow = data[1] as string[];
  const descriptions = descRow.slice(1).map(d => d.trim());

  // Balance row: the last row whose label (col 0) is empty and whose first
  // value column parses as a positive dollar amount.
  let balanceRow: string[] | undefined;
  for (let i = data.length - 1; i >= 2; i--) {
    const row = data[i] as string[];
    if (!row[0]?.trim() && parseMoney(row[1]) > 0) {
      balanceRow = row;
      break;
    }
  }

  if (!balanceRow) {
    return {
      positions: [],
      errors: [
        ...errors,
        'Could not find balance row in Empower CSV ' +
        '(expected a row with an empty label and dollar values)',
      ],
    };
  }

  const positions: Position[] = [];
  for (let i = 0; i < tickers.length; i++) {
    const ticker      = tickers[i];
    const marketValue = parseMoney(balanceRow[i + 1]);
    if (!ticker || isNaN(marketValue) || marketValue <= 0) continue;
    positions.push({
      accountId,
      ticker,
      description: descriptions[i] || undefined,
      marketValue,
    });
  }

  return { positions, errors };
}

// ─── Manual-entry path ───────────────────────────────────────────────────────

// Synthetic tickers that map to an AssetClass in assetclass-map.json.
// Used only by parseEmpowerTotals when real fund tickers are unavailable.
// Deliberately Partial: the Empower-totals entry path supports the six broad
// dashboard classes only. parseEmpowerTotals skips classes without a synthetic
// ticker; completing the map for the hierarchy sub-classes is tracked in #118.
export const EMPOWER_TICKER: Partial<Record<AssetClass, string>> = {
  US_TOTAL_MARKET: 'EMPOWER_US',
  DEVELOPED_INTL:  'EMPOWER_INTL',
  EMERGING_INTL:   'EMPOWER_EM',
  FIXED_INCOME:    'EMPOWER_FI',
  ALTERNATIVES:    'EMPOWER_ALT',
  CASH:            'EMPOWER_CASH',
};

// Convert a map of { AssetClass → dollars } into normalised Position objects.
// Classes with a zero or missing total — or without a synthetic ticker (only
// the six broad dashboard classes have one) — are omitted.
export function parseEmpowerTotals(
  accountId: string,
  totals: Partial<Record<AssetClass, number>>,
): Position[] {
  return ALL_ASSET_CLASSES
    .filter(ac => (totals[ac] ?? 0) > 0 && EMPOWER_TICKER[ac] !== undefined)
    .map(ac => ({
      accountId,
      ticker:      EMPOWER_TICKER[ac]!,
      description: `Empower ${ac} (dashboard total)`,
      marketValue: totals[ac]!,
    }));
}
