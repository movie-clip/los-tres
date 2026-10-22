import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb } from '@/db/client';

import { ADMIN_EMAIL, ADMIN_PASSWORD, accountRows, sessionRows, signInForCookie, userRows } from '../support/admin';
import { resetDatabase } from '../support/db';

// The create-admin command (AC 2-5, AC 28), run as the image runs it: the
// compiled dist/cli/create-admin.js under node with the react-server condition,
// against the test database, with the credentials on stdin. The compile is done
// here so the test never runs a stale build.

const root = process.cwd();
const EMAIL = 'cli.sentinel-3a9f@tests.example';
const PASSWORD = 'CLI-PASSWORD-SENTINEL-81d4';

function run(input: string, args: string[] = []) {
  const result = spawnSync(
    process.execPath,
    ['--conditions=react-server', path.join(root, 'dist/cli/create-admin.js'), ...args],
    { cwd: root, input, encoding: 'utf8', env: { ...process.env }, timeout: 60_000 },
  );
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const all = (result: { stdout: string; stderr: string }) => `${result.stdout}${result.stderr}`;

beforeAll(() => {
  const tsc = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.cli.json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (tsc.status !== 0) throw new Error(`cli build failed:\n${tsc.stdout}${tsc.stderr}`);
}, 150_000);
beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe('creating an admin (AC 2)', () => {
  it('exits 0, says created, and the account then signs in', async () => {
    const result = run(`${EMAIL}\n${PASSWORD}\n`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('create-admin: created');
    expect(await userRows()).toHaveLength(1);
    await expect(signInForCookie(EMAIL, PASSWORD)).resolves.toBeDefined();
  });

  it('takes Windows line endings without keeping the carriage return', async () => {
    expect(run(`${EMAIL}\r\n${PASSWORD}\r\n`).status).toBe(0);
    await expect(signInForCookie(EMAIL, PASSWORD)).resolves.toBeDefined();
  });

  it('accepts a password of exactly 6 characters (D-11)', async () => {
    expect(run(`${EMAIL}\nabcdef\n`).status).toBe(0);
    await expect(signInForCookie(EMAIL, 'abcdef')).resolves.toBeDefined();
  });

  it('stores the password only as a hash', async () => {
    run(`${EMAIL}\n${PASSWORD}\n`);
    const [account] = await accountRows();
    expect(account.password).not.toContain(PASSWORD);
    expect(account.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });
});

describe('running it again for the same email (AC 4, AC 7, D-12)', () => {
  it('replaces the password, creates no second account and ends the open sessions', async () => {
    expect(run(`${EMAIL}\n${PASSWORD}\n`).status).toBe(0);
    await signInForCookie(EMAIL, PASSWORD);
    expect(await sessionRows()).toHaveLength(1);

    const again = run(`${EMAIL}\nsecond-password-2\n`);

    expect(again.status).toBe(0);
    expect(again.stdout.trim()).toBe('create-admin: updated, sessions ended');
    expect(await userRows()).toHaveLength(1);
    expect(await accountRows()).toHaveLength(1);
    expect(await sessionRows()).toEqual([]);
    await expect(signInForCookie(EMAIL, PASSWORD)).rejects.toThrow();
    await expect(signInForCookie(EMAIL, 'second-password-2')).resolves.toBeDefined();
  });

  it('counts an address that differs only in letter case as the same account', async () => {
    run(`${EMAIL}\n${PASSWORD}\n`);
    const again = run(`${EMAIL.toUpperCase()}\nsecond-password-2\n`);
    expect(again.status).toBe(0);
    expect(again.stdout).toContain('updated');
    expect(await userRows()).toHaveLength(1);
  });
});

describe('what the command refuses (AC 5)', () => {
  it.each([
    ['no input at all', ''],
    ['no email', `\n${PASSWORD}\n`],
    ['an email that is not an address', `not-an-address-sentinel\n${PASSWORD}\n`],
    ['no password', `${EMAIL}\n`],
    ['an empty password line', `${EMAIL}\n\n`],
    ['a password of 5 characters', `${EMAIL}\nabcde\n`],
  ])('exits 2 with a usage line and creates nothing: %s', async (_label, input) => {
    const result = run(input);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('usage: create-admin');
    expect(await userRows()).toEqual([]);
    expect(await accountRows()).toEqual([]);
  });

  it('changes nothing on an existing account when the new password is too short', async () => {
    run(`${EMAIL}\n${PASSWORD}\n`);
    await signInForCookie(EMAIL, PASSWORD);
    const [before] = await accountRows();

    const result = run(`${EMAIL}\nabcde\n`);

    expect(result.status).toBe(2);
    expect((await accountRows())[0].password).toBe(before.password);
    expect(await sessionRows()).toHaveLength(1);
  });

  it('refuses any argument, so a password cannot be passed on the command line (AC 3)', async () => {
    for (const args of [['--password', PASSWORD], ['--email', EMAIL], [EMAIL, PASSWORD], ['--help']]) {
      const result = run(`${EMAIL}\n${PASSWORD}\n`, args);
      expect(result.status, args.join(' ')).toBe(2);
      expect(result.stderr).toContain('usage: create-admin');
    }
    expect(await userRows()).toEqual([]);
  });
});

describe('what the command prints (AC 3, AC 28)', () => {
  it('echoes neither the email nor the password on success', () => {
    const result = run(`${EMAIL}\n${PASSWORD}\n`);
    const text = all(result);
    for (const secret of [EMAIL, 'cli.sentinel', PASSWORD, 'SENTINEL-81d4']) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('echoes neither on a re-run', () => {
    run(`${EMAIL}\n${PASSWORD}\n`);
    const text = all(run(`${EMAIL}\nsecond-sentinel-pass-2\n`));
    for (const secret of [EMAIL, 'cli.sentinel', PASSWORD, 'second-sentinel']) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it('echoes neither in any refusal, naming the rule instead', () => {
    const cases = [
      `not-an-address-sentinel\n${PASSWORD}\n`,
      `${EMAIL}\nabcde\n`,
      `${EMAIL}\n`,
      `\n${PASSWORD}\n`,
    ];
    for (const input of cases) {
      const text = all(run(input));
      for (const secret of [EMAIL, 'cli.sentinel', 'not-an-address-sentinel', PASSWORD, 'abcde']) {
        expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
      }
      expect(text).toMatch(/create-admin: /);
    }
  });

  it('echoes neither when the argument form is refused', () => {
    const text = all(run(`${EMAIL}\n${PASSWORD}\n`, ['--password', PASSWORD, '--email', EMAIL]));
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(EMAIL);
  });

  it('prints only a short code, never a connection string, when the database cannot be reached (exit 1)', () => {
    const result = spawnSync(
      process.execPath,
      ['--conditions=react-server', path.join(root, 'dist/cli/create-admin.js')],
      {
        cwd: root,
        input: `${ADMIN_EMAIL}\n${ADMIN_PASSWORD}\n`,
        encoding: 'utf8',
        env: { ...process.env, DATABASE_URL: 'postgres://nobody:db-secret-sentinel@127.0.0.1:1/none' },
        timeout: 60_000,
      },
    );
    expect(result.status).toBe(1);
    const text = `${result.stdout}${result.stderr}`;
    expect(text).toMatch(/^create-admin: failed \(/m);
    for (const secret of ['db-secret-sentinel', 'postgres://', ADMIN_EMAIL, ADMIN_PASSWORD]) {
      expect(text).not.toContain(secret);
    }
  });
});
