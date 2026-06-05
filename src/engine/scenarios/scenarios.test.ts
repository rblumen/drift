// Scenario-based verification harness (issue #33).
//
// Globs every `*.scenario.json` under this directory, validates it against the
// fixture schema, runs the engine, and asserts each `expected.*` field that is
// present. Adding a new fixture requires ZERO code changes here — the glob picks
// it up and it appears as its own named test, grouped by principle subfolder.

import { describe, it, expect } from 'vitest';
import { scenarioSchema, type Scenario, type ExpectedFlag } from './schema';
import { rebalance } from '../rebalance';
import { ALL_ASSET_CLASSES } from '../types';
import type { Account, Position, Strategy, AssetClass, RebalanceResult } from '../types';

// Vite's import.meta.glob loads all fixtures eagerly at collection time.
const modules = import.meta.glob('./**/*.scenario.json', { eager: true }) as Record<
  string,
  { default: unknown }
>;

interface Case {
  path: string;
  folder: string;
  title: string;
  raw: unknown;
}

// Group fixtures by their principle subfolder (e.g. "01-locked-accounts") so the
// HTML report nests them under a describe block per principle.
const byFolder = new Map<string, Case[]>();
for (const [path, mod] of Object.entries(modules)) {
  const parts = path.replace(/^\.\//, '').split('/');
  const folder = parts.length > 1 ? parts[0] : '(root)';
  // Pull the title straight from the JSON (not the parsed schema) so a fixture
  // that fails validation still shows a meaningful test name.
  const raw = mod.default as Record<string, unknown>;
  const title =
    (typeof raw?.description === 'string' && raw.description) ||
    (typeof raw?.name === 'string' && raw.name) ||
    path;
  const list = byFolder.get(folder) ?? [];
  list.push({ path, folder, title, raw: mod.default });
  byFolder.set(folder, list);
}

const round = (n: number, dp: number) => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

// Numbers within tolerance: absolute 0.01 or 0.5% of the expected magnitude,
// whichever is looser. Covers both small fractions (taxableShare) and large
// dollar amounts (amountUsd) without false negatives from float noise.
const approxEq = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= Math.max(0.01, Math.abs(b) * 0.005);
  }
  return a === b;
};

function flagMatches(actual: Record<string, unknown>, expected: ExpectedFlag): boolean {
  if (actual.kind !== expected.kind) return false;
  return Object.entries(expected).every(
    ([k, v]) => k === 'kind' || approxEq(actual[k], v),
  );
}

function assertScenario(s: Scenario, result: RebalanceResult): void {
  const { expected } = s;

  // ── trades — exhaustive (the engine must emit exactly these) ──────────────
  if (expected.trades) {
    const norm = (t: { accountId: string; assetClass: string; deltaUsd: number }) => ({
      accountId: t.accountId,
      assetClass: t.assetClass,
      deltaUsd: round(t.deltaUsd, 2),
    });
    const sort = (a: ReturnType<typeof norm>, b: ReturnType<typeof norm>) =>
      a.accountId.localeCompare(b.accountId) ||
      a.assetClass.localeCompare(b.assetClass) ||
      a.deltaUsd - b.deltaUsd;
    // Drop zero-dollar trades: the engine can emit $0 placeholder entries that
    // are not actionable orders, so `trades: []` reads as "no actionable trades".
    const actual = result.trades.map(norm).filter(t => t.deltaUsd !== 0).sort(sort);
    const want = expected.trades.map(norm).sort(sort);
    expect(actual, `trades mismatch — ${s.description}`).toEqual(want);

    // Optional per-trade inTaxableAccount assertion.
    for (const et of expected.trades) {
      if (et.inTaxableAccount === undefined) continue;
      const hit = result.trades.find(
        t => t.accountId === et.accountId && t.assetClass === et.assetClass,
      );
      expect(
        hit?.inTaxableAccount,
        `inTaxableAccount for ${et.accountId}/${et.assetClass} — ${s.description}`,
      ).toBe(et.inTaxableAccount);
    }
  }

  // ── requiredTrades — specific trades that must be present ─────────────────
  if (expected.requiredTrades) {
    for (const rt of expected.requiredTrades) {
      const hit = result.trades.find(
        t => t.accountId === rt.accountId && t.assetClass === rt.assetClass,
      );
      const ok =
        hit !== undefined &&
        Math.abs(hit.deltaUsd - rt.deltaUsd) <= Math.max(1, Math.abs(rt.deltaUsd) * 0.005) &&
        (rt.inTaxableAccount === undefined || hit.inTaxableAccount === rt.inTaxableAccount);
      if (!ok) {
        throw new Error(
          `Required trade not found / mismatched — ${s.description}\n` +
            `  required: ${JSON.stringify(rt)}\n` +
            `  actual for ${rt.accountId}/${rt.assetClass}: ${JSON.stringify(hit ?? null)}`,
        );
      }
    }
  }

  // ── flags — presence (subset) ─────────────────────────────────────────────
  if (expected.flags) {
    for (const ef of expected.flags) {
      const found = (result.flags as unknown as Record<string, unknown>[]).some(af =>
        flagMatches(af, ef),
      );
      if (!found) {
        const sameKind = result.flags.filter(f => f.kind === ef.kind);
        throw new Error(
          `Expected flag not emitted — ${s.description}\n` +
            `  expected: ${JSON.stringify(ef)}\n` +
            `  actual flags of kind ${ef.kind}: ${JSON.stringify(sameKind, null, 2)}\n` +
            `  all actual flags: ${JSON.stringify(result.flags, null, 2)}`,
        );
      }
    }
  }

  // ── absentFlags — none of these may be emitted ────────────────────────────
  if (expected.absentFlags) {
    for (const ef of expected.absentFlags) {
      const hit = (result.flags as unknown as Record<string, unknown>[]).find(af =>
        flagMatches(af, ef),
      );
      if (hit) {
        throw new Error(
          `Flag should be absent but was emitted — ${s.description}\n` +
            `  forbidden: ${JSON.stringify(ef)}\n` +
            `  actual: ${JSON.stringify(hit)}`,
        );
      }
    }
  }

  // ── projectedWeights — partial (only listed classes) ──────────────────────
  if (expected.projectedWeights) {
    const want: Record<string, number> = {};
    const actual: Record<string, number> = {};
    for (const [ac, w] of Object.entries(expected.projectedWeights)) {
      want[ac] = round(w as number, 4);
      actual[ac] = round(result.projectedWeights[ac as AssetClass] ?? 0, 4);
    }
    expect(actual, `projectedWeights mismatch — ${s.description}`).toEqual(want);
  }

  // ── currentWeights — partial (pre-trade household allocation) ─────────────
  if (expected.currentWeights) {
    const want: Record<string, number> = {};
    const actual: Record<string, number> = {};
    for (const [ac, w] of Object.entries(expected.currentWeights)) {
      want[ac] = round(w as number, 4);
      actual[ac] = round(result.currentWeights[ac as AssetClass] ?? 0, 4);
    }
    expect(actual, `currentWeights mismatch — ${s.description}`).toEqual(want);
  }

  // ── nativeByAccount — per-account breakdown BEFORE trades (incl. idle cash) ─
  if (expected.nativeByAccount) {
    for (const [accountId, classes] of Object.entries(expected.nativeByAccount)) {
      const got = result.nativeValueByAccount[accountId] ?? {};
      for (const [ac, want] of Object.entries(classes as Record<string, number>)) {
        const actual = got[ac as AssetClass] ?? 0;
        expect(
          approxEq(actual, want),
          `nativeByAccount[${accountId}][${ac}] = ${actual.toFixed(2)}, expected ≈ ${want} — ${s.description}`,
        ).toBe(true);
      }
    }
  }

  // ── projectedNativeByAccount — per-account breakdown AFTER trades ──────────
  if (expected.projectedNativeByAccount) {
    for (const [accountId, classes] of Object.entries(expected.projectedNativeByAccount)) {
      const got = result.projectedNativeValueByAccount[accountId] ?? {};
      for (const [ac, want] of Object.entries(classes as Record<string, number>)) {
        const actual = got[ac as AssetClass] ?? 0;
        expect(
          approxEq(actual, want),
          `projectedNativeByAccount[${accountId}][${ac}] = ${actual.toFixed(2)}, expected ≈ ${want} — ${s.description}`,
        ).toBe(true);
      }
    }
  }

  // ── accountValueByAccount — per-account total balance (positions + idle cash) ─
  if (expected.accountValueByAccount) {
    for (const [accountId, want] of Object.entries(expected.accountValueByAccount)) {
      const got = result.nativeValueByAccount[accountId] ?? {};
      const total = ALL_ASSET_CLASSES.reduce((sum, ac) => sum + (got[ac] ?? 0), 0);
      expect(
        approxEq(total, want),
        `accountValueByAccount[${accountId}] = ${total.toFixed(2)}, expected ≈ ${want} — ${s.description}`,
      ).toBe(true);
    }
  }

  // ── netByAccount — balance-preserving invariant ───────────────────────────
  if (expected.netByAccount) {
    for (const [accountId, want] of Object.entries(expected.netByAccount)) {
      const net = result.trades
        .filter(t => t.accountId === accountId)
        .reduce((sum, t) => sum + t.deltaUsd, 0);
      // $2 slack absorbs proportional-split rounding.
      expect(
        Math.abs(net - want) <= 2,
        `netByAccount[${accountId}] = ${net.toFixed(2)}, expected ≈ ${want} — ${s.description}`,
      ).toBe(true);
    }
  }

  // ── tradeCountByAccount — actionable (non-zero) trade count ────────────────
  if (expected.tradeCountByAccount) {
    for (const [accountId, want] of Object.entries(expected.tradeCountByAccount)) {
      const count = result.trades.filter(
        t => t.accountId === accountId && round(t.deltaUsd, 2) !== 0,
      ).length;
      expect(
        count,
        `tradeCountByAccount[${accountId}] — ${s.description}`,
      ).toBe(want);
    }
  }

  // ── forbiddenTrades — account/class pairs that must not be traded ──────────
  if (expected.forbiddenTrades) {
    for (const fb of expected.forbiddenTrades) {
      const hit = result.trades.find(
        t =>
          t.accountId === fb.accountId &&
          t.assetClass === fb.assetClass &&
          round(t.deltaUsd, 2) !== 0,
      );
      if (hit) {
        throw new Error(
          `Forbidden trade was emitted — ${s.description}\n` +
            `  forbidden: ${JSON.stringify(fb)}\n` +
            `  actual: ${JSON.stringify(hit)}`,
        );
      }
    }
  }

  // ── projectedDriftWithinTolerance — derived boolean ───────────────────────
  if (expected.projectedDriftWithinTolerance !== undefined) {
    const relTol = s.strategy.toleranceRel ?? 0.25;
    const within = ALL_ASSET_CLASSES.every(ac => {
      const target = result.targetWeights[ac] ?? 0;
      const proj = result.projectedWeights[ac] ?? 0;
      const effTol = Math.min(s.strategy.toleranceAbs, relTol * target);
      return Math.abs(proj - target) <= effTol + 1e-9;
    });
    expect(
      within,
      `projectedDriftWithinTolerance mismatch — ${s.description}`,
    ).toBe(expected.projectedDriftWithinTolerance);
  }
}

if (byFolder.size === 0) {
  // Guard: if the glob ever silently matches nothing, fail loudly rather than
  // reporting a green suite with zero scenarios.
  describe('scenarios', () => {
    it('finds at least one *.scenario.json fixture', () => {
      expect(byFolder.size).toBeGreaterThan(0);
    });
  });
}

for (const [folder, cases] of [...byFolder.entries()].sort()) {
  describe(`Scenarios — ${folder}`, () => {
    it.each(cases)('$title', (c: Case) => {
      const parsed = scenarioSchema.safeParse(c.raw);
      if (!parsed.success) {
        throw new Error(
          `Scenario failed schema validation (${c.path}):\n${parsed.error.toString()}`,
        );
      }
      const s = parsed.data as Scenario;
      const result = rebalance(
        s.accounts as Account[],
        s.holdings as Position[],
        s.strategy as Strategy,
        s.tickerOverrides ?? {},
        s.decompositions ?? {},
        s.freeCash ?? 0,
        s.plannedWithdrawal ?? 0,
      );
      assertScenario(s, result);
    });
  });
}
