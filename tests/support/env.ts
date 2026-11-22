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

/** The database name in a connection URL, without its leading slash. Pure. */
export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
}

// Integration databases (S2, #336). `base` is the development database name
// from DATABASE_URL (`DB_NAME`). The template and one clone per Vitest worker
// all end in `_test`, so `assertTestDatabase` and the global setup's name check
// still apply. The old single `<base>_test` is no longer used: global setup
// drops it if a previous version left it behind.
const PLAIN_NAME = /^[A-Za-z0-9_]+$/;
const WORKER_SUFFIX = /_w[0-9]+_test$/;
// PostgreSQL truncates an identifier at 63 bytes, which would make two names collide.
const MAX_NAME_LENGTH = 63;

function checkedName(name: string): string {
  if (!PLAIN_NAME.test(name) || name.length > MAX_NAME_LENGTH) {
    throw new Error('Test database name is not a plain identifier of at most 63 characters');
  }
  return name;
}

/** `<base>_tpl_test`: the migrated template every worker database is cloned from. */
export function templateDatabaseName(base: string): string {
  return checkedName(`${base}_tpl_test`);
}

/** `<base>_w<n>_test` for worker n. Throws unless n is a positive integer. */
export function workerDatabaseName(base: string, worker: number): string {
  if (!Number.isInteger(worker) || worker < 1) {
    throw new Error('Integration worker number must be a positive integer');
  }
  return checkedName(`${base}_w${worker}_test`);
}

/** True for the databases global setup owns and may drop: the template, any worker clone and the old `<base>_test`. */
export function isIntegrationDatabase(name: string, base: string): boolean {
  if (name === `${base}_test` || name === `${base}_tpl_test`) return true;
  if (!name.startsWith(`${base}_w`) || !name.endsWith('_test')) return false;
  return /^[0-9]+$/.test(name.slice(`${base}_w`.length, name.length - '_test'.length));
}

/**
 * The worker number from `VITEST_POOL_ID`. Throws, naming the id and N and never
 * a URL, when it is missing, not a positive integer, or above `workers` (when given).
 */
export function parseWorkerId(raw: string | undefined, workers?: number): number {
  const id = raw !== undefined && /^[1-9][0-9]*$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(id) || (workers !== undefined && id > workers)) {
    const shown = raw === undefined || raw === '' ? 'unknown' : raw.slice(0, 20);
    throw new Error(`integration worker ${shown} has no database; N=${workers ?? 'unknown'}`);
  }
  return id;
}

/** `DATABASE_URL`, loaded from `.env` when the process lacks it. The URL is never echoed. */
export function developmentDatabaseUrl(): string {
  loadEnv();
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error('DATABASE_URL is not set (run npm run env:init)');
  }
  if (!databaseNameOf(url)) {
    throw new Error('DATABASE_URL has no database name');
  }
  return url;
}

/**
 * The development database name behind a URL. A URL that already names a worker
 * database (a worker process that kept its environment between files) maps back
 * to the same base, so deriving twice gives the same answer.
 */
export function baseDatabaseName(url: string): string {
  return databaseNameOf(url).replace(WORKER_SUFFIX, '');
}

/** The worker's own database URL: `url` with its database replaced by `<base>_w<id>_test`. */
export function workerDatabaseUrl(url: string, rawWorkerId: string | undefined, workers: number): string {
  const worker = parseWorkerId(rawWorkerId, workers);
  return withDatabaseName(url, workerDatabaseName(baseDatabaseName(url), worker));
}

/**
 * The only database this worker may write to, derived from its own
 * `VITEST_POOL_ID` and the base name in `url`. Throws when the id is missing or
 * invalid, so a helper outside a Vitest worker has no database at all.
 */
export function expectedWorkerDatabase(url: string, rawWorkerId: string | undefined): string {
  const worker = parseWorkerId(rawWorkerId);
  return workerDatabaseName(baseDatabaseName(url), worker);
}
