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
import { ImportPanel } from './ui/ImportPanel';
import { ClassifyPanel } from './ui/ClassifyPanel';
import { StrategyPanel } from './ui/StrategyPanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { fmtUsd } from './ui/fmt';
import { DriftWordmark } from './ui/Logo';
import { HowItWorksDrawer } from './ui/HowItWorksDrawer';
import { LandingPage } from './ui/LandingPage';
import {
  buildState, clearState, DEFAULT_APP_STATE, saveJson, loadJson,
  loadState, saveState, saveBackup, type AppState,
} from './store';
import { appStateSchema, type Reminder } from './ingest/schema';
import SAMPLE_PORTFOLIO from './data/sample-portfolio.json';

type Tab = 'overview' | 'accounts' | 'import' | 'classify' | 'strategy' | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'accounts', label: 'Accounts' },
  { id: 'import',   label: 'Import' },
  { id: 'classify', label: 'Classify' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'results',  label: 'Results' },
];

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

  const loadFileRef = useRef<HTMLInputElement>(null);

  const stateRef = useRef({ accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode });
  useEffect(() => {
    stateRef.current = { accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode };
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder, isDemoMode]);

  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    // Demo state must never reach the primary save slot — the banner promises
    // "Your saved data is untouched" (#112). Persistence resumes when the user
    // exits demo mode (banner ✕ restores the saved portfolio; ↑ Load / Reset
    // replace it explicitly).
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
    if (!confirm('Clear all accounts, positions, and strategy? This cannot be undone.')) return;
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

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4">

          {/* Top row: wordmark + actions */}
          <div className="flex items-center justify-between py-3">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowLanding(true)}
                className="p-0 border-0 bg-transparent cursor-pointer flex items-center"
                title="Back to Drift home"
              >
                <DriftWordmark height={32} />
              </button>
              <span className="text-xs text-gray-400 hidden sm:inline border-l border-gray-200 pl-2.5">
                DIY Portfolio Rebalancer
              </span>
            </div>

            <div className="flex items-center gap-3">
              {/* Household value + save time are also in the Overview status
                  strip, so hide them here on mobile to keep the header on one
                  row (#142). */}
              {result.householdValue > 0 && (
                <span className="hidden sm:inline text-sm text-gray-500 font-mono tabular-nums">
                  {fmtUsd(result.householdValue)}
                </span>
              )}

              {/* Autosave indicator */}
              {lastSavedAt && (accounts.length > 0 || positions.length > 0) && (
                <span
                  className="hidden sm:inline text-xs text-gray-400 tabular-nums"
                  title={`Last saved at ${lastSavedAt.toLocaleTimeString()}`}
                >
                  ✓ Saved {fmtSavedTime(lastSavedAt)}
                </span>
              )}

              {/* File actions */}
              <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
                <button
                  onClick={handleSave}
                  title="Save portfolio as JSON"
                  className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors"
                >
                  ↓ Save
                </button>
                <button
                  onClick={() => loadFileRef.current?.click()}
                  title="Load portfolio from JSON"
                  className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors"
                >
                  ↑ Load
                </button>
                <button
                  onClick={handleReset}
                  title="Clear all data"
                  className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded px-2 py-1 hover:bg-red-50 transition-colors"
                >
                  ✕ Reset
                </button>
                <input
                  ref={loadFileRef}
                  type="file"
                  accept=".json"
                  onChange={handleLoadFile}
                  className="hidden"
                />
              </div>

              {/* Icon-only on mobile (label hidden < sm) so the drawer stays
                  reachable on phones (#142). */}
              <button
                onClick={() => setHowItWorksOpen(true)}
                title="How Drift works"
                aria-label="How it works"
                className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2 sm:px-2.5 py-1 hover:border-brand-200 hover:bg-brand-50 transition-colors flex-shrink-0"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="8" cy="4.7" r="1" fill="currentColor" />
                </svg>
                <span className="hidden sm:inline">How it works</span>
              </button>
            </div>
          </div>

          {/* Beta banner */}
          <div className="mb-2 bg-amber-50 border-b border-amber-200 -mx-4 px-4 py-1.5 text-xs text-amber-800 flex items-center justify-center gap-1.5">
            <span>Drift is in early beta.</span>
            <a
              href={`https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${__COMMIT_SHA__}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium underline underline-offset-2 hover:text-amber-900"
            >
              Share your feedback
            </a>
            <span>— it helps a lot.</span>
          </div>

          {/* Demo mode banner */}
          {isDemoMode && (
            <div className="mb-2 bg-brand-50 border border-brand-200 rounded px-3 py-2 text-xs text-brand-800 flex items-center justify-between">
              <span>
                Demo — showing a synthetic 5-account sample portfolio. Your saved data is untouched.
                {' '}Dismiss (✕) to return to your saved portfolio, or use ↑ Load / Reset.
              </span>
              <button
                onClick={handleExitDemo}
                aria-label="Exit demo and restore your saved portfolio"
                className="ml-3 text-brand-400 hover:text-brand-700 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          {/* Restored-from-backup banner */}
          {restoredFromBackup !== null && (
            <div className="mb-2 bg-amber-50 border border-amber-200 rounded px-3 py-2 text-xs text-amber-800 flex items-center justify-between">
              <span>
                ⚠ Your last save couldn't be read — portfolio restored from a backup taken at{' '}
                {new Date(restoredFromBackup).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                {' '}on{' '}
                {new Date(restoredFromBackup).toLocaleDateString([], { month: 'short', day: 'numeric' })}.
                {' '}Recent changes may be missing. Save a copy to preserve what's here.
              </span>
              <button
                onClick={() => setRestoredFromBackup(null)}
                className="ml-3 text-amber-600 hover:text-amber-800 flex-shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          {/* Load error */}
          {loadError && (
            <div className="mb-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700 flex items-center justify-between">
              <span>{loadError}</span>
              <button onClick={() => setLoadError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
            </div>
          )}

          {/* ── Tab nav — active tab uses Anchor Blue (brand-600) ──
              overflow-x-auto keeps the six tabs on one scrollable row on
              narrow screens instead of overflowing the viewport (#142). */}
          <nav className="flex gap-0 -mb-px overflow-x-auto no-scrollbar">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap shrink-0
                  ${activeTab === tab.id
                    ? 'border-brand-600 text-brand-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}
              >
                {tab.label}
                {tab.id === 'classify' && unmappedCount > 0 && (
                  <span className="ml-1.5 bg-amber-100 text-amber-700 text-xs px-1.5 py-0.5 rounded-full">
                    {unmappedCount}
                  </span>
                )}
                {tab.id === 'results' && resolvedTrades.length > 0 && (
                  <span className="ml-1.5 bg-brand-100 text-brand-700 text-xs px-1.5 py-0.5 rounded-full">
                    {resolvedTrades.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* ── Panel ──────────────────────────────────────────────────────────── */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {activeTab === 'overview' && (
          <OverviewPanel
            accounts={accounts}
            positions={positions}
            unmappedCount={unmappedCount}
            householdValue={result.householdValue}
            lastSavedAt={lastSavedAt}
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
        {activeTab === 'import' && (
          <ImportPanel
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

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="max-w-5xl mx-auto px-4 py-6 mt-8 border-t border-gray-100 text-xs text-gray-400 flex items-center justify-between">
        <span className="flex items-center gap-3">
          <span>© {new Date().getFullYear()} Drift</span>
          <span className="text-gray-200">·</span>
          <span>All computation is local — no data leaves your browser.</span>
          {(__APP_VERSION__ && __APP_VERSION__ !== '0.0.0') && (
            <>
              <span className="text-gray-200">·</span>
              <span className="font-mono" style={{ fontSize: 10 }}>v{__APP_VERSION__}{__COMMIT_SHA__ && __COMMIT_SHA__ !== 'unknown' ? ` (${__COMMIT_SHA__})` : ''}</span>
            </>
          )}
        </span>
        <span className="flex items-center gap-4">
          <a
            href={`https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${__COMMIT_SHA__}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-gray-600 underline underline-offset-2"
          >
            Share feedback
          </a>
          <span>Not investment advice.</span>
        </span>
      </footer>

      <HowItWorksDrawer open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} />
    </div>
  );
}
