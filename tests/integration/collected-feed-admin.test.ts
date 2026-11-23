import { createElement, isValidElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createFeedAction, updateFeedAction, type SourceFormState } from '@/app/admin/(shell)/tiendas/actions';
import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products } from '@/db/schema';
import { listCategoryMappingsForAdmin } from '@/server/admin/category-mappings';
import {
  createFeed,
  createNetwork,
  createShop,
  getFeedForEdit,
  listSourcesForAdmin,
  setFeedApproval,
  setShopApproval,
  updateFeed,
} from '@/server/admin/sources';
import { signOutAction } from '@/server/auth/actions';

import messages from '../../messages/es-ES.json';
import { SITE_ORIGIN, consoleMethods, createAdmin, expireSessionRow, forge, signInForCookie } from '../support/admin';
import { insertCollectedFeed, insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { insertFileFeed } from '../support/catalogue-files';
import { assertTestDatabase, resetDatabase } from '../support/db';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';
import { pgErrorOf } from '../support/pg-error';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4).
vi.setConfig({ testTimeout: 30_000 });

// S12.2 T-12.2.5, ACs 1, 4 to 10: the collected-file feed in the admin. The writers (the S3.1 and S3.7
// functions parameterised by kind), the two shipped actions on the collected source (no session, forged,
// expired, signed-out and cross-origin, with no write), the lists and pages that name the feed by its file
// name, and what no log, state or client payload may hold (a path, a folder). Modelled on
// catalogue-file-admin.test.ts and admin-source-writers.test.ts. Every name here is invented.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const all = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages: all, namespace } as never) as unknown,
    getMessages: async () => all,
  };
});
vi.mock('next-intl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next-intl')>();
  return {
    ...actual,
    NextIntlClientProvider: (props: Record<string, unknown>) =>
      createElement(actual.NextIntlClientProvider as never, { locale: 'es-ES', ...props }),
  };
});

// AC 8: registering a collected feed does not read the folder. The importer's reader is the only code that
// does, so every call to it is counted; this file never calls it except in the one non-vacuity test.
const reader = vi.hoisted(() => ({ calls: 0 }));
vi.mock('@/server/importer/source', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/server/importer/source')>();
  return {
    ...real,
    readFeedSource: (...args: Parameters<typeof real.readFeedSource>) => {
      reader.calls += 1;
      return real.readFeedSource(...args);
    },
  };
});

const IDLE: SourceFormState = { status: 'idle' };
const sources = messages.Admin.Sources;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const feedRows = () => getDb().select().from(feeds).orderBy(feeds.id);

async function aShop(slug = 'tienda-uno', name = 'Tienda Uno'): Promise<number> {
  const result = await createShop(form({ name, slug }));
  if (result.status !== 'written') throw new Error('shop not created');
  return result.id;
}

const collectedForm = (shopId: number, fileName: string, extra: Record<string, string> = {}) =>
  form({ source: 'collected_file', shopId: String(shopId), fileName, ...extra });

async function aCollectedFeed(name = 'viejo.csv', approved = false) {
  const shopId = await aShop();
  await setShopApproval(shopId, true);
  const result = await createFeed(collectedForm(shopId, name));
  if (result.status !== 'written') throw new Error(`collected feed not created: ${JSON.stringify(result)}`);
  if (approved) await setFeedApproval(result.id, true);
  return { shopId, feedId: result.id };
}

describe('creating a collected feed (AC 1)', () => {
  it('creates an unapproved, non-demo feed with no network under an approved shop, stored trimmed, and lists it as a collected file', async () => {
    const shopId = await aShop();
    await setShopApproval(shopId, true);

    const result = await createFeed(collectedForm(shopId, '  precios.csv \n'));

    expect(result).toMatchObject({ status: 'written', unapproved: false });
    const id = (result as { id: number }).id;
    expect(await feedRows()).toEqual([
      expect.objectContaining({ id, shopId, networkId: null, sourceType: 'collected_file', url: 'precios.csv', isApproved: false, isDemo: false }),
    ]);
    const [shop] = await listSourcesForAdmin();
    expect(shop.feeds).toEqual([
      { id, approved: false, demo: false, source: 'collected_file', networkId: null, networkName: null, offerCount: 0, host: null, fileName: 'precios.csv' },
    ]);
    expect(await getFeedForEdit(id)).toEqual({
      source: 'collected_file',
      id,
      shopId,
      shopName: 'Tienda Uno',
      approved: false,
      demo: false,
      fileName: 'precios.csv',
    });
  });

  it('reads and stores no network, address, approval, demo flag or source type that the form carries', async () => {
    const shopId = await aShop();
    const networkResult = await createNetwork(form({ name: 'Red Uno', slug: 'red-uno' }));
    const networkId = String((networkResult as { id: number }).id);

    const result = await createFeed(
      collectedForm(shopId, 'forzado.csv', {
        networkId,
        url: 'https://evil.example/x.csv?apikey=KEY-SENTINEL-C1',
        isApproved: 'true',
        approved: 'true',
        isDemo: 'true',
        demo: 'true',
        sourceType: 'catalogue_file',
        source_type: 'catalogue_file',
      }),
    );

    expect(result.status).toBe('written');
    expect(await feedRows()).toEqual([
      expect.objectContaining({ networkId: null, sourceType: 'collected_file', url: 'forzado.csv', isApproved: false, isDemo: false }),
    ]);
  });

  it('writes no approval on its shop and nothing a public reader can see', async () => {
    const shopId = await aShop();
    const result = await createFeed(collectedForm(shopId, 'precios.csv'));
    expect(result.status).toBe('written');
    const [shop] = await listSourcesForAdmin();
    expect(shop).toMatchObject({ approved: false });
    expect(await getDb().select().from(offers)).toEqual([]);
    expect(await getDb().select().from(products)).toEqual([]);
  });

  it('refuses a source value that is none of the three, and writes nothing', async () => {
    const shopId = await aShop();
    for (const source of ['Collected_File', ' collected_file', 'collected-file', 'collected', 'recopilado']) {
      const result = await createFeed(form({ source, shopId: String(shopId), fileName: 'x.csv' }));
      expect(result, source).toEqual({ status: 'refused', errors: { source: 'invalid' } });
    }
    expect(await feedRows()).toEqual([]);
  });
});

describe('the file name of a collected feed is accepted and refused by the catalogue rule (AC 4)', () => {
  const ACCEPTED = ['precios.csv', 'a.xml', 'A_b-1.CSV.GZ', 'x.xml.gz', `${'a'.repeat(96)}.csv`];
  const REFUSED: [string, string, string][] = [
    ['empty', '', 'required'],
    ['blank only', ' \t\n ', 'required'],
    ['101 characters', `${'a'.repeat(97)}.csv`, 'too_long'],
    ['a parent step', '../x.csv', 'not_a_name'],
    ['a posix path', 'carpeta/x.csv', 'not_a_name'],
    ['an absolute posix path', '/etc/x.csv', 'not_a_name'],
    ['a windows path', 'carpeta\\x.csv', 'not_a_name'],
    ['a drive letter', 'C:\\x.csv', 'not_a_name'],
    ['a share', '\\\\server\\x.csv', 'not_a_name'],
    ['an https address', 'https://feeds.example/x.csv', 'not_a_name'],
    ['a demo-feed: value', 'demo-feed:feed-uno.csv', 'not_a_name'],
    ['a hidden name', '.hidden.csv', 'not_a_name'],
    ['a device name', 'con.csv', 'not_a_name'],
    ['a space inside', 'mi catalogo.csv', 'unusable'],
    ['an accent', 'catálogo.csv', 'unusable'],
    ['an unknown kind', 'x.txt', 'wrong_kind'],
    ['no kind', 'catalogo', 'wrong_kind'],
  ];

  it.each(ACCEPTED)('accepts %s, and the catalogue source accepts it too', async (name) => {
    const shopId = await aShop();
    const other = await aShop('tienda-dos', 'Tienda Dos');
    expect((await createFeed(collectedForm(shopId, name))).status).toBe('written');
    expect((await createFeed(form({ source: 'catalogue_file', shopId: String(other), fileName: name }))).status).toBe('written');
    expect((await feedRows()).map((row) => row.url)).toEqual([name, name]);
  });

  it.each(REFUSED)('refuses %s with the same code as the catalogue source, on the file field, and writes nothing', async (label, name, code) => {
    const shopId = await aShop();
    const expected = { status: 'refused', errors: { fileName: code } };

    expect(await createFeed(collectedForm(shopId, name)), label).toEqual(expected);
    expect(await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: name })), label).toEqual(expected);
    expect(await feedRows()).toEqual([]);
  });

  it('refuses without repeating the value: a refusal holds the code and nothing the admin typed', async () => {
    const shopId = await aShop();
    const typed = '../escrito-SENTINEL/otro.csv';

    const refusal = await createFeed(collectedForm(shopId, typed));

    expect(JSON.stringify(refusal)).not.toMatch(/SENTINEL|otro\.csv/);
  });

  it('reports the shop and the file name errors together, and a missing shop alone', async () => {
    const shopId = await aShop();
    expect(await createFeed(form({ source: 'collected_file', fileName: '' }))).toEqual({
      status: 'refused',
      errors: { shop: 'required', fileName: 'required' },
    });
    expect(await createFeed(form({ source: 'collected_file', shopId: '99999', fileName: 'x.csv' }))).toEqual({
      status: 'refused',
      errors: { shop: 'required' },
    });
    expect(await createFeed(collectedForm(shopId, ''))).toEqual({ status: 'refused', errors: { fileName: 'required' } });
    expect(await feedRows()).toEqual([]);
  });

  it('refuses a duplicate for the same shop, on the file field, without repeating the name', async () => {
    const shopId = await aShop();
    await createFeed(collectedForm(shopId, 'repetido-SENTINEL.csv'));

    const again = await createFeed(collectedForm(shopId, ' repetido-SENTINEL.csv '));

    expect(again).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(again)).not.toContain('SENTINEL');
    expect(await feedRows()).toHaveLength(1);
  });

  it('refuses a collected feed that takes a name a catalogue-file feed of the same shop has, and the reverse', async () => {
    const shopId = await aShop();
    await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'mismo.csv' }));
    expect(await createFeed(collectedForm(shopId, 'mismo.csv'))).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });

    await createFeed(collectedForm(shopId, 'otro.csv'));
    expect(await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'otro.csv' }))).toEqual({
      status: 'refused',
      errors: { fileName: 'duplicate' },
    });
    expect((await feedRows()).map((row) => [row.sourceType, row.url])).toEqual([
      ['catalogue_file', 'mismo.csv'],
      ['collected_file', 'otro.csv'],
    ]);
  });

  it('accepts the same name under another shop, and creates exactly one of two simultaneous identical submissions', async () => {
    const one = await aShop('tienda-uno');
    const two = await aShop('tienda-dos', 'Tienda Dos');
    expect((await createFeed(collectedForm(one, 'mismo.csv'))).status).toBe('written');
    expect((await createFeed(collectedForm(two, 'mismo.csv'))).status).toBe('written');

    const results = await Promise.all([createFeed(collectedForm(one, 'carrera.csv')), createFeed(collectedForm(one, 'carrera.csv'))]);

    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'written']);
    expect(results.find((result) => result.status === 'refused')).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect((await feedRows()).filter((row) => row.url === 'carrera.csv')).toHaveLength(1);
  });
});

describe('a feed keeps its kind for as long as it exists (AC 5)', () => {
  const CRAFTED = { source: 'catalogue_file', sourceType: 'catalogue_file', source_type: 'affiliate_network', networkId: '1', url: 'https://evil.example/x.csv', isApproved: 'false', isDemo: 'true', shopId: '999999' };

  it('a crafted edit of a collected feed cannot turn it into any other source, move its shop, network, address or demo flag', async () => {
    const { shopId, feedId } = await aCollectedFeed('viejo.csv', true);

    await updateFeed(form({ id: String(feedId), fileName: 'viejo.csv', ...CRAFTED }));
    await updateFeed(form({ id: String(feedId), fileName: 'otro.csv', ...CRAFTED }));

    expect((await feedRows())[0]).toMatchObject({ shopId, networkId: null, sourceType: 'collected_file', url: 'otro.csv', isDemo: false });
  });

  it.each(['catalogue_file', 'affiliate_network', 'shop_upload', 'collected_file'])('an edit that posts source=%s reads no source: the kind is the stored one', async (source) => {
    const { feedId } = await aCollectedFeed();
    await updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv', source }));
    expect((await feedRows())[0].sourceType).toBe('collected_file');
  });

  it('a crafted edit cannot turn a catalogue-file feed, an affiliate feed or a shop upload into a collected one', async () => {
    const shopId = await aShop();
    const written = await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'escrito.csv' }));
    const networkId = String(((await createNetwork(form({ name: 'Red Uno', slug: 'red-uno' }))) as { id: number }).id);
    const affiliate = await createFeed(form({ shopId: String(shopId), networkId, url: 'https://feeds.example/a.csv' }));
    const uploadShop = await insertShop();
    const upload = await insertFeed(uploadShop.id, { url: 'subida.csv' });

    await updateFeed(form({ id: String((written as { id: number }).id), fileName: 'escrito-2.csv', source: 'collected_file', sourceType: 'collected_file' }));
    await updateFeed(form({ id: String((affiliate as { id: number }).id), networkId, url: 'https://feeds.example/b.csv', source: 'collected_file', fileName: 'x.csv' }));
    expect(await updateFeed(form({ id: String(upload), fileName: 'x.csv', source: 'collected_file' }))).toEqual({ status: 'missing' });

    const kinds = Object.fromEntries((await feedRows()).map((row) => [row.id, [row.sourceType, row.url]]));
    expect(kinds[(written as { id: number }).id]).toEqual(['catalogue_file', 'escrito-2.csv']);
    expect(kinds[(affiliate as { id: number }).id]).toEqual(['affiliate_network', 'https://feeds.example/b.csv']);
    expect(kinds[upload]).toEqual(['shop_upload', 'subida.csv']);
  });

  it('a crafted create of a catalogue-file or affiliate feed that posts a collected source type stores the kind the source field names', async () => {
    const shopId = await aShop();
    await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'a.csv', sourceType: 'collected_file' }));
    await createFeed(collectedForm(shopId, 'b.csv', { sourceType: 'catalogue_file' }));

    expect((await feedRows()).map((row) => [row.url, row.sourceType])).toEqual([
      ['a.csv', 'catalogue_file'],
      ['b.csv', 'collected_file'],
    ]);
  });

  it('the database refuses a collected feed that names a network or is a demo feed (the two CHECKs of the migration)', async () => {
    const shop = await insertShop();
    const network = await createNetwork(form({ name: 'Red Uno', slug: 'red-uno' }));
    const withNetwork = await pgErrorOf(
      getDb().insert(feeds).values({ shopId: shop.id, networkId: (network as { id: number }).id, sourceType: 'collected_file', url: 'x.csv' }),
    );
    const asDemo = await pgErrorOf(
      getDb().insert(feeds).values({ shopId: shop.id, networkId: null, sourceType: 'collected_file', url: 'y.csv', isDemo: true }),
    );

    expect(withNetwork).toEqual({ code: '23514', constraint: 'feeds_collected_file_no_network' });
    expect(asDemo).toEqual({ code: '23514', constraint: 'feeds_collected_file_not_demo' });
  });
});

describe('renaming the file of a collected feed (AC 6)', () => {
  async function withUpdateLog<T>(run: () => Promise<T>): Promise<{ value: T; log: unknown[] }> {
    await assertTestDatabase();
    const db = getDb();
    await db.execute(sql.raw('create table feed_update_log (n serial primary key, url text, is_approved boolean)'));
    await db.execute(
      sql.raw(
        'create function log_feed_update() returns trigger language plpgsql as $$ begin insert into feed_update_log (url, is_approved) values (new.url, new.is_approved); return new; end $$',
      ),
    );
    await db.execute(sql.raw('create trigger log_feed_update after update on feeds for each row execute function log_feed_update()'));
    try {
      const value = await run();
      const log = (await db.execute(sql.raw('select url, is_approved from feed_update_log order by n'))).rows;
      return { value, log };
    } finally {
      await db.execute(sql.raw('drop trigger if exists log_feed_update on feeds'));
      await db.execute(sql.raw('drop function if exists log_feed_update()'));
      await db.execute(sql.raw('drop table if exists feed_update_log'));
    }
  }

  it('a new name on an approved feed is one write that stores it and returns the feed to unapproved, and reports it', async () => {
    const { feedId } = await aCollectedFeed('viejo.csv', true);

    const { value, log } = await withUpdateLog(() => updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv' })));

    expect(value).toEqual({ status: 'written', id: feedId, unapproved: true });
    expect(log).toEqual([{ url: 'nuevo.csv', is_approved: false }]);
    expect((await feedRows())[0]).toMatchObject({ url: 'nuevo.csv', isApproved: false, sourceType: 'collected_file' });
  });

  it('the rows already imported stay marked, and the rename changes no product or offer', async () => {
    const { feedId } = await aCollectedFeed('viejo.csv', true);
    const product = await insertProduct({ slug: 'marcado', isCollected: true });
    await insertOffer({ productId: product.id, feedId });
    const productsBefore = await getDb().select().from(products).orderBy(products.id);
    const offersBefore = await getDb().select().from(offers).orderBy(offers.id);

    await updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv' }));

    expect(await getDb().select().from(products).orderBy(products.id)).toEqual(productsBefore);
    expect(await getDb().select().from(offers).orderBy(offers.id)).toEqual(offersBefore);
    expect((await feedRows())[0].sourceType).toBe('collected_file');
    expect((await getDb().select().from(products))[0].isCollected).toBe(true);
  });

  it('saving the same name writes nothing and leaves an approved feed approved', async () => {
    const { feedId } = await aCollectedFeed('igual.csv', true);
    const before = await feedRows();

    const { value, log } = await withUpdateLog(async () => [
      await updateFeed(form({ id: String(feedId), fileName: 'igual.csv' })),
      await updateFeed(form({ id: String(feedId), fileName: '  igual.csv\n' })),
    ]);

    expect(value).toEqual([
      { status: 'written', id: feedId, unapproved: false },
      { status: 'written', id: feedId, unapproved: false },
    ]);
    expect(log).toEqual([]);
    expect(await feedRows()).toEqual(before);
  });

  it.each([
    ['empty', '', 'required'],
    ['a path', '../x.csv', 'not_a_name'],
    ['a wrong kind', 'x.txt', 'wrong_kind'],
    ['too long', `${'a'.repeat(97)}.csv`, 'too_long'],
  ])('refuses %s on an approved feed and leaves the name and the approval as they were', async (_label, name, code) => {
    const { feedId } = await aCollectedFeed('viejo.csv', true);
    const before = await feedRows();

    expect(await updateFeed(form({ id: String(feedId), fileName: name }))).toEqual({ status: 'refused', errors: { fileName: code } });

    expect(await feedRows()).toEqual(before);
  });

  it('refuses a name another feed of the same shop has, whatever its kind, and changes nothing', async () => {
    const { shopId, feedId } = await aCollectedFeed('uno.csv', true);
    await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'ocupado-SENTINEL.csv' }));
    const before = await feedRows();

    const result = await updateFeed(form({ id: String(feedId), fileName: 'ocupado-SENTINEL.csv' }));

    expect(result).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(await feedRows()).toEqual(before);
  });
});

describe('a collected feed is named as one in every list, by its file name (AC 7)', () => {
  it('the two admin reads carry the stored kind and the file name for a collected feed and for no other', async () => {
    const shopId = await aShop();
    const networkId = ((await createNetwork(form({ name: 'Red Uno', slug: 'red-uno' }))) as { id: number }).id;
    const collected = (await createFeed(collectedForm(shopId, 'recopilado.csv'))) as { id: number };
    const written = (await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'escrito.csv' }))) as { id: number };
    const affiliate = (await createFeed(form({ shopId: String(shopId), networkId: String(networkId), url: 'https://feeds.example/c.csv' }))) as { id: number };
    const upload = await insertFeed(shopId, { url: 'subida.csv' });

    const [shop] = await listSourcesForAdmin();
    const page = await listCategoryMappingsForAdmin();

    for (const read of [shop.feeds, page.feeds]) {
      const byId = new Map(read.map((feed) => [feed.id, feed]));
      expect(byId.get(collected.id), 'collected').toMatchObject({ source: 'collected_file', fileName: 'recopilado.csv', host: null, networkName: null });
      expect(byId.get(written.id), 'written').toMatchObject({ source: 'catalogue_file', fileName: 'escrito.csv' });
      expect(byId.get(affiliate.id), 'affiliate').toMatchObject({ source: 'affiliate_network', fileName: null });
      expect(byId.get(upload), 'upload').toMatchObject({ source: 'shop_upload', fileName: null });
    }
    for (const feed of page.feeds) expect(Object.keys(feed)).not.toContain('url');
  });

  it('shows the same approval and paused states as any feed: an approved collected feed under an unapproved shop is paused', async () => {
    const shop = await insertShop({ name: 'Tienda pausada', isApproved: false });
    await insertFileFeed(shop.id, 'pausada.csv', { kind: 'collected_file', isApproved: true });
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain(sources.feedMetaCollected);
    expect(html).toContain(sources.feedPaused);
    expect(html).toContain('pausada.csv');
  });

  it('the feeds list names a collected feed by its file name, not as a hand-written file, an upload, a network feed or a host', async () => {
    const shop = await insertShop({ name: 'Tienda recopilada' });
    await insertFileFeed(shop.id, 'visible.csv', { kind: 'collected_file', isApproved: false });
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');

    const html = renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain(sources.feedMetaCollected);
    expect(html).toContain(sources.fileLabel);
    expect(html).toContain('visible.csv');
    expect(html).not.toContain(sources.feedMetaFile);
    expect(html).not.toContain(sources.feedMetaUpload);
    expect(html).not.toContain(sources.domainLabel);
  });

  it('the category screen shows a collected feed as one, with its note last, and never as a hand-written file', async () => {
    const shop = await insertShop({ name: 'Tienda recopilada' });
    await insertFileFeed(shop.id, 'visible.csv', { kind: 'collected_file', isApproved: false });
    const other = await insertShop({ name: 'Tienda escrita' });
    await insertFileFeed(other.id, 'escrito.csv', { kind: 'catalogue_file', isApproved: false });
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: Page } = await import('@/app/admin/(shell)/categorias/page');

    const html = renderToStaticMarkup((await Page()) as never);

    expect(html).toContain(sources.feedMetaCollected);
    expect(html).toContain(messages.Admin.Categories.collectedNote);
    expect(html).toContain(sources.feedMetaFile);
    // Only the collected section carries the note: it appears once for two file feeds.
    expect(html.split(messages.Admin.Categories.collectedNote)).toHaveLength(2);
  });
});

async function signedIn(): Promise<{ cookie: string; token: string }> {
  await createAdmin();
  return signInForCookie();
}

/** Every string a page element hands down in props, children included: what a client component would be sent. */
function propStrings(node: ReactNode | unknown, seen = new Set<unknown>()): string[] {
  if (node === null || node === undefined || typeof node === 'boolean' || typeof node === 'function') return [];
  if (typeof node === 'string') return [node];
  if (typeof node === 'number') return [String(node)];
  if (typeof node !== 'object' || seen.has(node)) return [];
  seen.add(node);
  if (Array.isArray(node)) return node.flatMap((child) => propStrings(child, seen));
  if (isValidElement(node)) return propStrings((node as { props: unknown }).props, seen);
  return Object.entries(node as Record<string, unknown>).flatMap(([key, value]) => [key, ...propStrings(value, seen)]);
}

type Call = { name: string; action: (previous: SourceFormState, data: FormData) => Promise<SourceFormState>; fields: Record<string, string> };
const NAMES = ['createFeedAction', 'updateFeedAction'];

async function collectedCalls(): Promise<{ calls: Call[]; feedId: number }> {
  const shop = await insertShop({ name: 'Tienda Recopilada', isApproved: true });
  const feedId = await insertFileFeed(shop.id, 'existente.csv', { kind: 'collected_file', isApproved: true });
  return {
    feedId,
    calls: [
      { name: 'createFeedAction', action: createFeedAction, fields: { source: 'collected_file', shopId: String(shop.id), fileName: 'nuevo.csv' } },
      { name: 'updateFeedAction', action: updateFeedAction, fields: { id: String(feedId), fileName: 'renombrado.csv' } },
    ],
  };
}

describe('the collected actions with no valid session are refused before the form is read, and write nothing (AC 9)', () => {
  it.each(NAMES)('%s: no cookie, a forged, an expired and a signed-out cookie redirect to sign-in', async (name) => {
    const { calls } = await collectedCalls();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await feedRows();
    const live = await signedIn();
    const expired = await signInForCookie();
    await expireSessionRow(expired.token);
    const out = await signInForCookie();
    startAdminRequest({ cookie: out.cookie, origin: SITE_ORIGIN });
    await redirectOf(() => signOutAction());

    for (const cookie of [undefined, 'admin.session_token=forged.value', forge(live.cookie), expired.cookie, out.cookie]) {
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      const untouched = { get: vi.fn(() => { throw new Error('form read before the role check'); }) } as unknown as FormData;
      expect(await redirectOf(() => action(IDLE, untouched)), String(cookie)).toBe('/admin/acceso?aviso=sesion');
      expect(untouched.get).not.toHaveBeenCalled();
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => action(IDLE, form(fields)))).toBe('/admin/acceso?aviso=sesion');
      expect(nextRequest.cookieWrites).toEqual([]);
    }
    expect(await feedRows()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a collected feed submitted from another origin is refused and writes nothing (AC 10)', () => {
  it.each(NAMES)('%s: another origin, the string null and no origin return failed, repeat nothing and log the refusal', async (name) => {
    const { calls } = await collectedCalls();
    const { action, fields } = calls.find((call) => call.name === name)!;
    const before = await feedRows();
    const { cookie } = await signedIn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', null]) {
      startAdminRequest({ cookie, origin });
      const state = await action(IDLE, form({ ...fields, fileName: '../escrito-a-mano/otro-secreto.csv' }));
      expect(state.status, String(origin)).toBe('failed');
      expect(JSON.stringify(state)).not.toContain('escrito-a-mano');
    }

    expect(await feedRows()).toEqual(before);
    expect(errors.mock.calls.map((call) => call.join(' '))).toEqual(Array(4).fill('admin-sources: refused (ORIGIN)'));
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a signed-in collected submission writes what the form offers and nothing else', () => {
  it('creates an unapproved, non-demo collected feed with no network, and redirects to the fixed notice', async () => {
    const { calls } = await collectedCalls();
    const { action, fields } = calls.find((call) => call.name === 'createFeedAction')!;
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const to = await redirectOf(() =>
      action(IDLE, form({ ...fields, isApproved: 'true', isDemo: 'true', sourceType: 'shop_upload', networkId: '1', url: 'https://tienda.example/x.csv' })),
    );

    expect(to).toBe('/admin/tiendas?aviso=feed-creado');
    expect(to).not.toContain('nuevo.csv');
    expect((await feedRows()).find((row) => row.url === 'nuevo.csv')).toMatchObject({ isApproved: false, isDemo: false, networkId: null, sourceType: 'collected_file' });
    expect(revalidatePath).toHaveBeenCalledWith('/admin/tiendas');
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('a rename of an approved feed redirects to the unapproved notice, the same name to the plain saved notice, and the source never moves', async () => {
    const { feedId } = await collectedCalls();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await redirectOf(() => updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'existente.csv' })))).toBe('/admin/tiendas?aviso=feed-guardado');
    expect((await feedRows())[0]).toMatchObject({ url: 'existente.csv', isApproved: true });
    expect(
      await redirectOf(() => updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'otro.csv', shopId: '999', isApproved: 'true', source: 'catalogue_file' }))),
    ).toBe('/admin/tiendas?aviso=feed-sin-aprobar');
    expect((await feedRows())[0]).toMatchObject({ url: 'otro.csv', isApproved: false, sourceType: 'collected_file', networkId: null });
  });

  it('a refusal comes back with the error code and never the name, a path or a value the rule refuses', async () => {
    const { calls } = await collectedCalls();
    const shopId = calls[0].fields.shopId;
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    const state = await createFeedAction(IDLE, form({ source: 'collected_file', shopId, fileName: '../escrito-a-mano/otro-secreto.csv', name: 'Un nombre' }));

    expect(state).toMatchObject({ status: 'refused', errors: { fileName: 'not_a_name' } });
    expect(JSON.stringify(state)).not.toMatch(/escrito-a-mano|otro-secreto|\.csv/);
    const duplicate = await createFeedAction(IDLE, form({ source: 'collected_file', shopId, fileName: 'existente.csv' }));
    expect(duplicate).toMatchObject({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(duplicate)).not.toContain('existente');
  });
});

describe('a collected feed leaves no path, folder or planted value in a log, a state or a rendered page (AC 8)', () => {
  let output: string[] = [];
  function capture() {
    output = [];
    for (const method of consoleMethods) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        output.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
  }
  const PLANTED_PATH = '..\\..\\secreto-plantado\\ruta.csv';
  const PLANTED_ABSOLUTE = 'C:\\Users\\plantado\\catalogo-secreto.csv';
  const NEEDLES = ['secreto-plantado', 'catalogo-secreto', 'plantado', 'escrito-a-mano', 'otro-secreto', 'collected-files', 'catalogue-files'];

  async function planted() {
    const shop = await insertShop({ name: 'Tienda Plantada' });
    const good = await insertFileFeed(shop.id, 'visible.csv', { kind: 'collected_file' });
    const traversal = await insertFileFeed(shop.id, PLANTED_PATH, { kind: 'collected_file', isApproved: false });
    const absolute = await insertFileFeed(shop.id, PLANTED_ABSOLUTE, { kind: 'collected_file', isApproved: false });
    return { shop, good, traversal, absolute };
  }

  it('the reads return the valid name and null for a stored value that is not a name', async () => {
    const { good, traversal, absolute } = await planted();

    const [shop] = await listSourcesForAdmin();
    const byId = new Map(shop.feeds.map((feed) => [feed.id, feed]));

    expect(byId.get(good)).toMatchObject({ source: 'collected_file', fileName: 'visible.csv', host: null, networkName: null });
    for (const id of [traversal, absolute]) expect(byId.get(id)).toMatchObject({ source: 'collected_file', fileName: null, host: null });
    const text = JSON.stringify([await listSourcesForAdmin(), await listCategoryMappingsForAdmin(), await getFeedForEdit(traversal), await getFeedForEdit(good)]);
    for (const needle of NEEDLES) expect(text, needle).not.toContain(needle);
  });

  it('the feeds list and the category screen show a file name at most, in html and in client props', async () => {
    await planted();
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');
    const { default: CategoriesPage } = await import('@/app/admin/(shell)/categorias/page');

    const sourcesElement = await SourcesPage({ searchParams: Promise.resolve({}) });
    const categoriesElement = await CategoriesPage();
    const texts = [
      renderToStaticMarkup(sourcesElement),
      propStrings(sourcesElement).join('\n'),
      renderToStaticMarkup(categoriesElement as never),
      JSON.stringify(categoriesElement),
    ];

    expect(texts[0]).toContain(sources.fileUnavailable);
    expect(texts[0]).toContain('visible.csv');
    for (const text of texts) for (const needle of NEEDLES) expect(text, needle).not.toContain(needle);
  });

  it('the edit page of a collected feed prefills the stored name, and shows no field value for a stored path', async () => {
    const { good, traversal } = await planted();
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: EditFeedPage } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');

    const ok = renderToStaticMarkup(await EditFeedPage({ params: Promise.resolve({ id: String(good) }) }));
    const odd = renderToStaticMarkup(await EditFeedPage({ params: Promise.resolve({ id: String(traversal) }) }));

    expect(ok).toMatch(/\bname="fileName"[^>]*\bvalue="visible\.csv"|\bvalue="visible\.csv"[^>]*\bname="fileName"/);
    expect(ok).not.toMatch(/\bname="(url|networkId|source)"/);
    expect(ok).toContain(messages.Admin.Form.Feed.sourceFixedCollected);
    for (const needle of NEEDLES) expect(odd, needle).not.toContain(needle);
    expect(odd).not.toMatch(/\bvalue="[^"]*\.csv"/);
  });

  it('the actions log nothing for a success, a refusal or a duplicate, and nothing holds the typed value', async () => {
    const shop = await insertShop({ name: 'Tienda Recopilada' });
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    capture();

    await redirectOf(() => createFeedAction(IDLE, form({ source: 'collected_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' })));
    const duplicate = await createFeedAction(IDLE, form({ source: 'collected_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' }));
    const refused = await createFeedAction(IDLE, form({ source: 'collected_file', shopId: String(shop.id), fileName: '../escrito-a-mano/otro-secreto.csv' }));

    expect([duplicate.status, refused.status]).toEqual(['refused', 'refused']);
    expect(output).toEqual([]);
  });

  it('a write that fails returns failed and logs a code only, though the database message carries the name', async () => {
    const { feedId } = await collectedCalls();
    const shop = await insertShop({ name: 'Otra tienda' });
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    capture();
    await assertTestDatabase();
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before insert or update on feeds for each row execute function fail_feed_write()'));
    let states: SourceFormState[];
    try {
      states = [
        await createFeedAction(IDLE, form({ source: 'collected_file', shopId: String(shop.id), fileName: 'escrito-a-mano.csv' })),
        await updateFeedAction(IDLE, form({ id: String(feedId), fileName: 'otro-secreto.csv' })),
      ];
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }

    expect(states.map((state) => state.status)).toEqual(['failed', 'failed']);
    expect(output).toEqual(['admin-sources: failed (P0001)', 'admin-sources: failed (P0001)']);
    expect(JSON.stringify([states, output])).not.toMatch(/escrito-a-mano|otro-secreto|boom/);
  });

  it('is shown to catch a leak: a stored path that reached the props or the HTML would fail the checks above', () => {
    const element = createElement('div', { data: { url: PLANTED_PATH } }, createElement('input', { name: 'fileName', defaultValue: PLANTED_PATH }));
    expect(propStrings(element).join('\n')).toContain('secreto-plantado');
    expect(renderToStaticMarkup(element)).toContain('secreto-plantado');
  });
});

describe('registering a collected feed does not read the folder (AC 8)', () => {
  it('create, rename, the lists and the edit page call no file reader, though the name names no file', async () => {
    reader.calls = 0;
    const shop = await insertShop({ name: 'Tienda Recopilada' });
    const created = await createFeed(collectedForm(shop.id, 'todavia-no-existe.csv'));
    await updateFeed(form({ id: String((created as { id: number }).id), fileName: 'tampoco-existe.csv' }));
    await listSourcesForAdmin();
    await listCategoryMappingsForAdmin();
    await getFeedForEdit((created as { id: number }).id);
    await signedIn().then(({ cookie }) => startAdminRequest({ cookie, origin: SITE_ORIGIN }));
    const { default: SourcesPage } = await import('@/app/admin/(shell)/tiendas/page');
    renderToStaticMarkup(await SourcesPage({ searchParams: Promise.resolve({}) }));

    expect(created.status).toBe('written');
    expect(reader.calls).toBe(0);
  });

  it('is shown to see the reader: a call to it is counted', async () => {
    reader.calls = 0;
    const { readFeedSource } = await import('@/server/importer/source');

    await expect(readFeedSource({ id: 1, url: '../fuera.csv', isDemo: false, sourceType: 'collected_file' })).rejects.toMatchObject({
      code: 'file_name_refused',
    });

    expect(reader.calls).toBe(1);
  });
});

describe('registering a collected feed approves and publishes nothing (guardrail 1)', () => {
  it('a collected feed with rows, once registered, is still on no public reader: unapproved feed, unapproved shop', async () => {
    const { feedId } = await insertCollectedFeed({ isApproved: false, shopApproved: false });
    const product = await insertProduct({ slug: 'marcado-sin-aprobar', isCollected: true });
    await insertOffer({ productId: product.id, feedId });
    vi.stubEnv('LOCAL_COLLECTED_DATA', 'true');
    vi.stubEnv('SITE_URL', 'http://127.0.0.1:3010');

    const { getPublicProductBySlug } = await import('@/server/catalogue/product-page');

    expect(await getPublicProductBySlug('marcado-sin-aprobar')).toBeNull();
  });
});
