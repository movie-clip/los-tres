import { existsSync } from 'node:fs';

import { defineConfig, devices } from '@playwright/test';

// This file must not import from tests/: `next build` in the Docker image type
// checks it, and .dockerignore leaves tests/ out of the build context. The
// same rule lives in tests/support/env.ts `appBaseUrl()`; keep them equal.
if (existsSync('.env')) process.loadEnvFile('.env');
const baseURL =
  process.env.E2E_BASE_URL?.trim().replace(/\/$/, '') ||
  `http://127.0.0.1:${process.env.APP_PORT?.trim() || '3000'}`;

// No webServer: the Compose stack is the server under test (npm run stack:up).
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: true,
  reporter: [['list']],
  use: { baseURL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
