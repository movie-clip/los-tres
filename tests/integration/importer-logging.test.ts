import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { formatImportReport, importFeeds } from '@/server/importer';

import { insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { textDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

// Guardrail 5 and TD-36: a feed URL can hold a network API key, and a row can
// hold personal text. Neither reaches the report text, the report object or any
// console output.

const KEY = 'api-key-sentinel-5d2f';
const FEED_URL = `https://feeds.example/export.csv?api_key=${KEY}`;
const EMAIL = 'persona.sentinel@correo.example';
const ROW_TITLE = 'titulo-sentinel-de-fila';

let fetchStub: ReturnType<typeof stubNetworkOff>;
let consoleCalls: () => string;

beforeEach(async () => {
  await resetDatabase();
  fetchStub = stubNetworkOff();
  const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
    vi.spyOn(console, method).mockImplementation(() => {}),
  );
  consoleCalls = () => JSON.stringify(spies.map((spy) => spy.mock.calls));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

async function registerKeyedFeed() {
  const shop = await insertShop({ name: 'Tienda Con Clave' });
  const feedId = await insertFeed(shop.id, { url: FEED_URL });
  return feedId;
}

function expectClean(text: string) {
  expect(text).not.toContain(KEY);
  expect(text).not.toContain('api_key');
  expect(text).not.toContain('feeds.example');
  expect(text).not.toContain(EMAIL);
  expect(text).not.toContain(ROW_TITLE);
}

describe('importer output holds no URL key and no row content', () => {
  it('on a successful import with rejected rows', async () => {
    const feedId = await registerKeyedFeed();
    const csv =
      'id,title,description,price,url\n' +
      `K-1,${ROW_TITLE},Contacto ${EMAIL},not-a-price,https://shop.example/1\n` +
      `K-2,Otro,Contacto ${EMAIL},5.00,https://shop.example/2\n`;
    const report = await importFeeds(getDb(), { deps: textDeps({ [feedId]: csv }) });

    expect(report.feeds[0].rejected).toEqual([{ record: 2, code: 'invalid_price', field: 'price' }]);
    expectClean(formatImportReport(report));
    expectClean(JSON.stringify(report));
    expectClean(consoleCalls());
  });

  it('when the source throws an error that names the URL and key', async () => {
    const feedId = await registerKeyedFeed();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [feedId]: new Error(`ECONNRESET reading ${FEED_URL}`) }),
    });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'fetch_failed' });
    expectClean(formatImportReport(report));
    expectClean(JSON.stringify(report));
    expectClean(consoleCalls());
  });

  it('when the real reader\'s fetch fails with an error that names the URL and key', async () => {
    const feedId = await registerKeyedFeed();
    fetchStub.mockRejectedValueOnce(new Error(`getaddrinfo ENOTFOUND ${FEED_URL}`));

    const report = await importFeeds(getDb());

    expect(report.feeds[0]).toMatchObject({ feedId, outcome: 'failed', failure: 'fetch_failed' });
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expectClean(formatImportReport(report));
    expectClean(JSON.stringify(report));
    expectClean(consoleCalls());
  });

  it('when the database rejects a row whose text holds personal data', async () => {
    const feedId = await registerKeyedFeed();
    const csv = `id,title,description,price,url\nDB-1,${ROW_TITLE}\u0000,Contacto ${EMAIL},5.00,https://shop.example/1\n`;

    const report = await importFeeds(getDb(), { deps: textDeps({ [feedId]: csv }) });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'database_error' });
    expectClean(formatImportReport(report));
    expectClean(JSON.stringify(report));
    expectClean(consoleCalls());
  });

  it('keeps the shop name and feed id, which are safe to print', async () => {
    const feedId = await registerKeyedFeed();
    const report = await importFeeds(getDb(), { deps: textDeps({ [feedId]: new Error('x') }) });
    expect(formatImportReport(report)).toContain(`feed ${feedId} "Tienda Con Clave": failed`);
  });
});
