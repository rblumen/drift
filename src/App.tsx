import { useState, useMemo } from 'react';
import type { Account, AssetClass, Position, Strategy } from './engine/types';
import { DEFAULT_STRATEGY } from './engine/strategy';
import { rebalance } from './engine/rebalance';
import { AccountsPanel } from './ui/AccountsPanel';
import { ImportPanel } from './ui/ImportPanel';
import { ClassifyPanel } from './ui/ClassifyPanel';
import { StrategyPanel } from './ui/StrategyPanel';
import { ResultsPanel } from './ui/ResultsPanel';
import { fmtUsd } from './ui/fmt';

type Tab = 'accounts' | 'import' | 'classify' | 'strategy' | 'results';

const TABS: { id: Tab; label: string }[] = [
  { id: 'accounts', label: 'Accounts' },
  { id: 'import',   label: 'Import' },
  { id: 'classify', label: 'Classify' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'results',  label: 'Results' },
];

export default function App() {
  const [accounts, setAccounts]             = useState<Account[]>([]);
  const [positions, setPositions]           = useState<Position[]>([]);
  const [strategy, setStrategy]             = useState<Strategy>(DEFAULT_STRATEGY);
  const [tickerOverrides, setTickerOverrides] = useState<Record<string, AssetClass>>({});
  const [activeTab, setActiveTab]           = useState<Tab>('accounts');

  const result = useMemo(
    () => rebalance(accounts, positions, strategy, tickerOverrides),
    [accounts, positions, strategy, tickerOverrides],
  );

  const unmappedCount = result.flags.filter(f => f.kind === 'UNMAPPED_HOLDING').length;

  function handleDeleteAccount(id: string) {
    setPositions(prev => prev.filter(p => p.accountId !== id));
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
            {result.householdValue > 0 && (
              <span className="text-sm text-gray-500">
                {fmtUsd(result.householdValue)} total
              </span>
            )}
          </div>

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
            flags={result.flags}
            tickerOverrides={tickerOverrides}
            setTickerOverrides={setTickerOverrides}
          />
        )}
        {activeTab === 'strategy' && (
          <StrategyPanel
            strategy={strategy}
            setStrategy={setStrategy}
          />
        )}
        {activeTab === 'results' && (
          <ResultsPanel
            result={result}
            accounts={accounts}
          />
        )}
      </main>
    </div>
  );
}
