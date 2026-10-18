// The page a click came from, as a same-origin site path or null (S1.1).
// Pure: no server-only import, no I/O. The Referer string is read here in
// memory and goes no further; it is never stored or logged.

const MAX_LENGTH = 200;
// Every route we own is lowercase kebab, so this loses nothing. It matches the
// database check clicks_source_page_format.
const PATH_FORMAT = /^\/([a-z0-9_-]+(\/[a-z0-9_-]+)*\/?)?$/;

/**
 * The path of `referer` when it is a page of this site, else null.
 * `host` is the request's own Host header. A foreign origin gives null: a
 * foreign page's path can carry a person's data and is not our page. The query
 * string and the fragment are dropped, never stored.
 */
export function sourcePageFromReferer(referer: string | null, host: string | null): string | null {
  if (!referer || !host) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.host.toLowerCase() !== host.trim().toLowerCase()) return null;
  // `new URL` resolves dot segments, so `/a/..` would come out as `/`: judge
  // the text we were given, before the query and fragment, not the resolved one.
  if (/\.\.|%2e/i.test(referer.split(/[?#]/)[0])) return null;
  const path = url.pathname;
  if (path.length > MAX_LENGTH || !PATH_FORMAT.test(path)) return null;
  return path;
}
