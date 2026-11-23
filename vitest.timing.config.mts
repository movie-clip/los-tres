import { defineConfig } from 'vitest/config';

// The same rule as vitest.config.mts: this file must not import from tests/
// (`next build` type-checks it in the Docker image, and .dockerignore leaves
// tests/ out of the build context). `.mjs` is the TypeScript spelling of the
// `.mts` neighbour, which needs no allowImportingTsExtensions.
import { alias } from './vitest.config.mjs';

// `npm run test:timing` (no-clock-in-gate, S-1): the real timings of the two
// PostgreSQL cost tests, on demand. No gate step runs this config, and the
// `unit` and `integration` projects of vitest.config.mts do not include
// tests/timing, so the gate asserts no time. One worker, one file at a time, so
// nothing else competes for the CPU while a call is measured; the setup is the
// integration one (one migrated template, one clone, `<db>_w1_test`), pinned
// equal to vitest.config.mts by tests/unit/gate-determinism.test.ts. It must not
// run while another integration run is going: its global setup drops every
// integration database, as any Vitest run does.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'timing',
          include: ['tests/timing/**/*.timing.test.ts'],
          maxWorkers: 1,
          fileParallelism: false,
          globalSetup: ['tests/support/global-setup.ts'],
          setupFiles: ['tests/support/test-database-env.ts'],
        },
      },
    ],
  },
});
