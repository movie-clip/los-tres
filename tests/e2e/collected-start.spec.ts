import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCAL_FLAG_REFUSAL, LOCAL_FLAG_REFUSAL_EXIT } from '../../src/config/local-flag';
import { execIn, verb } from '../support/e2e-stack';
import { unusedPort } from '../support/net';

// S12.2 (decision 0017, D-2, D-3), ACs 33 to 36, 38, 40 and 41, B7 of #339: the app refuses to start with the
// local flag on and a SITE_URL that is not a loopback origin, on every start path, with one fixed line that names
// the two settings and shows neither value, and exit code 78. The truth table of the judgement is
// local-flag.test.ts and the two hooks are start-refusal.test.ts; here the REAL start paths run:
//
//   the container `server` verb   `./docker-entrypoint.sh server` (the Dockerfile CMD, what a deploy runs), run
//                                 by `compose exec` in the e2e `app-no-db` service (#363: no container is started)
//   node server.js                `node server.js` in the same service, the same image
//   npm run dev                   `next dev` on the host (a real process, an unused port)
//   next start                    NOT run here (D-11): it needs a host `next build` (minutes, a second `.next`)
//                                 and shares NextNodeServer.prepareImpl with server.js, which does run
//
// "Before it migrates" (AC 33) is proved with an unreachable DATABASE_URL: had migrate run, the exit code
// and the output would be migrate's (the control case shows exactly that for a loopback origin). A refusal
// never needs the database. The start of a healthy app with the flag on (loopback) or off (public) is
// collected-public.spec.ts, one app service for each; a `next dev` or `next start` that is allowed to
// start would have to be killed as a tree, so no case here starts one. `next build` never calls
// register(): this file does not run it (a build takes minutes); the design cites the framework source.
//
// Every verb runs in `app-no-db`, whose database nobody listens on, so this spec writes no database and runs
// in the parallel project. The one probe in `app` reads the mount and writes nothing.

test.describe.configure({ timeout: 240_000 });

const PUBLIC_HTTPS = 'https://tienda-publica.example/ruta?clave=VALOR-SECRETO-C12';

const UNREACHABLE_DATABASE = 'postgres://nadie:nada@127.0.0.1:1/ninguna';

/**
 * A command in the running `app-no-db` service of the e2e stack, with extra container environment: the output and
 * the exit code. `app-no-db` is the same image with a database nobody listens on and no mount, so the `server`
 * verb either refuses at its start check (78) or fails at its migrate (1), and never reaches a listening server.
 * A verb is always run in `app-no-db`, never in `app`: that is what keeps this spec out of the serial project.
 */
function inNoDb(env: Record<string, string>, tail: string[], direct = false): { status: number | null; out: string } {
  const result = direct ? execIn('app-no-db', tail, { env, timeout: 150_000 }) : verb('app-no-db', tail, { env, timeout: 150_000 });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

/** The lines of the output that say the start was refused: the one fixed line, and nothing like it. */
const refusalLines = (out: string): string[] => out.split(/\r?\n/).filter((line) => /start refused/.test(line));

function expectOneRefusal(out: string, siteUrl: string): void {
  expect(refusalLines(out)).toEqual([LOCAL_FLAG_REFUSAL]);
  // Neither value is shown, and the line names the two settings.
  expect(LOCAL_FLAG_REFUSAL).toContain('LOCAL_COLLECTED_DATA');
  expect(LOCAL_FLAG_REFUSAL).toContain('SITE_URL');
  if (siteUrl !== '') expect(out).not.toContain(siteUrl);
  expect(out).not.toMatch(/VALOR-SECRETO|tienda-publica|192\.168\./);
  expect(out).not.toContain(UNREACHABLE_DATABASE);
}

test.describe('the container server verb (AC 33)', () => {
  test(`with the flag on and a public https origin: exit ${LOCAL_FLAG_REFUSAL_EXIT}, the one line, before it migrates`, () => {
    const result = inNoDb({ LOCAL_COLLECTED_DATA: 'true', SITE_URL: PUBLIC_HTTPS, DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);

    expect(result.status, result.out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
    expectOneRefusal(result.out, PUBLIC_HTTPS);
    // Nothing after the check ran: no migration, no seed, no server.
    expect(result.out).not.toMatch(/migrate|seed:|Ready|Listening|started server/i);
  });

  test('control: the flag on beside a loopback origin passes the check and goes on to migrate (so the refusal above never reached it)', () => {
    const result = inNoDb({ LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'http://127.0.0.1:3010', DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);

    expect(result.status, result.out).toBe(1);
    expect(refusalLines(result.out)).toEqual([]);
    expect(result.out).toContain('migrate: failed');
  });
});

test.describe('node server.js outside the container verb (AC 35)', () => {
  test(`with the flag on and a public https origin: exit ${LOCAL_FLAG_REFUSAL_EXIT} and the one line, from the hook the framework runs`, () => {
    // PORT: the service's own server already listens on 3000, and the framework binds the port before its start
    // hook runs, so a second `node server.js` on 3000 would fail with EADDRINUSE (exit 1) whatever the hook says.
    const env = { LOCAL_COLLECTED_DATA: 'true', SITE_URL: PUBLIC_HTTPS, DATABASE_URL: UNREACHABLE_DATABASE, PORT: '3999' };
    const result = inNoDb(env, ['node', 'server.js'], true);

    expect(result.status, result.out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
    expectOneRefusal(result.out, PUBLIC_HTTPS);
  });
});

test.describe('npm run dev (AC 34)', () => {
  test(`with the flag on and a public https origin, next dev exits ${LOCAL_FLAG_REFUSAL_EXIT} with the one line`, async () => {
    test.setTimeout(300_000);
    const port = await unusedPort();
    const next = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');

    // A hang guard of ten times what the probe measured (a few seconds), never a sleep: spawnSync waits for the exit.
    const result = spawnSync(process.execPath, [next, 'dev', '--port', String(port)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...process.env, LOCAL_COLLECTED_DATA: 'true', SITE_URL: PUBLIC_HTTPS, NEXT_TELEMETRY_DISABLED: '1' },
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.error, 'next dev did not exit by itself').toBeUndefined();
    expect(result.status, out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
    expectOneRefusal(out, PUBLIC_HTTPS);
  });
});

test.describe('the other verbs do not refuse because of the flag (AC 38)', () => {
  test('migrate, seed, import-feeds and create-admin with the flag on beside a public origin each reach their own code: not exit 78, no refusal line', () => {
    // In `app-no-db`, where the database is unreachable: a verb that is not refused goes on to its own work and
    // fails there (1), or, with no input, to its own usage line (2). Nothing reaches a database.
    const bad = { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'https://tienda-publica.example' };
    const cases: { args: string[]; status: number; own: string }[] = [
      { args: ['migrate'], status: 1, own: 'migrate: failed' },
      { args: ['seed'], status: 1, own: 'seed: failed' },
      { args: ['import-feeds', '--feed', '999999'], status: 1, own: 'import-feeds: failed' },
      { args: ['create-admin'], status: 2, own: 'usage: create-admin' },
    ];
    for (const { args, status, own } of cases) {
      const result = inNoDb(bad, args);
      expect(result.status, `${args[0]}: ${result.out}`).toBe(status);
      expect(result.status, args[0]).not.toBe(LOCAL_FLAG_REFUSAL_EXIT);
      expect(result.out, args[0]).toContain(own);
      expect(refusalLines(result.out), args[0]).toEqual([]);
    }
  });
});

test.describe('the image holds no owner file, and the folders are mounted read-only (ACs 31, 40, 41)', () => {
  const FOLDERS = ['catalogue-files', 'collected-files'] as const;

  test('the built app image has neither the catalogue-files nor the collected-files folder: nothing of them is baked in', () => {
    // `app-no-db` runs the same image as `app` with no mount: nothing of either folder may be inside it.
    for (const folder of FOLDERS) {
      const probe = execIn('app-no-db', ['sh', '-c', `test ! -e /app/${folder} && echo absent`], { timeout: 90_000 });
      expect(probe.stdout.trim(), `${folder}: ${probe.stderr}`).toBe('absent');
    }
  });

  test('compose mounts both folders into app, and the container cannot write to either', () => {
    // If a mount were writable the probe file is removed again, so the owner's folder is never left changed.
    for (const folder of FOLDERS) {
      const script =
        `test -d /app/${folder} || { echo no-folder; exit 1; }; if touch /app/${folder}/.probe-e2e 2>/dev/null; then rm -f /app/${folder}/.probe-e2e; echo writable; else echo read-only; fi`;
      const result = execIn('app', ['sh', '-c', script], { timeout: 90_000 });

      expect(result.status, `${folder}: ${result.stdout}${result.stderr}`).toBe(0);
      const lines = result.stdout.split('\n').map((line) => line.trim());
      expect(lines, folder).toContain('read-only');
      expect(lines, folder).not.toContain('writable');
    }
  });
});
