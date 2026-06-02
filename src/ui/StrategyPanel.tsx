import { useState, useEffect } from 'react';
import type { Strategy, AssetClass, PlacementBucket } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { CLASS_HIERARCHY, PARENT_CLASS, isParentClass, isChildClass, childrenOf } from '../engine/hierarchy';
import { AC_COLOR, AC_LABEL, BUCKET_LABEL, fmtPct } from './fmt';
import { WeightPie } from './WeightPie';
import type { WeightSlice } from './WeightPie';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';

const ALL_BUCKETS: PlacementBucket[] = ['TAX_ADVANTAGED', 'TAXABLE', 'EDUCATION'];

// Parent classes (US_TOTAL_MARKET, ALTERNATIVES, …) and the top-level rows shown
// in the target/placement tables. Children are pulled in beneath their parent.
const PARENT_CLASSES = Object.keys(CLASS_HIERARCHY) as AssetClass[];
const CHILD_CLASSES = new Set<AssetClass>(Object.keys(PARENT_CLASS) as AssetClass[]);
const TOP_LEVEL_CLASSES = ALL_ASSET_CLASSES.filter(ac => !CHILD_CLASSES.has(ac));

// A proportion split over a parent's children (values sum to ~1).
type Split = Record<string, number>;

/** Normalised child proportions from current child weights (in percent). Falls back to the
 *  parent's declared default split (e.g. Russell cap weights) when all children are zero. */
function deriveSplit(parent: AssetClass, vals: Record<string, number>): Split {
  const children = childrenOf(parent);
  const total = children.reduce((s, c) => s + (vals[c] || 0), 0);
  if (total < 0.001) return { ...CLASS_HIERARCHY[parent]!.defaultWeights };
  return Object.fromEntries(children.map(c => [c, (vals[c] || 0) / total]));
}

/** Distribute a composite total (percent) across a parent's children using a split.
 *  The last child absorbs any rounding remainder so the children always re-sum to the total. */
function splitComposite(parent: AssetClass, totalPct: number, split: Split): Record<string, string> {
  const children = childrenOf(parent);
  const out: Record<string, string> = {};
  let acc = 0;
  children.forEach((c, i) => {
    if (i < children.length - 1) {
      const v = totalPct * (split[c] ?? 0);
      out[c] = v.toFixed(1);
      acc += v;
    } else {
      out[c] = Math.max(totalPct - acc, 0).toFixed(1);
    }
  });
  return out;
}

/** True when the split matches the parent's declared default weights (within rounding). */
function isDefaultSplit(parent: AssetClass, split: Split): boolean {
  const def = CLASS_HIERARCHY[parent]!.defaultWeights;
  return childrenOf(parent).every(c => Math.abs((split[c] ?? 0) - (def[c] ?? 0)) < 0.005);
}

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
  /** Nominal weights the engine drives toward when tax adjustment is enabled —
   *  i.e. the nominal allocation required to satisfy strategy.targets in
   *  after-tax dollars (issue #7). When TA is off this is approximately equal
   *  to strategy.targets; when TA is on it diverges by the per-class taf at
   *  placement (Trad/401k haircut shifts equities up in the nominal mix). */
  taxAdjustedTargetWeights?: Record<AssetClass, number>;
}

/**
 * Two-row 100%-normalized stacked bar comparing the user's target composition
 * interpreted **pre-tax** vs **tax-adjusted** (issue #7). The pre-tax bar is
 * the strategy targets as stated; the tax-adjusted bar is the nominal weights
 * required to achieve those same targets in after-tax dollars — equities held
 * in Traditional/401k get haircut, so hitting an after-tax target needs more
 * nominal $ in those classes than the stated percentage suggests.
 */
function AllocationCompareBars({
  preTax, taxAdjusted,
}: { preTax: Record<AssetClass, number>; taxAdjusted: Record<AssetClass, number> }) {
  // Classes appearing in either view, in the canonical asset-class order so
  // the segments line up visually between the two bars.
  const classes = ALL_ASSET_CLASSES.filter(ac => (preTax[ac] ?? 0) > 0.0005 || (taxAdjusted[ac] ?? 0) > 0.0005);
  if (classes.length === 0) return null;

  const renderBar = (label: string, weights: Record<AssetClass, number>) => {
    const total = classes.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
    if (total <= 0) return null;
    return (
      <div className="flex items-center gap-3">
        <span className="text-xs text-gray-600 w-24 shrink-0 text-right">{label}</span>
        <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden flex">
          {classes.map(ac => {
            const share = (weights[ac] ?? 0) / total;
            if (share <= 0) return null;
            const prePct = preTax[ac] ?? 0;
            const taPct  = taxAdjusted[ac] ?? 0;
            const delta  = taPct - prePct;
            const sign   = delta >= 0 ? '+' : '';
            return (
              <div
                key={ac}
                className="h-full"
                style={{ width: `${share * 100}%`, backgroundColor: AC_COLOR[ac] }}
                title={`${AC_LABEL[ac]} — pre-tax ${fmtPct(prePct)} · tax-adjusted ${fmtPct(taPct)} (${sign}${(delta * 100).toFixed(1)}pp)`}
              />
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-1.5">
      {renderBar('Pre-tax', preTax)}
      {renderBar('Tax-adjusted', taxAdjusted)}
      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 pl-[6.75rem]">
        {classes.map(ac => (
          <div key={ac} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
            {AC_LABEL[ac]}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Tax-adjusted allocation control (issue #7). When enabled, the engine values
 * each account at its after-tax worth and rebalances against that view — so a
 * 60/40 target refers to after-tax wealth rather than nominal market value.
 */
function TaxAdjustmentControl({
  strategy, setStrategy, taxAdjustedTargetWeights,
}: {
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  taxAdjustedTargetWeights?: Record<AssetClass, number>;
}) {
  const enabled = strategy.taxAdjustment?.enabled === true;
  const eff = strategy.taxAdjustment?.effectiveRateAtRetirement ?? 0.15;
  const ltcg = strategy.taxAdjustment?.marginalRateLTCG ?? 0.15;

  // Local string state so users can clear/edit the inputs without losing focus.
  const [effStr, setEffStr] = useState(String((eff * 100).toFixed(1)));
  const [ltcgStr, setLtcgStr] = useState(String((ltcg * 100).toFixed(1)));
  useEffect(() => { setEffStr(String((eff * 100).toFixed(1))); }, [eff]);
  useEffect(() => { setLtcgStr(String((ltcg * 100).toFixed(1))); }, [ltcg]);

  function commit(next: { enabled?: boolean; effPct?: string; ltcgPct?: string }) {
    const ta = {
      enabled: next.enabled ?? enabled,
      effectiveRateAtRetirement: Math.max(0, Math.min(1, (parseFloat(next.effPct ?? effStr) || 0) / 100)),
      marginalRateLTCG:          Math.max(0, Math.min(1, (parseFloat(next.ltcgPct ?? ltcgStr) || 0) / 100)),
    };
    setStrategy({ ...strategy, taxAdjustment: ta });
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-3">
      <div className="flex items-start justify-between gap-4 max-w-2xl">
        <div>
          <div className="text-sm text-gray-700">Tax-adjusted allocation</div>
          <p className="text-xs text-gray-400 mt-0.5 max-w-md">
            Value each account at its after-tax worth before computing drift and
            target sizes. Roth, HSA, and 529 count at face value; Traditional/401k
            are haircut by your expected effective rate at retirement; taxable
            positions are haircut by the LTCG on their unrealized gain (cost basis
            required per position).
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => commit({ enabled: !enabled })}
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
            enabled ? 'bg-indigo-600' : 'bg-gray-300'
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="grid grid-cols-2 gap-4 max-w-2xl pl-4 border-l-2 border-indigo-100">
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Effective rate at retirement (Trad / 401k)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={effStr}
                onChange={e => setEffStr(e.target.value)}
                onBlur={() => commit({ effPct: effStr })}
                className="w-20 border rounded px-2 py-1.5 text-sm text-right"
              />
              <span className="text-gray-400 text-xs">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Your expected effective tax rate in retirement (typically lower than
              your current marginal — withdrawals fill multiple brackets).
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Long-term capital gains rate (Taxable)
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                step="0.5"
                min="0"
                max="100"
                value={ltcgStr}
                onChange={e => setLtcgStr(e.target.value)}
                onBlur={() => commit({ ltcgPct: ltcgStr })}
                className="w-20 border rounded px-2 py-1.5 text-sm text-right"
              />
              <span className="text-gray-400 text-xs">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Federal LTCG. State tax and NIIT are out of scope.
            </p>
          </div>
        </div>
      )}

      {enabled && taxAdjustedTargetWeights && (
        <div className="max-w-2xl pl-4 border-l-2 border-indigo-100 pt-1">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">
            Target composition: pre-tax vs tax-adjusted
          </p>
          <AllocationCompareBars preTax={strategy.targets} taxAdjusted={taxAdjustedTargetWeights} />
          <p className="text-xs text-gray-400 mt-3">
            Both bars show your target. The top bar is the target as stated. The bottom bar is
            the nominal allocation required to achieve that same target in <em>after-tax</em>
            dollars — equities held in Traditional / 401k get haircut by the effective retirement
            rate, so you need a larger nominal share of them to hit an after-tax target.
          </p>
        </div>
      )}
    </div>
  );
}

export function StrategyPanel({ strategy, setStrategy, currentWeights, taxAdjustedTargetWeights }: Props) {
  // A child class "carries weight" when it is targeted or actually held — such a
  // parent is force-expanded (its sub-classes are real, not a hidden refinement).
  const heldOrTargeted = (ac: AssetClass) =>
    (strategy.targets[ac] ?? 0) > 1e-4 || (currentWeights[ac] ?? 0) > 1e-4;
  const forceExpanded = (parent: AssetClass) => childrenOf(parent).some(heldOrTargeted);

  const initWeights = (): Record<AssetClass, string> =>
    Object.fromEntries(
      ALL_ASSET_CLASSES.map(ac => [ac, ((strategy.targets[ac] ?? 0) * 100).toFixed(1)]),
    ) as Record<AssetClass, string>;

  // Child weights (percent) as stored in the strategy — used to seed split proportions.
  const childPct = (parent: AssetClass): Record<string, number> =>
    Object.fromEntries(childrenOf(parent).map(c => [c, (strategy.targets[c] ?? 0) * 100]));

  // Composite handle value for a parent: the children's subtotal when they carry the
  // weight, else the parent's own target (so expanding distributes the parent amount).
  const initComposite = (parent: AssetClass): string => {
    const sub = childrenOf(parent).reduce((s, c) => s + (strategy.targets[c] ?? 0), 0) * 100;
    return (sub > 0.001 ? sub : (strategy.targets[parent] ?? 0) * 100).toFixed(1);
  };

  // Atomic targets for all classes (edit strings, committed on blur).
  const [weights, setWeights] = useState<Record<AssetClass, string>>(initWeights);

  // Per-parent UI state, keyed by parent class.
  //   expanded  — sub-class rows are shown and the weight lives in the children
  //   linked    — a single composite handle drives the children proportionally
  //   splits    — locked child proportions (preserved across link/unlink)
  //   composites— the composite handle's input string
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PARENT_CLASSES.map(p => [p, forceExpanded(p)])));
  const [linked, setLinked] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(PARENT_CLASSES.map(p => [p, true])));
  const [splits, setSplits] = useState<Record<string, Split>>(() =>
    Object.fromEntries(PARENT_CLASSES.map(p => [p, deriveSplit(p, childPct(p))])));
  const [composites, setComposites] = useState<Record<string, string>>(() =>
    Object.fromEntries(PARENT_CLASSES.map(p => [p, initComposite(p)])));

  const [tolerance, setTolerance] = useState(String((strategy.toleranceAbs * 100).toFixed(1)));
  const [toleranceRel, setToleranceRel] = useState(
    String((((strategy.toleranceRel ?? 0.25)) * 100).toFixed(1)),
  );
  const [minTrade,  setMinTrade]  = useState(String(strategy.minTradeUsd));

  // Sync local state if strategy prop changes externally (e.g. JSON import).
  // We re-derive weights/splits/composites every time, but only *force-expand*
  // parents (never collapse) and never clobber the user's link/unlink choice —
  // that would discard in-session edits on every committed keystroke.
  useEffect(() => {
    setWeights(initWeights());
    setSplits(Object.fromEntries(PARENT_CLASSES.map(p => [p, deriveSplit(p, childPct(p))])));
    setComposites(Object.fromEntries(PARENT_CLASSES.map(p => [p, initComposite(p)])));
    setExpanded(prev => {
      const next = { ...prev };
      for (const p of PARENT_CLASSES) if (forceExpanded(p)) next[p] = true;
      return next;
    });
    setTolerance(String((strategy.toleranceAbs * 100).toFixed(1)));
    setToleranceRel(String((((strategy.toleranceRel ?? 0.25)) * 100).toFixed(1)));
    setMinTrade(String(strategy.minTradeUsd));
  }, [strategy]);

  // The classes that actually carry a target weight: an expanded parent's children,
  // a collapsed parent itself, or a standalone class. Parents never double-count.
  const effectiveLeaves: AssetClass[] = TOP_LEVEL_CLASSES.flatMap(ac =>
    isParentClass(ac) && expanded[ac] ? [...childrenOf(ac)] : [ac]);

  const sum = effectiveLeaves.reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  const sumOk = Math.abs(sum - 100) < 0.11;

  // Build the strategy.targets map from local weight strings and expansion state.
  // An expanded parent stores 0 (children carry); a collapsed parent carries its own
  // weight (children store 0); standalone classes store their weight directly.
  function buildTargets(w: Record<AssetClass, string>, exp: Record<string, boolean>): Record<AssetClass, number> {
    return Object.fromEntries(ALL_ASSET_CLASSES.map(ac => {
      let v: number;
      if (isParentClass(ac)) {
        v = exp[ac] ? 0 : (parseFloat(w[ac]) || 0) / 100;
      } else if (isChildClass(ac)) {
        const parent = PARENT_CLASS[ac]!;
        v = exp[parent] ? (parseFloat(w[ac]) || 0) / 100 : 0;
      } else {
        v = (parseFloat(w[ac]) || 0) / 100;
      }
      return [ac, v];
    })) as Record<AssetClass, number>;
  }

  // Commit from explicit maps (used by expand/collapse handlers, which mutate weights
  // and expansion together). Skips the write when the result is out of the ±0.1% band.
  function commitFrom(w: Record<AssetClass, string>, exp: Record<string, boolean>) {
    const targets = buildTargets(w, exp);
    const total = Object.values(targets).reduce((s, v) => s + v, 0);
    if (Math.abs(total - 1) > 0.0011) return;
    setStrategy({
      ...strategy,
      targets,
      toleranceAbs: (parseFloat(tolerance) || 5) / 100,
      toleranceRel: (parseFloat(toleranceRel) || 25) / 100,
      minTradeUsd:  parseFloat(minTrade) || 250,
    });
  }

  function commitWeights() {
    if (!sumOk) return;
    commitFrom(weights, expanded);
  }

  function handleCompositeChange(parent: AssetClass, val: string) {
    setComposites(prev => ({ ...prev, [parent]: val }));
    setWeights(prev => ({ ...prev, ...splitComposite(parent, parseFloat(val) || 0, splits[parent]) }));
  }

  function handleToggleLinked(parent: AssetClass) {
    if (linked[parent]) {
      // Release: children keep their current values and become individually editable.
      setLinked(prev => ({ ...prev, [parent]: false }));
    } else {
      // Link: lock in the proportions implied by the current child values.
      const vals = Object.fromEntries(childrenOf(parent).map(c => [c, parseFloat(weights[c]) || 0]));
      const subTotal = childrenOf(parent).reduce((s, c) => s + (vals[c] as number), 0);
      setSplits(prev => ({ ...prev, [parent]: deriveSplit(parent, vals) }));
      setComposites(prev => ({ ...prev, [parent]: subTotal.toFixed(1) }));
      setLinked(prev => ({ ...prev, [parent]: true }));
    }
  }

  function handleResetSplit(parent: AssetClass) {
    const newSplit = { ...CLASS_HIERARCHY[parent]!.defaultWeights };
    setSplits(prev => ({ ...prev, [parent]: newSplit }));
    const total = parseFloat(composites[parent]) || 0;
    const nextWeights = { ...weights, ...splitComposite(parent, total, newSplit) };
    setWeights(nextWeights);
    commitFrom(nextWeights, expanded);
  }

  // Expand a collapsed parent: split its own weight across the children using the
  // default proportions, then surface the (linked) sub-class rows.
  function handleExpand(parent: AssetClass) {
    const parentVal = parseFloat(weights[parent]) || 0;
    const split = { ...CLASS_HIERARCHY[parent]!.defaultWeights };
    const nextWeights = { ...weights, [parent]: '0.0', ...splitComposite(parent, parentVal, split) };
    const nextExpanded = { ...expanded, [parent]: true };
    setSplits(prev => ({ ...prev, [parent]: split }));
    setComposites(prev => ({ ...prev, [parent]: parentVal.toFixed(1) }));
    setLinked(prev => ({ ...prev, [parent]: true }));
    setWeights(nextWeights);
    setExpanded(nextExpanded);
    commitFrom(nextWeights, nextExpanded);
  }

  // Collapse an expanded parent back to a single handle: fold the children's subtotal
  // up into the parent. Only available when no child is independently held/targeted.
  function handleCollapse(parent: AssetClass) {
    const subTotal = childrenOf(parent).reduce((s, c) => s + (parseFloat(weights[c]) || 0), 0);
    const nextWeights = { ...weights, [parent]: subTotal.toFixed(1) };
    for (const c of childrenOf(parent)) nextWeights[c] = '0.0';
    const nextExpanded = { ...expanded, [parent]: false };
    setWeights(nextWeights);
    setExpanded(nextExpanded);
    commitFrom(nextWeights, nextExpanded);
  }

  // Sentinel for the 1st-choice dropdown's "No preference" option.
  const NO_PREF = 'ANY';

  // Placement buckets shown for a class. Sub-classes with no explicit entry inherit
  // their parent's current placement (so a child defaults to the parent preference).
  function placementBuckets(ac: AssetClass): PlacementBucket[] {
    if (strategy.placement[ac]) return strategy.placement[ac];
    const parent = PARENT_CLASS[ac];
    if (parent && strategy.placement[parent]) return strategy.placement[parent];
    return DEFAULT_STRATEGY.placement[ac] ?? [];
  }

  function updatePlacement(ac: AssetClass, slot: 0 | 1, bucket: PlacementBucket | '' | typeof NO_PREF) {
    // "No preference" → empty bucket list; the engine places the class freely.
    if (slot === 0 && bucket === NO_PREF) {
      setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: [] } });
      return;
    }
    const current = [...placementBuckets(ac)] as PlacementBucket[];
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
    'DEVELOPED_INTL', 'EMERGING_INTL', 'ALTERNATIVES', 'CRYPTO', 'PRECIOUS_METALS',
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
  // Gauge position: 0 = equal-weight across all leaf classes (HHI ≈ 1/N), 100 = all in one.
  const nLeaves = Math.max(effectiveLeaves.length, 2);
  const concentrationScore = Math.round(
    Math.max(0, Math.min(100, (hhi - 1 / nLeaves) / (1 - 1 / nLeaves) * 100)),
  );
  const activeClasses = effectiveLeaves.filter(ac => (parseFloat(weights[ac]) || 0) >= 0.5).length;
  const maxWeight     = Math.max(...effectiveLeaves.map(ac => parseFloat(weights[ac]) || 0));

  const { label: diversLabel, color: diversColor } = ((): { label: string; color: string } => {
    if (hhi < 0.15) return { label: 'Well Diversified',        color: 'text-sky-600'     };
    if (hhi < 0.25) return { label: 'Diversified',             color: 'text-emerald-600' };
    if (hhi < 0.35) return { label: 'Mod. Concentrated',       color: 'text-amber-600'   };
    if (hhi < 0.50) return { label: 'Concentrated',            color: 'text-orange-500'  };
    return               { label: 'Highly Concentrated',       color: 'text-red-500'     };
  })();

  // Parent classes render with their sub-classes indented beneath; children are
  // injected as child rows, so iterate the top-level classes only.
  const subTotalOf = (parent: AssetClass) =>
    childrenOf(parent).reduce((s, c) => s + (parseFloat(weights[c]) || 0), 0);

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
                {TOP_LEVEL_CLASSES.flatMap(ac => {
                  // ── Standalone class — a single editable row ──
                  if (!isParentClass(ac)) {
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

                  // ── Parent class row (with optional indented sub-class children) ──
                  const isExpanded   = expanded[ac];
                  const isLinked     = linked[ac];
                  const canCollapse  = isExpanded && !forceExpanded(ac);
                  const subs         = childrenOf(ac);
                  const defaultLabel = ac === 'US_TOTAL_MARKET'
                    ? 'Reset to Russell index weights (Large 67%, Mid 25%, Small 8%)'
                    : 'Reset to default split';

                  const parentRow = (
                    <tr key={ac} className="hover:bg-gray-50">
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                          <span className="text-gray-700">{AC_LABEL[ac]}</span>
                          {isExpanded ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleLinked(ac)}
                                title={isLinked
                                  ? `Release: edit ${subs.map(s => AC_LABEL[s]).join(' / ')} independently`
                                  : 'Link: drive the sub-classes from a single total'}
                                className={`text-xs px-1.5 py-0.5 rounded border transition-colors ${
                                  isLinked
                                    ? 'border-indigo-300 text-indigo-600 bg-indigo-50 hover:bg-indigo-100'
                                    : 'border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50'
                                }`}
                              >
                                {isLinked ? 'linked' : 'link'}
                              </button>
                              {isLinked && !isDefaultSplit(ac, splits[ac]) && (
                                <span className="text-[10px] text-gray-400">
                                  custom ·{' '}
                                  <button
                                    type="button"
                                    onClick={() => handleResetSplit(ac)}
                                    title={defaultLabel}
                                    className="underline hover:text-indigo-600"
                                  >
                                    reset
                                  </button>
                                </span>
                              )}
                              {canCollapse && (
                                <button
                                  type="button"
                                  onClick={() => handleCollapse(ac)}
                                  title="Collapse: fold the sub-classes back into a single target"
                                  className="text-[10px] text-gray-400 underline hover:text-indigo-600"
                                >
                                  merge
                                </button>
                              )}
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleExpand(ac)}
                              title={`Split into ${subs.map(s => AC_LABEL[s]).join(' / ')}`}
                              className="text-xs px-1.5 py-0.5 rounded border border-gray-200 text-gray-400 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                            >
                              split
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-1.5 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isExpanded && isLinked ? (
                            <input
                              type="number"
                              value={composites[ac]}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => handleCompositeChange(ac, e.target.value)}
                              onBlur={commitWeights}
                              className="w-16 border rounded px-2 py-1 text-right text-sm"
                            />
                          ) : isExpanded ? (
                            <input
                              type="number"
                              value={subTotalOf(ac).toFixed(1)}
                              readOnly
                              disabled
                              title={`Sum of ${subs.map(s => AC_LABEL[s]).join(' + ')} targets`}
                              className="w-16 border border-gray-100 rounded px-2 py-1 text-right text-sm text-gray-400 bg-transparent cursor-not-allowed"
                            />
                          ) : (
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
                          )}
                          <span className="text-gray-400 text-xs">%</span>
                        </div>
                      </td>
                    </tr>
                  );

                  if (!isExpanded) return [parentRow];

                  // ── Sub-class rows — indented; editable only when unlinked ──
                  const subRows = subs.map(sub => (
                    <tr key={sub} className="bg-gray-50/60">
                      <td className="pl-10 pr-4 py-1">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[sub] }} />
                          <span className={`text-xs ${isLinked ? 'text-gray-400' : 'text-gray-600'}`}>{AC_LABEL[sub]}</span>
                        </span>
                      </td>
                      <td className="px-4 py-1 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {isLinked ? (
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
                          <span className={`text-xs ${isLinked ? 'text-gray-300' : 'text-gray-400'}`}>%</span>
                        </div>
                      </td>
                    </tr>
                  ));

                  return [parentRow, ...subRows];
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
                {activeClasses} of {nLeaves} classes · {maxWeight.toFixed(0)}% largest
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
              {TOP_LEVEL_CLASSES.flatMap(ac => {
                const renderRow = (cls: AssetClass, depth: 0 | 1) => {
                  const buckets = placementBuckets(cls);
                  const noPreference = buckets.length === 0;
                  const isChild = depth > 0;
                  const parent = PARENT_CLASS[cls];
                  // A child with no explicit placement of its own inherits the parent's.
                  const inherits = isChild && !strategy.placement[cls];
                  return (
                    <tr key={cls} className={`hover:bg-gray-50 ${isChild ? 'bg-gray-50/40' : ''}`}>
                      <td className={`py-2 ${isChild ? 'pl-10 pr-4' : 'px-4'}`}>
                        <span className={isChild ? 'text-xs text-gray-500' : 'text-gray-700'}>
                          {AC_LABEL[cls]}
                        </span>
                        {inherits && (
                          <span className="ml-2 text-[10px] text-gray-400 italic">inherits {AC_LABEL[parent!]}</span>
                        )}
                      </td>

                      {/* 1st choice — required; "No preference" relaxes placement entirely */}
                      <td className="px-4 py-2">
                        <select
                          value={noPreference ? NO_PREF : (buckets[0] ?? 'TAX_ADVANTAGED')}
                          onChange={e => updatePlacement(cls, 0, e.target.value as PlacementBucket | typeof NO_PREF)}
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
                            onChange={e => updatePlacement(cls, 1, e.target.value as PlacementBucket | '')}
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
                };

                const rows = [renderRow(ac, 0)];
                // Sub-classes appear (indented, defaulting to the parent's placement) only
                // when they actually carry weight — held or individually targeted.
                if (isParentClass(ac)) {
                  for (const child of childrenOf(ac)) {
                    if (heldOrTargeted(child)) rows.push(renderRow(child, 1));
                  }
                }
                return rows;
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

        {/* Tax-adjusted allocation (issue #7) */}
        <TaxAdjustmentControl
          strategy={strategy}
          setStrategy={setStrategy}
          taxAdjustedTargetWeights={taxAdjustedTargetWeights}
        />
      </div>
    </div>
  );
}
