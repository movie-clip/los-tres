import 'server-only';

import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

// Relative on purpose: the CLI is compiled by tsc, which does not rewrite `@/`.
import { getDatabaseUrl } from '../config/env';

/** The Drizzle database over a pg Pool. */
export type Database = NodePgDatabase & { $client: Pool };

/**
 * What a query needs: the database itself or a transaction on it. The importer,
 * the seed and the matcher take this so each runs inside or outside one.
 */
export type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete' | 'execute'>;

let cached: Database | undefined;

/**
 * The Drizzle instance over a pg Pool. Created on the first call and cached;
 * importing this module opens no connection, so `next build` needs no
 * database (TD-5). Nothing here logs the URL, the password or a driver
 * message (TD-13).
 */
export function getDb(): Database {
  if (!cached) {
    const pool = new Pool({
      connectionString: getDatabaseUrl(),
      connectionTimeoutMillis: 2000,
    });
    // An idle client can fail (database stopped). Without a listener the
    // process would crash on the emitted 'error'. Swallow it: the next query
    // reports the failure to its caller.
    pool.on('error', () => {});
    cached = drizzle({ client: pool });
  }
  return cached;
}

/** Ends the pool and clears the cache. Tests call it in `afterAll`. */
export async function closeDb(): Promise<void> {
  const db = cached;
  cached = undefined;
  if (db) {
    await db.$client.end();
  }
}
