import { useState } from 'react';
import type { Account, AccountType } from '../engine/types';
import { ACCT_TYPE_LABEL } from './fmt';

interface Props {
  accounts: Account[];
  setAccounts: (a: Account[]) => void;
  /** Positions keyed by accountId — used to cascade-delete on account removal. */
  onDeleteAccount: (id: string) => void;
}

const ACCOUNT_TYPES: AccountType[] = [
  'TAXABLE', 'TRADITIONAL_IRA', 'ROTH_IRA', 'FOUR_OH_ONE_K',
  'FIVE_TWENTY_NINE', 'HSA', 'OTHER',
];

const INSTITUTIONS = ['Schwab', 'Fidelity', 'Empower', 'Vanguard', 'Other'];

function blankForm() {
  return { name: '', institution: 'Schwab', type: 'TAXABLE' as AccountType, newCash: '' };
}

export function AccountsPanel({ accounts, setAccounts, onDeleteAccount }: Props) {
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm]       = useState(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm]   = useState(blankForm);

  function handleAdd() {
    if (!form.name.trim()) return;
    const acct: Account = {
      id:          crypto.randomUUID(),
      name:        form.name.trim(),
      institution: form.institution,
      type:        form.type,
      newCash:     form.newCash ? parseFloat(form.newCash) : undefined,
    };
    setAccounts([...accounts, acct]);
    setForm(blankForm());
    setShowAdd(false);
  }

  function startEdit(acct: Account) {
    setEditingId(acct.id);
    setEditForm({
      name:        acct.name,
      institution: acct.institution,
      type:        acct.type,
      newCash:     acct.newCash != null ? String(acct.newCash) : '',
    });
  }

  function saveEdit(id: string) {
    setAccounts(accounts.map(a =>
      a.id !== id ? a : {
        ...a,
        name:        editForm.name.trim(),
        institution: editForm.institution,
        type:        editForm.type,
        newCash:     editForm.newCash ? parseFloat(editForm.newCash) : undefined,
      }
    ));
    setEditingId(null);
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

      {accounts.length === 0 && !showAdd && (
        <p className="text-sm text-gray-500 py-8 text-center border border-dashed rounded-lg">
          No accounts yet. Add one to get started.
        </p>
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
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {accounts.map(acct => (
                editingId === acct.id ? (
                  <tr key={acct.id} className="bg-indigo-50">
                    <td className="px-4 py-2">
                      <input
                        value={editForm.name}
                        onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                        className="w-full border rounded px-2 py-1 text-sm"
                        autoFocus
                      />
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editForm.institution}
                        onChange={e => setEditForm({ ...editForm, institution: e.target.value })}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {INSTITUTIONS.map(i => <option key={i}>{i}</option>)}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <select
                        value={editForm.type}
                        onChange={e => setEditForm({ ...editForm, type: e.target.value as AccountType })}
                        className="border rounded px-2 py-1 text-sm"
                      >
                        {ACCOUNT_TYPES.map(t => (
                          <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-2">
                      <input
                        type="number"
                        value={editForm.newCash}
                        onChange={e => setEditForm({ ...editForm, newCash: e.target.value })}
                        placeholder="0"
                        className="w-24 border rounded px-2 py-1 text-sm text-right"
                      />
                    </td>
                    <td className="px-4 py-2 text-right space-x-2 whitespace-nowrap">
                      <button
                        onClick={() => saveEdit(acct.id)}
                        className="text-indigo-600 hover:underline text-xs"
                      >Save</button>
                      <button
                        onClick={() => setEditingId(null)}
                        className="text-gray-400 hover:underline text-xs"
                      >Cancel</button>
                    </td>
                  </tr>
                ) : (
                  <tr key={acct.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium text-gray-800">{acct.name}</td>
                    <td className="px-4 py-2 text-gray-600">{acct.institution}</td>
                    <td className="px-4 py-2 text-gray-600">{ACCT_TYPE_LABEL[acct.type]}</td>
                    <td className="px-4 py-2 text-right text-gray-600">
                      {acct.newCash ? `$${acct.newCash.toLocaleString()}` : '—'}
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
                onChange={e => setForm({ ...form, type: e.target.value as AccountType })}
                className="w-full border rounded px-2 py-1.5 text-sm"
              >
                {ACCOUNT_TYPES.map(t => (
                  <option key={t} value={t}>{ACCT_TYPE_LABEL[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">New cash to deploy ($)</label>
              <input
                type="number"
                value={form.newCash}
                onChange={e => setForm({ ...form, newCash: e.target.value })}
                placeholder="Optional"
                className="w-full border rounded px-2 py-1.5 text-sm"
              />
            </div>
          </div>
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
