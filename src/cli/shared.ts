import { closeDb } from '../db/client';

/**
 * Runs one CLI main: sets the exit code from its result, always closes the
 * pool, and on a throw prints only a short code, never the error message (a
 * driver message can carry a host, a URL or a row value; guardrail 5).
 */
export async function runCli(name: string, main: () => Promise<number>): Promise<void> {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(`${name}: failed (${describeError(error)})`);
    process.exitCode = 1;
  } finally {
    await closeDb().catch(() => {});
  }
}

/** A driver or system error code such as ECONNREFUSED or 28P01, or a "X is not set" notice. */
function describeError(error: unknown): string {
  if (error instanceof Error) {
    if (/^[A-Z][A-Z0-9_]* is not set$/.test(error.message)) return error.message;
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_]{1,20}$/.test(code)) return code;
  }
  return 'error';
}
