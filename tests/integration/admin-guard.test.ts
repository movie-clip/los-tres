import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { adminSessions } from '@/db/schema';
import { upsertAdmin } from '@/server/auth/accounts';
import { getAuth } from '@/server/auth/auth';
import {
  AdminUnavailableError,
  checkAdminSession,
  isAdminRefusal,
  requireAdminAction,
  requireAdminPage,
} from '@/server/auth/guard';

import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  consoleMethods,
  createAdmin,
  expireSessionRow,
  forge,
  requestWith,
  sessionRows,
  signInForCookie,
} from '../support/admin';
import { resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest, startRequest } from '../support/next-request';

// Guardrail 3 at the guard (AC 14, 17-21): every kind of cookie that is not a
// live session is treated exactly as no cookie, a live one is accepted, and a
// store that cannot be reached refuses. Run on a page check, an action check
// and the core check, so the three cannot drift apart.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

const SIGN_IN_REQUIRED = '/admin/acceso?aviso=sesion';
const DOWN_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';

let spies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(async () => {
  await resetDatabase();
  startRequest();
  spies = consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

/** Runs `fn` with the session store unreachable, then closes the dead pool. */
async function withStoreDown<T>(fn: () => Promise<T>): Promise<T> {
  await closeDb();
  vi.stubEnv('DATABASE_URL', DOWN_URL);
  try {
    return await fn();
  } finally {
    await closeDb();
    vi.unstubAllEnvs();
  }
}

/** Cookies that must all be refused the way an absent cookie is, each made fresh. */
async function notALiveSession(): Promise<Record<string, string | undefined>> {
  await createAdmin();

  const signedOut = await signInForCookie();
  await getAuth().api.signOut({ headers: requestWith(signedOut.cookie) });

  const expired = await signInForCookie();
  await expireSessionRow(expired.token);

  const ended = await signInForCookie();
  await upsertAdmin(getDb(), ADMIN_EMAIL, 'a-new-password-1');

  const live = await signInForCookie(ADMIN_EMAIL, 'a-new-password-1');
  return {
    none: undefined,
    empty: '',
    malformed: 'admin.session_token=not-a-session',
    'wrong cookie name': 'other=value',
    forged: forge(live.cookie),
    'signed out': signedOut.cookie,
    expired: expired.cookie,
    'ended by a create-admin re-run': ended.cookie,
  };
}

describe('the core check (checkAdminSession)', () => {
  it('accepts a live session and names the admin', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    const check = await checkAdminSession(requestWith(cookie));
    expect(check.kind).toBe('admin');
    if (check.kind === 'admin') {
      expect(check.admin.email).toBe(ADMIN_EMAIL);
      expect(check.admin.userId).toEqual(expect.any(String));
    }
  });

  it('treats every cookie that is not a live session exactly as no cookie (AC 19)', async () => {
    const cookies = await notALiveSession();
    const absent = await checkAdminSession(requestWith());
    expect(absent).toEqual({ kind: 'anonymous' });
    for (const [label, cookie] of Object.entries(cookies)) {
      expect(await checkAdminSession(requestWith(cookie)), label).toEqual(absent);
    }
  });

  it('makes a signed-out cookie unusable in another browser holding the same value (AC 15, AC 20)', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');
    // "Another browser": a second request, no shared state with the first.
    await getAuth().api.signOut({ headers: requestWith(cookie) });
    expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'anonymous' });
    expect(await sessionRows()).toEqual([]);
  });

  it('checks the row on every call: a session removed on the server is refused at once (AC 20)', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');
    await getDb().delete(adminSessions);
    expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'anonymous' });
  });

  it('ends only the re-run admin sessions, and the old password stops signing in (AC 4)', async () => {
    await createAdmin();
    await createAdmin('second@tests.example', 'second-pass-1');
    const first = await signInForCookie();
    const second = await signInForCookie('second@tests.example', 'second-pass-1');

    await upsertAdmin(getDb(), ADMIN_EMAIL, 'replaced-pass-1');

    expect(await checkAdminSession(requestWith(first.cookie))).toEqual({ kind: 'anonymous' });
    expect((await checkAdminSession(requestWith(second.cookie))).kind).toBe('admin');
    await expect(signInForCookie(ADMIN_EMAIL, ADMIN_PASSWORD)).rejects.toThrow();
    await expect(signInForCookie(ADMIN_EMAIL, 'replaced-pass-1')).resolves.toBeDefined();
  });

  it('fails closed when the session store cannot be reached (AC 21)', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    await withStoreDown(async () => {
      expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'unavailable' });
      // No cookie needs no lookup, so it is simply anonymous: refused either way.
      expect((await checkAdminSession(requestWith())).kind).not.toBe('admin');
    });
    // And it recovers once the store is back.
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');
  });

  it.each([
    ['AUTH_SECRET missing', 'AUTH_SECRET', ''],
    ['AUTH_SECRET too short', 'AUTH_SECRET', 'short'],
    ['SITE_URL missing', 'SITE_URL', ''],
    ['SITE_URL not a URL', 'SITE_URL', 'not a url'],
  ])('fails closed when the settings are unusable: %s', async (_label, name, value) => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    vi.stubEnv(name, value);
    expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'unavailable' });
  });

  it('logs a short code only when it fails closed, never the cookie or an address', async () => {
    await createAdmin();
    const { cookie, token } = await signInForCookie();
    await withStoreDown(() => checkAdminSession(requestWith(cookie)));
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).toContain('admin-guard: unavailable');
    for (const secret of [token, cookie, ADMIN_EMAIL, ADMIN_PASSWORD, 'nothing']) {
      expect(logged).not.toContain(secret);
    }
  });
});

describe('an admin page (requireAdminPage)', () => {
  it('returns the admin for a live session', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    startAdminRequest({ cookie });
    const admin = await requireAdminPage();
    expect(admin.email).toBe(ADMIN_EMAIL);
  });

  it('sends every non-session cookie to the sign-in page and shows nothing (AC 17)', async () => {
    const cookies = await notALiveSession();
    for (const [label, cookie] of Object.entries(cookies)) {
      startAdminRequest({ cookie });
      expect(await redirectOf(() => requireAdminPage()), label).toBe(SIGN_IN_REQUIRED);
    }
  });

  it('throws the unavailable error, rendering nothing, when the store is down', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    await withStoreDown(async () => {
      startAdminRequest({ cookie });
      await expect(requireAdminPage()).rejects.toBeInstanceOf(AdminUnavailableError);
    });
  });
});

describe('an admin action (requireAdminAction)', () => {
  it('returns the admin for a live session', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    startAdminRequest({ cookie });
    const who = await requireAdminAction();
    expect(isAdminRefusal(who)).toBe(false);
    expect(who).toMatchObject({ email: ADMIN_EMAIL });
  });

  it('refuses every non-session cookie as unauthenticated, with no redirect (AC 18)', async () => {
    const cookies = await notALiveSession();
    for (const [label, cookie] of Object.entries(cookies)) {
      startAdminRequest({ cookie });
      const who = await requireAdminAction();
      expect(who, label).toEqual({ ok: false, reason: 'unauthenticated' });
      expect(isAdminRefusal(who)).toBe(true);
    }
  });

  it('refuses as unavailable when the store is down (AC 21)', async () => {
    await createAdmin();
    const { cookie } = await signInForCookie();
    await withStoreDown(async () => {
      startAdminRequest({ cookie });
      expect(await requireAdminAction()).toEqual({ ok: false, reason: 'unavailable' });
    });
  });
});

describe('a guarded request sets no cookie (AC 12, D-13, D-15)', () => {
  it('writes nothing for a live, expired, signed-out, forged or absent cookie', async () => {
    const cookies = await notALiveSession();
    const live = await signInForCookie(ADMIN_EMAIL, 'a-new-password-1');
    for (const cookie of [live.cookie, ...Object.values(cookies)]) {
      startAdminRequest({ cookie });
      await checkAdminSession(nextRequest.headers);
      await requireAdminAction();
      await requireAdminPage().catch(() => undefined);
    }
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('drops the Max-Age=0 clears the framework answers an expired cookie with', async () => {
    // Better Auth itself answers an expired cookie with clears (recon C5, D-15);
    // the guard must not pass them on. Its return value holds no headers.
    await createAdmin();
    const { cookie, token } = await signInForCookie();
    await expireSessionRow(token);
    const raw = await getAuth().api.getSession({
      headers: requestWith(cookie),
      returnHeaders: true,
    });
    expect(raw.headers.get('set-cookie') ?? '').toMatch(/Max-Age=0/i);

    const check = await checkAdminSession(requestWith(cookie));
    expect(check).toEqual({ kind: 'anonymous' });
    expect(Object.keys(check)).toEqual(['kind']);
  });
});

describe('the session lifetime (D-9, AC 14)', () => {
  it('ends the session 8 hours after sign-in, with a request just before it accepted', async () => {
    await createAdmin();
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-10-22T09:00:00.000Z');
    vi.setSystemTime(start);
    const { cookie } = await signInForCookie();

    const [row] = await sessionRows();
    expect(row.expiresAt.getTime() - start.getTime()).toBe(8 * 60 * 60 * 1000);

    vi.setSystemTime(new Date(start.getTime() + 8 * 3600_000 - 60_000));
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');

    vi.setSystemTime(new Date(start.getTime() + 8 * 3600_000 + 60_000));
    expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'anonymous' });
  });

  it('has no idle timeout and no extension: activity never moves the end', async () => {
    await createAdmin();
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = new Date('2026-10-22T09:00:00.000Z');
    vi.setSystemTime(start);
    const { cookie } = await signInForCookie();
    const [before] = await sessionRows();

    // Seven hours of silence, then a request: still in, and the end did not move.
    vi.setSystemTime(new Date(start.getTime() + 7 * 3600_000));
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');
    const [after] = await sessionRows();
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());

    // Activity near the end does not buy more time: past 8 hours the session is over.
    vi.setSystemTime(new Date(start.getTime() + 7 * 3600_000 + 30 * 60_000));
    expect((await checkAdminSession(requestWith(cookie))).kind).toBe('admin');
    vi.setSystemTime(new Date(start.getTime() + 8 * 3600_000 + 1000));
    expect(await checkAdminSession(requestWith(cookie))).toEqual({ kind: 'anonymous' });
  });

  it('keeps the end on the row, not only in the cookie', async () => {
    await createAdmin();
    const { token } = await signInForCookie();
    const [row] = await getDb().select().from(adminSessions).where(eq(adminSessions.token, token));
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 7.9 * 3600_000);
    expect(row.expiresAt.getTime()).toBeLessThan(Date.now() + 8.1 * 3600_000);
  });
});
