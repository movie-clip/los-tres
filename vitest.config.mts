import { availableParallelism } from 'node:os';
import path from 'node:path';

import { defineConfig } from 'vitest/config';

// This file must not import from tests/: `next build` in the Docker image type
// checks it, and .dockerignore leaves tests/ out of the build context.
const root = import.meta.dirname;
export const alias = {
  '@': path.resolve(root, 'src'),
  'server-only': path.resolve(root, 'tests/support/server-only-stub.ts'),
};

/**
 * How many integration workers, and so databases, a run uses (S2, #336):
 * `INTEGRATION_WORKERS` when set, else `min(8, cpus - 1)`, never below 1. A
 * value that is not a positive whole number throws instead of falling back, so
 * a typo cannot silently change the run. Exported for its unit test.
 */
export function integrationWorkers(
  env: Record<string, string | undefined> = process.env,
  cpus: number = availableParallelism(),
): number {
  const raw = env.INTEGRATION_WORKERS?.trim();
  if (raw) {
    if (!/^[1-9][0-9]*$/.test(raw)) {
      throw new Error('INTEGRATION_WORKERS must be a positive whole number');
    }
    return Number(raw);
  }
  return Math.min(8, Math.max(1, cpus - 1));
}

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          include: ['tests/unit/**/*.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'integration',
          include: ['tests/integration/**/*.test.ts'],
          // One database per worker, so files run in parallel. Vitest numbers the
          // workers 1..maxWorkers (VITEST_POOL_ID) and a distinct groupOrder keeps
          // that range separate from the unit project's.
          maxWorkers: integrationWorkers(),
          sequence: { groupOrder: 1 },
          // Drops and migrates ${DB_NAME}_tpl_test, then clones it to
          // ${DB_NAME}_w<n>_test for n = 1..maxWorkers, once per run.
          globalSetup: ['tests/support/global-setup.ts'],
          // Points DATABASE_URL at the worker's own ${DB_NAME}_w<n>_test before any test.
          setupFiles: ['tests/support/test-database-env.ts'],
        },
      },
    ],
  },
});
