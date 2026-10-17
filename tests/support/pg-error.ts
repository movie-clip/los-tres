/**
 * The Postgres error behind a rejected Drizzle query: `code` (SQLSTATE) and
 * `constraint`. Drizzle wraps the driver error as `cause`.
 */
export async function pgErrorOf(
  promise: PromiseLike<unknown>,
): Promise<{ code?: string; constraint?: string }> {
  try {
    await promise;
  } catch (error) {
    const root = (error as { cause?: unknown }).cause ?? error;
    const { code, constraint } = root as { code?: string; constraint?: string };
    return { code, constraint };
  }
  throw new Error('expected the query to be rejected by the database');
}
