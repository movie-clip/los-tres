import { sql } from 'drizzle-orm';

import { getDb } from '@/db/client';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store' } as const;
const CHECK_TIMEOUT_MS = 2000;

function respond(status: 'ok' | 'degraded', db: 'up' | 'down', code: number) {
  return Response.json({ status, db }, { status: code, headers: HEADERS });
}

/** A Postgres/driver error code (for example ECONNREFUSED), or a fixed word. */
function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && /^[A-Za-z0-9_]{1,32}$/.test(code)) {
      return code;
    }
  }
  return 'UNKNOWN';
}

export async function GET(): Promise<Response> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })),
        CHECK_TIMEOUT_MS,
      );
    });
    await Promise.race([getDb().execute(sql`select 1`), timeout]);
    return respond('ok', 'up', 200);
  } catch (error) {
    // Only the error code string: never a message, a URL or a password.
    console.error(`health: database check failed (${errorCode(error)})`);
    return respond('degraded', 'down', 503);
  } finally {
    clearTimeout(timer);
  }
}
