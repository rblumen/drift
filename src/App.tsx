import { useEffect, useMemo, useRef, useState } from 'react';
import type { Account, AssetClass, Position, Strategy } from './engine/types';
import { DEFAULT_STRATEGY } from './engine/strategy';
import { rebalance } from './engine/rebalance';
import { AccountsPanel } from './ui/AccountsPanel';
import { ImportPanel } from './ui/ImportPanel';
import { ClassifyPanel } from './ui/ClassifyPanel';
import { StrategyPanel } from './ui/StrategyPanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { fmtUsd } from './ui/fmt';
import {
  buildState, clearState, DEFAULT_APP_STATE, exportJson, importJson, loadState, saveState,
} from './store';

type Tab = 'accounts' | 'import' | 'classify' | 'strategy' | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'import',   label: 'Import' },
  { id: 'classify', label: 'Classify' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'results',  label: 'Results' },
];

// Initialise from localStorage (or defaults if nothing saved / schema mismatch).
const saved = loadState() ?? DEFAULT_APP_STATE;

export default function App() {
  const [accounts,         setAccounts]         = useState<Account[]>(saved.accounts);
  const [positions,        setPositions]         = useState<Position[]>(saved.positions);
  const [strategy,         setStrategy]         = useState<Strategy>(saved.strategy);
  const [tickerOverrides,  setTickerOverrides]  = useState<Record<string, AssetClass>>(saved.tickerOverrides);
  const [activeTab,        setActiveTab]        = useState<Tab>('accounts');
  const [importError,      setImportError]      = useState<string | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Auto-save to localStorage whenever any state slice changes.
  useEffect(() => {
    saveState(buildState(accounts, positions, strategy, tickerOverrides));
  }, [accounts, positions, strategy, tickerOverrides]);

  const result = useMemo(
    () => rebalance(accounts, positions, strategy, tickerOverrides),
    [accounts, positions, strategy, tickerOverrides],
  );

  const unmappedCount = result.flags.filter(f => f.kind === 'UNMAPPED_HOLDING').length;

  function handleDeleteAccount(id: string) {
    setPositions(prev => prev.filter(p => p.accountId !== id));
  }

  function handleExport() {
    exportJson(buildState(accounts, positions, strategy, tickerOverrides));
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';  // allow re-selecting same file
    setImportError(null);
    const result = await importJson(file);
    if ('error' in result) {
      setImportError(result.error);
      return;
    }
    setAccounts(result.accounts);
    setPositions(result.positions);
    setStrategy(result.strategy);
    setTickerOverrides(result.tickerOverrides);
  }

  function handleReset() {
    if (!confirm('Clear all accounts, positions, and strategy? This cannot be undone.')) return;
    clearState();
    setAccounts([]);
    setPositions([]);
    setStrategy(DEFAULT_STRATEGY);
    setTickerOverrides({});
    setActiveTab('accounts');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between py-3">
            <h1 className="text-base font-semibold text-gray-900 tracking-tight">
              Portfolio Rebalancer
            </h1>

            <div className="flex items-center gap-3">
              {result.householdValue > 0 && (
                <span className="text-sm text-gray-500">
                  {fmtUsd(result.householdValue)}
                </span>
              )}

              {/* File actions */}
              <div className="flex items-center gap-1.5 border-l border-gray-200 pl-3">
                <button
                  onClick={handleExport}
                  title="Export portfolio as JSON"
                  className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors"
                >
                  ↓ Export
                </button>
                <button
                  onClick={() => importFileRef.current?.click()}
                  title="Import portfolio from JSON"
                  className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors"
                >
                  ↑ Import
                </button>
                <button
                  onClick={handleReset}
                  title="Clear all data"
                  className="text-xs text-gray-400 hover:text-red-500 border border-gray-200 rounded px-2 py-1 hover:bg-red-50 transition-colors"
                >
                  ✕ Reset
                </button>
                <input
                  ref={importFileRef}
                  type="file"
                  accept=".json"
                  onChange={handleImportFile}
                  className="hidden"
                />
              </div>
            </div>
          </div>

          {/* Import error */}
          {importError && (
            <div className="mb-2 bg-red-50 border border-red-200 rounded px-3 py-2 text-xs text-red-700 flex items-center justify-between">
              <span>{importError}</span>
              <button onClick={() => setImportError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
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
                {tab.id === 'results' && result.trades.length > 0 && (
                  <span className="ml-1.5 bg-indigo-100 text-indigo-700 text-xs px-1.5 py-0.5 rounded-full">
                    {result.trades.length}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </header>

      {/* Panel */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        {activeTab === 'accounts' && (
          <AccountsPanel
            accounts={accounts}
            setAccounts={setAccounts}
            onDeleteAccount={handleDeleteAccount}
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
