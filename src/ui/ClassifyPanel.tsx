import { useState, Fragment } from 'react';
import type { Account, AssetClass, Flag, FundDecomposition, PlacementBucket, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { BUILTIN_CLASS_MAP, makeClassifier } from '../engine/classify';
import { isChildClass, isParentClass, childrenOf } from '../engine/hierarchy';
import { accountBucket } from '../engine/placement';
import { AC_COLOR, AC_LABEL, BUCKET_COLOR, BUCKET_LABEL } from './fmt';
import { PieChart } from './PieChart';
import { StackedBars } from './StackedBars';
import type { StackedRow, LegendEntry } from './StackedBars';
import { detectTargetDateFund } from '../data/targetDateFunds';
import { HelpBox, HelpDef, HelpSection } from './HelpBox';
import { IconX, IconCheck } from './icons';

const PLACEMENT_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];

/**
 * Asset-class <option> list that reflects the parent/child hierarchy. Each parent
 * (US Total Market, Alternatives) becomes a bold, non-selectable <optgroup> header
 * above its sub-classes; the parent class itself is still selectable as the first
 * option inside its own group. Native <select> has no collapse/expand, so grouping
 * headers are the closest the browser control gets to a nested menu.
 */
function ClassOptions() {
  return (
    <>
      {ALL_ASSET_CLASSES.filter(ac => !isChildClass(ac)).map(ac => {
        if (!isParentClass(ac)) {
          return <option key={ac} value={ac}>{AC_LABEL[ac]}</option>;
        }
        return (
          <optgroup key={ac} label={AC_LABEL[ac]}>
            <option value={ac}>{AC_LABEL[ac]}</option>
            {childrenOf(ac).map(child => (
              <option key={child} value={child}>{AC_LABEL[child]}</option>
            ))}
          </optgroup>
        );
      })}
    </>
  );
}

interface Props {
  accounts: Account[];
  positions: Position[];
  flags: Flag[];
  tickerOverrides: Record<string, AssetClass>;
  setTickerOverrides: (o: Record<string, AssetClass>) => void;
  decompositions: Record<string, FundDecomposition>;
  setDecompositions: (d: Record<string, FundDecomposition>) => void;
}

type Source = 'override' | 'builtin' | 'unmapped' | 'decomposed';

interface TickerRow {
  ticker:      string;
  description: string | undefined;
  effective:   AssetClass | null;
  source:      Source;
}

// Inline editor state for a single decomposition being edited.
interface EditState {
  ticker: string;
  draft: Partial<Record<AssetClass, string>>; // string so we can have partial % inputs
}

function DecompWeightBars({ decomp }: { decomp: FundDecomposition }) {
  const total = Object.values(decomp).reduce((s, v) => s + (v ?? 0), 0);
  if (total === 0) return null;
  return (
    <div className="flex h-3 rounded overflow-hidden w-40">
      {(Object.entries(decomp) as [AssetClass, number][]).map(([ac, w]) => (
        <div
          key={ac}
          title={`${AC_LABEL[ac] ?? ac}: ${Math.round(w * 100)}%`}
          style={{ width: `${(w / total) * 100}%`, background: AC_COLOR[ac] ?? '#ccc' }}
        />
      ))}
    </div>
  );
}

function DecompEditor({
  initial,
  onApply,
  onCancel,
  isEstimated,
}: {
  initial: FundDecomposition;
  onApply: (d: FundDecomposition) => void;
  onCancel: () => void;
  isEstimated: boolean;
}) {
  const [draft, setDraft] = useState<Partial<Record<AssetClass, string>>>(() => {
    const d: Partial<Record<AssetClass, string>> = {};
    for (const ac of ALL_ASSET_CLASSES) {
      const v = initial[ac];
      if (v !== undefined && v > 0) d[ac] = String(Math.round(v * 1000) / 10);
    }
    return d;
  });

  const sum = ALL_ASSET_CLASSES.reduce((s, ac) => {
    const v = parseFloat(draft[ac] ?? '0');
    return s + (isNaN(v) ? 0 : v);
  }, 0);
  const sumOk = Math.abs(sum - 100) <= 0.5;

  function handleApply() {
    const result: FundDecomposition = {};
    for (const ac of ALL_ASSET_CLASSES) {
      const v = parseFloat(draft[ac] ?? '0');
      if (!isNaN(v) && v > 0) result[ac] = Math.round(v * 10) / 1000;
    }
    onApply(result);
  }

  return (
    <div className="mt-2 p-3 bg-white border border-warn-banner-border rounded-lg space-y-2">
      {isEstimated && (
        <p className="text-xs text-warn bg-warn-bg border border-warn-banner-border rounded px-2 py-1">
          Estimated from fund series. Verify on the fund's fact sheet page.
        </p>
      )}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
        {ALL_ASSET_CLASSES.map(ac => (
          <label key={ac} className="flex items-center gap-2 text-xs">
            <span
              className="inline-block w-2.5 h-2.5 rounded-sm flex-shrink-0"
              style={{ background: AC_COLOR[ac] ?? '#ccc' }}
            />
            <span className={`w-28 text-gray-600 ${isChildClass(ac) ? 'pl-3' : ''}`}>{AC_LABEL[ac] ?? ac}</span>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={draft[ac] ?? ''}
              onChange={e => setDraft(prev => ({ ...prev, [ac]: e.target.value }))}
              className="w-16 border border-gray-200 rounded px-1.5 py-0.5 text-right text-xs"
              placeholder="0"
            />
            <span className="text-gray-400">%</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between pt-1">
        <span className={`inline-flex items-center gap-1 text-xs font-medium ${sumOk ? 'text-ok' : 'text-danger'}`}>
          Sum: {sum.toFixed(1)}% {sumOk ? <IconCheck size={12} /> : '(must be ~100%)'}
        </span>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="text-xs text-gray-500 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!sumOk}
            className="text-xs text-white bg-brand-600 rounded px-2 py-1 disabled:opacity-40 hover:bg-brand-700 disabled:cursor-not-allowed"
          >
            Apply decomposition
          </button>
        </div>
      </div>
    </div>
  );
}

export function ClassifyPanel({
  accounts, positions, flags,
  tickerOverrides, setTickerOverrides,
  decompositions, setDecompositions,
}: Props) {
  const [editState, setEditState] = useState<EditState | null>(null);

  // Build one row per unique ticker across all positions.
  const seen = new Set<string>();
  const rows: TickerRow[] = [];
  for (const p of positions) {
    const t = p.ticker.toUpperCase();
    if (seen.has(t)) continue;
    seen.add(t);
    if (decompositions[t]) {
      rows.push({ ticker: t, description: p.description, effective: null, source: 'decomposed' });
      continue;
    }
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

  const unmapped   = rows.filter(r => r.source === 'unmapped');
  const decomposed = rows.filter(r => r.source === 'decomposed');
  const classified = rows
    .filter(r => r.source !== 'unmapped' && r.source !== 'decomposed')
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  // ── Chart data ──────────────────────────────────────────────────────────────

  const classify   = makeClassifier(tickerOverrides);
  const accountMap = new Map(accounts.map(a => [a.id, a]));

  // (A) Asset-class pie — sum by asset class across all classified positions.
  const acValueMap = new Map<AssetClass, number>();

  // (B) Placement bars — sum by (assetClass, bucket) for the stacked chart.
  const acBucketMap = new Map<AssetClass, Map<PlacementBucket, number>>();

  for (const p of positions) {
    const acct   = accountMap.get(p.accountId);
    const bucket = acct ? accountBucket(acct.type) : 'TAXABLE';

    // Handle decomposed positions.
    const decomp = decompositions[p.ticker.toUpperCase()];
    if (decomp) {
      for (const [ac, weight] of Object.entries(decomp) as [AssetClass, number][]) {
        const portion = p.marketValue * weight;
        acValueMap.set(ac, (acValueMap.get(ac) ?? 0) + portion);
        if (!acBucketMap.has(ac)) acBucketMap.set(ac, new Map());
        const bm = acBucketMap.get(ac)!;
        bm.set(bucket, (bm.get(bucket) ?? 0) + portion);
      }
      continue;
    }

    const ac = classify(p.ticker);
    if (!ac) continue; // skip unmapped

    acValueMap.set(ac, (acValueMap.get(ac) ?? 0) + p.marketValue);

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

  function applyDecomp(ticker: string, decomp: FundDecomposition) {
    setDecompositions({ ...decompositions, [ticker]: decomp });
    // Remove any single-class override/unmapped state for this ticker.
    const next = { ...tickerOverrides };
    delete next[ticker];
    setTickerOverrides(next);
    setEditState(null);
  }

  function removeDecomp(ticker: string) {
    const next = { ...decompositions };
    delete next[ticker];
    setDecompositions(next);
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

      <HelpBox label="About classifying holdings">
        <p>
          Every holding must be mapped to an asset class before the engine can run a full rebalance.
          Tickers that aren't in the built-in map appear in the <strong>Unmapped</strong> section below —
          assign them an asset class and the engine updates immediately.
        </p>

        <HelpSection title="Classification sources">
          <HelpDef term="Built-in map">Common ETFs and mutual funds (VTI, FZROX, MUNY, etc.) are pre-mapped. No action needed.</HelpDef>
          <HelpDef term="Your overrides">Assignments you make here are saved and take precedence over the built-in map.</HelpDef>
          <HelpDef term="Decomposed">For blended funds — target-date funds, balanced funds, etc. — you can define the percentage split across multiple asset classes. The engine keeps the composition fixed but treats the fund as sellable as a whole: when the household drift requires it, the fund is sold proportionally and replacement positions are bought in the same account.</HelpDef>
        </HelpSection>

        <HelpSection title="US Total Market — the Russell split">
          <p>
            Holdings mapped to <strong>US Total Market</strong> (e.g. VTI, FZROX) are automatically redistributed
            to Large Cap (67%), Mid Cap (25%), and Small Cap (8%) using the Russell index methodology.
            This means the engine tracks cap-class drift precisely — you don't need separate Large/Mid/Small ETFs
            for this split to work, but you can use them if your accounts hold them individually.
          </p>
        </HelpSection>

        <HelpSection title="Blended funds (target-date, balanced)">
          <p>
            The app auto-detects common Fidelity Freedom and Vanguard Target Retirement tickers and suggests
            a decomposition based on the fund's current glide-path allocation.
            You can accept the estimate or edit the percentages to match the fund's actual fact sheet.
            Blended funds participate in rebalancing as a single unit — the engine prefers non-blended
            positions when those can absorb the needed change, and falls back to a proportional sale of
            the fund (with compensating buys in other tickers) only when the household drift demands it.
            Use the position-level lock if you want a specific blended-fund holding excluded entirely.
          </p>
          <p className="mt-2 text-warn">
            <strong>Asymmetry to be aware of:</strong> the engine will <em>sell</em> a blended fund when
            drift demands but has no symmetric mechanism to <em>buy</em> one back. Over repeated rebalances
            your allocation will gradually trend away from any blended fund the engine has touched.
            If you'd rather preserve a specific blended-fund holding, lock the position.
          </p>
        </HelpSection>
      </HelpBox>

      {/* ── Charts ─────────────────────────────────────────────────────────── */}
      {acSlices.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] gap-4 items-start">
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
        <div className="rounded-lg border border-warn-banner-border overflow-hidden">
          <div className="bg-warn-bg px-4 py-2 flex items-center gap-2 border-b border-warn-banner-border">
            <span className="text-warn text-sm font-semibold">
              ⚠ {unmapped.length} unclassified {unmapped.length === 1 ? 'holding' : 'holdings'}
            </span>
            <span className="text-warn text-xs">
              — excluded from the rebalance until assigned
            </span>
          </div>
          <div className="bg-warn-row-tint">
            {unmapped.map(row => {
              const tdfDetect = detectTargetDateFund(row.ticker, row.description);
              const isEditing = editState?.ticker === row.ticker;
              return (
                <div key={row.ticker} className="border-b border-warn-banner-border last:border-b-0 px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-warn-banner-text w-24 flex-shrink-0">{row.ticker}</span>
                    <span className="text-warn text-sm truncate flex-1 max-w-[220px]">
                      {row.description ?? <span className="text-faint">—</span>}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      {tdfDetect && (
                        <span className="text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                          Known blend{tdfDetect.confidence === 'estimated' ? ' (estimated)' : ''}
                        </span>
                      )}
                      {!isEditing && (
                        <>
                          <button
                            onClick={() => setEditState({ ticker: row.ticker, draft: {} })}
                            className="text-xs border border-brand-300 text-brand-600 rounded px-2 py-0.5 hover:bg-brand-50"
                          >
                            Set as blended fund
                          </button>
                          <select
                            value=""
                            onChange={e => { if (e.target.value) assign(row.ticker, e.target.value as AssetClass); }}
                            aria-label={`Assign asset class to ${row.ticker}`}
                            className={`text-xs border rounded px-1.5 py-0.5 bg-white ${tdfDetect ? 'border-gray-200 text-gray-500' : 'border-warn text-gray-700'}`}
                          >
                            <option value="">{tdfDetect ? 'or single class…' : '— select class —'}</option>
                            <ClassOptions />
                          </select>
                        </>
                      )}
                    </div>
                  </div>
                  {isEditing && (
                    <DecompEditor
                      initial={tdfDetect?.composition ?? {}}
                      onApply={d => applyDecomp(row.ticker, d)}
                      onCancel={() => setEditState(null)}
                      isEstimated={tdfDetect?.confidence === 'estimated'}
                    />
                  )}
                  {tdfDetect && !isEditing && (
                    <div className="mt-1 ml-24 flex items-center gap-2">
                      <DecompWeightBars decomp={tdfDetect.composition} />
                      <span className="text-xs text-gray-400">{tdfDetect.label}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Blended funds (decomposed) ─────────────────────────────────────── */}
      {decomposed.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium text-gray-600">Blended funds</h3>
          <div className="overflow-hidden border border-brand-200 rounded-lg">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-brand-50 text-xs text-brand-600 uppercase tracking-wide border-b border-brand-200">
                <tr>
                  <th className="px-4 py-2 text-left">Ticker</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Composition</th>
                  <th className="px-4 py-2 text-left"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-brand-50">
                {decomposed.map(row => {
                  const decomp = decompositions[row.ticker]!;
                  const isEditing = editState?.ticker === row.ticker;
                  return (
                    <tr key={row.ticker} className="hover:bg-brand-50/40">
                      <td className="px-4 py-2.5 font-mono font-medium text-brand-900">{row.ticker}</td>
                      <td className="px-4 py-2.5 text-gray-500 truncate max-w-[180px]">
                        {row.description ?? <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        {isEditing ? null : (
                          <div className="flex items-center gap-2">
                            <DecompWeightBars decomp={decomp} />
                            <span className="text-xs text-gray-400">
                              {(Object.entries(decomp) as [AssetClass, number][])
                                .map(([ac, w]) => `${AC_LABEL[ac] ?? ac} ${Math.round(w * 100)}%`)
                                .join(' · ')}
                            </span>
                          </div>
                        )}
                        {isEditing && (
                          <DecompEditor
                            initial={decomp}
                            onApply={d => applyDecomp(row.ticker, d)}
                            onCancel={() => setEditState(null)}
                            isEstimated={false}
                          />
                        )}
                      </td>
                      <td className="px-4 py-2.5 whitespace-nowrap">
                        {!isEditing && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => setEditState({ ticker: row.ticker, draft: {} })}
                              className="text-xs text-brand-600 border border-brand-200 rounded px-2 py-0.5 hover:bg-brand-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => removeDecomp(row.ticker)}
                              className="inline-flex items-center text-muted-2 hover:text-danger border border-line hover:border-danger-hover-border rounded px-2 py-0.5"
                              title="Remove decomposition"
                              aria-label={`Remove decomposition for ${row.ticker}`}
                            >
                              <IconX size={13} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
          </div>
          <p className="text-xs text-gray-400">
            Blended funds count toward allocation totals but are excluded from trade suggestions — their sub-components can't be traded individually.
          </p>
        </div>
      )}

      {/* ── All classified holdings ─────────────────────────────────────────── */}
      {classified.length > 0 && (
        <div className="space-y-2">
          {(unmapped.length > 0 || decomposed.length > 0) && (
            <h3 className="text-sm font-medium text-gray-600">Classified holdings</h3>
          )}
          <div className="overflow-hidden border border-gray-200 rounded-lg">
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left">Ticker</th>
                  <th className="px-4 py-2 text-left">Description</th>
                  <th className="px-4 py-2 text-left">Asset class</th>
                  <th className="px-4 py-2 text-left">Source</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {classified.map(row => {
                  const isEditing = editState?.ticker === row.ticker;
                  return (
                    <Fragment key={row.ticker}>
                      <tr className={`hover:bg-gray-50 ${isEditing ? 'bg-brand-50/60' : ''}`}>
                        <td className="px-4 py-2 font-mono font-medium">{row.ticker}</td>
                        <td className="px-4 py-2 text-gray-500 truncate max-w-[200px]">
                          {row.description ?? <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2">
                          {isEditing ? (
                            <span className="text-xs text-brand-500 italic">Setting blend…</span>
                          ) : (
                            <select
                              value={row.effective ?? ''}
                              onChange={e => assign(row.ticker, e.target.value as AssetClass | '')}
                              aria-label={`Asset class for ${row.ticker}`}
                              className="border border-gray-200 rounded px-2 py-1 text-sm bg-transparent"
                            >
                              <ClassOptions />
                            </select>
                          )}
                        </td>
                        <td className="px-4 py-2">
                          {row.source === 'override' ? (
                            <span className="inline-flex items-center gap-1.5 text-xs text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                              Your override
                              {!isEditing && (
                                <button
                                  onClick={() => assign(row.ticker, '')}
                                  className="inline-flex hover:text-danger"
                                  title="Revert to built-in"
                                  aria-label={`Revert ${row.ticker} to the built-in classification`}
                                ><IconX size={12} /></button>
                              )}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Built-in</span>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right whitespace-nowrap">
                          {isEditing ? (
                            <button
                              onClick={() => setEditState(null)}
                              className="text-xs text-muted-2 hover:text-ink"
                            >
                              Cancel
                            </button>
                          ) : (
                            <button
                              onClick={() => setEditState({ ticker: row.ticker, draft: {} })}
                              className="text-xs text-gray-400 hover:text-brand-600 hover:underline"
                              title="Define this as a blended fund with multiple asset-class components"
                            >
                              Set as blended
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-brand-50/30">
                          <td colSpan={5} className="px-4 pb-3">
                            <DecompEditor
                              initial={row.effective ? { [row.effective]: 1.0 } : {}}
                              onApply={d => applyDecomp(row.ticker, d)}
                              onCancel={() => setEditState(null)}
                              isEstimated={false}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table></div>
          </div>
          <p className="text-xs text-gray-400">
            Changing the class dropdown overrides the built-in map; removing an override
            {' '}(<IconX size={11} className="inline align-[-1px]" />){' '}reverts it.
            Use "Set as blended" to define a fund-of-funds or balanced fund with multiple asset-class components.
          </p>
        </div>
      )}
    </div>
  );
}
