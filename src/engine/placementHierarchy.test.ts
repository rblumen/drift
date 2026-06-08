import { describe, it, expect } from 'vitest';
import type { AccountType, PlacementTarget } from './types';
import {
  PLACEMENT_HIERARCHY,
  descendantAccountTypes,
  accountSatisfiesTarget,
  isPlacementBucket,
} from './placementHierarchy';

// Issue #89 Phase 1: the placement-target tree generalizes the flat
// TAXABLE | TAX_ADVANTAGED | EDUCATION bucket so a preference can be expressed at
// any level — at minimum tax-deferred (Traditional/401k) vs tax-free (Roth/HSA).

// ─── tree shape ──────────────────────────────────────────────────────────────────

describe('Placement hierarchy (supports Goal 6): tree shape', () => {
  it('TAX_ADVANTAGED splits into TAX_DEFERRED, TAX_FREE, and OTHER', () => {
    expect(PLACEMENT_HIERARCHY.TAX_ADVANTAGED!.children).toEqual(
      ['TAX_DEFERRED', 'TAX_FREE', 'OTHER'],
    );
  });

  it('TAX_DEFERRED holds Traditional accounts; TAX_FREE holds Roth and HSA', () => {
    expect(PLACEMENT_HIERARCHY.TAX_DEFERRED!.children).toEqual(['TRADITIONAL_IRA', 'FOUR_OH_ONE_K']);
    expect(PLACEMENT_HIERARCHY.TAX_FREE!.children).toEqual(['ROTH_IRA', 'HSA']);
  });

  it('EDUCATION holds the 529 leaf; TAXABLE is its own sole leaf', () => {
    expect(PLACEMENT_HIERARCHY.EDUCATION!.children).toEqual(['FIVE_TWENTY_NINE']);
    expect(PLACEMENT_HIERARCHY.TAXABLE!.children).toEqual(['TAXABLE']);
  });
});

// ─── descendant account types ──────────────────────────────────────────────────────

describe('Placement hierarchy: descendantAccountTypes flattens a node to leaf account types', () => {
  it('a bucket flattens to every leaf account type beneath it', () => {
    expect(descendantAccountTypes('TAX_ADVANTAGED').sort()).toEqual(
      ['FOUR_OH_ONE_K', 'HSA', 'OTHER', 'ROTH_IRA', 'TRADITIONAL_IRA'].sort(),
    );
    expect(descendantAccountTypes('TAX_DEFERRED').sort()).toEqual(['FOUR_OH_ONE_K', 'TRADITIONAL_IRA'].sort());
    expect(descendantAccountTypes('TAX_FREE').sort()).toEqual(['HSA', 'ROTH_IRA'].sort());
    expect(descendantAccountTypes('EDUCATION')).toEqual(['FIVE_TWENTY_NINE']);
    expect(descendantAccountTypes('TAXABLE')).toEqual(['TAXABLE']);
  });

  it('a leaf account type flattens to itself', () => {
    expect(descendantAccountTypes('ROTH_IRA')).toEqual(['ROTH_IRA']);
    expect(descendantAccountTypes('TRADITIONAL_IRA')).toEqual(['TRADITIONAL_IRA']);
  });
});

// ─── membership ────────────────────────────────────────────────────────────────────

describe('Placement hierarchy: accountSatisfiesTarget membership', () => {
  // [accountType, target, satisfies?]
  const cases: Array<[AccountType, PlacementTarget, boolean]> = [
    // A narrow account satisfies its own type and every ancestor bucket.
    ['ROTH_IRA', 'ROTH_IRA', true],
    ['ROTH_IRA', 'TAX_FREE', true],
    ['ROTH_IRA', 'TAX_ADVANTAGED', true],
    ['ROTH_IRA', 'TAX_DEFERRED', false],
    ['ROTH_IRA', 'TAXABLE', false],
    // Traditional is tax-deferred, not tax-free.
    ['TRADITIONAL_IRA', 'TAX_DEFERRED', true],
    ['TRADITIONAL_IRA', 'TAX_ADVANTAGED', true],
    ['TRADITIONAL_IRA', 'TAX_FREE', false],
    ['FOUR_OH_ONE_K', 'TAX_DEFERRED', true],
    // HSA shelters like Roth.
    ['HSA', 'TAX_FREE', true],
    ['HSA', 'TAX_DEFERRED', false],
    // OTHER is tax-advantaged but neither deferred nor free.
    ['OTHER', 'TAX_ADVANTAGED', true],
    ['OTHER', 'TAX_DEFERRED', false],
    ['OTHER', 'TAX_FREE', false],
    // Taxable and education.
    ['TAXABLE', 'TAXABLE', true],
    ['TAXABLE', 'TAX_ADVANTAGED', false],
    ['FIVE_TWENTY_NINE', 'EDUCATION', true],
    ['FIVE_TWENTY_NINE', 'TAX_ADVANTAGED', false],
  ];

  for (const [type, target, expected] of cases) {
    it(`${type} ${expected ? 'satisfies' : 'does not satisfy'} ${target}`, () => {
      expect(accountSatisfiesTarget(type, target)).toBe(expected);
    });
  }
});

// ─── bucket vs leaf classification ───────────────────────────────────────────────────

describe('Placement hierarchy: isPlacementBucket distinguishes interior nodes from leaves', () => {
  it('interior buckets are buckets', () => {
    expect(isPlacementBucket('TAX_ADVANTAGED')).toBe(true);
    expect(isPlacementBucket('TAX_DEFERRED')).toBe(true);
    expect(isPlacementBucket('TAX_FREE')).toBe(true);
    expect(isPlacementBucket('EDUCATION')).toBe(true);
  });

  it('account-type leaves are not buckets', () => {
    expect(isPlacementBucket('ROTH_IRA')).toBe(false);
    expect(isPlacementBucket('TRADITIONAL_IRA')).toBe(false);
    expect(isPlacementBucket('FIVE_TWENTY_NINE')).toBe(false);
  });
});
