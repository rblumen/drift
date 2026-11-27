// @vitest-environment jsdom
//
// Owner labels and the owner filter on the Accounts tab (M2, spec-households
// R3.3–R3.4, R9: guest mode keeps a local list of people).
import { describe, it, expect, afterEach } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccountsPanel } from './AccountsPanel';
import type { Account } from '../engine/types';
import type { Person } from '../ingest/schema';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const START_ACCOUNTS: Account[] = [
  { id: 'a1', name: 'Joint Brokerage', institution: 'Schwab', type: 'TAXABLE', ownerPersonIds: ['p1', 'p2'] },
  { id: 'a2', name: 'Alex Roth', institution: 'Schwab', type: 'ROTH_IRA', ownerPersonIds: ['p1'] },
  { id: 'a3', name: 'Sam 401k', institution: 'Fidelity', type: 'FOUR_OH_ONE_K' },
];
const START_PEOPLE: Person[] = [{ id: 'p1', name: 'Alex' }, { id: 'p2', name: 'Sam' }];

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: { accounts: Account[]; people: Person[] } = { accounts: [], people: [] };

function Harness({ accounts: a0, people: p0 }: { accounts: Account[]; people: Person[] }) {
  const [accounts, setAccounts] = useState(a0);
  const [people, setPeople] = useState(p0);
  latest = { accounts, people };
  return (
    <AccountsPanel
      accounts={accounts} setAccounts={setAccounts}
      people={people} setPeople={setPeople}
      onDeleteAccount={() => {}}
      freeCash={0} setFreeCash={() => {}}
      plannedWithdrawal={0} setPlannedWithdrawal={() => {}}
      onLoadSample={() => {}}
    />
  );
}

async function render(accounts = START_ACCOUNTS, people = START_PEOPLE) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<Harness accounts={accounts} people={people} />); });
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;

function button(label: string): HTMLButtonElement {
  const b = [...container!.querySelectorAll('button')].find(
    x => x.textContent?.trim() === label || x.getAttribute('aria-label') === label,
  );
  if (!b) throw new Error(`No button "${label}"`);
  return b as HTMLButtonElement;
}
const text = () => container!.textContent ?? '';

describe('AccountsPanel owner labels', () => {
  it('shows owner names on each account row', async () => {
    await render();
    expect(text()).toContain('Schwab · Alex & Sam');
    expect(text()).toContain('Schwab · Alex');
  });

  it('filters accounts by owner, including joint accounts under each person', async () => {
    await render();
    const select = container!.querySelector('select[aria-label="Filter accounts by owner"]') as HTMLSelectElement;
    const pick = async (v: string) => {
      await act(async () => {
        nativeSelectValueSetter.call(select, v);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await pick('person:p1');
    expect(text()).toContain('Accounts · 2 of 3');
    expect(text()).not.toContain('Sam 401k');
    await pick('joint');
    expect(text()).toContain('Accounts · 1 of 3');
    await pick('none');
    expect(text()).toContain('Sam 401k');
    expect(text()).not.toContain('Alex Roth');
    await pick('all');
    expect(text()).toContain('Accounts · 3');
  });

  it('adds a person and assigns them as an owner through the edit form', async () => {
    await render(START_ACCOUNTS, []);
    expect(container!.querySelector('select[aria-label="Filter accounts by owner"]')).toBeNull();
    const input = container!.querySelector('input[aria-label="New owner name"]') as HTMLInputElement;
    await act(async () => {
      nativeInputValueSetter.call(input, 'Alex');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await act(async () => { button('Add person').click(); });
    expect(latest.people.map(p => p.name)).toEqual(['Alex']);

    await act(async () => { button('Edit Sam 401k').click(); });
    const box = [...container!.querySelectorAll('label')]
      .find(l => l.textContent?.trim() === 'Alex')!.querySelector('input') as HTMLInputElement;
    await act(async () => { box.click(); });
    await act(async () => { button('Save').click(); });
    expect(latest.accounts.find(a => a.id === 'a3')?.ownerPersonIds).toEqual([latest.people[0].id]);
  });

  it('removing a person removes their label from accounts', async () => {
    await render();
    await act(async () => { button('Remove owner Alex').click(); });
    expect(latest.people).toEqual([{ id: 'p2', name: 'Sam' }]);
    expect(latest.accounts.find(a => a.id === 'a1')?.ownerPersonIds).toEqual(['p2']);
    expect(latest.accounts.find(a => a.id === 'a2')).not.toHaveProperty('ownerPersonIds');
  });

  it('renders no owner controls in the account list when there are no people', async () => {
    await render(START_ACCOUNTS.map(({ ownerPersonIds: _o, ...a }) => a), []);
    expect(text()).toContain('Accounts · 3');
    expect(text()).toContain('Add the people in your household');
  });
});
