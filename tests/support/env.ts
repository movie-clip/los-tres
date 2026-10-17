import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Loads the repo's `.env` into `process.env` when the file exists (Node 22,
 * no dotenv). Variables already set in the process win over the file.
 */
export function loadEnv(): void {
  const file = path.resolve(process.cwd(), '.env');
  if (existsSync(file)) {
    process.loadEnvFile(file);
  }
}

/** Replaces the database name in a connection URL. Pure; never logs the URL. */
export function withDatabaseName(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/** `DATABASE_URL` pointing at `${database}_test`. The name is derived, never configured. */
export function testDatabaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set (run npm run env:init)');
  }
  const database = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL has no database name');
  }
  return withDatabaseName(url, `${database}_test`);
}

/** Where the Compose `app` answers: `E2E_BASE_URL`, else `http://127.0.0.1:${APP_PORT}`. */
export function appBaseUrl(): string {
  loadEnv();
  const explicit = process.env.E2E_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const port = process.env.APP_PORT?.trim() || '3000';
  return `http://127.0.0.1:${port}`;
}

/** Where Umami answers: `http://127.0.0.1:${UMAMI_PORT}`. */
export function umamiBaseUrl(): string {
  loadEnv();
  return `http://127.0.0.1:${process.env.UMAMI_PORT?.trim() || '3001'}`;
}
