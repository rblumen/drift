import { useState } from 'react';
import type { Account, AssetClass, Flag, RebalanceResult, ResolvedTrade } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { AC_COLOR, AC_LABEL, ACCT_TYPE_LABEL, fmtUsd, fmtPct, fmtDelta } from './fmt';
import { PieChart } from './PieChart';
import type { PieSlice } from './PieChart';
import { downloadReport } from './exportReport';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';

interface Props {
  result: RebalanceResult;
  accounts: Account[];
  resolvedTrades: ResolvedTrade[];
  freeCash: number;
}

// ── Flag banners ──────────────────────────────────────────────────────────────

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

  if (flag.kind === 'EXCESS_CASH') {
    return (
      <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 text-sm text-amber-800">
        <strong>Free cash undeployed:</strong>{' '}
        {fmtUsd(flag.amountUsd)} of household free cash could not be distributed — all accounts
        have deposits closed or are locked. Open deposits on at least one account to deploy it.
      </div>
    );
  }

  return null;
}

// ── Household allocation table row ────────────────────────────────────────────

function AllocationRow({
  ac, current, target, projected,
}: {
  ac: AssetClass; current: number; target: number; projected: number;
}) {
  const drift  = current - target;
  const within = Math.abs(drift) <= 0.001;
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
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-gray-400 z-10"
            style={{ left: `${(target / barMax) * 100}%` }}
          />
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

// ── Trade table row ───────────────────────────────────────────────────────────

function TradeRow({ trade }: { trade: ResolvedTrade }) {
  const isBuy = trade.deltaUsd > 0;
  return (
    <tr className="border-t border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-2">
        {trade.ticker ? (
          <div>
            <span className="font-mono font-medium text-gray-800">{trade.ticker}</span>
            <div className="text-xs text-gray-400">{AC_LABEL[trade.assetClass]}</div>
          </div>
        ) : (
          <span className="text-gray-600">{AC_LABEL[trade.assetClass]}</span>
        )}
      </td>
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
      {trade.inTaxableAccount && !isBuy
        ? <td className="px-4 py-2 text-xs text-amber-600">⚠ taxable sale</td>
        : <td className="px-4 py-2" />}
    </tr>
  );
}

// ── Per-account allocation mini-pies ─────────────────────────────────────────

/** Build pie slices from a by-class value map, filtering near-zero slivers. */
function buildPieSlices(byClass: Record<AssetClass, number>): PieSlice[] {
  return ALL_ASSET_CLASSES
    .filter(ac => byClass[ac] > 0.5)   // skip sub-dollar noise
    .map(ac => ({ label: AC_LABEL[ac], value: byClass[ac], color: AC_COLOR[ac] }));
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function ResultsPanel({ result, accounts, resolvedTrades, freeCash }: Props) {
  const { householdValue, currentWeights, targetWeights, projectedWeights,
          currentValueByAccount, trades, flags } = result;

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  function toggleCollapsed(id: string) {
    setCollapsed(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Separate flags by priority
  const importantFlags = [
    ...flags.filter(f => f.kind === 'EXCESS_CASH'),
    ...flags.filter(f => f.kind === 'REVISIT_PLACEMENT'),
    ...flags.filter(f => f.kind === 'UNMAPPED_HOLDING'),
    ...flags.filter(f => f.kind === 'TAXABLE_SALE'),
    ...flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER'),
  ];

  // Compute per-account cash deployment summary for the free cash banner.
  // Show when there is any free cash or per-account newCash to communicate.
  const cashRows = accounts
    .filter(a => !a.locked)
    .map(a => {
      const ownCash = a.newCash ?? 0;
      // Net trade delta = buys − sells for this account = cash being deployed.
      const netDeploy = trades
        .filter(t => t.accountId === a.id)
        .reduce((s, t) => s + t.deltaUsd, 0);
      return { account: a, ownCash, netDeploy };
    })
    .filter(r => r.ownCash > 0 || freeCash > 0);
  const showCashSummary = freeCash > 0 || accounts.some(a => a.newCash);

  // Group trades by account; include any account that has trades OR existing positions.
  // Accounts are ordered as they appear in the accounts array.
  const tradesByAccount = accounts
    .map(account => {
      // Raw trades used for per-class pie projection (accurate sub-class deltas).
      const acctRawTrades = trades.filter(t => t.accountId === account.id);
      // Resolved trades used for the table (merged blended-fund rows with tickers).
      const acctTrades = resolvedTrades
        .filter(t => t.accountId === account.id)
        .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
      const before = buildPieSlices(currentValueByAccount[account.id] ?? {});

      // After: apply raw trade deltas on top of current values.
      const afterByClass = { ...currentValueByAccount[account.id] } as Record<AssetClass, number>;
      for (const ac of ALL_ASSET_CLASSES) afterByClass[ac] ??= 0;
      for (const t of acctRawTrades) afterByClass[t.assetClass] += t.deltaUsd;
      const after = buildPieSlices(afterByClass);

      return { account, trades: acctTrades, before, after };
    })
    .filter(g => g.trades.length > 0 || g.before.length > 0);

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
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-baseline gap-4">
          <h2 className="text-lg font-semibold text-gray-800">Results</h2>
          <span className="text-sm text-gray-500">
            Household value: <strong className="text-gray-800">{fmtUsd(householdValue)}</strong>
          </span>
        </div>
        <button
          onClick={() => downloadReport(result, accounts, resolvedTrades)}
          title="Download interactive HTML report with trade checklist"
          className="text-xs text-gray-500 hover:text-gray-800 border border-gray-200 rounded px-2 py-1 hover:bg-gray-50 transition-colors shrink-0"
        >
          ↓ Report
        </button>
      </div>

      <HelpBox label="About these results">
        <p>
          Results show the <strong>household allocation</strong> (all accounts combined) vs. your target,
          followed by per-account trade recommendations. Everything recalculates live — change your
          strategy or positions and the output updates immediately.
        </p>

        <HelpSection title="Household allocation table">
          <HelpDef term="Current">Your actual allocation today, based on loaded positions.</HelpDef>
          <HelpDef term="Target">The target weight from your strategy.</HelpDef>
          <HelpDef term="Drift">Current minus Target. Amber = over target; Blue = under target; Green = within tolerance.</HelpDef>
          <HelpDef term="After trades">Projected allocation once the recommended trades are executed. Should closely match the target.</HelpDef>
          <HelpDef term="Classes within tolerance">Shown in the table but generate no trades. The tolerance band (±5% by default) suppresses small drift to avoid over-trading.</HelpDef>
        </HelpSection>

        <HelpSection title="Recommended trades">
          <p>
            Trades are grouped by account. Each entry shows the asset class, direction (BUY / SELL),
            and dollar amount. If a position has a share price loaded, share counts are shown too.
          </p>
          <HelpDef term="Net per account">
            The header row of each account shows the net dollar flow. In a pure rebalance (no new cash),
            this should be near zero — buys and sells within the account offset each other.
          </HelpDef>
          <HelpDef term="Before / After pies">
            Each account shows its current allocation (Before) and the projected allocation after executing
            the recommended trades (After). Useful for a quick sanity check before placing orders.
          </HelpDef>
        </HelpSection>

        <HelpSection title="Flags">
          <HelpDef term="REVISIT_PLACEMENT (orange)">
            Taxable share of household exceeds your Fixed Income target. The bonds-only taxable strategy
            is no longer viable — update placement rules in the Strategy tab.
          </HelpDef>
          <HelpDef term="TAXABLE_SALE (amber)">
            A sell lands in a taxable account. No gain estimate is provided in this version — review
            manually for capital gain implications before executing.
          </HelpDef>
          <HelpDef term="PLACEMENT_SPILLOVER (blue)">
            An asset class couldn't fully fit in its preferred bucket and spilled to a secondary one.
            This is informational; the engine handled it automatically.
          </HelpDef>
          <HelpDef term="NO_ELIGIBLE_ACCOUNT (red)">
            No account has capacity for a given asset class. Check account restrictions in the Accounts tab.
          </HelpDef>
          <HelpDef term="EXCESS_CASH (amber)">
            Household free cash could not be distributed because all accounts have deposits closed or are
            locked. Open deposits on at least one account in the Accounts tab.
          </HelpDef>
        </HelpSection>

        <p className="text-gray-400 italic">
          These recommendations are mechanical calculations from your own inputs. They are not investment advice.
          Review every trade, especially taxable sells, before placing any orders.
        </p>
      </HelpBox>

      {/* Priority flags */}
      {importantFlags.length > 0 && (
        <div className="space-y-2">
          {importantFlags.map((f, i) => (
            <FlagBanner key={i} flag={f} accounts={accounts} />
          ))}
        </div>
      )}

      {/* Cash deployment summary */}
      {showCashSummary && (
        <div className="border border-green-200 rounded-lg overflow-hidden">
          <div className="bg-green-50 px-4 py-2 text-xs font-medium text-green-800 flex items-center justify-between">
            <span>Cash deployment</span>
            {freeCash > 0 && (
              <span className="text-green-600">
                {fmtUsd(freeCash)} household free cash distributed to deposit-eligible accounts
              </span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Account</th>
                <th className="px-4 py-2 text-right">In-account cash</th>
                {freeCash > 0 && <th className="px-4 py-2 text-right">Free cash share</th>}
                <th className="px-4 py-2 text-right">Net deployed</th>
                <th className="px-4 py-2 text-right">Deposits</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.filter(a => !a.locked).map(a => {
                const ownCash = a.newCash ?? 0;
                const netDeploy = trades
                  .filter(t => t.accountId === a.id)
                  .reduce((s, t) => s + t.deltaUsd, 0);
                const depositsOpen = a.acceptsDeposits !== false;
                const freeCashShare = freeCash > 0 && depositsOpen
                  ? netDeploy - ownCash  // approximate: net − own cash ≈ free cash routed here
                  : 0;
                if (ownCash === 0 && freeCash === 0) return null;
                return (
                  <tr key={a.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{a.name}</td>
                    <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                      {ownCash > 0 ? fmtUsd(ownCash) : '—'}
                    </td>
                    {freeCash > 0 && (
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600">
                        {depositsOpen && freeCashShare > 0.5
                          ? <span className="text-green-700">{fmtUsd(freeCashShare)}</span>
                          : <span className="text-gray-400">—</span>}
                      </td>
                    )}
                    <td className="px-4 py-2 text-right tabular-nums font-medium">
                      {netDeploy > 0.5
                        ? <span className="text-green-700">+{fmtUsd(netDeploy)}</span>
                        : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                        depositsOpen ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'
                      }`}>
                        {depositsOpen ? 'Open' : 'Closed'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Household allocation table */}
      <div className="space-y-2">
        <h3 className="text-sm font-medium text-gray-700">Household allocation</h3>
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 uppercase tracking-wide">
              <tr>
                <th className="px-4 py-3 text-left">Asset class</th>
                <th className="px-4 py-3 text-right">Current</th>
                <th className="px-4 py-3 text-right">Target</th>
                <th className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    Drift
                    <HelpTip dir="up">
                      Current minus Target. Positive (amber) = over target. Negative (blue) =
                      under target. Classes within the tolerance band are shown in gray — no
                      trade is generated for them.
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-3 text-right">
                  <span className="inline-flex items-center justify-end gap-0.5">
                    After trades
                    <HelpTip dir="left">
                      Projected allocation once all recommended trades are executed. Should
                      closely match the target. Small residuals are normal due to the tolerance
                      band and minimum trade size filter.
                    </HelpTip>
                  </span>
                </th>
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

      {/* Per-account sections */}
      {resolvedTrades.length === 0 ? (
        <div className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-3">
          Portfolio is within tolerance — no trades needed.
        </div>
      ) : (
        <div className="space-y-4">
          <h3 className="text-sm font-medium text-gray-700">Recommended trades</h3>

          {tradesByAccount.map(({ account, trades: acctTrades, before, after }) => {
            const netUsd  = acctTrades.reduce((s, t) => s + t.deltaUsd, 0);
            const isOpen  = !collapsed.has(account.id);
            const hasBoth = before.length > 0 && after.length > 0;
            const locked  = account.locked;

            return (
              <div key={account.id} className="overflow-hidden border border-gray-200 rounded-lg">

                {/* ── Collapsible header ─────────────────────────────────── */}
                <button
                  className="w-full px-4 py-2.5 bg-gray-50 flex items-center gap-3 hover:bg-gray-100 transition-colors text-left"
                  onClick={() => toggleCollapsed(account.id)}
                >
                  <span className="flex-1 flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium text-gray-700">{account.name}</span>
                    <span className="text-xs text-gray-400">
                      {account.institution} · {ACCT_TYPE_LABEL[account.type]}
                    </span>
                    {locked && (
                      <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        🔒 locked
                      </span>
                    )}
                  </span>
                  {acctTrades.length > 0 && (
                    <span className="text-xs text-gray-500 shrink-0">
                      Net: <span className={netUsd >= 0 ? 'text-green-600 font-medium' : 'text-red-600 font-medium'}>
                        {fmtDelta(netUsd)}
                      </span>
                    </span>
                  )}
                  <span className="text-gray-400 text-xs ml-1">{isOpen ? '▾' : '▸'}</span>
                </button>

                {/* ── Expanded body ──────────────────────────────────────── */}
                {isOpen && (
                  <div>
                    {/* Before / After pies */}
                    {(before.length > 0 || after.length > 0) && (
                      <div className={`px-4 py-4 border-b border-gray-100 ${hasBoth ? 'grid grid-cols-2 gap-6' : ''}`}>
                        {before.length > 0 && (
                          <PieChart
                            title="Before"
                            slices={before}
                            size={88}
                          />
                        )}
                        {after.length > 0 && (
                          <PieChart
                            title={acctTrades.length > 0 ? 'After trades' : 'Current'}
                            slices={after}
                            size={88}
                          />
                        )}
                      </div>
                    )}

                    {/* Trade table */}
                    {acctTrades.length > 0 && (
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
                            <TradeRow key={i} trade={t} />
                          ))}
                        </tbody>
                      </table>
                    )}

                    {acctTrades.length === 0 && (
                      <p className="px-4 py-3 text-xs text-gray-400 italic">
                        No trades — portfolio is within tolerance for this account.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
