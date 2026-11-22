import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';
import type { TestProject } from 'vitest/node';

import { runMigrations } from '../../src/db/migrate';
import {
  baseDatabaseName,
  developmentDatabaseUrl,
  isIntegrationDatabase,
  templateDatabaseName,
  withDatabaseName,
  workerDatabaseName,
} from './env';

// The worker count travels to every worker's setup file through `provide`, so a
// worker can tell "no database for this id" from a working one.
declare module 'vitest' {
  export interface ProvidedContext {
    integrationWorkers: number;
  }
}

function quoted(name: string): string {
  return `"${name}"`;
}

/**
 * Once per integration run, on the Compose `db` service (TD-37, S2):
 * drops every database this suite owns (the template, any `_w<n>_test` clone
 * and the old single `_test`), migrates `<db>_tpl_test` from nothing, then
 * clones it once per Vitest worker as `<db>_w<n>_test`. N is the project's
 * resolved `maxWorkers`. Dropping each run means the suite always proves the
 * migrations apply from nothing and never carries a stale schema. The clones
 * stay after the run for inspection and the next run drops them. The drop
 * matches `isIntegrationDatabase` only, so it never touches the development
 * database or the throwaway databases `startIsolatedApp` creates. On failure
 * the message names host, port and the fix, never the URL or the password.
 */
export default async function setup(project: TestProject): Promise<void> {
  const workers = project.config.maxWorkers;
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error('Integration worker count is not a positive integer');
  }

  const developmentUrl = developmentDatabaseUrl();
  const base = baseDatabaseName(developmentUrl);
  const template = templateDatabaseName(base);
  const workerNames = Array.from({ length: workers }, (_, index) => workerDatabaseName(base, index + 1));

  const client = new Client({
    connectionString: withDatabaseName(developmentUrl, 'postgres'),
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
  } catch {
    const parsed = new URL(developmentUrl);
    throw new Error(`Cannot reach PostgreSQL at ${parsed.hostname}:${parsed.port || '5432'}. Run: npm run db:up`);
  }
  try {
    const existing = await client.query<{ datname: string }>('select datname from pg_database');
    for (const { datname } of existing.rows) {
      if (isIntegrationDatabase(datname, base)) {
        await client.query(`drop database if exists ${quoted(datname)} with (force)`);
      }
    }
    await client.query(`create database ${quoted(template)}`);

    const pool = new Pool({ connectionString: withDatabaseName(developmentUrl, template) });
    try {
      await runMigrations(drizzle({ client: pool }));
    } catch {
      // A driver or migration message can carry the URL: say only what to do.
      throw new Error('Migrating the test database failed: check src/db/migrations (npm run db:generate)');
    } finally {
      await pool.end();
    }

    // `create database ... template` needs no other session on the template. The
    // pool has ended, but its backends can take a moment to exit.
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const sessions = await client.query<{ n: string }>(
        'select count(*) as n from pg_stat_activity where datname = $1',
        [template],
      );
      if (sessions.rows[0]?.n === '0') break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // One at a time: concurrent clones of one template race on its sessions.
    for (const name of workerNames) {
      await client.query(`create database ${quoted(name)} template ${quoted(template)}`);
    }
  } finally {
    await client.end();
  }

  project.provide('integrationWorkers', workers);
}
