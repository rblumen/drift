import { useState } from 'react';
import type { Account, AccountType, AssetClass } from '../engine/types';
import { ACCT_TYPE_LABEL, AC_LABEL } from './fmt';
import { HelpBox, HelpDef, HelpSection, HelpTip } from './HelpBox';

// Three-state deposit eligibility (issue #30). Maps to Account fields:
//   open    → acceptsDeposits: undefined, depositLimitUsd: undefined
//   limited → acceptsDeposits: undefined, depositLimitUsd: <cap>
//   closed  → acceptsDeposits: false,     depositLimitUsd: undefined
type DepositPolicy = 'open' | 'limited' | 'closed';

const DEPOSIT_OPTS: { value: DepositPolicy; label: string }[] = [
  { value: 'open',    label: 'Open' },
  { value: 'limited', label: 'Limited' },
  { value: 'closed',  label: 'Closed' },
];

function accountDepositPolicy(a: Account): DepositPolicy {
  if (a.acceptsDeposits === false) return 'closed';
  if (a.depositLimitUsd != null) return 'limited';
  return 'open';
}

// The two Account fields implied by a (policy, limit) pair.
function depositFields(policy: DepositPolicy, limitStr: string): Pick<Account, 'acceptsDeposits' | 'depositLimitUsd'> {
  if (policy === 'closed') return { acceptsDeposits: false, depositLimitUsd: undefined };
  if (policy === 'open')   return { acceptsDeposits: undefined, depositLimitUsd: undefined };
  // limited — an empty/invalid cap behaves as unlimited until a number is entered.
  const v = parseFloat(limitStr);
  return { acceptsDeposits: undefined, depositLimitUsd: isNaN(v) || v < 0 ? undefined : v };
}

interface Props {
  accounts: Account[];
  setAccounts: (a: Account[]) => void;
  /** Positions keyed by accountId — used to cascade-delete on account removal. */
  onDeleteAccount: (id: string) => void;
  freeCash: number;
  setFreeCash: (v: number) => void;
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

interface FormState {
  name: string;
  institution: string;
  type: AccountType;
  newCash: string;
  depositPolicy: DepositPolicy;
  depositLimit: string;
  restricted: boolean;
  allowedClasses: AssetClass[];
  concentrateClasses: AssetClass[];
}

function blankForm(): FormState {
  return {
    name: '', institution: 'Schwab', type: 'TAXABLE', newCash: '',
    depositPolicy: 'open', depositLimit: '',
    restricted: false, allowedClasses: [...PLACEABLE_CLASSES], concentrateClasses: [],
  };
}

// When the user selects 401k and the form isn't already restricted, pre-populate
// the most common restriction: no ALTERNATIVES in a 401k menu.
function applyTypeDefaults(form: FormState, newType: AccountType): FormState {
  if (newType === 'FOUR_OH_ONE_K' && !form.restricted) {
    return {
      ...form,
      type: newType,
      restricted: true,
      allowedClasses: PLACEABLE_CLASSES.filter(c => c !== 'ALTERNATIVES'),
    };
  }
  return { ...form, type: newType };
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

// Segmented Open · Limited · Closed control plus a cap input revealed when
// "Limited" is selected. Presentational — the caller owns (policy, limit) state.
function DepositPolicyControl({
  policy, limit, onPolicyChange, onLimitChange,
}: {
  policy: DepositPolicy;
  limit: string;
  onPolicyChange: (p: DepositPolicy) => void;
  onLimitChange: (v: string) => void;
}) {
  const activeClass: Record<DepositPolicy, string> = {
    open:    'bg-green-100 text-green-700',
    limited: 'bg-amber-100 text-amber-700',
    closed:  'bg-red-100 text-red-600',
  };
  return (
    <div className="inline-flex flex-col items-start gap-1">
      <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-xs">
        {DEPOSIT_OPTS.map((opt, i) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onPolicyChange(opt.value)}
            className={`px-2.5 py-0.5 font-medium transition-colors ${i > 0 ? 'border-l border-gray-200' : ''} ${
              policy === opt.value ? activeClass[opt.value] : 'bg-white text-gray-400 hover:bg-gray-50'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
      {policy === 'limited' && (
        <div className="flex items-center gap-1 text-xs text-gray-600">
          <span className="text-gray-400">$</span>
          <input
            type="number"
            min="0"
            value={limit}
            onChange={e => onLimitChange(e.target.value)}
            placeholder="cap"
            className="w-24 border rounded px-1.5 py-0.5 text-xs"
          />
          <span className="text-gray-400">free-cash cap</span>
        </div>
      )}
    </div>
  );
}

// Inline deposit control for a table row. Holds its own (policy, limit) draft so
// selecting "Limited" can reveal an empty cap field without the account briefly
// reading back as "open". Commits both Account fields on every change.
function DepositCell({
  acct, onChange,
}: {
  acct: Account;
  onChange: (fields: Pick<Account, 'acceptsDeposits' | 'depositLimitUsd'>) => void;
}) {
  const [policy, setPolicy] = useState<DepositPolicy>(() => accountDepositPolicy(acct));
  const [limit, setLimit]   = useState(() => (acct.depositLimitUsd != null ? String(acct.depositLimitUsd) : ''));

  function commit(nextPolicy: DepositPolicy, nextLimit: string) {
    setPolicy(nextPolicy);
    setLimit(nextLimit);
    onChange(depositFields(nextPolicy, nextLimit));
  }

  return (
    <DepositPolicyControl
      policy={policy}
      limit={limit}
      onPolicyChange={p => commit(p, limit)}
      onLimitChange={v => commit('limited', v)}
    />
  );
}

export function AccountsPanel({ accounts, setAccounts, onDeleteAccount, freeCash, setFreeCash, onLoadSample }: Props) {
  const [freeCashInput, setFreeCashInput] = useState(freeCash > 0 ? String(freeCash) : '');
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState<FormState>(blankForm);

  function handleAdd() {
    if (!form.name.trim()) return;
    const acct: Account = {
      id:              crypto.randomUUID(),
      name:            form.name.trim(),
      institution:     form.institution,
      type:            form.type,
      newCash:         form.newCash ? parseFloat(form.newCash) : undefined,
      ...depositFields(form.depositPolicy, form.depositLimit),
      allowedAssetClasses: toAllowedAssetClasses(form),
      concentrateClasses:  form.concentrateClasses.length > 0 ? form.concentrateClasses : undefined,
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
      depositPolicy:   accountDepositPolicy(acct),
      depositLimit:    acct.depositLimitUsd != null ? String(acct.depositLimitUsd) : '',
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
        name:            editForm.name.trim(),
        institution:     editForm.institution,
        type:            editForm.type,
        newCash:         editForm.newCash ? parseFloat(editForm.newCash) : undefined,
        ...depositFields(editForm.depositPolicy, editForm.depositLimit),
        allowedAssetClasses: toAllowedAssetClasses(editForm),
        concentrateClasses:  editForm.concentrateClasses.length > 0
          ? editForm.concentrateClasses : undefined,
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

      {/* Household free cash */}
      <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
        <div className="flex-1">
          <label className="block text-xs font-medium text-gray-700 mb-1">
            Household free cash ($)
            <HelpTip>
              Cash not yet assigned to a specific account — for example, a check you're about to
              deposit, or proceeds sitting in a sweep fund you want to invest. The engine distributes
              it proportionally across accounts with deposits open before running placement. Accounts
              marked "deposits closed" are excluded.
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
            className="w-48 border rounded px-2 py-1 text-sm"
          />
        </div>
        {freeCash > 0 && (
          <p className="text-xs text-green-700">
            ${freeCash.toLocaleString()} will be distributed to eligible accounts at run time.
          </p>
        )}
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
          <HelpDef term="Household free cash">Cash not yet assigned to a specific account. Distributed proportionally to accounts with deposits open before placement runs. Enter it in the green bar above.</HelpDef>
          <HelpDef term="New cash">Uninvested cash already sitting in a specific account (e.g. a dividend that landed). Counted in that account's value and deployed toward underweight classes.</HelpDef>
          <HelpDef term="Deposits: Open / Limited / Closed">How much household free cash an account can receive. <em>Open</em> takes any share; <em>Limited</em> caps the share at a dollar amount (use when a contribution limit is partly consumed — e.g. a Roth IRA with room left this year); <em>Closed</em> receives none. In every case the account still rebalances its existing holdings, and any new cash you've entered for it deploys in full regardless of this setting.</HelpDef>
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
                      How much household free cash this account can receive. <strong>Open</strong> =
                      any share; <strong>Limited</strong> = capped at a dollar amount (use when a
                      contribution limit is partly consumed); <strong>Closed</strong> = none. The
                      account still rebalances internally, and its own new cash always deploys in
                      full regardless of this setting.
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
                    <td colSpan={7} className="px-0 py-0">
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
                        <div className="space-y-1">
                          <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
                            Deposits
                            <HelpTip>
                              <strong>Open</strong> accepts any share of household free cash.
                              <strong> Limited</strong> caps the free-cash share at a dollar amount —
                              use when a contribution limit is partly consumed (e.g. a Roth IRA with
                              room left this year). <strong>Closed</strong> receives none. The account
                              still rebalances its existing holdings, and its own new cash always
                              deploys in full regardless of this setting.
                            </HelpTip>
                          </span>
                          <DepositPolicyControl
                            policy={editForm.depositPolicy}
                            limit={editForm.depositLimit}
                            onPolicyChange={p => setEditForm({ ...editForm, depositPolicy: p })}
                            onLimitChange={v => setEditForm({ ...editForm, depositPolicy: 'limited', depositLimit: v })}
                          />
                        </div>
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
                        <DepositCell
                          acct={acct}
                          onChange={fields => setAccounts(accounts.map(a =>
                            a.id === acct.id ? { ...a, ...fields } : a
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
          <div className="space-y-1">
            <span className="flex items-center gap-1 text-xs font-medium text-gray-600">
              Deposits
              <HelpTip>
                <strong>Open</strong> accepts any share of household free cash.
                <strong> Limited</strong> caps the free-cash share at a dollar amount — use when a
                contribution limit is partly consumed (e.g. a Roth IRA with room left this year).
                <strong> Closed</strong> receives none. The account still rebalances its existing
                holdings, and its own new cash always deploys in full regardless of this setting.
              </HelpTip>
            </span>
            <DepositPolicyControl
              policy={form.depositPolicy}
              limit={form.depositLimit}
              onPolicyChange={p => setForm({ ...form, depositPolicy: p })}
              onLimitChange={v => setForm({ ...form, depositPolicy: 'limited', depositLimit: v })}
            />
          </div>
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
