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
