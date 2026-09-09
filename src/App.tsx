// src/App.tsx — Drift branded shell
// Brand changes vs original:
//   • DriftWordmark (height=32) replaces tile Logo
//   • Active tab: brand-600 (Anchor Blue) replaces indigo-600
//   • Demo banner: brand-50/200/800 replaces indigo-50/200/800
//   • Results tab badge: brand-100/700 replaces indigo-100/700
//   • "How it works" hover: brand-200/brand-50 replaces indigo-200/indigo-50
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { Account, AssetClass, FundDecomposition, Position, Strategy } from './engine/types';
import { DEFAULT_STRATEGY } from './engine/strategy';
import { rebalance } from './engine/rebalance';
import { resolveTradeVehicles } from './engine/resolve';
import { makeClassifier } from './engine/classify';
import { OverviewPanel } from './ui/OverviewPanel';
import { AccountsPanel } from './ui/AccountsPanel';
import { PositionsPanel } from './ui/PositionsPanel';
import { ClassifyPanel } from './ui/ClassifyPanel';
import { StrategyPanel } from './ui/StrategyPanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { fmtUsd, rollupFamilies, ALLOCATION_FAMILIES } from './ui/fmt';
import { effectiveTolerance } from './engine/utils';
import { ALL_ASSET_CLASSES } from './engine/types';
import { DriftWordmark } from './ui/Logo';
import { HowItWorksDrawer } from './ui/HowItWorksDrawer';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { LandingPage } from './ui/LandingPage';
import { WorkflowRail, type RailStep } from './ui/WorkflowRail';
import { IconX, IconInfo, IconDownload, IconUpload } from './ui/icons';
import {
  buildState, clearState, DEFAULT_APP_STATE, saveJson, loadJson,
  loadState, saveState, saveBackup, type AppState,
} from './store';
import { appStateSchema, type Reminder } from './ingest/schema';
import SAMPLE_PORTFOLIO from './data/sample-portfolio.json';
import { Analytics } from '@vercel/analytics/react';

type Tab = 'overview' | 'accounts' | 'positions' | 'classify' | 'strategy' | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'positions', label: 'Positions' },
  { id: 'classify', label: 'Classify' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'results',  label: 'Results' },
];

// Plain localStorage flag (not part of the AppState schema/rebalancer-v1
// slot) recording that the user dismissed the beta banner (#152).
const BETA_BANNER_DISMISSED_KEY = 'rebalancer-beta-banner-dismissed';

// Demo mode: ?demo in the URL → load sample portfolio instead of localStorage.
const _demoRequested = new URLSearchParams(window.location.search).has('demo');
const _demoParsed    = _demoRequested ? appStateSchema.safeParse(SAMPLE_PORTFOLIO) : null;
const _isDemoInit    = _demoParsed?.success === true;
if (_isDemoInit) window.history.replaceState({}, '', window.location.pathname);

const loadResult = _isDemoInit ? null : loadState();
// The bundled sample portfolio is schema-valid, so the AppState cast holds
// (see the AppState type note in ingest/schema.ts).
const saved: AppState = (_isDemoInit && _demoParsed?.success)
  ? (_demoParsed.data as AppState)
  : (loadResult?.state ?? DEFAULT_APP_STATE);

export default function App() {
  const [accounts,          setAccounts]          = useState<Account[]>(saved.accounts);
  const [positions,         setPositions]          = useState<Position[]>(saved.positions);
  const [strategy,          setStrategy]          = useState<Strategy>(saved.strategy);
  const [tickerOverrides,   setTickerOverrides]   = useState<Record<string, AssetClass>>(saved.tickerOverrides);
  const [decompositions,    setDecompositions]    = useState<Record<string, FundDecomposition>>(saved.decompositions ?? {});
  const [freeCash,          setFreeCash]          = useState<number>(saved.freeCash ?? 0);
  const [plannedWithdrawal, setPlannedWithdrawal] = useState<number>(saved.plannedWithdrawal ?? 0);
  const [reminder,          setReminder]          = useState<Reminder>(saved.reminder ?? {});
  const [activeTab,         setActiveTab]         = useState<Tab>('overview');
  const [howItWorksOpen,    setHowItWorksOpen]    = useState(false);
  const [resetConfirmOpen,  setResetConfirmOpen]  = useState(false);
  const [loadError,         setLoadError]         = useState<string | null>(null);
  const [isDemoMode,        setIsDemoMode]        = useState<boolean>(_isDemoInit);
  // Returning users (saved state already on this device) and the ?demo deep
  // link both skip the marketing landing page and go straight to the app
  // (#147). First-run users with nothing saved still see it.
  const [showLanding,      setShowLanding]       = useState(!_isDemoInit && loadResult === null);
  const [restoredFromBackup, setRestoredFromBackup] = useState<number | null>(
    loadResult?.source === 'backup' ? (loadResult.backupTs ?? Date.now()) : null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    loadResult !== null ? new Date() : null,
  );
  // Beta banner dismissal is remembered persistently (plain localStorage flag,
  // separate from the AppState schema/rebalancer-v1 slot) so it stays gone
  // across sessions once dismissed (#152).
  const [betaBannerDismissed, setBetaBannerDismissed] = useState<boolean>(
    () => localStorage.getItem(BETA_BANNER_DISMISSED_KEY) === '1',
  );
  const dismissBetaBanner = useCallback(() => {
    localStorage.setItem(BETA_BANNER_DISMISSED_KEY, '1');
    setBetaBannerDismissed(true);
  }, []);

  const loadFileRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Record<Tab, HTMLButtonElement | null>>({} as Record<Tab, HTMLButtonElement | null>);

  /** WAI-ARIA tabs pattern with roving tabindex — only the active tab is
   *  tabbable. Both orientations are handled so the same routine drives the
   *  vertical desktop rail (ArrowUp/Down) and the horizontal mobile tab bar
   *  (ArrowLeft/Right); Home/End and wrap apply to both. */
  function handleTabKeyDown(e: React.KeyboardEvent, index: number) {
    let next = index;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')     next = (index + 1) % TABS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')   next = (index - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home')                               next = 0;
    else if (e.key === 'End')                                next = TABS.length - 1;
    else return;
    e.preventDefault();
    const nextTab = TABS[next].id;
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
  }

  const stateRef = useRef({ accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode });
  useEffect(() => {
    stateRef.current = { accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode };
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode]);

  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    // Demo state must never reach the primary save slot — the banner promises
    // "Your saved data is untouched" (#112). Persistence resumes when the user
    // exits demo mode (the banner dismiss restores the saved portfolio; Load /
    // Reset replace it explicitly).
    if (isDemoMode) return;
    saveState(buildState(accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder));
    setLastSavedAt(new Date());
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      // Same guard as the primary autosave: demo state must not rotate the
      // real portfolio out of the 3-slot backup ring (#112).
      if (s.isDemoMode) return;
      saveBackup(buildState(s.accounts, s.positions, s.strategy, s.tickerOverrides, s.decompositions, s.freeCash, s.plannedWithdrawal, s.reminder));
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const result = useMemo(
    () => rebalance(accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal),
    [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal],
  );

  const resolvedTrades = useMemo(() => {
    const classify = makeClassifier(tickerOverrides);
    return resolveTradeVehicles(result.trades, positions, decompositions, classify, strategy.targets);
  }, [result.trades, positions, decompositions, tickerOverrides, strategy.targets]);

  const unmappedCount = result.flags.filter(f => f.kind === 'UNMAPPED_HOLDING').length;

  const hasAccounts   = accounts.length > 0;
  const hasPositions  = positions.length > 0;
  const allClassified = hasPositions && unmappedCount === 0;

  // ── Drift-from-target summary (Overview "Drift from target" cell) ───────────
  // Max absolute per-class drift (current − target) across every class, plus a
  // count of classes currently out of their rebalance band. Pure derivation from
  // the same currentWeights / targets / tolerance the engine already exposes, so
  // the Overview cell and the Results allocation table agree.
  const driftInfo = useMemo(() => {
    let maxAbs = 0;
    let outOfBand = 0;
    for (const ac of ALL_ASSET_CLASSES) {
      const cur = result.currentWeights[ac] ?? 0;
      const tgt = strategy.targets[ac] ?? 0;
      if (cur === 0 && tgt === 0) continue;
      const dev = Math.abs(cur - tgt);
      if (dev > maxAbs) maxAbs = dev;
      if (dev > effectiveTolerance(ac, strategy)) outOfBand += 1;
    }
    return { maxAbs, outOfBand };
  }, [result.currentWeights, strategy]);

  // ── Allocation-vs-target family rows (Overview table) ───────────────────────
  // Roll the per-class current/target weights up to the five brand families and
  // pair them for the Overview "Allocation vs target" table.
  const familyRows = useMemo(() => {
    const cur = rollupFamilies(result.currentWeights);
    const tgt = rollupFamilies(strategy.targets);
    return ALLOCATION_FAMILIES
      .filter(f => (cur[f] ?? 0) > 0 || (tgt[f] ?? 0) > 0)
      .map(f => ({ family: f, current: cur[f] ?? 0, target: tgt[f] ?? 0 }));
  }, [result.currentWeights, strategy.targets]);

  // ── Rail steps — numbered nav rows with completion/badge state ──────────────
  const railSteps: RailStep[] = [
    { id: 'overview', label: 'Overview', n: '01', done: false },
    { id: 'accounts', label: 'Accounts', n: '02', done: hasAccounts },
    { id: 'positions', label: 'Positions', n: '03', done: hasPositions },
    { id: 'classify', label: 'Classify', n: '04', done: allClassified, warnCount: unmappedCount },
    { id: 'strategy', label: 'Strategy', n: '05', done: hasPositions },
    { id: 'results',  label: 'Results',  n: '06', done: false, infoCount: resolvedTrades.length },
  ];

  // Context-bar status caption per active tab. Warn-colored when the active tab
  // needs attention (e.g. Classify with untagged tickers, mirroring the rail
  // badge). Falls back to a neutral orientation line otherwise.
  const contextStatus = useMemo((): { text: string; warn: boolean } => {
    switch (activeTab) {
      case 'overview':
        if (!hasAccounts) return { text: 'Not started', warn: false };
        if (!hasPositions) return { text: 'Step 2 of 5', warn: false };
        if (unmappedCount > 0) return { text: `${unmappedCount} ticker${unmappedCount !== 1 ? 's' : ''} need tagging`, warn: true };
        return { text: 'Ready for results', warn: false };
      case 'accounts':
        return { text: hasAccounts ? `${accounts.length} account${accounts.length !== 1 ? 's' : ''}` : 'No accounts yet', warn: false };
      case 'positions':
        return { text: hasPositions ? `${positions.length} position${positions.length !== 1 ? 's' : ''}` : 'No positions yet', warn: false };
      case 'classify':
        return unmappedCount > 0
          ? { text: `${unmappedCount} ticker${unmappedCount !== 1 ? 's' : ''} need tagging`, warn: true }
          : { text: 'All tagged', warn: false };
      case 'strategy':
        return { text: 'Target allocation', warn: false };
      case 'results':
        return resolvedTrades.length > 0
          ? { text: `${resolvedTrades.length} trade${resolvedTrades.length !== 1 ? 's' : ''}`, warn: false }
          : { text: 'Within tolerance', warn: false };
    }
  }, [activeTab, hasAccounts, hasPositions, unmappedCount, accounts.length, positions.length, resolvedTrades.length]);

  const activeTabLabel = TABS.find(t => t.id === activeTab)?.label ?? 'Overview';

  const fmtSavedTime = useCallback((d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), []);

  /** Replace every state slice from a validated AppState (load, demo, restore). */
  function applyState(s: AppState) {
    setAccounts(s.accounts);
    setPositions(s.positions);
    setStrategy(s.strategy);
    setTickerOverrides(s.tickerOverrides);
    setDecompositions(s.decompositions ?? {});
    setFreeCash(s.freeCash ?? 0);
    setPlannedWithdrawal(s.plannedWithdrawal ?? 0);
    setReminder(s.reminder ?? {});
  }

  function handleLoadSample() {
    const parsed = appStateSchema.safeParse(SAMPLE_PORTFOLIO);
    if (!parsed.success) return;
    applyState(parsed.data as AppState);
    setIsDemoMode(true);
  }

  /** Dismissing the demo banner: drop the demo state and put the user's real
   *  (persisted) portfolio back in memory — autosave was suspended for the whole
   *  demo session, so the save slot still holds it (#112). */
  function handleExitDemo() {
    const restored = loadState();
    applyState(restored?.state ?? DEFAULT_APP_STATE);
    setIsDemoMode(false);
  }

  function handleDeleteAccount(id: string) {
    setPositions(prev => prev.filter(p => p.accountId !== id));
  }

  function handleSave() {
    saveJson(buildState(accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder));
  }

  async function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setLoadError(null);
    const result = await loadJson(file);
    if ('error' in result) { setLoadError(result.error); return; }
    applyState(result);
    // Loading a real portfolio is an explicit exit from demo mode — autosave
    // resumes and persists the loaded file (#112).
    setIsDemoMode(false);
  }

  function handleReset() {
    setResetConfirmOpen(true);
  }

  function confirmReset() {
    setResetConfirmOpen(false);
    clearState();
    setAccounts([]);
    setPositions([]);
    setStrategy(DEFAULT_STRATEGY);
    setTickerOverrides({});
    setDecompositions({});
    setFreeCash(0);
    setPlannedWithdrawal(0);
    setReminder({});
    setActiveTab('accounts');
    setLastSavedAt(null);
    setRestoredFromBackup(null);
    // Reset is an explicit exit from demo mode too (#112).
    setIsDemoMode(false);
  }

  if (showLanding) {
    return (
      <LandingPage
        onEnter={() => setShowLanding(false)}
        onDemo={() => { handleLoadSample(); setShowLanding(false); }}
      />
    );
  }

  const feedbackHref =
    `https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${__COMMIT_SHA__}`;

  // Banners relocate directly under the context bar (order: beta, demo,
  // restored, load-error). All dismiss/persistence semantics unchanged — only
  // the mount point moved (#194 stage 2).
  const banners = (
    <>
      {/* Beta banner — dismissible + remembered via a plain localStorage flag,
          separate from the AppState schema, so it stays gone once dismissed. */}
      {!betaBannerDismissed && (
        <div className="flex items-center justify-between gap-3 px-6 py-1.5 border-b border-line-2 bg-paper font-mono text-[11px] text-muted-1">
          <span className="flex items-center gap-2.5 flex-wrap min-w-0">
            <span className="font-semibold tracking-[0.1em] text-accent shrink-0">BETA</span>
            <span>
              Drift is in early beta — {' '}
              <a
                href={feedbackHref}
                target="_blank"
                rel="noopener noreferrer"
                className="text-info underline underline-offset-2 hover:text-brand-ink"
              >
                share your feedback
              </a>
              , it helps a lot.
            </span>
          </span>
          <button
            onClick={dismissBetaBanner}
            aria-label="Dismiss beta banner"
            className="text-muted-3 hover:text-ink flex-shrink-0"
          >
            <IconX size={11} />
          </button>
        </div>
      )}

      {/* Demo mode banner — neutral strip, info tag (#194 kit: the bold
          tracking tag carries the semantic color, not a tinted box). */}
      {isDemoMode && (
        <div className="flex items-center justify-between gap-3 px-6 py-1.5 border-b border-line-2 bg-paper font-mono text-[11px] text-muted-1">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="font-semibold tracking-[0.1em] text-info shrink-0">DEMO</span>
            <span>Synthetic 5-account sample portfolio. Your saved data is untouched.</span>
          </span>
          <div className="ml-3 flex items-center gap-3 flex-shrink-0">
            <button
              onClick={handleExitDemo}
              className="font-semibold underline underline-offset-2 text-info hover:text-brand-ink"
            >
              Exit demo
            </button>
            <button
              onClick={handleExitDemo}
              aria-label="Exit demo and restore your saved portfolio"
              className="text-muted-3 hover:text-ink"
            >
              <IconX size={11} />
            </button>
          </div>
        </div>
      )}

      {/* Restored-from-backup banner — neutral strip, warn tag; the "recent
          changes may be missing" caution keeps the warn tone. */}
      {restoredFromBackup !== null && (
        <div className="flex items-center justify-between gap-3 px-6 py-1.5 border-b border-line-2 bg-paper font-mono text-[11px] text-muted-1">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="font-semibold tracking-[0.1em] text-warn shrink-0">RESTORED</span>
            <span>
              Last save couldn't be read — restored from a backup taken{' '}
              {new Date(restoredFromBackup).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              {', '}
              {new Date(restoredFromBackup).toLocaleDateString([], { month: 'short', day: 'numeric' })}.
              {' '}<span className="text-warn">Recent changes may be missing.</span> Save a copy to preserve what's here.
            </span>
          </span>
          <button
            onClick={() => setRestoredFromBackup(null)}
            aria-label="Dismiss"
            className="text-muted-3 hover:text-ink flex-shrink-0"
          >
            <IconX size={11} />
          </button>
        </div>
      )}

      {/* Load error — neutral strip, danger tag. */}
      {loadError && (
        <div className="flex items-center justify-between gap-3 px-6 py-1.5 border-b border-line-2 bg-paper font-mono text-[11px] text-muted-1">
          <span className="flex items-center gap-2.5 min-w-0">
            <span className="font-semibold tracking-[0.1em] text-danger shrink-0">ERROR</span>
            <span>{loadError}</span>
          </span>
          <button onClick={() => setLoadError(null)} aria-label="Dismiss" className="text-muted-3 hover:text-ink flex-shrink-0"><IconX size={11} /></button>
        </div>
      )}
    </>
  );

  return (
    // Desktop (md+): the app fills the viewport (h-screen) and the CONTENT
    // COLUMN scrolls, not the page — so the rail (and its footer actions) stay
    // fully visible on long tabs like Results/Strategy. Mobile keeps normal
    // page scroll (no fixed height, no inner scroll region).
    <div className="min-h-screen md:min-h-0 md:h-screen md:overflow-hidden bg-paper flex flex-col md:flex-row">
      {/* Hidden file input for the Load action (shared by rail + mobile). */}
      <input
        ref={loadFileRef}
        type="file"
        accept=".json"
        onChange={handleLoadFile}
        className="hidden"
      />

      {/* ── Left workflow rail (desktop md+) ───────────────────────────────── */}
      <WorkflowRail
        steps={railSteps}
        activeTab={activeTab}
        onSelect={setActiveTab}
        tabRefs={tabRefs}
        onKeyDown={handleTabKeyDown}
        onBackHome={() => setShowLanding(true)}
        onSave={handleSave}
        onLoad={() => loadFileRef.current?.click()}
        onReset={handleReset}
        onHowItWorks={() => setHowItWorksOpen(true)}
      />

      {/* ── Content column ─────────────────────────────────────────────────────
          Desktop: the only scroll region (overflow-y-auto inside the h-screen
          shell) — context bar, banners, panel, and app footer scroll together
          while the rail stays put. Mobile: plain block flow, page scrolls. */}
      <div className="flex-1 flex flex-col min-w-0 min-h-screen md:min-h-0 md:h-full md:overflow-y-auto">

        {/* Mobile top header (< md): compact wordmark + the four actions, so
            the rail's affordances stay reachable on phones (#142). */}
        <div className="md:hidden flex items-center justify-between px-4 py-2.5 bg-white border-b border-line">
          <button
            onClick={() => setShowLanding(true)}
            className="p-0 border-0 bg-transparent cursor-pointer flex items-center"
            title="Back to Drift home"
          >
            <DriftWordmark height={26} />
          </button>
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleSave}
              title="Save portfolio as JSON"
              aria-label="Save portfolio as JSON"
              className="inline-flex items-center justify-center text-muted-1 bg-white border border-line rounded-md p-1.5 hover:border-muted-2 hover:text-ink transition-colors"
            >
              <IconDownload size={14} />
            </button>
            <button
              onClick={() => loadFileRef.current?.click()}
              title="Load portfolio from JSON"
              aria-label="Load portfolio from JSON"
              className="inline-flex items-center justify-center text-muted-1 bg-white border border-line rounded-md p-1.5 hover:border-muted-2 hover:text-ink transition-colors"
            >
              <IconUpload size={14} />
            </button>
            <button
              onClick={handleReset}
              title="Clear all data"
              aria-label="Clear all data"
              className="inline-flex items-center justify-center text-muted-2 bg-white border border-line rounded-md p-1.5 hover:border-danger-hover-border hover:text-danger transition-colors"
            >
              <IconX size={14} />
            </button>
            <button
              onClick={() => setHowItWorksOpen(true)}
              title="How Drift works"
              aria-label="How it works"
              className="inline-flex items-center justify-center text-info bg-info-bg border border-info-border rounded-md p-1.5 hover:bg-brand-100 transition-colors"
            >
              <IconInfo size={14} />
            </button>
          </div>
        </div>

        {/* Mobile horizontal scrollable tab bar (< md) — the legacy #142 pattern.
            Its own tablist with mtab-* ids so it doesn't collide with the rail's
            canonical tab-* ids that the panel's aria-labelledby references. */}
        <nav
          className="md:hidden flex gap-0 overflow-x-auto no-scrollbar bg-white border-b border-line"
          role="tablist"
          aria-label="Workflow sections"
        >
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                id={`mtab-${tab.id}`}
                aria-selected={active}
                aria-controls={`panel-${tab.id}`}
                tabIndex={active ? 0 : -1}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0
                  ${active
                    ? tab.id === 'results'
                      ? 'border-accent text-accent-ink'
                      : 'border-brand-600 text-brand-600'
                    : 'border-transparent text-muted-2 hover:text-ink hover:border-line'
                  }`}
              >
                {tab.label}
                {tab.id === 'classify' && unmappedCount > 0 && (
                  <span className="ml-1.5 font-mono bg-warn-bg text-warn text-[11px] font-semibold px-1.5 py-0.5 rounded-full">
                    {unmappedCount}
                  </span>
                )}
                {tab.id === 'results' && resolvedTrades.length > 0 && (
                  <span className={`ml-1.5 font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-full ${
                    active ? 'bg-accent-50 text-accent-ink' : 'bg-info-bg text-info'
                  }`}>
                    {resolvedTrades.length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* ── Context bar (46px) ───────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-6 h-[46px] bg-white border-b border-line flex-none">
          <span className="flex items-baseline gap-2.5 min-w-0">
            <span className="text-[15px] font-semibold tracking-tight text-brand-ink truncate">{activeTabLabel}</span>
            <span className={`font-mono text-[10px] tracking-[.12em] uppercase truncate ${contextStatus.warn ? 'text-warn' : 'text-muted-3'}`}>
              {contextStatus.text}
            </span>
          </span>
          <span className="flex items-center gap-3.5 flex-none">
            {result.householdValue > 0 && (
              <span className="font-mono text-[13px] font-medium text-brand-ink tabular-nums">
                {fmtUsd(result.householdValue)}
              </span>
            )}
            {lastSavedAt && (accounts.length > 0 || positions.length > 0) && (
              <span
                className="inline-flex items-center gap-1.5 font-mono text-[11px] text-muted-2 tabular-nums"
                title={`Last saved at ${lastSavedAt.toLocaleTimeString()}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-ok flex-none" />
                Saved {fmtSavedTime(lastSavedAt)}
              </span>
            )}
          </span>
        </div>

        {/* ── Banners (relocated under the context bar) ────────────────────── */}
        {banners}

        {/* ── Panel content ────────────────────────────────────────────────── */}
        <main
          className="flex-1 px-5 md:px-6 py-[18px] md:py-5"
          role="tabpanel"
          id={`panel-${activeTab}`}
          aria-labelledby={`tab-${activeTab}`}
        >
          {activeTab === 'overview' && (
            <OverviewPanel
              accounts={accounts}
              positions={positions}
              unmappedCount={unmappedCount}
              householdValue={result.householdValue}
              driftMaxAbs={driftInfo.maxAbs}
              driftOutOfBand={driftInfo.outOfBand}
              familyRows={familyRows}
              onNavigate={(tab) => setActiveTab(tab as Tab)}
            />
          )}
          {activeTab === 'accounts' && (
            <AccountsPanel
              accounts={accounts}
              setAccounts={setAccounts}
              onDeleteAccount={handleDeleteAccount}
              freeCash={freeCash}
              setFreeCash={setFreeCash}
              plannedWithdrawal={plannedWithdrawal}
              setPlannedWithdrawal={setPlannedWithdrawal}
              onLoadSample={handleLoadSample}
            />
          )}
          {activeTab === 'positions' && (
            <PositionsPanel
              accounts={accounts}
              positions={positions}
              setPositions={setPositions}
            />
          )}
          {activeTab === 'classify' && (
            <ClassifyPanel
              accounts={accounts}
              positions={positions}
              flags={result.flags}
              tickerOverrides={tickerOverrides}
              setTickerOverrides={setTickerOverrides}
              decompositions={decompositions}
              setDecompositions={setDecompositions}
            />
          )}
          {activeTab === 'strategy' && (
            <StrategyPanel
              strategy={strategy}
              setStrategy={setStrategy}
              accounts={accounts}
              currentWeights={result.currentWeights}
              // Intentionally the NOMINAL projected view, not result.taxAdjusted.projectedWeights.
              // The compare bars show the stated target (pre-tax) against the nominal allocation
              // the engine must hold to hit that target in after-tax dollars — i.e. the gross-up.
              // result.taxAdjusted.projectedWeights is the after-tax projected view, which by
              // construction converges back onto strategy.targets, so wiring it here would collapse
              // the two bars into one. Verified as-designed against issue #7; do not "fix" to
              // taxAdjusted.projectedWeights (audit finding m11 / issue #125).
              taxAdjustedTargetWeights={result.taxAdjusted ? result.projectedWeights : undefined}
            />
          )}
          {activeTab === 'results' && (
            <ResultsPanel
              result={result}
              accounts={accounts}
              resolvedTrades={resolvedTrades}
              freeCash={freeCash}
              plannedWithdrawal={plannedWithdrawal}
              reminder={reminder}
              setReminder={setReminder}
              onSave={handleSave}
            />
          )}
        </main>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <footer className="flex items-center justify-between gap-3 px-6 py-2.5 border-t border-line bg-white font-mono text-[10.5px] text-muted-3 flex-none">
          <span>© {new Date().getFullYear()} Drift · All computation is local</span>
          <span className="flex items-center gap-4">
            <a
              href={feedbackHref}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-muted-1"
            >
              Share feedback
            </a>
            <span>Not investment advice</span>
            {__IS_RELEASE__ ? (
              (__APP_VERSION__ && __APP_VERSION__ !== '0.0.0') && (
                <span>v{__APP_VERSION__}{__COMMIT_SHA__ && __COMMIT_SHA__ !== 'unknown' ? ` (${__COMMIT_SHA__})` : ''}</span>
              )
            ) : (
              // #200: non-release builds (local dev, PR previews, `main`) must
              // never claim a release version — show the SHA only, tagged "dev".
              <span>dev{__COMMIT_SHA__ && __COMMIT_SHA__ !== 'unknown' ? ` (${__COMMIT_SHA__})` : ''}</span>
            )}
          </span>
        </footer>
      </div>

      <HowItWorksDrawer open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} />

      <ConfirmDialog
        open={resetConfirmOpen}
        title="Clear all data?"
        message="This clears all accounts, positions, and strategy settings. This cannot be undone."
        confirmLabel="Reset"
        destructive
        onConfirm={confirmReset}
        onCancel={() => setResetConfirmOpen(false)}
      />

      {/*
        Anonymous, cookieless traffic analytics (aggregate pageviews only).
        INVARIANT: no portfolio/account/PII data may ever reach analytics. Tabs are
        React state (never routed), and the only URL param — ?demo — is stripped on
        load (see top of file), so the tracked path is always "/". Never add custom
        events carrying holdings, dollar amounts, or account details. See CLAUDE.md
        privacy guardrail and issue #168.
      */}
      <Analytics />
    </div>
  );
}
