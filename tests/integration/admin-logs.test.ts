import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { upsertAdmin } from '@/server/auth/accounts';
import { signInAction, signOutAction, type SignInState } from '@/server/auth/actions';
import { checkAdminSession, requireAdminAction, requireAdminPage } from '@/server/auth/guard';

import { SITE_ORIGIN, consoleMethods, expireSessionRow, forge, requestWith, signInForCookie } from '../support/admin';
import { resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// Guardrail 5, AC 28: sign-in success, sign-in failure, sign-out, a guard
// refusal and an account write put no email, password or session value into any
// console or process output. Recognisable sentinels are planted and searched for.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);

const EMAIL = 'LogSentinel.7c1e@sentinel.example';
const PASSWORD = 'PW-SENTINEL-4d9a22';
const WRONG = 'WRONG-SENTINEL-93be10';
const UNKNOWN = 'nobody.sentinel-55aa@sentinel.example';
const DOWN_URL = 'postgres://nobody:nothing@127.0.0.1:1/none';
const FORM_IDLE: SignInState = { status: 'idle' };

let output: string[] = [];

function capture() {
  output = [];
  for (const method of consoleMethods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  // Direct writes to the process streams, which a library might use instead of console.
  for (const stream of [process.stdout, process.stderr]) {
    vi.spyOn(stream, 'write').mockImplementation(((chunk: unknown) => {
      output.push(String(chunk));
      return true;
    }) as never);
  }
}

/** Fails if anything captured holds a planted value, in any case or encoding a log line might use. */
function expectNoSentinel(values: string[]) {
  const text = output.join('\n');
  const encodings = values.flatMap((value) => [
    value,
    value.toLowerCase(),
    value.toUpperCase(),
    encodeURIComponent(value),
    Buffer.from(value).toString('base64'),
    JSON.stringify(value),
  ]);
  for (const needle of encodings) expect(text, `output holds ${needle.slice(0, 6)}...`).not.toContain(needle);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

async function signInAs(fields: Record<string, string>, origin: string | null = SITE_ORIGIN) {
  startAdminRequest({ origin });
  try {
    return { state: await signInAction(FORM_IDLE, form(fields)) };
  } catch (error) {
    return { redirectedTo: await redirectOf(() => Promise.reject(error)) };
  }
}

beforeEach(async () => {
  await resetDatabase();
  await upsertAdmin(getDb(), EMAIL, PASSWORD);
  capture();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

describe('nothing sensitive reaches a log (AC 28)', () => {
  it('on a successful sign-in', async () => {
    const result = await signInAs({ email: EMAIL, password: PASSWORD });
    expect(result.redirectedTo).toBe('/admin');
    const { value } = nextRequest.cookieWrites[0];
    expectNoSentinel([EMAIL, 'LogSentinel', PASSWORD, value, decodeURIComponent(value).split('.')[0]]);
  });

  it('on a failed sign-in: wrong password, unknown email, empty and malformed input', async () => {
    await signInAs({ email: EMAIL, password: WRONG });
    await signInAs({ email: UNKNOWN, password: WRONG });
    await signInAs({ email: '', password: WRONG });
    await signInAs({ email: EMAIL, password: '' });
    await signInAs({ email: 'no-at-sign-sentinel', password: WRONG });
    expectNoSentinel([EMAIL, 'LogSentinel', UNKNOWN, 'nobody.sentinel', PASSWORD, WRONG, 'no-at-sign-sentinel']);
  });

  it('on a sign-in refused for its origin', async () => {
    await signInAs({ email: EMAIL, password: PASSWORD }, 'https://evil.example');
    await signInAs({ email: EMAIL, password: PASSWORD }, null);
    expectNoSentinel([EMAIL, 'LogSentinel', PASSWORD]);
  });

  it('on a sign-in while the store is down', async () => {
    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      await signInAs({ email: EMAIL, password: PASSWORD });
    } finally {
      await closeDb();
    }
    expectNoSentinel([EMAIL, 'LogSentinel', PASSWORD, 'nothing']);
  });

  it('on sign-out, with a live session, from another origin, and with the store down', async () => {
    const session = await signInForCookie(EMAIL, PASSWORD);
    startAdminRequest({ cookie: session.cookie, origin: SITE_ORIGIN });
    await redirectOf(() => signOutAction());

    const second = await signInForCookie(EMAIL, PASSWORD);
    startAdminRequest({ cookie: second.cookie, origin: 'https://evil.example' });
    await redirectOf(() => signOutAction());

    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      startAdminRequest({ cookie: second.cookie, origin: SITE_ORIGIN });
      await redirectOf(() => signOutAction());
    } finally {
      await closeDb();
    }
    expectNoSentinel([EMAIL, 'LogSentinel', PASSWORD, session.token, second.token, session.cookie, second.cookie]);
  });

  it('on a guard refusal: forged, expired, signed-out and unavailable', async () => {
    const live = await signInForCookie(EMAIL, PASSWORD);
    const expired = await signInForCookie(EMAIL, PASSWORD);
    await expireSessionRow(expired.token);

    for (const cookie of [forge(live.cookie), expired.cookie, 'admin.session_token=garbage-sentinel']) {
      startAdminRequest({ cookie });
      await checkAdminSession(nextRequest.headers);
      await requireAdminAction();
      await requireAdminPage().catch(() => undefined);
    }
    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      startAdminRequest({ cookie: live.cookie });
      await checkAdminSession(requestWith(live.cookie));
      await requireAdminAction();
    } finally {
      await closeDb();
    }
    expectNoSentinel([EMAIL, 'LogSentinel', PASSWORD, live.token, expired.token, live.cookie, 'garbage-sentinel']);
  });

  it('on an account write: create, re-run and refusal', async () => {
    await upsertAdmin(getDb(), EMAIL, 'REPLACED-SENTINEL-77c0');
    await upsertAdmin(getDb(), 'ANOTHER.sentinel@sentinel.example', 'ANOTHER-SENTINEL-18ef');
    await upsertAdmin(getDb(), 'refused.sentinel@sentinel.example', 'abc').catch(() => undefined);
    expectNoSentinel([
      EMAIL,
      'LogSentinel',
      PASSWORD,
      'REPLACED-SENTINEL',
      'ANOTHER',
      'ANOTHER-SENTINEL-18ef',
      'refused.sentinel',
    ]);
  });

  it('and the guard logs only a short code when it fails', async () => {
    const live = await signInForCookie(EMAIL, PASSWORD);
    await closeDb();
    vi.stubEnv('DATABASE_URL', DOWN_URL);
    try {
      await checkAdminSession(requestWith(live.cookie));
    } finally {
      await closeDb();
    }
    const guardLines = output.filter((line) => line.includes('admin-guard'));
    expect(guardLines.length).toBeGreaterThan(0);
    for (const line of guardLines) expect(line).toMatch(/^admin-guard: unavailable \([A-Za-z0-9_]{1,40}\)$/);
  });
});
