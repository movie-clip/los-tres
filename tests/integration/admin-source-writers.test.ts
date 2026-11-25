import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, networks, shops } from '@/db/schema';
import { listCategoryMappingsForAdmin } from '@/server/admin/category-mappings';
import {
  createFeed,
  createNetwork,
  createShop,
  getFeedForEdit,
  getNetworkForEdit,
  getShopForEdit,
  listNetworksForAdmin,
  listSourcesForAdmin,
  setFeedApproval,
  setShopApproval,
  updateFeed,
  updateNetwork,
  updateShop,
} from '@/server/admin/sources';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getSitemapProductSlugs } from '@/server/catalogue/sitemap';
import { getRedirectTarget } from '@/server/clicks/offer-target';
import { seedDemoData } from '@/server/seed';

import { assertTestDatabase, resetDatabase } from '../support/db';
import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';

// US-3.1 / T3.1.3, the writers of src/server/admin/sources.ts against the test database.
// Guardrail 1: a created row is unapproved and nothing a form creates reaches the public
// site; replacing an approved feed's address returns it to unapproved in the same write.
// Guardrail 5: a refusal carries a code and never the value.

beforeEach(resetDatabase);
afterAll(async () => {
  await closeDb();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const rows = {
  networks: () => getDb().select().from(networks).orderBy(networks.id),
  shops: () => getDb().select().from(shops).orderBy(shops.id),
  feeds: () => getDb().select().from(feeds).orderBy(feeds.id),
};

async function aNetwork(slug = 'red-uno', name = 'Red Uno'): Promise<number> {
  const result = await createNetwork(form({ name, slug }));
  if (result.status !== 'written') throw new Error('network not created');
  return result.id;
}

async function aShop(slug = 'tienda-uno', name = 'Tienda Uno'): Promise<number> {
  const result = await createShop(form({ name, slug }));
  if (result.status !== 'written') throw new Error('shop not created');
  return result.id;
}

async function aFeed(shopId: number, networkId: number, url = 'https://feeds.example/uno.csv'): Promise<number> {
  const result = await createFeed(form({ shopId: String(shopId), networkId: String(networkId), url }));
  if (result.status !== 'written') throw new Error(`feed not created: ${JSON.stringify(result)}`);
  return result.id;
}

describe('networks (AC 6 to 9)', () => {
  it('creates a network from a name and a slug, trimmed, and lists it with the others', async () => {
    const result = await createNetwork(form({ name: '  Red Nueva  ', slug: 'red-nueva' }));
    expect(result).toMatchObject({ status: 'written', unapproved: false });
    expect(await rows.networks()).toEqual([expect.objectContaining({ name: 'Red Nueva', slug: 'red-nueva' })]);
    expect(await listNetworksForAdmin()).toEqual([
      { id: (result as { id: number }).id, name: 'Red Nueva', slug: 'red-nueva', demo: false },
    ]);
  });

  it.each([
    ['an empty name', { name: '', slug: 'a' }, { name: 'required' }],
    ['a blank-only name', { name: ' \t ', slug: 'a' }, { name: 'required' }],
    ['a name of 121 characters', { name: 'n'.repeat(121), slug: 'a' }, { name: 'too_long' }],
    ['an empty slug', { name: 'x', slug: '' }, { slug: 'required' }],
    ['an upper-case slug', { name: 'x', slug: 'Red' }, { slug: 'invalid' }],
    ['a slug with a space', { name: 'x', slug: 'a b' }, { slug: 'invalid' }],
    ['a slug of 65 characters', { name: 'x', slug: 's'.repeat(65) }, { slug: 'too_long' }],
    ['a bad name and a bad slug together', { name: '', slug: 'A' }, { name: 'required', slug: 'invalid' }],
    ['no fields at all', {}, { name: 'required', slug: 'required' }],
  ])('refuses %s with every field error at once and writes nothing', async (_label, fields, errors) => {
    expect(await createNetwork(form(fields))).toEqual({ status: 'refused', errors });
    expect(await rows.networks()).toEqual([]);
  });

  it('accepts a name of exactly 120 characters and a slug of exactly 64', async () => {
    expect((await createNetwork(form({ name: 'n'.repeat(120), slug: 's'.repeat(64) }))).status).toBe('written');
  });

  it('refuses a slug another network already has, and keeps the first untouched', async () => {
    await aNetwork('red-uno', 'Primera');
    expect(await createNetwork(form({ name: 'Segunda', slug: 'red-uno' }))).toEqual({
      status: 'refused',
      errors: { slug: 'taken' },
    });
    expect((await rows.networks()).map((row) => row.name)).toEqual(['Primera']);
  });

  it('allows two networks with the same name but not the same slug (D-17)', async () => {
    await aNetwork('red-a', 'Igual');
    expect((await createNetwork(form({ name: 'Igual', slug: 'red-b' }))).status).toBe('written');
    expect(await rows.networks()).toHaveLength(2);
  });

  it('creates exactly one of two submissions with the same slug that arrive at the same moment', async () => {
    const results = await Promise.all([
      createNetwork(form({ name: 'A', slug: 'carrera' })),
      createNetwork(form({ name: 'B', slug: 'carrera' })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'written']);
    expect(results.find((result) => result.status === 'refused')).toEqual({ status: 'refused', errors: { slug: 'taken' } });
    expect(await rows.networks()).toHaveLength(1);
  });

  it('renames a network and leaves its slug alone, even when a crafted request carries another one', async () => {
    const id = await aNetwork('red-fija', 'Antes');
    const result = await updateNetwork(form({ id: String(id), name: 'Despues', slug: 'otro-slug', isDemo: 'true' }));
    expect(result).toEqual({ status: 'written', id, unapproved: false });
    expect(await getNetworkForEdit(id)).toEqual({ id, name: 'Despues', slug: 'red-fija' });
  });

  it('refuses a blank or long name on edit and changes nothing; an unknown id is missing', async () => {
    const id = await aNetwork();
    expect(await updateNetwork(form({ id: String(id), name: '  ' }))).toEqual({ status: 'refused', errors: { name: 'required' } });
    expect(await updateNetwork(form({ id: String(id), name: 'n'.repeat(121) }))).toEqual({
      status: 'refused',
      errors: { name: 'too_long' },
    });
    expect((await getNetworkForEdit(id))?.name).toBe('Red Uno');
    for (const bad of ['4242', '', '0', 'abc']) {
      expect(await updateNetwork(form({ id: bad, name: 'x' }))).toEqual({ status: 'missing' });
    }
    expect(await getNetworkForEdit(9999)).toBeNull();
  });
});

describe('shops (AC 10 to 13)', () => {
  it('creates an unapproved shop with no feed, even when the form carries an approval or a demo flag (AC 4, 11)', async () => {
    const result = await createShop(form({ name: 'Tienda Nueva', slug: 'tienda-nueva', isApproved: 'true', isDemo: 'true', approved: 'true' }));
    expect(result.status).toBe('written');
    expect(await rows.shops()).toEqual([expect.objectContaining({ name: 'Tienda Nueva', slug: 'tienda-nueva', isApproved: false })]);
    expect(await rows.feeds()).toEqual([]);
    expect(await listSourcesForAdmin()).toEqual([
      expect.objectContaining({ name: 'Tienda Nueva', approved: false, demo: false, offerCount: 0, feeds: [] }),
    ]);
  });

  it.each([
    ['an empty name', { name: '', slug: 'a' }, { name: 'required' }],
    ['a blank name', { name: '   ', slug: 'a' }, { name: 'required' }],
    ['a long name', { name: 'n'.repeat(121), slug: 'a' }, { name: 'too_long' }],
    ['an empty slug', { name: 'x', slug: '' }, { slug: 'required' }],
    ['a slug with an accent', { name: 'x', slug: 'tienda-ñ' }, { slug: 'invalid' }],
    ['a slug with an underscore', { name: 'x', slug: 'mi_tienda' }, { slug: 'invalid' }],
    ['a long slug', { name: 'x', slug: 's'.repeat(65) }, { slug: 'too_long' }],
  ])('refuses %s and writes nothing', async (_label, fields, errors) => {
    expect(await createShop(form(fields))).toEqual({ status: 'refused', errors });
    expect(await rows.shops()).toEqual([]);
  });

  it('refuses a slug another shop already has, including a seeded one, and a network slug does not collide', async () => {
    await aShop('mi-tienda', 'Primera');
    expect(await createShop(form({ name: 'Segunda', slug: 'mi-tienda' }))).toEqual({ status: 'refused', errors: { slug: 'taken' } });
    await aNetwork('mi-tienda', 'Red con el mismo slug');
    expect((await rows.shops()).map((row) => row.name)).toEqual(['Primera']);
  });

  it('creates exactly one of two simultaneous submissions with the same slug', async () => {
    const results = await Promise.all([
      createShop(form({ name: 'A', slug: 'carrera' })),
      createShop(form({ name: 'B', slug: 'carrera' })),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'written']);
    expect(await rows.shops()).toHaveLength(1);
  });

  it('renames a shop without touching its slug or its approval, in either state', async () => {
    const id = await aShop('tienda-fija', 'Antes');
    await setShopApproval(id, true);
    expect((await updateShop(form({ id: String(id), name: 'Despues', slug: 'otro', isApproved: 'false' }))).status).toBe('written');
    expect(await rows.shops()).toEqual([expect.objectContaining({ id, name: 'Despues', slug: 'tienda-fija', isApproved: true })]);

    await setShopApproval(id, false);
    await updateShop(form({ id: String(id), name: 'Otra vez', isApproved: 'true' }));
    expect((await rows.shops())[0]).toMatchObject({ name: 'Otra vez', isApproved: false });
    expect(await getShopForEdit(id)).toEqual({ id, name: 'Otra vez', slug: 'tienda-fija' });
  });

  it('refuses a blank name on edit, and an unknown or malformed id is missing', async () => {
    const id = await aShop();
    expect(await updateShop(form({ id: String(id), name: '' }))).toEqual({ status: 'refused', errors: { name: 'required' } });
    expect(await updateShop(form({ id: '5000', name: 'x' }))).toEqual({ status: 'missing' });
    expect(await updateShop(form({ name: 'x' }))).toEqual({ status: 'missing' });
    expect(await getShopForEdit(5000)).toBeNull();
  });
});

describe('reserved demo slugs (AC 46, D-12)', () => {
  it('refuses the network slug demo and the shop slugs beginning tienda-demo-, seed off, naming the slug field', async () => {
    expect(await createNetwork(form({ name: 'Mi demo', slug: 'demo' }))).toEqual({ status: 'refused', errors: { slug: 'reserved' } });
    for (const slug of ['tienda-demo-uno', 'tienda-demo-x', 'tienda-demo-2-b']) {
      expect(await createShop(form({ name: 'Mi tienda', slug }))).toEqual({ status: 'refused', errors: { slug: 'reserved' } });
    }
    expect(await rows.networks()).toEqual([]);
    expect(await rows.shops()).toEqual([]);
  });

  it('refuses them the same way with the seed on, and leaves the seeded rows untouched', async () => {
    await seedDemoData(getDb());
    const before = { networks: await rows.networks(), shops: await rows.shops(), feeds: await rows.feeds() };

    expect(await createNetwork(form({ name: 'Otra', slug: 'demo' }))).toEqual({ status: 'refused', errors: { slug: 'reserved' } });
    expect(await createShop(form({ name: 'Otra', slug: 'tienda-demo-uno' }))).toEqual({ status: 'refused', errors: { slug: 'reserved' } });
    expect(await createShop(form({ name: 'Otra', slug: 'tienda-demo-cinco' }))).toEqual({ status: 'refused', errors: { slug: 'reserved' } });

    expect({ networks: await rows.networks(), shops: await rows.shops(), feeds: await rows.feeds() }).toEqual(before);
  });

  it('accepts a slug that only contains demo elsewhere, or is tienda-demo alone', async () => {
    for (const slug of ['mi-demo', 'demos', 'demo-2', 'tienda-demo', 'mi-tienda-demo-uno']) {
      expect((await createShop(form({ name: slug, slug }))).status, `shop ${slug}`).toBe('written');
    }
    for (const slug of ['mi-demo', 'demo-2', 'tienda-demo-uno']) {
      expect((await createNetwork(form({ name: slug, slug }))).status, `network ${slug}`).toBe('written');
    }
  });

  it('refuses a reserved slug on a crafted request carrying extra fields, and writes no row', async () => {
    expect(await createShop(form({ name: 'x', slug: 'tienda-demo-uno', isApproved: 'true', isDemo: 'true' }))).toEqual({
      status: 'refused',
      errors: { slug: 'reserved' },
    });
    expect(await rows.shops()).toEqual([]);
  });
});

describe('feeds: create (AC 14, 15, 5, 4)', () => {
  it('creates an unapproved, non-demo affiliate feed under an approved shop, stored as typed', async () => {
    const shopId = await aShop();
    await setShopApproval(shopId, true);
    const networkId = await aNetwork();
    const id = await aFeed(shopId, networkId, 'https://feeds.example/uno.csv?apikey=KEY-SENTINEL-1');

    expect(await rows.feeds()).toEqual([
      expect.objectContaining({
        id,
        shopId,
        networkId,
        sourceType: 'affiliate_network',
        url: 'https://feeds.example/uno.csv?apikey=KEY-SENTINEL-1',
        isApproved: false,
        isDemo: false,
      }),
    ]);
    const [shop] = await listSourcesForAdmin();
    expect(shop.feeds).toEqual([
      { id, approved: false, demo: false, source: 'affiliate_network', networkId, networkName: 'Red Uno', offerCount: 0, onSiteOfferCount: 0, host: 'feeds.example', fileName: null },
    ]);
    expect(shop.demo).toBe(false);
  });

  it('ignores a crafted approval, demo flag and source type', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const result = await createFeed(
      form({
        shopId: String(shopId),
        networkId: String(networkId),
        url: 'https://feeds.example/x.csv',
        isApproved: 'true',
        approved: 'true',
        isDemo: 'true',
        demo: 'true',
        sourceType: 'shop_upload',
        source_type: 'shop_upload',
      }),
    );
    expect(result.status).toBe('written');
    expect((await rows.feeds())[0]).toMatchObject({ sourceType: 'affiliate_network', isApproved: false, isDemo: false });
  });

  it('refuses a feed without a network with a network error, before any constraint answers', async () => {
    const shopId = await aShop();
    for (const networkId of [undefined, '', 'abc', '0']) {
      const fields: Record<string, string> = { shopId: String(shopId), url: 'https://feeds.example/x.csv' };
      if (networkId !== undefined) fields.networkId = networkId;
      expect(await createFeed(form(fields)), String(networkId)).toEqual({ status: 'refused', errors: { network: 'required' } });
    }
    expect(await rows.feeds()).toEqual([]);
  });

  it('refuses a shop or a network that does not exist, or both, and writes nothing (AC 5)', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const url = 'https://feeds.example/x.csv';
    expect(await createFeed(form({ shopId: '99999', networkId: String(networkId), url }))).toEqual({ status: 'refused', errors: { shop: 'required' } });
    expect(await createFeed(form({ shopId: String(shopId), networkId: '99999', url }))).toEqual({ status: 'refused', errors: { network: 'required' } });
    expect(await createFeed(form({ shopId: '99999', networkId: '99999', url }))).toEqual({
      status: 'refused',
      errors: { shop: 'required', network: 'required' },
    });
    expect(await createFeed(form({ networkId: String(networkId), url }))).toEqual({ status: 'refused', errors: { shop: 'required' } });
    expect(await rows.feeds()).toEqual([]);
  });

  it('reports the shop, the network and the address errors together', async () => {
    expect(await createFeed(form({ url: 'http://nope.example/x' }))).toEqual({
      status: 'refused',
      errors: { shop: 'required', network: 'required', url: 'invalid' },
    });
  });
});

describe('feeds: the address rule (AC 16), through createFeed', () => {
  const LONG_OK = `https://feeds.example/${'a'.repeat(2048 - 'https://feeds.example/'.length)}`;
  const accepted: [string, string][] = [
    ['a plain https address', 'https://feeds.example/catalogo.csv'],
    ['a signed query string', 'https://api.example/feed?apikey=K&sig=a%2Fb%3D'],
    ['an upper-case scheme', 'HTTPS://A.com/x?key=1'],
    ['a port', 'https://feeds.example:8443/f.csv'],
    ['an internationalised host', 'https://xn--bcher-kva.example/f.csv'],
    ['a bare host', 'https://feeds.example'],
    ['an address of exactly 2048 characters', LONG_OK],
  ];
  const refused: [string, string, string][] = [
    ['empty', '', 'required'],
    ['blank only', '   ', 'required'],
    ['http', 'http://feeds.example/x.csv', 'invalid'],
    ['a demo-feed: value', 'demo-feed:feed-uno.csv', 'invalid'],
    ['ftp', 'ftp://feeds.example/x.csv', 'invalid'],
    ['javascript:', 'javascript:alert(1)', 'invalid'],
    ['file:', 'file:///etc/passwd', 'invalid'],
    ['relative', '/feeds/uno.csv', 'invalid'],
    ['a host with no scheme', 'feeds.example/x.csv', 'invalid'],
    ['only a scheme', 'https://', 'invalid'],
    ['a space inside', 'https://feeds.example/a b.csv', 'invalid'],
    ['a line break inside', 'https://feeds.example/a\nb', 'invalid'],
    ['a tab inside', 'https://feeds.example/a\tb', 'invalid'],
    ['a DEL character', 'https://feeds.example/a\u007fb', 'invalid'],
    ['an unclosed bracket host', 'https://[::1/x', 'invalid'],
    ['a user name and password', 'https://user:KEY-SENTINEL-2@feeds.example/x.csv', 'credentials'],
    ['a user name only', 'https://KEY-SENTINEL-3@feeds.example/x.csv', 'credentials'],
    ['an address of 2049 characters', `${LONG_OK}a`, 'too_long'],
  ];

  async function submit(url: string) {
    const shopId = (await rows.shops())[0]?.id ?? (await aShop());
    const networkId = (await rows.networks())[0]?.id ?? (await aNetwork());
    return createFeed(form({ shopId: String(shopId), networkId: String(networkId), url }));
  }

  it.each(accepted)('accepts %s', async (_label, url) => {
    expect((await submit(url)).status).toBe('written');
    expect((await rows.feeds())[0].url).toBe(url);
  });

  it('trims blank space around an address and stores it trimmed', async () => {
    expect((await submit('  https://feeds.example/trim.csv \n')).status).toBe('written');
    expect((await rows.feeds())[0].url).toBe('https://feeds.example/trim.csv');
  });

  it.each(refused)('refuses %s and writes nothing', async (label, url, code) => {
    const result = await submit(url);
    expect(result, label).toEqual({ status: 'refused', errors: { url: code } });
    expect(await rows.feeds()).toEqual([]);
  });

  it('never repeats the value, or any part of it, in a refusal', async () => {
    for (const url of ['https://user:KEY-SENTINEL-4@feeds.example/x?apikey=KEY-SENTINEL-4', 'http://feeds.example/?token=KEY-SENTINEL-4']) {
      const result = await submit(url);
      expect(result.status).toBe('refused');
      expect(JSON.stringify(result)).not.toMatch(/KEY-SENTINEL|feeds\.example|apikey|token|https?:/);
    }
  });
});

describe('feeds: duplicates (AC 17)', () => {
  it('refuses a second feed with the same shop and address, naming the url field and not repeating it', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    await aFeed(shopId, networkId, 'https://feeds.example/same.csv?k=KEY-SENTINEL-5');
    const again = await createFeed(
      form({ shopId: String(shopId), networkId: String(networkId), url: 'https://feeds.example/same.csv?k=KEY-SENTINEL-5' }),
    );
    expect(again).toEqual({ status: 'refused', errors: { url: 'duplicate' } });
    expect(await rows.feeds()).toHaveLength(1);
  });

  it('accepts the same address under another shop, and the comparison is literal on the trimmed string (D-22)', async () => {
    const one = await aShop('tienda-uno');
    const two = await aShop('tienda-dos');
    const networkId = await aNetwork();
    await aFeed(one, networkId, 'https://feeds.example/f.csv');
    await aFeed(two, networkId, 'https://feeds.example/f.csv');
    await aFeed(one, networkId, 'https://FEEDS.example/f.csv');
    expect(await rows.feeds()).toHaveLength(3);
    expect((await createFeed(form({ shopId: String(one), networkId: String(networkId), url: ' https://feeds.example/f.csv ' }))).status).toBe('refused');
  });

  it('creates exactly one of two simultaneous submissions with the same shop and address', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const fields = { shopId: String(shopId), networkId: String(networkId), url: 'https://feeds.example/race.csv' };
    const results = await Promise.all([createFeed(form(fields)), createFeed(form(fields))]);
    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'written']);
    expect(results.find((result) => result.status === 'refused')).toEqual({ status: 'refused', errors: { url: 'duplicate' } });
    expect(await rows.feeds()).toHaveLength(1);
  });
});

describe('feeds: edit (AC 18 to 22)', () => {
  async function approvedFeed(url = 'https://feeds.example/old.csv?apikey=KEY-SENTINEL-6') {
    const shopId = await aShop();
    await setShopApproval(shopId, true);
    const networkId = await aNetwork('red-a', 'Red A');
    const feedId = await aFeed(shopId, networkId, url);
    await setFeedApproval(feedId, true);
    return { shopId, networkId, feedId };
  }
  const feedRow = async (id: number) => (await rows.feeds()).find((row) => row.id === id)!;

  it('with the address empty, keeps the address and the approval and applies the network (AC 19)', async () => {
    const { feedId } = await approvedFeed();
    const other = await aNetwork('red-b', 'Red B');

    const result = await updateFeed(form({ id: String(feedId), networkId: String(other), url: '' }));

    expect(result).toEqual({ status: 'written', id: feedId, unapproved: false });
    expect(await feedRow(feedId)).toMatchObject({ networkId: other, url: 'https://feeds.example/old.csv?apikey=KEY-SENTINEL-6', isApproved: true });
  });

  it('also keeps both with the address field absent or blank-only', async () => {
    const { feedId, networkId } = await approvedFeed();
    for (const fields of [{} as Record<string, string>, { url: '   ' }]) {
      expect((await updateFeed(form({ id: String(feedId), networkId: String(networkId), ...fields }))).status).toBe('written');
    }
    expect(await feedRow(feedId)).toMatchObject({ isApproved: true, url: 'https://feeds.example/old.csv?apikey=KEY-SENTINEL-6' });
  });

  it('replacing the address of an approved feed returns it to unapproved, in one write, and reports it (AC 20)', async () => {
    const { feedId, networkId } = await approvedFeed();
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
      const result = await updateFeed(form({ id: String(feedId), networkId: String(networkId), url: 'https://feeds.example/new.csv' }));
      expect(result).toEqual({ status: 'written', id: feedId, unapproved: true });
      const log = (await db.execute(sql.raw('select url, is_approved from feed_update_log order by n'))).rows;
      // One UPDATE touched the row, and it already carried the new address and the unapproved state.
      expect(log).toEqual([{ url: 'https://feeds.example/new.csv', is_approved: false }]);
    } finally {
      await db.execute(sql.raw('drop trigger if exists log_feed_update on feeds'));
      await db.execute(sql.raw('drop function if exists log_feed_update()'));
      await db.execute(sql.raw('drop table if exists feed_update_log'));
    }
    expect(await feedRow(feedId)).toMatchObject({ url: 'https://feeds.example/new.csv', isApproved: false });
  });

  it('counts an identical address as a replacement (D-15), and the offers leave every public reader at once', async () => {
    const { feedId, networkId } = await approvedFeed('https://feeds.example/same.csv');
    const product = await insertProduct({ slug: 'producto-edicion' });
    const offerId = await insertOffer({ productId: product.id, feedId, priceCents: 1500 });
    const view = async () => ({
      page: (await getPublicProductBySlug('producto-edicion'))?.offers.map((offer) => offer.offerId) ?? null,
      target: (await getRedirectTarget(offerId)) !== null,
      sitemap: ((await getSitemapProductSlugs(1)) ?? []).includes('producto-edicion'),
    });
    expect(await view()).toEqual({ page: [offerId], target: true, sitemap: true });

    const result = await updateFeed(form({ id: String(feedId), networkId: String(networkId), url: 'https://feeds.example/same.csv' }));

    expect(result).toEqual({ status: 'written', id: feedId, unapproved: true });
    expect(await view()).toEqual({ page: null, target: false, sitemap: false });
    expect((await feedRow(feedId)).isApproved).toBe(false);
  });

  it('leaves an unapproved feed unapproved when its address is replaced, and reports nothing was unapproved', async () => {
    const { feedId, networkId } = await approvedFeed();
    await setFeedApproval(feedId, false);
    const result = await updateFeed(form({ id: String(feedId), networkId: String(networkId), url: 'https://feeds.example/new.csv' }));
    expect(result).toEqual({ status: 'written', id: feedId, unapproved: false });
    expect(await feedRow(feedId)).toMatchObject({ isApproved: false, url: 'https://feeds.example/new.csv' });
  });

  it('changing only the network of an approved feed leaves it approved and its offers public', async () => {
    const { feedId } = await approvedFeed();
    const other = await aNetwork('red-b', 'Red B');
    const product = await insertProduct({ slug: 'producto-red' });
    const offerId = await insertOffer({ productId: product.id, feedId });
    await updateFeed(form({ id: String(feedId), networkId: String(other) }));
    expect(await feedRow(feedId)).toMatchObject({ isApproved: true, networkId: other });
    expect((await getRedirectTarget(offerId)) !== null).toBe(true);
  });

  it('refuses a missing network and a bad address together on edit, and changes nothing', async () => {
    const { feedId } = await approvedFeed();
    const before = await feedRow(feedId);
    expect(await updateFeed(form({ id: String(feedId), networkId: '99999', url: 'http://nope.example/x' }))).toEqual({
      status: 'refused',
      errors: { network: 'required', url: 'invalid' },
    });
    expect(await updateFeed(form({ id: String(feedId), url: 'https://feeds.example/new.csv' }))).toEqual({
      status: 'refused',
      errors: { network: 'required' },
    });
    expect(await feedRow(feedId)).toEqual(before);
  });

  it.each([
    ['credentials', 'https://u:p@feeds.example/x', 'credentials'],
    ['http', 'http://feeds.example/x', 'invalid'],
    ['too long', `https://feeds.example/${'a'.repeat(2048)}`, 'too_long'],
  ])('refuses a %s address on an approved feed and leaves the address and the approval as they were', async (_label, url, code) => {
    const { feedId, networkId } = await approvedFeed();
    const before = await feedRow(feedId);
    expect(await updateFeed(form({ id: String(feedId), networkId: String(networkId), url }))).toEqual({ status: 'refused', errors: { url: code } });
    expect(await feedRow(feedId)).toEqual(before);
  });

  it('refuses an address another feed of the same shop has, through the unique key, and changes nothing', async () => {
    const { shopId, networkId, feedId } = await approvedFeed();
    await aFeed(shopId, networkId, 'https://feeds.example/taken.csv?k=KEY-SENTINEL-7');
    const before = await feedRow(feedId);
    const result = await updateFeed(form({ id: String(feedId), networkId: String(networkId), url: 'https://feeds.example/taken.csv?k=KEY-SENTINEL-7' }));
    expect(result).toEqual({ status: 'refused', errors: { url: 'duplicate' } });
    expect(JSON.stringify(result)).not.toContain('KEY-SENTINEL');
    expect(await feedRow(feedId)).toEqual(before);
  });

  it('a crafted request cannot change the shop, the approval, the demo flag or the source type', async () => {
    const { shopId, networkId, feedId } = await approvedFeed();
    const otherShop = await aShop('tienda-dos');
    await updateFeed(
      form({
        id: String(feedId),
        networkId: String(networkId),
        shopId: String(otherShop),
        isApproved: 'false',
        isDemo: 'true',
        sourceType: 'shop_upload',
      }),
    );
    expect(await feedRow(feedId)).toMatchObject({ shopId, isApproved: true, isDemo: false, sourceType: 'affiliate_network' });
  });

  it('a demo feed keeps its address when a crafted request carries one, while its network edit applies (AC 22, D-13)', async () => {
    await seedDemoData(getDb());
    const [demo] = await getDb().select().from(feeds).where(eq(feeds.isDemo, true)).orderBy(feeds.id);
    const other = await aNetwork('red-b', 'Red B');

    const result = await updateFeed(form({ id: String(demo.id), networkId: String(other), url: 'https://evil.example/replaced.csv' }));

    expect(result).toEqual({ status: 'written', id: demo.id, unapproved: false });
    expect(await feedRow(demo.id)).toMatchObject({ url: demo.url, networkId: other, isApproved: true, isDemo: true });
  });

  it('a demo feed ignores even an invalid crafted address instead of refusing it', async () => {
    await seedDemoData(getDb());
    const [demo] = await getDb().select().from(feeds).where(eq(feeds.isDemo, true)).orderBy(feeds.id);
    const result = await updateFeed(form({ id: String(demo.id), networkId: String(demo.networkId), url: 'http://nope.example' }));
    expect(result.status).toBe('written');
    expect((await feedRow(demo.id)).url).toBe(demo.url);
  });

  it('is missing for an unknown id and for a shop upload feed, which has no form (D-T12)', async () => {
    const shop = await insertShop();
    const uploadId = await insertFeed(shop.id, { url: 'upload.csv' });
    const networkId = await aNetwork();
    expect(await updateFeed(form({ id: '4242', networkId: String(networkId) }))).toEqual({ status: 'missing' });
    expect(await updateFeed(form({ networkId: String(networkId) }))).toEqual({ status: 'missing' });
    expect(await updateFeed(form({ id: String(uploadId), networkId: String(networkId), url: 'https://feeds.example/x' }))).toEqual({ status: 'missing' });
    expect(await getFeedForEdit(uploadId)).toBeNull();
    expect(await getFeedForEdit(4242)).toBeNull();
    expect((await feedRow(uploadId)).url).toBe('upload.csv');
  });

  it('reads a feed for its edit form with the host only, never the address', async () => {
    const { shopId, networkId, feedId } = await approvedFeed('https://user-less.example:8443/f.csv?apikey=KEY-SENTINEL-8');
    const edit = await getFeedForEdit(feedId);
    expect(edit).toEqual({ source: 'affiliate_network', id: feedId, shopId, shopName: 'Tienda Uno', networkId, approved: true, demo: false, host: 'user-less.example' });
    expect(JSON.stringify(edit)).not.toMatch(/KEY-SENTINEL|apikey|https:|8443/);
  });
});

describe('a failed write leaves nothing half-changed (AC 29)', () => {
  async function withFailingFeedWrites(run: () => Promise<void>) {
    await assertTestDatabase();
    const db = getDb();
    await db.execute(
      sql.raw(
        "create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$",
      ),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before insert or update on feeds for each row execute function fail_feed_write()'));
    try {
      await run();
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }
  }

  it('an insert that fails throws and leaves no feed', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    await withFailingFeedWrites(async () => {
      await expect(createFeed(form({ shopId: String(shopId), networkId: String(networkId), url: 'https://feeds.example/x.csv' }))).rejects.toThrow();
    });
    expect(await rows.feeds()).toEqual([]);
  });

  it('an update that fails throws and leaves the address, the network and the approval as they were', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const other = await aNetwork('red-b', 'Red B');
    const feedId = await aFeed(shopId, networkId);
    await setFeedApproval(feedId, true);
    const before = (await rows.feeds())[0];
    await withFailingFeedWrites(async () => {
      await expect(
        updateFeed(form({ id: String(feedId), networkId: String(other), url: 'https://feeds.example/new.csv' })),
      ).rejects.toThrow();
    });
    expect((await rows.feeds())[0]).toEqual(before);
  });
});

describe('creating changes nothing the public sees (AC 44)', () => {
  it('a network, a shop and a feed leave the product page, /go and the sitemap as they were', async () => {
    const shop = await insertShop();
    const liveFeed = await insertFeed(shop.id);
    const product = await insertProduct({ slug: 'producto-publico' });
    const offerId = await insertOffer({ productId: product.id, feedId: liveFeed, priceCents: 1500 });
    const view = async () => ({
      page: await getPublicProductBySlug('producto-publico'),
      target: await getRedirectTarget(offerId),
      sitemap: await getSitemapProductSlugs(1),
    });
    const before = await view();

    const networkId = await aNetwork();
    const shopId = await aShop();
    const feedId = await aFeed(shopId, networkId);
    await updateShop(form({ id: String(shopId), name: 'Otro nombre' }));

    expect(await view()).toEqual(before);
    expect((await rows.feeds()).find((row) => row.id === feedId)?.isApproved).toBe(false);
  });
});

describe('the derived demo marker (AC 35)', () => {
  it('marks a shop demo only with at least one feed and every feed demo; a network likewise', async () => {
    const networkId = await aNetwork();
    const empty = await aShop('tienda-vacia', 'Vacia');
    const mixed = await aShop('tienda-mixta', 'Mixta');
    const onlyDemo = await insertShop({ name: 'Solo demo' });
    await insertFeed(onlyDemo.id, { url: 'demo-feed:solo.csv', isDemo: true });
    await insertFeed(mixed, { url: 'demo-feed:mixta.csv', isDemo: true });
    await aFeed(mixed, networkId);

    const list = await listSourcesForAdmin();
    const byId = new Map(list.map((shop) => [shop.id, shop.demo]));
    expect(byId.get(empty)).toBe(false);
    expect(byId.get(mixed)).toBe(false);
    expect(byId.get(onlyDemo.id)).toBe(true);
    expect((await listNetworksForAdmin()).find((network) => network.id === networkId)?.demo).toBe(false);
  });
});

// US-3.7 / T3.7.2: a catalogue-file feed through the same two writers. The source field
// picks the kind on create; the stored source picks it on edit. Guardrail 1: a file feed is
// created and edited unapproved, and a new name is one write that also unapproves it.
// Guardrail 5: a refusal carries a code and never the name; nothing here logs.
describe('feeds: create a catalogue file (S3.7, AC 1 to 4, 7, 9, 13)', () => {
  const fileForm = (shopId: number, fileName: string, extra: Record<string, string> = {}) =>
    form({ source: 'catalogue_file', shopId: String(shopId), fileName, ...extra });

  it('creates an unapproved, non-demo feed with no network under an approved shop, stored trimmed', async () => {
    const shopId = await aShop();
    await setShopApproval(shopId, true);

    const result = await createFeed(fileForm(shopId, '  mi-catalogo.csv \n'));

    expect(result).toMatchObject({ status: 'written', unapproved: false });
    const id = (result as { id: number }).id;
    expect(await rows.feeds()).toEqual([
      expect.objectContaining({
        id,
        shopId,
        networkId: null,
        sourceType: 'catalogue_file',
        url: 'mi-catalogo.csv',
        isApproved: false,
        isDemo: false,
      }),
    ]);
    const [shop] = await listSourcesForAdmin();
    expect(shop.feeds).toEqual([
      { id, approved: false, demo: false, source: 'catalogue_file', networkId: null, networkName: null, offerCount: 0, onSiteOfferCount: 0, host: null, fileName: 'mi-catalogo.csv' },
    ]);
    expect(await getFeedForEdit(id)).toEqual({
      source: 'catalogue_file',
      id,
      shopId,
      shopName: 'Tienda Uno',
      approved: false,
      demo: false,
      fileName: 'mi-catalogo.csv',
    });
  });

  it.each(['mi-catalogo.csv', 'a.xml', 'A_b-1.CSV.GZ', 'x.xml.gz', `${'a'.repeat(96)}.csv`])('accepts the name %s', async (name) => {
    const shopId = await aShop();
    expect((await createFeed(fileForm(shopId, name))).status).toBe('written');
    expect((await rows.feeds())[0].url).toBe(name);
  });

  it('accepts a name whose file does not exist, and reads no file (AC 9)', async () => {
    const shopId = await aShop();
    expect((await createFeed(fileForm(shopId, 'todavia-no-existe.csv'))).status).toBe('written');
  });

  it.each([
    ['empty', '', 'required'],
    ['blank only', ' \t\n ', 'required'],
    ['101 characters', `${'a'.repeat(97)}.csv`, 'too_long'],
    ['a parent step', '../x.csv', 'not_a_name'],
    ['a parent step inside', 'a..b.csv', 'not_a_name'],
    ['a posix path', 'carpeta/x.csv', 'not_a_name'],
    ['an absolute posix path', '/etc/x.csv', 'not_a_name'],
    ['a windows path', 'carpeta\\x.csv', 'not_a_name'],
    ['a drive letter', 'C:\\x.csv', 'not_a_name'],
    ['a share', '\\\\server\\x.csv', 'not_a_name'],
    ['an https address', 'https://feeds.example/x.csv', 'not_a_name'],
    ['a demo-feed: value', 'demo-feed:feed-uno.csv', 'not_a_name'],
    ['a file: address', 'file:///etc/passwd', 'not_a_name'],
    ['a stream', 'x.csv:stream', 'not_a_name'],
    ['a hidden name', '.hidden.csv', 'not_a_name'],
    ['only a kind', '.csv', 'not_a_name'],
    ['a device name', 'con.csv', 'not_a_name'],
    ['a device name in capitals', 'LPT1.xml', 'not_a_name'],
    ['a space inside', 'mi catalogo.csv', 'unusable'],
    ['a control character', 'a\u0000b.csv', 'unusable'],
    ['an accent', 'catálogo.csv', 'unusable'],
    ['a plus sign', 'a+b.csv', 'unusable'],
    ['an unknown kind', 'x.txt', 'wrong_kind'],
    ['no kind', 'catalogo', 'wrong_kind'],
    ['a dash for a dot', 'x-csv', 'wrong_kind'],
  ])('refuses %s with a fixed code on the file field and writes nothing', async (label, name, code) => {
    const shopId = await aShop();
    const result = await createFeed(fileForm(shopId, name));
    expect(result, label).toEqual({ status: 'refused', errors: { fileName: code } });
    expect(await rows.feeds()).toEqual([]);
  });

  it('reports the shop and the file name errors together, and a missing shop alone', async () => {
    const shopId = await aShop();
    expect(await createFeed(form({ source: 'catalogue_file', fileName: '' }))).toEqual({
      status: 'refused',
      errors: { shop: 'required', fileName: 'required' },
    });
    expect(await createFeed(form({ source: 'catalogue_file', shopId: '99999', fileName: 'x.csv' }))).toEqual({
      status: 'refused',
      errors: { shop: 'required' },
    });
    expect(await createFeed(fileForm(shopId, ''))).toEqual({ status: 'refused', errors: { fileName: 'required' } });
    expect(await rows.feeds()).toEqual([]);
  });

  it('needs no network, and neither reads nor stores a crafted one, an address, an approval, a demo flag or a source type', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const result = await createFeed(
      fileForm(shopId, 'crafted.csv', {
        networkId: String(networkId),
        url: 'https://evil.example/x.csv?apikey=KEY-SENTINEL-F1',
        isApproved: 'true',
        approved: 'true',
        isDemo: 'true',
        demo: 'true',
        sourceType: 'shop_upload',
        source_type: 'shop_upload',
      }),
    );
    expect(result.status).toBe('written');
    expect(await rows.feeds()).toEqual([
      expect.objectContaining({ networkId: null, sourceType: 'catalogue_file', url: 'crafted.csv', isApproved: false, isDemo: false }),
    ]);
  });

  it('refuses a source other than the two, writes nothing, and treats an absent or empty source as affiliate (AC 7, 8)', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    for (const source of ['shop_upload', 'demo', 'catalogue-file', 'Catalogue_File', ' catalogue_file', 'x', 'null']) {
      const result = await createFeed(
        form({ source, shopId: String(shopId), networkId: String(networkId), url: 'https://feeds.example/x.csv', fileName: 'x.csv' }),
      );
      expect(result, source).toEqual({ status: 'refused', errors: { source: 'invalid' } });
    }
    expect(await rows.feeds()).toEqual([]);

    const fields = { shopId: String(shopId), networkId: String(networkId) };
    expect((await createFeed(form({ ...fields, url: 'https://feeds.example/a.csv' }))).status).toBe('written');
    expect((await createFeed(form({ ...fields, source: '', url: 'https://feeds.example/b.csv' }))).status).toBe('written');
    expect((await createFeed(form({ ...fields, source: 'affiliate_network', url: 'https://feeds.example/c.csv' }))).status).toBe('written');
    expect((await rows.feeds()).map((row) => row.sourceType)).toEqual(['affiliate_network', 'affiliate_network', 'affiliate_network']);
  });

  it('keeps the affiliate refusals for a feed with no network, and reads no file name there (AC 2, 8)', async () => {
    const shopId = await aShop();
    expect(
      await createFeed(form({ source: 'affiliate_network', shopId: String(shopId), url: 'https://feeds.example/x.csv', fileName: 'x.csv' })),
    ).toEqual({ status: 'refused', errors: { network: 'required' } });
    expect(await createFeed(form({ shopId: String(shopId), url: 'demo-feed:feed-uno.csv', fileName: 'x.csv' }))).toEqual({
      status: 'refused',
      errors: { network: 'required', url: 'invalid' },
    });
    expect(await rows.feeds()).toEqual([]);
  });

  it('refuses a second feed with the same shop and name, on the file field, without repeating the name (AC 4)', async () => {
    const shopId = await aShop();
    await createFeed(fileForm(shopId, 'repetido-SENTINEL.csv'));
    const again = await createFeed(fileForm(shopId, ' repetido-SENTINEL.csv '));
    expect(again).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(again)).not.toContain('SENTINEL');
    expect(await rows.feeds()).toHaveLength(1);
  });

  it('accepts the same name under another shop, and a name that differs only by case', async () => {
    const one = await aShop('tienda-uno');
    const two = await aShop('tienda-dos');
    await createFeed(fileForm(one, 'mismo.csv'));
    expect((await createFeed(fileForm(two, 'mismo.csv'))).status).toBe('written');
    expect((await createFeed(fileForm(one, 'MISMO.csv'))).status).toBe('written');
    expect(await rows.feeds()).toHaveLength(3);
  });

  it('creates exactly one of two simultaneous submissions with the same shop and name (AC 4)', async () => {
    const shopId = await aShop();
    const results = await Promise.all([createFeed(fileForm(shopId, 'carrera.csv')), createFeed(fileForm(shopId, 'carrera.csv'))]);
    expect(results.map((result) => result.status).sort()).toEqual(['refused', 'written']);
    expect(results.find((result) => result.status === 'refused')).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(await rows.feeds()).toHaveLength(1);
  });

  it('writes no approval on the feed or its shop, leaves public readers as they were, and logs nothing (AC 7, 14, 42)', async () => {
    const logged: unknown[][] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void logged.push(args));
    }
    try {
      const shop = await insertShop();
      const liveFeed = await insertFeed(shop.id);
      const product = await insertProduct({ slug: 'producto-publico-archivo' });
      const offerId = await insertOffer({ productId: product.id, feedId: liveFeed, priceCents: 1500 });
      const view = async () => ({
        page: await getPublicProductBySlug('producto-publico-archivo'),
        target: await getRedirectTarget(offerId),
        sitemap: await getSitemapProductSlugs(1),
      });
      const before = await view();
      const shopBefore = (await rows.shops()).find((row) => row.id === shop.id);

      const shopId = await aShop('tienda-archivo');
      const created = await createFeed(fileForm(shopId, 'log-SENTINEL.csv'));
      await updateFeed(form({ id: String((created as { id: number }).id), fileName: 'log-SENTINEL-2.csv' }));
      await createFeed(fileForm(shopId, '../log-SENTINEL-3.csv'));
      await listSourcesForAdmin();

      expect(await view()).toEqual(before);
      expect((await rows.shops()).find((row) => row.id === shop.id)).toEqual(shopBefore);
      expect((await rows.shops()).find((row) => row.id === shopId)?.isApproved).toBe(false);
      expect((await rows.feeds()).find((row) => row.url === 'log-SENTINEL-2.csv')?.isApproved).toBe(false);
      expect(JSON.stringify(logged)).not.toContain('SENTINEL');
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('feeds: edit a catalogue file (S3.7, AC 11, 12, 7)', () => {
  async function fileFeed(name = 'viejo.csv', approved = false) {
    const shopId = await aShop();
    await setShopApproval(shopId, true);
    const result = await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: name }));
    if (result.status !== 'written') throw new Error(`file feed not created: ${JSON.stringify(result)}`);
    if (approved) await setFeedApproval(result.id, true);
    return { shopId, feedId: result.id };
  }
  const feedRow = async (id: number) => (await rows.feeds()).find((row) => row.id === id)!;

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

  it('changes the name of an unapproved feed, which stays unapproved, and reports nothing was unapproved', async () => {
    const { shopId, feedId } = await fileFeed();
    const result = await updateFeed(form({ id: String(feedId), fileName: ' nuevo.xml ' }));
    expect(result).toEqual({ status: 'written', id: feedId, unapproved: false });
    expect(await feedRow(feedId)).toMatchObject({ shopId, url: 'nuevo.xml', isApproved: false, networkId: null, sourceType: 'catalogue_file' });
  });

  it('a new name on an approved feed is one write that stores it and returns the feed to unapproved, and reports it (AC 12)', async () => {
    const { feedId } = await fileFeed('viejo.csv', true);
    const { value, log } = await withUpdateLog(() => updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv' })));
    expect(value).toEqual({ status: 'written', id: feedId, unapproved: true });
    // One UPDATE touched the row, and it already carried the new name and the unapproved state.
    expect(log).toEqual([{ url: 'nuevo.csv', is_approved: false }]);
    expect(await feedRow(feedId)).toMatchObject({ url: 'nuevo.csv', isApproved: false });
  });

  it('the offers of an approved feed leave every public reader at once when its name changes', async () => {
    const { feedId } = await fileFeed('viejo.csv', true);
    const product = await insertProduct({ slug: 'producto-archivo-renombrado' });
    const offerId = await insertOffer({ productId: product.id, feedId, priceCents: 1500 });
    const view = async () => ({
      page: (await getPublicProductBySlug('producto-archivo-renombrado'))?.offers.map((offer) => offer.offerId) ?? null,
      target: (await getRedirectTarget(offerId)) !== null,
      sitemap: ((await getSitemapProductSlugs(1)) ?? []).includes('producto-archivo-renombrado'),
    });
    expect(await view()).toEqual({ page: [offerId], target: true, sitemap: true });

    await updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv' }));

    expect(await view()).toEqual({ page: null, target: false, sitemap: false });
  });

  it('saving the same name again writes nothing and leaves an approved feed approved (AC 12)', async () => {
    const { feedId } = await fileFeed('igual.csv', true);
    const before = await feedRow(feedId);
    const { value, log } = await withUpdateLog(async () => [
      await updateFeed(form({ id: String(feedId), fileName: 'igual.csv' })),
      await updateFeed(form({ id: String(feedId), fileName: '  igual.csv\n' })),
    ]);
    expect(value).toEqual([
      { status: 'written', id: feedId, unapproved: false },
      { status: 'written', id: feedId, unapproved: false },
    ]);
    expect(log).toEqual([]);
    expect(await feedRow(feedId)).toEqual(before);
  });

  it('counts a name that differs only by case as a new name (the form compares exactly)', async () => {
    const { feedId } = await fileFeed('Igual.csv', true);
    const result = await updateFeed(form({ id: String(feedId), fileName: 'igual.csv' }));
    expect(result).toEqual({ status: 'written', id: feedId, unapproved: true });
    expect(await feedRow(feedId)).toMatchObject({ url: 'igual.csv', isApproved: false });
  });

  it('refuses a stored value that is not a name typed back, and replaces it with a real name', async () => {
    const shopId = await aShop();
    const [planted] = await getDb()
      .insert(feeds)
      .values({ shopId, networkId: null, sourceType: 'catalogue_file', url: '../fuera.csv', isApproved: true, isDemo: false })
      .returning({ id: feeds.id });
    expect(await updateFeed(form({ id: String(planted.id), fileName: '../fuera.csv' }))).toEqual({
      status: 'refused',
      errors: { fileName: 'not_a_name' },
    });
    expect(await updateFeed(form({ id: String(planted.id), fileName: 'dentro.csv' }))).toEqual({
      status: 'written',
      id: planted.id,
      unapproved: true,
    });
  });

  it.each([
    ['empty (no "keep" meaning)', '', 'required'],
    ['absent', null, 'required'],
    ['a path', '../x.csv', 'not_a_name'],
    ['a space inside', 'a b.csv', 'unusable'],
    ['a wrong kind', 'x.txt', 'wrong_kind'],
    ['too long', `${'a'.repeat(97)}.csv`, 'too_long'],
  ])('refuses %s on an approved feed and leaves the name and the approval as they were', async (_label, name, code) => {
    const { feedId } = await fileFeed('viejo.csv', true);
    const before = await feedRow(feedId);
    const fields: Record<string, string> = { id: String(feedId) };
    if (name !== null) fields.fileName = name;
    expect(await updateFeed(form(fields))).toEqual({ status: 'refused', errors: { fileName: code } });
    expect(await feedRow(feedId)).toEqual(before);
  });

  it('refuses a name another feed of the same shop has, on the file field, and changes nothing (AC 4)', async () => {
    const { shopId, feedId } = await fileFeed('uno.csv', true);
    await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'ocupado-SENTINEL.csv' }));
    const before = await feedRow(feedId);
    const result = await updateFeed(form({ id: String(feedId), fileName: 'ocupado-SENTINEL.csv' }));
    expect(result).toEqual({ status: 'refused', errors: { fileName: 'duplicate' } });
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(await feedRow(feedId)).toEqual(before);
  });

  it('a crafted request cannot change the shop, the approval, the demo flag, the source, the network or the address', async () => {
    const { shopId, feedId } = await fileFeed('viejo.csv', true);
    const otherShop = await aShop('tienda-dos');
    const networkId = await aNetwork();
    await updateFeed(
      form({
        id: String(feedId),
        fileName: 'viejo.csv',
        source: 'affiliate_network',
        shopId: String(otherShop),
        networkId: String(networkId),
        url: 'https://evil.example/x.csv',
        isApproved: 'false',
        isDemo: 'true',
        sourceType: 'affiliate_network',
      }),
    );
    expect(await feedRow(feedId)).toMatchObject({
      shopId,
      networkId: null,
      sourceType: 'catalogue_file',
      url: 'viejo.csv',
      isApproved: true,
      isDemo: false,
    });
    // A name change with the same crafted fields moves only the name and the approval.
    await updateFeed(
      form({ id: String(feedId), fileName: 'otro.csv', shopId: String(otherShop), networkId: String(networkId), url: 'https://evil.example/x.csv' }),
    );
    expect(await feedRow(feedId)).toMatchObject({ shopId, networkId: null, sourceType: 'catalogue_file', url: 'otro.csv', isApproved: false, isDemo: false });
  });

  it('an affiliate feed ignores a crafted file name, and a shop upload feed is still missing', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const affiliate = await aFeed(shopId, networkId, 'https://feeds.example/keep.csv');
    expect(await updateFeed(form({ id: String(affiliate), networkId: String(networkId), fileName: 'x.csv', source: 'catalogue_file' }))).toEqual({
      status: 'written',
      id: affiliate,
      unapproved: false,
    });
    expect(await rows.feeds()).toEqual([expect.objectContaining({ url: 'https://feeds.example/keep.csv', sourceType: 'affiliate_network' })]);

    const shop = await insertShop();
    const uploadId = await insertFeed(shop.id, { url: 'upload.csv' });
    expect(await updateFeed(form({ id: String(uploadId), fileName: 'x.csv' }))).toEqual({ status: 'missing' });
    expect(await getFeedForEdit(uploadId)).toBeNull();
    expect(await updateFeed(form({ id: '4242', fileName: 'x.csv' }))).toEqual({ status: 'missing' });
  });

  it('an update that fails throws and leaves the name and the approval as they were', async () => {
    const { feedId } = await fileFeed('viejo.csv', true);
    const before = await feedRow(feedId);
    await assertTestDatabase();
    const db = getDb();
    await db.execute(
      sql.raw("create function fail_feed_write() returns trigger language plpgsql as $$ begin raise exception 'boom %', new.url using errcode = 'P0001'; end $$"),
    );
    await db.execute(sql.raw('create trigger fail_feed_write before update on feeds for each row execute function fail_feed_write()'));
    try {
      await expect(updateFeed(form({ id: String(feedId), fileName: 'nuevo.csv' }))).rejects.toThrow();
    } finally {
      await db.execute(sql.raw('drop trigger if exists fail_feed_write on feeds'));
      await db.execute(sql.raw('drop function if exists fail_feed_write()'));
    }
    expect(await feedRow(feedId)).toEqual(before);
  });
});

describe('the reads show a file feed by its file name and never by a stored address (S3.7, AC 10, 13)', () => {
  it('a stored value that is not a name is never returned: the file name is null and the host is null', async () => {
    const shopId = await aShop();
    const planted = [
      '../../etc/passwd-SENTINEL',
      'C:\\secreto-SENTINEL\\x.csv',
      ' relleno-SENTINEL.csv',
      'https://u:KEY-SENTINEL@feeds.example/x.csv?apikey=KEY-SENTINEL',
    ];
    const ids: number[] = [];
    for (const url of planted) {
      const [row] = await getDb()
        .insert(feeds)
        .values({ shopId, networkId: null, sourceType: 'catalogue_file', url, isApproved: false, isDemo: false })
        .returning({ id: feeds.id });
      ids.push(row.id);
    }
    const [shop] = await listSourcesForAdmin();
    expect(shop.feeds.map((feed) => [feed.id, feed.source, feed.host, feed.fileName])).toEqual(
      ids.map((id) => [id, 'catalogue_file', null, null]),
    );
    const edits = await Promise.all(ids.map((id) => getFeedForEdit(id)));
    expect(edits.map((edit) => (edit?.source === 'catalogue_file' ? [edit.source, edit.fileName] : null))).toEqual(
      ids.map(() => ['catalogue_file', null]),
    );
    const categories = await listCategoryMappingsForAdmin();
    expect(categories.feeds.map((feed) => [feed.source, feed.host, feed.fileName])).toEqual(
      ids.map(() => ['catalogue_file', null, null]),
    );
    expect(JSON.stringify([shop, edits, categories])).not.toMatch(/SENTINEL|etc\/|passwd|feeds\.example|https?:|apikey/);
  });

  it('the category screen read carries the source and the file name of each feed, and null for the others', async () => {
    const shopId = await aShop();
    const networkId = await aNetwork();
    const file = await createFeed(form({ source: 'catalogue_file', shopId: String(shopId), fileName: 'categorias.csv' }));
    const affiliate = await aFeed(shopId, networkId, 'https://feeds.example/c.csv');
    const upload = await insertFeed(shopId, { url: 'subida.csv' });

    const page = await listCategoryMappingsForAdmin();

    const fileId = (file as { id: number }).id;
    expect(page.feeds.find((feed) => feed.id === fileId)).toMatchObject({
      source: 'catalogue_file',
      networkName: null,
      host: null,
      fileName: 'categorias.csv',
    });
    expect(page.feeds.find((feed) => feed.id === affiliate)).toMatchObject({
      source: 'affiliate_network',
      networkName: 'Red Uno',
      host: 'feeds.example',
      fileName: null,
    });
    expect(page.feeds.find((feed) => feed.id === upload)).toMatchObject({ source: 'shop_upload', networkName: null, fileName: null });
    for (const feed of page.feeds) expect(Object.keys(feed)).not.toContain('url');
  });
});
