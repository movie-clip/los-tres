import { testDatabaseUrl } from './env';

// Integration tests only ever see the `_test` database (C-10).
process.env.DATABASE_URL = testDatabaseUrl();

// The admin area needs a signing secret and the site origin (US-2.1). The local
// .env may predate them, so integration tests use fixed test values and never
// read the real ones. The secret is long enough for src/config/auth.ts.
process.env.AUTH_SECRET = 'test-auth-secret-0123456789abcdef0123456789abcdef';
process.env.SITE_URL = 'http://127.0.0.1:3000';
