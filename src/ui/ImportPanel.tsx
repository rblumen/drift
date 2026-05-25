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

export function ImportPanel({ accounts, positions, setPositions }: Props) {
  const firstAccountId = accounts[0]?.id ?? '';
  const [accountId, setAccountId]     = useState(firstAccountId);
  const [adapter,   setAdapter]       = useState<Adapter>(() => defaultAdapter(accounts[0]?.institution ?? ''));
  const [preview,   setPreview]       = useState<Position[] | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [manualRow, setManualRow]     = useState({ ticker: '', marketValue: '', price: '' });
  const [empowerTotals, setEmpowerTotals] = useState<Partial<Record<AssetClass, string>>>({});
  const fileRef = useRef<HTMLInputElement>(null);

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

  const allGrouped = accounts.map(a => ({
    account: a,
    rows: positions.filter(p => p.accountId === a.id),
  })).filter(g => g.rows.length > 0);

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

      {/* Step 1 — Pick account */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {/* Account row */}
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

        {/* Format row */}
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

      {/* Step 2 — Import widget for selected format */}

      {/* CSV file picker */}
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

      {/* Parse errors */}
      {parseErrors.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 space-y-1">
          {parseErrors.map((e, i) => <div key={i}>{e}</div>)}
        </div>
      )}

      {/* Preview */}
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

      {/* Empower Totals */}
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

      {/* Manual entry */}
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

      {/* Loaded positions */}
      {allGrouped.length > 0 && (
        <div className="space-y-4 pt-2">
          <h3 className="text-sm font-medium text-gray-700 border-t pt-4">Loaded positions</h3>
          {allGrouped.map(({ account, rows }) => (
            <div key={account.id} className="overflow-hidden border border-gray-200 rounded-lg">
              <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700">{account.name}</span>
                <button
                  onClick={() => setPositions(positions.filter(p => p.accountId !== account.id))}
                  className="text-xs text-red-400 hover:underline"
                >
                  Clear all
                </button>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {rows.map((p, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 font-mono font-medium w-24">{p.ticker}</td>
                      <td className="px-4 py-2 text-gray-500 truncate max-w-xs">{p.description ?? ''}</td>
                      <td className="px-4 py-2 text-right">{fmtUsd(p.marketValue)}</td>
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
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
