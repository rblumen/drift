import type { Account, Flag, SpilloverOccupant } from '../engine/types';
import { AC_LABEL, BUCKET_LABEL, fmtUsd } from './fmt';

type SpilloverFlag = Extract<Flag, { kind: 'PLACEMENT_SPILLOVER' }>;

// #199 — plain-text reasoning for a spillover flag: what occupies the preferred
// bucket, e.g. "preferred bucket full: $10,000 locked (VOO) and $2,000 cash
// occupy taxable". Shared by the Results flag strip and the HTML export (the
// export must esc() the result — account names are user text). Returns null
// when the flag carries no occupancy payload, so callers fall back to the
// pre-#199 one-liner.
export function spilloverReason(
  flag: SpilloverFlag,
  accounts: Account[],
  maxItems = 3,
): string | null {
  const { preferredBucket, occupiedBy } = flag;
  if (!preferredBucket || !occupiedBy?.length) return null;

  const acctName = (id: string) => accounts.find(a => a.id === id)?.name ?? id;
  const phrase = (o: SpilloverOccupant): string => {
    switch (o.kind) {
      case 'LOCKED_POSITION':
        return `${fmtUsd(o.amountUsd)} locked${o.tickers.length > 0 ? ` (${o.tickers.join(', ')})` : ''}`;
      case 'LOCKED_ACCOUNT':
        return `${fmtUsd(o.amountUsd)} locked (${acctName(o.accountId)})`;
      case 'HELD_IN_BAND':
        return o.assetClass === 'CASH'
          ? `${fmtUsd(o.amountUsd)} cash`
          : `${fmtUsd(o.amountUsd)} ${AC_LABEL[o.assetClass]} held in band`;
      case 'PLACED_CLASS':
        return `${fmtUsd(o.amountUsd)} allocated to ${AC_LABEL[o.assetClass]}`;
    }
  };

  const shown = occupiedBy.slice(0, maxItems).map(phrase);
  const restUsd = occupiedBy.slice(maxItems).reduce((s, o) => s + o.amountUsd, 0);
  if (restUsd > 0.5) shown.push(`${fmtUsd(restUsd)} more`);
  const list = shown.length > 1
    ? `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`
    : shown[0];

  // Plural when the listing has several items; a lone "$10,000 locked (VOO)" occupies.
  const verb = shown.length > 1 ? 'occupy' : 'occupies';
  const bucketName = (BUCKET_LABEL[preferredBucket] ?? preferredBucket).toLowerCase();
  return `preferred bucket full: ${list} ${verb} ${bucketName}`;
}
