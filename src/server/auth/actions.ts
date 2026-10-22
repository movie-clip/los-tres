'use server';

import 'server-only';

import { isAPIError } from 'better-auth/api';
import { parseSetCookieHeader, toCookieOptions } from 'better-auth/cookies';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';

import { getSiteUrl } from '../../config/auth';
import { normalizeEmail } from './accounts';
import { getAuth } from './auth';
import { isSameSiteOrigin } from './origin';

// Sign-in and sign-out, called by the sign-in page and the admin shell. These
// are the only places a cookie is ever set (AC 12). Neither mounts a Better
// Auth HTTP route. Both refuse a missing or different Origin before Better
// Auth is called (D-16, AC 16). Nothing here logs an email, a password or a
// token: only a short code.

export type SignInState =
  | { status: 'idle' }
  | {
      status: 'invalid';
      email: string;
      fieldErrors: { email?: 'required' | 'invalid'; password?: 'required' };
    }
  // A wrong password and an unknown email are the same state (AC 10).
  | { status: 'rejected'; email: string }
  // The store is down, the origin was refused, or anything unexpected.
  | { status: 'unavailable'; email: string };

/** Better Auth codes that mean "these credentials do not sign in", all shown as one answer. */
const REJECTED_CODES = new Set([
  'INVALID_EMAIL_OR_PASSWORD',
  'INVALID_EMAIL',
  'INVALID_PASSWORD',
  'PASSWORD_TOO_LONG',
  'PASSWORD_TOO_SHORT',
]);

function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

/** A short upper-case code for a log line, or UNKNOWN. Never a message. */
function codeOf(error: unknown): string {
  if (isAPIError(error)) {
    const code = (error.body as { code?: unknown } | undefined)?.code;
    if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code;
  }
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)) return code;
  }
  return 'UNKNOWN';
}

/** Whether this request came from the site's own origin. Reads no body. */
async function originAllowed(): Promise<boolean> {
  const requestHeaders = await headers();
  return isSameSiteOrigin(requestHeaders.get('origin'), getSiteUrl());
}

/** Applies Better Auth's Set-Cookie headers to this response. The only cookie writer in src. */
async function forwardCookies(responseHeaders: Headers): Promise<void> {
  const raw = responseHeaders.get('set-cookie');
  if (!raw) return;
  const store = await cookies();
  for (const [name, attributes] of parseSetCookieHeader(raw)) {
    store.set(name, attributes.value, toCookieOptions(attributes));
  }
}

/**
 * Signs an admin in. Validation first (no lookup for an invalid field), then the
 * Origin check, then Better Auth. Success sets the session cookie and redirects
 * to `/admin`; a refusal returns a state and sets no cookie.
 */
export async function signInAction(_previous: SignInState, form: FormData): Promise<SignInState> {
  const typedEmail = field(form, 'email').trim();
  const password = field(form, 'password');

  const fieldErrors: { email?: 'required' | 'invalid'; password?: 'required' } = {};
  if (typedEmail === '') fieldErrors.email = 'required';
  else if (!/^[^\s@]+@[^\s@]+$/.test(typedEmail)) fieldErrors.email = 'invalid';
  if (password === '') fieldErrors.password = 'required';
  if (fieldErrors.email || fieldErrors.password) {
    return { status: 'invalid', email: typedEmail, fieldErrors };
  }

  let signedIn: Headers;
  try {
    if (!(await originAllowed())) {
      console.error('admin-sign-in: refused (ORIGIN)');
      return { status: 'unavailable', email: typedEmail };
    }
    const result = await getAuth().api.signInEmail({
      body: { email: normalizeEmail(typedEmail), password },
      // No request headers: Better Auth reads an IP and a user agent from them.
      headers: new Headers(),
      returnHeaders: true,
    });
    signedIn = result.headers;
  } catch (error) {
    const code = codeOf(error);
    if (isAPIError(error) && REJECTED_CODES.has(code)) {
      return { status: 'rejected', email: typedEmail };
    }
    console.error(`admin-sign-in: unavailable (${code})`);
    return { status: 'unavailable', email: typedEmail };
  }

  try {
    await forwardCookies(signedIn);
  } catch {
    console.error('admin-sign-in: unavailable (COOKIE)');
    return { status: 'unavailable', email: typedEmail };
  }
  redirect('/admin');
}

/**
 * Signs the admin out: ends the session row, clears the cookie, and always ends
 * at the sign-in page. A missing or different Origin skips Better Auth, so
 * another site cannot sign an admin out.
 */
export async function signOutAction(): Promise<void> {
  try {
    if (await originAllowed()) {
      const result = await getAuth().api.signOut({
        headers: await headers(),
        returnHeaders: true,
      });
      await forwardCookies(result.headers);
    } else {
      console.error('admin-sign-out: refused (ORIGIN)');
    }
  } catch (error) {
    console.error(`admin-sign-out: failed (${codeOf(error)})`);
  }
  redirect('/admin/acceso?aviso=salida');
}
