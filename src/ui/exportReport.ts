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
import { AC_COLOR, AC_LABEL, ACCT_TYPE_LABEL } from './fmt';

// ── Formatting helpers (standalone — no Intl dependency on caller side) ──────

function fmtUsd(v: number): string {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

function fmtPct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDelta(v: number): string {
  return (v >= 0 ? '+' : '−') + fmtUsd(Math.abs(v));
}

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

// ── Embedded script (checkbox persistence + strikethrough + progress) ─────────

function script(reportId: string): string {
  return `
<script>
(function(){
  var ID="${reportId}";
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

function buildHtml(result: RebalanceResult, accounts: Account[], resolvedTrades: ResolvedTrade[], now: Date): string {
  const {
    householdValue, currentWeights, targetWeights, projectedWeights,
    currentValueByAccount, trades, flags,
  } = result;

  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  const reportId = `rebalance-${now.toISOString().slice(0, 10)}-${Math.round(householdValue)}`;

  // ── Flags section ───────────────────────────────────────────────────────────
  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;

  const flagsHtml = flags.filter(f =>
    f.kind === 'REVISIT_PLACEMENT' || f.kind === 'TAXABLE_SALE' ||
    f.kind === 'UNMAPPED_HOLDING'  || f.kind === 'PLACEMENT_SPILLOVER' ||
    f.kind === 'NO_ELIGIBLE_ACCOUNT'
  ).map(f => {
    if (f.kind === 'REVISIT_PLACEMENT')
      return `<div class="flag flag-orange"><strong>Revisit placement strategy.</strong> Taxable accounts hold ${fmtPct(f.taxableShare)} of household value, exceeding the ${fmtPct(f.fixedIncomeTarget)} fixed-income target. Equities must land in taxable accounts.</div>`;
    if (f.kind === 'TAXABLE_SALE')
      return `<div class="flag flag-warn"><strong>Taxable sale:</strong> Selling ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} in <em>${esc(acctName(f.accountId))}</em> may trigger a capital gain. Review before executing.</div>`;
    if (f.kind === 'UNMAPPED_HOLDING')
      return `<div class="flag flag-warn"><strong>Unmapped holding:</strong> Ticker <code>${esc(f.ticker)}</code> has no asset class — excluded from rebalance. Assign it in the Classify tab.</div>`;
    if (f.kind === 'PLACEMENT_SPILLOVER')
      return `<div class="flag flag-blue"><strong>Placement spillover:</strong> ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} placed in a ${esc(f.bucket.toLowerCase().replace('_', '-'))} account (preferred bucket full).</div>`;
    if (f.kind === 'NO_ELIGIBLE_ACCOUNT')
      return `<div class="flag flag-red"><strong>No eligible account:</strong> ${fmtUsd(f.amountUsd)} of ${esc(AC_LABEL[f.assetClass])} could not be placed — no account has capacity for this asset class.</div>`;
    return '';
  }).join('');

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
    <div class="card-header" style="cursor:default">
      <h2 style="margin:0">Household Allocation</h2>
    </div>
    <div class="card-body" style="padding:0">
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
  </div>`;

  // ── Per-account trade sections ──────────────────────────────────────────────
  let tradeIndex = 0;

  const accountSections = accounts.map(acct => {
    // Raw trades for accurate per-class pie projection.
    const acctRawTrades = trades.filter(t => t.accountId === acct.id);
    // Resolved trades for the checklist (merged blended-fund rows with tickers).
    const acctTrades = resolvedTrades
      .filter(t => t.accountId === acct.id)
      .sort((a, b) => Math.abs(b.deltaUsd) - Math.abs(a.deltaUsd));
    const before = buildSlices(currentValueByAccount[acct.id] ?? {} as Record<AssetClass, number>);

    const afterByClass = { ...currentValueByAccount[acct.id] } as Record<AssetClass, number>;
    for (const ac of ALL_ASSET_CLASSES) afterByClass[ac] ??= 0;
    for (const t of acctRawTrades) afterByClass[t.assetClass] += t.deltaUsd;
    const after = buildSlices(afterByClass);

    // Skip accounts with no positions and no trades.
    if (before.length === 0 && acctTrades.length === 0) return '';

    const netUsd = acctTrades.reduce((s, t) => s + t.deltaUsd, 0);
    const netStr = acctTrades.length > 0
      ? `<span style="font-size:12px;color:${netUsd >= 0 ? '#16a34a' : '#dc2626'};font-weight:600">${fmtDelta(netUsd)}</span>`
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
      const taxWarn = (!isBuy && t.inTaxableAccount)
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

    const noTradesNote = acctTrades.length === 0
      ? `<p style="padding:12px 16px;font-size:12px;color:#9ca3af;font-style:italic">Within tolerance — no trades required.</p>` : '';

    return `
    <div class="card">
      <div class="card-header">
        <div style="flex:1">
          <span style="font-weight:600;color:#111827">${esc(acct.name)}</span>
          <span style="font-size:12px;color:#9ca3af;margin-left:8px">${esc(acct.institution)} · ${esc(ACCT_TYPE_LABEL[acct.type])}</span>
          ${lockBadge}
        </div>
        ${netStr}
      </div>
      ${piesHtml}
      ${tradeRows}
      ${noTradesNote}
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
      <p style="font-size:11px;color:#9ca3af;margin-top:2px">Not investment advice. All data is local to your browser.</p>
    </div>
    <div style="display:flex;align-items:center;gap:8px" class="no-print">
      <span class="progress"></span>
      <button class="print-btn" onclick="window.print()">Print / Save as PDF</button>
    </div>
  </div>

  <!-- Flags -->
  ${flagsHtml}

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

export function downloadReport(result: RebalanceResult, accounts: Account[], resolvedTrades: ResolvedTrade[]): void {
  const now  = new Date();
  const html = buildHtml(result, accounts, resolvedTrades, now);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `rebalance-report-${now.toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
