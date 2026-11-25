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

// The specs that write the main e2e database (#363, #339): SQL through `psql`, a verb that writes
// (`import-feeds`, `create-admin`, `seed`, `migrate`) in the `app` service, or an admin form that saves.
// They run in `serial`, one worker, after every `chromium` spec has finished, so nothing reads the main
// e2e database beside a write. Rule: a spec that writes the main e2e database is serial, and leaves the
// database as it found it in what the other specs read (no approved feed or shop it created, no hidden
// demo item, no changed demo mapping). A spec that only runs verbs in `app-no-db`, or writes only the
// database of a variant app (`app-flag-off`, `app-flag-on`), is not serial. tests/unit/gate-determinism.test.ts
// keeps this list and the specs in step.
const SERIAL_SPECS = ['admin', 'admin-categories', 'admin-feeds', 'admin-products', 'catalogue-file-flow'];
const SERIAL = new RegExp(`(^|[\\\\/])(${SERIAL_SPECS.join('|')})\\.spec\\.ts$`);

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
  // Two projects, one after the other (#363). `chromium` holds every spec that does not write the main e2e
  // database, in parallel. `serial` holds the specs that write it, on a single worker, after `chromium`: an
  // approved feed or a hidden demo product would otherwise be counted by a spec that reads the database in
  // parallel. No spec starts or stops a container (the stack is up before the first test), so nothing
  // changes a network interface under a page load.
  projects: [
    {
      name: 'chromium',
      testIgnore: SERIAL,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'serial',
      testMatch: SERIAL,
      dependencies: ['chromium'],
      workers: 1,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
