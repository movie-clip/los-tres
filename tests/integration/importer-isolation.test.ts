import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';

import { allOffers, allProducts, insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { readFeedFixture, textDeps } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

async function twoFeeds() {
  const first = await insertShop({ name: 'Tienda Primera' });
  const second = await insertShop({ name: 'Tienda Segunda' });
  return {
    one: await insertFeed(first.id, { url: 'one.csv' }),
    two: await insertFeed(second.id, { url: 'two.csv' }),
  };
}

describe('one transaction per feed, a failing feed never stops the others (TD-28)', () => {
  it('imports the second feed when the first feed\'s source throws, and reports the first as failed', async () => {
    const { one, two } = await twoFeeds();
    const report = await importFeeds(getDb(), {
      deps: textDeps({
        [one]: new Error('connection reset while reading'),
        [two]: readFeedFixture('ean-first.csv'),
      }),
    });

    expect(report.feeds.map((feed) => [feed.feedId, feed.outcome])).toEqual([
      [one, 'failed'],
      [two, 'imported'],
    ]);
    expect(report.feeds[0].failure).toBe('fetch_failed');
    expect(report.feeds[1]).toMatchObject({ offersCreated: 2 });
    expect((await allOffers()).every((offer) => offer.feedId === two)).toBe(true);
  });

  it('exits 1 when any feed failed and prints the failed line, the other feed still counted', async () => {
    const { one, two } = await twoFeeds();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: new Error('boom'), [two]: readFeedFixture('ean-first.csv') }),
    });
    expect(importExitCode(report)).toBe(1);
    const text = formatImportReport(report);
    expect(text).toContain(`feed ${one} "Tienda Primera": failed fetch_failed`);
    expect(text).toContain(`feed ${two} "Tienda Segunda": imported`);
    expect(text.split('\n').at(-1)).toBe('total: feeds=2 imported=1 skipped=0 failed=1');
  });

  it('exits 0 when rows are rejected but no feed failed', async () => {
    const { one, two } = await twoFeeds();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: readFeedFixture('rejects.csv'), [two]: readFeedFixture('ean-first.csv') }),
    });
    expect(report.feeds[0].rejected.length).toBeGreaterThan(0);
    expect(importExitCode(report)).toBe(0);
  });

  it('runs the feeds in id order', async () => {
    const { one, two } = await twoFeeds();
    const order: number[] = [];
    await importFeeds(getDb(), {
      deps: {
        readSource: async (feed) => {
          order.push(feed.id);
          return readFeedFixture('ean-first.csv').replace(/A-/g, `F${feed.id}-`);
        },
      },
    });
    expect(order).toEqual([one, two]);
  });

  it('fails a feed with no required price column as invalid_header and reads no row', async () => {
    const { one, two } = await twoFeeds();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: readFeedFixture('invalid-header.csv'), [two]: readFeedFixture('ean-first.csv') }),
    });
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'invalid_header', rows: 0 });
    expect(report.feeds[1].outcome).toBe('imported');
    expect(importExitCode(report)).toBe(1);
  });

  it('fails an empty file as invalid_header', async () => {
    const { one, two } = await twoFeeds();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: '', [two]: readFeedFixture('ean-first.csv') }),
    });
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'invalid_header' });
  });

  it('rolls a feed back on a database error: nothing from that feed stays, the other feed is unharmed', async () => {
    const { one, two } = await twoFeeds();
    // The second row has a NUL byte in the title, which PostgreSQL refuses to store.
    const poisoned =
      'id,title,price,url\nOK-1,Fila buena antes del error,5.00,https://shop.example/1\n' +
      'BAD-2,Titulo\u0000roto,5.00,https://shop.example/2\n';
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: poisoned, [two]: readFeedFixture('ean-first.csv') }),
    });

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'database_error' });
    expect(report.feeds[1]).toMatchObject({ outcome: 'imported', offersCreated: 2 });
    const rows = await allOffers();
    expect(rows.filter((offer) => offer.feedId === one)).toEqual([]);
    expect((await allProducts()).map((product) => product.title)).not.toContain('Fila buena antes del error');
    expect(importExitCode(report)).toBe(1);
  });
});
