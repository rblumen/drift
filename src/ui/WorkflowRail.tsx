// src/ui/WorkflowRail.tsx — the left workflow rail (#194 stage 2, design section 2a).
//
// Replaces the old horizontal tab strip on desktop (md+). Six numbered nav rows
// carry the workflow: a step number, the tab label, and a right slot that shows
// either a green completion check or a count badge (untagged tickers on Classify,
// resolved trades on Results). Below the nav, a footer holds the four global
// actions (Save / Load / Reset / How-it-works) and the privacy line.
//
// The rail keeps the WAI-ARIA tabs pattern from the old strip — role="tablist"
// with roving tabindex — but vertical: aria-orientation="vertical" and
// ArrowUp/Down (not Left/Right) move focus. Home/End and wrap are preserved. See
// handleRailKeyDown below. On mobile (< md) App.tsx renders the legacy horizontal
// tab bar instead; this component is desktop-only (hidden md:flex by the caller).
import { DriftWordmark } from './Logo';
import { IconDownload, IconUpload, IconX, IconCheck, IconInfo } from './icons';

export type RailTab = 'overview' | 'accounts' | 'positions' | 'classify' | 'strategy' | 'results';

/** Per-tab derived status the rail renders in the right slot. */
export interface RailStep {
  id: RailTab;
  label: string;
  /** Two-digit step number, "01".."06". */
  n: string;
  /** Step is complete → green check in the right slot. */
  done: boolean;
  /** Warn count badge (Classify untagged) — rendered when > 0 and not `done`. */
  warnCount?: number;
  /** Info count badge (Results trades) — rendered when > 0. */
  infoCount?: number;
}

interface Props {
  steps: RailStep[];
  activeTab: RailTab;
  onSelect: (tab: RailTab) => void;
  tabRefs: { current: Record<RailTab, HTMLButtonElement | null> };
  onKeyDown: (e: React.KeyboardEvent, index: number) => void;
  /** Wordmark click — return to the marketing landing page. */
  onBackHome: () => void;
  // Footer actions (unchanged handlers, only relocated from the old header).
  onSave: () => void;
  onLoad: () => void;
  onReset: () => void;
  onHowItWorks: () => void;
}

export function WorkflowRail({
  steps, activeTab, onSelect, tabRefs, onKeyDown, onBackHome,
  onSave, onLoad, onReset, onHowItWorks,
}: Props) {
  return (
    // Full height inside the h-screen desktop shell (App.tsx): wordmark header
    // top, footer pinned to the rail's bottom via flex. If the nav ever exceeds
    // the viewport height, the NAV region alone scrolls internally (min-h-0 +
    // overflow-y-auto) — the header and the footer actions never scroll away.
    <div className="hidden md:flex flex-none w-[218px] h-full bg-white border-r border-line flex-col">
      {/* Header — wordmark, keeps the back-to-landing click + title. */}
      <div className="px-[18px] pt-4 pb-3.5 border-b border-line-2 flex-none">
        <button
          onClick={onBackHome}
          className="p-0 border-0 bg-transparent cursor-pointer flex items-center"
          title="Back to Drift home"
        >
          <DriftWordmark height={26} />
        </button>
      </div>

      {/* Nav — vertical tablist. */}
      <nav
        role="tablist"
        aria-label="Workflow sections"
        aria-orientation="vertical"
        className="flex-1 min-h-0 overflow-y-auto flex flex-col gap-0.5 py-3.5"
      >
        <span className="font-mono text-[9.5px] tracking-[.14em] uppercase text-faint px-5 pb-2">
          Workflow
        </span>
        {steps.map((step, i) => {
          const active = activeTab === step.id;
          const isResults = step.id === 'results';
          // Results, when active, gets the accent-orange "payoff" treatment.
          const activeCls = active
            ? isResults
              ? 'border-l-[3px] border-accent bg-[#fdf6f0] text-accent-ink font-semibold'
              : 'border-l-[3px] border-brand-600 bg-rail-active text-brand-ink font-semibold'
            : 'border-l-[3px] border-transparent text-[#4a5769] font-medium hover:bg-tint';
          // Step number: accent orange when active, faint when idle.
          const numCls = active ? 'text-accent' : 'text-faint';
          return (
            <button
              key={step.id}
              ref={el => { tabRefs.current[step.id] = el; }}
              role="tab"
              id={`tab-${step.id}`}
              aria-selected={active}
              aria-controls={`panel-${step.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => onSelect(step.id)}
              onKeyDown={e => onKeyDown(e, i)}
              className={`flex items-center gap-2.5 text-[13px] text-left cursor-pointer transition-colors py-[7px] pr-[18px] pl-[15px] ${activeCls}`}
            >
              <span className={`font-mono text-[10px] ${numCls}`}>{step.n}</span>
              {step.label}
              <span className="ml-auto inline-flex items-center">
                {step.done ? (
                  <IconCheck size={11} className="text-ok" aria-label="Complete" />
                ) : step.warnCount && step.warnCount > 0 ? (
                  <span className="font-mono text-[10px] font-semibold text-warn bg-warn-bg rounded-full px-1.5 py-px leading-none">
                    {step.warnCount}
                  </span>
                ) : step.infoCount && step.infoCount > 0 ? (
                  <span
                    className={`font-mono text-[10px] font-semibold rounded-full px-1.5 py-px leading-none ${
                      isResults && active
                        ? 'text-accent-ink bg-accent-50'
                        : 'text-info bg-info-bg'
                    }`}
                  >
                    {step.infoCount}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Footer — four global actions + privacy line. Pinned to the rail's
          bottom; never scrolls (flex-none, nav absorbs overflow). */}
      <div className="px-[18px] pt-3 pb-3.5 border-t border-line-2 flex flex-col gap-2.5 flex-none">
        <div className="flex gap-1.5">
          <button
            onClick={onSave}
            title="Save portfolio as JSON"
            aria-label="Save portfolio as JSON"
            className="flex-1 inline-flex items-center justify-center text-muted-1 bg-white border border-line rounded-[7px] py-1.5 hover:border-muted-2 hover:text-ink transition-colors"
          >
            <IconDownload size={13} />
          </button>
          <button
            onClick={onLoad}
            title="Load portfolio from JSON"
            aria-label="Load portfolio from JSON"
            className="flex-1 inline-flex items-center justify-center text-muted-1 bg-white border border-line rounded-[7px] py-1.5 hover:border-muted-2 hover:text-ink transition-colors"
          >
            <IconUpload size={13} />
          </button>
          <button
            onClick={onReset}
            title="Clear all data"
            aria-label="Clear all data"
            className="flex-1 inline-flex items-center justify-center text-muted-2 bg-white border border-line rounded-[7px] py-1.5 hover:border-danger-hover-border hover:text-danger transition-colors"
          >
            <IconX size={13} />
          </button>
          <button
            onClick={onHowItWorks}
            title="How Drift works"
            aria-label="How it works"
            className="flex-1 inline-flex items-center justify-center text-info bg-info-bg border border-info-border rounded-[7px] py-1.5 hover:bg-brand-100 transition-colors"
          >
            <IconInfo size={13} />
          </button>
        </div>
        <span className="font-mono text-[9.5px] leading-relaxed text-faint">
          Private by default — nothing leaves your browser.
        </span>
      </div>
    </div>
  );
}
