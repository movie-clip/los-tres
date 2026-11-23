import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { expect, test } from '@playwright/test';

import { LOCAL_FLAG_REFUSAL, LOCAL_FLAG_REFUSAL_EXIT } from '../../src/config/local-flag';
import { unusedPort } from '../support/net';

// S12.2 (decision 0017, D-2, D-3), ACs 33 to 36 and 38: the app refuses to start with the local flag on and a
// SITE_URL that is not a loopback origin, on every start path, with one fixed line that names the two settings
// and shows neither value, and exit code 78. The truth table of the judgement is local-flag.test.ts and the two
// hooks are start-refusal.test.ts; here the REAL start paths run:
//
//   the container `server` verb   `docker compose run ... app server` (the Dockerfile CMD, what a deploy runs)
//   node server.js                the same image, the entrypoint replaced by `node server.js`
//   npm run dev                   `next dev` on the host (a real process, an unused port)
//   next start                    NOT run here (D-11): it needs a host `next build` (minutes, a second `.next`)
//                                 and shares NextNodeServer.prepareImpl with server.js, which does run
//
// "Before it migrates" (AC 33) is proved with an unreachable DATABASE_URL: had migrate run, the exit code
// and the output would be migrate's (the control case shows exactly that for a loopback origin). A refusal
// never needs the database. The start of a healthy app with the flag on (loopback) or off (public) is
// collected-public.spec.ts, one app container for each; a `next dev` or `next start` that is allowed to
// start would have to be killed as a tree, so no case here starts one. `next build` never calls
// register(): this file does not run it (a build takes minutes); the design cites the framework source.

test.describe.configure({ timeout: 240_000 });

const SITE_URLS: [string, string][] = [
  ['a public https origin', 'https://tienda-publica.example/ruta?clave=VALOR-SECRETO-C12'],
  ['a public http origin', 'http://tienda-publica.example'],
  ['a private-network address', 'http://192.168.1.10:3010'],
  ['a value that is not a URL', 'no es una url'],
  ['a blank value', ''],
];

const UNREACHABLE_DATABASE = 'postgres://nadie:nada@127.0.0.1:1/ninguna';

function compose(args: string[], env: Record<string, string>, tail: string[]): { status: number | null; out: string } {
  const flags = Object.entries(env).flatMap(([name, value]) => ['-e', `${name}=${value}`]);
  const result = spawnSync('docker', ['compose', 'run', '--rm', '-T', '--no-deps', ...args, ...flags, 'app', ...tail], {
    encoding: 'utf8',
    timeout: 150_000,
  });
  return { status: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}` };
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
  for (const [label, siteUrl] of SITE_URLS) {
    test(`with the flag on and ${label}: exit ${LOCAL_FLAG_REFUSAL_EXIT}, the one line, before it migrates`, () => {
      const result = compose([], { LOCAL_COLLECTED_DATA: 'true', SITE_URL: siteUrl, DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);

      expect(result.status, result.out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
      expectOneRefusal(result.out, siteUrl);
      // Nothing after the check ran: no migration, no seed, no server.
      expect(result.out).not.toMatch(/migrate|seed:|Ready|Listening|started server/i);
    });
  }

  test('the flag in capitals and padded is still on, so it still refuses', () => {
    const result = compose([], { LOCAL_COLLECTED_DATA: ' TRUE ', SITE_URL: 'https://tienda-publica.example', DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);
    expect(result.status, result.out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
    expect(refusalLines(result.out)).toEqual([LOCAL_FLAG_REFUSAL]);
  });

  test('control: the flag on beside a loopback origin passes the check and goes on to migrate (so the refusals above never reached it)', () => {
    const result = compose([], { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'http://127.0.0.1:3010', DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);

    expect(result.status, result.out).toBe(1);
    expect(refusalLines(result.out)).toEqual([]);
    expect(result.out).toContain('migrate: failed');
  });

  for (const flag of ['false', '1', 'yes', 'truee', '']) {
    test(`control: the flag set to ${JSON.stringify(flag)} beside a public https origin does not refuse (AC 36)`, () => {
      const result = compose([], { LOCAL_COLLECTED_DATA: flag, SITE_URL: 'https://tienda-publica.example', DATABASE_URL: UNREACHABLE_DATABASE }, ['server']);

      expect(result.status, result.out).toBe(1);
      expect(refusalLines(result.out)).toEqual([]);
      expect(result.out).toContain('migrate: failed');
    });
  }

  test('start-check is a pre-step, not a verb: given to the entrypoint it still exits 64', () => {
    const result = compose([], { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'https://tienda-publica.example' }, ['start-check']);
    expect(result.status, result.out).toBe(64);
    expect(refusalLines(result.out)).toEqual([]);
  });
});

test.describe('node server.js outside the container verb (AC 35)', () => {
  for (const [label, siteUrl] of SITE_URLS.filter(([, value]) => value.startsWith('https') || value === '')) {
    test(`with the flag on and ${label}: exit ${LOCAL_FLAG_REFUSAL_EXIT} and the one line, from the hook the framework runs`, () => {
      const result = compose(['--entrypoint', 'node'], { LOCAL_COLLECTED_DATA: 'true', SITE_URL: siteUrl, DATABASE_URL: UNREACHABLE_DATABASE }, ['server.js']);

      expect(result.status, result.out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
      expectOneRefusal(result.out, siteUrl);
    });
  }
});

test.describe('npm run dev (AC 34)', () => {
  test(`with the flag on and a public https origin, next dev exits ${LOCAL_FLAG_REFUSAL_EXIT} with the one line`, async () => {
    test.setTimeout(300_000);
    const port = await unusedPort();
    const next = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next');
    const siteUrl = 'https://tienda-publica.example/ruta?clave=VALOR-SECRETO-C12';

    // A hang guard of ten times what the probe measured (a few seconds), never a sleep: spawnSync waits for the exit.
    const result = spawnSync(process.execPath, [next, 'dev', '--port', String(port)], {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: 240_000,
      env: { ...process.env, LOCAL_COLLECTED_DATA: 'true', SITE_URL: siteUrl, NEXT_TELEMETRY_DISABLED: '1' },
    });
    const out = `${result.stdout ?? ''}${result.stderr ?? ''}`;

    expect(result.error, 'next dev did not exit by itself').toBeUndefined();
    expect(result.status, out).toBe(LOCAL_FLAG_REFUSAL_EXIT);
    expectOneRefusal(out, siteUrl);
  });
});

test.describe('the other verbs do not refuse because of the flag (AC 38)', () => {
  const bad = { LOCAL_COLLECTED_DATA: 'true', SITE_URL: 'https://tienda-publica.example' };

  test('migrate with the flag on beside a public origin runs as today', () => {
    const result = compose([], bad, ['migrate']);
    expect(result.status, result.out).toBe(0);
    expect(result.out).toContain('migrate: up to date');
    expect(refusalLines(result.out)).toEqual([]);
  });

  test('seed --if-enabled with the flag on beside a public origin runs as today', () => {
    const result = compose([], bad, ['seed', '--if-enabled']);
    expect(result.status, result.out).toBe(0);
    expect(refusalLines(result.out)).toEqual([]);
  });

  test('import-feeds with the flag on beside a public origin runs and reaches the importer (an unregistered feed exits 1, never 78)', () => {
    const result = compose([], bad, ['import-feeds', '--feed', '999999']);
    expect(result.status, result.out).toBe(1);
    expect(result.out).toContain('not registered');
    expect(refusalLines(result.out)).toEqual([]);
  });

  test('create-admin with the flag on beside a public origin runs as today (no input: exit 2 and its usage line)', () => {
    const result = compose([], bad, ['create-admin']);
    expect(result.status, result.out).toBe(2);
    expect(result.out).toContain('usage: create-admin');
    expect(refusalLines(result.out)).toEqual([]);
  });
});

test.describe('the image holds no collected file, and the folder is mounted read-only (ACs 40, 41)', () => {
  test('the built app image has no collected-files folder: nothing of it is baked in', () => {
    const images = spawnSync('docker', ['compose', 'config', '--images'], { encoding: 'utf8', timeout: 60_000 });
    const appImage = (images.stdout ?? '')
      .split(/\s+/)
      .map((name) => name.trim())
      .find((name) => name !== '' && !name.startsWith('postgres'));
    expect(appImage, 'the app image name from compose config').toBeTruthy();

    // Run from the image alone, with no mount: nothing of the folder may be inside it.
    const probe = spawnSync('docker', ['run', '--rm', '--entrypoint', 'sh', appImage!, '-c', 'test ! -e /app/collected-files && echo absent'], {
      encoding: 'utf8',
      timeout: 90_000,
    });
    expect(probe.stdout.trim(), probe.stderr).toBe('absent');
  });

  test('compose mounts the folder into app, and the container cannot write to it', () => {
    // If the mount were writable the probe file is removed again, so the owner's folder is never left changed.
    const script =
      'test -d /app/collected-files || { echo no-folder; exit 1; }; if touch /app/collected-files/.probe-e2e 2>/dev/null; then rm -f /app/collected-files/.probe-e2e; echo writable; else echo read-only; fi';
    const result = compose(['--entrypoint', 'sh'], {}, ['-c', script]);

    expect(result.status, result.out).toBe(0);
    const lines = result.out.split('\n').map((line) => line.trim());
    expect(lines).toContain('read-only');
    expect(lines).not.toContain('writable');
  });
});
