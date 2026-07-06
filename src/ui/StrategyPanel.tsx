import { useState, useEffect } from 'react';
import type { Strategy, Account, AssetClass, PlacementTarget } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { DEFAULT_STRATEGY } from '../engine/strategy';
import { CLASS_HIERARCHY, PARENT_CLASS, isParentClass, isChildClass, childrenOf } from '../engine/hierarchy';
import { accountTarget, isAccountTarget, accountIdOf, descendantAccountTypes } from '../engine/placementHierarchy';
import { AC_COLOR, AC_LABEL, BUCKET_LABEL, fmtPct } from './fmt';
import { WeightPie } from './WeightPie';
import type { WeightSlice } from './WeightPie';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';
import { Card } from './card';
import { IconChevronDown, IconChevronRight, IconCheck, IconLockSplit, IconLockSplitOpen } from './icons';

// One selectable placement option: a value plus its display label and nesting depth.
// depth 1 rows are specific-account leaves shown indented under their tax tier (#89 Phase 2).
type PlacementOption = { value: PlacementTarget; label: string; depth: 0 | 1 };

// Display label for any placement target — tier/bucket via BUCKET_LABEL, or the account's
// name for an account: leaf (falling back to a deleted-account marker if it's gone).
function labelForTarget(target: PlacementTarget, accounts: Account[]): string {
  if (isAccountTarget(target)) {
    const acct = accounts.find(a => a.id === accountIdOf(target));
    return acct ? acct.name : '⚠ deleted account';
  }
  return BUCKET_LABEL[target] ?? String(target);
}

// Placement-target options grouped hierarchically and filtered to the household (#89).
// The tax-advantaged group holds the broad bucket plus the tax-deferred / tax-free tiers,
// and each tier is followed by the specific accounts the household actually holds under it
// — so a rule can stay broad, pick a tier, or pin a single account. Tiers/buckets are
// always offered; only *specific-account* leaves are visibility-gated (we list real
// accounts only).
function buildPlacementOptionGroups(
  accounts: Account[],
): Array<{ label: string; options: PlacementOption[] }> {
  const accountLeaves = (tier: PlacementTarget): PlacementOption[] => {
    const types = descendantAccountTypes(tier);
    return accounts
      .filter(a => types.includes(a.type))
      .map(a => ({ value: accountTarget(a.id), label: a.name, depth: 1 as const }));
  };
  const tier = (t: PlacementTarget): PlacementOption => ({ value: t, label: BUCKET_LABEL[t], depth: 0 });

  return [
    { label: 'Taxable', options: [tier('TAXABLE'), ...accountLeaves('TAXABLE')] },
    {
      label: 'Tax-Advantaged',
      options: [
        tier('TAX_ADVANTAGED'),
        tier('TAX_DEFERRED'), ...accountLeaves('TAX_DEFERRED'),
        tier('TAX_FREE'), ...accountLeaves('TAX_FREE'),
      ],
    },
    { label: 'Education', options: [tier('EDUCATION'), ...accountLeaves('EDUCATION')] },
  ];
}

// Renders grouped <optgroup>/<option> for a placement <select>. `current` is the value the
// select is showing; if it's an account: leaf for a since-deleted account (not in any
// group), a fallback option is prepended so the stale rule stays visible and selectable.
function renderPlacementOptions(
  groups: Array<{ label: string; options: PlacementOption[] }>,
  current: PlacementTarget | '' | undefined,
  accounts: Account[],
) {
  const known = new Set(groups.flatMap(g => g.options.map(o => o.value)));
  const staleOption =
    current && isAccountTarget(current) && !known.has(current)
      ? <option key={current} value={current}>{labelForTarget(current, accounts)}</option>
      : null;
  return (
    <>
      {staleOption}
      {groups.map(group => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map(o => (
            <option key={o.value} value={o.value}>
              {/* Account leaves sit one level under their tax tier; indent only (no glyph),
                  matching the Classify dropdown. Non-breaking spaces so the indent survives
                  <option> whitespace collapsing. */}
              {o.depth ? `    ${o.label}` : o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

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

/**
 * Proportionally rescale a set of percent weights so the given leaf keys sum to
 * exactly 100. Pure and exported for unit testing (#194 "Normalize to 100%").
 * Returns a new map with each leaf's value scaled by 100/total and formatted to
 * one decimal; non-leaf keys are passed through untouched. A total of 0 (nothing
 * to scale) returns the input unchanged.
 */
export function normalizeToHundredWeights(
  weights: Record<string, string>,
  leaves: string[],
): Record<string, string> {
  const total = leaves.reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  if (total <= 0) return { ...weights };
  const factor = 100 / total;
  const out = { ...weights };
  for (const ac of leaves) out[ac] = ((parseFloat(weights[ac]) || 0) * factor).toFixed(1);
  return out;
}

/** True when the split matches the parent's declared default weights (within rounding). */
function isDefaultSplit(parent: AssetClass, split: Split): boolean {
  const def = CLASS_HIERARCHY[parent]!.defaultWeights;
  return childrenOf(parent).every(c => Math.abs((split[c] ?? 0) - (def[c] ?? 0)) < 0.005);
}


interface Props {
  strategy: Strategy;
  setStrategy: (s: Strategy) => void;
  /** Household accounts — drives the per-account placement options (issue #89 Phase 2). */
  accounts: Account[];
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
            enabled ? 'bg-brand-600' : 'bg-gray-300'
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
        <div className="grid grid-cols-2 gap-4 max-w-2xl pl-4 border-l-2 border-brand-100">
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
        <div className="max-w-2xl pl-4 border-l-2 border-brand-100 pt-1">
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

export function StrategyPanel({ strategy, setStrategy, accounts, currentWeights, taxAdjustedTargetWeights }: Props) {
  // Placement dropdown options, rebuilt when the household's accounts change so each tax
  // tier lists the specific accounts it contains (issue #89 Phase 2).
  const placementGroups = buildPlacementOptionGroups(accounts);

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
  const [targetFraction, setTargetFraction] = useState(
    String(((strategy.rebalanceTargetFraction ?? 0.5) * 100).toFixed(0)),
  );
  const [minTrade,  setMinTrade]  = useState(String(strategy.minTradeUsd));

  // Card-level collapse state for the Target allocation / Placement rules
  // sections (#194 regression fix — restore-only, matches the Results
  // household-allocation collapsible-card pattern: in-memory, default open).
  const [targetAllocCollapsed, setTargetAllocCollapsed] = useState(false);
  const [placementCollapsed, setPlacementCollapsed] = useState(false);

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
    setTargetFraction(String(((strategy.rebalanceTargetFraction ?? 0.5) * 100).toFixed(0)));
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
      // Clamp into (0, 1]: 0 would demand exact targets and the schema rejects it.
      rebalanceTargetFraction: Math.min(1, Math.max(0.01, (parseFloat(targetFraction) || 50) / 100)),
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

  // Placement targets shown for a class. Sub-classes with no explicit entry inherit
  // their parent's current placement (so a child defaults to the parent preference).
  function placementBuckets(ac: AssetClass): PlacementTarget[] {
    if (strategy.placement[ac]) return strategy.placement[ac];
    const parent = PARENT_CLASS[ac];
    if (parent && strategy.placement[parent]) return strategy.placement[parent];
    return DEFAULT_STRATEGY.placement[ac] ?? [];
  }

  function updatePlacement(ac: AssetClass, slot: 0 | 1, target: PlacementTarget | '' | typeof NO_PREF) {
    // "No preference" → empty target list; the engine places the class freely.
    if (slot === 0 && target === NO_PREF) {
      setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: [] } });
      return;
    }
    const current = [...placementBuckets(ac)] as PlacementTarget[];
    if (slot === 0) {
      current[0] = target as PlacementTarget;
    } else {
      if (target === '') current.splice(1);
      else current[1] = target as PlacementTarget;
    }
    setStrategy({ ...strategy, placement: { ...strategy.placement, [ac]: current } });
  }

  // Overwrite the entire placement map with the recommended asset-location defaults
  // (issue #89). This is the explicit opt-in: imported/saved selections are otherwise
  // preserved on load, so adopting the new defaults only happens when the user asks.
  function resetPlacementToRecommended() {
    setStrategy({ ...strategy, placement: { ...DEFAULT_STRATEGY.placement } });
  }

  // Restore the built-in default target allocation (the #194 "Reset to defaults"
  // footer control). The useEffect on `strategy` re-seeds weights/splits/composites
  // from the new targets, so this commits the defaults and lets local state follow.
  function resetTargetsToDefaults() {
    setStrategy({ ...strategy, targets: { ...DEFAULT_STRATEGY.targets } });
  }

  // Pie slices reflect the live (uncommitted) weight inputs so the chart updates as you type.
  const targetPieSlices: WeightSlice[] = ALL_ASSET_CLASSES.map(ac => ({
    label:  AC_LABEL[ac],
    weight: (parseFloat(weights[ac]) || 0) / 100,
    color:  AC_COLOR[ac],
  }));

  // Risk-profile score: growth assets vs defensive, derived from live weights.
  // Defensive = FIXED_INCOME + all its hierarchy sub-classes + CASH.
  // Growth = everything else (equities, alternatives, real estate, intl sub-regions).
  // Derived from the hierarchy so toggling split/merge never changes the reading.
  const FI_FAMILY = new Set<AssetClass>(['FIXED_INCOME', ...childrenOf('FIXED_INCOME')]);
  const growthPct    = ALL_ASSET_CLASSES
    .filter(ac => !FI_FAMILY.has(ac) && ac !== 'CASH')
    .reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
  const defensivePct = Math.max(0, 100 - growthPct);

  const { label: riskLabel, color: riskColor } = ((): { label: string; color: string } => {
    if (growthPct < 25) return { label: 'Very Conservative',     color: 'text-info'       };
    if (growthPct < 45) return { label: 'Conservative',          color: 'text-brand-500'  };
    if (growthPct < 65) return { label: 'Moderate',              color: 'text-ok'         };
    if (growthPct < 80) return { label: 'Moderately Aggressive', color: 'text-warn'       };
    if (growthPct < 95) return { label: 'Aggressive',            color: 'text-accent-ink' };
    return               { label: 'Very Aggressive',             color: 'text-danger'     };
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
    if (hhi < 0.15) return { label: 'Well Diversified',        color: 'text-info'       };
    if (hhi < 0.25) return { label: 'Diversified',             color: 'text-ok'         };
    if (hhi < 0.35) return { label: 'Mod. Concentrated',       color: 'text-warn'       };
    if (hhi < 0.50) return { label: 'Concentrated',            color: 'text-accent-ink' };
    return               { label: 'Highly Concentrated',       color: 'text-danger'     };
  })();

  // Parent classes render with their sub-classes indented beneath; children are
  // injected as child rows, so iterate the top-level classes only.
  const subTotalOf = (parent: AssetClass) =>
    childrenOf(parent).reduce((s, c) => s + (parseFloat(weights[c]) || 0), 0);

  // Current household weight (%) for a class or a parent's family. Parents show
  // their subtotal when expanded (children carry the weight); a standalone/
  // collapsed class shows its own current weight.
  const currentPctOf = (ac: AssetClass): number => {
    if (isParentClass(ac) && expanded[ac]) {
      return childrenOf(ac).reduce((s, c) => s + (currentWeights[c] ?? 0), 0) * 100;
    }
    // A collapsed parent's "current" also folds in any child holdings so the
    // compare bar reflects the whole family, never an empty parent-only slice.
    if (isParentClass(ac)) {
      const own = (currentWeights[ac] ?? 0) * 100;
      const kids = childrenOf(ac).reduce((s, c) => s + (currentWeights[c] ?? 0), 0) * 100;
      return own + kids;
    }
    return (currentWeights[ac] ?? 0) * 100;
  };

  // Drift-toned color for the current% readout, matching the Results drift
  // palette: over target → accent orange, under → brand-500 steel, on → muted.
  const currentToneStyle = (currentPct: number, targetPct: number): React.CSSProperties => {
    const drift = currentPct - targetPct;
    if (drift > 0.05) return { color: '#e8600a' };   // over → accent
    if (drift < -0.05) return { color: '#1a5fa0' };   // under → brand-500
    return { color: '#8792a0' };                      // on target → muted-2
  };

  // The committed target% for a row (what the compare-bar tick sits at). Mirrors
  // the input value the user sees, so bar and box never disagree.
  const targetPctOf = (ac: AssetClass): number => {
    if (isParentClass(ac) && expanded[ac]) return subTotalOf(ac);
    return parseFloat(weights[ac]) || 0;
  };

  // Compare-bar cell: track #f1f3f6, a 6px navy current fill, and a 2×12px
  // #2a3441 target tick. Widths are scaled so the busiest class (~45%) reads
  // near full — a 50% ceiling keeps small sleeves visible.
  function CompareBar({ currentPct, targetPct }: { currentPct: number; targetPct: number }) {
    const SCALE = 50; // % that maps to full bar width
    const cur = Math.min(currentPct / SCALE, 1) * 100;
    const tgt = Math.min(targetPct / SCALE, 1) * 100;
    return (
      <span className="relative block h-3.5" aria-hidden="true">
        <span className="absolute left-0 right-0 top-1 h-1.5 rounded-[3px]" style={{ background: '#f1f3f6' }} />
        <span className="absolute left-0 top-1 h-1.5 rounded-[3px]" style={{ width: `${cur}%`, background: '#0d3e7a' }} />
        <span className="absolute top-0 h-3 w-0.5" style={{ left: `calc(${tgt}% - 1px)`, background: '#2a3441' }} />
      </span>
    );
  }

  // Normalize to 100% — proportionally rescale every effective-leaf weight so
  // the targets sum to exactly 100%. A NEW control from the #194 design. Uses
  // the same commit path as manual edits (skips write only if it can't reach
  // ~1.0, which normalization guarantees). No-op when everything is already
  // zero (nothing to scale).
  function normalizeToHundred() {
    const total = effectiveLeaves.reduce((s, ac) => s + (parseFloat(weights[ac]) || 0), 0);
    if (total <= 0) return;
    const next = normalizeToHundredWeights(weights, effectiveLeaves) as Record<AssetClass, string>;
    // Keep any linked parent's composite handle in step with its rescaled children.
    const nextComposites = { ...composites };
    for (const p of PARENT_CLASSES) {
      if (expanded[p]) {
        nextComposites[p] = childrenOf(p)
          .reduce((s, c) => s + (parseFloat(next[c]) || 0), 0).toFixed(1);
      }
    }
    setWeights(next);
    setComposites(nextComposites);
    commitFrom(next, expanded);
  }

  return (
    <div className="flex flex-col gap-4">

      <HelpBox label="About the strategy">
        <p>
          The strategy has three parts: <strong>target allocation</strong> (how much of each asset class
          to hold), <strong>placement rules</strong> (which account type each class prefers), and{' '}
          <strong>rebalance parameters</strong> (when to act). All values are fully editable — defaults
          reflect a specific household and should be reviewed before first use.
        </p>

        <HelpSection title="Target allocation">
          <HelpDef term="US equity (57.5% default)">
            Set via a single "US Total Market" handle (split locked) or per cap-class. Unlock the
            split (the lock-over-pie button) to set custom Large/Mid/Small proportions; locking it
            again freezes those proportions and scales them together as you adjust the total.
            A "reset" link restores Russell index weights
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
          <HelpDef term="Rebalance target band (50% of tolerance default)">
            Tolerance decides <em>when</em> a class has drifted enough to rebalance; this decides
            <em> how close to ideal</em> it lands once it does. At the 50% default, a class is driven to
            within half its tolerance band rather than parked at the edge — so it has room to drift before
            the next rebalance re-triggers. Set to 100% to allow landing anywhere inside tolerance (more
            drift, fewer trades).
          </HelpDef>
        </HelpSection>
      </HelpBox>

      {/* ── Target allocation — collapsible kit card matching the Results
          household-allocation card (#194 stage-4 restyle dropped this;
          restored here): chevron in the tinted header, header-button
          toggles, collapsed = one-line header card, default open,
          in-memory state. The Current/Target legend lives in the header as
          a SIBLING of the toggle button so legend clicks never collapse
          the card. */}
      <div className="space-y-2">
        <div className="overflow-hidden border border-line rounded-xl shadow-[0_1px_2px_rgba(8,40,85,.04)]">
          <div className={`flex items-center gap-3 bg-tint ${targetAllocCollapsed ? '' : 'border-b border-line'}`}>
            <button
              className="flex-1 min-w-0 px-4 py-2 flex items-center gap-3 hover:bg-tint-cell transition-colors text-left"
              onClick={() => setTargetAllocCollapsed(c => !c)}
              aria-expanded={!targetAllocCollapsed}
            >
              <span className="text-muted-2 inline-flex shrink-0">{targetAllocCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}</span>
              <span className="font-mono text-[10px] tracking-[.12em] uppercase text-[#6b7685] truncate">Target allocation</span>
            </button>
            <span className="flex items-center gap-3 font-mono text-[10px] text-muted-3 px-4 py-2 shrink-0" onClick={e => e.stopPropagation()}>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-sm" style={{ background: '#0d3e7a' }} />Current
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block w-3 h-0 border-t-2 border-dashed" style={{ borderColor: '#8792a0' }} />Target
              </span>
            </span>
          </div>

          {!targetAllocCollapsed && (
            <>
        <div className="flex items-stretch">

          {/* ── Allocation table with inline compare bars ── */}
          <div className="flex-[1.15] min-w-0">
            <div className="overflow-x-auto px-4 py-1.5"><table className="w-full text-sm">
              <thead>
                <tr className="font-mono text-[10px] tracking-[.06em] uppercase text-muted-3 border-b border-line-2">
                  <th className="py-1.5 text-left whitespace-nowrap font-normal">Asset class</th>
                  <th className="py-1.5 text-left whitespace-nowrap font-normal">Target %</th>
                  <th className="py-1.5 pl-3.5 text-left whitespace-nowrap font-normal">Current vs target</th>
                  <th className="py-1.5 text-right whitespace-nowrap font-normal">Current</th>
                </tr>
              </thead>
              <tbody>
                {TOP_LEVEL_CLASSES.flatMap(ac => {
                  // ── Standalone class — a single editable row ──
                  if (!isParentClass(ac)) {
                    const curPct = currentPctOf(ac);
                    const tgtPct = targetPctOf(ac);
                    return [(
                      <tr key={ac} className="border-b border-line-3 hover:bg-paper">
                        <td className="py-1.5">
                          <div className="flex items-center gap-2 whitespace-nowrap">
                            <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                            <span className="font-medium text-brand-ink">{AC_LABEL[ac]}</span>
                          </div>
                        </td>
                        <td className="py-1.5">
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              value={weights[ac]}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => setWeights({ ...weights, [ac]: e.target.value })}
                              onBlur={commitWeights}
                              aria-label={`${AC_LABEL[ac]} target weight (%)`}
                              className="w-14 border border-line rounded-[7px] bg-paper px-2 py-1 text-right font-mono text-[12px] text-brand-ink"
                            />
                            <span className="text-muted-3 text-xs">%</span>
                          </div>
                        </td>
                        <td className="py-1.5 pl-3.5 pr-4"><CompareBar currentPct={curPct} targetPct={tgtPct} /></td>
                        <td className="py-1.5 text-right font-mono text-[12px]" style={currentToneStyle(curPct, tgtPct)}>
                          {curPct.toFixed(1)}
                        </td>
                      </tr>
                    )];
                  }

                  // ── Parent class row (with optional indented sub-class children) ──
                  const isExpanded   = expanded[ac];
                  const isLinked     = linked[ac];
                  // Allow collapse when children actually carry weight (the user
                  // distributed targets to them via "split"). When a parent is
                  // force-expanded only because of current holdings — not because
                  // the user split it — all child weight strings are '0.0' and
                  // collapsing would silently zero the parent target, so block it.
                  const canCollapse  = isExpanded &&
                    childrenOf(ac).some(c => (parseFloat(weights[c]) || 0) > 0.001);
                  const subs         = childrenOf(ac);
                  const defaultLabel = ac === 'US_TOTAL_MARKET'
                    ? 'Reset to Russell index weights (Large 67%, Mid 25%, Small 8%)'
                    : 'Reset to default split';
                  const curPct = currentPctOf(ac);
                  const tgtPct = targetPctOf(ac);

                  const parentRow = (
                    <tr key={ac} className="border-b border-line-3 hover:bg-paper">
                      <td className="py-1.5">
                        <div className="flex items-center gap-2 whitespace-nowrap">
                          <span className="text-muted-2 inline-flex select-none">
                            {isExpanded ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
                          </span>
                          <span className="w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[ac] }} />
                          <span className="font-medium text-brand-ink">{AC_LABEL[ac]}</span>
                          {isExpanded ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleLinked(ac)}
                                title={isLinked
                                  ? `Unlock split: edit ${subs.map(s => AC_LABEL[s]).join(' / ')} independently`
                                  : 'Lock split: drive the sub-classes from a single total, keeping these proportions'}
                                aria-label={isLinked
                                  ? `Unlock split: edit ${subs.map(s => AC_LABEL[s]).join(' / ')} independently`
                                  : 'Lock split: drive the sub-classes from a single total, keeping these proportions'}
                                className={`inline-flex items-center px-1.5 py-0.5 rounded border transition-colors ${
                                  isLinked
                                    ? 'border-brand-300 text-brand-600 bg-brand-50 hover:bg-brand-100 [--knock:#e8f0f9] hover:[--knock:#ccdcf0]'
                                    : 'border-line text-muted-2 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 [--knock:#ffffff] hover:[--knock:#e8f0f9]'
                                }`}
                              >
                                {isLinked
                                  ? <IconLockSplit knockout="var(--knock)" />
                                  : <IconLockSplitOpen knockout="var(--knock)" />}
                              </button>
                              {isLinked && !isDefaultSplit(ac, splits[ac]) && (
                                <span className="text-[10px] text-muted-3">
                                  custom ·{' '}
                                  <button
                                    type="button"
                                    onClick={() => handleResetSplit(ac)}
                                    title={defaultLabel}
                                    className="underline hover:text-brand-600"
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
                                  className="text-[10px] text-muted-3 underline hover:text-brand-600"
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
                              className="text-xs px-1.5 py-0.5 rounded border border-line text-muted-2 hover:border-brand-300 hover:text-brand-600 hover:bg-brand-50 transition-colors"
                            >
                              split
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="py-1.5">
                        <div className="flex items-center gap-1">
                          {isExpanded && isLinked ? (
                            <input
                              type="number"
                              value={composites[ac]}
                              step="0.1"
                              min="0"
                              max="100"
                              onChange={e => handleCompositeChange(ac, e.target.value)}
                              onBlur={commitWeights}
                              aria-label={`${AC_LABEL[ac]} combined target weight (%)`}
                              className="w-14 border border-line rounded-[7px] bg-paper px-2 py-1 text-right font-mono text-[12px] text-brand-ink"
                            />
                          ) : isExpanded ? (
                            <input
                              type="number"
                              value={subTotalOf(ac).toFixed(1)}
                              readOnly
                              disabled
                              title={`Sum of ${subs.map(s => AC_LABEL[s]).join(' + ')} targets`}
                              aria-label={`${AC_LABEL[ac]} target weight, sum of sub-classes (%)`}
                              className="w-14 border border-line-2 rounded-[7px] px-2 py-1 text-right font-mono text-[12px] text-muted-3 bg-transparent cursor-not-allowed"
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
                              aria-label={`${AC_LABEL[ac]} target weight (%)`}
                              className="w-14 border border-line rounded-[7px] bg-paper px-2 py-1 text-right font-mono text-[12px] text-brand-ink"
                            />
                          )}
                          <span className="text-muted-3 text-xs">%</span>
                        </div>
                      </td>
                      <td className="py-1.5 pl-3.5 pr-4"><CompareBar currentPct={curPct} targetPct={tgtPct} /></td>
                      <td className="py-1.5 text-right font-mono text-[12px]" style={currentToneStyle(curPct, tgtPct)}>
                        {curPct.toFixed(1)}
                      </td>
                    </tr>
                  );

                  if (!isExpanded) return [parentRow];

                  // ── Sub-class rows — indented; editable only when unlinked ──
                  const subRows = subs.map(sub => {
                    const subCur = (currentWeights[sub] ?? 0) * 100;
                    const splitCaption = isLinked && sub === subs[0] && isDefaultSplit(ac, splits[ac])
                      ? (ac === 'US_TOTAL_MARKET' ? 'split 67 / 25 / 8 · default' : 'default split')
                      : null;
                    return (
                    <tr key={sub} className="border-b border-line-3">
                      <td className="pl-6 py-1">
                        <span className="flex items-center gap-2 whitespace-nowrap">
                          <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ backgroundColor: AC_COLOR[sub] }} />
                          <span className={`text-xs ${isLinked ? 'text-muted-3' : 'text-muted-1'}`}>{AC_LABEL[sub]}</span>
                        </span>
                      </td>
                      <td className="py-1">
                        <div className="flex items-center gap-1">
                          {isLinked ? (
                            <input
                              type="number"
                              value={weights[sub]}
                              readOnly
                              disabled
                              aria-label={`${AC_LABEL[sub]} target weight (%)`}
                              className="w-14 border border-line-2 rounded-[7px] px-2 py-0.5 text-right font-mono text-[11.5px] text-muted-3 bg-transparent cursor-not-allowed"
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
                              aria-label={`${AC_LABEL[sub]} target weight (%)`}
                              className="w-14 border border-line rounded-[7px] bg-paper px-2 py-0.5 text-right font-mono text-[11.5px]"
                            />
                          )}
                          <span className={`text-xs ${isLinked ? 'text-faint' : 'text-muted-3'}`}>%</span>
                        </div>
                      </td>
                      <td className="py-1 pl-3.5 pr-4 font-mono text-[10px] text-faint">
                        {splitCaption}
                      </td>
                      <td className="py-1 text-right font-mono text-[11.5px] text-muted-2">
                        {subCur.toFixed(1)}
                      </td>
                    </tr>
                    );
                  });

                  return [parentRow, ...subRows];
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} className="pt-2.5">
                    <div className="flex items-center justify-between border-t border-line-2 pt-2.5">
                      <span className={`font-mono text-[11px] inline-flex items-center gap-1 ${sumOk ? 'text-ok' : 'text-danger'}`}>
                        Sum {sum.toFixed(1)}% {sumOk ? <IconCheck size={12} /> : '⚠'}
                      </span>
                      <span className="flex gap-2">
                        <button
                          type="button"
                          onClick={resetTargetsToDefaults}
                          title="Restore the built-in default target allocation"
                          className="font-sans text-[12px] font-medium text-muted-1 bg-white border border-line rounded-[7px] px-2.5 py-1 hover:border-muted-2 transition-colors whitespace-nowrap"
                        >
                          Reset to defaults
                        </button>
                        <button
                          type="button"
                          onClick={normalizeToHundred}
                          title="Proportionally rescale every target so they sum to exactly 100%"
                          className="font-sans text-[12px] font-semibold text-white bg-brand-600 border-none rounded-[7px] px-3 py-1 hover:bg-brand-700 transition-colors whitespace-nowrap"
                        >
                          Normalize to 100%
                        </button>
                      </span>
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table></div>
          </div>

          {/* ── Vertical divider ── */}
          <div className="w-px self-stretch bg-line-2" />

          {/* ── Pie chart + risk profile — fills remaining space, vertically centred ── */}
          <div className="flex-[0.85] flex flex-col items-center justify-center gap-5 py-6 px-8">

            {/* Pie */}
            <div className="flex flex-col items-center gap-2">
              <span className="font-mono text-[10px] tracking-[.08em] uppercase text-muted-3">Target allocation</span>
              <WeightPie slices={targetPieSlices} size={200} />
            </div>

            {/* Risk-profile gauge */}
            <div className="w-full max-w-[200px] space-y-1.5 pt-4 border-t border-gray-100">
              <p className={`text-center text-xs font-semibold ${riskColor}`}>{riskLabel}</p>
              <div className="relative h-2 rounded-full overflow-visible" style={{
                // Kit tones, conservative → aggressive (#194 color fix): steel →
                // ok-green → gold → accent → danger.
                background: 'linear-gradient(to right, #7ba7c2, #1f8a5b, #c9a63f, #e8600a, #b3403a)',
              }}>
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-muted-1 shadow-sm transition-all"
                  style={{ left: `${Math.min(Math.max(growthPct, 2), 98)}%` }}
                />
              </div>
              <div className="flex justify-between font-mono text-[10px] text-faint leading-none">
                <span>Conservative</span>
                <span>Aggressive</span>
              </div>
              <p className="text-center font-mono text-[10px] text-muted-3 leading-none pt-0.5">
                {growthPct.toFixed(0)}% growth · {defensivePct.toFixed(0)}% defensive
              </p>
            </div>

            {/* Diversification gauge */}
            <div className="w-full max-w-[200px] space-y-1.5 pt-4 border-t border-gray-100">
              <p className={`text-center text-xs font-semibold ${diversColor}`}>{diversLabel}</p>
              <div className="relative h-2 rounded-full overflow-visible" style={{
                // Kit tones, concentrated → diversified (#194 color fix): the risk
                // ramp reversed — danger → accent → gold → ok-green → steel.
                background: 'linear-gradient(to right, #b3403a, #e8600a, #c9a63f, #1f8a5b, #7ba7c2)',
              }}>
                <div
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white border-2 border-muted-1 shadow-sm transition-all"
                  style={{ left: `${Math.min(Math.max(100 - concentrationScore, 2), 98)}%` }}
                />
              </div>
              <div className="flex justify-between font-mono text-[10px] text-faint leading-none">
                <span>Concentrated</span>
                <span>Diversified</span>
              </div>
              <p className="text-center font-mono text-[10px] text-muted-3 leading-none pt-0.5">
                {activeClasses} of {nLeaves} classes · {maxWeight.toFixed(0)}% largest
              </p>
            </div>

          </div>
        </div>

        {!sumOk && (
          <p className="px-4 pb-3 -mt-1 text-xs text-danger">
            Weights must sum to 100% (±0.1%). Adjust the values above, then click outside to apply — or use Normalize to 100%.
          </p>
        )}
            </>
          )}
        </div>
      </div>

      {/* ── Placement rules (editable) — collapsible kit card, same pattern as
          Target allocation above (#194 regression restore). ────────────── */}
      <div className="space-y-2">
        <div className="overflow-hidden border border-line rounded-xl shadow-[0_1px_2px_rgba(8,40,85,.04)]">
          <div className={`flex items-center gap-3 bg-tint ${placementCollapsed ? '' : 'border-b border-line'}`}>
            <button
              className="flex-1 min-w-0 px-4 py-2 flex items-center gap-3 hover:bg-tint-cell transition-colors text-left"
              onClick={() => setPlacementCollapsed(c => !c)}
              aria-expanded={!placementCollapsed}
            >
              <span className="text-muted-2 inline-flex shrink-0">{placementCollapsed ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}</span>
              <span className="font-mono text-[10px] tracking-[.12em] uppercase text-[#6b7685] truncate">Placement rules</span>
            </button>
            <span className="font-mono text-[10px] text-muted-3 px-4 py-2 shrink-0">Where each class prefers to live</span>
          </div>

          {!placementCollapsed && (
            <>
        <div className="px-4 pt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-1 max-w-xl">
            Preferred account home for each asset class. The engine fills the 1st choice first, then spills into 2nd. Tax-Advantaged can be left broad or drilled into Tax-Deferred (Traditional/401k) vs Tax-Free (Roth/HSA).
          </p>
          <button
            type="button"
            onClick={resetPlacementToRecommended}
            className="text-xs text-brand-600 hover:text-brand-800 hover:underline whitespace-nowrap shrink-0"
            title="Overwrite every placement rule with the recommended asset-location defaults (growth → Roth, taxable-coupon bonds → Traditional). Your current selections will be replaced."
          >
            Reset to recommended placement
          </button>
        </div>
        <div className="px-4 py-3">
          <div className="overflow-x-auto"><table className="w-full text-sm">
            <thead className="font-mono text-[10px] text-muted-3 uppercase tracking-[.06em] border-b border-line-2">
              <tr>
                <th className="px-4 py-1.5 text-left font-normal">Asset class</th>
                <th className="px-4 py-1.5 text-left font-normal">
                  1st choice
                  <HelpTip>
                    The engine fills accounts in this bucket first. If the bucket has enough
                    capacity, the entire class lands here and no spillover occurs.
                  </HelpTip>
                </th>
                <th className="px-4 py-1.5 text-left font-normal">
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
            <tbody className="divide-y divide-line-3 text-[12.5px]">
              {TOP_LEVEL_CLASSES.flatMap(ac => {
                const renderRow = (cls: AssetClass, depth: 0 | 1) => {
                  const buckets = placementBuckets(cls);
                  const noPreference = buckets.length === 0;
                  const isChild = depth > 0;
                  const parent = PARENT_CLASS[cls];
                  // A child with no explicit placement of its own inherits the parent's.
                  const inherits = isChild && !strategy.placement[cls];
                  return (
                    <tr key={cls} className={`hover:bg-paper ${isChild ? 'bg-gray-50/40' : ''}`}>
                      <td className={`py-1.5 ${isChild ? 'pl-10 pr-4' : 'px-4'}`}>
                        <span className={isChild ? 'text-xs text-gray-500' : 'text-gray-700'}>
                          {AC_LABEL[cls]}
                        </span>
                        {inherits && (
                          <span className="ml-2 text-[10px] text-gray-400 italic">inherits {AC_LABEL[parent!]}</span>
                        )}
                      </td>

                      {/* 1st choice — required; "No preference" relaxes placement entirely */}
                      <td className="px-4 py-1.5">
                        <select
                          value={noPreference ? NO_PREF : (buckets[0] ?? 'TAX_ADVANTAGED')}
                          onChange={e => updatePlacement(cls, 0, e.target.value as PlacementTarget | typeof NO_PREF)}
                          aria-label={`${AC_LABEL[cls]} — 1st placement choice`}
                          className="border border-gray-200 rounded px-2 py-1 text-[12.5px] bg-white hover:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400"
                        >
                          <option value={NO_PREF}>No preference</option>
                          {renderPlacementOptions(placementGroups, buckets[0], accounts)}
                        </select>
                      </td>

                      {/* 2nd choice — optional, empty = spill anywhere. Disabled when no preference. */}
                      <td className="px-4 py-1.5">
                        {noPreference ? (
                          <span className="text-xs text-gray-400 italic">placed wherever capacity exists</span>
                        ) : (
                          <select
                            value={buckets[1] ?? ''}
                            onChange={e => updatePlacement(cls, 1, e.target.value as PlacementTarget | '')}
                            aria-label={`${AC_LABEL[cls]} — 2nd placement choice`}
                            className="border border-gray-200 rounded px-2 py-1 text-[12.5px] bg-white hover:border-brand-400 focus:outline-none focus:ring-1 focus:ring-brand-400 text-gray-500"
                          >
                            <option value="">— none —</option>
                            {renderPlacementOptions(placementGroups, buckets[1], accounts)}
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
          </table></div>
        </div>
            </>
          )}
        </div>
      </div>

      {/* ── Rebalance bands (numeric params + toggles + tax-adjustment) ───────── */}
      <Card title="Rebalance bands" meta="Bogleheads 5/25">
      <div className="px-4 py-4 space-y-3">
        <p className="text-[12.5px] leading-relaxed text-muted-1 max-w-2xl">
          A class trades only when it drifts more than{' '}
          <span className="font-mono text-brand-ink">±5pp absolute</span> or{' '}
          <span className="font-mono text-brand-ink">±25% relative</span> from target. Classes inside
          their band are left alone — no churn, no dust trades.
        </p>
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
                aria-label="Absolute tolerance (percentage points)"
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
                aria-label="Relative tolerance (percent of target)"
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
                aria-label="Minimum trade size (dollars)"
                className="w-24 border rounded px-2 py-1.5 text-sm text-right"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Ignore trades smaller than this amount.
            </p>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">
              Rebalance target band
              <span className="ml-1 text-gray-400">(% of tolerance)</span>
              <HelpTip>
                How close to the ideal mix a rebalance aims once a class drifts past
                tolerance. The engine lands within this fraction of the tolerance band —
                tighter than the trigger — so there's drift headroom before the next
                rebalance. Default 50% (half the band). 100% = land anywhere inside
                tolerance (more drift, fewer trades).
              </HelpTip>
            </label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={targetFraction}
                step="10"
                min="1"
                max="100"
                onChange={e => setTargetFraction(e.target.value)}
                onBlur={commitWeights}
                aria-label="Rebalance target band (percent of tolerance)"
                className="w-20 border rounded px-2 py-1.5 text-sm text-right"
              />
              <span className="text-gray-400 text-xs">%</span>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Aim closer than the trigger band.
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
              strategy.preferTaxAdvantagedRebalance !== false ? 'bg-brand-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                strategy.preferTaxAdvantagedRebalance !== false ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Composite buys toggle (issue #49) */}
        <div className="flex items-start justify-between gap-4 max-w-2xl border-t border-gray-100 pt-3">
          <div>
            <div className="text-sm text-gray-700">Composite buys</div>
            <p className="text-xs text-gray-400 mt-0.5 max-w-md">
              Collapse several asset-class buys into one purchase of a blended fund
              (target-date, balanced) the account already holds, when the fund's
              composition matches. Fewer trades; only held funds with a known
              decomposition are used.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={strategy.preferCompositeBuys !== false}
            onClick={() => setStrategy({
              ...strategy,
              preferCompositeBuys: strategy.preferCompositeBuys === false,
            })}
            className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
              strategy.preferCompositeBuys !== false ? 'bg-brand-600' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                strategy.preferCompositeBuys !== false ? 'translate-x-6' : 'translate-x-1'
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
      </Card>
    </div>
  );
}
