import { useState, useEffect } from 'react';
import type { Strategy, AssetClass, PlacementBucket } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { AC_COLOR, AC_LABEL, BUCKET_COLOR, BUCKET_LABEL } from './fmt';
import { DonutChart } from './DonutChart';
import type { DonutSlice } from './DonutChart';

const ALL_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];

interface Props {
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  /** Live current weights from the rebalance engine (fractions 0–1). */
  currentWeights: Record<AssetClass, number>;
}

export function StrategyPanel({ strategy, setStrategy, currentWeights }: Props) {
  // Local weight state as strings so the user can type freely before committing.
  const [weights, setWeights] = useState<Record<AssetClass, string>>(
    () => Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, (strategy.targets[ac] * 100).toFixed(1)])
    ) as Record<AssetClass, string>
  );
  const [tolerance, setTolerance] = useState(String((strategy.toleranceAbs * 100).toFixed(1)));
  const [minTrade,  setMinTrade]  = useState(String(strategy.minTradeUsd));

  // Sync local state if strategy prop changes externally (e.g. JSON import).
  useEffect(() => {
    setWeights(Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, (strategy.targets[ac] * 100).toFixed(1)])
    ) as Record<AssetClass, string>);
    setTolerance(String((strategy.toleranceAbs * 100).toFixed(1)));
    setMinTrade(String(strategy.minTradeUsd));
  }, [strategy]);

  const sum = ALL_ASSET_CLASSES.reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.11;

  function commitWeights() {
    if (!sumOk) return;
    setStrategy({
      ...strategy,
      targets: Object.fromEntries(
        ALL_ASSET_CLASSES.map(ac => [ac, (parseFloat(weights[ac]) || 0) / 100])
      ) as Record<AssetClass, number>,
      toleranceAbs: (parseFloat(tolerance) || 5) / 100,
      minTradeUsd:  parseFloat(minTrade) || 250,
    });
  }

  function updatePlacement(ac: AssetClass, slot: 0 | 1, bucket: PlacementBucket | '') {
    const current = [...strategy.placement[ac]] as PlacementBucket[];
    if (slot === 0) {
      current[0] = bucket as PlacementBucket; // 1st choice is required
    } else {
      if (bucket === '') {
        current.splice(1); // remove 2nd choice
      } else {
        current[1] = bucket as PlacementBucket;
      }
    }
    setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: current } });
  }

  // Build donut slices — same order as ALL_ASSET_CLASSES so colours are consistent.
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
              {ALL_ASSET_CLASSES.map(ac => (
                <tr key={ac}>
                  <td className="px-4 py-2">
                    <span className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                      <span className="text-gray-700">{AC_LABEL[ac]}</span>
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right">
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
                  <td className="px-4 py-2">
                    <div className="w-48 bg-gray-100 rounded-full h-2">
                      <div
                        className="h-2 rounded-full transition-all"
                        style={{
                          width:           `${Math.min(parseFloat(weights[ac]) || 0, 100)}%`,
                          backgroundColor: AC_COLOR[ac],
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
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
