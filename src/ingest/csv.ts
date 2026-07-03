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
// Also treats a fully parenthesized amount as negative — the accounting-style
// convention some broker exports use for negative/pending amounts, e.g.
// "(1,234.56)", "($1,234.56)", "$(1,234.56)" (issue #129). A trimmed value
// wrapped in a single balanced pair of parens has its parens stripped and the
// result negated; anything else (including unbalanced parens) falls through
// to parseFloat unchanged and fails the same way it always has.
export function parseMoney(raw: string | undefined): number {
  if (!raw) return NaN;
  const trimmed = raw.trim();
  const parenMatch = /^\$?\((.*)\)$/.exec(trimmed);
  if (parenMatch) {
    const inner = parenMatch[1].replace(/[$,\s]/g, '');
    if (inner === '' || !/^\d*\.?\d*$/.test(inner)) return NaN;
    const value = parseFloat(inner);
    return isNaN(value) ? NaN : -value;
  }
  return parseFloat(trimmed.replace(/[$,\s]/g, ''));
}

// Shared row options applied by both the single-account (parseCsv) and the
// multi-account (parseCsvMultiByAccount) paths so every adapter filters and
// re-labels rows identically.
interface RowOpts {
  // A broker's swept free-cash line (e.g. Schwab's "Cash & Cash Investments",
  // E*TRADE's "CASH") carries a real balance but its ticker column isn't a
  // tradable symbol. When a row's ticker equals cashRow.label, re-label it to
  // cashRow.ticker — a synthetic symbol that classifies as CASH (#54).
  cashRow?: { label: string; ticker: string };
  // Tickers to drop outright — for broker subtotal/footer rows whose symbol is
  // space-free and so survives the generic filter (e.g. E*TRADE's "TOTAL").
  dropTickers?: string[];
}

// Outcome of building one Position from a CSV row:
//   null            → row filtered out (footer/subtotal/zero/placeholder)
//   { ok: true }    → a valid Position
//   { ok: false }   → schema rejected the row; carries ticker + error for surfacing
type BuildResult =
  | null
  | { ok: true; position: Position }
  | { ok: false; ticker: string; error: string };

// Map one parsed CSV row to a Position, applying the shared cash re-label,
// footnote-strip, drop-list, and subtotal/footer filters. Used by both parse
// paths so their row handling can never drift apart.
function buildPosition(
  row: Record<string, string>,
  columnMap: ColumnMap,
  accountId: string,
  opts?: RowOpts,
): BuildResult {
  const rawTicker = row[columnMap.ticker]?.trim();
  // Swept free-cash row: re-label to the synthetic CASH ticker (#54).
  const isCashRow = !!opts?.cashRow && rawTicker === opts.cashRow.label;
  // Strip broker footnote markers (e.g. "FDRXX**" → "FDRXX").
  const ticker      = isCashRow ? opts!.cashRow!.ticker : rawTicker?.replace(/\*+$/, '');
  const marketValue = parseMoney(row[columnMap.marketValue]);
  const price       = columnMap.price ? parseMoney(row[columnMap.price]) : undefined;
  // The cash row's description column is often a placeholder ('--'); use the label.
  const description = isCashRow
    ? opts!.cashRow!.label
    : columnMap.description ? row[columnMap.description]?.trim() : undefined;
  const costBasis   = columnMap.costBasis ? parseMoney(row[columnMap.costBasis]) : undefined;

  // Skip subtotal/footer rows: no ticker, placeholder '--', an explicit
  // drop-listed symbol (e.g. "TOTAL"), NaN value, $0 or negative (pending
  // activity), or a ticker that contains a space (e.g. "Account Total").
  // Real fund tickers are always space-free alphanumeric symbols.
  if (
    !ticker || ticker === '--' || ticker.includes(' ') ||
    opts?.dropTickers?.some(t => t.toUpperCase() === ticker.toUpperCase()) ||
    isNaN(marketValue) || marketValue <= 0
  ) return null;

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

  return result.success
    ? { ok: true, position: result.data as Position }
    : { ok: false, ticker, error: result.error.message };
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
  opts?: { skipRows?: number } & RowOpts,
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
    const built = buildPosition(row, columnMap, accountId, opts);
    if (built === null) continue;
    if (built.ok) positions.push(built.position);
    else errors.push(`Row ${i + 1} (${built.ticker}): ${built.error}`);
  }

  return { positions, errors };
}

// ── Multi-account: group by a per-row account column ─────────────────────────
// For exports that carry every account in one file with an account-identifier
// column on each row (Fidelity's "Account Number", Vanguard's "Account Number",
// Merrill's "Account #"). Rows are grouped by that column and returned as a
// MultiAccountResult so the caller can map each discovered account to a real
// app account ID. (Schwab's all-accounts export uses repeating section blocks
// instead, so it has its own adapter logic.)

export interface MultiColumnMap extends ColumnMap {
  accountNumber: string;   // CSV column identifying the account on every row
  accountName?:  string;   // optional CSV column with a human-readable name
}

export function parseCsvMultiByAccount(
  csvText: string,
  columns: MultiColumnMap,
  opts?: { preprocess?: (text: string) => string } & RowOpts,
): MultiAccountResult {
  const pre = opts?.preprocess ?? ((t: string) => t.replace(/\r\n/g, '\n').replace(/\r/g, '\n'));
  const normalised = pre(csvText);

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(
    normalised, { header: true, skipEmptyLines: true },
  );

  const errors: string[] = parseErrors
    .filter(e => e.type !== 'FieldMismatch')
    .map(e => `CSV parse error: ${e.message}`);

  // Preserve account order of first appearance.
  const discoveredOrder: string[]                = [];
  const discoveredNames: Record<string, string>  = {};
  const positionsByNumber: Record<string, Position[]> = {};

  for (const [i, row] of data.entries()) {
    const accountNumber = row[columns.accountNumber]?.trim();
    if (!accountNumber) continue;
    // Fall back to the account number when a name column is absent/blank
    // (e.g. Vanguard's holdings CSV has no account-name column).
    const accountName =
      (columns.accountName ? row[columns.accountName]?.trim() : '') || accountNumber;

    if (!positionsByNumber[accountNumber]) {
      discoveredOrder.push(accountNumber);
      discoveredNames[accountNumber] = accountName;
      positionsByNumber[accountNumber] = [];
    }

    const built = buildPosition(row, columns, accountNumber, opts);
    if (built === null) continue;
    if (built.ok) positionsByNumber[accountNumber].push(built.position);
    else errors.push(`Row ${i + 1} (${built.ticker}): ${built.error}`);
  }

  const discovered = discoveredOrder.map(num => ({
    accountNumber: num,
    accountName:   discoveredNames[num],
  }));

  return { discovered, positionsByNumber, errors };
}
