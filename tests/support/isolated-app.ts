import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

import { unusedPort } from './net';

// An app container of its own, on a database of its own, for an e2e spec that must CHANGE what the
// public site shows (a hide, for example) without a single parallel spec seeing it. The Compose `app`
// serves the development database that every other spec reads at the same time, so a demo product
// hidden there flakes their counts; a product added there flakes `admin-categories.spec.ts`'s demo
// fingerprint. Here the same image runs against a fresh database on the Compose `db` service, seeded
// with the demo data and imported once, and both are removed when the spec ends. The development
// database is never touched.

type Run = { status: number | null; out: string };

function docker(args: string[], options: { input?: string; timeout?: number } = {}): Run {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    timeout: options.timeout ?? 120_000,
    maxBuffer: 256 * 1024 * 1024,
    input: options.input,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

export type IsolatedApp = {
  /** `http://127.0.0.1:<port>`: the address the app is reached at, and its SITE_URL unless `options.env` overrides it (then an admin sign-in from it is not same-origin). */
  origin: string;
  /** The container's output so far (stdout and stderr). */
  logs(): string;
  /** One SQL statement on the isolated database. */
  psql(statement: string): string;
  /** One SQL query on the isolated database; its single value, trimmed. */
  psqlScalar(statement: string): string;
  /** Creates (or resets the password of) an admin on the isolated database. */
  createAdmin(email: string, password: string): void;
  /** Removes the container and drops the database. Safe to call twice. */
  stop(): void;
};

export type IsolatedAppOptions = {
  /**
   * Extra container environment, passed as `-e NAME=value` to the app, the import and `create-admin`
   * (S12.2: `{ LOCAL_COLLECTED_DATA: 'true' }` starts the app with the local flag on beside its
   * loopback SITE_URL; `{ LOCAL_COLLECTED_DATA: 'false', SITE_URL: 'https://...' }` starts it with the flag off
   * beside a public origin). A later `-e` wins, so SITE_URL can be overridden; the app is still reached at
   * `origin`, whatever SITE_URL it was told. DATABASE_URL cannot be overridden: the database is this run's own.
   */
  env?: Record<string, string>;
};

export async function startIsolatedApp(spec: string, options: IsolatedAppOptions = {}): Promise<IsolatedApp> {
  const password = process.env.DB_PASSWORD?.trim();
  if (!password) throw new Error(`${spec}: DB_PASSWORD is not set (run npm run env:init)`);
  const user = process.env.DB_USER?.trim() || 'lostres';
  const suffix = randomBytes(4).toString('hex');
  const database = `lostres_e2e_${suffix}`;
  const container = `los-tres-e2e-${suffix}`;

  const onDatabase = (name: string | null, statement: string, flags: string): string => {
    const target = name === null ? '"$POSTGRES_DB"' : name;
    const result = docker(
      [
        'compose', 'exec', '-T', 'db', 'sh', '-c',
        `psql -U "$POSTGRES_USER" ${target} -v ON_ERROR_STOP=1 ${flags} -c "${statement.replace(/"/g, '\\"')}"`,
      ],
      { timeout: 60_000 },
    );
    if (result.status !== 0) throw new Error(`${spec}: psql failed (exit ${result.status ?? 'none'}): ${result.out.trim()}`);
    return result.out;
  };

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    docker(['rm', '-f', container]);
    try {
      onDatabase(null, `drop database if exists ${database} with (force)`, '');
    } catch {
      // The database is named for this run only; a leftover is harmless and named in the report.
    }
  };

  try {
    onDatabase(null, `create database ${database}`, '');
    const databaseUrl = `postgres://${user}:${encodeURIComponent(password)}@db:5432/${database}`;
    const port = await unusedPort();
    const origin = `http://127.0.0.1:${port}`;
    const extra = Object.entries(options.env ?? {})
      .filter(([name]) => name !== 'DATABASE_URL')
      .flatMap(([name, value]) => ['-e', `${name}=${value}`]);
    const env = ['-e', `DATABASE_URL=${databaseUrl}`, '-e', `SITE_URL=${origin}`, ...extra];

    // The default entrypoint migrates the new database on start and, with SEED_DEMO_DATA, seeds the demo shops.
    const started = docker(
      ['compose', 'run', '-d', '--no-deps', '--name', container, '-p', `127.0.0.1:${port}:3000`, ...env, 'app'],
      { timeout: 120_000 },
    );
    if (started.status !== 0) throw new Error(`${spec}: the isolated app did not start\n${started.out.trim()}`);

    let ready = false;
    for (let attempt = 0; attempt < 120 && !ready; attempt += 1) {
      ready = await fetch(`${origin}/api/health`).then((response) => response.status === 200, () => false);
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error(`${spec}: the isolated app was not healthy in time\n${docker(['logs', container]).out.slice(-2000)}`);

    const imported = docker(['compose', 'run', '--rm', '-T', '--no-deps', ...env, 'app', 'import-feeds'], { timeout: 180_000 });
    if (imported.status !== 0 || !/total: feeds=4 imported=4/.test(imported.out)) {
      throw new Error(`${spec}: import-feeds on the isolated database failed (exit ${imported.status ?? 'none'})\n${imported.out.slice(-2000)}`);
    }

    return {
      origin,
      logs: () => docker(['logs', container]).out,
      psql: (statement) => onDatabase(database, statement, ''),
      psqlScalar: (statement) => onDatabase(database, statement, '-tA').trim(),
      createAdmin: (email, adminPassword) => {
        const result = docker(['compose', 'run', '--rm', '-T', '--no-deps', ...env, 'app', 'create-admin'], {
          input: `${email}\n${adminPassword}\n`,
          timeout: 80_000,
        });
        if (result.status !== 0 || !/create-admin: created/.test(result.out)) {
          throw new Error(`${spec}: create-admin on the isolated database exited ${result.status ?? 'none'}`);
        }
      },
      stop,
    };
  } catch (error) {
    stop();
    throw error;
  }
}
