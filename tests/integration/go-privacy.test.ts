import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';

import { resetDatabase } from '../support/db';
import { allClicks, callGo, GO_HOST, insertGoOffer } from '../support/go';

// Guardrail 5 at /go/<offer>, the test deferred from slice B: nothing about the
// visitor is stored, set or logged. Failures are forced by mocking the two
// modules that touch the database, so the real handler and route still run.

const failures = vi.hoisted(() => ({
  record: null as Error | null,
  lookup: null as Error | null,
}));

vi.mock('@/server/clicks/record', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/clicks/record')>();
  return {
    ...actual,
    recordClick: (...args: Parameters<typeof actual.recordClick>) => {
      if (failures.record) throw failures.record;
      return actual.recordClick(...args);
    },
  };
});

vi.mock('@/server/clicks/offer-target', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/clicks/offer-target')>();
  return {
    ...actual,
    getRedirectTarget: (...args: Parameters<typeof actual.getRedirectTarget>) => {
      if (failures.lookup) throw failures.lookup;
      return actual.getRedirectTarget(...args);
    },
  };
});

const SENTINEL = {
  userAgent: 'Mozilla/5.0 (X11; Linux) UA-SENTINEL-7f3a91 Firefox/131.0',
  cookie: 'session=COOKIE-SENTINEL-2b8c44',
  forwardedFor: '203.0.113.77',
  realIp: '198.51.100.23',
  refererQuery: 'REFERER-SENTINEL-5d1e08',
};
const VISITOR_VALUES = [
  'UA-SENTINEL-7f3a91',
  'COOKIE-SENTINEL-2b8c44',
  '203.0.113.77',
  '198.51.100.23',
  'REFERER-SENTINEL-5d1e08',
];
const OFFER_URL = 'https://affiliate.example/p/sentinel-offer-url?tag=OFFER-URL-SENTINEL';

const consoleMethods = ['log', 'info', 'warn', 'error', 'debug'] as const;
function spyConsole() {
  return consoleMethods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));
}
const loggedText = (spies: ReturnType<typeof spyConsole>) =>
  JSON.stringify(spies.flatMap((spy) => spy.mock.calls));

const visitor = {
  'user-agent': SENTINEL.userAgent,
  cookie: SENTINEL.cookie,
  'x-forwarded-for': SENTINEL.forwardedFor,
  'x-real-ip': SENTINEL.realIp,
  referer: `http://${GO_HOST}/producto/x?q=${SENTINEL.refererQuery}`,
};

beforeEach(async () => {
  await resetDatabase();
  failures.record = null;
  failures.lookup = null;
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

describe('guardrail 5: a counted /go click holds no personal data', () => {
  it('stores none of the visitor values in the click row, sets no cookie and logs nothing', async () => {
    const { offerId } = await insertGoOffer({ offer: { url: OFFER_URL } });
    const spies = spyConsole();

    const response = await callGo(offerId, { headers: visitor });

    // The request really was counted, so the checks below are not vacuous.
    expect(response.status).toBe(302);
    expect(await allClicks()).toHaveLength(1);

    // (a) the whole row, as the database serialises it
    const dump = await getDb().execute<{ row: string }>(sql`select row_to_json(c)::text as row from clicks c`);
    expect(dump.rows).toHaveLength(1);
    for (const value of VISITOR_VALUES) {
      expect(dump.rows[0].row).not.toContain(value);
    }
    // the only text of the visitor's Referer that may survive is our own path
    expect(JSON.parse(dump.rows[0].row)).toMatchObject({ source_page: '/producto/x' });

    // (b) no cookie of any kind
    expect(response.headers.get('set-cookie')).toBeNull();

    // (c) nothing at all written to the console on a counted request
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    const text = loggedText(spies);
    for (const value of [...VISITOR_VALUES, 'OFFER-URL-SENTINEL', 'affiliate.example']) {
      expect(text).not.toContain(value);
    }
  });

  it('logs nothing on a 404 and on a skipped request either', async () => {
    const hiddenOffer = await insertGoOffer({ offer: { isHidden: true, url: OFFER_URL } });
    const demoOffer = await insertGoOffer({ feed: { isDemo: true }, offer: { url: OFFER_URL } });
    const spies = spyConsole();

    await callGo(hiddenOffer.offerId, { headers: visitor });
    await callGo(demoOffer.offerId, { headers: visitor });
    await callGo('abc', { headers: visitor });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it('still redirects when the insert fails, and logs only a fixed line with a code', async () => {
    const { offerId } = await insertGoOffer({ offer: { url: OFFER_URL } });
    failures.record = Object.assign(new Error(`insert failed for ${OFFER_URL} ua ${SENTINEL.userAgent}`), {
      code: '57P01',
    });
    const spies = spyConsole();

    const response = await callGo(offerId, { headers: visitor });

    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(new URL(OFFER_URL).href);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(await allClicks()).toEqual([]);

    const calls = spies.flatMap((spy) => spy.mock.calls);
    expect(calls).toEqual([['go: click not recorded (57P01)']]);
    const text = loggedText(spies);
    for (const value of [...VISITOR_VALUES, 'OFFER-URL-SENTINEL', 'affiliate.example']) {
      expect(text).not.toContain(value);
    }
  });

  it('logs the fixed word UNKNOWN, never the message, when the failure has no code', async () => {
    const { offerId } = await insertGoOffer({ offer: { url: OFFER_URL } });
    failures.record = new Error(`boom ${OFFER_URL}`);
    const spies = spyConsole();

    const response = await callGo(offerId, { headers: visitor });

    expect(response.status).toBe(302);
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([['go: click not recorded (UNKNOWN)']]);
  });

  it('answers 503 with no body and no cookie when the lookup fails, logging only a fixed line', async () => {
    const { offerId } = await insertGoOffer({ offer: { url: OFFER_URL } });
    failures.lookup = Object.assign(new Error(`lookup failed for ${OFFER_URL} ua ${SENTINEL.userAgent}`), {
      code: 'ECONNREFUSED',
    });
    const spies = spyConsole();

    const response = await callGo(offerId, { headers: visitor });

    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('location')).toBeNull();
    expect(await response.text()).toBe('');
    expect(await allClicks()).toEqual([]);

    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([['go: lookup failed (ECONNREFUSED)']]);
    const text = loggedText(spies);
    for (const value of [...VISITOR_VALUES, 'OFFER-URL-SENTINEL', 'affiliate.example']) {
      expect(text).not.toContain(value);
    }
  });
});
