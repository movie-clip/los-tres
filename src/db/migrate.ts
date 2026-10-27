import path from 'node:path';

import { migrate } from 'drizzle-orm/node-postgres/migrator';

import { ensureFixedCategoryTree } from './category-tree';
import type { Database } from './client';

/**
 * Applies every pending migration in src/db/migrations, relative to the
 * working directory (the repo root on the host, /app in the image), then makes
 * the fixed category tree exist (S4.0). Applying twice is a no-op: the tree is
 * an upsert, so the same six rows keep their ids. Imports no `server-only` and
 * no client, so the test global setup calls this same function on its own
 * database.
 */
export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), 'src/db/migrations') });
  await ensureFixedCategoryTree(db);
}
