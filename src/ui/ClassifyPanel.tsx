import { useState, Fragment } from 'react';
import type { Account, AssetClass, Flag, FundDecomposition, PlacementBucket, Position } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { BUILTIN_CLASS_MAP, makeClassifier } from '../engine/classify';
import { isChildClass, isParentClass, childrenOf } from '../engine/hierarchy';
import { accountBucket } from '../engine/placement';
import { AC_COLOR, AC_LABEL, ALLOCATION_FAMILIES, BUCKET_COLOR, BUCKET_LABEL, FAMILY_COLOR, FAMILY_OF, fmtUsd } from './fmt';
import { PieChart } from './PieChart';
import { StackedBars } from './StackedBars';
import type { StackedRow, LegendEntry } from './StackedBars';
import { detectTargetDateFund } from '../data/targetDateFunds';
import { HelpBox, HelpDef, HelpSection } from './HelpBox';
import { IconX, IconCheck, IconPencil } from './icons';
import { Card, StatusChip } from './card';

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

// Decomposition weight bar. Segments roll up to the five brand FAMILIES and use
// the family data-viz ramp (design 3c: "decomposition weight bars use the brand
// data-viz ramp instead of the Tailwind rainbow"). The per-class breakdown still
// shows AC_COLOR swatches inside DecompEditor — this bar is the family summary.
function DecompWeightBars({ decomp }: { decomp: FundDecomposition }) {
  const fam: Record<string, number> = {};
  let total = 0;
  for (const [ac, w] of Object.entries(decomp) as [AssetClass, number][]) {
    if (!w) continue;
    const f = FAMILY_OF[ac] ?? 'ALTS';
    fam[f] = (fam[f] ?? 0) + w;
    total += w;
  }
  if (total === 0) return null;
  // Canonical spoke order (fmt.ts) so bars read consistently with the charts.
  return (
    <div className="flex h-[5px] rounded-[3px] overflow-hidden w-[170px]">
      {ALLOCATION_FAMILIES.filter(f => fam[f] > 0).map(f => (
        <div
          key={f}
          title={`${f}: ${Math.round((fam[f] / total) * 100)}%`}
          style={{ width: `${(fam[f] / total) * 100}%`, background: FAMILY_COLOR[f] ?? '#ccc' }}
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

  // Total market value held under each unique ticker — feeds the "$ at stake"
  // header meta (sum of unclassified value). Per-row Value display was removed
  // by owner decision on PR #197; the rollup is all this step needs.
  const valueByTicker = new Map<string, number>();
  for (const p of positions) {
    const t = p.ticker.toUpperCase();
    valueByTicker.set(t, (valueByTicker.get(t) ?? 0) + p.marketValue);
  }
  const tickerValue = (t: string) => valueByTicker.get(t.toUpperCase()) ?? 0;

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
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-1 py-8 text-center border border-dashed border-line rounded-xl">
          No positions loaded yet. Import positions to see their classifications here.
        </p>
      </div>
    );
  }

  // $ at stake = market value of everything still unclassified (design 3c meta).
  const unclassifiedValue = unmapped.reduce((s, r) => s + tickerValue(r.ticker), 0);

  return (
    <div className="flex flex-col gap-4">

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
          <div className="border border-line rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(8,40,85,.04)]">
            <PieChart title="By asset class" slices={acSlices} />
          </div>

          {/* Placement stacked bars */}
          <div className="border border-line rounded-xl bg-white p-4 shadow-[0_1px_2px_rgba(8,40,85,.04)]">
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
        <Card
          title={`Unclassified · ${unmapped.length}`}
          meta={`${fmtUsd(unclassifiedValue)} at stake · excluded until assigned`}
        >
          <div>
            {unmapped.map((row, i) => {
              const tdfDetect = detectTargetDateFund(row.ticker, row.description);
              const isEditing = editState?.ticker === row.ticker;
              return (
                <div
                  key={row.ticker}
                  className={`px-4 py-2 bg-warn-row-tint ${i < unmapped.length - 1 ? 'border-b border-line-3' : ''}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono font-semibold text-brand-ink w-20 flex-shrink-0">{row.ticker}</span>
                    <span className="text-muted-1 text-[12px] truncate flex-1 max-w-[220px]">
                      {row.description ?? <span className="text-faint">—</span>}
                    </span>
                    <div className="flex items-center gap-2 ml-auto">
                      {/* Confidence survives on the chip: "estimated" vs "known blend"
                          (was the old pill's "Known blend (estimated)" distinction). */}
                      {tdfDetect && (
                        <StatusChip tone="info">
                          Target-date fund · {tdfDetect.confidence === 'estimated' ? 'estimated' : 'known blend'}
                        </StatusChip>
                      )}
                      {!isEditing && (
                        tdfDetect ? (
                          <>
                            {/* Info-chip + link (design 3c): the link opens the detected
                                decomposition in the editor, same action as the old button. */}
                            <button
                              onClick={() => setEditState({ ticker: row.ticker, draft: {} })}
                              className="text-[12px] font-semibold text-brand-600 underline underline-offset-2 hover:text-brand-ink"
                            >
                              {tdfDetect.confidence === 'estimated' ? 'Use estimated decomposition' : 'Use known decomposition'}
                            </button>
                            <select
                              value=""
                              onChange={e => { if (e.target.value) assign(row.ticker, e.target.value as AssetClass); }}
                              aria-label={`Assign asset class to ${row.ticker}`}
                              className="text-xs border border-line rounded px-1.5 py-0.5 bg-white text-muted-1"
                            >
                              <option value="">or single class…</option>
                              <ClassOptions />
                            </select>
                          </>
                        ) : (
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
                              className="text-xs border border-warn rounded px-1.5 py-0.5 bg-white text-warn"
                            >
                              <option value="">— select class —</option>
                              <ClassOptions />
                            </select>
                          </>
                        )
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
                    <div className="mt-1 ml-20 flex items-center gap-2">
                      <DecompWeightBars decomp={tdfDetect.composition} />
                      <span className="font-mono text-[10.5px] text-muted-3">{tdfDetect.label}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* ── Blended funds (decomposed) ─────────────────────────────────────── */}
      {decomposed.length > 0 && (
        <Card title={`Blended funds · ${decomposed.length}`}>
          <div className="px-4 pt-1 pb-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="font-mono text-[10px] tracking-[.06em] uppercase text-muted-3">
                <tr className="border-b border-line-2">
                  <th className="text-left font-normal py-1.5">Ticker</th>
                  <th className="text-left font-normal py-1.5">Description</th>
                  <th className="text-left font-normal py-1.5">Composition</th>
                  <th className="py-1.5"></th>
                </tr>
              </thead>
              <tbody>
                {decomposed.map(row => {
                  const decomp = decompositions[row.ticker]!;
                  const isEditing = editState?.ticker === row.ticker;
                  return (
                    <tr key={row.ticker} className="border-b border-line-3 last:border-b-0 hover:bg-paper">
                      <td className="py-1.5 font-mono font-semibold text-brand-ink">{row.ticker}</td>
                      <td className="py-1.5 text-muted-1 text-[12px] truncate max-w-[180px]">
                        {row.description ?? <span className="text-faint">—</span>}
                      </td>
                      <td className="py-1.5">
                        {isEditing ? null : (
                          <div className="flex items-center gap-2">
                            <DecompWeightBars decomp={decomp} />
                            <span className="font-mono text-[10.5px] text-muted-3">
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
                      <td className="py-1.5 whitespace-nowrap text-right">
                        {!isEditing && (
                          <div className="flex gap-2 justify-end items-center">
                            <button
                              onClick={() => setEditState({ ticker: row.ticker, draft: {} })}
                              title="Edit decomposition"
                              aria-label={`Edit decomposition for ${row.ticker}`}
                              className="inline-flex text-muted-2 hover:text-brand-600 transition-colors"
                            >
                              <IconPencil size={14} />
                            </button>
                            <button
                              onClick={() => removeDecomp(row.ticker)}
                              className="inline-flex text-faint-2 hover:text-danger transition-colors"
                              title="Remove decomposition"
                              aria-label={`Remove decomposition for ${row.ticker}`}
                            >
                              <IconX size={14} />
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-3 font-mono text-[10px] text-muted-3">
            Blended funds count toward allocation totals. The engine may recommend selling a blended fund, but never buying one — buys go to single-class funds (their sub-components can't be bought individually).
          </p>
        </Card>
      )}

      {/* ── All classified holdings ─────────────────────────────────────────── */}
      {classified.length > 0 && (
        <Card
          title={`Ticker classifications · ${classified.length} classified`}
          meta={unmapped.length > 0 ? `Untagged first · ${fmtUsd(unclassifiedValue)} unclassified` : 'Click a class to override'}
        >
          <div className="px-4 pt-1 pb-2 overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="font-mono text-[10px] tracking-[.06em] uppercase text-muted-3">
                <tr className="border-b border-line-2">
                  <th className="text-left font-normal py-1.5">Ticker</th>
                  <th className="text-left font-normal py-1.5">Description</th>
                  <th className="text-left font-normal py-1.5">Asset class</th>
                  <th className="text-right font-normal py-1.5">Source</th>
                  <th className="py-1.5" />
                </tr>
              </thead>
              <tbody>
                {classified.map(row => {
                  const isEditing = editState?.ticker === row.ticker;
                  return (
                    <Fragment key={row.ticker}>
                      <tr className={`border-b border-line-3 last:border-b-0 hover:bg-paper ${isEditing ? 'bg-rail-active' : ''}`}>
                        <td className="py-1.5 font-mono font-semibold text-brand-ink">{row.ticker}</td>
                        <td className="py-1.5 text-muted-1 text-[12px] truncate max-w-[200px]">
                          {row.description ?? <span className="text-faint">—</span>}
                        </td>
                        <td className="py-1.5">
                          {isEditing ? (
                            <span className="text-xs text-brand-500 italic">Setting blend…</span>
                          ) : (
                            <select
                              value={row.effective ?? ''}
                              onChange={e => assign(row.ticker, e.target.value as AssetClass | '')}
                              aria-label={`Asset class for ${row.ticker}`}
                              className="border border-line rounded-lg px-2.5 py-1 text-[12px] text-brand-ink bg-paper"
                            >
                              <ClassOptions />
                            </select>
                          )}
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
                          {row.source === 'override' ? (
                            <span className="inline-flex items-center gap-1.5">
                              <StatusChip tone="info">Override</StatusChip>
                              {!isEditing && (
                                <button
                                  onClick={() => assign(row.ticker, '')}
                                  className="inline-flex text-muted-2 hover:text-danger"
                                  title="Revert to built-in"
                                  aria-label={`Revert ${row.ticker} to the built-in classification`}
                                ><IconX size={12} /></button>
                              )}
                            </span>
                          ) : (
                            <StatusChip tone="idle">Built-in</StatusChip>
                          )}
                        </td>
                        <td className="py-1.5 text-right whitespace-nowrap">
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
                              className="text-xs text-muted-3 hover:text-brand-600 hover:underline"
                              title="Define this as a blended fund with multiple asset-class components"
                            >
                              Set as blended
                            </button>
                          )}
                        </td>
                      </tr>
                      {isEditing && (
                        <tr className="bg-rail-active">
                          <td colSpan={5} className="pb-3">
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
            </table>
          </div>
          <p className="px-4 pb-3 font-mono text-[10px] text-muted-3">
            Changing the class dropdown overrides the built-in map; removing an override
            {' '}(<IconX size={11} className="inline align-[-1px]" />){' '}reverts it.
            Use "Set as blended" to define a fund-of-funds or balanced fund with multiple asset-class components.
          </p>
        </Card>
      )}
    </div>
  );
}
