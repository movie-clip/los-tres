import 'server-only';

/**
 * The only way a stored feed address becomes display text (guardrail 5, S3.1):
 * its host name alone, or null when it cannot be read as an address with a host
 * (the `demo-feed:` values, a file name, anything else). The host excludes the
 * scheme, user name, password, port, path, query and fragment, and the URL
 * parser has lower-cased it. Never returns, logs or throws the input.
 */
export function feedHost(stored: string): string | null {
  let url: URL;
  try {
    url = new URL(stored);
  } catch {
    return null;
  }
  return url.hostname !== '' ? url.hostname : null;
}
