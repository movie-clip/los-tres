import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { signInAction, signOutAction, type SignInState } from '@/server/auth/actions';
import { AdminInputError, upsertAdmin } from '@/server/auth/accounts';
import { checkAdminSession } from '@/server/auth/guard';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  COOKIE_NAME,
  SITE_ORIGIN,
  consoleMethods,
  createAdmin,
  requestWith,
  sessionRows,
  signInForCookie,
  userRows,
} from '../support/admin';
import { resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// AC 8-16: the sign-in and sign-out actions, called as Next calls them, with the
// request headers and the cookie store replaced by the recording stand-ins in
// tests/support/next-request.ts. Every refusal is asserted to set no cookie.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

const DOWN_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const IDLE: SignInState = { status: 'idle' };

/** Submits the sign-in form from the site's own origin unless told otherwise. */
async function signIn(
  fields: Record<string, string>,
  origin: string | null = SITE_ORIGIN,
): Promise<{ state?: SignInState; redirectedTo?: string }> {
  startAdminRequest({ origin });
  try {
    return { state: await signInAction(IDLE, form(fields)) };
  } catch (error) {
    return { redirectedTo: await redirectOf(() => Promise.reject(error)) };
  }
}

beforeEach(async () => {
  await resetDatabase();
  startAdminRequest();
  consoleMethods.forEach((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

describe('a successful sign-in (AC 9, AC 12, AC 13)', () => {
  it('lands on the shell and sets exactly one cookie: the session cookie', async () => {
    await createAdmin();
    const result = await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    expect(result.redirectedTo).toBe('/admin');
    expect(nextRequest.cookieWrites).toHaveLength(1);
    expect(nextRequest.cookieWrites[0].name).toBe(COOKIE_NAME);
    expect(await sessionRows()).toHaveLength(1);
  });

  it('marks the cookie HttpOnly, SameSite=Strict, site-wide, for 8 hours, and not Secure over http', async () => {
    await createAdmin();
    await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const { options } = nextRequest.cookieWrites[0];

    expect(options.httpOnly).toBe(true);
    expect(String(options.sameSite).toLowerCase()).toBe('strict');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(8 * 60 * 60);
    expect(options.secure).toBeFalsy();
    // Not readable from script and not shared with a parent domain.
    expect(options.domain).toBeUndefined();
  });

  it('holds nothing readable in the cookie value: no email, role or password (AC 13)', async () => {
    await createAdmin();
    await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const value = decodeURIComponent(nextRequest.cookieWrites[0].value);

    expect(value).toMatch(/^[A-Za-z0-9]{20,}\.[A-Za-z0-9+/=]{20,}$/);
    const [token] = value.split('.');
    for (const readable of [ADMIN_EMAIL, 'tests.example', ADMIN_PASSWORD, 'admin', 'role']) {
      expect(value.toLowerCase()).not.toContain(readable.toLowerCase());
    }
    // The opaque part means nothing without the server's record of it.
    expect((await sessionRows())[0].token).toBe(token);
  });

  it('gives a cookie that the guard then accepts', async () => {
    await createAdmin();
    await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const { name, value } = nextRequest.cookieWrites[0];
    const check = await checkAdminSession(requestWith(`${name}=${value}`));
    expect(check.kind).toBe('admin');
  });

  it('marks the cookie Secure and prefixed when the site is served over https', async () => {
    await createAdmin();
    vi.stubEnv('SITE_URL', 'https://example.test');
    await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, 'https://example.test');
    expect(nextRequest.cookieWrites).toHaveLength(1);
    expect(nextRequest.cookieWrites[0].name).toBe(`__Secure-${COOKIE_NAME}`);
    expect(nextRequest.cookieWrites[0].options.secure).toBe(true);
  });

  it('accepts the email in any letter case and with surrounding spaces (AC 7)', async () => {
    await createAdmin();
    const result = await signIn({ email: '  ADMIN@Tests.Example ', password: ADMIN_PASSWORD });
    expect(result.redirectedTo).toBe('/admin');
  });
});

describe('the password rule the command enforces (D-11, AC 5)', () => {
  it('signs in with a password of exactly 6 characters', async () => {
    await createAdmin(ADMIN_EMAIL, 'abc123');
    const result = await signIn({ email: ADMIN_EMAIL, password: 'abc123' });
    expect(result.redirectedTo).toBe('/admin');
  });

  it('refuses a 5-character password and creates nothing', async () => {
    await expect(upsertAdmin(getDb(), ADMIN_EMAIL, 'abc12')).rejects.toBeInstanceOf(AdminInputError);
    expect(await userRows()).toEqual([]);
  });

  it('applies no composition rule: 6 lower-case letters are enough', async () => {
    await expect(upsertAdmin(getDb(), ADMIN_EMAIL, 'aaaaaa')).resolves.toMatchObject({ outcome: 'created' });
  });
});

describe('a refused sign-in sets no cookie and starts no session (AC 10, AC 11, AC 12)', () => {
  beforeEach(async () => {
    await createAdmin();
  });

  async function expectNothingStarted() {
    expect(nextRequest.cookieWrites).toEqual([]);
    expect(await sessionRows()).toEqual([]);
  }

  it('answers a wrong password and an unknown email with the same state (AC 10)', async () => {
    const wrongPassword = await signIn({ email: ADMIN_EMAIL, password: 'not-the-password' });
    await expectNothingStarted();
    const unknownEmail = await signIn({ email: 'nobody@tests.example', password: 'not-the-password' });
    await expectNothingStarted();

    expect(wrongPassword.state).toEqual({ status: 'rejected', email: ADMIN_EMAIL });
    expect(unknownEmail.state).toEqual({ status: 'rejected', email: 'nobody@tests.example' });
    expect(Object.keys(wrongPassword.state ?? {}).sort()).toEqual(Object.keys(unknownEmail.state ?? {}).sort());
  });

  it('keeps the email as typed so the form can show it again, and never returns the password', async () => {
    const result = await signIn({ email: 'Admin@Tests.EXAMPLE', password: 'not-the-password' });
    expect(result.state).toEqual({ status: 'rejected', email: 'Admin@Tests.EXAMPLE' });
    expect(JSON.stringify(result.state)).not.toContain('not-the-password');
  });

  it('refuses a 5-character password for an account whose password is longer', async () => {
    const result = await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD.slice(0, 5) });
    expect(result.state?.status).toBe('rejected');
    await expectNothingStarted();
  });

  it.each([
    ['both empty', { email: '', password: '' }, { email: 'required', password: 'required' }],
    ['email empty', { email: '', password: 'x' }, { email: 'required' }],
    ['password empty', { email: ADMIN_EMAIL, password: '' }, { password: 'required' }],
    ['email only spaces', { email: '   ', password: 'x' }, { email: 'required' }],
    ['email without an at sign', { email: 'admin.tests.example', password: 'x' }, { email: 'invalid' }],
  ])('says which field is wrong and starts nothing: %s (AC 11)', async (_label, fields, fieldErrors) => {
    const result = await signIn(fields);
    expect(result.state).toMatchObject({ status: 'invalid', fieldErrors });
    expect(result.redirectedTo).toBeUndefined();
    await expectNothingStarted();
  });

  it('looks nothing up for an empty field: the answer is the same before and after the account exists', async () => {
    const result = await signIn({ email: 'nobody@tests.example', password: '' });
    expect(result.state).toMatchObject({ status: 'invalid' });
  });

  it('is never a server error for hostile input', async () => {
    for (const email of ['a@b', "o'brien@tests.example", `${'x'.repeat(5000)}@tests.example`, '\u0000@tests.example']) {
      for (const password of ['x', 'y'.repeat(5000), '\u0000']) {
        const result = await signIn({ email, password });
        expect(['invalid', 'rejected', 'unavailable']).toContain(result.state?.status);
      }
    }
    await expectNothingStarted();
  });

  it('says the service is unavailable, not that the credentials are wrong, when the store is down (UX state)', async () => {
    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      const result = await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      expect(result.state?.status).toBe('unavailable');
      expect(nextRequest.cookieWrites).toEqual([]);
    } finally {
      await closeDb();
      vi.unstubAllEnvs();
    }
  });
});

describe('a sign-in from another origin is refused (D-16, AC 16)', () => {
  beforeEach(async () => {
    await createAdmin();
  });

  it.each([
    ['no Origin header', null],
    ['an empty Origin', ''],
    ['the opaque origin "null"', 'null'],
    ['another site', 'https://evil.example'],
    ['the same host on another port', 'http://127.0.0.1:3999'],
    ['the same host on another scheme', 'https://127.0.0.1:3000'],
    ['localhost instead of 127.0.0.1', 'http://localhost:3000'],
    ['a host that only starts like the site', 'http://127.0.0.1:3000.evil.example'],
    ['something that is not a URL', 'not a url'],
  ])('refuses the right password with %s and sets no cookie', async (_label, origin) => {
    const result = await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, origin);
    expect(result.state?.status).toBe('unavailable');
    expect(result.redirectedTo).toBeUndefined();
    expect(nextRequest.cookieWrites).toEqual([]);
    expect(await sessionRows()).toEqual([]);
  });

  it('accepts the site origin', async () => {
    const result = await signIn({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, SITE_ORIGIN);
    expect(result.redirectedTo).toBe('/admin');
  });
});

describe('signing out (AC 15, AC 16, AC 20)', () => {
  async function liveSession() {
    await createAdmin();
    const session = await signInForCookie();
    startAdminRequest({ cookie: session.cookie, origin: SITE_ORIGIN });
    return session;
  }

  it('ends the session on the server, clears the cookie and lands on the sign-in page', async () => {
    const session = await liveSession();

    const to = await redirectOf(() => signOutAction());

    expect(to).toBe('/admin/acceso?aviso=salida');
    expect(await sessionRows()).toEqual([]);
    const written = nextRequest.cookieWrites;
    expect(written.map((write) => write.name)).toContain(COOKIE_NAME);
    for (const write of written) {
      expect(write.value).toBe('');
      expect(write.options.maxAge).toBe(0);
    }
    // Replaying the old value, from anywhere, is anonymous.
    expect(await checkAdminSession(requestWith(session.cookie))).toEqual({ kind: 'anonymous' });
  });

  it('lands on the sign-in page even with no session at all, and writes no new cookie value', async () => {
    startAdminRequest({ origin: SITE_ORIGIN });
    expect(await redirectOf(() => signOutAction())).toBe('/admin/acceso?aviso=salida');
    for (const write of nextRequest.cookieWrites) expect(write.value).toBe('');
  });

  it.each([
    ['no Origin header', null],
    ['another site', 'https://evil.example'],
  ])('does not sign anyone out from another origin: %s', async (_label, origin) => {
    const session = await liveSession();
    startAdminRequest({ cookie: session.cookie, origin });

    expect(await redirectOf(() => signOutAction())).toBe('/admin/acceso?aviso=salida');

    expect(await sessionRows()).toHaveLength(1);
    expect(nextRequest.cookieWrites).toEqual([]);
    expect((await checkAdminSession(requestWith(session.cookie))).kind).toBe('admin');
  });

  it('still lands on the sign-in page when the store is down', async () => {
    const session = await liveSession();
    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      startAdminRequest({ cookie: session.cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => signOutAction())).toBe('/admin/acceso?aviso=salida');
    } finally {
      await closeDb();
      vi.unstubAllEnvs();
    }
  });

  it('ends only the signing-out browser: another session of the same admin stays live', async () => {
    const first = await liveSession();
    const second = await signInForCookie();
    startAdminRequest({ cookie: first.cookie, origin: SITE_ORIGIN });
    await redirectOf(() => signOutAction());
    expect((await checkAdminSession(requestWith(second.cookie))).kind).toBe('admin');
  });
});
