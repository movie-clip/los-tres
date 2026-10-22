import 'server-only';

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import { getAuthSecret, getSiteUrl } from '../../config/auth';
import { getDb } from '../../db/client';
import {
  adminAccounts,
  adminSessions,
  adminUsers,
  adminVerifications,
} from '../../db/schema';
import { COOKIE_PREFIX, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, SESSION_LIFETIME_SECONDS } from './config';

// Better Auth is used as a library, only through `auth.api.*` from this
// directory (src/server/auth). No HTTP route handler is mounted anywhere, so no
// sign-up, reset or session endpoint is reachable (guardrail 3, AC 1). The
// `nextCookies` plugin is not used: it would write the Set-Cookie headers of
// every call, including `getSession`, to the response. Cookies are forwarded
// by actions.ts, for sign-in and sign-out only (AC 12, D-15).

function createAuth(siteUrl: string, secret: string) {
  return betterAuth({
    database: drizzleAdapter(getDb(), {
      provider: 'pg',
      schema: { adminUsers, adminAccounts, adminSessions, adminVerifications },
    }),
    secret,
    baseURL: siteUrl,
    trustedOrigins: [siteUrl],
    user: { modelName: 'adminUsers' },
    account: { modelName: 'adminAccounts' },
    session: {
      modelName: 'adminSessions',
      // An absolute 8 hours from sign-in: no extension on activity, no cache of
      // the session in a cookie, so every request is checked against the row.
      expiresIn: SESSION_LIFETIME_SECONDS,
      disableSessionRefresh: true,
      cookieCache: { enabled: false },
    },
    verification: { modelName: 'adminVerifications' },
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: false,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
    },
    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      defaultCookieAttributes: { sameSite: 'strict' },
      useSecureCookies: siteUrl.startsWith('https:'),
      // Guardrail 5: no IP address on a session.
      ipAddress: { disableIpTracking: true },
    },
    databaseHooks: {
      session: {
        create: {
          // Better Auth stores '' for the IP and the request's user agent;
          // guardrail 5 wants null for both. The table's check constraint backs this.
          before: async (session) => ({
            data: { ...session, ipAddress: null, userAgent: null },
          }),
        },
      },
    },
    // Lockout and rate limits belong to S2.2; there is no IP-keyed store.
    rateLimit: { enabled: false },
    telemetry: { enabled: false },
    logger: { disabled: true },
  });
}

type Auth = ReturnType<typeof createAuth>;

let cached: { auth: Auth; key: string; db: ReturnType<typeof getDb> } | undefined;

/**
 * The Better Auth instance. Built on the first call and reused while the
 * database handle and the two settings are unchanged; importing this module
 * reads no environment and opens no connection (TD-5). Throws when AUTH_SECRET,
 * SITE_URL or DATABASE_URL is missing: callers treat that as "unavailable".
 */
export function getAuth(): Auth {
  const siteUrl = getSiteUrl();
  const secret = getAuthSecret();
  const db = getDb();
  const key = `${siteUrl}\n${secret}`;
  if (!cached || cached.db !== db || cached.key !== key) {
    cached = { auth: createAuth(siteUrl, secret), key, db };
  }
  return cached.auth;
}
