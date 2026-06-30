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
  loadState, saveState, saveBackup,
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
const saved = (_isDemoInit && _demoParsed?.success)
  ? _demoParsed.data
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
  const [showLanding,      setShowLanding]       = useState(true);
  const [restoredFromBackup, setRestoredFromBackup] = useState<number | null>(
    loadResult?.source === 'backup' ? (loadResult.backupTs ?? Date.now()) : null,
  );
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    loadResult !== null ? new Date() : null,
  );

  const loadFileRef = useRef<HTMLInputElement>(null);

  const stateRef = useRef({ accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder });
  useEffect(() => {
    stateRef.current = { accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder };
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder]);

  const didMountRef = useRef(false);

  useEffect(() => {
    if (!didMountRef.current) { didMountRef.current = true; return; }
    saveState(buildState(accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder));
    setLastSavedAt(new Date());
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash, plannedWithdrawal, reminder]);

  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
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

  function handleLoadSample() {
    const parsed = appStateSchema.safeParse(SAMPLE_PORTFOLIO);
    if (!parsed.success) return;
    const s = parsed.data;
    setAccounts(s.accounts);
    setPositions(s.positions);
    setStrategy(s.strategy);
    setTickerOverrides(s.tickerOverrides);
    setDecompositions(s.decompositions ?? {});
    setFreeCash(s.freeCash ?? 0);
    setPlannedWithdrawal(s.plannedWithdrawal ?? 0);
    setReminder(s.reminder ?? {});
    setIsDemoMode(true);
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
    setAccounts(result.accounts);
    setPositions(result.positions);
    setStrategy(result.strategy);
    setTickerOverrides(result.tickerOverrides);
    setDecompositions(result.decompositions ?? {});
    setFreeCash(result.freeCash ?? 0);
    setPlannedWithdrawal(result.plannedWithdrawal ?? 0);
    setReminder(result.reminder ?? {});
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
              {result.householdValue > 0 && (
                <span className="text-sm text-gray-500 font-mono tabular-nums">
                  {fmtUsd(result.householdValue)}
                </span>
              )}

              {/* Autosave indicator */}
              {lastSavedAt && (accounts.length > 0 || positions.length > 0) && (
                <span
                  className="text-xs text-gray-400 tabular-nums"
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

              <button
                onClick={() => setHowItWorksOpen(true)}
                title="How Drift works"
                className="hidden sm:flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 border border-gray-200 rounded px-2.5 py-1 hover:border-brand-200 hover:bg-brand-50 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.4" />
                  <path d="M8 7v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="8" cy="4.7" r="1" fill="currentColor" />
                </svg>
                How it works
              </button>
            </div>
          </div>

          {/* Beta banner */}
          <div className="mb-2 bg-amber-50 border-b border-amber-200 -mx-4 px-4 py-1.5 text-xs text-amber-800 flex items-center justify-center gap-1.5">
            <span>Drift is in early beta.</span>
            <a
              href={`https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${import.meta.env.VITE_GIT_SHA ?? 'dev'}`}
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
                {' '}Use ↑ Load or Reset to switch to your own portfolio.
              </span>
              <button
                onClick={() => setIsDemoMode(false)}
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

          {/* ── Tab nav — active tab uses Anchor Blue (brand-600) ── */}
          <nav className="flex gap-0 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
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
          />
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="max-w-5xl mx-auto px-4 py-6 mt-8 border-t border-gray-100 text-xs text-gray-400 flex items-center justify-between">
        <span>All computation is local — no data leaves your browser.</span>
        <span className="flex items-center gap-4">
          <a
            href={`https://docs.google.com/forms/d/e/1FAIpQLSdG-V4Zq4X-fwal9ThhM4PQSFSwinrFo8fyWpZLCWu7mGXHlA/viewform?usp=pp_url&entry.715582229=${import.meta.env.VITE_GIT_SHA ?? 'dev'}`}
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
