// Schwab positions-CSV adapter — two ingest paths:
//
// 1. parseSchwabCsv      — a single-account "Positions" export.
//    How to export: Accounts → Positions tab → Export (top-right link).
//    The file has one metadata row (the "Positions for account …" timestamp
//    line) followed by an empty line, then the column header. skipRows=1 drops
//    the metadata line; papaparse's skipEmptyLines handles the blank gap.
//
// 2. parseSchwabMultiCsv — an "All-Accounts" export covering several accounts.
//    How to export: same Export link while viewing All-Accounts. The file is a
//    series of section blocks: an account-label line, the column header, the
//    account's position rows, then a "Positions Total" row, separated by blank
//    lines. Each block is parsed independently and the discovered accounts are
//    returned so the caller can map them to app account IDs (mirrors the
//    Fidelity multi-account flow).
//
// Column names confirmed against the 2026-05/06 Schwab export format.
// If Schwab changes their export, adjust SCHWAB_COLUMNS and SCHWAB_SKIP_ROWS.
import { parseCsv, type CsvParseResult, type MultiAccountResult } from '../csv';

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
const SCHWAB_CASH = { label: 'Cash & Cash Investments', ticker: 'SCHWAB_CASH' } as const;

export function parseSchwabCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(csvText, accountId, SCHWAB_COLUMNS, {
    skipRows: SCHWAB_SKIP_ROWS,
    cashRow:  SCHWAB_CASH,
  });
}

// ── Multi-account adapter ─────────────────────────────────────────────────────

// The column header that begins every account section.
const HEADER_PREFIX = '"Symbol"';

/**
 * Derive a display name and masked account number from a Schwab section label.
 *
 * All-accounts blocks are labelled like `Roth_Contributory_IRA ...001`
 * (underscores for spaces, a masked `...NNN` suffix). A single-account export
 * has no per-section label, so the metadata line `Positions for account NAME
 * as of DATE` is used instead.
 */
function parseSchwabLabel(label: string): { accountName: string; accountNumber: string } {
  let s = label.replace(/^"+|"+$/g, '').trim();
  const meta = s.match(/Positions for account (.+?) as of/i);
  if (meta) s = meta[1].trim();

  // Split a trailing masked-number suffix ("...001" / "…985") from the name.
  const m = s.match(/^(.*?)\s*((?:\.{2,}|…)\S+)\s*$/);
  if (m) return { accountName: m[1].replace(/_/g, ' ').trim(), accountNumber: m[2] };
  const name = s.replace(/_/g, ' ').trim();
  return { accountName: name, accountNumber: name };
}

/**
 * Parse a Schwab export that may contain multiple account sections.
 *
 * Sections are anchored on the repeating column-header row; each section's
 * label is the nearest non-blank line above its header. A single-account
 * export (one header, preceded only by the metadata line) yields one
 * discovered account, so this function also handles the single-account file.
 */
export function parseSchwabMultiCsv(csvText: string): MultiAccountResult {
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  const headerIdxs = lines
    .map((l, i) => (l.trim().startsWith(HEADER_PREFIX) ? i : -1))
    .filter(i => i >= 0);

  const discovered: MultiAccountResult['discovered'] = [];
  const positionsByNumber: MultiAccountResult['positionsByNumber'] = {};
  const errors: string[] = [];

  for (let h = 0; h < headerIdxs.length; h++) {
    const headerIdx = headerIdxs[h];

    // Label = nearest non-blank line above the header.
    let rawLabel = '';
    for (let j = headerIdx - 1; j >= 0; j--) {
      const t = lines[j].trim();
      if (t) { rawLabel = t; break; }
    }
    const { accountName, accountNumber: baseNumber } = parseSchwabLabel(rawLabel);

    // Disambiguate if two sections resolve to the same masked number.
    let accountNumber = baseNumber;
    for (let n = 2; positionsByNumber[accountNumber] !== undefined; n++) {
      accountNumber = `${baseNumber} (${n})`;
    }

    // Section body runs from the header to the line before the next header.
    const end = h + 1 < headerIdxs.length ? headerIdxs[h + 1] : lines.length;
    const block = lines.slice(headerIdx, end).join('\n');

    // skipRows defaults to 0 — the block already starts at the header.
    const { positions, errors: blockErrors } =
      parseSchwabSection(block, accountNumber);

    discovered.push({ accountNumber, accountName });
    positionsByNumber[accountNumber] = positions;
    errors.push(...blockErrors);
  }

  return { discovered, positionsByNumber, errors };
}

// A single section block already begins at the column header, so no metadata
// rows are skipped (unlike the full single-account export).
function parseSchwabSection(block: string, accountId: string): CsvParseResult {
  return parseCsv(block, accountId, SCHWAB_COLUMNS, { cashRow: SCHWAB_CASH });
}
