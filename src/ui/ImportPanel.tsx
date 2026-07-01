import { useRef, useState, useEffect, type ReactNode } from 'react';
import type { Account, AssetClass, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { parseSchwabMultiCsv } from '../ingest/adapters/schwab';
import { parseFidelityMultiCsv } from '../ingest/adapters/fidelity';
import { parseVanguardMultiCsv } from '../ingest/adapters/vanguard';
import { parseMerrillMultiCsv } from '../ingest/adapters/merrill';
import { parseEtradeCsv } from '../ingest/adapters/etrade';
import { detectFormat } from '../ingest/detect';
import type { CsvParseResult, MultiAccountResult } from '../ingest/csv';
import { parseEmpowerCsv, parseEmpowerTotals } from '../ingest/adapters/empower';
import { AC_LABEL, ACCT_TYPE_COLOR, ACCT_TYPE_LABEL, fmtUsd } from './fmt';
import { PieChart } from './PieChart';
import { HelpBox, HelpDef, HelpSection } from './HelpBox';

// A broker CSV format. These are auto-detected from the file's contents
// (detectFormat) and can also be picked manually from the Format dropdown.
type FileFormat = 'schwab' | 'fidelity' | 'vanguard' | 'etrade' | 'merrill' | 'empower';

// How the user supplies positions: a broker file (the common path), Empower
// asset-class totals, or typing rows by hand. Chosen via the Source radio.
type InputMethod = 'file' | 'empower-totals' | 'manual';

interface Props {
  accounts: Account[];
  positions: Position[];
  setPositions: (p: Position[]) => void;
}

const FORMAT_META: { id: FileFormat; label: string; hint: string }[] = [
  { id: 'schwab',   label: 'Schwab',      hint: 'Accounts → Positions tab → Export (single account or All-Accounts)' },
  { id: 'fidelity', label: 'Fidelity',    hint: 'Accounts & Trade → Portfolio → Download (CSV)' },
  { id: 'vanguard', label: 'Vanguard',    hint: 'My Accounts → Transaction History → Download → CSV (brokerage holdings)' },
  { id: 'etrade',   label: 'E*TRADE',     hint: 'Portfolios → Positions tab → Download; choose Collapsed View + All Positions' },
  { id: 'merrill',  label: 'Merrill Edge',hint: 'Accounts → Holdings → expand lot detail → Export as .CSV' },
  { id: 'empower',  label: 'Empower',     hint: 'Copy your "My Investments" table and save as CSV' },
];

const METHOD_META: { id: InputMethod; label: string }[] = [
  { id: 'file',           label: 'Import from file' },
  { id: 'empower-totals', label: 'Empower totals' },
  { id: 'manual',         label: 'Manual entry' },
];

// Formats whose export can carry several accounts in one file — they share the
// discover-then-map flow. Each maps a file's text to a MultiAccountResult.
const MULTI_PARSERS: Partial<Record<FileFormat, (text: string) => MultiAccountResult>> = {
  schwab:   parseSchwabMultiCsv,
  fidelity: parseFidelityMultiCsv,
  vanguard: parseVanguardMultiCsv,
  merrill:  parseMerrillMultiCsv,
};

// Single-account CSV formats: text + accountId → positions.
const SINGLE_PARSERS: Partial<Record<FileFormat, (text: string, accountId: string) => CsvParseResult>> = {
  etrade:  parseEtradeCsv,
  empower: parseEmpowerCsv,
};

// Colours assigned round-robin to accounts in the order they appear.
const ACCOUNT_COLORS = [
  '#2e72b4', // brand-400
  '#38bdf8', // sky-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#2dd4bf', // teal-400
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Pre-upload guess of the file format from the account's institution name. This
 * just seeds the Format dropdown before a file is chosen; once a file is loaded,
 * detectFormat() reads the file's contents and overrides this. Unknown
 * institutions fall back to the first format (detection corrects it on upload).
 */
function defaultFormat(institution: string): FileFormat {
  const i = institution.toLowerCase();
  if (i.includes('schwab'))   return 'schwab';
  if (i.includes('fidelity')) return 'fidelity';
  if (i.includes('vanguard')) return 'vanguard';
  if (i.includes('etrade') || i.includes('e*trade') || i.includes('e-trade')) return 'etrade';
  if (i.includes('merrill'))  return 'merrill';
  if (i.includes('empower'))  return 'empower';
  return 'schwab';
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = e => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('File read failed'));
    reader.readAsText(file);
  });
}

function mergePositions(existing: Position[], incoming: Position[], accountId: string): Position[] {
  return [...existing.filter(p => p.accountId !== accountId), ...incoming];
}

// ── EditableCell ──────────────────────────────────────────────────────────────

interface EditableCellProps {
  value: string;
  onCommit: (newValue: string) => void;
  type?: 'text' | 'number';
  align?: 'left' | 'right';
  uppercase?: boolean;
  /** Formats `value` for display mode. */
  display?: (raw: string) => ReactNode;
  placeholder?: string;
  /** Extra classes for the display container. */
  className?: string;
}

function EditableCell({
  value, onCommit, type = 'text', align = 'left', uppercase, display, placeholder, className,
}: EditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  useEffect(() => { if (!editing) setDraft(value); }, [value, editing]);

  function commit() {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  }
  function cancel() {
    setEditing(false);
    setDraft(value);
  }

  const alignCls = align === 'right' ? 'text-right' : 'text-left';

  if (editing) {
    return (
      <input
        type={type}
        autoFocus
        value={draft}
        onChange={e => setDraft(e.target.value)}
        onFocus={e => e.target.select()}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
        }}
        placeholder={placeholder}
        className={`w-full bg-white border border-brand-300 rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-brand-400 ${uppercase ? 'uppercase' : ''} ${alignCls}`}
      />
    );
  }
  const rendered = display ? display(value) : (value || <span className="text-gray-300">{placeholder ?? '—'}</span>);
  return (
    <div
      onClick={() => setEditing(true)}
      title="Click to edit"
      className={`cursor-text hover:bg-brand-50 rounded px-1 -mx-1 ${alignCls} ${className ?? ''}`}
    >
      {rendered}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportPanel({ accounts, positions, setPositions }: Props) {
  const firstAccountId = accounts[0]?.id ?? '';
  const [accountId,     setAccountId]     = useState(firstAccountId);
  const [method,        setMethod]        = useState<InputMethod>('file');
  const [fileFormat,    setFileFormat]    = useState<FileFormat>(() => defaultFormat(accounts[0]?.institution ?? ''));
  // Whether the current fileFormat was set by content detection (vs. a guess or
  // a manual pick) — drives the "Auto-detected" badge.
  const [detected,      setDetected]      = useState(false);
  // Raw text + name of the loaded file, kept so changing the Format dropdown can
  // re-parse the same file without re-uploading.
  const [fileText,      setFileText]      = useState<string | null>(null);
  const [fileName,      setFileName]      = useState<string | null>(null);
  const [preview,       setPreview]       = useState<Position[] | null>(null);
  const [parseErrors,   setParseErrors]   = useState<string[]>([]);
  const [manualRow,     setManualRow]     = useState({ ticker: '', marketValue: '', price: '' });
  const [empowerTotals, setEmpowerTotals] = useState<Partial<Record<AssetClass, string>>>({});
  // Multi-account flow (Fidelity / Schwab / Vanguard / Merrill exports).
  const [multiAccount,  setMultiAccount]  = useState<MultiAccountResult | null>(null);
  const [accountMapping, setAccountMapping] = useState<Record<string, string>>({});
  // Set of account IDs whose position rows are collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  function toggleCollapsed(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Clear any in-progress import (preview, mapping, loaded file, errors).
  function resetImport() {
    setPreview(null);
    setParseErrors([]);
    setMultiAccount(null);
    setAccountMapping({});
    setFileText(null);
    setFileName(null);
    setDetected(false);
  }

  // When the user switches account, re-seed the format guess and clear any
  // in-progress import.
  useEffect(() => {
    const acct = accounts.find(a => a.id === accountId);
    if (acct) setFileFormat(defaultFormat(acct.institution));
    resetImport();
  }, [accountId]);

  // Keep accountId in sync if accounts list changes (e.g. first account added).
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
      setFileFormat(defaultFormat(accounts[0].institution));
    }
  }, [accounts]);

  // Parse already-read CSV text with a specific format and route the result:
  // multi-account formats discover-and-map (or preview directly when a single
  // account is found); single-account formats preview against the selected
  // account.
  function parseText(fmt: FileFormat, text: string) {
    const multiParser = MULTI_PARSERS[fmt];
    if (multiParser) {
      const multiResult = multiParser(text);
      setParseErrors(multiResult.errors);

      if (multiResult.discovered.length <= 1) {
        // Single account — assign all positions to the currently-selected account.
        const num = multiResult.discovered[0]?.accountNumber;
        const raw = num ? (multiResult.positionsByNumber[num] ?? []) : [];
        setPreview(raw.map(p => ({ ...p, accountId })));
        setMultiAccount(null);
      } else {
        // Multiple accounts — show the mapping step.
        // Auto-match by name similarity so common cases need no manual selection.
        const initMapping: Record<string, string> = {};
        for (const disc of multiResult.discovered) {
          const nameLower = disc.accountName.toLowerCase();
          const match = accounts.find(a =>
            a.name.toLowerCase().includes(nameLower) ||
            nameLower.includes(a.name.toLowerCase())
          );
          initMapping[disc.accountNumber] = match?.id ?? '';
        }
        setPreview(null);
        setMultiAccount(multiResult);
        setAccountMapping(initMapping);
      }
    } else {
      // Single-account CSV formats (E*TRADE, Empower).
      const singleParser = SINGLE_PARSERS[fmt] ?? parseEmpowerCsv;
      const result = singleParser(text, accountId);
      setParseErrors(result.errors);
      setMultiAccount(null);
      setPreview(result.positions);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await readFile(file);
    setFileText(text);
    setFileName(file.name);

    // Detect the format from the file's contents; fall back to the current
    // dropdown selection when nothing matches.
    const det = detectFormat(text);
    const fmt = det ?? fileFormat;
    setFileFormat(fmt);
    setDetected(det !== null);
    parseText(fmt, text);

    e.target.value = '';
  }

  // Manual Format override from the dropdown. Re-parses the loaded file (if any)
  // with the chosen format so a wrong auto-detection is one click to correct.
  function changeFormat(fmt: FileFormat) {
    setFileFormat(fmt);
    setDetected(false);
    if (fileText) {
      parseText(fmt, fileText);
    } else {
      setPreview(null);
      setParseErrors([]);
      setMultiAccount(null);
      setAccountMapping({});
    }
  }

  // Switch input method (file / Empower totals / manual), clearing any
  // in-progress file import.
  function changeMethod(m: InputMethod) {
    setMethod(m);
    resetImport();
  }

  function confirmImport() {
    if (!preview) return;
    setPositions(mergePositions(positions, preview, accountId));
    setPreview(null);
    setParseErrors([]);
  }

  function confirmMultiImport() {
    if (!multiAccount) return;
    let updated = positions;
    for (const disc of multiAccount.discovered) {
      const appId = accountMapping[disc.accountNumber];
      if (!appId) continue;
      const remapped = (multiAccount.positionsByNumber[disc.accountNumber] ?? [])
        .map(p => ({ ...p, accountId: appId }));
      updated = mergePositions(updated, remapped, appId);
    }
    setPositions(updated);
    setMultiAccount(null);
    setAccountMapping({});
    setParseErrors([]);
  }

  function addManualRow() {
    const mv = parseFloat(manualRow.marketValue);
    if (!manualRow.ticker.trim() || isNaN(mv) || mv < 0 || !accountId) return;
    const pos: Position = {
      accountId,
      ticker:      manualRow.ticker.trim().toUpperCase(),
      marketValue: mv,
      price:       manualRow.price ? parseFloat(manualRow.price) || undefined : undefined,
    };
    setPositions(mergePositions(positions, [
      ...positions.filter(p => p.accountId === accountId && p.ticker !== pos.ticker),
      pos,
    ], accountId));
    setManualRow({ ticker: '', marketValue: '', price: '' });
  }

  function loadEmpowerTotals() {
    if (!accountId) return;
    const numericTotals: Partial<Record<AssetClass, number>> = {};
    for (const ac of ALL_ASSET_CLASSES) {
      const v = parseFloat(empowerTotals[ac] ?? '');
      if (!isNaN(v) && v > 0) numericTotals[ac] = v;
    }
    const incoming = parseEmpowerTotals(accountId, numericTotals);
    setPositions(mergePositions(positions, incoming, accountId));
    setEmpowerTotals({});
  }

  // Update one position by its index in the master `positions` array.
  // `markEdited` is true for content edits (so the row gets a manual-edit indicator),
  // false for non-content toggles like lock/unlock.
  function updatePositionByIdx(idx: number, patch: Partial<Position>, markEdited: boolean) {
    setPositions(positions.map((p, i) =>
      i === idx ? { ...p, ...patch, ...(markEdited ? { edited: true } : {}) } : p
    ));
  }

  // Enrich groups with per-account totals and colour assignments. Carry the
  // original `positions` index so inline edits can identify the source row even
  // after its ticker has been renamed.
  const allGrouped = accounts
    .map((account, idx) => {
      const rows = positions
        .map((pos, posIdx) => ({ pos, posIdx }))
        .filter(({ pos }) => pos.accountId === account.id);
      const total = rows.reduce((s, { pos }) => s + pos.marketValue, 0);
      return { account, rows, total, color: ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length] };
    })
    .filter(g => g.rows.length > 0);

  const grandTotal = allGrouped.reduce((s, g) => s + g.total, 0);

  // Slices for the "by account type" pie — aggregate across accounts sharing the same type.
  const typeMap = new Map<string, number>();
  for (const g of allGrouped) {
    const t = g.account.type;
    typeMap.set(t, (typeMap.get(t) ?? 0) + g.total);
  }
  const typeSlices = [...typeMap.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, value]) => ({
      label: ACCT_TYPE_LABEL[type] ?? type,
      value,
      color: ACCT_TYPE_COLOR[type] ?? '#9ca3af',
    }));

  const formatHint = FORMAT_META.find(m => m.id === fileFormat)?.hint ?? '';

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Import Positions</h2>
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Add at least one account in the Accounts tab before importing positions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">Import Positions</h2>

      <HelpBox label="About importing positions">
        <p>
          Load the current market value of each holding. Positions replace any existing data for the
          selected account — re-importing an account always starts fresh for that account.
        </p>

        <HelpSection title="How importing works">
          <HelpDef term="Auto-detect">Choose <strong>Import from file</strong> and pick your broker's CSV export — the app reads the file and selects the matching format automatically. If it can't tell, set the format yourself from the dropdown below the file picker. Supported: Schwab, Fidelity, Vanguard, E*TRADE, Merrill Edge, and Empower.</HelpDef>
          <HelpDef term="Multiple accounts in one file">Schwab, Fidelity, Vanguard, and Merrill exports may contain several accounts. The app detects each one and lets you map it to a registered account. (Vanguard's file has no account-name column, so its accounts appear by number.) E*TRADE and Empower export one account per file.</HelpDef>
          <HelpDef term="Where to export">Schwab: Accounts → Positions → Export. Fidelity: Accounts &amp; Trade → Portfolio → Download. Vanguard: My Accounts → Transaction History → Download (use the brokerage holdings CSV, which includes tickers). E*TRADE: Portfolios → Positions → Download (Collapsed View, All Positions). Merrill: Accounts → Holdings → expand lot detail → Export as .CSV.</HelpDef>
          <HelpDef term="Empower totals">If you only have asset-class totals (not individual funds), choose <strong>Empower totals</strong> and enter dollar amounts per class. Trade recommendations will be at the asset-class level only.</HelpDef>
          <HelpDef term="Manual entry">Choose <strong>Manual entry</strong> to type ticker + market value directly — for any position a CSV doesn't cover, or a one-off holding.</HelpDef>
        </HelpSection>

        <HelpSection title="Tips">
          <HelpDef term="Price (optional)">Supplying a share price is not required. If present, the Results tab shows share counts alongside dollar amounts.</HelpDef>
          <HelpDef term="Locked positions">Click the 🔓 icon on any position row to freeze it. Locked positions count in totals and weights but are excluded from trades — useful for employer stock units or other positions you can't freely sell.</HelpDef>
          <HelpDef term="Unmapped tickers">If an imported ticker isn't in the built-in classification map, it will appear in the Classify tab with an amber badge. Resolve it there before running the final rebalance.</HelpDef>
        </HelpSection>
      </HelpBox>

      {/* Step 1 — Pick account + source */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        <div className="px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 w-28 shrink-0">Account</span>
          <div className="flex flex-wrap gap-2">
            {accounts.map(a => (
              <button
                key={a.id}
                onClick={() => setAccountId(a.id)}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors
                  ${accountId === a.id
                    ? 'bg-brand-600 text-white border-brand-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-brand-400'}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 w-28 shrink-0">Source</span>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {METHOD_META.map(m => (
              <label key={m.id} className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="import-method"
                  checked={method === m.id}
                  onChange={() => changeMethod(m.id)}
                  className="accent-brand-600"
                />
                {m.label}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Step 2 — File import: choose file, then (auto-detected) format below */}
      {method === 'file' && (
        <div className="space-y-3">
          {!preview && !multiAccount && (
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center space-y-3">
              <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
              <button
                onClick={() => fileRef.current?.click()}
                className="bg-white border border-gray-300 text-gray-700 text-sm px-4 py-2 rounded-md hover:bg-gray-50"
              >
                Choose CSV file
              </button>
              <p className="text-xs text-gray-400">
                {fileName ? `Loaded ${fileName}` : "We'll detect the format automatically."}
              </p>
            </div>
          )}

          {/* Format dropdown — auto-filled on detection, overridable here. */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700">Format</span>
            <select
              value={fileFormat}
              onChange={e => changeFormat(e.target.value as FileFormat)}
              className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white"
            >
              {FORMAT_META.map(f => (
                <option key={f.id} value={f.id}>{f.label}</option>
              ))}
            </select>
            {detected && (
              <span className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                Auto-detected
              </span>
            )}
            <span className="text-xs text-gray-400">{formatHint}</span>
          </div>
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 space-y-1">
          {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Multi-account mapping step (Fidelity / Schwab all-accounts) */}
      {multiAccount && (
        <div className="border border-brand-200 rounded-lg p-4 space-y-4 bg-brand-50">
          <div>
            <h3 className="text-sm font-semibold text-brand-800">
              Map imported accounts → your accounts
            </h3>
            <p className="text-xs text-brand-600 mt-0.5">
              {multiAccount.discovered.length} accounts found in the file. Route each one to an account you've added, or skip it.
            </p>
          </div>
          <div className="space-y-2">
            {multiAccount.discovered.map(disc => {
              const posCount = multiAccount.positionsByNumber[disc.accountNumber]?.length ?? 0;
              return (
                <div key={disc.accountNumber} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-gray-800 truncate">{disc.accountName}</div>
                    <div className="text-xs text-gray-500">
                      {disc.accountNumber} · {posCount} position{posCount !== 1 ? 's' : ''}
                    </div>
                  </div>
                  <span className="text-gray-400 text-sm shrink-0">→</span>
                  <select
                    value={accountMapping[disc.accountNumber] ?? ''}
                    onChange={e => setAccountMapping({ ...accountMapping, [disc.accountNumber]: e.target.value })}
                    className="border border-gray-300 rounded px-2 py-1.5 text-sm bg-white min-w-44"
                  >
                    <option value="">— skip —</option>
                    {accounts.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmMultiImport}
              disabled={!multiAccount.discovered.some(d => accountMapping[d.accountNumber])}
              className="bg-brand-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-brand-700 disabled:opacity-40"
            >
              Confirm import
            </button>
            <button
              onClick={() => { setMultiAccount(null); setAccountMapping({}); setParseErrors([]); }}
              className="text-gray-500 text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {preview && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-gray-700">
            Preview — {preview.length} position{preview.length !== 1 ? 's' : ''} parsed
          </h3>
          <div className="overflow-hidden border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-3 py-2 text-left">Ticker</th>
                  <th className="px-3 py-2 text-left">Description</th>
                  <th className="px-3 py-2 text-right">Market Value</th>
                  <th className="px-3 py-2 text-right">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.map((p, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-mono font-medium">{p.ticker}</td>
                    <td className="px-3 py-2 text-gray-500 truncate max-w-xs">{p.description ?? '—'}</td>
                    <td className="px-3 py-2 text-right">{fmtUsd(p.marketValue)}</td>
                    <td className="px-3 py-2 text-right text-gray-500">
                      {p.price ? `$${p.price.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex gap-2">
            <button
              onClick={confirmImport}
              className="bg-brand-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-brand-700"
            >
              Confirm import
            </button>
            <button
              onClick={() => { setPreview(null); setParseErrors([]); }}
              className="text-gray-500 text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {method === 'empower-totals' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-500">Enter dollar totals per asset class from Empower's Investments → Holdings → Allocation view.</p>
          <div className="grid grid-cols-2 gap-3">
            {ALL_ASSET_CLASSES.map(ac => (
              <div key={ac}>
                <label className="block text-xs text-gray-500 mb-1">{AC_LABEL[ac]}</label>
                <input
                  type="number"
                  value={empowerTotals[ac] ?? ''}
                  onChange={e => setEmpowerTotals({ ...empowerTotals, [ac]: e.target.value })}
                  placeholder="$0"
                  className="w-full border rounded px-2 py-1.5 text-sm text-right"
                />
              </div>
            ))}
          </div>
          <button
            onClick={loadEmpowerTotals}
            className="bg-brand-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-brand-700"
          >
            Load totals
          </button>
        </div>
      )}

      {method === 'manual' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <div className="flex gap-2 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Ticker</label>
              <input
                value={manualRow.ticker}
                onChange={e => setManualRow({ ...manualRow, ticker: e.target.value })}
                placeholder="VTI"
                className="w-24 border rounded px-2 py-1.5 text-sm font-mono uppercase"
                onKeyDown={e => e.key === 'Enter' && addManualRow()}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Market value ($)</label>
              <input
                type="number"
                value={manualRow.marketValue}
                onChange={e => setManualRow({ ...manualRow, marketValue: e.target.value })}
                placeholder="10000"
                className="w-32 border rounded px-2 py-1.5 text-sm text-right"
                onKeyDown={e => e.key === 'Enter' && addManualRow()}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Price (optional)</label>
              <input
                type="number"
                value={manualRow.price}
                onChange={e => setManualRow({ ...manualRow, price: e.target.value })}
                placeholder="240.50"
                className="w-28 border rounded px-2 py-1.5 text-sm text-right"
                onKeyDown={e => e.key === 'Enter' && addManualRow()}
              />
            </div>
            <button
              onClick={addManualRow}
              disabled={!manualRow.ticker.trim() || !manualRow.marketValue}
              className="bg-brand-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-brand-700 disabled:opacity-40"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* Loaded positions — pie chart + collapsible account tables */}
      {allGrouped.length > 0 && (
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-medium text-gray-700 border-t pt-4">Loaded positions</h3>

          {/* Pie charts: by account and by account type */}
          <div className="grid grid-cols-2 gap-4">
            <div className="border border-gray-200 rounded-lg p-4">
              <PieChart
                title="By account"
                slices={allGrouped.map(g => ({ label: g.account.name, value: g.total, color: g.color }))}
              />
            </div>
            <div className="border border-gray-200 rounded-lg p-4">
              <PieChart
                title="By account type"
                slices={typeSlices}
              />
            </div>
          </div>

          {/* Per-account collapsible tables */}
          {allGrouped.map(({ account, rows, total, color }) => {
            const pct = grandTotal > 0 ? (total / grandTotal) * 100 : 0;
            const isOpen = !collapsed.has(account.id);
            return (
              <div key={account.id} className="overflow-hidden border border-gray-200 rounded-lg">
                {/* Header row — clickable to collapse */}
                <button
                  className="w-full px-4 py-2.5 bg-gray-50 flex items-center gap-3 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => toggleCollapsed(account.id)}
                >
                  {/* Colour swatch */}
                  <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: color }} />

                  {/* Name */}
                  <span className="text-sm font-medium text-gray-700 flex-1">{account.name}</span>

                  {/* Totals */}
                  <span className="text-sm text-gray-600 tabular-nums">{fmtUsd(total)}</span>
                  <span className="text-xs text-gray-400 tabular-nums w-12 text-right">
                    {pct.toFixed(1)}%
                  </span>

                  {/* Chevron */}
                  <span className="text-gray-400 text-xs ml-1">{isOpen ? '▾' : '▸'}</span>

                  {/* Clear button — stop propagation so it doesn't toggle collapse */}
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={e => { e.stopPropagation(); setPositions(positions.filter(p => p.accountId !== account.id)); }}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); setPositions(positions.filter(p => p.accountId !== account.id)); } }}
                    className="text-xs text-red-400 hover:underline ml-2 cursor-pointer"
                  >
                    Clear
                  </span>
                </button>

                {/* Position rows — hidden when collapsed */}
                {isOpen && (
                  <table className="w-full text-sm">
                    <tbody className="divide-y divide-gray-100">
                      {rows.map(({ pos: p, posIdx }) => (
                        <tr key={posIdx} className={`hover:bg-gray-50 ${p.locked ? 'opacity-60' : ''}`}>
                          {/* Edited indicator */}
                          <td className="pl-3 pr-0 py-2 w-4 text-amber-500 text-xs">
                            {p.edited && <span title="Manually edited">✎</span>}
                          </td>
                          {/* Ticker */}
                          <td className="px-2 py-2 font-mono font-medium w-28">
                            <EditableCell
                              value={p.ticker}
                              uppercase
                              onCommit={v => {
                                const next = v.trim().toUpperCase();
                                if (!next) return;
                                updatePositionByIdx(posIdx, { ticker: next }, true);
                              }}
                            />
                          </td>
                          {/* Description */}
                          <td className="px-2 py-2 text-gray-500 max-w-xs">
                            <EditableCell
                              value={p.description ?? ''}
                              onCommit={v => {
                                const next = v.trim();
                                updatePositionByIdx(posIdx, { description: next || undefined }, true);
                              }}
                            />
                          </td>
                          {/* Market value */}
                          <td className="px-2 py-2 text-right tabular-nums">
                            <EditableCell
                              value={String(p.marketValue)}
                              type="number"
                              align="right"
                              display={v => {
                                const n = parseFloat(v);
                                return isNaN(n) ? '—' : fmtUsd(n);
                              }}
                              onCommit={v => {
                                const n = parseFloat(v);
                                if (isNaN(n) || n < 0) return;
                                updatePositionByIdx(posIdx, { marketValue: n }, true);
                              }}
                            />
                          </td>
                          {/* Price (optional) */}
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500 w-24">
                            <EditableCell
                              value={p.price != null ? String(p.price) : ''}
                              type="number"
                              align="right"
                              display={v => {
                                if (!v) return <span className="text-gray-300">—</span>;
                                const n = parseFloat(v);
                                return isNaN(n) ? '—' : `$${n.toFixed(2)}`;
                              }}
                              onCommit={v => {
                                const trimmed = v.trim();
                                if (!trimmed) {
                                  updatePositionByIdx(posIdx, { price: undefined }, true);
                                  return;
                                }
                                const n = parseFloat(trimmed);
                                if (isNaN(n) || n <= 0) return;
                                updatePositionByIdx(posIdx, { price: n }, true);
                              }}
                            />
                          </td>
                          {/* Cost basis (taxable accounts only — feeds tax-adjusted allocation, issue #7) */}
                          <td className="px-2 py-2 text-right tabular-nums text-gray-500 w-28">
                            {account.type === 'TAXABLE' ? (
                              <EditableCell
                                value={p.costBasis != null ? String(p.costBasis) : ''}
                                type="number"
                                align="right"
                                display={v => {
                                  if (!v) return <span className="text-gray-300" title="Cost basis (taxable only) — fills tax-adjusted allocation">—</span>;
                                  const n = parseFloat(v);
                                  return isNaN(n) ? '—' : fmtUsd(n);
                                }}
                                onCommit={v => {
                                  const trimmed = v.trim();
                                  if (!trimmed) {
                                    updatePositionByIdx(posIdx, { costBasis: undefined }, true);
                                    return;
                                  }
                                  const n = parseFloat(trimmed);
                                  if (isNaN(n) || n < 0) return;
                                  updatePositionByIdx(posIdx, { costBasis: n }, true);
                                }}
                              />
                            ) : (
                              <span className="text-gray-200">—</span>
                            )}
                          </td>
                          {/* Lock toggle */}
                          <td className="px-2 py-2 text-center w-8">
                            <button
                              onClick={() => updatePositionByIdx(posIdx, { locked: !p.locked }, false)}
                              title={p.locked ? 'Unlock position (allow trades)' : 'Lock position (exclude from trades)'}
                              className={`text-sm transition-colors ${p.locked ? 'text-amber-500 hover:text-gray-400' : 'text-gray-300 hover:text-amber-500'}`}
                            >
                              {p.locked ? '🔒' : '🔓'}
                            </button>
                          </td>
                          {/* Remove */}
                          <td className="px-3 py-2 text-right w-8">
                            <button
                              onClick={() => setPositions(positions.filter((_, idx) => idx !== posIdx))}
                              className="text-gray-300 hover:text-red-400 text-xs"
                              title="Remove"
                            >✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
