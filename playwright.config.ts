import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

// This file must not import from tests/: `next build` in the Docker image type
// checks it, and .dockerignore leaves tests/ out of the build context. The
// base URL is computed here and nowhere else: specs use the `baseURL` and
// `request` fixtures, never their own copy of the rule.
if (existsSync('.env')) process.loadEnvFile('.env');
const baseURL =
  process.env.E2E_BASE_URL?.trim().replace(/\/$/, '') ||
  `http://127.0.0.1:${process.env.APP_PORT?.trim() || '3010'}`;

// Playwright runs the projects another project depends on in full: the CLI
// --grep-invert (test:e2e:ci) is not applied to them, so `chromium`, a
// dependency of `catalogue-file`, would run every @layout test. The same
// pattern is passed to that project here, read from the command line.
function cliGrepInvert(): RegExp | undefined {
  const args = process.argv;
  const i = args.findIndex((a) => a === '--grep-invert' || a === '-gv');
  const eq = args.find((a) => a.startsWith('--grep-invert='));
  const value = eq
    ? eq.slice('--grep-invert='.length)
    : i >= 0
      ? args[i + 1]
      : undefined;
  return value ? new RegExp(value) : undefined;
}

const CATALOGUE_FLOW = /catalogue-file-flow\.spec\.ts$/;

// No webServer: the Compose stack is the server under test (npm run stack:up).
export default defineConfig({
  testDir: 'tests/e2e',
  // A string path, never an import (see the note above). Runs the Compose
  // import once so the product pages have data; tests never write the dev DB.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  use: { baseURL },
  // The catalogue-file flow (S3.7) approves a feed of its own and imports it, so it runs in a second
  // project that starts only after every other spec has finished: an `import-feeds` of
  // `entrypoint.spec.ts`, or a spec that counts feeds or public products, would otherwise see
  // that approved feed. It leaves its feed and shop unapproved when it ends.
  projects: [
    {
      name: 'chromium',
      testIgnore: CATALOGUE_FLOW,
      grepInvert: cliGrepInvert(),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'catalogue-file',
      testMatch: CATALOGUE_FLOW,
      dependencies: ['chromium'],
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
