import { useState, useEffect } from 'react';
import type { Strategy, AssetClass, PlacementBucket } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { RUSSELL_CAP_SPLIT } from '../engine/rollup';
import { AC_COLOR, AC_LABEL, BUCKET_LABEL } from './fmt';
import { DonutChart } from './DonutChart';
import type { DonutSlice } from './DonutChart';

const ALL_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];
const US_CAP_SUBS: readonly AssetClass[] = ['US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP'];

interface Props {
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  currentWeights: Record<AssetClass, number>;
}

/** Apply the Russell cap split to a composite US equity total (in percent). */
function splitComposite(totalPct: number): Record<'US_LARGE_CAP' | 'US_MID_CAP' | 'US_SMALL_CAP', string> {
  const lc = totalPct * RUSSELL_CAP_SPLIT.US_LARGE_CAP;
  const mc = totalPct * RUSSELL_CAP_SPLIT.US_MID_CAP;
  const sc = Math.max(totalPct - lc - mc, 0);
  return { US_LARGE_CAP: lc.toFixed(1), US_MID_CAP: mc.toFixed(1), US_SMALL_CAP: sc.toFixed(1) };
}

export function StrategyPanel({ strategy, setStrategy, currentWeights }: Props) {
  // Linked by default when US_TOTAL_MARKET has no standalone target (the normal case).
  const [usEquityLinked, setUsEquityLinked] = useState<boolean>(
    (strategy.targets.US_TOTAL_MARKET ?? 0) < 0.001,
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
  const [minTrade,  setMinTrade]  = useState(String(strategy.minTradeUsd));

  // Sync local state if strategy prop changes externally (e.g. JSON import).
  useEffect(() => {
    setWeights(Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, (strategy.targets[ac] * 100).toFixed(1)]),
    ) as Record<AssetClass, string>);
    const subTotal = (
      (strategy.targets.US_LARGE_CAP ?? 0)
      + (strategy.targets.US_MID_CAP ?? 0)
      + (strategy.targets.US_SMALL_CAP ?? 0)
    ) * 100;
    setCompositeStr((subTotal > 0.001 ? subTotal : strategy.targets.US_TOTAL_MARKET * 100).toFixed(1));
    setTolerance(String((strategy.toleranceAbs * 100).toFixed(1)));
    setMinTrade(String(strategy.minTradeUsd));
  }, [strategy]);

  // When linked, US_TOTAL_MARKET is a display handle — exclude it from the sum check.
  const sum = ALL_ASSET_CLASSES
    .filter(ac => !(usEquityLinked && ac === 'US_TOTAL_MARKET'))
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
      minTradeUsd:  parseFloat(minTrade) || 250,
    });
  }

  function handleCompositeChange(val: string) {
    setCompositeStr(val);
    setWeights(prev => ({ ...prev, ...splitComposite(parseFloat(val) || 0) }));
  }

  function handleToggleLinked() {
    if (usEquityLinked) {
      // Release: sub-classes keep their current derived values; US_TOTAL_MARKET becomes editable at 0.
      setWeights(prev => ({ ...prev, US_TOTAL_MARKET: '0.0' }));
      setUsEquityLinked(false);
    } else {
      // Link: sum the current sub-classes, redistribute via Russell split.
      const subTotal = (parseFloat(weights.US_LARGE_CAP) || 0)
                     + (parseFloat(weights.US_MID_CAP) || 0)
                     + (parseFloat(weights.US_SMALL_CAP) || 0);
      setCompositeStr(subTotal.toFixed(1));
      setWeights(prev => ({ ...prev, ...splitComposite(subTotal) }));
      setUsEquityLinked(true);
    }
  }

  function updatePlacement(ac: AssetClass, slot: 0 | 1, bucket: PlacementBucket | '') {
    const current = [...(strategy.placement[ac] ?? DEFAULT_STRATEGY.placement[ac])] as PlacementBucket[];
    if (slot === 0) {
      current[0] = bucket as PlacementBucket;
    } else {
      if (bucket === '') current.splice(1);
      else current[1] = bucket as PlacementBucket;
    }
    setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: current } });
  }

  const innerSlices: DonutSlice[] = ALL_ASSET_CLASSES.map(ac => ({
    label:  AC_LABEL[ac],
    weight: currentWeights[ac] ?? 0,
    color:  AC_COLOR[ac],
  }));

  const outerSlices: DonutSlice[] = ALL_ASSET_CLASSES.map(ac => ({
    label:  AC_LABEL[ac],
    weight: strategy.targets[ac] ?? 0,
    color:  AC_COLOR[ac],
  }));

  // When linked, sub-classes appear as child rows under the composite — exclude from primary list.
  const primaryClasses = usEquityLinked
    ? ALL_ASSET_CLASSES.filter(ac => !US_CAP_SUBS.includes(ac))
    : ALL_ASSET_CLASSES;

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">Strategy</h2>

      {/* ── Current vs. target donut ─────────────────────────────────────────── */}
      <div className="border border-gray-200 rounded-lg p-5">
        <DonutChart inner={innerSlices} outer={outerSlices} size={180} />
      </div>

      {/* ── Target allocation ────────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700">Target allocation</h3>
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Asset class</th>
                <th className="px-4 py-2 text-right w-32">Target %</th>
                <th className="px-4 py-2 text-left">Bar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {primaryClasses.flatMap(ac => {
                const isComposite = ac === 'US_TOTAL_MARKET' && usEquityLinked;
                const displayVal  = isComposite ? compositeStr : weights[ac];

                const mainRow = (
                  <tr key={ac} className="hover:bg-gray-50">
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex items-center gap-2 min-w-0">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                          <span className="text-gray-700 truncate">{AC_LABEL[ac]}</span>
                        </span>
                        {ac === 'US_TOTAL_MARKET' && (
                          <button
                            type="button"
                            onClick={handleToggleLinked}
                            title={usEquityLinked
                              ? 'Release: edit Large/Mid/Small Cap independently'
                              : 'Link: drive Large/Mid/Small Cap from a single total using the Russell split'}
                            className={`shrink-0 text-xs px-1.5 py-0.5 rounded border transition-colors ${
                              usEquityLinked
                                ? 'border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
                            }`}
                          >
                            {usEquityLinked ? 'linked' : 'link'}
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          value={displayVal}
                          step="0.1"
                          min="0"
                          max="100"
                          onChange={e => isComposite
                            ? handleCompositeChange(e.target.value)
                            : setWeights({ ...weights, [ac]: e.target.value })
                          }
                          onBlur={commitWeights}
                          className="w-16 border rounded px-2 py-1 text-right text-sm"
                        />
                        <span className="text-gray-400 text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2">
                      <div className="w-48 bg-gray-100 rounded-full h-2">
                        <div
                          className="h-2 rounded-full transition-all"
                          style={{
                            width:           `${Math.min(parseFloat(displayVal) || 0, 100)}%`,
                            backgroundColor: AC_COLOR[ac],
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                );

                if (!isComposite) return [mainRow];

                // Sub-class rows shown when composite is linked (read-only, indented).
                const subRows = US_CAP_SUBS.map(sub => (
                  <tr key={sub} className="bg-gray-50/60">
                    <td className="pl-10 pr-4 py-1.5">
                      <span className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[sub] }} />
                        <span className="text-gray-400 text-xs">{AC_LABEL[sub]}</span>
                      </span>
                    </td>
                    <td className="px-4 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          value={weights[sub]}
                          readOnly
                          disabled
                          className="w-16 border border-gray-100 rounded px-2 py-1 text-right text-xs text-gray-400 bg-transparent cursor-not-allowed"
                        />
                        <span className="text-gray-300 text-xs">%</span>
                      </div>
                    </td>
                    <td className="px-4 py-1.5">
                      <div className="w-48 bg-gray-100 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full"
                          style={{
                            width:           `${Math.min(parseFloat(weights[sub]) || 0, 100)}%`,
                            backgroundColor: AC_COLOR[sub],
                            opacity:         0.55,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ));

                return [mainRow, ...subRows];
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td className="px-4 py-2 text-xs font-medium text-gray-500">Total</td>
                <td className={`px-4 py-2 text-right text-sm font-semibold ${sumOk ? 'text-green-600' : 'text-red-600'}`}>
                  {sum.toFixed(1)}%
                </td>
                <td className="px-4 py-2 text-xs text-gray-400">
                  {sumOk ? '✓ sums to 100%' : 'Must sum to 100%'}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {!sumOk && (
          <p className="text-xs text-red-600">
            Weights must sum to 100% (±0.1%). Adjust the values above, then click outside to apply.
          </p>
        )}
      </div>

      {/* ── Placement rules (editable) ───────────────────────────────────────── */}
      <div className="space-y-3">
        <div>
          <h3 className="text-sm font-medium text-gray-700">Placement rules</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Preferred account type for each asset class. The engine fills the 1st-choice bucket
            first, then spills into 2nd.
          </p>
        </div>
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Asset class</th>
                <th className="px-4 py-2 text-left">1st choice</th>
                <th className="px-4 py-2 text-left">2nd choice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ALL_ASSET_CLASSES.map(ac => {
                const buckets = strategy.placement[ac] ?? DEFAULT_STRATEGY.placement[ac];
                return (
                  <tr key={ac} className="hover:bg-gray-50">
                    <td className="px-4 py-2 text-gray-700">{AC_LABEL[ac]}</td>

                    {/* 1st choice — required, no empty option */}
                    <td className="px-4 py-2">
                      <select
                        value={buckets[0] ?? 'TAX_ADVANTAGED'}
                        onChange={e => updatePlacement(ac, 0, e.target.value as PlacementBucket)}
                        className="border border-gray-200 rounded px-2 py-1 text-sm bg-white hover:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                      >
                        {ALL_BUCKETS.map(b => (
                          <option key={b} value={b}>{BUCKET_LABEL[b]}</option>
                        ))}
                      </select>
                    </td>

                    {/* 2nd choice — optional, empty = spill anywhere */}
                    <td className="px-4 py-2">
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Rebalance parameters ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-gray-700">Rebalance parameters</h3>
        <div className="grid grid-cols-2 gap-4 max-w-sm">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Drift tolerance
              <span className="ml-1 text-gray-400">(±%)</span>
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
              <span className="text-gray-400 text-xs">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Suppress trades when drift is within this band.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Min trade size ($)</label>
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
      </div>
    </div>
  );
}
