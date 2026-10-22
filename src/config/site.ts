import 'server-only';

import { getSiteUrl } from './auth';
import { readRequiredEnv } from './env';

/**
 * The public site name. Configuration, not code: read from SITE_NAME on every
 * call, so a changed value needs a container restart and not a rebuild.
 * Throws `Error("SITE_NAME is not set")` when missing or blank.
 */
export function getSiteName(): string {
  return readRequiredEnv('SITE_NAME');
}

/**
 * The public origin for canonical URLs and the sitemap, or `null` when it is
 * not configured. It is the same origin the admin area is served from. Public
 * pages must keep working without it, so this never throws: a caller omits the
 * canonical, the robots `Sitemap:` line and the sitemap, and does not fail.
 * Read on every call.
 */
export function getPublicOrigin(): string | null {
  try {
    return getSiteUrl();
  } catch {
    return null;
  }
}
