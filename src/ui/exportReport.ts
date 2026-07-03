/**
 * exportReport.ts
 *
 * Generates a self-contained HTML rebalance-report file and triggers a
 * browser download.  The file requires no external dependencies — all styles
 * and the tiny checkbox-persistence script are inlined.
 *
 * Key design decisions:
 *  • HTML over PDF: browser-native checkboxes work everywhere; the user can
 *    still do File → Print → "Save as PDF" for a static snapshot.
 *  • Inline SVG pie charts: same arc math as PieChart.tsx, no dependencies.
 *  • Checkbox state is saved to localStorage keyed by a report ID derived
 *    from the generation date + household value, so each unique snapshot
 *    keeps its own progress even when multiple reports coexist.
 */

import type { Account, AssetClass, RebalanceResult, ResolvedTrade } from '../engine/types';
import { ALL_ASSET_CLASSES } from '../engine/types';
import { withdrawalPriorityOf, isWithdrawalEligible } from '../engine/rebalance';
import { isTaxableSale } from '../engine/taxableSale';
import { AC_COLOR, AC_LABEL, ACCT_TYPE_LABEL, fmtUsd, fmtPct, fmtDelta } from './fmt';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── SVG pie chart (mirrors PieChart.tsx math) ─────────────────────────────────

interface Slice { label: string; value: number; color: string; }

function polarXY(cx: number, cy: number, r: number, deg: number) {
  const rad = (deg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= 359.999) {
    // Full circle: can't draw a single arc to the same point.
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${(cx - 0.001).toFixed(3)} ${cy - r} Z`;
  }
  const s = polarXY(cx, cy, r, start);
  const e = polarXY(cx, cy, r, end);
  const large = end - start > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)} Z`;
}

function pieSvg(slices: Slice[], size = 88): string {
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  if (total === 0) return '';
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let cursor = 0;
  const paths = slices.map(sl => {
    const deg  = (sl.value / total) * 360;
    const d    = arcPath(cx, cy, r, cursor, cursor + deg);
    const pct  = ((sl.value / total) * 100).toFixed(1);
    const tip  = `${esc(sl.label)}: ${esc(fmtUsd(sl.value))} (${pct}%)`;
    cursor += deg;
    return `<path d="${d}" fill="${sl.color}" stroke="white" stroke-width="1.5"><title>${tip}</title></path>`;
  }).join('');
  return `<svg width="${size}" height="${size}" style="flex-shrink:0;display:block">${paths}</svg>`;
}

function pieBlock(title: string, slices: Slice[]): string {
  if (slices.length === 0) return '';
  const total = slices.reduce((s, sl) => s + sl.value, 0);
  const legend = slices.map(sl => {
    const pct = ((sl.value / total) * 100).toFixed(1);
    return `<div style="display:flex;align-items:center;gap:5px;margin-bottom:4px">
      <span style="width:8px;height:8px;border-radius:2px;background:${sl.color};flex-shrink:0"></span>
      <span style="color:#374151;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(sl.label)}</span>
      <span style="color:#9ca3af;font-variant-numeric:tabular-nums;margin-left:6px">${pct}%</span>
    </div>`;
  }).join('');
  return `<div style="flex:1;min-width:0">
    <p style="font-size:10px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;margin:0 0 8px">${esc(title)}</p>
    <div style="display:flex;align-items:center;gap:14px">
      ${pieSvg(slices, 88)}
      <div style="min-width:0;flex:1;font-size:11px">${legend}</div>
    </div>
  </div>`;
}

// ── Build per-account pie slices ──────────────────────────────────────────────

function buildSlices(byClass: Record<AssetClass, number>): Slice[] {
  return ALL_ASSET_CLASSES
    .filter(ac => (byClass[ac] ?? 0) > 0.5)
    .map(ac => ({ label: AC_LABEL[ac], value: byClass[ac], color: AC_COLOR[ac] }));
}

// ── Concentric donut (outer = target, inner = current) ────────────────────────

function concentricDonutSvg(
  currentWeights: Record<AssetClass, number>,
  targetWeights: Record<AssetClass, number>,
  size = 140,
): string {
  const cx = size / 2, cy = size / 2;
  const outerR   = size / 2 - 4;
  const outerInR = Math.round(outerR * 0.68);
  const innerOutR = Math.round(outerR * 0.62);
  const innerInR  = Math.round(outerR * 0.30);

  function pt(deg: number, r: number) {
    const rad = (deg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function annular(oR: number, iR: number, s: number, e: number): string {
    if (e - s >= 359.999) {
      const oT = pt(0, oR), oB = pt(180, oR), iT = pt(0, iR), iB = pt(180, iR);
      return `M${oT.x} ${oT.y} A${oR} ${oR} 0 1 1 ${oB.x} ${oB.y} A${oR} ${oR} 0 1 1 ${oT.x} ${oT.y} M${iT.x} ${iT.y} A${iR} ${iR} 0 1 0 ${iB.x} ${iB.y} A${iR} ${iR} 0 1 0 ${iT.x} ${iT.y} Z`;
    }
    const oS = pt(s, oR), oE = pt(e, oR), iS = pt(s, iR), iE = pt(e, iR);
    const lg = e - s > 180 ? 1 : 0;
    return `M${oS.x.toFixed(2)} ${oS.y.toFixed(2)} A${oR} ${oR} 0 ${lg} 1 ${oE.x.toFixed(2)} ${oE.y.toFixed(2)} L${iE.x.toFixed(2)} ${iE.y.toFixed(2)} A${iR} ${iR} 0 ${lg} 0 ${iS.x.toFixed(2)} ${iS.y.toFixed(2)} Z`;
  }
  function toSegs(weights: Record<AssetClass, number>) {
    const total = ALL_ASSET_CLASSES.reduce((s, ac) => s + (weights[ac] ?? 0), 0);
    if (total === 0) return [];
    let cur = 0;
    return ALL_ASSET_CLASSES
      .filter(ac => (weights[ac] ?? 0) > 0.001)
      .map(ac => { const start = cur; cur += (weights[ac] / total) * 360; return { ac, start, end: cur }; });
  }
  const outerSegs = toSegs(targetWeights);
  const innerSegs = toSegs(currentWeights);
  const paths = [
    ...outerSegs.map(({ ac, start, end }) =>
      `<path d="${annular(outerR, outerInR, start, end)}" fill="${AC_COLOR[ac]}" stroke="white" stroke-width="1.5"><title>${esc(AC_LABEL[ac])}: target ${fmtPct(targetWeights[ac])}</title></path>`),
    ...innerSegs.map(({ ac, start, end }) =>
      `<path d="${annular(innerOutR, innerInR, start, end)}" fill="${AC_COLOR[ac]}" stroke="white" stroke-width="1.5"><title>${esc(AC_LABEL[ac])}: current ${fmtPct(currentWeights[ac])}</title></path>`),
  ].join('');

  const legendClasses = ALL_ASSET_CLASSES.filter(
    ac => (currentWeights[ac] ?? 0) > 0.001 || (targetWeights[ac] ?? 0) > 0.001,
  );
  const legend = legendClasses.map(ac => `
    <div style="display:flex;align-items:center;gap:6px;font-size:11px;margin-bottom:3px">
      <span style="width:8px;height:8px;border-radius:2px;background:${AC_COLOR[ac]};flex-shrink:0"></span>
      <span style="color:#4b5563;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(AC_LABEL[ac])}</span>
      <span style="width:44px;text-align:right;color:#6b7280;font-variant-numeric:tabular-nums">${(currentWeights[ac] ?? 0) > 0.001 ? fmtPct(currentWeights[ac]) : '—'}</span>
      <span style="width:44px;text-align:right;color:#6b7280;font-variant-numeric:tabular-nums">${(targetWeights[ac] ?? 0) > 0.001 ? fmtPct(targetWeights[ac]) : '—'}</span>
    </div>`).join('');

  return `
  <div style="display:flex;align-items:flex-start;gap:16px;padding:16px">
    <svg width="${size}" height="${size}" style="flex-shrink:0">${paths}</svg>
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#9ca3af;margin-bottom:6px">
        <span style="width:8px;height:8px"></span>
        <span style="flex:1"></span>
        <span style="width:44px;text-align:right">Current</span>
        <span style="width:44px;text-align:right">Target</span>
      </div>
      ${legend}
      <div style="margin-top:8px;font-size:10px;color:#9ca3af">outer = target &nbsp;·&nbsp; inner = current</div>
    </div>
  </div>`;
}

// ── CSS ───────────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;font-size:14px;color:#111827;background:#f3f4f6;padding:24px 16px 48px}
h1{font-size:20px;font-weight:700;color:#111827}
h2{font-size:13px;font-weight:600;color:#374151;text-transform:uppercase;letter-spacing:.05em;margin-bottom:10px}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:16px}
.card-header{background:#f9fafb;padding:10px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #e5e7eb;cursor:pointer;user-select:none}
.card-body{padding:16px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{background:#f9fafb;padding:7px 12px;text-align:left;font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid #e5e7eb}
td{padding:7px 12px;border-top:1px solid #f3f4f6;vertical-align:middle}
.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;font-size:11px;font-weight:700;padding:1px 7px;border-radius:99px}
.buy{background:#dcfce7;color:#15803d}
.sell{background:#fee2e2;color:#b91c1c}
.limited{background:#fef3c7;color:#b45309}
.flag{padding:10px 14px;border-radius:6px;font-size:13px;margin-bottom:10px}
.flag-warn{background:#fffbeb;border:1px solid #fcd34d;color:#92400e}
.flag-orange{background:#fff7ed;border:1px solid #fdba74;color:#9a3412}
.flag-blue{background:#eff6ff;border:1px solid #93c5fd;color:#1d4ed8}
.flag-red{background:#fef2f2;border:1px solid #fca5a5;color:#991b1b}
.trade-item{display:flex;align-items:center;gap:12px;padding:8px 12px;border-top:1px solid #f3f4f6;transition:opacity .15s}
.trade-item.done{opacity:.4}
.trade-item.done .trade-label{text-decoration:line-through}
.trade-check{width:16px;height:16px;flex-shrink:0;cursor:pointer;accent-color:#4f46e5}
.progress{font-size:12px;color:#6b7280;margin-left:auto}
.print-btn{background:#4f46e5;color:#fff;border:none;border-radius:6px;padding:7px 16px;font-size:13px;font-weight:600;cursor:pointer}
.print-btn:hover{background:#4338ca}
.no-print{}
@media print{
  body{background:#fff;padding:0}
  .no-print{display:none!important}
  .card{border:1px solid #ccc;break-inside:avoid}
  .card-header{background:#f5f5f5}
}
`;

// ── Embedded script (checkbox persistence + collapse + progress) ──────────────

function script(reportId: string): string {
  return `
<script>
(function(){
  var ID="${reportId}";

  // Collapsible account cards
  document.querySelectorAll('.card-toggle').forEach(function(btn){
    btn.addEventListener('click',function(){
      var body=document.getElementById(btn.dataset.target);
      if(!body)return;
      var open=body.style.display!=='none';
      body.style.display=open?'none':'block';
      var chevron=btn.querySelector('.chevron');
      if(chevron)chevron.textContent=open?'▸':'▾';
    });
  });

  // Checkbox persistence + progress
  var boxes=document.querySelectorAll('.trade-check');
  var total=boxes.length;
  function updateProgress(){
    var done=[].filter.call(boxes,function(b){return b.checked}).length;
    document.querySelectorAll('.progress').forEach(function(el){
      el.textContent=done+' / '+total+' completed';
    });
  }
  boxes.forEach(function(cb){
    var key=ID+':'+cb.id;
    try{if(localStorage.getItem(key)==='1'){cb.checked=true;cb.closest('.trade-item').classList.add('done');}}catch(e){}
    cb.addEventListener('change',function(){
      cb.closest('.trade-item').classList.toggle('done',cb.checked);
      try{cb.checked?localStorage.setItem(key,'1'):localStorage.removeItem(key);}catch(e){}
      updateProgress();
    });
  });
  updateProgress();
})();
<\/script>`;
}

// ── Main builder ──────────────────────────────────────────────────────────────

// Exported (in addition to the DOM-triggering downloadReport below) so tests can
// assert on the generated markup without a DOM/Blob/URL environment (issue #130).
export function buildHtml(result: RebalanceResult, accounts: Account[], resolvedTrades: ResolvedTrade[], freeCash: number, plannedWithdrawal: number, now: Date): string {
  const {
    householdValue, currentWeights, targetWeights, projectedWeights,
    nativeValueByAccount, projectedNativeValueByAccount, withdrawalByAccount, depositByAccount, trades, flags,
  } = result;

  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const reportId = `rebalance-${localDate}-${Math.round(householdValue)}`;
  const versionTag = `v${__APP_VERSION__} · ${__COMMIT_SHA__}`;

  // ── Flags section (order matches Results tab) ─────────────────────────────
  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;

  const orderedFlags = [
    ...flags.filter(f => f.kind === 'EXCESS_CASH'),
    ...flags.filter(f => f.kind === 'WITHDRAWAL_SHORTFALL'),
    ...flags.filter(f => f.kind === 'REVISIT_PLACEMENT'),
    ...flags.filter(f => f.kind === 'UNMAPPED_HOLDING'),
    ...flags.filter(f => f.kind === 'FIVE_TWENTY_NINE_REBALANCE_LIMIT'),
    ...flags.filter(f => f.kind === 'TAXABLE_SALE'),
    ...flags.filter(f => f.kind === 'BLENDED_FUND_OVERSELL'),
    ...flags.filter(f => f.kind === 'BLENDED_FUND_SOLD'),
    ...flags.filter(f => f.kind === 'PLACEMENT_SPILLOVER'),
    ...flags.filter(f => f.kind === 'NO_ELIGIBLE_ACCOUNT'),
  ];

  const flagsHtml = orderedFlags.map(f => {
    if (f.kind === 'EXCESS_CASH')
      return `<div class="flag flag-warn"><strong>Free cash undeployed:</strong> ${fmtUsd(f.amountUsd)} of household free cash could not be distributed — every eligible account is closed, locked, or has hit its deposit limit.</div>`;
    if (f.kind === 'WITHDRAWAL_SHORTFALL')
      return `<div class="flag flag-warn"><strong>Withdrawal not fully funded:</strong> ${fmtUsd(f.amountUsd)} of the additional withdrawal could not be raised — every withdrawal-eligible account is restricted, locked, or has sold all it can.</div>`;
    if (f.kind === 'REVISIT_PLACEMENT')
      return `<div class="flag flag-orange"><strong>Revisit placement strategy.</strong> Taxable accounts hold ${fmtPct(f.taxableShare)} of household value, exceeding the ${fmtPct(f.fixedIncomeTarget)} fixed-income target. Equities must land in taxable accounts.</div>`;
    if (f.kind === 'UNMAPPED_HOLDING')
      return `<div class="flag flag-warn"><strong>Unmapped holding:</strong> Ticker <code>${esc(f.ticker)}</code> has no asset class — excluded from rebalance. Assign it in the Classify tab.</div>`;
    if (f.kind === 'FIVE_TWENTY_NINE_REBALANCE_LIMIT') {
      const names = f.accountIds.map(id => esc(acctName(id))).join(', ');
      return `<div class="flag flag-warn"><strong>529 rebalance limit:</strong> Trades are recommended for ${names}. The IRS allows only <strong>2 investment-direction changes per 529 account per calendar year.</strong></div>`;
    }
    if (f.kind === 'TAXABLE_SALE')
      return `<div class="flag flag-warn"><strong>Taxable sale:</strong> Selling ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} in <em>${esc(acctName(f.accountId))}</em> may trigger a capital gain. Review before executing.</div>`;
    if (f.kind === 'BLENDED_FUND_SOLD')
      return `<div class="flag flag-blue"><strong>Blended fund sold:</strong> ${fmtUsd(f.amountUsd)} of <code>${esc(f.ticker)}</code> in <em>${esc(acctName(f.accountId))}</em> sold proportionally to fix the household allocation. The engine sells blended funds when drift demands but does not buy them back, so repeated rebalances will trend your allocation away from this position.</div>`;
    if (f.kind === 'BLENDED_FUND_OVERSELL')
      return `<div class="flag flag-red"><strong>Blended fund over-sell:</strong> Selling <code>${esc(f.ticker)}</code> in <em>${esc(acctName(f.accountId))}</em> forced an extra ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} to be sold, with no non-blended ticker available to buy it back.</div>`;
    if (f.kind === 'PLACEMENT_SPILLOVER')
      return `<div class="flag flag-blue"><strong>Placement spillover:</strong> ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} placed in a ${esc(f.bucket.toLowerCase().replace('_', '-'))} account (preferred bucket full).</div>`;
    if (f.kind === 'NO_ELIGIBLE_ACCOUNT')
      return `<div class="flag flag-red"><strong>No eligible account:</strong> ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} could not be placed — no account has capacity for this asset class.</div>`;
    return '';
  }).join('');

  // ── Cash deployment summary ────────────────────────────────────────────────
  const unlockedAccounts = accounts.filter(a => !a.locked);
  const showCashSummary = freeCash > 0 || unlockedAccounts.some(a => a.newCash);
  const cashRows = unlockedAccounts.map(a => {
    const ownCash   = a.newCash ?? 0;
    const netDeploy = trades.filter(t => t.accountId === a.id).reduce((s, t) => s + t.deltaUsd, 0);
    const depositsOpen = a.acceptsDeposits !== false;
    const limited = depositsOpen && a.depositLimitUsd != null;
    // Exact household-free-cash deposit routed here (issues #84/#87).
    const freeCashShare = depositByAccount[a.id] ?? 0;
    if (ownCash === 0 && freeCash === 0) return '';
    const depositBadge = !depositsOpen
      ? `<span class="badge sell">Closed</span>`
      : limited
      ? `<span class="badge limited">Open · ${esc(fmtUsd(a.depositLimitUsd!))} cap</span>`
      : `<span class="badge buy">Open</span>`;
    return `<tr>
      <td style="font-weight:600;color:#111827">${esc(a.name)}</td>
      <td class="num" style="color:#374151">${ownCash > 0 ? esc(fmtUsd(ownCash)) : '—'}</td>
      ${freeCash > 0 ? `<td class="num" style="color:${depositsOpen && freeCashShare > 0.5 ? '#16a34a' : '#9ca3af'}">${depositsOpen && freeCashShare > 0.5 ? esc(fmtUsd(freeCashShare)) : '—'}</td>` : ''}
      <td class="num" style="color:${netDeploy > 0.5 ? '#16a34a' : '#9ca3af'}">${netDeploy > 0.5 ? '+' + esc(fmtUsd(netDeploy)) : '—'}</td>
      <td class="num">${depositBadge}</td>
    </tr>`;
  }).join('');

  const cashSection = showCashSummary ? `
  <div style="border:1px solid #bbf7d0;border-radius:8px;overflow:hidden;margin-bottom:16px">
    <div style="background:#f0fdf4;padding:8px 16px;font-size:12px;font-weight:600;color:#166534;display:flex;justify-content:space-between;align-items:center">
      <span>Cash deployment</span>
      ${freeCash > 0 ? `<span style="color:#16a34a">${esc(fmtUsd(freeCash))} household free cash distributed to deposit-eligible accounts</span>` : ''}
    </div>
    <table>
      <thead><tr>
        <th>Account</th>
        <th class="num">In-account cash</th>
        ${freeCash > 0 ? '<th class="num">Free cash share</th>' : ''}
        <th class="num">Net deployed</th>
        <th class="num">Deposits</th>
      </tr></thead>
      <tbody>${cashRows}</tbody>
    </table>
  </div>` : '';

  // ── Spending / withdrawal plan ──────────────────────────────────────────────
  const totalRmd = unlockedAccounts.reduce((s, a) => s + (a.rmdDueUsd ?? 0), 0);
  const totalWithdrawal = totalRmd + plannedWithdrawal; // Σ RMD + additional
  const showWithdrawalPlan = totalWithdrawal > 0;
  const wdRowData = unlockedAccounts
    .map(a => ({ account: a, withdrawn: withdrawalByAccount[a.id] ?? 0, rmd: a.rmdDueUsd ?? 0 }))
    .filter(r => r.withdrawn > 0.5 || r.rmd > 0)
    .sort((x, y) => withdrawalPriorityOf(x.account) - withdrawalPriorityOf(y.account)
      || x.account.name.localeCompare(y.account.name));
  const totalRaised = wdRowData.reduce((s, r) => s + r.withdrawn, 0);
  const wdRows = wdRowData.map(({ account: a, withdrawn, rmd }) => {
    const required = rmd > 0;
    const restricted = !required && !isWithdrawalEligible(a);
    const badge = restricted
      ? `<span class="badge sell">Restricted</span>`
      : required
      ? `<span class="badge limited">Required</span>`
      : `<span class="badge buy">Eligible</span>`;
    return `<tr>
      <td style="font-weight:600;color:#111827">${esc(a.name)}</td>
      <td class="num" style="color:${rmd > 0 ? '#1d4ed8' : '#9ca3af'}">${rmd > 0 ? esc(fmtUsd(rmd)) : '—'}</td>
      <td class="num" style="color:${withdrawn > 0.5 ? '#b45309' : '#9ca3af'}">${withdrawn > 0.5 ? '−' + esc(fmtUsd(withdrawn)) : '—'}</td>
      <td class="num">${badge}</td>
    </tr>`;
  }).join('');

  const withdrawalSection = showWithdrawalPlan ? `
  <div style="border:1px solid #fde68a;border-radius:8px;overflow:hidden;margin-bottom:16px">
    <div style="background:#fffbeb;padding:8px 16px;font-size:12px;font-weight:600;color:#92400e;display:flex;justify-content:space-between;align-items:center">
      <span>Spending / withdrawal plan</span>
      <span style="color:#b45309">${esc(fmtUsd(totalRaised))} raised of ${esc(fmtUsd(totalWithdrawal))} planned</span>
    </div>
    <table>
      <thead><tr>
        <th>Account</th>
        <th class="num">RMD due</th>
        <th class="num">Withdrawn</th>
        <th class="num">Withdrawals</th>
      </tr></thead>
      <tbody>${wdRows}</tbody>
    </table>
  </div>` : '';

  // ── Household allocation table ──────────────────────────────────────────────
  const allocRows = ALL_ASSET_CLASSES.map(ac => {
    const cur  = currentWeights[ac];
    const tgt  = targetWeights[ac];
    const proj = projectedWeights[ac];
    const drift = cur - tgt;
    const driftColor = Math.abs(drift) < 0.001 ? '#9ca3af' : drift > 0 ? '#d97706' : '#2563eb';
    return `<tr>
      <td>${esc(AC_LABEL[ac])}</td>
      <td class="num">${fmtPct(cur)}</td>
      <td class="num">${fmtPct(tgt)}</td>
      <td class="num" style="color:${driftColor}">${drift >= 0 ? '+' : ''}${fmtPct(drift)}</td>
      <td class="num" style="color:#6b7280">${fmtPct(proj)}</td>
    </tr>`;
  }).join('');

  const allocSection = `
  <div class="card">
    <div class="card-header card-toggle" data-target="body-household">
      <h2 style="margin:0;flex:1">Household Allocation</h2>
      <span class="chevron" style="font-size:11px;color:#9ca3af">▾</span>
    </div>
    <div id="body-household">
      ${concentricDonutSvg(currentWeights, targetWeights)}
      <div style="border-top:1px solid #f3f4f6">
        <table>
          <thead><tr>
            <th>Asset Class</th>
            <th class="num">Current</th>
            <th class="num">Target</th>
            <th class="num">Drift</th>
            <th class="num">After Trades</th>
          </tr></thead>
          <tbody>${allocRows}</tbody>
        </table>
      </div>
    </div>
  </div>`;

  // ── Per-account trade sections ──────────────────────────────────────────────
  let tradeIndex = 0;

  const accountSections = accounts.map(acct => {
    // Resolved trades for the checklist (merged blended-fund rows with tickers).
    const acctTrades = resolvedTrades
      .filter(t => t.accountId === acct.id)
      .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
    // Before / After pies use the holdings lens (issue #78): granularity matches
    // what's actually held, not the engine's redistributed allocation lens.
    const before = buildSlices(nativeValueByAccount[acct.id] ?? {} as Record<AssetClass, number>);
    const after  = buildSlices(projectedNativeValueByAccount[acct.id] ?? {} as Record<AssetClass, number>);

    // Transfers in/out of the account (issues #84/#87). Deploying in-account idle
    // cash is balance-neutral, so the Net change = deposits − withdrawals only.
    const deposit    = depositByAccount[acct.id] ?? 0;
    const withdrawal = withdrawalByAccount[acct.id] ?? 0;
    const hasTransfer = deposit > 0.5 || withdrawal > 0.5;

    // Skip accounts with no positions, no trades, and no transfers.
    if (before.length === 0 && acctTrades.length === 0 && !hasTransfer) return '';

    const netUsd = deposit - withdrawal;
    const netColor = Math.abs(netUsd) < 0.5 ? '#6b7280' : netUsd > 0 ? '#16a34a' : '#dc2626';
    const netStr = (acctTrades.length > 0 || hasTransfer)
      ? `<span style="font-size:12px;color:${netColor};font-weight:600">${fmtDelta(netUsd)}</span>`
      : '';
    const lockBadge = acct.locked
      ? `<span style="font-size:11px;background:#fef3c7;color:#92400e;border:1px solid #fcd34d;border-radius:99px;padding:1px 8px">🔒 locked</span>`
      : '';

    const piesHtml = (before.length > 0 || after.length > 0) ? `
      <div style="display:flex;gap:24px;padding:14px 16px;border-bottom:1px solid #f3f4f6;flex-wrap:wrap">
        ${pieBlock('Before', before)}
        ${after.length > 0 ? pieBlock(acctTrades.length > 0 ? 'After trades' : 'Current', after) : ''}
      </div>` : '';

    const tradeRows = acctTrades.map(t => {
      const isBuy = t.deltaUsd > 0;
      const id    = `t-${tradeIndex++}`;
      const taxWarn = isTaxableSale(t)
        ? `<span style="font-size:11px;color:#d97706;margin-left:8px">⚠ taxable sale</span>` : '';
      const tradeLabel = t.ticker
        ? `<span style="font-family:monospace;font-weight:600;color:#111827">${esc(t.ticker)}</span>
           <span style="font-size:11px;color:#9ca3af;margin-left:4px">${esc(AC_LABEL[t.assetClass])}</span>`
        : esc(AC_LABEL[t.assetClass]);
      const ariaLabel = `${t.ticker ?? AC_LABEL[t.assetClass]} ${isBuy ? 'buy' : 'sell'}`;
      return `<div class="trade-item" id="item-${id}">
        <input type="checkbox" class="trade-check" id="${id}" aria-label="${esc(ariaLabel)}">
        <span class="badge ${isBuy ? 'buy' : 'sell'}">${isBuy ? 'BUY' : 'SELL'}</span>
        <span class="trade-label" style="flex:1;color:#374151">${tradeLabel}</span>
        <span style="font-weight:600;color:${isBuy ? '#16a34a' : '#dc2626'};font-variant-numeric:tabular-nums">${fmtDelta(t.deltaUsd)}</span>
        ${taxWarn}
      </div>`;
    }).join('');

    // Transfer line items (issues #84/#87): deposit at the top, withdrawal at the
    // bottom — bracketing the trades. Checkable like trades since they're actions.
    const depositRow = deposit > 0.5 ? (() => {
      const id = `t-${tradeIndex++}`;
      return `<div class="trade-item" id="item-${id}">
        <input type="checkbox" class="trade-check" id="${id}" aria-label="deposit transfer in">
        <span class="badge" style="background:#e0e7ff;color:#4338ca">DEPOSIT</span>
        <span class="trade-label" style="flex:1;color:#374151">Transfer in
          <span style="font-size:11px;color:#9ca3af;margin-left:4px">household free cash</span></span>
        <span style="font-weight:600;color:#4338ca;font-variant-numeric:tabular-nums">+${esc(fmtUsd(deposit))}</span>
      </div>`;
    })() : '';
    const withdrawalRow = withdrawal > 0.5 ? (() => {
      const id = `t-${tradeIndex++}`;
      return `<div class="trade-item" id="item-${id}">
        <input type="checkbox" class="trade-check" id="${id}" aria-label="withdrawal transfer out">
        <span class="badge" style="background:#fef3c7;color:#92400e">WITHDRAW</span>
        <span class="trade-label" style="flex:1;color:#374151">Transfer out
          <span style="font-size:11px;color:#9ca3af;margin-left:4px">withdrawal</span></span>
        <span style="font-weight:600;color:#b45309;font-variant-numeric:tabular-nums">−${esc(fmtUsd(withdrawal))}</span>
      </div>`;
    })() : '';

    const noTradesNote = acctTrades.length === 0 && !hasTransfer
      ? `<p style="padding:12px 16px;font-size:12px;color:#9ca3af;font-style:italic">Within tolerance — no trades required.</p>` : '';

    // Holdings table: asset class → current value → % of account
    const acctTotal = before.reduce((s, sl) => s + sl.value, 0);
    const holdingsRows = before.map(sl => {
      const pct = acctTotal > 0 ? ((sl.value / acctTotal) * 100).toFixed(1) : '0.0';
      return `<tr>
        <td style="display:flex;align-items:center;gap:6px">
          <span style="width:8px;height:8px;border-radius:2px;background:${sl.color};flex-shrink:0"></span>
          ${esc(sl.label)}
        </td>
        <td class="num">${esc(fmtUsd(sl.value))}</td>
        <td class="num" style="color:#6b7280">${pct}%</td>
      </tr>`;
    }).join('');
    const holdingsHtml = before.length > 0 ? `
      <table style="margin-bottom:0">
        <thead><tr>
          <th>Holding</th>
          <th class="num">Balance</th>
          <th class="num">% of account</th>
        </tr></thead>
        <tbody>${holdingsRows}</tbody>
      </table>` : '';

    const cardBodyId = `body-${acct.id.replace(/[^a-zA-Z0-9]/g, '-')}`;

    return `
    <div class="card">
      <div class="card-header card-toggle" data-target="${cardBodyId}">
        <div style="flex:1">
          <span style="font-weight:600;color:#111827">${esc(acct.name)}</span>
          <span style="font-size:12px;color:#9ca3af;margin-left:8px">${esc(acct.institution)} · ${esc(ACCT_TYPE_LABEL[acct.type])}</span>
          ${lockBadge}
        </div>
        ${netStr}
        <span class="chevron" style="font-size:11px;color:#9ca3af;margin-left:8px">▾</span>
      </div>
      <div id="${cardBodyId}">
        ${holdingsHtml ? `<div style="border-bottom:1px solid #f3f4f6">${holdingsHtml}</div>` : ''}
        ${piesHtml}
        ${depositRow}
        ${tradeRows}
        ${withdrawalRow}
        ${noTradesNote}
      </div>
    </div>`;
  }).join('');

  // ── Assemble ────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rebalance Report — ${esc(dateStr)}</title>
<style>${CSS}</style>
</head>
<body>
<div style="max-width:860px;margin:0 auto">

  <!-- Header -->
  <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px;gap:12px;flex-wrap:wrap">
    <div>
      <h1>Portfolio Rebalance Report</h1>
      <p style="font-size:13px;color:#6b7280;margin-top:4px">
        Generated ${esc(dateStr)} at ${esc(timeStr)} &nbsp;·&nbsp;
        Household value: <strong style="color:#111827">${esc(fmtUsd(householdValue))}</strong>
      </p>
      <p style="font-size:11px;color:#9ca3af;margin-top:2px">${esc(versionTag)}</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px" class="no-print">
      <span class="progress"></span>
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>

  <!-- Flags -->
  ${flagsHtml}

  <!-- Cash deployment -->
  ${cashSection}

  <!-- Spending / withdrawal plan -->
  ${withdrawalSection}

  <!-- Allocation table -->
  ${allocSection}

  <!-- Per-account sections -->
  <h2 style="margin-bottom:10px">${resolvedTrades.length > 0 ? 'Recommended Trades' : 'Account Allocations'}</h2>
  ${resolvedTrades.length === 0
    ? `<div class="flag flag-blue" style="border-color:#86efac;background:#f0fdf4;color:#166534"><strong>Portfolio is within tolerance — no trades needed.</strong></div>`
    : ''
  }
  ${accountSections}

</div>
${script(reportId)}
</body>
</html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function downloadReport(result: RebalanceResult, accounts: Account[], resolvedTrades: ResolvedTrade[], freeCash: number, plannedWithdrawal: number): void {
  const now  = new Date();
  const html = buildHtml(result, accounts, resolvedTrades, freeCash, plannedWithdrawal, now);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  a.download = `rebalance-report-${localDate}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
