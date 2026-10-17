import { testDatabaseUrl } from './env';

// Integration tests only ever see the `_test` database (C-10).
process.env.DATABASE_URL = testDatabaseUrl();
