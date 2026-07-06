// @vitest-environment jsdom
//
// Regression coverage for issue #200: the footer previously rendered
// `v{__APP_VERSION__} ({__COMMIT_SHA__})` on every build, which falsely
// claimed a tagged release version on non-release builds (local dev, PR
// previews, `main`). __IS_RELEASE__ (vite.config.ts) is only true for a
// production build cut from the `stable` branch (or with the manual
// VITE_RELEASE_BUILD=1 override) — see the fix in src/App.tsx's footer.
//
// __IS_RELEASE__ is a compile-time constant substituted via vite's `define`
// (same as __APP_VERSION__ / __COMMIT_SHA__), so it can't be flipped per-test
// with vi.stubGlobal — the literal is already inlined into the compiled
// module. The test environment never sets VERCEL_GIT_COMMIT_REF=stable or
// VITE_RELEASE_BUILD, so __IS_RELEASE__ is false here, matching real
// dev/CI/preview builds — exactly the case this bug affected.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildState, saveState } from './store';
import { DEFAULT_STRATEGY } from './engine/strategy';
import type { Account, Position } from './engine/types';
// Warm the App module graph at collect time (see App.demo-mode.test.tsx, #175).
import './App';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const REAL_ACCOUNT: Account = {
  id: 'real1', name: 'My Real Brokerage', institution: 'Schwab', type: 'TAXABLE',
};
const REAL_POSITION: Position = { accountId: 'real1', ticker: 'VTI', marketValue: 1000 };

let container: HTMLDivElement;
let root: Root | null = null;

function seedRealPortfolio(): void {
  saveState(buildState([REAL_ACCOUNT], [REAL_POSITION], DEFAULT_STRATEGY, {}));
}

async function renderApp(): Promise<void> {
  const { default: App } = await import('./App');
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root!.render(<App />); });
}

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(async () => {
  if (root) { await act(async () => { root!.unmount(); }); root = null; }
  container?.remove();
});

describe('#200 — footer does not claim a release version on non-release builds', () => {
  it('renders "dev (sha)" instead of a version number when __IS_RELEASE__ is false', async () => {
    seedRealPortfolio();
    await renderApp();
    const footer = document.querySelector('footer');
    expect(footer, 'footer not found').toBeTruthy();
    const text = footer!.textContent ?? '';

    // Never claims a version number on a non-release build.
    expect(text).not.toMatch(/v\d+\.\d+\.\d+/);

    // Shows the "dev" tag, with the commit sha in parens unless it's unknown.
    if (__COMMIT_SHA__ && __COMMIT_SHA__ !== 'unknown') {
      expect(text).toContain(`dev (${__COMMIT_SHA__})`);
    } else {
      expect(text).toContain('dev');
      expect(text).not.toMatch(/dev \(/);
    }
  });
});
