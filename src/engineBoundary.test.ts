// D9 guard (spec-account-linking §2): `src/engine/` is one implementation that runs
// in the browser now and on the server later, so it must import nothing
// environment-specific — no React, DOM, Supabase, Node built-ins, network or storage.
//
// This test reads the engine's sources (and every file they reach through relative
// imports) as text and fails on:
//   1. any bare package import other than ALLOWED_PACKAGES ('vitest' only in tests);
//   2. any use of environment globals (fetch, window, document, localStorage, …)
//      in non-test code.
// It lives outside src/engine/ so the engine itself stays free of the loader it uses.
// Runs in CI as part of `npm test`.

import { describe, it, expect } from 'vitest';

const SOURCES = import.meta.glob(['./**/*.ts', './**/*.tsx', '!./**/*.d.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>;

const ALLOWED_PACKAGES = new Set(['zod']);
const TEST_ONLY_PACKAGES = new Set(['vitest']);

const FORBIDDEN_GLOBALS = [
  'fetch', 'window', 'document', 'navigator', 'location', 'history',
  'localStorage', 'sessionStorage', 'indexedDB', 'XMLHttpRequest', 'WebSocket',
  'EventSource', 'process', 'require', 'Buffer', '__dirname', '__filename',
  'globalThis', 'self', 'Deno', 'Bun',
];

const isTest = (path: string) => /\.test\.tsx?$/.test(path);

/** Blank out comments and string/template literals (keeping offsets roughly), so
 *  prose and messages can't trip the identifier check. */
function stripCommentsAndStrings(src: string): string {
  return src.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g,
    m => (m.startsWith('/') ? ' ' : '""'),
  );
}

/** Module specifiers from import/export-from statements and dynamic import(). */
export function importSpecifiers(src: string): string[] {
  const out: string[] = [];
  const re = /\b(?:import|export)\s+(?:type\s+)?(?:[\w*{}\s,$]+?\s+from\s+)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of src.matchAll(re)) out.push(m[1] ?? m[2]);
  return out;
}

/** Environment globals used as identifiers (not as `.property` or `key:`). */
export function forbiddenGlobals(src: string): string[] {
  const code = stripCommentsAndStrings(src);
  const found = new Set<string>();
  for (const name of FORBIDDEN_GLOBALS) {
    const re = new RegExp(`(?<![\\w$.])${name}(?![\\w$])(?!\\s*:(?!:))`);
    if (re.test(code)) found.add(name);
  }
  return [...found];
}

function resolveRelative(from: string, spec: string): string | null {
  const dir = from.split('/').slice(0, -1);
  for (const part of spec.split('/')) {
    if (part === '.' || part === '') continue;
    if (part === '..') dir.pop(); else dir.push(part);
  }
  const base = dir.join('/');
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (candidate in SOURCES) return candidate;
  }
  return null; // JSON data and other non-code assets
}

describe('engine boundary (D9)', () => {
  const engineFiles = Object.keys(SOURCES).filter(p => p.startsWith('./engine/'));

  it('finds the engine sources', () => {
    expect(engineFiles.length).toBeGreaterThan(10);
  });

  it('src/engine/ and everything it imports use no environment-specific packages or globals', () => {
    const violations: string[] = [];
    const seen = new Set<string>();
    const queue = [...engineFiles];
    while (queue.length > 0) {
      const file = queue.shift()!;
      if (seen.has(file)) continue;
      seen.add(file);
      const src = SOURCES[file];
      for (const spec of importSpecifiers(src)) {
        if (spec.startsWith('.')) {
          const target = resolveRelative(file, spec);
          if (target) queue.push(target);
          continue;
        }
        const pkg = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
        if (ALLOWED_PACKAGES.has(pkg)) continue;
        if (isTest(file) && TEST_ONLY_PACKAGES.has(pkg)) continue;
        violations.push(`${file}: imports "${spec}"`);
      }
      if (!isTest(file)) {
        for (const g of forbiddenGlobals(src)) violations.push(`${file}: uses "${g}"`);
      }
    }
    expect(violations).toEqual([]);
  });
});

describe('engine boundary checker', () => {
  it('detects forbidden imports', () => {
    const src = [
      "import React from 'react';",
      "import { createClient } from '@supabase/supabase-js';",
      "import fs from 'node:fs';",
      "import type { X } from './types';",
      "export { y } from '../ingest/schema';",
      "const m = await import('path');",
    ].join('\n');
    expect(importSpecifiers(src)).toEqual([
      'react', '@supabase/supabase-js', 'node:fs', './types', '../ingest/schema', 'path',
    ]);
  });

  it('detects environment globals but not properties, keys, comments or strings', () => {
    expect(forbiddenGlobals('const r = await fetch(url); localStorage.getItem("k");').sort())
      .toEqual(['fetch', 'localStorage']);
    expect(forbiddenGlobals('if (typeof window !== "undefined") {}')).toEqual(['window']);
    expect(forbiddenGlobals([
      'const o = { process: 1, history: [] };',
      'o.process; o.history.push(1);',
      '// fetch the window from localStorage',
      'const s = "process document";',
      'const t = `require ${1}`;',
      'const fetched = 1; const windowSize = 2;',
    ].join('\n'))).toEqual([]);
  });
});
