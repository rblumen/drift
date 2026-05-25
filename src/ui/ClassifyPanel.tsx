import type { Account, AssetClass, Flag, PlacementBucket, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { BUILTIN_CLASS_MAP, makeClassifier } from '../engine/classify';
import { accountBucket } from '../engine/placement';
import { AC_COLOR, AC_LABEL, BUCKET_COLOR, BUCKET_LABEL } from './fmt';
import { PieChart } from './PieChart';
import { StackedBars } from './StackedBars';
import type { StackedRow, LegendEntry } from './StackedBars';

const PLACEMENT_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];

interface Props {
  accounts: Account[];
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

export function ClassifyPanel({ accounts, positions, flags, tickerOverrides, setTickerOverrides }: Props) {
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
    rows.push({ ticker: t, description: p.description, effective: override ?? builtin ?? null, source });
  }

  // Include any flagged-unmapped tickers not already in positions (defensive).
  for (const f of flags) {
    if (f.kind !== 'UNMAPPED_HOLDING') continue;
    const t = f.ticker.toUpperCase();
    if (!seen.has(t)) {
      seen.add(t);
      rows.push({ ticker: t, description: undefined, effective: null, source: 'unmapped' });
    }
  }

  const unmapped  = rows.filter(r => r.source === 'unmapped');
  const classified = rows
    .filter(r => r.source !== 'unmapped')
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  // ── Chart data ──────────────────────────────────────────────────────────────

  const classify   = makeClassifier(tickerOverrides);
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // (A) Asset-class pie — sum by asset class across all classified positions.
  const acValueMap = new Map<AssetClass, number>();

  // (B) Placement bars — sum by (assetClass, bucket) for the stacked chart.
  const acBucketMap = new Map<AssetClass, Map<PlacementBucket, number>>();

  for (const p of positions) {
    const ac = classify(p.ticker);
    if (!ac) continue; // skip unmapped

    acValueMap.set(ac, (acValueMap.get(ac) ?? 0) + p.marketValue);

    const acct   = accountMap.get(p.accountId);
    const bucket = acct ? accountBucket(acct.type) : 'TAXABLE';
    if (!acBucketMap.has(ac)) acBucketMap.set(ac, new Map());
    const bm = acBucketMap.get(ac)!;
    bm.set(bucket, (bm.get(bucket) ?? 0) + p.marketValue);
  }

  const acSlices = ALL_ASSET_CLASSES
    .filter(ac => (acValueMap.get(ac) ?? 0) > 0)
    .map(ac => ({ label: AC_LABEL[ac], value: acValueMap.get(ac)!, color: AC_COLOR[ac] }));

  // Build stacked-bar rows — one per asset class, segments per bucket.
  const placementRows: StackedRow[] = ALL_ASSET_CLASSES
    .filter(ac => acBucketMap.has(ac))
    .map(ac => {
      const bm = acBucketMap.get(ac)!;
      const segments = PLACEMENT_BUCKETS
        .filter(b => (bm.get(b) ?? 0) > 0)
        .map(b => ({ label: BUCKET_LABEL[b], value: bm.get(b)!, color: BUCKET_COLOR[b] }));
      return { label: AC_LABEL[ac], total: segments.reduce((s, sg) => s + sg.value, 0), segments };
    });

  const placementLegend: LegendEntry[] = PLACEMENT_BUCKETS
    .filter(b => placementRows.some(r => r.segments.some(s => s.label === BUCKET_LABEL[b])))
    .map(b => ({ label: BUCKET_LABEL[b], color: BUCKET_COLOR[b] }));

  function assign(ticker: string, ac: AssetClass | '') {
    const next = { ...tickerOverrides };
    if (ac === '') delete next[ticker]; else next[ticker] = ac;
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
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Classify Holdings</h2>
        <span className="text-sm text-gray-500">{rows.length} ticker{rows.length !== 1 ? 's' : ''}</span>
      </div>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      {acSlices.length > 0 && (
        <div className="grid grid-cols-[auto_1fr] gap-4 items-start">
          {/* Asset-class pie */}
          <div className="border border-gray-200 rounded-lg p-4">
            <PieChart title="By asset class" slices={acSlices} />
          </div>

          {/* Placement stacked bars */}
          <div className="border border-gray-200 rounded-lg p-4">
            <StackedBars
              title="Placement by asset class"
              rows={placementRows}
              legend={placementLegend}
            />
          </div>
        </div>
      )}

      {/* ── Unclassified — needs attention ─────────────────────────────────── */}
      {unmapped.length > 0 && (
        <div className="rounded-lg border border-amber-300 overflow-hidden">
          <div className="bg-amber-50 px-4 py-2 flex items-center gap-2 border-b border-amber-200">
            <span className="text-amber-600 text-sm font-semibold">
              ⚠ {unmapped.length} unclassified {unmapped.length === 1 ? 'holding' : 'holdings'}
            </span>
            <span className="text-amber-500 text-xs">
              — excluded from the rebalance until assigned
            </span>
          </div>
          <table className="w-full text-sm bg-amber-50">
            <thead className="text-xs text-amber-700 uppercase tracking-wide border-b border-amber-200">
              <tr>
                <th className="px-4 py-2 text-left">Ticker</th>
                <th className="px-4 py-2 text-left">Description</th>
                <th className="px-4 py-2 text-left">Assign asset class</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {unmapped.map(row => (
                <tr key={row.ticker}>
                  <td className="px-4 py-2.5 font-mono font-semibold text-amber-900">{row.ticker}</td>
                  <td className="px-4 py-2.5 text-amber-700 truncate max-w-[200px]">
                    {row.description ?? <span className="text-amber-300">—</span>}
                  </td>
                  <td className="px-4 py-2.5">
                    <select
                      value=""
                      onChange={e => { if (e.target.value) assign(row.ticker, e.target.value as AssetClass); }}
                      className="border border-amber-300 rounded px-2 py-1 text-sm bg-white"
                    >
                      <option value="">— select —</option>
                      {ALL_ASSET_CLASSES.map(ac => (
                        <option key={ac} value={ac}>{AC_LABEL[ac]}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── All classified holdings ─────────────────────────────────────────── */}
      {classified.length > 0 && (
        <div className="space-y-2">
          {unmapped.length > 0 && (
            <h3 className="text-sm font-medium text-gray-600">Classified holdings</h3>
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
                {classified.map(row => (
                  <tr key={row.ticker} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-mono font-medium">{row.ticker}</td>
                    <td className="px-4 py-2 text-gray-500 truncate max-w-[200px]">
                      {row.description ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={row.effective ?? ''}
                        onChange={e => assign(row.ticker, e.target.value as AssetClass | '')}
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-transparent"
                      >
                        {ALL_ASSET_CLASSES.map(ac => (
                          <option key={ac} value={ac}>{AC_LABEL[ac]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      {row.source === 'override' ? (
                        <span className="inline-flex items-center gap-1.5 text-xs text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">
                          Your override
                          <button
                            onClick={() => assign(row.ticker, '')}
                            className="hover:text-red-500"
                            title="Revert to built-in"
                          >✕</button>
                        </span>
                      ) : (
                        <span className="text-xs text-gray-400">Built-in</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            Changing any row overrides the built-in map for that ticker.
            Removing an override (✕) reverts to the built-in classification.
          </p>
        </div>
      )}
    </div>
  );
}
