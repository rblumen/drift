import type { Account, AssetClass, Flag, RebalanceResult, Trade } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { AC_LABEL, ACCT_TYPE_LABEL, fmtUsd, fmtPct, fmtDelta } from './fmt';

interface Props {
  result: RebalanceResult;
  accounts: Account[];
}

function FlagBanner({ flag, accounts }: { flag: Flag; accounts: Account[] }) {
  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;

  if (flag.kind === 'REVISIT_PLACEMENT') {
    return (
      <div className="bg-orange-50 border border-orange-300 rounded-lg px-4 py-3 text-sm text-orange-800">
        <strong>Revisit placement strategy.</strong>{' '}
        Taxable accounts hold {fmtPct(flag.taxableShare)} of household value, which exceeds
        the {fmtPct(flag.fixedIncomeTarget)} fixed-income target.
        Taxable accounts can no longer be bonds-only — equities must begin landing there.
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

  return null;
}

function AllocationRow({
  ac, current, target, projected,
}: {
  ac: AssetClass; current: number; target: number; projected: number;
}) {
  const drift = current - target;
  const within = Math.abs(drift) <= 0.001; // already filtered but show anyway
  const barMax = Math.max(current, target, 0.01);

  return (
    <tr className="border-t border-gray-100">
      <td className="px-4 py-3 text-gray-700 font-medium">{AC_LABEL[ac]}</td>
      <td className="px-4 py-3 text-right tabular-nums">{fmtPct(current)}</td>
      <td className="px-4 py-3 text-right tabular-nums">{fmtPct(target)}</td>
      <td className="px-4 py-3 text-right tabular-nums">
        <span className={drift > 0.001 ? 'text-amber-600' : drift < -0.001 ? 'text-blue-600' : 'text-gray-400'}>
          {drift >= 0 ? '+' : ''}{fmtPct(drift)}
        </span>
      </td>
      <td className="px-4 py-3 text-right tabular-nums text-gray-500">{fmtPct(projected)}</td>
      <td className="px-4 py-3 w-36">
        <div className="relative h-3 bg-gray-100 rounded-full overflow-hidden">
          {/* target marker */}
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
            style={{ left: `${(target / barMax) * 100}%` }}
          />
          {/* current fill */}
          <div
            className={`absolute inset-y-0 left-0 rounded-full
              ${within ? 'bg-green-400' : current > target ? 'bg-amber-400' : 'bg-blue-400'}`}
            style={{ width: `${(current / barMax) * 100}%` }}
          />
        </div>
      </td>
    </tr>
  );
}

function TradeRow({ trade, accounts }: { trade: Trade; accounts: Account[] }) {
  const isBuy = trade.deltaUsd > 0;
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2 text-gray-600">{AC_LABEL[trade.assetClass]}</td>
      <td className="px-4 py-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full
          ${isBuy ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
          {isBuy ? 'BUY' : 'SELL'}
        </span>
      </td>
      <td className="px-4 py-2 text-right tabular-nums font-medium">
        <span className={isBuy ? 'text-green-700' : 'text-red-700'}>
          {fmtDelta(trade.deltaUsd)}
        </span>
      </td>
      {trade.inTaxableAccount && !isBuy && (
        <td className="px-4 py-2 text-xs text-amber-600">⚠ taxable sale</td>
      )}
      {!(trade.inTaxableAccount && !isBuy) && <td className="px-4 py-2" />}
    </tr>
  );
}

export function ResultsPanel({ result, accounts }: Props) {
  const { householdValue, currentWeights, targetWeights, projectedWeights, trades, flags } = result;

  // Separate flags by priority
  const revisit    = flags.filter(f => f.kind === 'REVISIT_PLACEMENT');
  const taxSales   = flags.filter(f => f.kind === 'TAXABLE_SALE');
  const unmapped   = flags.filter(f => f.kind === 'UNMAPPED_HOLDING');
  const spillovers = flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER');

  const importantFlags = [...revisit, ...unmapped, ...taxSales, ...spillovers];

  // Group trades by account
  const tradesByAccount = accounts.map(a => ({
    account: a,
    trades: trades.filter(t => t.accountId === a.id).sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd)),
  })).filter(g => g.trades.length > 0);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-baseline gap-4">
        <h2 className="text-lg font-semibold text-gray-800">Results</h2>
        <span className="text-sm text-gray-500">
          Household value: <strong className="text-gray-800">{fmtUsd(householdValue)}</strong>
        </span>
      </div>

      {/* Priority flags */}
      {importantFlags.length > 0 && (
        <div className="space-y-2">
          {importantFlags.map((f, i) => (
            <FlagBanner key={i} flag={f} accounts={accounts} />
          ))}
        </div>
      )}

      {/* Allocation table */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700">Household allocation</h3>
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Asset class</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">Drift</th>
                <th className="px-4 py-3 text-right">After trades</th>
                <th className="px-4 py-3 text-left w-36">Chart</th>
              </tr>
            </thead>
            <tbody>
              {ALL_ASSET_CLASSES.map(ac => (
                <AllocationRow
                  key={ac}
                  ac={ac}
                  current={currentWeights[ac]}
                  target={targetWeights[ac]}
                  projected={projectedWeights[ac]}
                />
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400">
          Bar: <span className="text-blue-400">■</span> under target &nbsp;
          <span className="text-amber-400">■</span> over target &nbsp;
          <span className="text-green-400">■</span> on target &nbsp;
          ╎ target line
        </p>
      </div>

      {/* Trades */}
      {trades.length === 0 ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Portfolio is within tolerance — no trades needed.
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Recommended trades</h3>
          {tradesByAccount.map(({ account, trades: acctTrades }) => {
            const netUsd = acctTrades.reduce((s, t) => s + t.deltaUsd, 0);
            return (
              <div key={account.id} className="overflow-hidden border border-gray-200 rounded-lg">
                <div className="px-4 py-2 bg-gray-50 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-gray-700">{account.name}</span>
                    <span className="ml-2 text-xs text-gray-400">
                      {account.institution} · {ACCT_TYPE_LABEL[account.type]}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    Net: <span className={netUsd >= 0 ? 'text-green-600' : 'text-red-600'}>
                      {fmtDelta(netUsd)}
                    </span>
                  </span>
                </div>
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
                    {acctTrades.map((t, i) => (
                      <TradeRow key={i} trade={t} accounts={accounts} />
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
