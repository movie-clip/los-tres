import { spawnSync } from 'node:child_process';

// The e2e stack (#363): the Compose project `los-tres-e2e`, started by tests/e2e/global-setup.ts and
// removed by tests/e2e/global-teardown.ts. This file is the one reader of the project name and the one
// place a spec or helper reaches Docker through, so no call can land on the development stack. The
// identity (project, files, ports) is written once, by playwright.config.ts, into process.env, and
// every `docker compose` call made here inherits it. Nothing in this file starts or removes a
// container: `exec` runs a process inside one that is already up.

/** A service of the e2e project (tests/e2e/compose.e2e.yaml). */
export type E2EService = 'db' | 'app' | 'app-no-db' | 'app-flag-off' | 'app-flag-on';
/** The variant apps that have a database of their own on the e2e `db` service. */
export type E2EVariant = 'app-flag-off' | 'app-flag-on';
/** The databases of the variants, created by tests/e2e/db-init/10-e2e-variants.sql; the default is the main e2e database. */
export type E2EDatabase = 'e2e_flag_off' | 'e2e_flag_on';

/** The one admin, created once by the global setup. No spec creates this email again (that would end its sessions). */
export const E2E_ADMIN = { email: 'e2e-admin@example.test', password: 'e2e-password-1' } as const;

const VARIANT_DATABASE: Record<E2EVariant, E2EDatabase> = {
  'app-flag-off': 'e2e_flag_off',
  'app-flag-on': 'e2e_flag_on',
};

const PORT_NAME: Record<Exclude<E2EService, 'db'>, string> = {
  app: 'E2E_APP_PORT',
  'app-no-db': 'E2E_NO_DB_PORT',
  'app-flag-off': 'E2E_FLAG_OFF_PORT',
  'app-flag-on': 'E2E_FLAG_ON_PORT',
};

export type Run = { status: number | null; stdout: string; stderr: string };

export type ComposeOptions = {
  /** Text written to the command's stdin. */
  input?: string;
  /** Milliseconds before the command is killed. Default 120 s. */
  timeout?: number;
};

export type ExecOptions = ComposeOptions & {
  /** Extra container environment, passed as `-e NAME=value` (the value reaches the process, never a shell). */
  env?: Record<string, string>;
};

/** The e2e Compose project name; throws when the run did not come through `playwright test`. */
export function e2eProject(): string {
  const project = process.env.COMPOSE_PROJECT_NAME?.trim();
  if (!project || project === 'los-tres') {
    throw new Error('e2e: run through playwright test; playwright.config.ts sets the e2e project');
  }
  return project;
}

/** One `docker compose` call on the e2e project. */
export function compose(args: string[], options: ComposeOptions = {}): Run {
  e2eProject();
  const result = spawnSync('docker', ['compose', ...args], {
    encoding: 'utf8',
    input: options.input,
    timeout: options.timeout ?? 120_000,
    maxBuffer: 256 * 1024 * 1024,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** What still carries the e2e project's label in Docker: container, volume and network ids. Empty arrays after a removal. */
export function e2eLeftovers(): { containers: string[]; volumes: string[]; networks: string[] } {
  const label = `label=com.docker.compose.project=${e2eProject()}`;
  const ids = (args: string[]): string[] => {
    const result = spawnSync('docker', [...args, '--filter', label], { encoding: 'utf8', timeout: 60_000 });
    if (result.status !== 0) throw new Error(`e2e: docker ${args[0]} failed (exit ${result.status ?? 'none'}): ${(result.stderr ?? '').trim()}`);
    return (result.stdout ?? '').split(/\s+/).filter((id) => id !== '');
  };
  return {
    containers: ids(['ps', '-aq']),
    volumes: ids(['volume', 'ls', '-q']),
    networks: ids(['network', 'ls', '-q']),
  };
}

const envFlags = (env: Record<string, string> | undefined): string[] =>
  Object.entries(env ?? {}).flatMap(([name, value]) => ['-e', `${name}=${value}`]);

/** A process inside a running service: `argv` is the command and its arguments. */
export function execIn(service: E2EService, argv: string[], options: ExecOptions = {}): Run {
  return compose(['exec', '-T', ...envFlags(options.env), service, ...argv], options);
}

/** One verb of the image's dispatcher (`import-feeds`, `create-admin`, `server`, ...) inside a running service. */
export function verb(service: E2EService, args: string[], options: ExecOptions = {}): Run {
  return execIn(service, ['./docker-entrypoint.sh', ...args], options);
}

/** The service's output so far, stdout and stderr, with no service prefix. */
export function serviceLogs(service: E2EService): string {
  const run = compose(['logs', '--no-color', '--no-log-prefix', service]);
  return `${run.stdout}${run.stderr}`;
}

/** `http://127.0.0.1:<port>`: where the host reaches a service; the `db` service publishes no port. */
export function origin(service: Exclude<E2EService, 'db'>): string {
  const port = process.env[PORT_NAME[service]]?.trim();
  if (!port) throw new Error(`e2e: ${PORT_NAME[service]} is not set; run through playwright test`);
  return `http://127.0.0.1:${port}`;
}

function runPsql(statement: string, flags: string, database: E2EDatabase | undefined): string {
  const target = database === undefined ? '"$POSTGRES_DB"' : database;
  const result = execIn(
    'db',
    ['sh', '-c', `psql -U "$POSTGRES_USER" ${target} -v ON_ERROR_STOP=1 ${flags} -c "${statement.replace(/"/g, '\\"')}"`],
    { timeout: 60_000 },
  );
  if (result.status !== 0) throw new Error(`psql failed (exit ${result.status ?? 'none'}): ${result.stderr.trim()}`);
  return result.stdout;
}

/** Runs one SQL statement as the database owner on the e2e database (or a variant's) inside the `db` service. */
export function psql(statement: string, options: { database?: E2EDatabase } = {}): string {
  return runPsql(statement, '', options.database);
}

/** Runs one SQL query and returns its single value, trimmed (psql `-tA`). */
export function psqlScalar(statement: string, options: { database?: E2EDatabase } = {}): string {
  return runPsql(statement, '-tA', options.database).trim();
}

export type Variant = {
  /** `http://127.0.0.1:<port>`: the address the app is reached at. */
  origin: string;
  /** The container's output so far (stdout and stderr). */
  logs(): string;
  /** One SQL statement on the variant's own database. */
  psql(statement: string): string;
  /** One SQL query on the variant's own database; its single value, trimmed. */
  psqlScalar(statement: string): string;
};

/** A variant app that is already up: its origin, logs and database. */
export function variant(name: E2EVariant): Variant {
  return {
    origin: origin(name),
    logs: () => serviceLogs(name),
    psql: (statement) => psql(statement, { database: VARIANT_DATABASE[name] }),
    psqlScalar: (statement) => psqlScalar(statement, { database: VARIANT_DATABASE[name] }),
  };
}
