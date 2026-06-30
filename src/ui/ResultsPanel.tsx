// src/ui/ResultsPanel.tsx — Brand-styled drop-in replacement
// Diff from original:
//   • BUY badge/amount  → Anchor Blue  (was green)
//   • SELL badge/amount → Burnt Orange (was red)
//   • Drift: over  → #b34500, under → #1a5fa0; adds inline progress bars
//   • Household section: DonutChart (concentric outer=target inner=current)
//     replaces the two-small-pie grid
//   • Tabular/mono figures throughout
//   • indigo UI chrome → brand blue

import { useState, useRef, useEffect } from 'react';
import type { Account, AssetClass, Flag, RebalanceResult, ResolvedTrade } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { withdrawalPriorityOf, isWithdrawalEligible } from '../engine/rebalance';
import { isTaxableSale } from '../engine/taxableSale';
import { isChildClass, isParentClass, childrenOf } from '../engine/hierarchy';
import { AC_COLOR, AC_LABEL, ACCT_TYPE_LABEL, fmtUsd, fmtPct, fmtDelta } from './fmt';
import { PieChart } from './PieChart';
import type { PieSlice } from './PieChart';
import { DonutChart } from './DonutChart';
import type { DonutSlice } from './DonutChart';
import { AllocationPlot } from './AllocationPlot';
import { downloadReport } from './exportReport';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';
import type { Reminder } from '../ingest/schema';
import { ReminderPanel, daysUntil } from './ReminderPanel';

// ── Brand palette helpers ─────────────────────────────────────────────────────
// Using CSS custom props where possible so they respect any overrides in
// the user's tailwind.config / index.css.
const BRAND      = 'var(--brand, #0d3e7a)';
const BRAND_2    = 'var(--brand-2, #1a5fa0)';
const BRAND_50   = 'var(--brand-50, #e8f0f8)';
const ORANGE_2   = '#b34500';
const ORANGE_50  = '#fdf0ea';

interface Props {
  result: RebalanceResult;
  accounts: Account[];
  resolvedTrades: ResolvedTrade[];
  freeCash: number;
  plannedWithdrawal: number;
  reminder: Reminder;
  setReminder: (r: Reminder) => void;
  onSave?: () => void;
}

// ── Flag banners ──────────────────────────────────────────────────────────────
// Semantic alert colors are intentional — they communicate severity, not brand.

function FlagBanner({ flag, accounts }: { flag: Flag; accounts: Account[] }) {
  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;

  if (flag.kind === 'REVISIT_PLACEMENT') {
    return (
      <div className="bg-orange-50 border border-orange-300 rounded-lg px-4 py-3 text-sm text-orange-800">
        <strong>Revisit placement strategy.</strong>{' '}
        Taxable accounts hold {fmtPct(flag.taxableShare)} of household value, which exceeds
        the {fmtPct(flag.fixedIncomeTarget)} fixed-income target.
        Consider updating your placement rules.
      </div>
    );
  }
  if (flag.kind === 'TAXABLE_SALE') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Taxable sale:</strong>{' '}
        Selling {fmtUsd(flag.amountUsd)} of {AC_LABEL[flag.assetClass]} in{' '}
        <em>{acctName(flag.accountId)}</em> may trigger a capital gain. Review before executing.
      </div>
    );
  }
  if (flag.kind === 'TAXABLE_REBALANCE_AVOIDABLE') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Avoidable taxable sale:</strong>{' '}
        About {fmtUsd(flag.amountUsd)} of the {AC_LABEL[flag.assetClass]} sale in{' '}
        <em>{acctName(flag.accountId)}</em> could be avoided by rebalancing within your
        tax-advantaged accounts.
      </div>
    );
  }
  if (flag.kind === 'PLACEMENT_SPILLOVER') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        <strong>Placement spillover:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of {AC_LABEL[flag.assetClass]} placed in a{' '}
        {flag.bucket.toLowerCase().replace('_', '-')} account (preferred bucket full).
      </div>
    );
  }
  if (flag.kind === 'UNMAPPED_HOLDING') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Unmapped holding:</strong>{' '}
        Ticker <code className="font-mono">{flag.ticker}</code> has no asset class.
        Go to the Classify tab to assign one.
      </div>
    );
  }
  if (flag.kind === 'NO_ELIGIBLE_ACCOUNT') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
        <strong>No eligible account:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of {AC_LABEL[flag.assetClass]} could not be placed —
        no account has capacity for this asset class.
      </div>
    );
  }
  if (flag.kind === 'PROJECTED_OFF_TARGET') {
    const gap = flag.projectedWeight - flag.targetWeight;
    const over = gap > 0;
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
        <strong>Target not reachable — {AC_LABEL[flag.assetClass]}:</strong>{' '}
        projects to <strong>{fmtPct(flag.projectedWeight)}</strong> after trades
        (target {fmtPct(flag.targetWeight)}, still{' '}
        <strong>{over ? '+' : ''}{fmtPct(gap)}</strong> off).{' '}
        {over
          ? 'A locked position likely exceeds the target.'
          : 'No eligible account or a minimum-trade filter is preventing full rebalancing.'}
      </div>
    );
  }
  if (flag.kind === 'EXCESS_CASH') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Free cash undeployed:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of household free cash could not be distributed — every
        eligible account is closed, locked, or has hit its deposit limit.
      </div>
    );
  }
  if (flag.kind === 'WITHDRAWAL_SHORTFALL') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Withdrawal not fully funded:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of the additional withdrawal could not be raised.
        Mark another account Eligible to cover it.
      </div>
    );
  }
  if (flag.kind === 'BLENDED_FUND_SOLD') {
    return (
      <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-700">
        <strong>Blended fund sold:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of <code className="font-mono">{flag.ticker}</code> in{' '}
        <em>{acctName(flag.accountId)}</em> sold proportionally. Lock the position to preserve it.
      </div>
    );
  }
  if (flag.kind === 'BLENDED_FUND_OVERSELL') {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-sm text-red-700">
        <strong>Blended fund over-sell:</strong>{' '}
        Selling <code className="font-mono">{flag.ticker}</code> in{' '}
        <em>{acctName(flag.accountId)}</em> forced an extra {fmtUsd(flag.amountUsd)} of{' '}
        {AC_LABEL[flag.assetClass]} to be sold with no eligible buy-back ticker.
      </div>
    );
  }
  if (flag.kind === 'MISSING_COST_BASIS') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Missing cost basis:</strong>{' '}
        <code className="font-mono">{flag.ticker}</code> in{' '}
        <em>{acctName(flag.accountId)}</em> has no cost basis recorded. Add it in the Import tab.
      </div>
    );
  }
  return null;
}

function WashSaleBanner({ flags, accounts }: { flags: Flag[]; accounts: Account[] }) {
  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const risks = flags.filter((f): f is Extract<Flag, { kind: 'WASH_SALE_RISK' }> => f.kind === 'WASH_SALE_RISK');
  if (risks.length === 0) return null;
  return (
    <div className="bg-red-50 border border-red-300 rounded-lg px-4 py-3 text-sm text-red-800">
      <strong>Possible wash sale.</strong>{' '}
      Selling in a taxable account and buying the same asset class within 30 days
      may trigger the wash-sale rule. Consult your tax advisor.
      <ul className="mt-2 list-disc list-inside space-y-1">
        {risks.map((f, i) => (
          <li key={i}>
            {AC_LABEL[f.assetClass]}: selling in <em>{acctName(f.taxableAccountId)}</em>,
            buying in <em>{acctName(f.buyAccountId)}</em>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Allocation table row ──────────────────────────────────────────────────────

function AllocationRow({
  ac, current, target, projected, taCurrent, taProjected, depth = 0,
}: {
  ac: AssetClass; current: number; target: number; projected: number;
  taCurrent?: number; taProjected?: number; depth?: 0 | 1;
}) {
  const drift    = current - target;
  const showTA   = taCurrent !== undefined && taProjected !== undefined;
  const isChild  = depth > 0;

  // Drift bar: 8% abs = full bar width
  const driftAmt  = Math.abs(drift);
  const showBar   = driftAmt > 0.005;
  const barWidth  = `${Math.min(driftAmt / 0.08, 1) * 100}%`;
  const barColor  = drift > 0 ? ORANGE_2 : BRAND_2;
  const driftTextColor = drift > 0.001 ? ORANGE_2 : drift < -0.001 ? BRAND_2 : undefined;

  return (
    <tr className={`border-t border-gray-100 ${isChild ? 'bg-gray-50/40' : ''}`}>
      <td className={`py-3 ${isChild ? 'pl-10 pr-4 text-gray-500 font-normal text-xs' : 'px-4 text-gray-700 font-medium'}`}>
        {AC_LABEL[ac]}
      </td>
      <td className="px-4 py-3 text-right font-mono tabular-nums text-[13px]">{fmtPct(current)}</td>
      <td className="px-4 py-3 text-right font-mono tabular-nums text-[13px] text-gray-500">{fmtPct(target)}</td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span
            className="font-mono tabular-nums text-[12.5px]"
            style={{ color: driftTextColor ?? '#9ca3af' }}
          >
            {drift >= 0 ? '+' : ''}{fmtPct(drift)}
          </span>
          {showBar && (
            <div className="flex-1 h-[3px] bg-gray-100 rounded overflow-hidden min-w-[32px] max-w-[72px]">
              <div className="h-full rounded" style={{ width: barWidth, background: barColor }} />
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right font-mono tabular-nums text-[13px] text-gray-500">{fmtPct(projected)}</td>
      {showTA && (
        <>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-[13px] border-l border-gray-100"
            style={{ color: BRAND }}>
            {fmtPct(taCurrent!)}
          </td>
          <td className="px-4 py-3 text-right font-mono tabular-nums text-[13px]"
            style={{ color: BRAND_2 }}>
            {fmtPct(taProjected!)}
          </td>
        </>
      )}
    </tr>
  );
}

// ── Trade row ─────────────────────────────────────────────────────────────────

function TradeRow({ trade }: { trade: ResolvedTrade }) {
  const isBuy = trade.deltaUsd > 0;
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2">
        {trade.ticker ? (
          <div>
            <span className="font-mono font-semibold text-gray-800">{trade.ticker}</span>
            <div className="text-xs text-gray-400">{AC_LABEL[trade.assetClass]}</div>
          </div>
        ) : (
          <span className="text-gray-600">{AC_LABEL[trade.assetClass]}</span>
        )}
      </td>
      <td className="px-4 py-2">
        <span
          className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full tracking-wide"
          style={{
            background: isBuy ? BRAND_50 : ORANGE_50,
            color:      isBuy ? BRAND    : ORANGE_2,
          }}
        >
          {isBuy ? 'BUY' : 'SELL'}
        </span>
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-[14px]">
        <span style={{ color: isBuy ? BRAND : ORANGE_2 }}>
          {fmtDelta(trade.deltaUsd)}
        </span>
      </td>
      {isTaxableSale(trade)
        ? <td className="px-4 py-2 text-xs text-amber-600">⚠ taxable sale</td>
        : <td className="px-4 py-2" />}
    </tr>
  );
}

// ── Transfer row (deposit / withdrawal) ───────────────────────────────────────

function TransferRow({ kind, amountUsd }: { kind: 'deposit' | 'withdrawal'; amountUsd: number }) {
  const isDeposit = kind === 'deposit';
  return (
    <tr className="border-t border-gray-100" style={{ background: isDeposit ? '#f0f5fb' : '#fffbeb' }}>
      <td className="px-4 py-2">
        <span className="text-gray-700">{isDeposit ? 'Transfer in' : 'Transfer out'}</span>
        <div className="text-xs text-gray-400">
          {isDeposit ? 'Deposit from household free cash' : 'Withdrawal'}
        </div>
      </td>
      <td className="px-4 py-2">
        <span
          className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full tracking-wide"
          style={{
            background: isDeposit ? BRAND_50        : '#fef3c7',
            color:      isDeposit ? BRAND           : '#92400e',
          }}
        >
          {isDeposit ? 'DEPOSIT' : 'WITHDRAW'}
        </span>
      </td>
      <td className="px-4 py-2 text-right font-mono tabular-nums font-semibold text-[14px]">
        <span style={{ color: isDeposit ? BRAND : '#d97706' }}>
          {isDeposit ? '+' : '−'}{fmtUsd(amountUsd)}
        </span>
      </td>
      <td className="px-4 py-2 text-xs text-gray-400">transfer</td>
    </tr>
  );
}

// ── Pie slice builder (per-account mini-pies) ─────────────────────────────────

function buildPieSlices(byClass: Record<AssetClass, number>): PieSlice[] {
  return ALL_ASSET_CLASSES
    .filter(ac => byClass[ac] > 0.5)
    .map(ac => ({ label: AC_LABEL[ac], value: byClass[ac], color: AC_COLOR[ac] }));
}

// ── Contribution-first funding breakdown ──────────────────────────────────────

function ContributionSummary({ summary }: { summary: RebalanceResult['contributionSummary'] }) {
  const { newCashDeployed, sellsUsd, withdrawalRaised } = summary;
  if (newCashDeployed <= 0 && sellsUsd <= 0) return null;
  return (
    <div className="border border-gray-200 rounded-lg p-4 space-y-3">
      <h3 className="text-sm font-medium text-gray-700">How this rebalance is funded</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2">
          <div className="text-xs text-green-700">Funded by new &amp; free cash</div>
          <div className="text-lg font-mono font-semibold text-green-800 tabular-nums">{fmtUsd(newCashDeployed)}</div>
        </div>
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <div className="text-xs text-amber-700">Requires sales</div>
          <div className="text-lg font-mono font-semibold text-amber-800 tabular-nums">{fmtUsd(sellsUsd)}</div>
        </div>
      </div>
      {withdrawalRaised > 0 && (
        <p className="text-xs text-amber-700">
          Net cash raised by this drawdown: <strong>{fmtUsd(withdrawalRaised)}</strong>
        </p>
      )}
      <p className="text-xs text-gray-500">
        New contributions are directed to underweight classes first, avoiding sales where possible.
      </p>
    </div>
  );
}

// ── Feedback section ────────────────────────────────────────────────────────

type FeedbackState = 'none' | 'good' | 'mixed' | 'bad';

const FEEDBACK_OPTIONS: { val: FeedbackState; label: string }[] = [
  { val: 'good',  label: 'Went well' },
  { val: 'mixed', label: 'Mixed' },
  { val: 'bad',   label: "Didn't work for me" },
];

function FeedbackSection() {
  const [fbState, setFbState] = useState<FeedbackState>('none');
  const [copied,  setCopied]  = useState(false);
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (fbState !== 'none' && revealRef.current) {
      const top = revealRef.current.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top, behavior: 'smooth' });
    }
  }, [fbState]);

  function copyLink() {
    navigator.clipboard?.writeText(window.location.href).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="border-t border-gray-100 pt-8 mt-2 text-center">
      <p className="font-semibold text-[14px] text-gray-700 mb-4">
        How did the rebalance go?
      </p>
      <div className={`flex gap-2 flex-wrap justify-center ${fbState !== 'none' ? 'mb-6' : ''}`}>
        {FEEDBACK_OPTIONS.map(({ val, label }) => (
          <button key={val}
            onClick={() => setFbState(s => s === val ? 'none' : val)}
            className={`text-sm font-medium px-[18px] py-2 rounded-lg border transition-colors ${
              fbState === val
                ? 'border-brand-400 bg-brand-50 text-brand font-semibold'
                : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {fbState === 'good' && (
        <div ref={revealRef} className="text-left">
          <p className="text-[13px] text-gray-500 mb-4">Glad to hear it.</p>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
              <div>
                <div className="font-mono text-[10.5px] text-brand-400 uppercase tracking-[.08em] mb-1.5">Share Drift</div>
                <p className="text-[13px] text-gray-500 leading-relaxed">Know someone who manages their own portfolio? Send them this link.</p>
              </div>
              <button onClick={copyLink}
                className="self-start text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors">
                {copied ? '\u2713 Copied' : 'Copy link'}
              </button>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3">
              <div>
                <div className="font-mono text-[10.5px] text-brand-400 uppercase tracking-[.08em] mb-1.5">Support the project</div>
                <p className="text-[13px] text-gray-500 leading-relaxed">Drift is a solo project. If it saved you time, consider buying me a coffee.</p>
              </div>
              <a href="#"
                className="self-start inline-flex items-center gap-1.5 text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors">
                Support →<span className="font-mono text-[10.5px] text-gray-400 ml-1">(coming soon)</span>
              </a>
            </div>
          </div>
        </div>
      )}

      {(fbState === 'mixed' || fbState === 'bad') && (
        <div ref={revealRef} className="text-left">
          <p className="text-[13px] text-gray-500 mb-4">Thanks for letting us know.</p>
          <div className="bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3 max-w-sm">
            <div>
              <div className="font-mono text-[10.5px] text-brand-400 uppercase tracking-[.08em] mb-1.5">Leave feedback</div>
              <p className="text-[13px] text-gray-500 leading-relaxed">Your input directly shapes what gets built next. What's working? What's missing?</p>
            </div>
            <a
              href={`https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${import.meta.env.VITE_GIT_SHA ?? 'dev'}`}
              target="_blank" rel="noopener noreferrer"
              className="self-start text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg border border-gray-200 hover:border-gray-400 transition-colors">
              Leave feedback →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Next steps section ───────────────────────────────────────────────────────

interface NextStepsSectionProps {
  result:            RebalanceResult;
  accounts:          Account[];
  resolvedTrades:    ResolvedTrade[];
  freeCash:          number;
  plannedWithdrawal: number;
  reminder:          Reminder;
  setReminder:       (r: Reminder) => void;
  onSave?:           () => void;
}

function NextStepsSection({
  result, accounts, resolvedTrades, freeCash, plannedWithdrawal,
  reminder, setReminder, onSave,
}: NextStepsSectionProps) {
  const card = 'bg-white border border-gray-200 rounded-xl p-5 flex flex-col gap-3';
  const num  = 'font-mono text-[10.5px] text-brand-400 uppercase tracking-[.08em] mb-1.5';
  return (
    <div className="mt-10 space-y-4">
      <div className="font-mono text-[11px] text-gray-400 uppercase tracking-[.09em]">Next steps</div>
      <div className="grid grid-cols-3 gap-3">
        {/* 01 Download */}
        <div className={card}>
          <div>
            <div className={num}>01</div>
            <div className="font-semibold text-[14px] text-gray-900">Download your files</div>
          </div>
          <p className="text-[13px] text-gray-500 leading-relaxed flex-1">
            Your trade list as an interactive checklist. Save your portfolio file as a backup before making changes at your broker.
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => downloadReport(result, accounts, resolvedTrades, freeCash, plannedWithdrawal)}
              className="inline-flex items-center gap-1.5 bg-brand text-white text-[12.5px] font-semibold px-3.5 py-1.5 rounded-lg hover:bg-brand-ink transition-colors">
              \u2193 Trade report
            </button>
            {onSave && (
              <button onClick={onSave}
                className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-600 text-[12.5px] font-medium px-3.5 py-1.5 rounded-lg hover:border-gray-400 transition-colors">
                \u2193 Portfolio file
              </button>
            )}
          </div>
        </div>
        {/* 02 Execute */}
        <div className={card}>
          <div>
            <div className={num}>02</div>
            <div className="font-semibold text-[14px] text-gray-900">Execute your trades</div>
          </div>
          <p className="text-[13px] text-gray-500 leading-relaxed flex-1">
            Log into each broker account and work through the trades above. Start with sells to free up cash, then place buys.
          </p>
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-gray-200 flex-none"></span>
            <span className="font-mono text-[11px] text-gray-400">Happens at your broker — nothing to do here.</span>
          </div>
        </div>
        {/* 03 Schedule */}
        <div className={card}>
          <div>
            <div className={num}>03</div>
            <div className="font-semibold text-[14px] text-gray-900">Schedule your next run</div>
          </div>
          <ReminderPanel reminder={reminder} setReminder={setReminder} />
        </div>
      </div>
      <FeedbackSection />
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────────

export function ResultsPanel({
  result, accounts, resolvedTrades, freeCash, plannedWithdrawal, reminder, setReminder, onSave,
}: Props) {
  const {
    householdValue, currentWeights, targetWeights, projectedWeights,
    nativeValueByAccount, projectedNativeValueByAccount,
    withdrawalByAccount, depositByAccount, trades, flags, contributionSummary,
  } = result;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const importantFlags = [
    ...flags.filter(f => f.kind === 'EXCESS_CASH'),
    ...flags.filter(f => f.kind === 'WITHDRAWAL_SHORTFALL'),
    ...flags.filter(f => f.kind === 'NO_ELIGIBLE_ACCOUNT'),
    ...flags.filter(f => f.kind === 'PROJECTED_OFF_TARGET'),
    ...flags.filter(f => f.kind === 'REVISIT_PLACEMENT'),
    ...flags.filter(f => f.kind === 'UNMAPPED_HOLDING'),
    ...flags.filter(f => f.kind === 'TAXABLE_REBALANCE_AVOIDABLE'),
    ...flags.filter(f => f.kind === 'TAXABLE_SALE'),
    ...flags.filter(f => f.kind === 'BLENDED_FUND_OVERSELL'),
    ...flags.filter(f => f.kind === 'BLENDED_FUND_SOLD'),
    ...flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER'),
    ...flags.filter(f => f.kind === 'MISSING_COST_BASIS'),
  ];

  const totalRmd        = accounts.reduce((s, a) => s + (a.rmdDueUsd ?? 0), 0);
  const totalWithdrawal = totalRmd + plannedWithdrawal;
  const showCashSummary = freeCash > 0 || accounts.some(a => a.newCash);
  const showWithdrawalPlan = totalWithdrawal > 0;

  const withdrawalRows = accounts
    .filter(a => !a.locked)
    .map(a => ({ account: a, withdrawn: withdrawalByAccount[a.id] ?? 0, rmd: a.rmdDueUsd ?? 0 }))
    .filter(r => r.withdrawn > 0.5 || r.rmd > 0)
    .sort((x, y) => withdrawalPriorityOf(x.account) - withdrawalPriorityOf(y.account)
      || x.account.name.localeCompare(y.account.name));
  const totalRaised = withdrawalRows.reduce((s, r) => s + r.withdrawn, 0);

  const tradesByAccount = accounts
    .map(account => {
      const acctTrades = resolvedTrades
        .filter(t => t.accountId === account.id)
        .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
      const before = buildPieSlices(nativeValueByAccount[account.id] ?? {});
      const after  = buildPieSlices(projectedNativeValueByAccount[account.id] ?? {});
      return { account, trades: acctTrades, before, after };
    })
    .filter(g => g.trades.length > 0 || g.before.length > 0);

  if (householdValue === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Results</h2>
        <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-lg">
          No positions loaded yet. Add accounts and import positions to see recommendations.
        </p>
      </div>
    );
  }

  const reminderDays = reminder.nextDueAt !== undefined
    ? daysUntil(Date.now(), reminder.nextDueAt) : null;
  const showReminderBanner = reminderDays !== null && reminderDays <= 7;

  // Build concentric donut slices (outer = target, inner = current)
  const ta = result.taxAdjusted !== undefined;
  const vizCurrentWeights  = result.taxAdjusted?.currentWeights  ?? currentWeights;
  const vizProjectedWeights = result.taxAdjusted?.projectedWeights ?? projectedWeights;
  const vizTotal = result.taxAdjusted?.householdValue ?? householdValue;

  const donutInner: DonutSlice[] = ALL_ASSET_CLASSES
    .filter(ac => (vizCurrentWeights[ac] ?? 0) > 0.0005)
    .map(ac => ({ label: AC_LABEL[ac], weight: vizCurrentWeights[ac] ?? 0, color: AC_COLOR[ac] }));
  const donutOuter: DonutSlice[] = ALL_ASSET_CLASSES
    .filter(ac => (targetWeights[ac] ?? 0) > 0.0005)
    .map(ac => ({ label: AC_LABEL[ac], weight: targetWeights[ac] ?? 0, color: AC_COLOR[ac] }));

  // Also keep the pie slices for the AllocationPlot (needs hasBoth)
  const currentByClass = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, (vizCurrentWeights[ac] ?? 0) * vizTotal])
  ) as Record<AssetClass, number>;
  const projectedByClass = Object.fromEntries(
    ALL_ASSET_CLASSES.map(ac => [ac, (vizProjectedWeights[ac] ?? 0) * vizTotal])
  ) as Record<AssetClass, number>;
  const beforeSlices = buildPieSlices(currentByClass);
  const afterSlices  = buildPieSlices(projectedByClass);
  const hasBoth = beforeSlices.length > 0 && afterSlices.length > 0;

  return (
    <div className="space-y-6">

      {/* Reminder banner */}
      {showReminderBanner && reminder.nextDueAt !== undefined && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-3
            ${reminderDays! < 0
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-amber-50 border-amber-200 text-amber-800'}`}
          data-testid="reminder-banner"
        >
          <span className="text-lg leading-none mt-0.5">⏰</span>
          <div className="flex-1">
            <p className="font-medium">
              {reminderDays! < 0
                ? `Your rebalance is overdue by ${-reminderDays!} day${reminderDays === -1 ? '' : 's'}.`
                : reminderDays === 0
                  ? 'Your rebalance is due today.'
                  : `Your rebalance is due in ${reminderDays} day${reminderDays === 1 ? '' : 's'}.`}
            </p>
            <p className="text-xs mt-0.5 opacity-90">
              {reminder.lastRebalancedAt
                ? `Last rebalanced ${Math.max(0, Math.floor((Date.now() - reminder.lastRebalancedAt) / (24 * 60 * 60 * 1000)))} days ago — review the trades below.`
                : 'Review the trades below and mark as rebalanced when done.'}
            </p>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h2 className="text-lg font-semibold text-gray-800">Results</h2>
          <span className="text-sm text-gray-500">
            Household value:{' '}
            <strong className="font-mono text-gray-800 tabular-nums">{fmtUsd(householdValue)}</strong>
            {result.taxAdjusted && (
              <span className="ml-3 font-mono tabular-nums" style={{ color: BRAND_2 }}>
                After tax: <strong>{fmtUsd(result.taxAdjusted.householdValue)}</strong>
              </span>
            )}
          </span>
        </div>

      </div>

      <HelpBox label="About these results">
        <p>
          Results show the <strong>household allocation</strong> (all accounts combined) vs. your target,
          followed by per-account trade recommendations. Everything recalculates live.
        </p>
        <HelpSection title="Household allocation table">
          <HelpDef term="Current">Your actual allocation today, based on loaded positions.</HelpDef>
          <HelpDef term="Target">The target weight from your strategy.</HelpDef>
          <HelpDef term="Drift">Current minus Target. The bar shows magnitude — orange = over, blue = under.</HelpDef>
          <HelpDef term="After trades">Projected allocation once the recommended trades are executed.</HelpDef>
        </HelpSection>
        <HelpSection title="Recommended trades">
          <HelpDef term="BUY (blue)">Buy this amount of the asset class in this account.</HelpDef>
          <HelpDef term="SELL (orange)">Sell this amount. Check for taxable sale warnings before executing.</HelpDef>
        </HelpSection>
        <p className="text-gray-400 italic">
          These recommendations are mechanical calculations from your own inputs. Not investment advice.
        </p>
      </HelpBox>

      {/* Wash-sale banner */}
      <WashSaleBanner flags={flags} accounts={accounts} />

      {/* Priority flags */}
      {importantFlags.length > 0 && (
        <div className="space-y-2">
          {importantFlags.map((f, i) => (
            <FlagBanner key={i} flag={f} accounts={accounts} />
          ))}
        </div>
      )}

      {/* Cash deployment summary */}
      {showCashSummary && (
        <div className="border border-green-200 rounded-lg overflow-hidden">
          <div className="bg-green-50 px-4 py-2 text-xs font-medium text-green-800 flex items-center justify-between">
            <span>Cash deployment</span>
            {freeCash > 0 && (
              <span className="text-green-600 font-mono tabular-nums">
                {fmtUsd(freeCash)} household free cash distributed
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Account</th>
                <th className="px-4 py-2 text-right">In-account cash</th>
                {freeCash > 0 && <th className="px-4 py-2 text-right">Free cash share</th>}
                <th className="px-4 py-2 text-right">Net deployed</th>
                <th className="px-4 py-2 text-right">Deposits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.filter(a => !a.locked).map(a => {
                const ownCash = a.newCash ?? 0;
                const netDeploy = trades
                  .filter(t => t.accountId === a.id)
                  .reduce((s, t) => s + t.deltaUsd, 0);
                const depositsOpen = a.acceptsDeposits !== false;
                const limited = depositsOpen && a.depositLimitUsd != null;
                const freeCashShare = depositByAccount[a.id] ?? 0;
                if (ownCash === 0 && freeCash === 0) return null;
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{a.name}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-600">
                      {ownCash > 0 ? fmtUsd(ownCash) : '—'}
                    </td>
                    {freeCash > 0 && (
                      <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-600">
                        {depositsOpen && freeCashShare > 0.5
                          ? <span className="text-green-700">{fmtUsd(freeCashShare)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-medium">
                      {netDeploy > 0.5
                        ? <span className="text-green-700">+{fmtUsd(netDeploy)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        !depositsOpen ? 'bg-red-100 text-red-600'
                          : limited ? 'bg-amber-100 text-amber-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {!depositsOpen ? 'Closed'
                          : limited ? `Open · ${fmtUsd(a.depositLimitUsd!)} cap`
                          : 'Open'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Withdrawal plan */}
      {showWithdrawalPlan && (
        <div className="overflow-hidden border border-amber-200 rounded-lg">
          <div className="bg-amber-50 px-4 py-2 text-xs font-medium text-amber-900 flex items-center justify-between">
            <span>Spending / withdrawal plan</span>
            <span className="font-mono tabular-nums text-amber-700">
              {fmtUsd(totalRaised)} raised of {fmtUsd(totalWithdrawal)} planned
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Account</th>
                <th className="px-4 py-2 text-right">RMD due</th>
                <th className="px-4 py-2 text-right">Withdrawn</th>
                <th className="px-4 py-2 text-right">Withdrawals</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {withdrawalRows.map(({ account: a, withdrawn, rmd }) => {
                const required = rmd > 0;
                const restricted = !required && !isWithdrawalEligible(a);
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{a.name}</td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums text-gray-600">
                      {rmd > 0 ? <span style={{ color: BRAND_2 }}>{fmtUsd(rmd)}</span> : '—'}
                    </td>
                    <td className="px-4 py-2 text-right font-mono tabular-nums font-medium">
                      {withdrawn > 0.5
                        ? <span className="text-amber-700">−{fmtUsd(withdrawn)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        restricted ? 'bg-red-100 text-red-600'
                          : required ? 'bg-blue-100 text-blue-700'
                          : 'bg-green-100 text-green-700'
                      }`}>
                        {restricted ? 'Restricted' : required ? 'Required' : 'Eligible'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Funding breakdown */}
      <ContributionSummary summary={contributionSummary} />

      {/* Household allocation */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700">Household allocation</h3>
        <div className="overflow-hidden border border-gray-200 rounded-lg">

          {/* Visualization: concentric donut (outer=target, inner=current) + AllocationPlot */}
          <div className="p-4 border-b border-gray-100">
            <div className="flex items-start gap-6 flex-wrap">
              {(donutInner.length > 0 || donutOuter.length > 0) && (
                <DonutChart
                  inner={donutInner}
                  outer={donutOuter}
                  size={200}
                />
              )}
              {hasBoth && (
                <div className="flex-1 min-w-[220px]">
                  <AllocationPlot
                    currentWeights={currentWeights}
                    targetWeights={targetWeights}
                    projectedWeights={projectedWeights}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Allocation table */}
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Asset class</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    Drift
                    <HelpTip dir="up">
                      Current minus Target. Orange bar = over target, blue = under.
                      Within the tolerance band: no trade generated.
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    After trades
                    <HelpTip dir="left">
                      Projected allocation once all recommended trades execute.
                    </HelpTip>
                  </span>
                </th>
                {result.taxAdjusted && (
                  <>
                    <th className="px-4 py-3 text-right border-l border-gray-200 font-mono text-[10px]"
                      style={{ color: BRAND }}>
                      After-tax current
                    </th>
                    <th className="px-4 py-3 text-right font-mono text-[10px]" style={{ color: BRAND_2 }}>
                      After-tax projected
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {ALL_ASSET_CLASSES.filter(ac => !isChildClass(ac)).flatMap(ac => {
                const rows = [(
                  <AllocationRow
                    key={ac}
                    ac={ac}
                    current={currentWeights[ac]}
                    target={targetWeights[ac]}
                    projected={projectedWeights[ac]}
                    taCurrent={result.taxAdjusted?.currentWeights[ac]}
                    taProjected={result.taxAdjusted?.projectedWeights[ac]}
                  />
                )];
                if (isParentClass(ac)) {
                  for (const child of childrenOf(ac)) {
                    const cur  = currentWeights[child] ?? 0;
                    const tgt  = targetWeights[child] ?? 0;
                    const proj = projectedWeights[child] ?? 0;
                    const taC  = result.taxAdjusted?.currentWeights[child] ?? 0;
                    const taP  = result.taxAdjusted?.projectedWeights[child] ?? 0;
                    const visible = cur > 5e-4 || tgt > 5e-4 || proj > 5e-4 || taC > 5e-4 || taP > 5e-4;
                    if (!visible) continue;
                    rows.push(
                      <AllocationRow
                        key={child}
                        ac={child}
                        current={cur}
                        target={tgt}
                        projected={proj}
                        taCurrent={result.taxAdjusted?.currentWeights[child]}
                        taProjected={result.taxAdjusted?.projectedWeights[child]}
                        depth={1}
                      />,
                    );
                  }
                }
                return rows;
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-account trade sections */}
      {resolvedTrades.length === 0 ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Portfolio is within tolerance — no trades needed.
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Recommended trades</h3>

          {tradesByAccount.map(({ account, trades: acctTrades, before, after }) => {
            const deposit    = depositByAccount[account.id] ?? 0;
            const withdrawal = withdrawalByAccount[account.id] ?? 0;
            const netUsd     = deposit - withdrawal;
            const hasTransfer = deposit > 0.5 || withdrawal > 0.5;
            const isOpen  = !collapsed.has(account.id);
            const hasBothPies = before.length > 0 && after.length > 0;
            const locked  = account.locked;

            return (
              <div key={account.id} className="overflow-hidden border border-gray-200 rounded-lg">
                <button
                  className="w-full px-4 py-2.5 bg-gray-50 flex items-center gap-3 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => toggleCollapsed(account.id)}
                >
                  <span className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700">{account.name}</span>
                    <span className="text-xs text-gray-400">{account.institution} · {ACCT_TYPE_LABEL[account.type]}</span>
                    {locked && (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        🔒 locked
                      </span>
                    )}
                  </span>
                  {(acctTrades.length > 0 || hasTransfer) && (
                    <span className="text-xs text-gray-500 shrink-0 font-mono tabular-nums">
                      Net:{' '}
                      <span className={
                        Math.abs(netUsd) < 0.5 ? 'text-gray-500 font-medium'
                          : netUsd > 0 ? 'text-green-600 font-medium'
                          : 'font-medium'
                      }
                      style={netUsd < -0.5 ? { color: ORANGE_2 } : undefined}>
                        {fmtDelta(netUsd)}
                      </span>
                    </span>
                  )}
                  <span className="text-gray-400 text-xs ml-1">{isOpen ? '▾' : '▸'}</span>
                </button>

                {isOpen && (
                  <div>
                    {(before.length > 0 || after.length > 0) && (
                      <div className={`px-4 py-4 border-b border-gray-100 ${hasBothPies ? 'grid grid-cols-2 gap-6' : ''}`}>
                        {before.length > 0 && (
                          <PieChart title="Before" slices={before} size={88} />
                        )}
                        {after.length > 0 && (
                          <PieChart
                            title={acctTrades.length > 0 ? 'After trades' : 'Current'}
                            slices={after}
                            size={88}
                          />
                        )}
                      </div>
                    )}

                    {(acctTrades.length > 0 || hasTransfer) && (
                      <table className="w-full text-sm">
                        <thead className="text-xs text-gray-500 uppercase tracking-wide border-b border-gray-100">
                          <tr>
                            <th className="px-4 py-1.5 text-left">Asset class</th>
                            <th className="px-4 py-1.5 text-left">Action</th>
                            <th className="px-4 py-1.5 text-right">Amount</th>
                            <th className="px-4 py-1.5" />
                          </tr>
                        </thead>
                        <tbody>
                          {deposit > 0.5 && <TransferRow kind="deposit" amountUsd={deposit} />}
                          {acctTrades.map((t, i) => (
                            <TradeRow key={i} trade={t} />
                          ))}
                          {withdrawal > 0.5 && <TransferRow kind="withdrawal" amountUsd={withdrawal} />}
                        </tbody>
                      </table>
                    )}

                    {acctTrades.length === 0 && !hasTransfer && (
                      <p className="px-4 py-3 text-xs text-gray-400 italic">
                        No trades — portfolio is within tolerance for this account.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <NextStepsSection
        result={result}
        accounts={accounts}
        resolvedTrades={resolvedTrades}
        freeCash={freeCash}
        plannedWithdrawal={plannedWithdrawal}
        reminder={reminder}
        setReminder={setReminder}
        onSave={onSave}
      />
    </div>
  );
}
