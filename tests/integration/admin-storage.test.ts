import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { adminSessions, adminVerifications } from '@/db/schema';
import { AdminInputError, checkAdminInput, normalizeEmail, upsertAdmin } from '@/server/auth/accounts';
import { getAuth } from '@/server/auth/auth';
import { ADMIN_NAME } from '@/server/auth/config';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  accountRows,
  createAdmin,
  sessionRows,
  signInForCookie,
  userRows,
} from '../support/admin';
import { resetDatabase } from '../support/db';
import { pgErrorOf } from '../support/pg-error';

// AC 4-7 and guardrail 5 in the admin tables: what is stored for an account and
// a session, and what is never stored.

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

describe('the stored password (AC 6)', () => {
  it('is a salted scrypt hash, never the plaintext or anything reversible', async () => {
    await createAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const [account] = await accountRows();
    const stored = account.password ?? '';

    expect(stored).not.toBe(ADMIN_PASSWORD);
    expect(stored).not.toContain(ADMIN_PASSWORD);
    expect(stored).not.toBe(Buffer.from(ADMIN_PASSWORD).toString('base64'));
    expect(stored).not.toBe(Buffer.from(ADMIN_PASSWORD).toString('hex'));
    // salt:key, both hex, the key much longer than a password.
    expect(stored).toMatch(/^[0-9a-f]{16,}:[0-9a-f]{64,}$/);
  });

  it('differs between two accounts given the same password', async () => {
    await createAdmin('one@tests.example', ADMIN_PASSWORD);
    await createAdmin('two@tests.example', ADMIN_PASSWORD);
    const hashes = (await accountRows()).map((account) => account.password);
    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });

  it('differs between two runs for the same password on the same account', async () => {
    await createAdmin();
    const [before] = await accountRows();
    await upsertAdmin(getDb(), ADMIN_EMAIL, ADMIN_PASSWORD);
    const [after] = await accountRows();
    expect(after.password).not.toBe(before.password);
  });

  it('is found nowhere in the user or session rows', async () => {
    await createAdmin();
    await signInForCookie();
    const everything = JSON.stringify([await userRows(), await sessionRows()]);
    expect(everything).not.toContain(ADMIN_PASSWORD);
  });
});

describe('the stored account (AC 7)', () => {
  it('stores the email trimmed and lower-case, with the constant name and nothing personal', async () => {
    await upsertAdmin(getDb(), '  Mixed.Case@Tests.EXAMPLE  ', ADMIN_PASSWORD);
    const [user] = await userRows();
    expect(user.email).toBe('mixed.case@tests.example');
    expect(user.name).toBe(ADMIN_NAME);
    expect(user.image).toBeNull();
  });

  it('treats addresses that differ only in case as one account, and never makes a second', async () => {
    const first = await upsertAdmin(getDb(), 'Admin@Tests.Example', ADMIN_PASSWORD);
    const second = await upsertAdmin(getDb(), 'ADMIN@tests.example', 'another-pass-2');
    expect(first.outcome).toBe('created');
    expect(second.outcome).toBe('updated');
    expect(second.userId).toBe(first.userId);
    expect(await userRows()).toHaveLength(1);
    expect(await accountRows()).toHaveLength(1);
  });

  it('replaces the password on a re-run: the old one no longer signs in, the new one does (AC 4)', async () => {
    await createAdmin(ADMIN_EMAIL, 'first-password-1');
    await upsertAdmin(getDb(), ADMIN_EMAIL, 'second-password-2');
    await expect(signInForCookie(ADMIN_EMAIL, 'first-password-1')).rejects.toThrow();
    await expect(signInForCookie(ADMIN_EMAIL, 'second-password-2')).resolves.toBeDefined();
    expect(await userRows()).toHaveLength(1);
  });

  it('ends every open session of the re-run admin and none of another (AC 4, D-12)', async () => {
    const mine = await createAdmin(ADMIN_EMAIL, ADMIN_PASSWORD);
    const other = await createAdmin('other@tests.example', ADMIN_PASSWORD);
    await signInForCookie(ADMIN_EMAIL);
    await signInForCookie(ADMIN_EMAIL);
    await signInForCookie('other@tests.example');
    expect(await sessionRows()).toHaveLength(3);

    await upsertAdmin(getDb(), ADMIN_EMAIL, 'a-new-password-1');

    const left = await sessionRows();
    expect(left.map((row) => row.userId)).toEqual([other]);
    expect(left.some((row) => row.userId === mine)).toBe(false);
  });
});

describe('what is refused before anything is written (AC 5)', () => {
  it.each([
    ['no email', '', 'abcdef', 'email-missing'],
    ['only spaces for an email', '   ', 'abcdef', 'email-missing'],
    ['an email without an at sign', 'admin.tests.example', 'abcdef', 'email-invalid'],
    ['an email without a domain dot', 'admin@tests', 'abcdef', 'email-invalid'],
    ['an email with a space inside', 'ad min@tests.example', 'abcdef', 'email-invalid'],
    ['no password', ADMIN_EMAIL, '', 'password-missing'],
    ['a password of 5 characters', ADMIN_EMAIL, 'abcde', 'password-short'],
    ['a password over 128 characters', ADMIN_EMAIL, 'x'.repeat(129), 'password-long'],
  ])('refuses %s and creates nothing', async (_label, email, password, problem) => {
    expect(checkAdminInput(email, password)).toBe(problem);
    await expect(upsertAdmin(getDb(), email, password)).rejects.toMatchObject({ problem });
    await expect(upsertAdmin(getDb(), email, password)).rejects.toBeInstanceOf(AdminInputError);
    expect(await userRows()).toEqual([]);
    expect(await accountRows()).toEqual([]);
  });

  it('changes nothing on an existing account when the new password is refused', async () => {
    await createAdmin();
    await signInForCookie();
    const [before] = await accountRows();
    await expect(upsertAdmin(getDb(), ADMIN_EMAIL, 'abc')).rejects.toBeInstanceOf(AdminInputError);
    expect((await accountRows())[0].password).toBe(before.password);
    expect(await sessionRows()).toHaveLength(1);
  });

  it('accepts a password of exactly 6 characters and exactly 128, with no composition rule (D-11)', () => {
    expect(checkAdminInput(ADMIN_EMAIL, 'aaaaaa')).toBeNull();
    expect(checkAdminInput(ADMIN_EMAIL, 'x'.repeat(128))).toBeNull();
    expect(checkAdminInput(ADMIN_EMAIL, '      ')).toBeNull();
  });

  it('normalises an email the one way everywhere', () => {
    expect(normalizeEmail('  A@B.Es ')).toBe('a@b.es');
  });

  it('does not put the value in the error it throws', async () => {
    const error = await upsertAdmin(getDb(), 'secret-sentinel@tests.example', 'abc').catch((e: unknown) => e);
    expect(String((error as Error).message)).not.toContain('secret-sentinel');
    expect(String((error as Error).message)).not.toContain('abc');
  });
});

describe('no sign-up and no reset (AC 1)', () => {
  it('refuses the framework sign-up call and creates no account', async () => {
    await expect(
      getAuth().api.signUpEmail({
        body: { email: 'new@tests.example', password: 'abcdef', name: 'x' },
        headers: new Headers(),
      }),
    ).rejects.toThrow();
    expect(await userRows()).toEqual([]);
  });

  it('keeps the verification table empty: nothing in this build issues a reset or invitation', async () => {
    await createAdmin();
    await signInForCookie();
    expect(await getDb().select().from(adminVerifications)).toEqual([]);
  });
});

describe('no IP address and no user agent on a session (guardrail 5)', () => {
  it('stores null for both even when the sign-in request carries them', async () => {
    await createAdmin();
    const headers = new Headers({
      'user-agent': 'Mozilla/5.0 UA-SENTINEL-61c0',
      'x-forwarded-for': '203.0.113.9',
      'x-real-ip': '203.0.113.9',
    });
    await getAuth().api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, headers });

    const [row] = await sessionRows();
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
    expect(JSON.stringify(row)).not.toMatch(/UA-SENTINEL|203\.0\.113/);
  });

  it('stores null for both when the request carries nothing, not an empty string', async () => {
    await createAdmin();
    await signInForCookie();
    const [row] = await sessionRows();
    expect(row.ipAddress).toBeNull();
    expect(row.userAgent).toBeNull();
  });

  it('refuses a session row that holds an IP address or a user agent, whatever wrote it', async () => {
    const userId = await createAdmin();
    const insert = (extra: { ipAddress?: string; userAgent?: string }) =>
      getDb()
        .insert(adminSessions)
        .values({
          id: `s-${Math.random()}`,
          token: `t-${Math.random()}`,
          userId,
          expiresAt: new Date(Date.now() + 3600_000),
          ...extra,
        });

    for (const extra of [{ ipAddress: '203.0.113.9' }, { userAgent: 'Firefox' }, { ipAddress: '', userAgent: '' }]) {
      const error = await pgErrorOf(insert(extra));
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe('admin_sessions_no_ip_or_user_agent');
    }
    await insert({});
    expect(await getDb().select().from(adminSessions).where(eq(adminSessions.userId, userId))).toHaveLength(1);
  });
});
