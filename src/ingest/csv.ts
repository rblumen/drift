import Papa from 'papaparse';
import { positionSchema } from './schema';
import type { Position } from '../engine/types';

export interface ColumnMap {
  ticker:       string;   // CSV column name for the ticker/symbol
  marketValue:  string;   // CSV column name for the current market value
  description?: string;   // optional column for the holding description
  price?:       string;   // optional column for per-share price
  costBasis?:   string;   // optional column for aggregate cost basis (issue #7)
}

export interface CsvParseResult {
  positions: Position[];
  errors:    string[];
}

// Strip currency symbols, commas, and whitespace then parse as float.
// Handles "$1,234.56", "1234.56", "1,234", and negative values "$-50.00".
export function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  return parseFloat(raw.replace(/[$,\s]/g, ''));
}

// Parse a broker CSV into normalised Position objects.
//
// skipRows: strip this many lines from the top before passing to papaparse.
// Use it for broker files that prepend metadata rows before the column header.
// papaparse's skipEmptyLines handles blank lines within the remaining text.
export function parseCsv(
  csvText: string,
  accountId: string,
  columnMap: ColumnMap,
  opts?: { skipRows?: number },
): CsvParseResult {
  // Normalise line endings before splitting so skipRows works on Windows exports.
  const normalised = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const body = opts?.skipRows
    ? normalised.split('\n').slice(opts.skipRows).join('\n')
    : normalised;

  const { data, errors: parseErrors } =
    Papa.parse<Record<string, string>>(body, { header: true, skipEmptyLines: true });

  const positions: Position[] = [];
  // FieldMismatch (TooManyFields / TooFewFields) fires on broker footer/disclaimer
  // rows and on rows with trailing commas, but the data is still parsed correctly
  // and our row-level filters catch those rows anyway. Only surface fatal errors
  // like unclosed quotes that indicate a genuinely unparseable file.
  const errors: string[] = parseErrors
    .filter(e => e.type !== 'FieldMismatch')
    .map(e => `CSV parse error: ${e.message}`);

  for (const [i, row] of data.entries()) {
    // Strip broker footnote markers (e.g. "FDRXX**" → "FDRXX").
    const ticker      = row[columnMap.ticker]?.trim().replace(/\*+$/, '');
    const marketValue = parseMoney(row[columnMap.marketValue]);
    const price       = columnMap.price ? parseMoney(row[columnMap.price]) : undefined;
    const description = columnMap.description ? row[columnMap.description]?.trim() : undefined;
    const costBasis   = columnMap.costBasis ? parseMoney(row[columnMap.costBasis]) : undefined;

    // Skip subtotal/footer rows: no ticker, placeholder '--', NaN value, $0 or
    // negative (pending activity), or a ticker that contains a space (e.g.
    // "Account Total", "Cash & Cash Investments").
    // Real fund tickers are always space-free alphanumeric symbols.
    if (!ticker || ticker === '--' || ticker.includes(' ') || isNaN(marketValue) || marketValue <= 0) continue;

    const result = positionSchema.safeParse({
      accountId,
      ticker,
      description,
      marketValue,
      price: price && !isNaN(price) && price > 0 ? price : undefined,
      // Accept zero as a real value (fully appreciated position with $0 basis).
      // Skip undefined/NaN/negative.
      costBasis: costBasis !== undefined && !isNaN(costBasis) && costBasis >= 0 ? costBasis : undefined,
    });

    if (result.success) {
      positions.push(result.data as Position);
    } else {
      errors.push(`Row ${i + 1} (${ticker ?? '?'}): ${result.error.message}`);
    }
  }

  return { positions, errors };
}
