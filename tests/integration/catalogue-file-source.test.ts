import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, networks } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { readFeedSource } from '@/server/importer/source';
import type { FeedSourceRef } from '@/server/importer/types';

import { allOffers, allProducts, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { csvOf, gzipOf, xmlOf } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';
import { pgErrorOf } from '../support/pg-error';

// S3.7 T3.7.1, ACs 15 to 25 and 35: a catalogue-file feed is read from the one
// catalogue folder, by the exact stored name, and every unsafe name or file is
// refused with a fixed code. Every test reads a temp folder passed as
// `catalogueDir`, never the repo's catalogue-files/. Names and files are invented.

let dir: string;
let fetchStub: ReturnType<typeof stubNetworkOff>;

beforeEach(async () => {
  await resetDatabase();
  fetchStub = stubNetworkOff();
  dir = await mkdtemp(path.join(os.tmpdir(), 'los-tres-catalogue-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});
afterAll(async () => {
  await closeDb();
});

const ROWS = [
  { id: 'a-1', title: 'Filtro de aceite Prueba A', price: '10.50', url: 'https://tienda.example/a-1', brand: 'Marca', ean: '4006381333931', currency: 'EUR' },
  { id: 'a-2', title: 'Filtro de aire Prueba B', price: '7.25', url: 'https://tienda.example/a-2', brand: 'Marca', ean: '', currency: 'EUR' },
];

/** The reader a test passes to the importer: the real one, on the temp folder. */
const readFromTemp = (feed: FeedSourceRef) => readFeedSource(feed, { catalogueDir: dir });

async function insertFileFeed(
  shopId: number,
  url: string,
  o: { isApproved?: boolean; isDemo?: boolean } = {},
): Promise<number> {
  const [row] = await getDb()
    .insert(feeds)
    .values({
      shopId,
      networkId: null,
      sourceType: 'catalogue_file',
      url,
      isApproved: o.isApproved ?? true,
      isDemo: o.isDemo ?? false,
    })
    .returning({ id: feeds.id });
  return row.id;
}

async function importOne(feedId: number) {
  const report = await importFeeds(getDb(), { feedId, deps: { readSource: readFromTemp } });
  return report;
}

async function readText(bytes: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of bytes) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** Skips the test when the OS refuses to make a symlink (Windows without the right, D-5 A5). */
async function trySymlink(
  ctx: { skip: (note?: string) => never },
  target: string,
  link: string,
  type?: 'dir' | 'file' | 'junction',
): Promise<void> {
  try {
    await symlink(target, link, type);
  } catch (error) {
    if ((error as { code?: string }).code === 'EPERM') {
      ctx.skip('this account cannot create symlinks (EPERM); CI on Linux runs it');
    }
    throw error;
  }
}

describe('migration: the catalogue_file feed kind (C-1)', () => {
  it('stores a file feed with no network and the file name as its address', async () => {
    const shop = await insertShop();
    const id = await insertFileFeed(shop.id, 'mi-catalogo.csv');
    const [row] = await getDb().select().from(feeds);
    expect(row).toMatchObject({
      id,
      sourceType: 'catalogue_file',
      networkId: null,
      url: 'mi-catalogo.csv',
    });
  });

  it('refuses a catalogue_file feed that names a network (feeds_catalogue_file_no_network)', async () => {
    const shop = await insertShop();
    const [network] = await getDb()
      .insert(networks)
      .values({ name: 'Red de prueba', slug: 'red-de-prueba' })
      .returning({ id: networks.id });
    const error = await pgErrorOf(
      getDb().insert(feeds).values({
        shopId: shop.id,
        networkId: network.id,
        sourceType: 'catalogue_file',
        url: 'x.csv',
      }),
    );
    expect(error).toEqual({ code: '23514', constraint: 'feeds_catalogue_file_no_network' });
  });

  it('keeps the same name unique per shop and lets two shops use one name', async () => {
    const one = await insertShop();
    const two = await insertShop();
    await insertFileFeed(one.id, 'same.csv');
    const error = await pgErrorOf(insertFileFeed(one.id, 'same.csv'));
    expect(error).toEqual({ code: '23505', constraint: 'feeds_shop_id_url_unique' });
    await expect(insertFileFeed(two.id, 'same.csv')).resolves.toBeGreaterThan(0);
  });

  it('writes a name the rule refuses, so the import refusal can be tested (no shape check in the database)', async () => {
    const shop = await insertShop();
    await expect(insertFileFeed(shop.id, '../planted.csv')).resolves.toBeGreaterThan(0);
  });
});

describe('importing an approved catalogue-file feed (ACs 15, 17 to 19, 24)', () => {
  it.each([
    ['catalogo.csv', () => csvOf(ROWS)],
    ['catalogo.xml', () => xmlOf(ROWS)],
    ['catalogo.csv.gz', () => gzipOf(csvOf(ROWS))],
    ['catalogo.xml.gz', () => gzipOf(xmlOf(ROWS))],
    ['CATALOGO.CSV', () => csvOf(ROWS)],
  ])('imports %s through the same path as any feed', async (name, content) => {
    await writeFile(path.join(dir, name), content());
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, name);

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({
      feedId,
      outcome: 'imported',
      rows: 2,
      productsCreated: 2,
      offersCreated: 2,
    });
    expect(importExitCode(report)).toBe(0);
    expect(await allProducts()).toHaveLength(2);
    expect(await allOffers()).toHaveLength(2);
    expect(fetchStub).not.toHaveBeenCalled();
  });

  it('passes the feed kind to the source reader', async () => {
    await writeFile(path.join(dir, 'kind.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'kind.csv');
    const readSource = vi.fn(readFromTemp);

    await importFeeds(getDb(), { feedId, deps: { readSource } });

    expect(readSource).toHaveBeenCalledWith({
      id: feedId,
      url: 'kind.csv',
      isDemo: false,
      sourceType: 'catalogue_file',
    });
  });

  it('imports a changed file again and updates the price (a re-run)', async () => {
    await writeFile(path.join(dir, 'again.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'again.csv');
    await importOne(feedId);

    await writeFile(path.join(dir, 'again.csv'), csvOf([{ ...ROWS[0], price: '9.99' }, ROWS[1]]));
    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: 0, offersUpdated: 2 });
    expect(await allProducts()).toHaveLength(2);
  });

  it('rejects a bad row like any feed and keeps the rest (the reject report is shared)', async () => {
    await writeFile(path.join(dir, 'mixed.csv'), csvOf([ROWS[0], { ...ROWS[1], price: 'gratis' }]));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'mixed.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 2, offersCreated: 1 });
    expect(report.feeds[0].rejected).toEqual([{ record: 3, code: 'invalid_price', field: 'price' }]);
  });
});

describe('an unapproved file feed is never read (AC 15)', () => {
  it('is skipped not_approved and opens no file', async () => {
    await writeFile(path.join(dir, 'unapproved.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'unapproved.csv', { isApproved: false });
    const readSource = vi.fn(readFromTemp);

    const named = await importFeeds(getDb(), { feedId, deps: { readSource } });
    const plain = await importFeeds(getDb(), { deps: { readSource } });

    expect(named.feeds[0]).toMatchObject({ outcome: 'skipped', skipReason: 'not_approved' });
    expect(plain.feeds).toEqual([]);
    expect(readSource).not.toHaveBeenCalled();
    expect(await allOffers()).toEqual([]);
  });
});

describe('a stored name that is not a bare file name is refused (AC 21)', () => {
  it.each([
    '../outside.csv',
    '..\\outside.csv',
    '/etc/hosts',
    'C:\\Windows\\win.ini',
    '\\\\server\\share\\x.csv',
    'sub/inner.csv',
    'https://tienda.example/f.csv',
    'demo-feed:tienda-demo-uno.csv',
    '.hidden.csv',
    'nul.csv',
    'notes.txt',
    'sin-tilde-á.csv',
    ' padded.csv',
    'x.csv\n',
  ])('fails %j as file_name_refused', async (name) => {
    // A real file the bad name could reach if it were not refused first.
    await writeFile(path.join(dir, 'inner.csv'), csvOf(ROWS));
    await writeFile(path.join(path.dirname(dir), 'outside.csv'), csvOf(ROWS)).catch(() => undefined);
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, name);

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_name_refused' });
    expect(importExitCode(report)).toBe(1);
    expect(await allOffers()).toEqual([]);
    expect(fetchStub).not.toHaveBeenCalled();
    await rm(path.join(path.dirname(dir), 'outside.csv'), { force: true });
  });

  it('touches nothing on disk for a bad name: a missing folder still says file_name_refused', async () => {
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, '../x.csv');
    const missing = path.join(dir, 'no-such-folder');

    const report = await importFeeds(getDb(), {
      feedId,
      deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: missing }) },
    });

    expect(report.feeds[0]).toMatchObject({ failure: 'file_name_refused' });
  });
});

describe('a file that is not there is refused (AC 23)', () => {
  it('fails a missing file as file_not_found and imports nothing', async () => {
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'absent.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
    expect(await allOffers()).toEqual([]);
  });

  it('fails a missing folder as file_not_found', async () => {
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'x.csv');

    const report = await importFeeds(getDb(), {
      feedId,
      deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: path.join(dir, 'nope') }) },
    });

    expect(report.feeds[0]).toMatchObject({ failure: 'file_not_found' });
  });

  it('fails a folder that is a plain file as file_not_found', async () => {
    const notAFolder = path.join(dir, 'plain-file');
    await writeFile(notAFolder, 'x');
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'x.csv');

    const report = await importFeeds(getDb(), {
      feedId,
      deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: notAFolder }) },
    });

    expect(report.feeds[0]).toMatchObject({ failure: 'file_not_found' });
  });

  it('matches the name exactly, case included, on every platform', async () => {
    await writeFile(path.join(dir, 'Catalogo.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'catalogo.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
  });

  it('does not need the folder in a run with no file feed (AC 23)', async () => {
    const shop = await insertShop();
    await getDb().insert(feeds).values({
      shopId: shop.id,
      sourceType: 'shop_upload',
      url: 'https://feeds.example/f.csv',
      isApproved: true,
    });
    fetchStub.mockResolvedValueOnce(new Response(csvOf(ROWS), { status: 200 }));

    const report = await importFeeds(getDb(), {
      deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: path.join(dir, 'never') }) },
    });

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', offersCreated: 2 });
    expect(importExitCode(report)).toBe(0);
  });
});

describe('an entry that is not a regular file is refused (AC 22)', () => {
  it('fails a directory with a file name as file_refused', async () => {
    await mkdir(path.join(dir, 'folder.csv'));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'folder.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_refused' });
    expect(await allOffers()).toEqual([]);
  });

  it('fails a symlink to a real file as file_refused', async (ctx) => {
    const real = path.join(dir, 'real-target.csv');
    await writeFile(real, csvOf(ROWS));
    await trySymlink(ctx, real, path.join(dir, 'link.csv'), 'file');
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'link.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_refused' });
    expect(await allOffers()).toEqual([]);
  });

  it('fails a symlink that points outside the folder as file_refused', async (ctx) => {
    const outside = await mkdtemp(path.join(os.tmpdir(), 'los-tres-outside-'));
    try {
      await writeFile(path.join(outside, 'secret.csv'), csvOf(ROWS));
      await trySymlink(ctx, path.join(outside, 'secret.csv'), path.join(dir, 'escape.csv'), 'file');
      const shop = await insertShop();
      const feedId = await insertFileFeed(shop.id, 'escape.csv');

      const report = await importOne(feedId);

      expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_refused' });
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it('fails a dangling symlink as file_refused', async (ctx) => {
    await trySymlink(ctx, path.join(dir, 'gone.csv'), path.join(dir, 'dangling.csv'), 'file');
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'dangling.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ failure: 'file_refused' });
  });

  it('fails a folder that is itself a link as file_refused', async (ctx) => {
    const real = await mkdtemp(path.join(os.tmpdir(), 'los-tres-real-'));
    try {
      await writeFile(path.join(real, 'inside.csv'), csvOf(ROWS));
      const linkedFolder = path.join(dir, 'linked-folder');
      await trySymlink(ctx, real, linkedFolder, 'junction');
      const shop = await insertShop();
      const feedId = await insertFileFeed(shop.id, 'inside.csv');

      const report = await importFeeds(getDb(), {
        feedId,
        deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: linkedFolder }) },
      });

      expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_refused' });
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  });
});

describe('the file branch and the other kinds stay apart (AC 35)', () => {
  it('never lets a file feed reach demo/feeds: a demo file name is not found in the folder', async () => {
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'tienda-demo-uno.csv');

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
  });

  it('refuses a file feed marked demo as unsupported_url', async () => {
    await writeFile(path.join(dir, 'demo-marked.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'demo-marked.csv', { isDemo: true });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ failure: 'unsupported_url' });
  });

  it('never lets another kind of feed read the folder', async () => {
    await writeFile(path.join(dir, 'present.csv'), csvOf(ROWS));
    const shop = await insertShop();
    const [row] = await getDb()
      .insert(feeds)
      .values({ shopId: shop.id, sourceType: 'shop_upload', url: 'present.csv', isApproved: true })
      .returning({ id: feeds.id });

    const report = await importOne(row.id);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'unsupported_url' });
    expect(await allOffers()).toEqual([]);
  });

  it('never lets a demo-feed: value reach the folder from a file feed', async () => {
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'demo-feed:tienda-demo-uno.csv', { isDemo: true });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ failure: 'unsupported_url' });
  });
});

describe('the read itself (C-5)', () => {
  it('serves the exact bytes of the file', async () => {
    const content = csvOf(ROWS);
    await writeFile(path.join(dir, 'bytes.csv'), content);
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'bytes.csv');

    const bytes = await readFeedSource(
      { id: feedId, url: 'bytes.csv', isDemo: false, sourceType: 'catalogue_file' },
      { catalogueDir: dir },
    );

    expect((await readText(bytes)).toString('utf8')).toBe(content);
  });

  it('stops a file over 50 MiB as too_large', async () => {
    const big = Buffer.alloc(50 * 1024 * 1024 + 1, 0x61);
    await writeFile(path.join(dir, 'big.csv'), big);
    const shop = await insertShop();
    const feedId = await insertFileFeed(shop.id, 'big.csv');

    const bytes = await readFeedSource(
      { id: feedId, url: 'big.csv', isDemo: false, sourceType: 'catalogue_file' },
      { catalogueDir: dir },
    );

    await expect(readText(bytes)).rejects.toMatchObject({ code: 'too_large' });
  });
});

describe('no refusal names a path, a file name or a folder (guardrail 5)', () => {
  it('prints only the fixed code in the report line and keeps the name and folder out of it', async () => {
    const secretName = 'hide-this-name.csv';
    const shop = await insertShop({ name: 'Tienda Informe' });
    const missing = await insertFileFeed(shop.id, secretName);
    const bad = await insertFileFeed(shop.id, '../escape-name.csv');
    await mkdir(path.join(dir, 'dir-entry.csv'));
    const refused = await insertFileFeed(shop.id, 'dir-entry.csv');
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warns = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    try {
      const report = await importFeeds(getDb(), { deps: { readSource: readFromTemp } });
      const text = formatImportReport(report);

      expect(text).toContain(`feed ${missing} "Tienda Informe": failed file_not_found`);
      expect(text).toContain(`feed ${bad} "Tienda Informe": failed file_name_refused`);
      expect(text).toContain(`feed ${refused} "Tienda Informe": failed file_refused`);
      for (const needle of [secretName, 'escape-name', 'dir-entry', dir, os.tmpdir(), 'ENOENT']) {
        expect(text).not.toContain(needle);
        expect(JSON.stringify(report)).not.toContain(needle);
      }
      for (const spy of [logs, errors, warns]) expect(spy).not.toHaveBeenCalled();
    } finally {
      logs.mockRestore();
      errors.mockRestore();
      warns.mockRestore();
    }
  });

  it('throws a SourceError that carries only its code', async () => {
    const error = await readFeedSource(
      { id: 1, url: 'secret-name.csv', isDemo: false, sourceType: 'catalogue_file' },
      { catalogueDir: dir },
    ).catch((e: unknown) => e as Error);

    expect(error).toMatchObject({ name: 'SourceError', code: 'file_not_found', message: 'file_not_found' });
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined();
    expect(String((error as Error).stack)).not.toContain('secret-name');
  });
});
