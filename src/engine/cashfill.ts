import { EPSILON } from './utils';

/**
 * Sequential "concentrate-then-spill" fill (backlog #37).
 *
 * Walks accounts in the given order and gives each as much of `amount` as fits
 * in its room, moving to the next account only when the current one is full.
 * This concentrates a deposit (or a withdrawal — see #14) into the fewest
 * accounts, honouring the trade-minimization objectives (PRINCIPLES.md #10/#11)
 * rather than spreading it pro-rata across every eligible account.
 *
 * The caller controls the policy entirely:
 *   • `orderedIds` — accounts in fill priority order (e.g. largest capacity first
 *     for deposits, ascending withdrawal priority for drawdowns).
 *   • `roomOf`     — the most each account may receive (Infinity = uncapped).
 *
 * Returns the per-account allocations and any `residual` that could not be
 * placed because every account's room was exhausted. The caller decides what a
 * residual means (e.g. EXCESS_CASH for deposits, WITHDRAWAL_SHORTFALL for
 * withdrawals).
 *
 * Pure and deterministic: identical inputs always yield identical output, and
 * accounts absent from `orderedIds` are never allocated to.
 */
export function fillOrdered(
  orderedIds: string[],
  roomOf: (id: string) => number,
  amount: number,
): { alloc: Record<string, number>; residual: number } {
  const alloc: Record<string, number> = {};
  let remaining = Math.max(0, amount);

  for (const id of orderedIds) {
    if (remaining <= EPSILON) break;
    const room = Math.max(0, roomOf(id));
    if (room <= EPSILON) continue;
    const give = Math.min(remaining, room);
    alloc[id] = (alloc[id] ?? 0) + give;
    remaining -= give;
  }

  return { alloc, residual: remaining > EPSILON ? remaining : 0 };
}
