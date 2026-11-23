// The local flag for collected rows (S12.2, decision 0017, D-2, D-3).
//
// LOCAL_COLLECTED_DATA lifts the exclusion of marked rows (rows of a collected
// feed) from the public reads, and nothing else. It counts only beside a
// loopback SITE_URL: on any other origin the visibility scope treats it as off
// (the backstop), and every start path refuses to start with the line below.
//
// Pure on purpose (DS-11): no `server-only` and no `./env` import, both of which
// throw outside the react-server condition, because the instrumentation hook
// and the CLI start check import this file too. No I/O, no console. Every
// function reads the environment it is given on each call, never at module load.

/** The one refusal line. It names the two settings and never a value. */
export const LOCAL_FLAG_REFUSAL =
  'start refused: LOCAL_COLLECTED_DATA is on and SITE_URL is not a loopback origin';

/** sysexits EX_CONFIG: not 1 (a crash) and not 77 (a restart request to `next dev`). */
export const LOCAL_FLAG_REFUSAL_EXIT = 78;

type Env = Readonly<Record<string, string | undefined>>;

const LOOPBACK_V4 = /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

/** AC 11: on only for exactly `true`, trimmed and case-insensitive; anything else is off. */
export function isLocalFlagOn(env: Env = process.env): boolean {
  return (env.LOCAL_COLLECTED_DATA ?? '').trim().toLowerCase() === 'true';
}

/**
 * OD-2 (D-2): an http: or https: origin whose host is `localhost`, an address in
 * 127.0.0.0/8 or `[::1]`, judged on the WHATWG-canonical hostname (so `127.1`
 * and `[0:0:0:0:0:0:0:1]` count). Unset, blank, unparsable, another scheme or
 * any other host is not loopback: the judgement fails closed.
 */
export function isLoopbackOrigin(raw: string | undefined): boolean {
  const value = (raw ?? '').trim();
  if (value === '') return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const host = url.hostname;
  return host === 'localhost' || LOOPBACK_V4.test(host) || host === '[::1]';
}

/** Whether marked rows may be shown: the flag on AND a loopback SITE_URL (AC 13, 37). */
export function collectedRowsShown(env: Env = process.env): boolean {
  return isLocalFlagOn(env) && isLoopbackOrigin(env.SITE_URL);
}

/** The refusal line when the flag is on and SITE_URL is not loopback, else null (ACs 33 to 36). */
export function localFlagRefusal(env: Env = process.env): string | null {
  return isLocalFlagOn(env) && !isLoopbackOrigin(env.SITE_URL) ? LOCAL_FLAG_REFUSAL : null;
}
