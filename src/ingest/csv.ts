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

// ── Multi-account ingest ────────────────────────────────────────────────────
// Shared shape for adapters that discover several accounts in one export
// (Fidelity's per-row Account Number column; Schwab's all-accounts section
// blocks). The caller maps each discovered account to a real app account ID
// before committing positions — until then `accountId` holds the placeholder
// account number used as the `positionsByNumber` key.

/** One account discovered inside a broker export. */
export interface DiscoveredAccount {
  accountNumber: string;
  accountName:   string;
}

export interface MultiAccountResult {
  /** Accounts found in the file, in order of first appearance. */
  discovered:        DiscoveredAccount[];
  /** Positions grouped by placeholder account number. */
  positionsByNumber: Record<string, Position[]>;
  errors:            string[];
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
//
// cashRow: a broker's swept free-cash line (e.g. Schwab's "Cash & Cash
// Investments") carries a real dollar balance but its label column isn't a
// tradable ticker, so the space/placeholder filter below would drop it (#54).
// When a row's ticker equals cashRow.label, re-label it to cashRow.ticker — a
// synthetic symbol that classifies as CASH — so the balance is preserved.
export function parseCsv(
  csvText: string,
  accountId: string,
  columnMap: ColumnMap,
  opts?: { skipRows?: number; cashRow?: { label: string; ticker: string } },
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
    const rawTicker   = row[columnMap.ticker]?.trim();
    // Swept free-cash row: re-label to the synthetic CASH ticker (#54).
    const isCashRow   = !!opts?.cashRow && rawTicker === opts.cashRow.label;
    // Strip broker footnote markers (e.g. "FDRXX**" → "FDRXX").
    const ticker      = isCashRow ? opts!.cashRow!.ticker : rawTicker?.replace(/\*+$/, '');
    const marketValue = parseMoney(row[columnMap.marketValue]);
    const price       = columnMap.price ? parseMoney(row[columnMap.price]) : undefined;
    // The cash row's description column is a placeholder ('--'); use the label.
    const description = isCashRow
      ? opts!.cashRow!.label
      : columnMap.description ? row[columnMap.description]?.trim() : undefined;
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
