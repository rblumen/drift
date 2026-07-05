import { useState } from 'react';
import type { Account, AccountType, AssetClass } from '../engine/types';
import { defaultWithdrawalPriority, withdrawalPriorityOf } from '../engine/rebalance';
import { ACCT_TYPE_COLOR, ACCT_TYPE_LABEL, ACCT_TYPE_TAG_LABEL, AC_LABEL, fmtUsd } from './fmt';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';
import { ConfirmDialog } from './ConfirmDialog';
import { IconLock, IconLockOpen, IconPencil, IconX } from './icons';
import { Card, Stat, AcctTypeTag } from './card';
import { btnPrimaryCompact, btnGhostCompact, btnTintedInfo } from './buttons';

// ── Deposit eligibility (issue #30, revised in #14 review) ───────────────────
// Deposits are a binary Open/Closed on the inline control; the optional
// contribution cap lives in the edit form (shown only when Open).
//   open  → acceptsDeposits: undefined; depositLimitUsd kept as-is (cap from form)
//   closed→ acceptsDeposits: false
function accountDepositOpen(a: Account): boolean {
  return a.acceptsDeposits !== false;
}

// ── Withdrawal eligibility (issue #14) ───────────────────────────────────────
// Three states: Restricted / Eligible / Required. "Required" means the account
// carries an RMD (revealing an RMD input); a Required account is also eligible
// for additional/discretionary draws. Default-by-type when unset: taxable is
// Eligible, tax-advantaged is Restricted (early-withdrawal penalties).
type WithdrawalPolicy = 'restricted' | 'eligible' | 'required';

function accountWithdrawalPolicy(a: Account): WithdrawalPolicy {
  if ((a.rmdDueUsd ?? 0) > 0) return 'required';
  if (a.acceptsWithdrawals === false) return 'restricted';
  if (a.acceptsWithdrawals === true) return 'eligible';
  return a.type === 'TAXABLE' ? 'eligible' : 'restricted';
}

function withdrawalFields(policy: WithdrawalPolicy, rmdStr: string): Pick<Account, 'acceptsWithdrawals' | 'rmdDueUsd'> {
  if (policy === 'restricted') return { acceptsWithdrawals: false, rmdDueUsd: undefined };
  if (policy === 'eligible')   return { acceptsWithdrawals: true, rmdDueUsd: undefined };
  // required — eligible + a forced RMD (empty/invalid reads as no RMD until entered).
  const v = parseFloat(rmdStr);
  return { acceptsWithdrawals: true, rmdDueUsd: isNaN(v) || v < 0 ? undefined : v };
}

interface Props {
  accounts: Account[];
  setAccounts: (a: Account[]) => void;
  /** Positions keyed by accountId — used to cascade-delete on account removal. */
  onDeleteAccount: (id: string) => void;
  freeCash: number;
  setFreeCash: (v: number) => void;
  /** Additional (discretionary) withdrawal on top of RMDs. */
  plannedWithdrawal: number;
  setPlannedWithdrawal: (v: number) => void;
  onLoadSample: () => void;
}

const ACCOUNT_TYPES: AccountType[] = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
];

const INSTITUTIONS = ['Schwab', 'Fidelity', 'Empower', 'Vanguard', 'Other'];

// Shared column template for the accounts kit-table (design 3a): Account (grows)
// · Type · New cash (right) · Deposits · Withdrawals · actions.
const ACCT_GRID = 'grid grid-cols-[1.4fr_6.2rem_5.6rem_8.4rem_11.4rem_4.6rem]';

// Asset classes that can actually be placed (US_TOTAL_MARKET is always redistributed
// to sub-classes by the engine, so it never appears in placement decisions).
const PLACEABLE_CLASSES: AssetClass[] = [
  'US_LARGE_CAP', 'US_MID_CAP', 'US_SMALL_CAP',
  'DEVELOPED_INTL', 'EMERGING_INTL',
  'FIXED_INCOME', 'ALTERNATIVES', 'CASH',
];

const WITHDRAWAL_OPTS: { value: WithdrawalPolicy; label: string }[] = [
  { value: 'restricted', label: 'Restricted' },
  { value: 'eligible',   label: 'Eligible' },
  { value: 'required',   label: 'Required' },
];

interface FormState {
  name: string;
  institution: string;
  type: AccountType;
  newCash: string;
  depositOpen: boolean;
  depositCap: string;
  withdrawalPolicy: WithdrawalPolicy;
  rmd: string;
  withdrawalPriority: string;
  restricted: boolean;
  allowedClasses: AssetClass[];
  concentrateClasses: AssetClass[];
}

function blankForm(): FormState {
  return {
    name: '', institution: 'Schwab', type: 'TAXABLE', newCash: '',
    depositOpen: true, depositCap: '',
    withdrawalPolicy: 'eligible', rmd: '',
    withdrawalPriority: String(defaultWithdrawalPriority('TAXABLE')),
    restricted: false, allowedClasses: [...PLACEABLE_CLASSES], concentrateClasses: [],
  };
}

// When the type changes, reseed the type-derived defaults: the 401k fund-menu
// restriction (no ALTERNATIVES), the withdrawal eligibility default (taxable
// Eligible, else Restricted), and the withdrawal priority seed. A type change
// never clears an RMD the user already entered (keeps "Required").
function applyTypeDefaults(form: FormState, newType: AccountType): FormState {
  const next: FormState = {
    ...form,
    type: newType,
    withdrawalPolicy: form.withdrawalPolicy === 'required'
      ? 'required'
      : (newType === 'TAXABLE' ? 'eligible' : 'restricted'),
    withdrawalPriority: String(defaultWithdrawalPriority(newType)),
  };
  if (newType === 'FOUR_OH_ONE_K' && !form.restricted) {
    return { ...next, restricted: true, allowedClasses: PLACEABLE_CLASSES.filter(c => c !== 'ALTERNATIVES') };
  }
  return next;
}

function toggleClass(classes: AssetClass[], ac: AssetClass, checked: boolean): AssetClass[] {
  return checked ? [...classes, ac] : classes.filter(c => c !== ac);
}

// Translate form state to allowedAssetClasses for the Account object.
// If unrestricted or all classes are allowed, returns undefined (engine treats as unrestricted).
function toAllowedAssetClasses(form: FormState): AssetClass[] | undefined {
  if (!form.restricted) return undefined;
  if (form.allowedClasses.length === PLACEABLE_CLASSES.length) return undefined;
  return form.allowedClasses.length > 0 ? form.allowedClasses : undefined;
}

// Parse a withdrawal priority field, storing it only when it deviates from the
// type's default seed (so untouched accounts stay free of the field).
function withdrawalPriorityField(form: FormState): number | undefined {
  const s = form.withdrawalPriority.trim();
  if (s === '') return undefined;
  const v = parseFloat(s);
  if (isNaN(v) || v < 0 || v === defaultWithdrawalPriority(form.type)) return undefined;
  return v;
}

// Build the deposit Account fields from a form, preserving the cap only when Open.
function depositFieldsFromForm(form: FormState): Pick<Account, 'acceptsDeposits' | 'depositLimitUsd'> {
  if (!form.depositOpen) return { acceptsDeposits: false, depositLimitUsd: undefined };
  const v = parseFloat(form.depositCap);
  return { acceptsDeposits: undefined, depositLimitUsd: isNaN(v) || v <= 0 ? undefined : v };
}

// ── Inline controls ──────────────────────────────────────────────────────────

// Binary Open/Closed pill for the deposit column. Kit semantics (#194 3a): a
// hairline-bordered rounded-full segmented control, active Open = ok, active
// Closed = danger, idle = faint.
function DepositToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  const opts: [string, boolean][] = [['Open', true], ['Closed', false]];
  return (
    <div className="inline-flex rounded-full border border-line overflow-hidden text-[11px] font-medium">
      {opts.map(([label, val], i) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(val)}
          className={`px-2.5 py-0.5 transition-colors ${i > 0 ? 'border-l border-line' : ''} ${
            open === val
              ? (val ? 'bg-ok-bg text-ok' : 'bg-danger-bg text-danger')
              : 'bg-white text-faint hover:bg-paper'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// Presentational withdrawal control: Restricted · Eligible · Required, with an
// RMD input revealed when Required. The caller owns (policy, rmd).
function WithdrawalControl({
  policy, rmd, onPolicyChange, onRmdChange, short = false,
}: {
  policy: WithdrawalPolicy;
  rmd: string;
  onPolicyChange: (p: WithdrawalPolicy) => void;
  onRmdChange: (v: string) => void;
  /** Abbreviate "Restricted" → "Restr." (the dense table cell, design 3a). */
  short?: boolean;
}) {
  // Kit 3a semantics: Restricted = danger, Eligible = ok, Required = info.
  const active: Record<WithdrawalPolicy, string> = {
    restricted: 'bg-danger-bg text-danger',
    eligible:   'bg-ok-bg text-ok',
    required:   'bg-info-bg text-info',
  };
  const shortLabel: Record<WithdrawalPolicy, string> = {
    restricted: 'Restr.', eligible: 'Eligible', required: 'Required',
  };
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex rounded-full border border-line overflow-hidden text-[11px] font-medium">
        {WITHDRAWAL_OPTS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPolicyChange(opt.value)}
            className={`px-2.5 py-0.5 transition-colors ${i > 0 ? 'border-l border-line' : ''} ${
              policy === opt.value ? active[opt.value] : 'bg-white text-faint hover:bg-paper'
            }`}
          >
            {short ? shortLabel[opt.value] : opt.label}
          </button>
        ))}
      </div>
      {policy === 'required' && (
        <div className="flex items-center gap-1 text-xs text-muted-1">
          <span className="text-muted-3">$</span>
          <input
            type="number"
            min="0"
            value={rmd}
            onChange={e => onRmdChange(e.target.value)}
            placeholder="RMD"
            aria-label="Required minimum distribution (dollars)"
            className="w-24 border border-line rounded px-1.5 py-0.5 text-xs"
          />
          <span className="font-mono text-[10px] text-muted-2">RMD due</span>
        </div>
      )}
    </div>
  );
}

// Inline withdrawal control for a table row. Holds its own (policy, rmd) draft so
// selecting "Required" reveals an empty RMD field without snapping back. Commits
// on every change.
function WithdrawalCell({
  initialPolicy, initialRmd, onChange,
}: {
  initialPolicy: WithdrawalPolicy;
  initialRmd: string;
  onChange: (policy: WithdrawalPolicy, rmd: string) => void;
}) {
  const [policy, setPolicy] = useState<WithdrawalPolicy>(initialPolicy);
  const [rmd, setRmd]       = useState(initialRmd);

  function commit(nextPolicy: WithdrawalPolicy, nextRmd: string) {
    setPolicy(nextPolicy);
    setRmd(nextRmd);
    onChange(nextPolicy, nextRmd);
  }

  return (
    <WithdrawalControl
      policy={policy}
      rmd={rmd}
      short
      onPolicyChange={p => commit(p, rmd)}
      onRmdChange={v => commit('required', v)}
    />
  );
}

// Deposit + withdrawal eligibility fields shared by the add and edit forms.
function EligibilityFormFields({ f, onChange }: { f: FormState; onChange: (next: FormState) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1 border-t border-gray-200">
      <div className="space-y-2">
        <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
          Deposits
          <HelpTip>
            <strong>Open</strong> accepts a share of household free cash; <strong>Closed</strong>
            receives none (e.g. a contribution limit fully reached). The account still rebalances its
            existing holdings, and its own new cash always deploys in full regardless of this setting.
          </HelpTip>
        </span>
        <DepositToggle open={f.depositOpen} onChange={v => onChange({ ...f, depositOpen: v })} />
        {f.depositOpen && (
          <label className="block text-xs text-gray-500">
            <span className="flex items-center gap-1">
              Remaining contribution cap ($)
              <HelpTip>
                Optional. Caps the household free cash routed here — use when a contribution limit is
                partly consumed (e.g. a Roth IRA with room left this year). Leave blank for no cap.
              </HelpTip>
            </span>
            <input
              type="number"
              min="0"
              value={f.depositCap}
              onChange={e => onChange({ ...f, depositCap: e.target.value })}
              placeholder="No cap"
              className="mt-1 w-32 border rounded px-1.5 py-0.5 text-xs"
            />
          </label>
        )}
      </div>
      <div className="space-y-2">
        <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
          Withdrawals
          <HelpTip>
            How much of a planned withdrawal this account may fund by selling.
            <strong> Eligible</strong> can fund any share; <strong>Restricted</strong> funds none
            (the default for tax-advantaged accounts, which carry early-withdrawal penalties).
            <strong> Required</strong> means the account has a required minimum distribution (RMD) —
            it is taken first, and the account can also fund additional withdrawals.
          </HelpTip>
        </span>
        <WithdrawalControl
          policy={f.withdrawalPolicy}
          rmd={f.rmd}
          onPolicyChange={p => onChange({ ...f, withdrawalPolicy: p })}
          onRmdChange={v => onChange({ ...f, withdrawalPolicy: 'required', rmd: v })}
        />
        <label className="block text-xs text-gray-500">
          <span className="flex items-center gap-1">
            Drain priority
            <HelpTip>
              The order a withdrawal pulls from accounts — lower drains first. Seeded from account
              type (taxable → traditional → Roth); edit to deviate.
            </HelpTip>
          </span>
          <input
            type="number"
            min="0"
            value={f.withdrawalPriority}
            onChange={e => onChange({ ...f, withdrawalPriority: e.target.value })}
            className="mt-1 w-20 border rounded px-1.5 py-0.5 text-xs"
          />
        </label>
      </div>
    </div>
  );
}

export function AccountsPanel({ accounts, setAccounts, onDeleteAccount, freeCash, setFreeCash, plannedWithdrawal, setPlannedWithdrawal, onLoadSample }: Props) {
  const [freeCashInput, setFreeCashInput] = useState(freeCash > 0 ? String(freeCash) : '');
  const [withdrawalInput, setWithdrawalInput] = useState(plannedWithdrawal > 0 ? String(plannedWithdrawal) : '');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<FormState>(blankForm);
  const [removeTarget, setRemoveTarget] = useState<Account | null>(null);

  // Total RMD rolled up from accounts; the planned-withdrawal box shows
  // total = Σ RMD + additional (the manual entry).
  const totalRmd = accounts.reduce((s, a) => s + (a.rmdDueUsd ?? 0), 0);
  const totalWithdrawal = totalRmd + plannedWithdrawal;

  function formToAccountFields(f: FormState) {
    return {
      newCash:             f.newCash ? parseFloat(f.newCash) : undefined,
      ...depositFieldsFromForm(f),
      ...withdrawalFields(f.withdrawalPolicy, f.rmd),
      withdrawalPriority:  withdrawalPriorityField(f),
      allowedAssetClasses: toAllowedAssetClasses(f),
      concentrateClasses:  f.concentrateClasses.length > 0 ? f.concentrateClasses : undefined,
    };
  }

  function handleAdd() {
    if (!form.name.trim()) return;
    const acct: Account = {
      id:          crypto.randomUUID(),
      name:        form.name.trim(),
      institution: form.institution,
      type:        form.type,
      ...formToAccountFields(form),
    };
    setAccounts([...accounts, acct]);
    setForm(blankForm());
    setShowAdd(false);
  }

  function startEdit(acct: Account) {
    const existing = acct.allowedAssetClasses;
    setEditingId(acct.id);
    setEditForm({
      name:            acct.name,
      institution:     acct.institution,
      type:            acct.type,
      newCash:         acct.newCash != null ? String(acct.newCash) : '',
      depositOpen:     accountDepositOpen(acct),
      depositCap:      acct.depositLimitUsd != null ? String(acct.depositLimitUsd) : '',
      withdrawalPolicy: accountWithdrawalPolicy(acct),
      rmd:             acct.rmdDueUsd != null ? String(acct.rmdDueUsd) : '',
      withdrawalPriority: String(withdrawalPriorityOf(acct)),
      restricted:      existing !== undefined,
      allowedClasses: existing
        ? PLACEABLE_CLASSES.filter(c => existing.includes(c))
        : [...PLACEABLE_CLASSES],
      concentrateClasses: (acct.concentrateClasses ?? []).filter(c =>
        (PLACEABLE_CLASSES as string[]).includes(c),
      ) as AssetClass[],
    });
  }

  function saveEdit(id: string) {
    setAccounts(accounts.map(a =>
      a.id !== id ? a : {
        ...a,
        name:        editForm.name.trim(),
        institution: editForm.institution,
        type:        editForm.type,
        ...formToAccountFields(editForm),
      }
    ));
    setEditingId(null);
  }

  // Mono second line under the account name (design 3a): institution, then any
  // constraint/cap notes joined with " · ". Exclusions read as warnings, so the
  // whole line is warn-colored when the account excludes any class; otherwise
  // it's the neutral label color. Every fact the old badge stack showed is kept
  // (institution, cap left, excl. classes, concentrate classes, drain priority).
  // concentrateClasses renders unfiltered — the engine honours whatever the
  // account carries (even classes the form can't set), so the display must too.
  function AccountSubLine({ acct }: { acct: Account }) {
    const excluded = acct.allowedAssetClasses
      ? PLACEABLE_CLASSES.filter(c => !acct.allowedAssetClasses!.includes(c))
      : [];
    const concentrated = acct.concentrateClasses ?? [];
    const notes: string[] = [];
    if (acct.depositLimitUsd != null && acct.depositLimitUsd > 0) {
      notes.push(`cap ${fmtUsd(acct.depositLimitUsd)} left`);
    }
    if (excluded.length > 0) notes.push(`excl. ${excluded.map(c => AC_LABEL[c]).join(', ')}`);
    if (concentrated.length > 0) notes.push(`concentrate ${concentrated.map(c => AC_LABEL[c] ?? c).join(', ')}`);
    if (acct.withdrawalPriority != null) notes.push(`drain priority ${acct.withdrawalPriority}`);
    const warn = excluded.length > 0;
    return (
      <span className={`font-mono text-[10.5px] ${warn ? 'text-warn' : 'text-muted-3'}`}>
        {[acct.institution, ...notes].join(' · ')}
      </span>
    );
  }

  // Shared constraint fields used in both the add form and the inline edit form.
  function ConstraintFields({
    f, onChange,
  }: { f: FormState; onChange: (next: FormState) => void }) {
    return (
      <div className="space-y-3 pt-1 border-t border-gray-200">
        {/* Allowed classes */}
        <div>
          <label className="flex items-center gap-2 text-xs font-medium text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={f.restricted}
              onChange={e => onChange({ ...f, restricted: e.target.checked })}
              className="rounded"
            />
            Restrict investable classes
            <HelpTip>
              Use for 401(k) or similar accounts with a fixed fund menu that doesn't offer every
              asset class. The engine spills restricted classes to other eligible accounts instead
              of leaving them unplaced.
            </HelpTip>
            <span className="font-normal text-gray-400 ml-1">(uncheck what this account cannot hold)</span>
          </label>
          {f.restricted && (
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 pl-5">
              {PLACEABLE_CLASSES.map(ac => (
                <label key={ac} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={f.allowedClasses.includes(ac)}
                    onChange={e => onChange({ ...f, allowedClasses: toggleClass(f.allowedClasses, ac, e.target.checked) })}
                    className="rounded"
                  />
                  {AC_LABEL[ac]}
                </label>
              ))}
            </div>
          )}
        </div>
        {/* Concentrate classes */}
        <div>
          <p className="text-xs font-medium text-gray-600">
            Concentrate here
            <HelpTip>
              The engine fills this account first for the listed classes before distributing
              proportionally to other accounts in the same bucket. Unlike "Restrict", this doesn't
              exclude other accounts — it just establishes priority. Useful for keeping alternatives
              concentrated in a single IRA.
            </HelpTip>
            {' '}
            <span className="font-normal text-gray-400">(fill this account first for these classes)</span>
          </p>
          <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1">
            {PLACEABLE_CLASSES.map(ac => (
              <label key={ac} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={f.concentrateClasses.includes(ac)}
                  onChange={e => onChange({ ...f, concentrateClasses: toggleClass(f.concentrateClasses, ac, e.target.checked) })}
                  className="rounded"
                />
                {AC_LABEL[ac]}
              </label>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── HOUSEHOLD CASH ──────────────────────────────────────────────────── */}
      <Card title="Household cash" meta="Applied across eligible accounts">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-tint-cell">
          {/* Free cash to deploy */}
          <div className="bg-white px-4 py-3 flex flex-col gap-1.5">
            <span className="flex items-center gap-1 font-mono text-[9.5px] tracking-[.12em] uppercase text-muted-3">
              Free cash to deploy
              <HelpTip>
                Household free cash not yet assigned to a specific account — a check you're about to
                deposit, or sweep-fund proceeds to invest. The engine deploys it into the
                deposit-eligible account with the most capacity first, spilling only when a
                contribution cap forces it. Closed accounts are excluded.
              </HelpTip>
            </span>
            <div className="inline-flex items-center gap-1.5 border border-line rounded-lg px-2.5 py-1.5 bg-paper w-[160px]">
              <span className="font-mono text-[12px] text-muted-3">$</span>
              <input
                type="number"
                min="0"
                value={freeCashInput}
                onChange={e => {
                  setFreeCashInput(e.target.value);
                  const v = parseFloat(e.target.value);
                  setFreeCash(isNaN(v) || v < 0 ? 0 : v);
                }}
                onBlur={() => {
                  if (!freeCashInput.trim() || parseFloat(freeCashInput) === 0) {
                    setFreeCashInput('');
                    setFreeCash(0);
                  }
                }}
                placeholder="0"
                aria-label="Planned deposits (dollars)"
                className="w-full bg-transparent font-mono text-[13px] text-brand-ink outline-none"
              />
            </div>
            {freeCash > 0 && (
              <span className="font-mono text-[10.5px] text-ok">
                {fmtUsd(freeCash)} deployed to eligible accounts at run time.
              </span>
            )}
          </div>

          {/* Additional withdrawal */}
          <div className="bg-white px-4 py-3 flex flex-col gap-1.5">
            <span className="flex items-center gap-1 font-mono text-[9.5px] tracking-[.12em] uppercase text-muted-3">
              Additional withdrawal
              <HelpTip>
                Discretionary cash to raise by selling, on top of any RMDs. RMDs (set per account via
                the "Required" withdrawal state) are taken first; this amount then drains
                withdrawal-eligible accounts in drain-priority order, selling down toward your target.
              </HelpTip>
            </span>
            <div className="inline-flex items-center gap-1.5 border border-line rounded-lg px-2.5 py-1.5 bg-paper w-[160px]">
              <span className="font-mono text-[12px] text-muted-3">$</span>
              <input
                type="number"
                min="0"
                value={withdrawalInput}
                onChange={e => {
                  setWithdrawalInput(e.target.value);
                  const v = parseFloat(e.target.value);
                  setPlannedWithdrawal(isNaN(v) || v < 0 ? 0 : v);
                }}
                onBlur={() => {
                  if (!withdrawalInput.trim() || parseFloat(withdrawalInput) === 0) {
                    setWithdrawalInput('');
                    setPlannedWithdrawal(0);
                  }
                }}
                placeholder="0"
                aria-label="Additional withdrawal (dollars)"
                className="w-full bg-transparent font-mono text-[13px] text-brand-ink outline-none"
              />
            </div>
          </div>

          {/* Total withdrawal = Σ RMD + additional */}
          <Stat
            label="Total withdrawal"
            value={fmtUsd(totalWithdrawal)}
            caption={`${fmtUsd(totalRmd)} RMD + ${fmtUsd(plannedWithdrawal)} additional`}
            tone={totalWithdrawal > 0 ? 'ink' : 'muted'}
          />
        </div>
      </Card>

      <HelpBox label="About accounts">
        <p>
          Register every investment account in your household. The engine uses account type to determine
          which asset classes belong here — this is how tax-efficient placement works.
        </p>

        <HelpSection title="Account types and tax treatment">
          <HelpDef term="Taxable">Regular brokerage account (Schwab, Fidelity, etc.). Dividends and realized gains are taxable each year. The default strategy concentrates <em>muni bonds</em> here because muni interest is tax-exempt.</HelpDef>
          <HelpDef term="Traditional IRA / 401(k) / HSA">Tax-advantaged accounts. Contributions reduce taxable income now; withdrawals are taxed. The engine concentrates equities and alternatives here so growth compounds tax-deferred.</HelpDef>
          <HelpDef term="Roth IRA">Tax-advantaged. Contributions are after-tax; qualified withdrawals are tax-free. Excellent for high-growth equities.</HelpDef>
          <HelpDef term="529">Education savings account. Separate placement bucket — not mixed with tax-advantaged.</HelpDef>
        </HelpSection>

        <HelpSection title="Advanced options">
          <HelpDef term="Planned deposits">Household free cash not yet assigned to an account. Deployed into the deposit-eligible account with the most capacity first (spilling only when a contribution cap forces it). Enter it in the green bar above.</HelpDef>
          <HelpDef term="New cash">Uninvested cash already sitting in a specific account (e.g. a dividend that landed). Counted in that account's value and deployed toward underweight classes.</HelpDef>
          <HelpDef term="Deposits: Open / Closed">Whether an account can receive a share of household free cash. When Open, you can set an optional remaining-contribution cap in the Edit form. Closed accounts still rebalance their existing holdings.</HelpDef>
          <HelpDef term="Additional withdrawal">Discretionary cash to raise by selling, on top of RMDs. Total withdrawals = Σ RMD (rolled up from accounts) + this amount. Enter it in the amber bar above.</HelpDef>
          <HelpDef term="Withdrawals: Restricted / Eligible / Required">How much of a withdrawal an account funds by selling. <em>Eligible</em> funds any share; <em>Restricted</em> funds none (default for tax-advantaged accounts). <em>Required</em> means the account has an RMD — taken first, and it can also fund additional withdrawals.</HelpDef>
          <HelpDef term="Drain priority">The order a withdrawal pulls from eligible accounts — lower drains first. Seeded from account type (taxable → traditional → Roth) and editable per account.</HelpDef>
          <HelpDef term="Locked account">Counted in totals and weights but excluded from trade generation. Use when you're not actively managing the account right now (e.g. a 401k at a former employer).</HelpDef>
          <HelpDef term="Restrict investable classes">Limits which asset classes the engine may place here. Useful for 401(k) plans with a fixed fund menu. The engine spills restricted classes to other eligible accounts.</HelpDef>
          <HelpDef term="Concentrate here">Fills this account first for the listed classes before distributing proportionally to other accounts in the same bucket. Use to keep alternatives concentrated in a single IRA.</HelpDef>
        </HelpSection>
      </HelpBox>

      {accounts.length === 0 && !showAdd && (
        <div className="py-8 text-center border border-dashed border-line rounded-xl flex flex-col items-center gap-3">
          <p className="text-sm text-muted-1">No accounts yet. Add one to get started.</p>
          <button onClick={onLoadSample} className={btnTintedInfo}>
            Load sample portfolio
          </button>
        </div>
      )}

      {accounts.length > 0 && (
        <Card
          title={`Accounts · ${accounts.length}`}
          action={
            <button onClick={() => { setShowAdd(true); setEditingId(null); }} className={btnTintedInfo}>
              + Add account
            </button>
          }
        >
          <div className="px-4 pt-1 pb-2 overflow-x-auto">
            <div className="min-w-[820px]">
              {/* Header row */}
              <div className={`${ACCT_GRID} font-mono text-[10px] tracking-[.06em] uppercase text-muted-3 py-1.5 border-b border-line-2 items-center`}>
                <span>Account</span>
                <span>Type</span>
                <span className="text-right">New cash</span>
                <span className="flex items-center gap-0.5">
                  Deposits
                  <HelpTip dir="left">
                    Whether this account can receive a share of household free cash.
                    <strong> Open</strong> / <strong>Closed</strong>. Set an optional contribution
                    cap in the Edit form. Closed accounts still rebalance internally.
                  </HelpTip>
                </span>
                <span className="flex items-center gap-0.5">
                  Withdrawals
                  <HelpTip dir="left">
                    How much of a withdrawal this account funds by selling.
                    <strong> Eligible</strong> = any share; <strong>Restricted</strong> = none
                    (default for tax-advantaged); <strong>Required</strong> = has an RMD, taken
                    first and still able to fund more. Set drain priority in the Edit form.
                  </HelpTip>
                </span>
                <span className="flex items-center justify-end gap-0.5">
                  Lock
                  <HelpTip dir="left">
                    A locked account counts in household totals and weights but receives no trade
                    suggestions. Use for accounts you're not actively managing right now — e.g. a
                    401k at a former employer. Toggle with the lock icon; the pencil edits and the
                    ✕ removes the account.
                  </HelpTip>
                </span>
              </div>

              {accounts.map((acct, i) => (
                editingId === acct.id ? (
                  <div key={acct.id} className="border-b border-line-3 last:border-b-0">
                    <div className="bg-rail-active rounded-lg my-2 px-4 py-3 space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <label className="block text-xs text-muted-2 mb-1">Name</label>
                          <input
                            value={editForm.name}
                            onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                            aria-label="Account name"
                            className="w-full border border-line rounded px-2 py-1 text-sm"
                            autoFocus
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-2 mb-1">Institution</label>
                          <select
                            value={editForm.institution}
                            onChange={e => setEditForm({ ...editForm, institution: e.target.value })}
                            aria-label="Institution"
                            className="w-full border border-line rounded px-2 py-1 text-sm"
                          >
                            {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-muted-2 mb-1">Account type</label>
                          <select
                            value={editForm.type}
                            onChange={e => setEditForm(applyTypeDefaults(editForm, e.target.value as AccountType))}
                            aria-label="Account type"
                            className="w-full border border-line rounded px-2 py-1 text-sm"
                          >
                            {ACCOUNT_TYPES.map(t => (
                              <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs text-muted-2 mb-1">
                            New cash ($)
                            <HelpTip>
                              Uninvested cash already sitting in this account. Added to this
                              account's capacity and steered toward underweight classes.
                            </HelpTip>
                          </label>
                          <input
                            type="number"
                            value={editForm.newCash}
                            onChange={e => setEditForm({ ...editForm, newCash: e.target.value })}
                            placeholder="Optional"
                            aria-label="New cash in account (dollars)"
                            className="w-full border border-line rounded px-2 py-1 text-sm"
                          />
                        </div>
                      </div>
                      <EligibilityFormFields f={editForm} onChange={setEditForm} />
                      <ConstraintFields f={editForm} onChange={setEditForm} />
                      <div className="flex items-center gap-3 pt-1">
                        <button onClick={() => saveEdit(acct.id)} className={btnPrimaryCompact}>Save</button>
                        <button onClick={() => setEditingId(null)} className={btnGhostCompact}>Cancel</button>
                        <span className="text-xs text-muted-3 ml-1">
                          Lock:{' '}
                          <span className="font-medium">{acct.locked ? 'on' : 'off'}</span>
                          {' '}(toggle in the table view)
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    key={acct.id}
                    className={`${ACCT_GRID} text-[12.5px] py-[7px] items-center hover:bg-paper ${
                      i < accounts.length - 1 ? 'border-b border-line-3' : ''
                    } ${acct.locked ? 'opacity-60' : ''}`}
                  >
                    {/* Account: name + institution/notes stacked */}
                    <span className="flex flex-col gap-px min-w-0 pr-2">
                      <span className="font-semibold text-brand-ink truncate">{acct.name}</span>
                      <AccountSubLine acct={acct} />
                    </span>
                    {/* Type tag */}
                    <span>
                      <AcctTypeTag
                        label={ACCT_TYPE_TAG_LABEL[acct.type]}
                        color={ACCT_TYPE_COLOR[acct.type] ?? '#8792a0'}
                        taxable={acct.type === 'TAXABLE'}
                      />
                    </span>
                    {/* New cash */}
                    <span className={`text-right font-mono text-[12px] tabular-nums ${acct.newCash ? 'text-brand-ink' : 'text-faint'}`}>
                      {acct.newCash ? `$${acct.newCash.toLocaleString()}` : '—'}
                    </span>
                    {/* Deposits */}
                    <span>
                      <DepositToggle
                        open={accountDepositOpen(acct)}
                        onChange={open => setAccounts(accounts.map(a =>
                          a.id === acct.id ? { ...a, acceptsDeposits: open ? undefined : false } : a
                        ))}
                      />
                    </span>
                    {/* Withdrawals */}
                    <span>
                      <WithdrawalCell
                        key={`wd-${acct.id}`}
                        initialPolicy={accountWithdrawalPolicy(acct)}
                        initialRmd={acct.rmdDueUsd != null ? String(acct.rmdDueUsd) : ''}
                        onChange={(policy, rmd) => setAccounts(accounts.map(a =>
                          a.id === acct.id ? { ...a, ...withdrawalFields(policy, rmd) } : a
                        ))}
                      />
                    </span>
                    {/* Actions: lock · edit · remove */}
                    <span className="flex gap-2 justify-end items-center">
                      <button
                        onClick={() => setAccounts(accounts.map(a =>
                          a.id === acct.id ? { ...a, locked: !a.locked } : a
                        ))}
                        title={acct.locked ? 'Unlock account (allow trades)' : 'Lock account (exclude from trades)'}
                        aria-label={acct.locked ? 'Unlock account (allow trades)' : 'Lock account (exclude from trades)'}
                        className={`inline-flex transition-colors ${acct.locked ? 'text-warn hover:text-faint' : 'text-faint-2 hover:text-warn'}`}
                      >
                        {acct.locked ? <IconLock size={14} /> : <IconLockOpen size={14} />}
                      </button>
                      <button
                        onClick={() => startEdit(acct)}
                        title="Edit account"
                        aria-label={`Edit ${acct.name}`}
                        className="inline-flex text-muted-2 hover:text-brand-600 transition-colors"
                      ><IconPencil size={14} /></button>
                      <button
                        onClick={() => setRemoveTarget(acct)}
                        title="Remove account"
                        aria-label={`Remove ${acct.name}`}
                        className="inline-flex text-faint-2 hover:text-danger transition-colors"
                      ><IconX size={14} /></button>
                    </span>
                  </div>
                )
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* Add form */}
      {showAdd && (
        <Card title="New account">
          <div className="px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-muted-2 mb-1">Name</label>
                <input
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Schwab Brokerage"
                  aria-label="Account name"
                  className="w-full border border-line rounded px-2 py-1.5 text-sm"
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleAdd()}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-2 mb-1">Institution</label>
                <select
                  value={form.institution}
                  onChange={e => setForm({ ...form, institution: e.target.value })}
                  aria-label="Institution"
                  className="w-full border border-line rounded px-2 py-1.5 text-sm"
                >
                  {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-2 mb-1">Account type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(applyTypeDefaults(form, e.target.value as AccountType))}
                  aria-label="Account type"
                  className="w-full border border-line rounded px-2 py-1.5 text-sm"
                >
                  {ACCOUNT_TYPES.map(t => (
                    <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-muted-2 mb-1">
                  New cash in account ($)
                  <HelpTip>
                    Uninvested cash already sitting in this account (e.g. a dividend). Added to this
                    account's capacity and steered toward underweight classes.
                  </HelpTip>
                </label>
                <input
                  type="number"
                  value={form.newCash}
                  onChange={e => setForm({ ...form, newCash: e.target.value })}
                  placeholder="Optional"
                  aria-label="New cash in account (dollars)"
                  className="w-full border border-line rounded px-2 py-1.5 text-sm"
                />
              </div>
            </div>
            <EligibilityFormFields f={form} onChange={setForm} />
            <ConstraintFields f={form} onChange={setForm} />
            <div className="flex gap-2 pt-1">
              <button onClick={handleAdd} disabled={!form.name.trim()} className={btnPrimaryCompact}>Add</button>
              <button onClick={() => { setShowAdd(false); setForm(blankForm()); }} className={btnGhostCompact}>Cancel</button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={removeTarget != null}
        title="Remove account?"
        message={removeTarget ? `Remove "${removeTarget.name}" and all its positions? This cannot be undone.` : ''}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (!removeTarget) return;
          setAccounts(accounts.filter(a => a.id !== removeTarget.id));
          onDeleteAccount(removeTarget.id);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
