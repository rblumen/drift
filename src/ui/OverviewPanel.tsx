// src/ui/OverviewPanel.tsx — operational dashboard (#194 stage 2, design 2a body)
//
// Orientation (what is Drift / why use it) lives on the LandingPage. This panel
// is purely status + navigation for a session already in progress.
//
// Redesign (2a): the old 5-card stepper is retired — the workflow rail now
// carries per-step done/warn/locked state. What survives here is three cards:
//   • HOUSEHOLD STATUS — 5 stat cells (Accounts / Positions / Unclassified /
//     Household value / Drift from target). "Last saved" moved to the context bar.
//   • ALLOCATION VS TARGET — family rows keyed to the dv ramp.
//   • NEXT ACTION — the dynamic step CTA (same labels/logic as before) + an
//     "Edit accounts" secondary link.
// The privacy footnote is preserved.
import type { Account, Position } from '../engine/types';
import { fmtUsd, FAMILY_COLOR, FAMILY_LABEL, type AllocationFamily } from './fmt';
import { btnPrimary, btnTextLink } from './buttons';
import { Card, Stat } from './card';

// ── Types ─────────────────────────────────────────────────────────────────────
type AppTab = 'overview' | 'accounts' | 'import' | 'classify' | 'strategy' | 'results';

/** One family row of the allocation-vs-target table (weights in 0..1). */
export interface FamilyRow {
  family: AllocationFamily;
  current: number;
  target: number;
}

interface Props {
  accounts:       Account[];
  positions:      Position[];
  unmappedCount:  number;
  householdValue: number;
  /** Max absolute per-class drift (current − target), as a fraction (0..1). */
  driftMaxAbs:    number;
  /** Count of classes currently out of their rebalance band. */
  driftOutOfBand: number;
  /** Family-rolled current/target weights for the allocation table. */
  familyRows:     FamilyRow[];
  onNavigate:     (tab: AppTab) => void;
}

// ── Drift value (signed, colored) ─────────────────────────────────────────────
function DriftCell({ delta }: { delta: number }) {
  // delta in percentage points (already ×100). Over-target = accent, under = the
  // dv under-blue, ~zero = neutral, matching the design's family drift column.
  const pp = delta;
  const rounded = Math.round(pp * 10) / 10;
  if (Math.abs(rounded) < 0.05)
    return <span className="text-right font-mono text-[12px] text-[#9ca3af] tabular-nums">0.0</span>;
  const over = rounded > 0;
  return (
    <span className={`text-right font-mono text-[12px] tabular-nums ${over ? 'text-accent' : 'text-brand-500'}`}>
      {over ? '▲ +' : '▼ −'}{Math.abs(rounded).toFixed(1)}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function OverviewPanel({
  accounts, positions, unmappedCount, householdValue,
  driftMaxAbs, driftOutOfBand, familyRows, onNavigate,
}: Props) {
  const hasAccounts  = accounts.length > 0;
  const hasPositions = positions.length > 0;

  // Next action CTA — same labels/logic as the retired stepper's primary CTA.
  let nextTab: AppTab = 'accounts';
  let nextLabel = 'Get started';
  let nextDesc = 'Add your accounts to begin — name each one and set its tax type.';
  if (!hasAccounts) {
    nextTab = 'accounts'; nextLabel = 'Get started';
    nextDesc = 'Add your accounts to begin — name each one and set its tax type.';
  } else if (!hasPositions) {
    nextTab = 'import'; nextLabel = 'Import positions';
    nextDesc = 'Upload a broker CSV or enter your holdings so Drift can see your portfolio.';
  } else if (unmappedCount > 0) {
    nextTab = 'classify'; nextLabel = `Classify ${unmappedCount} ticker${unmappedCount !== 1 ? 's' : ''}`;
    nextDesc = `${unmappedCount} ticker${unmappedCount !== 1 ? 's' : ''} Drift doesn't recognize yet. Tag ${unmappedCount !== 1 ? 'them' : 'it'} so every position counts toward the right class.`;
  } else {
    nextTab = 'results'; nextLabel = 'View results';
    nextDesc = 'Everything is classified. Review the per-account buy/sell orders.';
  }

  // Status-strip sub-labels.
  const acctSub = accounts.length === 0 ? '—'
    : accounts.length <= 3 ? accounts.map((a) => a.name).join(' · ')
    : `${accounts.slice(0, 2).map((a) => a.name).join(', ')} +${accounts.length - 2} more`;

  const driftPp = driftMaxAbs * 100;
  const driftDisplay = hasPositions ? `${driftPp.toFixed(1)}%` : '—';
  const driftTone: 'ink' | 'accent' | 'ok' | 'muted' =
    !hasPositions ? 'muted' : driftOutOfBand > 0 ? 'accent' : 'ok';
  const driftCaption = !hasPositions ? 'No positions'
    : driftOutOfBand > 0 ? `${driftOutOfBand} class${driftOutOfBand !== 1 ? 'es' : ''} out of band`
    : 'Within tolerance';

  return (
    <div className="flex flex-col gap-4">

      {/* ── HOUSEHOLD STATUS ────────────────────────────────────────────────── */}
      <Card title="Household status" meta={hasPositions ? 'As of last import' : undefined}>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-px bg-tint-cell">
          <Stat
            label="Accounts"
            value={hasAccounts ? accounts.length : '—'}
            caption={acctSub}
            tone={hasAccounts ? 'ink' : 'muted'}
          />
          <Stat
            label="Positions"
            value={hasPositions ? positions.length : '—'}
            caption="Across all accounts"
            tone={hasPositions ? 'ink' : 'muted'}
          />
          <Stat
            label="Unclassified"
            value={!hasPositions ? '—' : unmappedCount > 0 ? unmappedCount : '✓'}
            caption={!hasPositions ? 'No positions' : unmappedCount > 0 ? 'Need tagging' : 'All tagged'}
            tone={!hasPositions ? 'muted' : unmappedCount > 0 ? 'warn' : 'ok'}
          />
          <Stat
            label="Household value"
            value={householdValue > 0 ? fmtUsd(householdValue) : '—'}
            caption="As of last import"
            tone={householdValue > 0 ? 'ink' : 'muted'}
          />
          <Stat
            label="Drift from target"
            value={driftDisplay}
            caption={driftCaption}
            tone={driftTone}
          />
        </div>
      </Card>

      {/* ── ALLOCATION VS TARGET + NEXT ACTION ──────────────────────────────── */}
      <div className="flex flex-col md:flex-row gap-4 items-stretch md:items-start">
        <Card
          title="Allocation vs target"
          meta={`${familyRows.length} famil${familyRows.length !== 1 ? 'ies' : 'y'}`}
          className="flex-1"
        >
          <div className="px-4 pt-1.5 pb-2.5">
            <div className="grid grid-cols-[1fr_4.4rem_4.4rem_4.4rem] font-mono text-[10px] tracking-[.06em] uppercase text-muted-3 py-1.5 border-b border-line-2">
              <span>Family</span>
              <span className="text-right">Current</span>
              <span className="text-right">Target</span>
              <span className="text-right">Drift</span>
            </div>
            {familyRows.length === 0 ? (
              <p className="font-mono text-[11px] text-muted-3 py-3">
                Import positions to see your allocation.
              </p>
            ) : familyRows.map((row, i) => {
              const cur = row.current * 100;
              const tgt = row.target * 100;
              const delta = cur - tgt;
              return (
                <div
                  key={row.family}
                  className={`grid grid-cols-[1fr_4.4rem_4.4rem_4.4rem] text-[12.5px] py-[5px] items-center ${
                    i < familyRows.length - 1 ? 'border-b border-line-3' : ''
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium min-w-0">
                    <span
                      className="w-[9px] h-[9px] rounded-sm flex-none"
                      style={{ background: FAMILY_COLOR[row.family] }}
                    />
                    <span className="truncate">{FAMILY_LABEL[row.family]}</span>
                  </span>
                  <span className="text-right font-mono text-[12px] text-brand-600 tabular-nums">{cur.toFixed(1)}</span>
                  <span className="text-right font-mono text-[12px] text-muted-2 tabular-nums">{tgt.toFixed(1)}</span>
                  <DriftCell delta={delta} />
                </div>
              );
            })}
          </div>
        </Card>

        <Card title="Next action" className="w-full md:w-[300px] md:flex-none">
          <div className="px-4 pt-3.5 pb-4">
            <p className="text-[13px] leading-normal text-[#4a5769] mb-3">{nextDesc}</p>
            <button onClick={() => onNavigate(nextTab)} className={btnPrimary}>
              {nextLabel} <span aria-hidden="true">→</span>
            </button>
            {hasAccounts && (
              <div className="mt-3">
                <button onClick={() => onNavigate('accounts')} className={btnTextLink}>
                  Edit accounts
                </button>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* ── Privacy footnote ────────────────────────────────────────────────── */}
      <p className="font-mono text-[11.5px] text-muted-3 mt-4 pt-4 border-t border-line-2 leading-relaxed">
        Private by default — all computation runs in your browser; your financial data never leaves it. No cookies, no personal data.
      </p>

    </div>
  );
}
