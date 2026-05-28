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
import {
  buildState, clearState, DEFAULT_APP_STATE, saveJson, loadJson,
  loadState, saveState, saveBackup,
} from './store';
import { appStateSchema } from './ingest/schema';
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
// The param is stripped from the URL immediately so a page refresh doesn't re-trigger.
const _demoRequested = new URLSearchParams(window.location.search).has('demo');
const _demoParsed    = _demoRequested ? appStateSchema.safeParse(SAMPLE_PORTFOLIO) : null;
const _isDemoInit    = _demoParsed?.success === true;
if (_isDemoInit) window.history.replaceState({}, '', window.location.pathname);

// Initialise from localStorage (or defaults if nothing saved / schema mismatch).
// loadState() falls back to the most-recent valid backup automatically.
const loadResult = _isDemoInit ? null : loadState();
const saved = (_isDemoInit && _demoParsed?.success)
  ? _demoParsed.data
  : (loadResult?.state ?? DEFAULT_APP_STATE);

export default function App() {
  const [accounts,         setAccounts]         = useState<Account[]>(saved.accounts);
  const [positions,        setPositions]         = useState<Position[]>(saved.positions);
  const [strategy,         setStrategy]         = useState<Strategy>(saved.strategy);
  const [tickerOverrides,  setTickerOverrides]  = useState<Record<string, AssetClass>>(saved.tickerOverrides);
  const [decompositions,   setDecompositions]   = useState<Record<string, FundDecomposition>>(saved.decompositions ?? {});
  const [freeCash,         setFreeCash]         = useState<number>(saved.freeCash ?? 0);
  const [activeTab,        setActiveTab]        = useState<Tab>('overview');
  const [loadError,        setLoadError]        = useState<string | null>(null);
  const [isDemoMode,       setIsDemoMode]       = useState<boolean>(_isDemoInit);
  // Non-null when data was loaded from a backup because the primary slot was invalid.
  const [restoredFromBackup, setRestoredFromBackup] = useState<number | null>(
    loadResult?.source === 'backup' ? (loadResult.backupTs ?? Date.now()) : null,
  );
  // Timestamp of last successful primary save — drives the "Saved" indicator.
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(
    loadResult !== null ? new Date() : null,
  );

  const loadFileRef = useRef<HTMLInputElement>(null);

  // Keep a ref to the latest state slices for the backup interval closure.
  const stateRef = useRef({ accounts, positions, strategy, tickerOverrides, decompositions, freeCash });
  useEffect(() => {
    stateRef.current = { accounts, positions, strategy, tickerOverrides, decompositions, freeCash };
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash]);

  // Skip the very first save so that a schema-validation failure on load can
  // never silently overwrite existing localStorage data with empty defaults.
  const didMountRef = useRef(false);

  // Primary autosave: write to localStorage on every state change (but not on
  // the initial mount — the stored value is already correct at that point).
  useEffect(() => {
    if (!didMountRef.current) {
      didMountRef.current = true;
      return;
    }
    saveState(buildState(accounts, positions, strategy, tickerOverrides, decompositions, freeCash));
    setLastSavedAt(new Date());
  }, [accounts, positions, strategy, tickerOverrides, decompositions, freeCash]);

  // Backup autosave: write a timestamped snapshot every 5 minutes.
  useEffect(() => {
    const id = setInterval(() => {
      const s = stateRef.current;
      saveBackup(buildState(s.accounts, s.positions, s.strategy, s.tickerOverrides, s.decompositions, s.freeCash));
    }, 5 * 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const result = useMemo(
    () => rebalance(accounts, positions, strategy, tickerOverrides, decompositions, freeCash),
    [accounts, positions, strategy, tickerOverrides, decompositions, freeCash],
  );

  const resolvedTrades = useMemo(() => {
    const classify = makeClassifier(tickerOverrides);
    return resolveTradeVehicles(result.trades, positions, decompositions, classify);
  }, [result.trades, positions, decompositions, tickerOverrides]);

  const unmappedCount = result.flags.filter(f => f.kind === 'UNMAPPED_HOLDING').length;

  /** Format the last-saved time as "3:42 PM". */
  const fmtSavedTime = useCallback((d: Date) =>
    d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }), []);

  function handleDeleteAccount(id: string) {
    setPositions(prev => prev.filter(p => p.accountId !== id));
  }

  function handleSave() {
    saveJson(buildState(accounts, positions, strategy, tickerOverrides, decompositions, freeCash));
  }

  async function handleLoadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';  // allow re-selecting same file
    setLoadError(null);
    const result = await loadJson(file);
    if ('error' in result) {
      setLoadError(result.error);
      return;
    }
    setAccounts(result.accounts);
    setPositions(result.positions);
    setStrategy(result.strategy);
    setTickerOverrides(result.tickerOverrides);
    setDecompositions(result.decompositions ?? {});
    setFreeCash(result.freeCash ?? 0);
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
    setActiveTab('accounts');
    setLastSavedAt(null);
    setRestoredFromBackup(null);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between py-3">
            <div className="flex items-baseline gap-2">
              <h1 className="text-base font-semibold text-gray-900 tracking-tight">Drift</h1>
              <span className="text-xs text-gray-400 hidden sm:inline">DIY Portfolio Rebalancer</span>
            </div>

            <div className="flex items-center gap-3">
              {result.householdValue > 0 && (
                <span className="text-sm text-gray-500">
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
            </div>
          </div>

          {/* Demo mode banner */}
          {isDemoMode && (
            <div className="mb-2 bg-indigo-50 border border-indigo-200 rounded px-3 py-2 text-xs text-indigo-800 flex items-center justify-between">
              <span>
                Demo — showing a synthetic 5-account sample portfolio. Your saved data is untouched.
                {' '}Use ↑ Load or Reset to switch to your own portfolio.
              </span>
              <button
                onClick={() => setIsDemoMode(false)}
                className="ml-3 text-indigo-400 hover:text-indigo-700 flex-shrink-0"
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

          {/* Tab nav */}
          <nav className="flex gap-0 -mb-px">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${activeTab === tab.id
                    ? 'border-indigo-600 text-indigo-600'
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
                  <span className="ml-1.5 bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5 rounded-full">
                    {resolvedTrades.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Panel */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {activeTab === 'overview' && (
          <OverviewPanel onStart={() => setActiveTab('accounts')} />
        )}
        {activeTab === 'accounts' && (
          <AccountsPanel
            accounts={accounts}
            setAccounts={setAccounts}
            onDeleteAccount={handleDeleteAccount}
            freeCash={freeCash}
            setFreeCash={setFreeCash}
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
            currentWeights={result.currentWeights}
          />
        )}
        {activeTab === 'results' && (
          <ResultsPanel
            result={result}
            accounts={accounts}
            resolvedTrades={resolvedTrades}
            freeCash={freeCash}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="max-w-5xl mx-auto px-4 py-6 mt-8 border-t border-gray-100 text-xs text-gray-400 flex items-center justify-between">
        <span>All computation is local — no data leaves your browser.</span>
        <span>Not investment advice.</span>
      </footer>
    </div>
  );
}
