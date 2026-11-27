// src/ui/owners.ts — owner labels for accounts (spec-households R3.3–R3.4, R9).
//
// Owner labels ("Alex", "Sam", joint) are display and filtering only: they never
// change trades, and never control access. In guest mode the list of people lives
// in AppState.people; signed-in mode will use household_people (M3+).

import type { Account } from '../engine/types';
import type { Person } from '../ingest/schema';

/** Owner filter value: everything, joint (2+ owners), no owner, or one person. */
export type OwnerFilter = 'all' | 'joint' | 'none' | `person:${string}`;

/** An account's owner ids that still name a known person. */
export function knownOwnerIds(account: Pick<Account, 'ownerPersonIds'>, people: Person[]): string[] {
  const ids = new Set(people.map(p => p.id));
  return (account.ownerPersonIds ?? []).filter(id => ids.has(id));
}

/** "Alex", "Alex & Sam", or "" when the account has no known owner. Order follows the people list. */
export function ownerLabel(account: Pick<Account, 'ownerPersonIds'>, people: Person[]): string {
  const owners = new Set(account.ownerPersonIds ?? []);
  return people.filter(p => owners.has(p.id)).map(p => p.name).join(' & ');
}

/** Whether an account passes an owner filter. A person filter includes their joint accounts. */
export function matchesOwnerFilter(
  account: Pick<Account, 'ownerPersonIds'>,
  filter: OwnerFilter,
  people: Person[],
): boolean {
  if (filter === 'all') return true;
  const owners = knownOwnerIds(account, people);
  if (filter === 'joint') return owners.length >= 2;
  if (filter === 'none') return owners.length === 0;
  return owners.includes(filter.slice('person:'.length));
}

/** Add a person by name. Blank names and case-insensitive duplicates are ignored. */
export function addPerson(people: Person[], name: string, id: string): Person[] {
  const trimmed = name.trim();
  if (!trimmed) return people;
  if (people.some(p => p.name.trim().toLowerCase() === trimmed.toLowerCase())) return people;
  return [...people, { id, name: trimmed }];
}

/** Remove a person, and their label from every account. An account left with no owners drops the field. */
export function removePerson(
  people: Person[],
  accounts: Account[],
  personId: string,
): { people: Person[]; accounts: Account[] } {
  return {
    people: people.filter(p => p.id !== personId),
    accounts: accounts.map(a => {
      if (!a.ownerPersonIds?.includes(personId)) return a;
      const rest = a.ownerPersonIds.filter(id => id !== personId);
      const { ownerPersonIds: _drop, ...without } = a;
      void _drop;
      return rest.length > 0 ? { ...a, ownerPersonIds: rest } : without;
    }),
  };
}

/** Normalize a form's owner selection for storage: known ids only, in people order, or undefined. */
export function ownerIdsForSave(selected: string[], people: Person[]): string[] | undefined {
  const chosen = new Set(selected);
  const ids = people.filter(p => chosen.has(p.id)).map(p => p.id);
  return ids.length > 0 ? ids : undefined;
}
