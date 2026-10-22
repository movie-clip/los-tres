// Admin authentication constants. No `server-only` marker and no imports: the
// sign-in page passes the lifetime to its Spanish copy, and the CLI shares the
// password limits.

/** An admin session ends this many hours after sign-in: absolute, no idle timeout, no extension (D-9). */
export const SESSION_LIFETIME_HOURS = 8;

/** The session lifetime in seconds, as Better Auth's `session.expiresIn` takes it. */
export const SESSION_LIFETIME_SECONDS = SESSION_LIFETIME_HOURS * 60 * 60;

/** The shortest admin password; there is no composition rule (D-11). */
export const PASSWORD_MIN_LENGTH = 6;

/** The longest admin password Better Auth accepts at sign-in; the command refuses longer ones so no admin is locked out. */
export const PASSWORD_MAX_LENGTH = 128;

/** The only value ever stored in `admin_users.name`: no personal data. */
export const ADMIN_NAME = 'admin';

/** The session cookie name prefix: the cookie is `admin.session_token`. */
export const COOKIE_PREFIX = 'admin';
