import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { FeedNotRegisteredError, formatImportReport, importFeeds } from '@/server/importer';

import { allOffers, allProducts, insertFeed, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { bytesOf, readFeedFixture } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

let fetchStub: ReturnType<typeof stubNetworkOff>;

beforeEach(async () => {
  await resetDatabase();
  fetchStub = stubNetworkOff();
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

// Guardrail 2: data enters only through a registered feed. The importer takes
// feed ids, never a URL or a path, and a feed is read only once approved.

describe('registered source (guardrail 2, 0007)', () => {
  it('throws FeedNotRegisteredError for a feed id that is not a row and reads nothing', async () => {
    const readSource = vi.fn(async () => bytesOf(readFeedFixture('ean-first.csv')));
    await expect(importFeeds(getDb(), { feedId: 999_999, deps: { readSource } })).rejects.toBeInstanceOf(
      FeedNotRegisteredError,
    );
    expect(readSource).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await allProducts()).toEqual([]);
  });

  it('reports an existing but unapproved feed as skipped not_approved without reading it', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'ean-first.csv', isApproved: false });
    const readSource = vi.fn(async () => bytesOf(readFeedFixture('ean-first.csv')));

    const report = await importFeeds(getDb(), { feedId, deps: { readSource } });

    expect(report.feeds).toHaveLength(1);
    expect(report.feeds[0]).toMatchObject({ feedId, outcome: 'skipped', skipReason: 'not_approved' });
    expect(formatImportReport(report)).toContain(`feed ${feedId} "${shop.name}": skipped not_approved`);
    expect(readSource).not.toHaveBeenCalled();
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await allOffers()).toEqual([]);
  });

  it('leaves an unapproved feed out of a plain run entirely', async () => {
    const shop = await insertShop();
    const approved = await insertFeed(shop.id, { url: 'ean-first.csv', isApproved: true });
    const other = await insertShop();
    await insertFeed(other.id, { url: 'ean-second.csv', isApproved: false });
    const readSource = vi.fn(async (feed: { url: string }) => bytesOf(readFeedFixture(feed.url)));

    const report = await importFeeds(getDb(), { deps: { readSource } });

    expect(report.feeds.map((feed) => feed.feedId)).toEqual([approved]);
    expect(readSource).toHaveBeenCalledTimes(1);
  });

  it('serves an https feed through the injected reader, passing the feed row and not a free URL', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'https://feeds.example/f.csv' });
    const readSource = vi.fn(async () => bytesOf(readFeedFixture('ean-first.csv')));

    const report = await importFeeds(getDb(), { deps: { readSource } });

    expect(readSource).toHaveBeenCalledTimes(1);
    expect(readSource).toHaveBeenCalledWith({
      id: feedId,
      url: 'https://feeds.example/f.csv',
      isDemo: false,
    });
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: 2 });
    expect(fetchStub).not.toHaveBeenCalled();
  });
});

describe('the real reader refuses what is not a registered https or demo source', () => {
  async function importWithRealReader(url: string, isDemo = false) {
    const shop = await insertShop();
    await insertFeed(shop.id, { url, isDemo });
    return importFeeds(getDb());
  }

  it.each([
    'ftp://shop.example/f.csv',
    'file:///etc/hosts',
    'http://shop.example/f.csv',
    '/etc/hosts',
    'C:\\Windows\\win.ini',
  ])('fails %j as unsupported_url and calls no fetch', async (url) => {
    const report = await importWithRealReader(url, true);
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'unsupported_url' });
    expect(fetchStub).not.toHaveBeenCalled();
    expect(await allOffers()).toEqual([]);
  });

  it('fails a demo-feed: url on a feed that is not marked demo', async () => {
    const report = await importWithRealReader('demo-feed:tienda-demo-uno.csv', false);
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'unsupported_url' });
    expect(await allOffers()).toEqual([]);
  });

  it.each(['demo-feed:../package.json', 'demo-feed:../x.csv', 'demo-feed:sub/x.csv'])(
    'refuses the traversal %j even on a demo feed',
    async (url) => {
      const report = await importWithRealReader(url, true);
      expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'unsupported_url' });
    },
  );

  it('fetches an https feed with the stubbed global fetch and imports the text it returns', async () => {
    fetchStub.mockResolvedValueOnce(new Response(readFeedFixture('ean-first.csv'), { status: 200 }));
    const report = await importWithRealReader('https://feeds.example/f.csv');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: 2 });
  });

  it('fails a feed whose fetch errors as fetch_failed', async () => {
    const report = await importWithRealReader('https://feeds.example/f.csv');
    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'fetch_failed' });
  });
});
