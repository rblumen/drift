// Fidelity positions-CSV adapter.
//
// How to export: Accounts & Trade → Portfolio → Download (CSV).
// The exported file begins directly with the column header on line 1 — no
// metadata preamble — followed by one row per position across ALL accounts
// visible in the current view (Account Number + Account Name columns identify
// each account).
//
// Single-account use: parseFidelityCsv(text, accountId) — same API as the
// Schwab/Empower adapters; all rows are assigned to the given accountId.
//
// Multi-account use: parseFidelityMultiCsv(text) — groups rows by Account
// Number and returns the discovered accounts so the caller can map each group
// to an app account ID before committing positions.
//
// Column names confirmed against the 2026-05 Fidelity export format.

import Papa from 'papaparse';
import { parseCsv, parseMoney } from '../csv';
import type { CsvParseResult, DiscoveredAccount, MultiAccountResult } from '../csv';
import { positionSchema } from '../schema';
import type { Position } from '../../engine/types';

// ── Footer stripping ──────────────────────────────────────────────────────────

/**
 * Fidelity exports append a multi-paragraph legal disclaimer after a blank
 * line that follows the last data row.  Slicing at the first double-newline
 * removes all of it before the CSV parser ever sees it.
 *
 * This function also normalises line endings, so callers don't need to.
 */
function stripFooter(text: string): string {
  const normalised = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blank = normalised.indexOf('\n\n');
  return blank >= 0 ? normalised.slice(0, blank) : normalised;
}

// ── Column name constants ─────────────────────────────────────────────────────

const COL = {
  accountNumber: 'Account Number',
  accountName:   'Account Name',
  ticker:        'Symbol',
  marketValue:   'Current Value',
  description:   'Description',
  price:         'Last Price',
  costBasis:     'Cost Basis Total',
} as const;

// ── Single-account adapter (backward-compatible) ──────────────────────────────

export function parseFidelityCsv(csvText: string, accountId: string): CsvParseResult {
  return parseCsv(stripFooter(csvText), accountId, {
    ticker:      COL.ticker,
    marketValue: COL.marketValue,
    description: COL.description,
    price:       COL.price,
    costBasis:   COL.costBasis,
  });
}

// ── Multi-account adapter ─────────────────────────────────────────────────────

// Fidelity reuses the shared multi-account shape. `positionsByNumber` keys are
// the raw Fidelity account numbers (e.g. "X12-345678"); each position's
// `accountId` is that number as a placeholder until the caller remaps it.
export type FidelityDiscoveredAccount = DiscoveredAccount;
export type FidelityMultiResult       = MultiAccountResult;

export function parseFidelityMultiCsv(csvText: string): FidelityMultiResult {
  const normalised = stripFooter(csvText);   // also normalises \r\n → \n

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(
    normalised, { header: true, skipEmptyLines: true },
  );

  const errors: string[] = parseErrors
    .filter(e => e.type !== 'FieldMismatch')
    .map(e => `CSV parse error: ${e.message}`);

  // Preserve account order of first appearance.
  const discoveredOrder: string[]           = [];
  const discoveredNames: Record<string, string>  = {};
  const positionsByNumber: Record<string, Position[]> = {};

  for (const [i, row] of data.entries()) {
    const accountNumber = row[COL.accountNumber]?.trim();
    const accountName   = row[COL.accountName]?.trim() ?? '';
    const ticker        = row[COL.ticker]?.trim().replace(/\*+$/, '');
    const marketValue   = parseMoney(row[COL.marketValue]);
    const price         = parseMoney(row[COL.price]);
    const description   = row[COL.description]?.trim();
    const costBasis     = parseMoney(row[COL.costBasis]);

    if (!accountNumber) continue;

    if (!positionsByNumber[accountNumber]) {
      discoveredOrder.push(accountNumber);
      discoveredNames[accountNumber] = accountName;
      positionsByNumber[accountNumber] = [];
    }

    // Same row filters as the generic parseCsv layer:
    // skip footer rows, pending activity, zero/negative values.
    if (
      !ticker || ticker === '--' || ticker.includes(' ') ||
      isNaN(marketValue) || marketValue <= 0
    ) continue;

    const result = positionSchema.safeParse({
      accountId: accountNumber,   // placeholder — remapped by caller
      ticker,
      description,
      marketValue,
      price: price && !isNaN(price) && price > 0 ? price : undefined,
      costBasis: !isNaN(costBasis) && costBasis >= 0 ? costBasis : undefined,
    });

    if (result.success) {
      positionsByNumber[accountNumber].push(result.data as Position);
    } else {
      errors.push(`Row ${i + 1} (${ticker ?? '?'}): ${result.error.message}`);
    }
  }

  const discovered = discoveredOrder.map(num => ({
    accountNumber: num,
    accountName:   discoveredNames[num],
  }));

  return { discovered, positionsByNumber, errors };
}
