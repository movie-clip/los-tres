import path from 'node:path';

import { defineConfig } from 'vitest/config';

// This file must not import from tests/: `next build` in the Docker image type
// checks it, and .dockerignore leaves tests/ out of the build context.
const root = __dirname;
const alias = {
  '@': path.resolve(root, 'src'),
  'server-only': path.resolve(root, 'tests/support/server-only-stub.ts'),
};

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
          fileParallelism: false,
          // Creates ${DB_NAME}_test once.
          globalSetup: ['tests/support/global-setup.ts'],
          // Points DATABASE_URL at ${DB_NAME}_test in every worker, before any test.
          setupFiles: ['tests/support/test-database-env.ts'],
        },
      },
    ],
  },
});
