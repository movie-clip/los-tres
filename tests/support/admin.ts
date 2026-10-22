import { eq } from 'drizzle-orm';

import { getDb } from '@/db/client';
import { adminAccounts, adminSessions, adminUsers } from '@/db/schema';
import { createAdminForTest } from '@/server/auth/accounts';
import { getAuth } from '@/server/auth/auth';

// Support for the admin sign-in tests (US-2.1). Accounts are made through the
// same code the create-admin command runs, and a session is made through
// Better Auth's own sign-in, so a test cookie is a real one.

export const ADMIN_EMAIL = 'admin@tests.example';
export const ADMIN_PASSWORD = 'correct-horse-9';
export const COOKIE_NAME = 'admin.session_token';

/** SITE_URL as set by tests/support/test-database-env.ts. */
export const SITE_ORIGIN = 'http://127.0.0.1:3000';

export async function createAdmin(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<string> {
  return createAdminForTest(getDb(), email, password);
}

export type TestSession = {
  /** `name=value`, ready for a Cookie request header. */
  cookie: string;
  /** The whole Set-Cookie header Better Auth produced. */
  setCookie: string;
  /** The raw session token (the part of the value before the signature). */
  token: string;
};

/** Signs in through Better Auth and returns the cookie it would set. */
export async function signInForCookie(email = ADMIN_EMAIL, password = ADMIN_PASSWORD): Promise<TestSession> {
  const result = await getAuth().api.signInEmail({
    body: { email, password },
    headers: new Headers(),
    returnHeaders: true,
  });
  const setCookie = result.headers.get('set-cookie') ?? '';
  const cookie = setCookie.split(';')[0];
  const value = decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1));
  return { cookie, setCookie, token: value.split('.')[0] };
}

/** Request headers carrying a cookie (or none). */
export function requestWith(cookie?: string): Headers {
  const headers = new Headers();
  if (cookie) headers.set('cookie', cookie);
  return headers;
}

export async function sessionRows() {
  return getDb().select().from(adminSessions);
}

export async function accountRows() {
  return getDb().select().from(adminAccounts);
}

export async function userRows() {
  return getDb().select().from(adminUsers);
}

/** Moves a session's end into the past, the way eight hours going by would. */
export async function expireSessionRow(token: string): Promise<void> {
  await getDb()
    .update(adminSessions)
    .set({ expiresAt: new Date(Date.now() - 60_000) })
    .where(eq(adminSessions.token, token));
}

/** The same cookie with its signature changed: a forged value. */
export function forge(cookie: string): string {
  const [name, ...rest] = cookie.split('=');
  const value = rest.join('=');
  const first = value[0] === 'a' ? 'b' : 'a';
  return `${name}=${first}${value.slice(1)}`;
}

export const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
