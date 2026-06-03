// Schwab positions-CSV adapter.
//
// How to export: Accounts → Positions tab → Export (top-right link).
// The exported file has exactly one metadata row (the "Positions for account …"
// timestamp line) followed by an empty line, then the column header.
// skipRows=1 drops the metadata line; papaparse's skipEmptyLines handles the
// blank gap before the header.
//
// Column names confirmed against the 2026-05 Schwab export format.
// If Schwab changes their export, adjust SCHWAB_COLUMNS and SCHWAB_SKIP_ROWS.
import { parseCsv, type CsvParseResult } from '../csv';

const SCHWAB_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Mkt Val (Market Value)',
  description: 'Description',
  price:       'Price',
  costBasis:   'Cost Basis',
} as const;

const SCHWAB_SKIP_ROWS = 1;

// Schwab reports swept free cash on a "Cash & Cash Investments" row whose Symbol
// column is that label rather than a tradable ticker. Re-label it to SCHWAB_CASH
// (mapped to the CASH asset class in assetclass-map.json) so the balance is
// captured instead of dropped (#54).
const SCHWAB_CASH_LABEL  = 'Cash & Cash Investments';
const SCHWAB_CASH_TICKER = 'SCHWAB_CASH';

export function parseSchwabCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, SCHWAB_COLUMNS, {
    skipRows: SCHWAB_SKIP_ROWS,
    cashRow: { label: SCHWAB_CASH_LABEL, ticker: SCHWAB_CASH_TICKER },
  });
}
