import { execSync } from 'child_process'
// vitest/config's defineConfig includes the `test` block in its options type;
// vite's own does not and rejects this config under tsc.
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import pkg from './package.json'

function gitSha(): string {
  try { return execSync('git rev-parse --short HEAD').toString().trim(); }
  catch { return 'unknown'; }
}

// A "release" build is a production build cut from the `stable` branch, per
// the repo's branch model (see the `/release` skill) — on Vercel that's
// VERCEL_GIT_COMMIT_REF === 'stable'. VITE_RELEASE_BUILD=1 is a manual
// override so a local release build (e.g. from the release skill) can opt
// in too. Everything else — local dev, PR previews, `main` — is not a
// release, even though it carries a real version + SHA (issue #200: the
// footer was claiming a release version on every build).
function isReleaseBuild(): boolean {
  if (process.env.VITE_RELEASE_BUILD === '1') return true;
  return process.env.VERCEL_GIT_COMMIT_REF === 'stable';
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __COMMIT_SHA__:  JSON.stringify(gitSha()),
    __IS_RELEASE__:  JSON.stringify(isReleaseBuild()),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Coverage is scoped to the pure engine — the only code with a
      // contractual obligation to PRINCIPLES.md. Thresholds start lenient.
      include: ['src/engine/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 80,
      },
    },
  },
})
