/**
 * Whether a request's Origin header is the site's own origin (D-16, AC 16).
 * A missing, empty, `null` or different Origin is refused. Pure: `siteUrl` is
 * the origin from `getSiteUrl()`. Next.js lets a server action through when the
 * header is absent, and Better Auth's own check does not run through
 * `auth.api`, so the sign-in and sign-out actions make this check themselves.
 */
export function isSameSiteOrigin(origin: string | null | undefined, siteUrl: string): boolean {
  if (!origin) return false;
  let given: string;
  try {
    given = new URL(origin).origin;
  } catch {
    return false;
  }
  return given === new URL(siteUrl).origin;
}
