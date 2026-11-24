import { existsSync } from 'node:fs';
import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

// This file must not import from tests/: `next build` in the Docker image type
// checks it, and .dockerignore leaves tests/ out of the build context. The
// e2e stack identity and the base URL are computed here and nowhere else:
// specs use the `baseURL` and `request` fixtures, never their own copy of the
// rule, and every `docker compose` call (setup, teardown, helpers, specs)
// inherits the environment set below (#363, tests/support/e2e-stack.ts).
if (existsSync('.env')) process.loadEnvFile('.env');

// The e2e run builds, starts and removes a Compose project of its own, `los-tres-e2e`, from compose.yaml
// plus tests/e2e/compose.e2e.yaml. It never touches the development stack (`los-tres`, `name:` in
// compose.yaml): the project name is assigned here, after `.env`, whatever the shell holds.
process.env.COMPOSE_PROJECT_NAME = 'los-tres-e2e';
process.env.COMPOSE_PATH_SEPARATOR = path.delimiter;
process.env.COMPOSE_FILE = [path.resolve('compose.yaml'), path.resolve('tests/e2e/compose.e2e.yaml')].join(path.delimiter);

if (process.env.E2E_BASE_URL?.trim()) {
  throw new Error('e2e config: E2E_BASE_URL is no longer read; the e2e run starts its own stack (#363). Remove it from .env');
}

// Four consecutive loopback ports: the app, then three variant apps (no database, local flag off, local
// flag on). Only E2E_APP_PORT is configurable; the other three are always computed from it.
const e2eAppPort = Number(process.env.E2E_APP_PORT?.trim() || '3020');
if (!Number.isInteger(e2eAppPort) || e2eAppPort < 1024 || e2eAppPort > 65532) {
  throw new Error('e2e config: E2E_APP_PORT must be a whole number from 1024 to 65532');
}
const e2ePorts = [e2eAppPort, e2eAppPort + 1, e2eAppPort + 2, e2eAppPort + 3];
const developmentPorts = [Number(process.env.APP_PORT?.trim() || '3010'), Number(process.env.DB_HOST_PORT?.trim() || '5433')];
const taken = e2ePorts.find((port) => developmentPorts.includes(port));
if (taken !== undefined) {
  throw new Error(`e2e config: E2E_APP_PORT=${e2eAppPort} uses port ${taken}, which the development stack uses; set E2E_APP_PORT in .env`);
}
process.env.E2E_APP_PORT = String(e2ePorts[0]);
process.env.E2E_NO_DB_PORT = String(e2ePorts[1]);
process.env.E2E_FLAG_OFF_PORT = String(e2ePorts[2]);
process.env.E2E_FLAG_ON_PORT = String(e2ePorts[3]);
const baseURL = `http://127.0.0.1:${e2ePorts[0]}`;

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

// No webServer: the e2e Compose project is the server under test, started by the global setup.
export default defineConfig({
  testDir: 'tests/e2e',
  // String paths, never imports (see the note above). The setup builds and starts the e2e project, imports
  // the demo feeds and creates the one admin; the teardown removes the project with its volume. Playwright
  // registers the teardown before it runs the setup, so it also runs when the setup throws and on Ctrl-C.
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',
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
