import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import type { Database } from './client';

/**
 * Applies every pending migration in src/db/migrations, relative to the
 * working directory (the repo root on the host, /app in the image). Applying
 * twice is a no-op. Imports no `server-only` and no client, so the test global
 * setup calls this same function on its own database.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations') });
}
