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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
