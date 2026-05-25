import type { AssetClass, Flag } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { AC_LABEL } from './fmt';

interface Props {
  flags: Flag[];
  tickerOverrides: Record<string, AssetClass>;
  setTickerOverrides: (o: Record<string, AssetClass>) => void;
}

export function ClassifyPanel({ flags, tickerOverrides, setTickerOverrides }: Props) {
  const unmapped = flags
    .filter((f): f is Extract<Flag, { kind: 'UNMAPPED_HOLDING' }> => f.kind === 'UNMAPPED_HOLDING')
    .map(f => f.ticker);

  // De-duplicate (a ticker appears in flags once per position, could repeat across accounts)
  const uniqueTickers = [...new Set(unmapped)];

  function assign(ticker: string, ac: AssetClass) {
    setTickerOverrides({ ...tickerOverrides, [ticker.toUpperCase()]: ac });
  }

  if (uniqueTickers.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold text-gray-800">Classify Holdings</h2>
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          All holdings are classified. Nothing to resolve.
        </p>

        {/* Show current override map */}
        {Object.keys(tickerOverrides).length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-gray-600">Your classifications</h3>
            <div className="overflow-hidden border border-gray-200 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-xs text-gray-500 uppercase">
                  <tr>
                    <th className="px-4 py-2 text-left">Ticker</th>
                    <th className="px-4 py-2 text-left">Asset class</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {Object.entries(tickerOverrides).map(([ticker, ac]) => (
                    <tr key={ticker}>
                      <td className="px-4 py-2 font-mono font-medium">{ticker}</td>
                      <td className="px-4 py-2 text-gray-600">{AC_LABEL[ac]}</td>
                      <td className="px-4 py-2 text-right">
                        <button
                          onClick={() => {
                            const next = { ...tickerOverrides };
                            delete next[ticker];
                            setTickerOverrides(next);
                          }}
                          className="text-gray-300 hover:text-red-400 text-xs"
                        >✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold text-gray-800">Classify Holdings</h2>
      <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
        {uniqueTickers.length} ticker{uniqueTickers.length !== 1 ? 's' : ''} could not be auto-classified.
        Assign an asset class for each so the engine can include them in the rebalance.
      </p>

      <div className="overflow-hidden border border-gray-200 rounded-lg">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
            <tr>
              <th className="px-4 py-2 text-left">Ticker</th>
              <th className="px-4 py-2 text-left">Assign asset class</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {uniqueTickers.map(ticker => (
              <tr key={ticker} className={tickerOverrides[ticker] ? 'bg-green-50' : ''}>
                <td className="px-4 py-2 font-mono font-medium">{ticker}</td>
                <td className="px-4 py-2">
                  <select
                    value={tickerOverrides[ticker] ?? ''}
                    onChange={e => {
                      if (e.target.value) assign(ticker, e.target.value as AssetClass);
                    }}
                    className="border rounded px-2 py-1 text-sm"
                  >
                    <option value="">— select —</option>
                    {ALL_ASSET_CLASSES.map(ac => (
                      <option key={ac} value={ac}>{AC_LABEL[ac]}</option>
                    ))}
                  </select>
                  {tickerOverrides[ticker] && (
                    <span className="ml-2 text-xs text-green-600">✓ saved</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
