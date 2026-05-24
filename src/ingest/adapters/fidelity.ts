// Fidelity positions-CSV adapter.
//
// How to export: Accounts & Trade → Portfolio → Download (CSV).
// The file starts with one metadata row ("Brokerage") before the column header;
// any blank lines between the metadata row and the header are handled by
// papaparse's skipEmptyLines.
//
// If Fidelity changes their export format, adjust FIDELITY_COLUMNS and FIDELITY_SKIP_ROWS.
import { parseCsv, type CsvParseResult } from '../csv';

const FIDELITY_COLUMNS = {
  ticker:      'Symbol',
  marketValue: 'Current Value',
  description: 'Description',
  price:       'Last Price',
} as const;

const FIDELITY_SKIP_ROWS = 1;

export function parseFidelityCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, FIDELITY_COLUMNS, { skipRows: FIDELITY_SKIP_ROWS });
}
