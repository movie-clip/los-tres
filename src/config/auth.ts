import 'server-only';

import { readRequiredEnv } from './env';

/** The shortest AUTH_SECRET accepted; `npm run env:init` writes 48 hex characters. */
const AUTH_SECRET_MIN_LENGTH = 32;

/**
 * The secret that signs the admin session cookie (AUTH_SECRET). Read on every
 * call, never at module load. Throws `Error("AUTH_SECRET is not set")` when
 * missing or blank, and a message naming only the variable when it is too
 * short. Never log the value.
 */
export function getAuthSecret(): string {
  const secret = readRequiredEnv('AUTH_SECRET');
  if (secret.length < AUTH_SECRET_MIN_LENGTH) {
    throw new Error('AUTH_SECRET is too short');
  }
  return secret;
}

/**
 * The origin the site is served from (SITE_URL, for example
 * `http://127.0.0.1:3000`): scheme, host and port only. It is the one origin
 * the sign-in and sign-out actions accept, and it decides whether the session
 * cookie is marked Secure. Throws `Error("SITE_URL is not set")` when missing or
 * blank, and a message naming only the variable when it is not an http(s) URL.
 */
export function getSiteUrl(): string {
  const raw = readRequiredEnv('SITE_URL');
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('SITE_URL is not a URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SITE_URL is not a URL');
  }
  return url.origin;
}
