import type { AssetClass, Flag, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { BUILTIN_CLASS_MAP } from '../engine/classify';
import { AC_LABEL } from './fmt';

interface Props {
  positions: Position[];
  flags: Flag[];
  tickerOverrides: Record<string, AssetClass>;
  setTickerOverrides: (o: Record<string, AssetClass>) => void;
}

type Source = 'override' | 'builtin' | 'unmapped';

interface TickerRow {
  ticker:      string;
  description: string | undefined;
  effective:   AssetClass | null;
  source:      Source;
}

export function ClassifyPanel({ positions, flags, tickerOverrides, setTickerOverrides }: Props) {
  // Build one row per unique ticker across all positions.
  const seen = new Set<string>();
  const rows: TickerRow[] = [];
  for (const p of positions) {
    const t = p.ticker.toUpperCase();
    if (seen.has(t)) continue;
    seen.add(t);
    const override = tickerOverrides[t];
    const builtin  = BUILTIN_CLASS_MAP[t];
    const source: Source = override ? 'override' : builtin ? 'builtin' : 'unmapped';
    rows.push({
      ticker:      t,
      description: p.description,
      effective:   override ?? builtin ?? null,
      source,
    });
  }

  // Unmapped tickers from flags (in case a ticker appears in flags but not positions — defensive).
  const flaggedUnmapped = flags
    .filter((f): f is Extract<Flag, { kind: 'UNMAPPED_HOLDING' }> => f.kind === 'UNMAPPED_HOLDING')
    .map(f => f.ticker.toUpperCase());
  for (const t of flaggedUnmapped) {
    if (!seen.has(t)) {
      seen.add(t);
      rows.push({ ticker: t, description: undefined, effective: null, source: 'unmapped' });
    }
  }

  // Sort: unmapped first (need attention), then alphabetical.
  rows.sort((a, b) => {
    if (a.source === 'unmapped' && b.source !== 'unmapped') return -1;
    if (a.source !== 'unmapped' && b.source === 'unmapped') return 1;
    return a.ticker.localeCompare(b.ticker);
  });

  const unmappedCount = rows.filter(r => r.source === 'unmapped').length;

  function assign(ticker: string, ac: AssetClass | '') {
    const next = { ...tickerOverrides };
    if (ac === '') {
      delete next[ticker];
    } else {
      next[ticker] = ac;
    }
    setTickerOverrides(next);
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Classify Holdings</h2>
        <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-lg">
          No positions loaded yet. Import positions to see their classifications here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Classify Holdings</h2>
        <span className="text-sm text-gray-500">{rows.length} ticker{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {unmappedCount > 0 && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          {unmappedCount} ticker{unmappedCount !== 1 ? 's are' : ' is'} unclassified and excluded from the
          rebalance. Assign an asset class below.
        </p>
      )}

      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Ticker</th>
              <th className="px-4 py-2 text-left">Description</th>
              <th className="px-4 py-2 text-left">Asset class</th>
              <th className="px-4 py-2 text-left">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map(row => (
              <tr
                key={row.ticker}
                className={row.source === 'unmapped' ? 'bg-amber-50' : 'hover:bg-gray-50'}
              >
                <td className="px-4 py-2 font-mono font-medium">{row.ticker}</td>
                <td className="px-4 py-2 text-gray-500 truncate max-w-[200px]">
                  {row.description ?? <span className="text-gray-300">—</span>}
                </td>
                <td className="px-4 py-2">
                  <select
                    value={row.effective ?? ''}
                    onChange={e => assign(row.ticker, e.target.value as AssetClass | '')}
                    className={`border rounded px-2 py-1 text-sm
                      ${row.source === 'unmapped'
                        ? 'border-amber-300 bg-white'
                        : 'border-gray-200 bg-transparent'}`}
                  >
                    {row.source === 'unmapped' && <option value="">— select —</option>}
                    {ALL_ASSET_CLASSES.map(ac => (
                      <option key={ac} value={ac}>{AC_LABEL[ac]}</option>
                    ))}
                  </select>
                </td>
                <td className="px-4 py-2">
                  {row.source === 'override' && (
                    <span className="inline-flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                      Your override
                      <button
                        onClick={() => assign(row.ticker, '')}
                        className="hover:text-red-500"
                        title="Revert to built-in"
                      >✕</button>
                    </span>
                  )}
                  {row.source === 'builtin' && (
                    <span className="text-xs text-gray-400">Built-in</span>
                  )}
                  {row.source === 'unmapped' && (
                    <span className="text-xs text-amber-600 font-medium">Unclassified</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Changing any row overrides the built-in map for that ticker. Removing an override (✕) reverts
        to the built-in classification, or leaves it unclassified if none exists.
      </p>
    </div>
  );
}
