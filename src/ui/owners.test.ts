import { describe, it, expect } from 'vitest';
import {
  addPerson, removePerson, ownerLabel, matchesOwnerFilter, ownerIdsForSave, knownOwnerIds,
} from './owners';
import type { Account } from '../engine/types';
import type { Person } from '../ingest/schema';

const PEOPLE: Person[] = [{ id: 'p-alex', name: 'Alex' }, { id: 'p-sam', name: 'Sam' }];
const acct = (id: string, ownerPersonIds?: string[]): Account => ({
  id, name: id, institution: 'Brokerage A', type: 'TAXABLE',
  ...(ownerPersonIds ? { ownerPersonIds } : {}),
});
const ACCOUNTS = [
  acct('alex-roth', ['p-alex']),
  acct('joint', ['p-sam', 'p-alex']),
  acct('sam-401k', ['p-sam']),
  acct('unlabelled'),
  acct('stale', ['p-gone']),
];

describe('owner labels', () => {
  it('labels in people order, ignoring unknown ids', () => {
    expect(ownerLabel(ACCOUNTS[1], PEOPLE)).toBe('Alex & Sam');
    expect(ownerLabel(ACCOUNTS[3], PEOPLE)).toBe('');
    expect(ownerLabel(ACCOUNTS[4], PEOPLE)).toBe('');
    expect(knownOwnerIds(ACCOUNTS[4], PEOPLE)).toEqual([]);
  });

  it('filters by person (including joint), joint, no owner, and all', () => {
    const ids = (f: Parameters<typeof matchesOwnerFilter>[1]) =>
      ACCOUNTS.filter(a => matchesOwnerFilter(a, f, PEOPLE)).map(a => a.id);
    expect(ids('all')).toHaveLength(5);
    expect(ids('person:p-alex')).toEqual(['alex-roth', 'joint']);
    expect(ids('person:p-sam')).toEqual(['joint', 'sam-401k']);
    expect(ids('joint')).toEqual(['joint']);
    expect(ids('none')).toEqual(['unlabelled', 'stale']);
  });

  it('adds people, ignoring blanks and duplicate names', () => {
    let people: Person[] = [];
    people = addPerson(people, '  Alex ', 'p1');
    people = addPerson(people, 'alex', 'p2');
    people = addPerson(people, '   ', 'p3');
    people = addPerson(people, 'Sam', 'p4');
    expect(people).toEqual([{ id: 'p1', name: 'Alex' }, { id: 'p4', name: 'Sam' }]);
  });

  it('removing a person strips their label from accounts', () => {
    const r = removePerson(PEOPLE, ACCOUNTS, 'p-alex');
    expect(r.people).toEqual([{ id: 'p-sam', name: 'Sam' }]);
    expect(r.accounts[0]).not.toHaveProperty('ownerPersonIds');
    expect(r.accounts[1].ownerPersonIds).toEqual(['p-sam']);
    expect(r.accounts[2]).toBe(ACCOUNTS[2]);
  });

  it('normalizes a form selection for saving', () => {
    expect(ownerIdsForSave(['p-sam', 'p-alex', 'p-gone'], PEOPLE)).toEqual(['p-alex', 'p-sam']);
    expect(ownerIdsForSave([], PEOPLE)).toBeUndefined();
  });
});
