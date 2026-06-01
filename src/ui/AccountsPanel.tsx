import { useState } from 'react';
import type { Account, AccountType, AssetClass } from '../engine/types';
import { defaultWithdrawalPriority, withdrawalPriorityOf } from '../engine/rebalance';
import { ACCT_TYPE_LABEL, AC_LABEL, fmtUsd } from './fmt';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';

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

// Binary Open/Closed pill for the deposit column.
function DepositToggle({ open, onChange }: { open: boolean; onChange: (open: boolean) => void }) {
  const opts: [string, boolean][] = [['Open', true], ['Closed', false]];
  return (
    <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
      {opts.map(([label, val], i) => (
        <button
          key={label}
          type="button"
          onClick={() => onChange(val)}
          className={`px-2.5 py-0.5 font-medium transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
            open === val
              ? (val ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600')
              : 'bg-white text-gray-400 hover:bg-gray-50'
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
  policy, rmd, onPolicyChange, onRmdChange,
}: {
  policy: WithdrawalPolicy;
  rmd: string;
  onPolicyChange: (p: WithdrawalPolicy) => void;
  onRmdChange: (v: string) => void;
}) {
  const active: Record<WithdrawalPolicy, string> = {
    restricted: 'bg-red-100 text-red-600',
    eligible:   'bg-green-100 text-green-700',
    required:   'bg-blue-100 text-blue-700',
  };
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
        {WITHDRAWAL_OPTS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPolicyChange(opt.value)}
            className={`px-2.5 py-0.5 font-medium transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
              policy === opt.value ? active[opt.value] : 'bg-white text-gray-400 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {policy === 'required' && (
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min="0"
            value={rmd}
            onChange={e => onRmdChange(e.target.value)}
            placeholder="RMD"
            className="w-24 border rounded px-1.5 py-0.5 text-xs"
          />
          <span className="text-gray-400">RMD due</span>
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

  // Constraint badges shown in the view row under the account name.
  function ConstraintBadges({ acct }: { acct: Account }) {
    const excluded = acct.allowedAssetClasses
      ? PLACEABLE_CLASSES.filter(c => !acct.allowedAssetClasses!.includes(c))
      : [];
    const concentrated = acct.concentrateClasses ?? [];
    if (excluded.length === 0 && concentrated.length === 0) return null;
    return (
      <div className="mt-0.5 space-y-0.5">
        {excluded.length > 0 && (
          <div className="text-xs text-orange-500 font-normal">
            excl. {excluded.map(c => AC_LABEL[c]).join(', ')}
          </div>
        )}
        {concentrated.length > 0 && (
          <div className="text-xs text-indigo-400 font-normal">
            concentrate: {concentrated.map(c => AC_LABEL[c]).join(', ')}
          </div>
        )}
      </div>
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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Accounts</h2>
        <button
          onClick={() => { setShowAdd(true); setEditingId(null); }}
          className="text-sm bg-indigo-600 text-white px-3 py-1.5 rounded-md hover:bg-indigo-700"
        >
          + Add account
        </button>
      </div>

      {/* Planned cash flows: deposits (left) and withdrawals (right). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Planned deposits */}
        <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Planned deposits ($)
            <HelpTip>
              Household free cash not yet assigned to a specific account — a check you're about to
              deposit, or sweep-fund proceeds to invest. The engine deploys it into the
              deposit-eligible account with the most capacity first, spilling only when a
              contribution cap forces it. Closed accounts are excluded.
            </HelpTip>
          </label>
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
            placeholder="e.g. 5000"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          {freeCash > 0 && (
            <p className="mt-1 text-xs text-green-700">
              {fmtUsd(freeCash)} deployed to eligible accounts at run time.
            </p>
          )}
        </div>

        {/* Planned withdrawals = Σ RMD + additional */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Additional withdrawal ($)
            <HelpTip>
              Discretionary cash to raise by selling, on top of any RMDs. RMDs (set per account via
              the "Required" withdrawal state) are taken first; this amount then drains
              withdrawal-eligible accounts in drain-priority order, selling down toward your target.
            </HelpTip>
          </label>
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
            placeholder="e.g. 20000"
            className="w-full border rounded px-2 py-1 text-sm"
          />
          {totalWithdrawal > 0 && (
            <p className="mt-1 text-xs text-amber-700">
              Total withdrawals: <strong>{fmtUsd(totalWithdrawal)}</strong>
              {totalRmd > 0 && <> = {fmtUsd(totalRmd)} RMD + {fmtUsd(plannedWithdrawal)} additional</>}
            </p>
          )}
        </div>
      </div>

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
        <div className="py-8 text-center border border-dashed rounded-lg flex flex-col items-center gap-3">
          <p className="text-sm text-gray-500">No accounts yet. Add one to get started.</p>
          <button
            onClick={onLoadSample}
            className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 rounded px-3 py-1.5 hover:bg-indigo-50 transition-colors"
          >
            Load sample portfolio
          </button>
        </div>
      )}

      {accounts.length > 0 && (
        <div className="overflow-hidden border border-gray-200 rounded-lg">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wide">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left">Institution</th>
                <th className="px-4 py-2 text-left">Type</th>
                <th className="px-4 py-2 text-right">New Cash</th>
                <th className="px-4 py-2 text-center">
                  <span className="inline-flex items-center gap-0.5">
                    Deposits
                    <HelpTip dir="left">
                      Whether this account can receive a share of household free cash.
                      <strong> Open</strong> / <strong>Closed</strong>. Set an optional contribution
                      cap in the Edit form. Closed accounts still rebalance internally.
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-2 text-center">
                  <span className="inline-flex items-center gap-0.5">
                    Withdrawals
                    <HelpTip dir="left">
                      How much of a withdrawal this account funds by selling.
                      <strong> Eligible</strong> = any share; <strong>Restricted</strong> = none
                      (default for tax-advantaged); <strong>Required</strong> = has an RMD, taken
                      first and still able to fund more. Set drain priority in the Edit form.
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-2 text-center">
                  <span className="inline-flex items-center gap-0.5">
                    Locked
                    <HelpTip dir="left">
                      A locked account counts in household totals and weights but receives no trade
                      suggestions. Use for accounts you're not actively managing right now — e.g. a
                      401k at a former employer.
                    </HelpTip>
                  </span>
                </th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(acct => (
                editingId === acct.id ? (
                  <tr key={acct.id}>
                    <td colSpan={8} className="px-0 py-0">
                      <div className="bg-indigo-50 px-4 py-3 space-y-3">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Name</label>
                            <input
                              value={editForm.name}
                              onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                              className="w-full border rounded px-2 py-1 text-sm"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Institution</label>
                            <select
                              value={editForm.institution}
                              onChange={e => setEditForm({ ...editForm, institution: e.target.value })}
                              className="w-full border rounded px-2 py-1 text-sm"
                            >
                              {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">Account type</label>
                            <select
                              value={editForm.type}
                              onChange={e => setEditForm(applyTypeDefaults(editForm, e.target.value as AccountType))}
                              className="w-full border rounded px-2 py-1 text-sm"
                            >
                              {ACCOUNT_TYPES.map(t => (
                                <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs text-gray-500 mb-1">
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
                              className="w-full border rounded px-2 py-1 text-sm"
                            />
                          </div>
                        </div>
                        <EligibilityFormFields f={editForm} onChange={setEditForm} />
                        <ConstraintFields f={editForm} onChange={setEditForm} />
                        <div className="flex items-center gap-3 pt-1">
                          <button
                            onClick={() => saveEdit(acct.id)}
                            className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-indigo-700"
                          >Save</button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="text-gray-500 text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
                          >Cancel</button>
                          <span className="text-xs text-gray-400 ml-1">
                            Lock:{' '}
                            <span className="font-medium">{acct.locked ? 'on' : 'off'}</span>
                            {' '}(toggle in the table view)
                          </span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={acct.id} className={`hover:bg-gray-50 ${acct.locked ? 'opacity-60' : ''}`}>
                    <td className="px-4 py-2 font-medium text-gray-800">
                      {acct.name}
                      <ConstraintBadges acct={acct} />
                    </td>
                    <td className="px-4 py-2 text-gray-600">{acct.institution}</td>
                    <td className="px-4 py-2 text-gray-600">{ACCT_TYPE_LABEL[acct.type]}</td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {acct.newCash ? `$${acct.newCash.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="inline-flex justify-center">
                        <DepositToggle
                          open={accountDepositOpen(acct)}
                          onChange={open => setAccounts(accounts.map(a =>
                            a.id === acct.id ? { ...a, acceptsDeposits: open ? undefined : false } : a
                          ))}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <div className="inline-flex justify-center">
                        <WithdrawalCell
                          key={`wd-${acct.id}`}
                          initialPolicy={accountWithdrawalPolicy(acct)}
                          initialRmd={acct.rmdDueUsd != null ? String(acct.rmdDueUsd) : ''}
                          onChange={(policy, rmd) => setAccounts(accounts.map(a =>
                            a.id === acct.id ? { ...a, ...withdrawalFields(policy, rmd) } : a
                          ))}
                        />
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center">
                      <button
                        onClick={() => setAccounts(accounts.map(a =>
                          a.id === acct.id ? { ...a, locked: !a.locked } : a
                        ))}
                        title={acct.locked ? 'Unlock account (allow trades)' : 'Lock account (exclude from trades)'}
                        className={`text-sm transition-colors ${acct.locked ? 'text-amber-500 hover:text-gray-400' : 'text-gray-300 hover:text-amber-500'}`}
                      >
                        {acct.locked ? '🔒' : '🔓'}
                      </button>
                    </td>
                    <td className="px-4 py-2 text-right space-x-3 whitespace-nowrap">
                      <button
                        onClick={() => startEdit(acct)}
                        className="text-indigo-500 hover:underline text-xs"
                      >Edit</button>
                      <button
                        onClick={() => {
                          if (confirm(`Remove "${acct.name}" and all its positions?`)) {
                            setAccounts(accounts.filter(a => a.id !== acct.id));
                            onDeleteAccount(acct.id);
                          }
                        }}
                        className="text-red-400 hover:underline text-xs"
                      >Remove</button>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add form */}
      {showAdd && (
        <div className="border border-indigo-200 rounded-lg p-4 bg-indigo-50 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">New account</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Name</label>
              <input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Schwab Brokerage"
                className="w-full border rounded px-2 py-1.5 text-sm"
                autoFocus
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Institution</label>
              <select
                value={form.institution}
                onChange={e => setForm({ ...form, institution: e.target.value })}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Account type</label>
              <select
                value={form.type}
                onChange={e => setForm(applyTypeDefaults(form, e.target.value as AccountType))}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">
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
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <EligibilityFormFields f={form} onChange={setForm} />
          <ConstraintFields f={form} onChange={setForm} />
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleAdd}
              disabled={!form.name.trim()}
              className="bg-indigo-600 text-white text-sm px-4 py-1.5 rounded-md hover:bg-indigo-700 disabled:opacity-40"
            >Add</button>
            <button
              onClick={() => { setShowAdd(false); setForm(blankForm()); }}
              className="text-gray-500 text-sm px-3 py-1.5 rounded-md hover:bg-gray-100"
            >Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
