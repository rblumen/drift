import { describe, it, expect } from 'vitest';
import type { Account, Flag } from '../engine/types';
import { spilloverReason } from './spilloverCopy';

type SpilloverFlag = Extract<Flag, { kind: 'PLACEMENT_SPILLOVER' }>;

const ACCOUNTS: Account[] = [
  { id: 'tx-locked', name: 'Old Brokerage', institution: 'S', type: 'TAXABLE', locked: true },
];

const base: SpilloverFlag = {
  kind: 'PLACEMENT_SPILLOVER',
  assetClass: 'FIXED_INCOME',
  bucket: 'TAX_ADVANTAGED',
  amountUsd: 7_047,
};

describe('spilloverReason (issue #199)', () => {
  it('renders the issue-199 example: locked ticker + in-band cash occupy taxable', () => {
    const reason = spilloverReason({
      ...base,
      preferredBucket: 'TAXABLE',
      occupiedBy: [
        { kind: 'LOCKED_POSITION', assetClass: 'US_LARGE_CAP', tickers: ['VOO'], amountUsd: 10_000 },
        { kind: 'HELD_IN_BAND', assetClass: 'CASH', amountUsd: 2_000 },
      ],
    }, ACCOUNTS);
    expect(reason).toBe('preferred bucket full: $10,000 locked (VOO) and $2,000 cash occupy taxable');
  });

  it('returns null when the flag has no occupancy payload', () => {
    expect(spilloverReason(base, ACCOUNTS)).toBeNull();
    expect(spilloverReason({ ...base, preferredBucket: 'TAXABLE', occupiedBy: [] }, ACCOUNTS)).toBeNull();
  });

  it('uses singular "occupies" for one occupant and names locked accounts', () => {
    const reason = spilloverReason({
      ...base,
      preferredBucket: 'TAXABLE',
      occupiedBy: [{ kind: 'LOCKED_ACCOUNT', accountId: 'tx-locked', amountUsd: 10_000 }],
    }, ACCOUNTS);
    expect(reason).toBe('preferred bucket full: $10,000 locked (Old Brokerage) occupies taxable');
  });

  it('labels non-cash in-band classes and already-placed classes', () => {
    const reason = spilloverReason({
      ...base,
      preferredBucket: 'TAX_FREE',
      occupiedBy: [
        { kind: 'PLACED_CLASS', assetClass: 'ALTERNATIVES', amountUsd: 20_000 },
        { kind: 'HELD_IN_BAND', assetClass: 'US_MID_CAP', amountUsd: 5_000 },
      ],
    }, ACCOUNTS);
    expect(reason).toBe(
      'preferred bucket full: $20,000 allocated to Alternatives and $5,000 US Mid Cap held in band occupy tax-free (roth/hsa)',
    );
  });

  it('aggregates occupants beyond the display cap into a "$X more" tail', () => {
    const reason = spilloverReason({
      ...base,
      preferredBucket: 'TAXABLE',
      occupiedBy: [
        { kind: 'LOCKED_POSITION', assetClass: 'US_LARGE_CAP', tickers: ['VOO'], amountUsd: 10_000 },
        { kind: 'HELD_IN_BAND', assetClass: 'CASH', amountUsd: 2_000 },
        { kind: 'PLACED_CLASS', assetClass: 'US_MID_CAP', amountUsd: 1_500 },
        { kind: 'PLACED_CLASS', assetClass: 'US_SMALL_CAP', amountUsd: 800 },
        { kind: 'PLACED_CLASS', assetClass: 'EMERGING_INTL', amountUsd: 200 },
      ],
    }, ACCOUNTS);
    expect(reason).toContain('$1,000 more');
    expect(reason).not.toContain('Small Cap');
  });
});
