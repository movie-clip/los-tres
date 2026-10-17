import 'server-only';

import { readRequiredEnv } from './env';

/**
 * The public site name. Configuration, not code: read from SITE_NAME on every
 * call, so a changed value needs a container restart and not a rebuild.
 * Throws `Error("SITE_NAME is not set")` when missing or blank.
 */
export function getSiteName(): string {
  return readRequiredEnv('SITE_NAME');
}
