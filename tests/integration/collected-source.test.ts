import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds } from '@/db/schema';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { readFeedSource, SourceError } from '@/server/importer/source';

import { allOffers, allProducts, insertShop } from '../support/catalogue';
import { aFileFeed, catalogueCsv, importFromFolder, insertFileFeed, tempCatalogueFolder, type CatalogueRow } from '../support/catalogue-files';
import { resetDatabase } from '../support/db';
import { stubNetworkOff } from '../support/network-off';
import { consoleMethods } from '../support/admin';

// A hang guard (0006, rule 4): the file runs real imports over temp folders.
vi.setConfig({ testTimeout: 30_000 });

// S12.2 T-12.2.1, ACs 2, 3 and 8 (the importer side; AC 4's name rule is the catalogue one, run for the collected source in collected-feed-admin.test.ts) on the real reader: a collected feed reads only its own
// folder, the two kinds refuse each other's folder, a stored value that is not a bare name is refused and no
// output shows a path. Both folders are TEMP folders passed as `catalogueDir` and `collectedDir`: the repo's
// collected-files/ and catalogue-files/ are never read (they may hold the owner's real files). Every name and
// row is invented. The admin side of ACs 1 and 4 to 10 is collected-feed-admin.test.ts.

let collected: Awaited<ReturnType<typeof tempCatalogueFolder>>;
let catalogue: Awaited<ReturnType<typeof tempCatalogueFolder>>;

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
  collected = await tempCatalogueFolder();
  catalogue = await tempCatalogueFolder();
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await collected.remove();
  await catalogue.remove();
});
afterAll(async () => {
  await closeDb();
});

const ROWS: CatalogueRow[] = [
  { id: 'r-1', title: 'Filtro de prueba uno', price: '10.50', url: 'https://tienda.example/r-1', brand: 'Marca', currency: 'EUR' },
];

const importOne = (feedId: number) => importFromFolder(catalogue.dir, { feedId, collectedDir: collected.dir });

describe('a collected feed reads only the collected folder (AC 2)', () => {
  it('imports the file of its name from the collected folder', async () => {
    await writeFile(path.join(collected.dir, 'recopilado.csv'), catalogueCsv(ROWS));
    const { feedId } = await aFileFeed('recopilado.csv', { kind: 'collected_file' });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 1, offersCreated: 1 });
    expect(importExitCode(report)).toBe(0);
  });

  it('refuses every stored value that is not a bare file name, with a fixed code, before any folder is looked at', async () => {
    const missingFolder = path.join(collected.dir, 'no-such-folder');
    for (const name of ['../fuera.csv', '..\\fuera.csv', '/etc/hosts', 'C:\\Windows\\win.ini', '\\\\server\\share\\x.csv', 'sub/dentro.csv', 'https://tienda.example/f.csv', 'demo-feed:tienda-demo-uno.csv', 'notes.txt']) {
      const { feedId } = await aFileFeed(name, { kind: 'collected_file' });
      const report = await importFeeds(getDb(), {
        feedId,
        deps: { readSource: (feed) => readFeedSource(feed, { catalogueDir: catalogue.dir, collectedDir: missingFolder }) },
      });

      expect(report.feeds[0], name).toMatchObject({ outcome: 'failed', failure: 'file_name_refused' });
    }
    expect(await allOffers()).toEqual([]);
  });

  it('refuses a name that names a file in a sub-folder even when that file exists', async () => {
    await mkdir(path.join(collected.dir, 'sub'));
    await writeFile(path.join(collected.dir, 'sub', 'dentro.csv'), catalogueCsv(ROWS));
    const { feedId } = await aFileFeed('sub/dentro.csv', { kind: 'collected_file' });

    expect((await importOne(feedId)).feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_name_refused' });
    expect(await allOffers()).toEqual([]);
  });

  it('matches the name exactly, case included', async () => {
    await writeFile(path.join(collected.dir, 'Recopilado.csv'), catalogueCsv(ROWS));
    const { feedId } = await aFileFeed('recopilado.csv', { kind: 'collected_file' });

    expect((await importOne(feedId)).feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
  });

  it('refuses a collected feed that is a demo feed, so demo/feeds is unreachable from it', async () => {
    const demo = { id: 1, url: 'tienda-demo-uno.csv', isDemo: true, sourceType: 'collected_file' } as const;

    await expect(readFeedSource(demo, { collectedDir: collected.dir })).rejects.toBeInstanceOf(SourceError);
    await expect(readFeedSource(demo, { collectedDir: collected.dir })).rejects.toMatchObject({ code: 'unsupported_url' });
  });
});

describe('each kind refuses the other folder (AC 3)', () => {
  it('a collected feed whose file is only in catalogue-files fails file_not_found, though the file exists there', async () => {
    await writeFile(path.join(catalogue.dir, 'mismo-nombre.csv'), catalogueCsv(ROWS));
    const { feedId } = await aFileFeed('mismo-nombre.csv', { kind: 'collected_file' });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
    expect(await allProducts()).toEqual([]);
  });

  it('a catalogue-file feed whose file is only in the collected folder fails file_not_found, though the file exists there', async () => {
    await writeFile(path.join(collected.dir, 'mismo-nombre.csv'), catalogueCsv(ROWS));
    const { feedId } = await aFileFeed('mismo-nombre.csv', { kind: 'catalogue_file' });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
    expect(await allProducts()).toEqual([]);
  });

  it('a collected feed never reads demo/feeds: the name of a shipped demo file is file_not_found', async () => {
    const { feedId } = await aFileFeed('tienda-demo-uno.csv', { kind: 'collected_file' });

    const report = await importOne(feedId);

    expect(report.feeds[0]).toMatchObject({ outcome: 'failed', failure: 'file_not_found' });
  });

  it('both folders hold the same name: each feed reads its own file, whatever the other folder holds', async () => {
    await writeFile(path.join(collected.dir, 'igual.csv'), catalogueCsv([{ ...ROWS[0], id: 'c-1', title: 'Producto del archivo recopilado' }]));
    await writeFile(path.join(catalogue.dir, 'igual.csv'), catalogueCsv([{ ...ROWS[0], id: 'k-1', title: 'Producto del archivo escrito a mano' }]));
    const mine = await aFileFeed('igual.csv', { kind: 'collected_file', shopName: 'Tienda recopilada' });
    const hand = await aFileFeed('igual.csv', { kind: 'catalogue_file', shopName: 'Tienda escrita' });

    await importOne(mine.feedId);
    await importOne(hand.feedId);

    const stored = await allProducts();
    expect(stored.map((row) => [row.title, row.isCollected]).sort()).toEqual([
      ['Producto del archivo escrito a mano', false],
      ['Producto del archivo recopilado', true],
    ]);
  });

  it('an import of every approved feed at once reads each kind from its own folder', async () => {
    await writeFile(path.join(collected.dir, 'a.csv'), catalogueCsv([{ ...ROWS[0], id: 'c-1', title: 'Solo recopilado' }]));
    await writeFile(path.join(catalogue.dir, 'b.csv'), catalogueCsv([{ ...ROWS[0], id: 'k-1', title: 'Solo escrito a mano' }]));
    await aFileFeed('a.csv', { kind: 'collected_file', shopName: 'Recopilada' });
    await aFileFeed('b.csv', { kind: 'catalogue_file', shopName: 'Escrita' });

    const report = await importFromFolder(catalogue.dir, { collectedDir: collected.dir });

    expect(report.feeds.map((feed) => feed.outcome)).toEqual(['imported', 'imported']);
    expect((await allProducts()).map((row) => row.isCollected).sort()).toEqual([false, true]);
  });
});

describe('no output of a collected import shows a folder or a path (AC 8)', () => {
  const NEEDLES = ['fuera-secreto', 'plantado', 'collected-files', 'catalogue-files'];

  it('the report, the exit text and every console line of a refused, a missing and an imported feed hold no path', async () => {
    const lines: string[] = [];
    for (const method of consoleMethods) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
    await writeFile(path.join(collected.dir, 'visible.csv'), catalogueCsv(ROWS));
    const shop = await insertShop({ name: 'Tienda recopilada' });
    const ids: number[] = [];
    for (const name of ['visible.csv', 'ausente.csv', '..\\..\\fuera-secreto\\plantado.csv', 'C:\\Users\\plantado\\fuera-secreto.csv']) {
      ids.push(await insertFileFeed(shop.id, name, { kind: 'collected_file' }));
    }

    const report = await importFromFolder(catalogue.dir, { collectedDir: collected.dir });
    const text = `${formatImportReport(report)}\n${lines.join('\n')}\n${JSON.stringify(report)}`;

    expect(report.feeds.map((feed) => feed.outcome)).toEqual(['imported', 'failed', 'failed', 'failed']);
    expect(report.feeds.map((feed) => feed.failure)).toEqual([undefined, 'file_not_found', 'file_name_refused', 'file_name_refused']);
    for (const needle of [...NEEDLES, collected.dir, catalogue.dir]) expect(text, needle).not.toContain(needle);
    expect(ids).toHaveLength(4);
    expect(await getDb().select().from(feeds)).toHaveLength(4);
  });
});
