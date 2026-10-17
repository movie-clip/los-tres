import { Client } from 'pg';

import { loadEnv, testDatabaseUrl, withDatabaseName } from './env';

const IDENTIFIER = /^[A-Za-z0-9_]+$/;

/**
 * Creates `${DB_NAME}_test` on the Compose `db` service when it is missing.
 * Integration tests run only against that database. On failure the message
 * names host, port and the fix, never the URL or the password.
 */
export default async function setup(): Promise<void> {
  loadEnv();
  const testUrl = new URL(testDatabaseUrl());
  const testName = decodeURIComponent(testUrl.pathname.replace(/^\//, ''));
  if (!IDENTIFIER.test(testName)) {
    throw new Error('Test database name has unsupported characters');
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
    const found = await client.query('select 1 from pg_database where datname = $1', [testName]);
    if (found.rowCount === 0) {
      await client.query(`create database "${testName}"`);
    }
  } finally {
    await client.end();
  }
}
