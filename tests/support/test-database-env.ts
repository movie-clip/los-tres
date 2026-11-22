import { inject } from 'vitest';

import { developmentDatabaseUrl, workerDatabaseUrl } from './env';

// Each integration worker sees only its own database, `<db>_w<VITEST_POOL_ID>_test`,
// cloned from the migrated template by the global setup (C-10, S2). A missing or
// out-of-range worker id throws a named error and never yields a URL.
process.env.DATABASE_URL = workerDatabaseUrl(
  developmentDatabaseUrl(),
  process.env.VITEST_POOL_ID,
  inject('integrationWorkers'),
);

// The admin area needs a signing secret and the site origin (US-2.1). The local
// .env may predate them, so integration tests use fixed test values and never
// read the real ones. The secret is long enough for src/config/auth.ts.
process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef0123456789abcdef';
process.env.SITE_URL = 'http://127.0.0.1:3000';
