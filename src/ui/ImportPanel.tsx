import { useRef, useState, useEffect } from 'react';
import type { Account, AssetClass, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { parseSchwabCsv } from '../ingest/adapters/schwab';
import { parseFidelityCsv } from '../ingest/adapters/fidelity';
import { parseEmpowerCsv, parseEmpowerTotals } from '../ingest/adapters/empower';
import { AC_LABEL, fmtUsd } from './fmt';

type Adapter = 'schwab' | 'fidelity' | 'empower' | 'empower-totals' | 'manual';

interface Props {
  accounts: Account[];
  positions: Position[];
  setPositions: (p: Position[]) => void;
}

const ADAPTER_META: { id: Adapter; label: string; hint: string }[] = [
  { id: 'schwab',        label: 'Schwab CSV',      hint: 'Accounts → Positions tab → Export' },
  { id: 'fidelity',      label: 'Fidelity CSV',     hint: 'Accounts & Trade → Portfolio → Download (CSV)' },
  { id: 'empower',       label: 'Empower CSV',      hint: 'Copy your "My Investments" table and save as CSV' },
  { id: 'empower-totals',label: 'Empower Totals',   hint: 'Enter dollar totals from the Investments → Holdings → Allocation view' },
  { id: 'manual',        label: 'Manual entry',     hint: 'Type positions in by hand' },
];

// Colours assigned round-robin to accounts in the order they appear.
const ACCOUNT_COLORS = [
  '#818cf8', // indigo-400
  '#38bdf8', // sky-400
  '#34d399', // emerald-400
  '#fbbf24', // amber-400
  '#f87171', // red-400
  '#a78bfa', // violet-400
  '#fb923c', // orange-400
  '#2dd4bf', // teal-400
];

// ── Pie chart ─────────────────────────────────────────────────────────────────

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  // Full circle needs special treatment (can't draw A from point back to itself).
  if (end - start >= 359.9999) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
  }
  const s = polarXY(cx, cy, r, start);
  const e = polarXY(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x} ${s.y} A ${r} ${r} 0 ${large} 1 ${e.x} ${e.y} Z`;
}

interface PieSlice { label: string; value: number; color: string }

function AccountPieChart({ slices }: { slices: PieSlice[] }) {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return null;

  const cx = 64, cy = 64, r = 56;
  let cursor = 0;

  return (
    <div className="border border-gray-200 rounded-lg p-4 flex items-center gap-8">
      <svg width={128} height={128} className="shrink-0">
        {slices.map((sl, i) => {
          const deg = (sl.value / total) * 360;
          const path = slicePath(cx, cy, r, cursor, cursor + deg);
          cursor += deg;
          return (
            <path key={i} d={path} fill={sl.color} stroke="white" strokeWidth={2}>
              <title>{sl.label}: {fmtUsd(sl.value)} ({((sl.value / total) * 100).toFixed(1)}%)</title>
            </path>
          );
        })}
      </svg>
      <div className="space-y-2 min-w-0">
        {slices.map((sl, i) => (
          <div key={i} className="flex items-center gap-2 text-sm min-w-0">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: sl.color }} />
            <span className="text-gray-700 truncate">{sl.label}</span>
            <span className="ml-auto pl-4 text-gray-500 tabular-nums shrink-0">{fmtUsd(sl.value)}</span>
            <span className="text-gray-400 tabular-nums text-xs shrink-0 w-12 text-right">
              {((sl.value / total) * 100).toFixed(1)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Guess the best adapter from the account's institution name. */
function defaultAdapter(institution: string): Adapter {
  const i = institution.toLowerCase();
  if (i.includes('schwab'))   return 'schwab';
  if (i.includes('fidelity')) return 'fidelity';
  if (i.includes('empower'))  return 'empower';
  return 'manual';
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

// ── Component ─────────────────────────────────────────────────────────────────

export function ImportPanel({ accounts, positions, setPositions }: Props) {
  const firstAccountId = accounts[0]?.id ?? '';
  const [accountId,     setAccountId]     = useState(firstAccountId);
  const [adapter,       setAdapter]       = useState<Adapter>(() => defaultAdapter(accounts[0]?.institution ?? ''));
  const [preview,       setPreview]       = useState<Position[] | null>(null);
  const [parseErrors,   setParseErrors]   = useState<string[]>([]);
  const [manualRow,     setManualRow]     = useState({ ticker: '', marketValue: '', price: '' });
  const [empowerTotals, setEmpowerTotals] = useState<Partial<Record<AssetClass, string>>>({});
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

  // When the user switches account, reset adapter to match the new institution.
  useEffect(() => {
    const acct = accounts.find(a => a.id === accountId);
    if (acct) setAdapter(defaultAdapter(acct.institution));
    setPreview(null);
    setParseErrors([]);
  }, [accountId]);

  // Keep accountId in sync if accounts list changes (e.g. first account added).
  useEffect(() => {
    if (!accountId && accounts.length > 0) {
      setAccountId(accounts[0].id);
      setAdapter(defaultAdapter(accounts[0].institution));
    }
  }, [accounts]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !accountId) return;
    const text = await readFile(file);
    let result;
    if (adapter === 'schwab')        result = parseSchwabCsv(text, accountId);
    else if (adapter === 'fidelity') result = parseFidelityCsv(text, accountId);
    else                             result = parseEmpowerCsv(text, accountId);
    setParseErrors(result.errors);
    setPreview(result.positions);
    e.target.value = '';
  }

  function confirmImport() {
    if (!preview) return;
    setPositions(mergePositions(positions, preview, accountId));
    setPreview(null);
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

  // Enrich groups with per-account totals and colour assignments.
  const allGrouped = accounts
    .map((account, idx) => {
      const rows  = positions.filter(p => p.accountId === account.id);
      const total = rows.reduce((s, p) => s + p.marketValue, 0);
      return { account, rows, total, color: ACCOUNT_COLORS[idx % ACCOUNT_COLORS.length] };
    })
    .filter(g => g.rows.length > 0);

  const grandTotal = allGrouped.reduce((s, g) => s + g.total, 0);

  const isCsvAdapter = adapter === 'schwab' || adapter === 'fidelity' || adapter === 'empower';
  const adapterHint  = ADAPTER_META.find(m => m.id === adapter)?.hint ?? '';

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

      {/* Step 1 — Pick account + format */}
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
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}
              >
                {a.name}
              </button>
            ))}
          </div>
        </div>

        <div className="px-4 py-3 flex items-center gap-4">
          <span className="text-sm font-medium text-gray-700 w-28 shrink-0">Format</span>
          <div className="flex flex-wrap gap-2">
            {ADAPTER_META.map(m => (
              <button
                key={m.id}
                onClick={() => { setAdapter(m.id); setPreview(null); setParseErrors([]); }}
                className={`px-3 py-1.5 text-sm rounded-md border transition-colors
                  ${adapter === m.id
                    ? 'bg-indigo-600 text-white border-indigo-600'
                    : 'bg-white text-gray-600 border-gray-300 hover:border-indigo-400'}`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Step 2 — Import widget */}

      {isCsvAdapter && !preview && (
        <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center space-y-3">
          <p className="text-sm text-gray-500">{adapterHint}</p>
          <input ref={fileRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
          <button
            onClick={() => fileRef.current?.click()}
            className="bg-white border border-gray-300 text-gray-700 text-sm px-4 py-2 rounded-md hover:bg-gray-50"
          >
            Choose CSV file
          </button>
        </div>
      )}

      {parseErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 space-y-1">
          {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
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
              className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-indigo-700"
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

      {adapter === 'empower-totals' && (
        <div className="border border-gray-200 rounded-lg p-4 space-y-3">
          <p className="text-sm text-gray-500">{adapterHint}</p>
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
            className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-indigo-700"
          >
            Load totals
          </button>
        </div>
      )}

      {adapter === 'manual' && (
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
              className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-40"
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

          {/* Pie chart summary */}
          <AccountPieChart
            slices={allGrouped.map(g => ({ label: g.account.name, value: g.total, color: g.color }))}
          />

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
                      {rows.map((p, i) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-4 py-2 font-mono font-medium w-24">{p.ticker}</td>
                          <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{p.description ?? ''}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{fmtUsd(p.marketValue)}</td>
                          <td className="px-4 py-2 text-right w-8">
                            <button
                              onClick={() => setPositions(positions.filter(x => !(x.accountId === p.accountId && x.ticker === p.ticker)))}
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
