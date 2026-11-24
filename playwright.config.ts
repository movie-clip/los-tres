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
// --grep-invert (test:e2e:ci) is not applied to them, so `chromium` and `containers`, the
// dependencies of `catalogue-file`, would run every @layout test. The same
// pattern is passed to those projects here, read from the command line.
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
// Specs that create or remove a container (docker/compose run, docker rm, startIsolatedApp,
// createAdminWithCommand). They run in `containers`, one worker, after `chromium` (#361): a container's
// start or stop changes a network interface, and Chromium cancels the page loads waiting on a socket
// when that happens, so no browser test may load a page beside one. tests/unit/gate-determinism.test.ts
// keeps this list and the specs that start containers in step.
const CONTAINER_SPECS = [
  'admin', 'admin-categories', 'admin-feeds', 'admin-products', 'admin-sources',
  'car-header-error', 'collected-admin', 'collected-public', 'collected-start',
  'entrypoint', 'search-privacy',
];
const CONTAINERS = new RegExp(`(^|[\\\\/])(${CONTAINER_SPECS.join('|')})\\.spec\\.ts$`);

// No webServer: the Compose stack is the server under test (npm run stack:up).
export default defineConfig({
  testDir: 'tests/e2e',
  // A string path, never an import (see the note above). Runs the Compose
  // import once so the product pages have data; tests never write the dev DB.
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  // #361: a failed run keeps a trace and a screenshot in test-results/ (git- and docker-ignored);
  // the CI workflows upload that folder when the gate fails. A passing test keeps nothing. Retries
  // stay at their default of 0 (0006 rule 6).
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  // Three projects, one after the other (#361). `chromium` holds every spec that starts no container.
  // `containers` holds the specs that create or remove one, on a single worker, so a container's start
  // or stop never lands beside another test's page load. The catalogue-file flow (S3.7) approves a feed
  // of its own and imports it, so it runs last, in a project that starts only after every other spec has
  // finished: an `import-feeds` of `entrypoint.spec.ts`, or a spec that counts feeds or public
  // products, would otherwise see that approved feed. It leaves its feed and shop unapproved when it ends.
  projects: [
    {
      name: 'chromium',
      testIgnore: [CATALOGUE_FLOW, CONTAINERS],
      grepInvert: cliGrepInvert(),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'containers',
      testMatch: CONTAINERS,
      dependencies: ['chromium'],
      workers: 1,
      grepInvert: cliGrepInvert(),
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'catalogue-file',
      testMatch: CATALOGUE_FLOW,
      dependencies: ['containers'],
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
