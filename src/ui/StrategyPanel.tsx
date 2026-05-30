import { useState, useEffect } from 'react';
import type { Strategy, AssetClass, PlacementBucket } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { RUSSELL_CAP_SPLIT } from '../engine/rollup';
import { AC_COLOR, AC_LABEL, BUCKET_LABEL } from './fmt';
import { WeightPie } from './WeightPie';
import type { WeightSlice } from './WeightPie';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';

const ALL_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];
const US_CAP_SUBS: readonly AssetClass[] = ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'];

type CapSplit = { US_LARGE_CAP: number; US_MID_CAP: number; US_SMALL_CAP: number };

/**
 * A section with a collapsible body. The heading row toggles open/closed;
 * the title (and optional subtitle) stay visible while collapsed.
 */
function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = true,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 text-left"
      >
        <span className="text-gray-400 text-xs leading-5 select-none">{open ? '▾' : '▸'}</span>
        <span>
          <span className="block text-sm font-medium text-gray-700">{title}</span>
          {subtitle && <span className="block text-xs text-gray-400 mt-0.5">{subtitle}</span>}
        </span>
      </button>
      {open && children}
    </div>
  );
}

interface Props {
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  currentWeights: Record<AssetClass, number>;
}

/** Derive normalised proportions from the current cap-sub weights (values in percent). Falls back to Russell if all zero. */
function deriveCapSplit(lc: number, mc: number, sc: number): CapSplit {
  const total = lc + mc + sc;
  if (total < 0.001) return { ...RUSSELL_CAP_SPLIT };
  return { US_LARGE_CAP: lc / total, US_MID_CAP: mc / total, US_SMALL_CAP: sc / total };
}

/** Apply a cap split (proportions summing to 1) to a composite US equity total (in percent). */
function splitComposite(totalPct: number, split: CapSplit): Record<'US_LARGE_CAP' | 'US_MID_CAP' | 'US_SMALL_CAP', string> {
  const lc = totalPct * split.US_LARGE_CAP;
  const mc = totalPct * split.US_MID_CAP;
  const sc = Math.max(totalPct - lc - mc, 0);
  return { US_LARGE_CAP: lc.toFixed(1), US_MID_CAP: mc.toFixed(1), US_SMALL_CAP: sc.toFixed(1) };
}

export function StrategyPanel({ strategy, setStrategy, currentWeights: _currentWeights }: Props) {
  // Linked by default when US_TOTAL_MARKET has no standalone target (the normal case).
  const [usEquityLinked, setUsEquityLinked] = useState<boolean>(
    (strategy.targets.US_TOTAL_MARKET ?? 0) < 0.001,
  );

  // Proportions used when scaling the composite total in linked mode.
  // Persisted across link/unlink cycles so the user's custom split is not lost.
  const [capSplit, setCapSplit] = useState<CapSplit>(() =>
    deriveCapSplit(
      (strategy.targets.US_LARGE_CAP ?? 0) * 100,
      (strategy.targets.US_MID_CAP   ?? 0) * 100,
      (strategy.targets.US_SMALL_CAP  ?? 0) * 100,
    ),
  );

  // Atomic targets for all classes (edit strings, committed on blur).
  const [weights, setWeights] = useState<Record<AssetClass, string>>(
    () => Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, (strategy.targets[ac] * 100).toFixed(1)]),
    ) as Record<AssetClass, string>,
  );

  // Composite input string for the US Total Market handle (linked mode only).
  const [compositeStr, setCompositeStr] = useState<string>(() => {
    const subTotal = (
      (strategy.targets.US_LARGE_CAP ?? 0)
      + (strategy.targets.US_MID_CAP ?? 0)
      + (strategy.targets.US_SMALL_CAP ?? 0)
    ) * 100;
    return (subTotal > 0.001 ? subTotal : strategy.targets.US_TOTAL_MARKET * 100).toFixed(1);
  });

  const [tolerance, setTolerance] = useState(String((strategy.toleranceAbs * 100).toFixed(1)));
  const [toleranceRel, setToleranceRel] = useState(
    String((((strategy.toleranceRel ?? 0.25)) * 100).toFixed(1)),
  );
  const [minTrade,  setMinTrade]  = useState(String(strategy.minTradeUsd));

  // Sync local state if strategy prop changes externally (e.g. JSON import).
  useEffect(() => {
    setWeights(Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, (strategy.targets[ac] * 100).toFixed(1)]),
    ) as Record<AssetClass, string>);
    const lcPct = (strategy.targets.US_LARGE_CAP ?? 0) * 100;
    const mcPct = (strategy.targets.US_MID_CAP   ?? 0) * 100;
    const scPct = (strategy.targets.US_SMALL_CAP  ?? 0) * 100;
    const subTotal = lcPct + mcPct + scPct;
    setCompositeStr((subTotal > 0.001 ? subTotal : strategy.targets.US_TOTAL_MARKET * 100).toFixed(1));
    setCapSplit(deriveCapSplit(lcPct, mcPct, scPct));
    setTolerance(String((strategy.toleranceAbs * 100).toFixed(1)));
    setToleranceRel(String((((strategy.toleranceRel ?? 0.25)) * 100).toFixed(1)));
    setMinTrade(String(strategy.minTradeUsd));
  }, [strategy]);

  // US_TOTAL_MARKET is always a derived display value — exclude it; sub-classes carry the weight.
  const sum = ALL_ASSET_CLASSES
    .filter(ac => ac !== 'US_TOTAL_MARKET')
    .reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.11;

  function commitWeights() {
    if (!sumOk) return;
    setStrategy({
      ...strategy,
      targets: Object.fromEntries(
        ALL_ASSET_CLASSES.map(ac => [
          ac,
          // When linked, store 0 for the composite handle — sub-classes carry the weight.
          usEquityLinked && ac === 'US_TOTAL_MARKET' ? 0 : (parseFloat(weights[ac]) || 0) / 100,
        ]),
      ) as Record<AssetClass, number>,
      toleranceAbs: (parseFloat(tolerance) || 5) / 100,
      toleranceRel: (parseFloat(toleranceRel) || 25) / 100,
      minTradeUsd:  parseFloat(minTrade) || 250,
    });
  }

  function handleCompositeChange(val: string) {
    setCompositeStr(val);
    setWeights(prev => ({ ...prev, ...splitComposite(parseFloat(val) || 0, capSplit) }));
  }

  function handleToggleLinked() {
    if (usEquityLinked) {
      // Release: sub-classes keep their current derived values; US_TOTAL_MARKET becomes editable at 0.
      setWeights(prev => ({ ...prev, US_TOTAL_MARKET: '0.0' }));
      setUsEquityLinked(false);
    } else {
      // Link: derive proportions from the user's current sub-class weights (preserve custom split).
      const lc = parseFloat(weights.US_LARGE_CAP) || 0;
      const mc = parseFloat(weights.US_MID_CAP) || 0;
      const sc = parseFloat(weights.US_SMALL_CAP) || 0;
      const subTotal = lc + mc + sc;
      const newSplit = deriveCapSplit(lc, mc, sc);
      setCapSplit(newSplit);
      setCompositeStr(subTotal.toFixed(1));
      // Keep current sub-class values unchanged when linking — proportions are locked, not reset.
      setUsEquityLinked(true);
    }
  }

  function handleResetToRussell() {
    const newSplit = { ...RUSSELL_CAP_SPLIT };
    setCapSplit(newSplit);
    const total = parseFloat(compositeStr) || 0;
    setWeights(prev => ({ ...prev, ...splitComposite(total, newSplit) }));
  }

  // Sentinel for the 1st-choice dropdown's "No preference" option.
  const NO_PREF = 'ANY';

  function updatePlacement(ac: AssetClass, slot: 0 | 1, bucket: PlacementBucket | '' | typeof NO_PREF) {
    // "No preference" → empty bucket list; the engine places the class freely.
    if (slot === 0 && bucket === NO_PREF) {
      setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: [] } });
      return;
    }
    const current = [...(strategy.placement[ac] ?? DEFAULT_STRATEGY.placement[ac])] as PlacementBucket[];
    if (slot === 0) {
      current[0] = bucket as PlacementBucket;
    } else {
      if (bucket === '') current.splice(1);
      else current[1] = bucket as PlacementBucket;
    }
    setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: current } });
  }

  // Pie slices reflect the live (uncommitted) weight inputs so the chart updates as you type.
  const targetPieSlices: WeightSlice[] = ALL_ASSET_CLASSES.map(ac => ({
    label:  AC_LABEL[ac],
    weight: (parseFloat(weights[ac]) || 0) / 100,
    color:  AC_COLOR[ac],
  }));

  // Risk-profile score: growth assets vs defensive, derived from live weights.
  const GROWTH_CLASSES = new Set<AssetClass>([
    'US_TOTAL_MARKET', 'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
    'DEVELOPED_INTL', 'EMERGING_INTL', 'ALTERNATIVES',
  ]);
  const growthPct    = ALL_ASSET_CLASSES
    .filter(ac => GROWTH_CLASSES.has(ac))
    .reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  const defensivePct = Math.max(0, 100 - growthPct);

  const { label: riskLabel, color: riskColor } = ((): { label: string; color: string } => {
    if (growthPct < 25) return { label: 'Very Conservative',     color: 'text-sky-600'     };
    if (growthPct < 45) return { label: 'Conservative',          color: 'text-sky-500'     };
    if (growthPct < 65) return { label: 'Moderate',              color: 'text-emerald-600' };
    if (growthPct < 80) return { label: 'Moderately Aggressive', color: 'text-amber-600'   };
    if (growthPct < 95) return { label: 'Aggressive',            color: 'text-orange-500'  };
    return               { label: 'Very Aggressive',             color: 'text-red-500'     };
  })();

  // Diversification score via Herfindahl-Hirschman Index (sum of squared weights).
  // HHI = 1/N for a perfectly equal N-way split; HHI = 1.0 for a single holding.
  const hhi = ALL_ASSET_CLASSES.reduce((s, ac) => {
    const w = (parseFloat(weights[ac]) || 0) / 100;
    return s + w * w;
  }, 0);
  // Gauge position: 0 = equal-weight across all 9 classes (HHI ≈ 0.111), 100 = all in one.
  const concentrationScore = Math.round(
    Math.max(0, Math.min(100, (hhi - 1 / 9) / (1 - 1 / 9) * 100)),
  );
  const activeClasses = ALL_ASSET_CLASSES.filter(ac => (parseFloat(weights[ac]) || 0) >= 0.5).length;
  const maxWeight     = Math.max(...ALL_ASSET_CLASSES.map(ac => parseFloat(weights[ac]) || 0));

  const { label: diversLabel, color: diversColor } = ((): { label: string; color: string } => {
    if (hhi < 0.15) return { label: 'Well Diversified',        color: 'text-sky-600'     };
    if (hhi < 0.25) return { label: 'Diversified',             color: 'text-emerald-600' };
    if (hhi < 0.35) return { label: 'Mod. Concentrated',       color: 'text-amber-600'   };
    if (hhi < 0.50) return { label: 'Concentrated',            color: 'text-orange-500'  };
    return               { label: 'Highly Concentrated',       color: 'text-red-500'     };
  })();

  // US_TOTAL_MARKET is always shown as a parent row with sub-classes indented beneath it.
  // Exclude the three sub-classes from the primary iteration — they're injected as children.
  const primaryClasses = ALL_ASSET_CLASSES.filter(ac => !US_CAP_SUBS.includes(ac));

  // Grayed-out sum displayed on the US Total Market row when in unlinked mode.
  const usSubTotal = (parseFloat(weights.US_LARGE_CAP) || 0)
                   + (parseFloat(weights.US_MID_CAP)   || 0)
                   + (parseFloat(weights.US_SMALL_CAP)  || 0);

  const isRussell =
    Math.abs(capSplit.US_LARGE_CAP - RUSSELL_CAP_SPLIT.US_LARGE_CAP) < 0.005 &&
    Math.abs(capSplit.US_MID_CAP   - RUSSELL_CAP_SPLIT.US_MID_CAP)   < 0.005 &&
    Math.abs(capSplit.US_SMALL_CAP - RUSSELL_CAP_SPLIT.US_SMALL_CAP) < 0.005;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">Strategy</h2>

      <HelpBox label="About the strategy">
        <p>
          The strategy has three parts: <strong>target allocation</strong> (how much of each asset class
          to hold), <strong>placement rules</strong> (which account type each class prefers), and{' '}
          <strong>rebalance parameters</strong> (when to act). All values are fully editable — defaults
          reflect a specific household and should be reviewed before first use.
        </p>

        <HelpSection title="Target allocation">
          <HelpDef term="US equity (57.5% default)">
            Set via a single "US Total Market" handle (linked mode) or per cap-class. Unlink to set
            custom Large/Mid/Small proportions; re-linking locks those proportions and scales them
            together as you adjust the total. A "reset" link restores Russell index weights
            (Large Cap 67%, Mid Cap 25%, Small Cap 8%) if you want to return to the standard split.
          </HelpDef>
          <HelpDef term="Fixed Income (20% default)">
            Held as NY tax-free muni bonds (e.g. MUNY) in the taxable account by default. This target
            also sets the threshold for the REVISIT_PLACEMENT flag — see below.
          </HelpDef>
          <HelpDef term="Alternatives (2.5% default)">
            Crypto, precious metals, and similar. Routed to tax-advantaged accounts because these assets
            attract the less favorable collectibles tax treatment if sold in a taxable account.
          </HelpDef>
        </HelpSection>

        <HelpSection title="Placement rules">
          <p>
            Placement rules control which account type hosts each asset class. The engine fills the
            <strong> 1st-choice bucket</strong> first. If that bucket is full (or no eligible account
            exists), it spills to the <strong>2nd-choice bucket</strong>, and if that too is exhausted,
            to any remaining account.
          </p>
          <HelpDef term="No preference">
            Choosing <strong>No preference</strong> as the 1st choice removes placement guidance for
            that class entirely. The engine places it wherever capacity is largest, across any account
            type, and treats those placements as intentional — no PLACEMENT_SPILLOVER flag is emitted.
            Useful for tax-efficient, broadly-held classes (e.g. a total-market index fund) that work
            well in any account.
          </HelpDef>
          <HelpDef term="Why bonds in taxable (the default)?">
            Municipal bond interest is exempt from federal and NY state taxes, so holding munis in a
            taxable account is nearly as tax-efficient as holding them in an IRA — and it frees the
            tax-advantaged space for equities, where long-term compounding is most valuable.
          </HelpDef>
          <HelpDef term="The REVISIT_PLACEMENT trigger">
            This strategy has a built-in expiry: once the taxable account grows larger than the fixed-income
            sleeve, it can no longer be bonds-only. The engine fires a <strong>REVISIT_PLACEMENT</strong>{' '}
            flag when <em>taxable share &gt; Fixed Income target</em>. When you see it, consider adding
            Taxable as a 2nd-choice bucket for equities, so equity spillover goes to the taxable account
            instead of generating a NO_ELIGIBLE_ACCOUNT error.
          </HelpDef>
        </HelpSection>

        <HelpSection title="Rebalance parameters">
          <HelpDef term="Absolute tolerance (±5pp default)">
            An asset class is in tolerance when its drift is within this many percentage points of
            target. Dominates for large sleeves (e.g. a 50% target with a 5pp band tolerates 45–55%).
          </HelpDef>
          <HelpDef term="Relative tolerance (±25% of target default)">
            A second band, expressed as a fraction of the class's own target. A 20% target with a 25%
            relative band tolerates 15–25%; a 2.5% target tolerates 1.875–3.125%. The engine uses
            whichever band is tighter — the canonical Bogleheads / Swedroe "5/25" rule. Set to 100%
            to disable (absolute band only).
          </HelpDef>
          <HelpDef term="Min trade size ($250 default)">
            Trade recommendations smaller than this dollar amount are dropped. Prevents dust-level orders
            that add transaction friction without meaningfully improving the allocation.
          </HelpDef>
        </HelpSection>
      </HelpBox>

      {/* ── Target allocation ────────────────────────────────────────────────── */}
      <CollapsibleSection title="Target allocation">

        {/* Single card: table on the left, pie on the right */}
        <div className="overflow-hidden border border-gray-200 rounded-lg flex items-stretch">

          {/* ── Allocation table — centred in its half of the card ── */}
          <div className="flex-1 flex justify-center">
            <table className="text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-2 text-left whitespace-nowrap">Asset class</th>
                  <th className="px-4 py-2 text-right whitespace-nowrap">Target %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {primaryClasses.flatMap(ac => {
                  if (ac !== 'US_TOTAL_MARKET') {
                    return [(
                      <tr key={ac} className="hover:bg-gray-50">
                        <td className="px-4 py-1.5">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                            <span className="text-gray-700">{AC_LABEL[ac]}</span>
                          </div>
                        </td>
                        <td className="px-4 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              value={weights[ac]}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => setWeights({ ...weights, [ac]: e.target.value })}
                              onBlur={commitWeights}
                              className="w-16 border rounded px-2 py-1 text-right text-sm"
                            />
                            <span className="text-gray-400 text-xs">%</span>
                          </div>
                        </td>
                      </tr>
                    )];
                  }

                  // ── US Total Market row — always present, with sub-class children ──
                  const utmRow = (
                    <tr key="US_TOTAL_MARKET" className="hover:bg-gray-50">
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR.US_TOTAL_MARKET }} />
                          <span className="text-gray-700">{AC_LABEL.US_TOTAL_MARKET}</span>
                          <button
                            type="button"
                            onClick={handleToggleLinked}
                            title={usEquityLinked
                              ? 'Release: edit Large/Mid/Small Cap independently'
                              : 'Link: drive Large/Mid/Small Cap from a single total'}
                            className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                              usEquityLinked
                                ? 'border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                          >
                            {usEquityLinked ? 'linked' : 'link'}
                          </button>
                          {usEquityLinked && !isRussell && (
                            <span className="text-[10px] text-gray-400">
                              custom ·{' '}
                              <button
                                type="button"
                                onClick={handleResetToRussell}
                                title="Reset to Russell index weights (Large 67%, Mid 25%, Small 8%)"
                                className="underline hover:text-indigo-600"
                              >
                                reset
                              </button>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {usEquityLinked ? (
                            <input
                              type="number"
                              value={compositeStr}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => handleCompositeChange(e.target.value)}
                              onBlur={commitWeights}
                              className="w-16 border rounded px-2 py-1 text-right text-sm"
                            />
                          ) : (
                            <input
                              type="number"
                              value={usSubTotal.toFixed(1)}
                              readOnly
                              disabled
                              title="Sum of Large + Mid + Small Cap targets"
                              className="w-16 border border-gray-100 rounded px-2 py-1 text-right text-sm text-gray-400 bg-transparent cursor-not-allowed"
                            />
                          )}
                          <span className="text-gray-400 text-xs">%</span>
                        </div>
                      </td>
                    </tr>
                  );

                  // ── Sub-class rows — always indented, editable only when unlinked ──
                  const subRows = US_CAP_SUBS.map(sub => (
                    <tr key={sub} className="bg-gray-50/60">
                      <td className="pl-10 pr-4 py-1">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[sub] }} />
                          <span className={`text-xs ${usEquityLinked ? 'text-gray-400' : 'text-gray-600'}`}>{AC_LABEL[sub]}</span>
                        </span>
                      </td>
                      <td className="px-4 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {usEquityLinked ? (
                            <input
                              type="number"
                              value={weights[sub]}
                              readOnly
                              disabled
                              className="w-16 border border-gray-100 rounded px-2 py-0.5 text-right text-xs text-gray-400 bg-transparent cursor-not-allowed"
                            />
                          ) : (
                            <input
                              type="number"
                              value={weights[sub]}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => setWeights({ ...weights, [sub]: e.target.value })}
                              onBlur={commitWeights}
                              className="w-16 border rounded px-2 py-0.5 text-right text-xs"
                            />
                          )}
                          <span className={`text-xs ${usEquityLinked ? 'text-gray-300' : 'text-gray-400'}`}>%</span>
                        </div>
                      </td>
                    </tr>
                  ));

                  return [utmRow, ...subRows];
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-gray-200">
                  <td className="px-4 py-2 text-xs font-medium text-gray-500">
                    Total
                    {sumOk && (
                      <span className="ml-2 font-normal text-green-500">✓ sums to 100%</span>
                    )}
                  </td>
                  <td className={`px-4 py-2 text-right text-sm font-semibold ${sumOk ? 'text-green-600' : 'text-red-600'}`}>
                    {sum.toFixed(1)}%
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* ── Vertical divider ── */}
          <div className="w-px self-stretch bg-gray-100" />

          {/* ── Pie chart + risk profile — fills remaining space, vertically centred ── */}
          <div className="flex-1 flex flex-col items-center justify-center gap-5 py-6 px-8">

            {/* Pie */}
            <div className="flex flex-col items-center gap-2">
              <span className="text-xs font-medium text-gray-500">Target allocation</span>
              <WeightPie slices={targetPieSlices} size={200} />
            </div>

            {/* Risk-profile gauge */}
            <div className="w-full max-w-[200px] space-y-1.5 pt-4 border-t border-gray-100">
              <p className={`text-center text-xs font-semibold ${riskColor}`}>{riskLabel}</p>
              <div className="relative h-2 rounded-full overflow-visible" style={{
                background: 'linear-gradient(to right, #7dd3fc, #86efac, #fde68a, #fb923c, #f87171)',
              }}>
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-500 shadow-sm transition-all"
                  style={{ left: `${Math.min(Math.max(growthPct, 2), 98)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-300 leading-none">
                <span>Conservative</span>
                <span>Aggressive</span>
              </div>
              <p className="text-center text-[10px] text-gray-400 leading-none pt-0.5">
                {growthPct.toFixed(0)}% growth · {defensivePct.toFixed(0)}% defensive
              </p>
            </div>

            {/* Diversification gauge */}
            <div className="w-full max-w-[200px] space-y-1.5 pt-4 border-t border-gray-100">
              <p className={`text-center text-xs font-semibold ${diversColor}`}>{diversLabel}</p>
              <div className="relative h-2 rounded-full overflow-visible" style={{
                background: 'linear-gradient(to right, #f87171, #fb923c, #fde68a, #86efac)',
              }}>
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-gray-500 shadow-sm transition-all"
                  style={{ left: `${Math.min(Math.max(100 - concentrationScore, 2), 98)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-gray-300 leading-none">
                <span>Concentrated</span>
                <span>Diversified</span>
              </div>
              <p className="text-center text-[10px] text-gray-400 leading-none pt-0.5">
                {activeClasses} of 9 classes · {maxWeight.toFixed(0)}% largest
              </p>
            </div>

          </div>
        </div>

        {!sumOk && (
          <p className="text-xs text-red-600">
            Weights must sum to 100% (±0.1%). Adjust the values above, then click outside to apply.
          </p>
        )}
      </CollapsibleSection>

      {/* ── Placement rules (editable) ───────────────────────────────────────── */}
      <CollapsibleSection
        title="Placement rules"
        subtitle="Preferred account type for each asset class. The engine fills the 1st-choice bucket first, then spills into 2nd."
      >
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Asset class</th>
                <th className="px-4 py-2 text-left">
                  1st choice
                  <HelpTip>
                    The engine fills accounts in this bucket first. If the bucket has enough
                    capacity, the entire class lands here and no spillover occurs.
                  </HelpTip>
                </th>
                <th className="px-4 py-2 text-left">
                  2nd choice
                  <HelpTip>
                    Used only when the 1st-choice bucket is full or has no eligible account.
                    Selecting "none" means any remaining capacity anywhere will be used as a
                    last resort — a PLACEMENT_SPILLOVER flag will be emitted. Disabled when the
                    1st choice is "No preference" (the class already has no required home).
                  </HelpTip>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ALL_ASSET_CLASSES.map(ac => {
                const buckets = strategy.placement[ac] ?? DEFAULT_STRATEGY.placement[ac];
                const noPreference = buckets.length === 0;
                return (
                  <tr key={ac} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{AC_LABEL[ac]}</td>

                    {/* 1st choice — required; "No preference" relaxes placement entirely */}
                    <td className="px-4 py-2">
                      <select
                        value={noPreference ? NO_PREF : (buckets[0] ?? 'TAX_ADVANTAGED')}
                        onChange={e => updatePlacement(ac, 0, e.target.value as PlacementBucket | typeof NO_PREF)}
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-white hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        <option value={NO_PREF}>No preference</option>
                        {ALL_BUCKETS.map(b => (
                          <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
                        ))}
                      </select>
                    </td>

                    {/* 2nd choice — optional, empty = spill anywhere. Disabled when no preference. */}
                    <td className="px-4 py-2">
                      {noPreference ? (
                        <span className="text-xs text-gray-400 italic">placed wherever capacity exists</span>
                      ) : (
                        <select
                          value={buckets[1] ?? ''}
                          onChange={e => updatePlacement(ac, 1, e.target.value as PlacementBucket | '')}
                          className="border border-gray-200 rounded px-2 py-1 text-sm bg-white hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400 text-gray-500"
                        >
                          <option value="">— none —</option>
                          {ALL_BUCKETS.map(b => (
                            <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
                          ))}
                        </select>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {/* ── Rebalance parameters ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700">Rebalance parameters</h3>
        <div className="grid grid-cols-3 gap-4 max-w-2xl">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Absolute tolerance
              <span className="ml-1 text-gray-400">(±pp)</span>
              <HelpTip>
                A class is in tolerance when its drift is within this many percentage points of
                target. Dominates for large sleeves. Default ±5 pp.
              </HelpTip>
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={tolerance}
                step="0.5"
                min="0"
                max="20"
                onChange={e => setTolerance(e.target.value)}
                onBlur={commitWeights}
                className="w-20 border rounded px-2 py-1.5 text-sm text-right"
              />
              <span className="text-gray-400 text-xs">pp</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Percentage-point band around each target.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Relative tolerance
              <span className="ml-1 text-gray-400">(±% of target)</span>
              <HelpTip>
                A second band expressed as a fraction of each class's own target. The engine uses
                whichever band is tighter — the Bogleheads / Swedroe "5/25" rule. Default ±25% of
                target. Set to 100% to disable (absolute band only).
              </HelpTip>
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={toleranceRel}
                step="5"
                min="0"
                max="100"
                onChange={e => setToleranceRel(e.target.value)}
                onBlur={commitWeights}
                className="w-20 border rounded px-2 py-1.5 text-sm text-right"
              />
              <span className="text-gray-400 text-xs">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Tighter band on small targets.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Min trade size ($)
              <HelpTip>
                Recommendations below this dollar amount are dropped. Prevents dust-level orders
                that add transaction overhead without meaningfully improving the allocation.
                Raise it if you want to reduce the number of trades per rebalance.
              </HelpTip>
            </label>
            <div className="flex items-center gap-1">
              <span className="text-gray-400 text-xs">$</span>
              <input
                type="number"
                value={minTrade}
                step="50"
                min="0"
                onChange={e => setMinTrade(e.target.value)}
                onBlur={commitWeights}
                className="w-24 border rounded px-2 py-1.5 text-sm text-right"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Ignore trades smaller than this amount.
            </p>
          </div>
        </div>

        {/* Tax-advantaged-first toggle */}
        <div className="flex items-start justify-between gap-4 max-w-2xl border-t border-gray-100 pt-3">
          <div>
            <div className="text-sm text-gray-700">Tax-advantaged-first rebalancing</div>
            <p className="text-xs text-gray-400 mt-0.5 max-w-md">
              Exhaust rebalancing inside tax-advantaged accounts before recommending any
              taxable-account sale. Turn off to allow taxable sells — they'll be flagged as
              avoidable in Results.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={strategy.preferTaxAdvantagedRebalance !== false}
            onClick={() => setStrategy({
              ...strategy,
              preferTaxAdvantagedRebalance: strategy.preferTaxAdvantagedRebalance === false,
            })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              strategy.preferTaxAdvantagedRebalance !== false ? 'bg-indigo-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                strategy.preferTaxAdvantagedRebalance !== false ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </div>
  );
}
