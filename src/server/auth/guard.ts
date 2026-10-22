import 'server-only';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';

import { errorCode } from '../error-code';
import { getAuth } from './auth';

// The server-side role check (guardrail 3). Every admin page calls
// requireAdminPage, every admin server action calls requireAdminAction as its
// first statement. This file is the only reader of the session cookie in src.

export type AdminIdentity = { userId: string; email: string | null };

export type AdminCheck =
  | { kind: 'admin'; admin: AdminIdentity }
  // None, forged, malformed, expired, signed out, or ended by a create-admin re-run.
  | { kind: 'anonymous' }
  // The store is unreachable or anything threw: fail closed (AC 21).
  | { kind: 'unavailable' };

export type AdminRefusal = { ok: false; reason: 'unauthenticated' | 'unavailable' };

/** Thrown by `requireAdminPage` when the check is unavailable; `src/app/admin/error.tsx` renders the Unavailable screen. */
export class AdminUnavailableError extends Error {
  constructor() {
    super('admin unavailable');
    this.name = 'AdminUnavailableError';
  }
}

/**
 * The core check: who, if anyone, do these request headers belong to. Asks
 * Better Auth for the session with the cookie cache bypassed, so the session row
 * is read on every call (AC 20). Any error is `unavailable`, never `admin`.
 *
 * Better Auth answers an expired or signed-out cookie with Set-Cookie clears
 * (Max-Age=0). They are asked for as `returnHeaders` and dropped here, and no
 * cookie plugin is installed, so a guarded request never carries a cookie header
 * (AC 12, D-15). Logs only a short error code, never an email or a token.
 */
export async function checkAdminSession(requestHeaders: Headers): Promise<AdminCheck> {
  try {
    const result = await getAuth().api.getSession({
      headers: requestHeaders,
      query: { disableCookieCache: true },
      returnHeaders: true,
    });
    // result.headers (any Set-Cookie) is deliberately discarded.
    const session = result.response;
    if (!session) return { kind: 'anonymous' };
    return { kind: 'admin', admin: { userId: session.user.id, email: session.user.email ?? null } };
  } catch (error) {
    console.error(`admin-guard: unavailable (${errorCode(error)})`);
    return { kind: 'unavailable' };
  }
}

// One check per request however many components ask (layout and page).
const checkRequest = cache(async (): Promise<AdminCheck> => checkAdminSession(await headers()));

/**
 * For an admin page or layout: returns the admin, redirects an anonymous
 * request to the sign-in page, and throws `AdminUnavailableError` when the check
 * is unavailable. Nothing admin renders in the last two cases.
 */
export async function requireAdminPage(): Promise<AdminIdentity> {
  const check = await checkRequest();
  if (check.kind === 'admin') return check.admin;
  if (check.kind === 'anonymous') redirect('/admin/acceso?aviso=sesion');
  throw new AdminUnavailableError();
}

/**
 * For an admin server action, as its first statement. Returns the admin, or a
 * refusal the action returns with no effect. Not cached: an action checks the
 * session at the moment it runs.
 */
export async function requireAdminAction(): Promise<AdminIdentity | AdminRefusal> {
  const check = await checkAdminSession(await headers());
  if (check.kind === 'admin') return check.admin;
  return { ok: false, reason: check.kind === 'anonymous' ? 'unauthenticated' : 'unavailable' };
}

/** Narrows the result of `requireAdminAction`. */
export function isAdminRefusal(result: AdminIdentity | AdminRefusal): result is AdminRefusal {
  return 'ok' in result && result.ok === false;
}
