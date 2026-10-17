import { drizzle } from 'drizzle-orm/node-postgres';
import { Client, Pool } from 'pg';

import { runMigrations } from '../../src/db/migrate';
import { loadEnv, testDatabaseUrl, withDatabaseName } from './env';

const IDENTIFIER = /^[A-Za-z0-9_]+$/;

/**
 * Drops, recreates and migrates `${DB_NAME}_test` on the Compose `db` service
 * on every integration run (TD-37). Dropping each time means the suite always
 * proves the migrations apply from nothing and never carries a stale schema.
 * Integration tests run only against that database. On failure the message
 * names host, port and the fix, never the URL or the password.
 */
export default async function setup(): Promise<void> {
  loadEnv();
  const testUrl = new URL(testDatabaseUrl());
  const testName = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
  if (!IDENTIFIER.test(testName) || !testName.endsWith('_test')) {
    throw new Error('Test database name is not a plain _test identifier');
  }

  const client = new Client({
    connectionString: withDatabaseName(testUrl.toString(), 'postgres'),
    connectionTimeoutMillis: 3000,
  });
  try {
    await client.connect();
  } catch {
    throw new Error(
      `Cannot reach PostgreSQL at ${testUrl.hostname}:${testUrl.port || '5432'}. Run: npm run db:up`,
    );
  }
  try {
    await client.query(`drop database if exists "${testName}" with (force)`);
    await client.query(`create database "${testName}"`);
  } finally {
    await client.end();
  }

  const pool = new Pool({ connectionString: testUrl.toString() });
  try {
    await runMigrations(drizzle({ client: pool }));
  } catch {
    // A driver or migration message can carry the URL: say only what to do.
    throw new Error('Migrating the test database failed: check src/db/migrations (npm run db:generate)');
  } finally {
    await pool.end();
  }
}
