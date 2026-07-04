// src/ui/OverviewPanel.tsx — operational dashboard (no orientation content)
//
// Orientation (what is Drift / why use it) lives on the LandingPage.
// This panel is purely status + navigation for a session already in progress.
import type { Account, Position } from '../engine/types';
import { fmtUsd } from './fmt';
import { IconCheck } from './icons';

// ── Types ─────────────────────────────────────────────────────────────────────
type AppTab = 'overview' | 'accounts' | 'import' | 'classify' | 'strategy' | 'results';
type StepState = 'done' | 'warn' | 'idle' | 'locked';

interface StepDef {
  n: string;
  name: string;
  tab: AppTab;
  desc: string;
  state: StepState;
  stat: string;
  payoff?: boolean;
}

interface Props {
  accounts:       Account[];
  positions:      Position[];
  unmappedCount:  number;
  householdValue: number;
  lastSavedAt:    Date | null;
  onNavigate:     (tab: AppTab) => void;
}

// ── Icons ─────────────────────────────────────────────────────────────────────
function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2.5 6.5L5.2 9.2L10.5 3.8"
        stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function WarnIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1.5L11.2 10.5H.8L6 1.5Z"
        stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <line x1="6" y1="5.5" x2="6" y2="7.8"
        stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6" cy="9.2" r="0.65" fill="currentColor" />
    </svg>
  );
}

// ── Step badge ────────────────────────────────────────────────────────────────
function Badge({ state, n, payoff }: { state: StepState; n: string; payoff?: boolean }) {
  const base = 'w-7 h-7 rounded-[8px] flex items-center justify-center mb-3 flex-none';
  if (state === 'done')
    return <div className={`${base} bg-ok-bg text-ok`}><CheckIcon /></div>;
  if (state === 'warn')
    return <div className={`${base} bg-warn-bg text-warn`}><WarnIcon /></div>;
  if (state === 'locked')
    return <div className={`${base} bg-tint text-faint font-mono text-[13px] font-semibold`}>—</div>;
  if (payoff)
    return <div className={`${base} bg-accent text-white font-mono text-[13px] font-semibold`}>{n}</div>;
  return <div className={`${base} bg-brand text-white font-mono text-[13px] font-semibold`}>{n}</div>;
}

// ── Status chip ───────────────────────────────────────────────────────────────
function Chip({ state, stat }: { state: StepState; stat: string }) {
  const clr: Record<StepState, string> = {
    done:   'bg-ok-bg text-ok',
    warn:   'bg-warn-bg text-warn',
    idle:   'bg-tint text-muted-2',
    locked: 'bg-tint text-muted-2',
  };
  const dot: Record<StepState, string> = {
    done:   'bg-ok',
    warn:   'bg-warn',
    idle:   'bg-faint',
    locked: 'bg-faint',
  };
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-[11px] px-2 py-0.5 rounded-full ${clr[state]}`}>
      <span className={`w-1.5 h-1.5 rounded-full flex-none ${dot[state]}`}></span>
      {stat}
    </span>
  );
}

// ── Connector arrow ───────────────────────────────────────────────────────────
function Arrow() {
  return (
    <svg className="hidden md:block absolute -right-[11px] top-7 w-[18px] h-[18px] text-gray-200 z-10 pointer-events-none"
      viewBox="0 0 18 18" fill="none">
      <path d="M3 9h11M10 5l4 4-4 4"
        stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function OverviewPanel({
  accounts, positions, unmappedCount, householdValue, lastSavedAt, onNavigate,
}: Props) {
  const hasAccounts  = accounts.length > 0;
  const hasPositions = positions.length > 0;
  const allClassified = hasPositions && unmappedCount === 0;

  // Step states
  const steps: StepDef[] = [
    {
      n: '1', name: 'Accounts', tab: 'accounts',
      desc: 'Name each account and its tax type.',
      state: hasAccounts ? 'done' : 'idle',
      stat:  hasAccounts ? `${accounts.length} account${accounts.length !== 1 ? 's' : ''}` : 'Not started',
    },
    {
      n: '2', name: 'Import', tab: 'import',
      desc: 'Upload a broker CSV or enter holdings.',
      state: hasPositions ? 'done' : 'idle',
      stat:  hasPositions ? `${positions.length} position${positions.length !== 1 ? 's' : ''}` : 'Not started',
    },
    {
      n: '3', name: 'Classify', tab: 'classify',
      desc: "Tag any tickers Drift doesn't recognize.",
      state: !hasPositions ? 'idle' : unmappedCount > 0 ? 'warn' : 'done',
      stat:  !hasPositions ? 'Not started' : unmappedCount > 0 ? `${unmappedCount} untagged` : 'All tagged',
    },
    {
      n: '4', name: 'Strategy', tab: 'strategy',
      desc: 'Set target weights and placement rules.',
      state: 'idle',
      stat:  'Defaults loaded',
    },
    {
      n: '5', name: 'Results', tab: 'results',
      desc: 'Get per-account buy/sell orders.',
      state:  !hasPositions || unmappedCount > 0 ? 'locked' : 'idle',
      stat:   !hasPositions || unmappedCount > 0 ? 'Needs classify' : 'Ready',
      payoff: true,
    },
  ];

  // Next action CTA
  let nextTab: AppTab   = 'accounts';
  let nextLabel = 'Get started';
  if (!hasAccounts)      { nextTab = 'accounts'; nextLabel = 'Get started'; }
  else if (!hasPositions){ nextTab = 'import';   nextLabel = 'Import positions'; }
  else if (unmappedCount > 0) { nextTab = 'classify'; nextLabel = `Classify ${unmappedCount} ticker${unmappedCount !== 1 ? 's' : ''}`; }
  else                   { nextTab = 'results';  nextLabel = 'View results'; }

  // Status strip sub-labels
  const acctSub = accounts.length === 0 ? '—'
    : accounts.length <= 3 ? accounts.map((a) => a.name).join(' · ')
    : `${accounts.slice(0, 2).map((a) => a.name).join(', ')} +${accounts.length - 2} more`;

  const fmtTime = (d: Date) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <div className="py-2">

      {/* ── Status strip ────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-0.5 bg-gray-200 rounded-xl overflow-hidden border border-gray-200 mb-8">
        {/* Accounts */}
        <div className="bg-white px-4 py-3.5 flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[.12em] uppercase text-gray-400">Accounts</span>
          <span className={`font-semibold text-xl tracking-tight ${hasAccounts ? 'text-gray-900' : 'text-gray-300'}`}>
            {hasAccounts ? accounts.length : '—'}
          </span>
          <span className="font-mono text-[11px] text-gray-400 truncate">{acctSub}</span>
        </div>
        {/* Positions */}
        <div className="bg-white px-4 py-3.5 flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[.12em] uppercase text-gray-400">Positions</span>
          <span className={`font-semibold text-xl tracking-tight ${hasPositions ? 'text-gray-900' : 'text-gray-300'}`}>
            {hasPositions ? positions.length : '—'}
          </span>
          <span className="font-mono text-[11px] text-gray-400">Across all accounts</span>
        </div>
        {/* Unclassified */}
        <div className="bg-white px-4 py-3.5 flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[.12em] uppercase text-gray-400">Unclassified</span>
          <span className={`inline-flex items-center font-semibold text-xl tracking-tight leading-7 ${
            !hasPositions ? 'text-gray-300' :
            unmappedCount > 0 ? 'text-warn' : 'text-ok'
          }`}>
            {!hasPositions ? '—' : unmappedCount > 0 ? unmappedCount : <IconCheck size={20} aria-label="All tagged" />}
          </span>
          <span className="font-mono text-[11px] text-gray-400">
            {!hasPositions ? 'No positions' : unmappedCount > 0 ? 'Need tagging' : 'All tagged'}
          </span>
        </div>
        {/* Household value */}
        <div className="bg-white px-4 py-3.5 flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[.12em] uppercase text-gray-400">Household value</span>
          <span className={`font-semibold text-xl tracking-tight ${householdValue > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
            {householdValue > 0 ? fmtUsd(householdValue) : '—'}
          </span>
          <span className="font-mono text-[11px] text-gray-400">As of last import</span>
        </div>
        {/* Last saved */}
        <div className="bg-white px-4 py-3.5 flex flex-col gap-0.5">
          <span className="font-mono text-[10px] tracking-[.12em] uppercase text-gray-400">Last saved</span>
          <span className={`font-semibold text-base tracking-tight pt-0.5 ${lastSavedAt ? 'text-gray-900' : 'text-gray-300'}`}>
            {lastSavedAt ? fmtTime(lastSavedAt) : 'Never'}
          </span>
          <span className="font-mono text-[11px] text-gray-400">
            {lastSavedAt ? 'Local storage' : 'Not yet saved'}
          </span>
        </div>
      </div>

      {/* ── Workflow stepper ────────────────────────────────────────────────── */}
      <div className="flex items-baseline justify-between mb-4">
        <span className="font-semibold text-[15px] text-gray-900">Workflow</span>
        <span className="font-mono text-[11px] tracking-[.16em] uppercase text-gray-400">
          {!hasAccounts ? 'Not started'
            : !hasPositions ? 'Step 1 of 5'
            : unmappedCount > 0 ? 'Step 3 of 5 · needs attention'
            : allClassified ? 'Ready for results'
            : 'In progress'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 relative">
        {steps.map((step, i) => {
          const borderCls =
            step.state === 'done'   ? 'border-ok/40' :
            step.state === 'warn'   ? 'border-warn-banner-border' :
            step.state === 'locked' ? 'border-line-2 opacity-50' :
            'border-line';
          const hoverCls = step.state === 'locked' ? 'pointer-events-none' :
            'hover:border-brand-200 hover:shadow-[0_8px_24px_-16px_rgba(13,62,122,0.2)] cursor-pointer';
          return (
            <button key={step.n}
              type="button"
              disabled={step.state === 'locked'}
              onClick={() => step.state !== 'locked' && onNavigate(step.tab)}
              className={`text-left w-full block bg-white border ${borderCls} ${hoverCls} rounded-[13px] p-4 relative transition-all disabled:cursor-default`}
            >
              <Badge state={step.state} n={step.n} payoff={step.payoff} />
              <div className="font-semibold text-[14.5px] text-gray-900 mb-1">{step.name}</div>
              <div className="text-xs text-gray-500 leading-snug mb-2.5">{step.desc}</div>
              <Chip state={step.state} stat={step.stat} />
              {i < steps.length - 1 && <Arrow />}
            </button>
          );
        })}
      </div>

      {/* ── CTA ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-4 mt-7 flex-wrap">
        <button
          onClick={() => onNavigate(nextTab)}
          className="inline-flex items-center gap-2 bg-brand text-white font-semibold text-sm px-5 py-2.5 rounded-lg hover:bg-brand-ink transition-colors"
        >
          {nextLabel} <span aria-hidden="true">→</span>
        </button>
        {hasAccounts && (
          <button
            onClick={() => onNavigate('accounts')}
            className="text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors"
          >
            Edit accounts
          </button>
        )}
      </div>

      {/* ── Privacy footnote ────────────────────────────────────────────────── */}
      <p className="font-mono text-[11.5px] text-gray-400 mt-10 pt-4 border-t border-gray-100 leading-relaxed">
        Private by default — all computation runs in your browser; your financial data never leaves it. No cookies, no personal data.
      </p>

    </div>
  );
}
