/**
 * A Postgres/driver error code (for example ECONNREFUSED), or the fixed word
 * UNKNOWN. The only part of an error a log line may carry: never a message, a
 * URL or a password.
 */
export function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
      return code;
    }
  }
  return 'UNKNOWN';
}

/**
 * The code of a failed database call: that of the driver error under a Drizzle
 * wrapper (`error.cause`) when it has one, else of the error itself. Only a
 * short code comes out, never a message (a Drizzle message embeds the bound
 * parameters).
 */
export function driverErrorCode(error: unknown): string {
  const cause =
    typeof error === 'object' && error !== null ? (error as { cause?: unknown }).cause : undefined;
  const code = errorCode(cause);
  return code === 'UNKNOWN' ? errorCode(error) : code;
}
