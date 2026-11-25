import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/db/client';
import { listProductsForAdmin, readProductForAdmin } from '@/server/admin/products';
import {
  ADMIN_PRODUCTS_PAGE_SIZE,
  parseAdminProductListQuery,
  type AdminProductListQuery,
} from '@/server/admin/product-rules';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import { consoleMethods } from '../support/admin';
import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S2.4 (T2.4.1), the admin product reads against the test database: ACs 8 to 10, 12 to 21 and 22 to
// 25 (the data), 18 and 57 (nothing of the term in a log), 24 (no address anywhere in the output).
// "Public now" is compared with the public product page for the same slug (AC 10).

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

const FIRST_PAGE: AdminProductListQuery = { term: '', hiddenOnly: false, page: 1 };
const query = (o: Partial<AdminProductListQuery> = {}): AdminProductListQuery => ({ ...FIRST_PAGE, ...o });
const slugs = (rows: { slug: string }[]) => rows.map((row) => row.slug);

function capture(): string[] {
  const lines: string[] = [];
  for (const method of consoleMethods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  return lines;
}

/** One approved shop and feed. */
async function approvedFeed(o: { shopName?: string; shopApproved?: boolean; feedApproved?: boolean; url?: string } = {}) {
  const shop = await insertShop({ name: o.shopName, isApproved: o.shopApproved });
  const feedId = await insertFeed(shop.id, { isApproved: o.feedApproved, url: o.url });
  return { shop, feedId };
}

describe('the list holds every product in every state, and says which is public now (AC 8, 9, 10)', () => {
  it('lists a product in each non-public state and agrees with the public page for each one', async () => {
    const live = await approvedFeed();
    const unapprovedFeed = await approvedFeed({ feedApproved: false });
    const unapprovedShop = await approvedFeed({ shopApproved: false });

    const states: Record<string, { id: number; slug: string }> = {
      public: await insertProduct({ slug: 'p-publico' }),
      hidden: await insertProduct({ slug: 'p-oculto', isHidden: true }),
      unmapped: await insertProduct({ slug: 'p-sin-categoria', categoryId: null }),
      noOffer: await insertProduct({ slug: 'p-sin-oferta' }),
      feedOff: await insertProduct({ slug: 'p-feed-sin-aprobar' }),
      shopOff: await insertProduct({ slug: 'p-tienda-sin-aprobar' }),
      offerHidden: await insertProduct({ slug: 'p-oferta-oculta' }),
      inReview: await insertProduct({ slug: 'p-en-revision' }),
    };
    await insertOffer({ productId: states.public.id, feedId: live.feedId });
    await insertOffer({ productId: states.hidden.id, feedId: live.feedId });
    await insertOffer({ productId: states.unmapped.id, feedId: live.feedId });
    await insertOffer({ productId: states.feedOff.id, feedId: unapprovedFeed.feedId });
    await insertOffer({ productId: states.shopOff.id, feedId: unapprovedShop.feedId });
    await insertOffer({ productId: states.offerHidden.id, feedId: live.feedId, isHidden: true });
    await insertOffer({ productId: states.inReview.id, feedId: live.feedId, inReview: true });

    const list = await listProductsForAdmin(query());

    expect(list.total).toBe(8);
    expect(list.rows).toHaveLength(8);
    const byslug = Object.fromEntries(list.rows.map((row) => [row.slug, row]));
    expect(byslug['p-publico']).toMatchObject({ hidden: false, publicNow: true });
    expect(byslug['p-oculto']).toMatchObject({ hidden: true, publicNow: false });
    for (const slug of [
      'p-sin-categoria',
      'p-sin-oferta',
      'p-feed-sin-aprobar',
      'p-tienda-sin-aprobar',
      'p-oferta-oculta',
      'p-en-revision',
    ]) {
      expect(byslug[slug], slug).toMatchObject({ hidden: false, publicNow: false });
    }
    // AC 10: "public now" is exactly "the public product page answers with the product".
    for (const row of list.rows) {
      expect(row.publicNow, row.slug).toBe((await getPublicProductBySlug(row.slug)) !== null);
    }
  });

  it('lists a demo product and one from an unapproved feed like any other (AC 8)', async () => {
    const shop = await insertShop();
    const demoFeed = await insertFeed(shop.id, { isDemo: true });
    const off = await insertFeed(shop.id, { isApproved: false });
    const a = await insertProduct({ slug: 'p-demo' });
    const b = await insertProduct({ slug: 'p-feed-off' });
    await insertOffer({ productId: a.id, feedId: demoFeed });
    await insertOffer({ productId: b.id, feedId: off });

    expect(slugs((await listProductsForAdmin(query())).rows).sort()).toEqual(['p-demo', 'p-feed-off']);
  });

  it('gives title and slug always, and the optional fields trimmed with blank as null (AC 9)', async () => {
    await insertProduct({
      slug: 'p-completo',
      title: 'Aceite 5W-30',
      brand: ' Castrol ',
      partNumber: ' OC-1234 ',
      ean: ' 4006381333931 ',
    });
    await insertProduct({ slug: 'p-vacio', title: 'Sin datos', brand: '   ', partNumber: '', ean: ' ' });
    await insertProduct({ slug: 'p-nulo', title: 'Nulos', brand: null, partNumber: null, ean: null });

    const rows = Object.fromEntries((await listProductsForAdmin(query())).rows.map((row) => [row.slug, row]));
    expect(rows['p-completo']).toMatchObject({
      title: 'Aceite 5W-30',
      brand: 'Castrol',
      partNumber: 'OC-1234',
      ean: '4006381333931',
    });
    for (const slug of ['p-vacio', 'p-nulo']) {
      expect(rows[slug], slug).toMatchObject({ brand: null, partNumber: null, ean: null });
    }
    expect(Object.keys(rows['p-completo']).sort()).toEqual(
      ['brand', 'ean', 'hidden', 'id', 'partNumber', 'publicNow', 'reason', 'slug', 'title'].sort(),
    );
  });
});

describe('a search term finds the same products the public search would, and the ones it hides (AC 12 to 17)', () => {
  beforeEach(async () => {
    const live = await approvedFeed();
    const make = async (
      slug: string,
      o: Parameters<typeof insertProduct>[0] & { offer?: boolean } = {},
    ): Promise<void> => {
      const { offer = true, ...rest } = o;
      const product = await insertProduct({ slug, ...rest });
      if (offer) await insertOffer({ productId: product.id, feedId: live.feedId });
    };
    await make('aceite-motor-castrol', { title: 'Aceite de motor Castrol 5W-30', brand: 'Castrol' });
    await make('filtro-aire-mann', {
      title: 'Filtro de aire',
      brand: 'Mann',
      partNumber: 'OC 1234',
      partNumberNormalised: 'OC1234',
      ean: '4006381333931',
      eanNormalised: '4006381333931',
    });
    await make('aceite-oculto', { title: 'Aceite oculto Valvoline', brand: 'Valvoline', isHidden: true });
    await make('aceite-sin-categoria', { title: 'Aceite sin categoría', categoryId: null });
    await make('aceite-sin-oferta', { title: 'Aceite sin oferta', offer: false });
    await make('bujia-ngk', { title: 'Bujía NGK', brand: 'NGK' });
  });

  it('finds title and brand words, case and accents ignored, hidden or not (AC 12, 16)', async () => {
    const byTitle = await listProductsForAdmin(query({ term: 'ACEITE' }));
    expect(slugs(byTitle.rows).sort()).toEqual([
      'aceite-motor-castrol',
      'aceite-oculto',
      'aceite-sin-categoria',
      'aceite-sin-oferta',
    ]);
    expect(slugs((await listProductsForAdmin(query({ term: 'bujia' }))).rows)).toEqual(['bujia-ngk']);
    expect(slugs((await listProductsForAdmin(query({ term: 'bujía' }))).rows)).toEqual(['bujia-ngk']);
    expect(slugs((await listProductsForAdmin(query({ term: 'valvoline' }))).rows)).toEqual(['aceite-oculto']);
    expect(slugs((await listProductsForAdmin(query({ term: 'categoria' }))).rows)).toEqual(['aceite-sin-categoria']);
  });

  it('finds an EAN once spaces, dots and hyphens are removed, 13 or 8 digits (AC 13)', async () => {
    for (const term of ['4006381333931', '4006 3813 33931', '4006-381-333931', '4006.381.333.931']) {
      expect(slugs((await listProductsForAdmin(query({ term }))).rows), term).toEqual(['filtro-aire-mann']);
    }
    expect((await listProductsForAdmin(query({ term: '4006381333932' }))).empty).toBe('no_match');
  });

  it('finds a part number in two spellings (AC 14)', async () => {
    for (const term of ['OC 1234', 'oc-1234', 'OC1234', 'oc.1234']) {
      expect(slugs((await listProductsForAdmin(query({ term }))).rows), term).toEqual(['filtro-aire-mann']);
    }
  });

  it('finds a slug, case ignored, and a hidden product by its slug (AC 15, 16)', async () => {
    expect(slugs((await listProductsForAdmin(query({ term: 'BUJIA-NGK' }))).rows)).toEqual(['bujia-ngk']);
    expect(slugs((await listProductsForAdmin(query({ term: 'aceite-oculto' }))).rows)).toEqual(['aceite-oculto']);
  });

  it('cleans the term as the public search does, and lists everything for an empty one (AC 17)', async () => {
    const parsed = parseAdminProductListQuery({ q: '  ace\u0000ite  ' });
    expect(parsed.term).toBe('ace ite');
    expect((await listProductsForAdmin(parsed)).empty).toBe('no_match');
    expect((await listProductsForAdmin(query({ term: 'aceite\u0007' }))).term).toBe('aceite');
    expect((await listProductsForAdmin(query({ term: '' }))).total).toBe(6);
    const long = await listProductsForAdmin(query({ term: `bujia ${'x'.repeat(200)}` }));
    expect(Array.from(long.term)).toHaveLength(100);
  });

  it('answers a term with no match as an empty list that says so, with no rows (AC 17)', async () => {
    const none = await listProductsForAdmin(query({ term: 'zzzz-no-existe' }));
    expect(none).toMatchObject({ total: 0, pageCount: 0, pastLast: false, empty: 'no_match', rows: [] });
  });

  it('hides nothing that matched because of a quote, a percent or a wildcard in the term (injection-safe)', async () => {
    for (const term of ["'; drop table products; --", '%', '_', 'a" or 1=1']) {
      await expect(listProductsForAdmin(query({ term }))).resolves.toMatchObject({ rows: expect.any(Array) });
    }
    expect((await listProductsForAdmin(query())).total).toBe(6);
  });
});

describe('the hidden-only filter (AC 19)', () => {
  it('lists only hidden products, alone and with a term, and is off by default', async () => {
    const live = await approvedFeed();
    for (const [slug, isHidden] of [
      ['aceite-a', true],
      ['aceite-b', false],
      ['filtro-c', true],
      ['filtro-d', false],
    ] as const) {
      const product = await insertProduct({ slug, title: slug.startsWith('aceite') ? 'Aceite' : 'Filtro', isHidden });
      await insertOffer({ productId: product.id, feedId: live.feedId });
    }

    expect((await listProductsForAdmin(query())).total).toBe(4);
    const hidden = await listProductsForAdmin(query({ hiddenOnly: true }));
    expect(slugs(hidden.rows).sort()).toEqual(['aceite-a', 'filtro-c']);
    expect(hidden.hiddenOnly).toBe(true);
    expect(hidden.rows.every((row) => row.hidden)).toBe(true);
    expect(slugs((await listProductsForAdmin(query({ hiddenOnly: true, term: 'aceite' }))).rows)).toEqual(['aceite-a']);
    expect((await listProductsForAdmin(query({ hiddenOnly: false }))).total).toBe(4);
  });

  it('says which empty state it is: no products, no hidden ones, no match (AC 19, 21)', async () => {
    expect(await listProductsForAdmin(query())).toMatchObject({ total: 0, empty: 'no_products', rows: [], pageCount: 0, pastLast: false });
    expect((await listProductsForAdmin(query({ hiddenOnly: true }))).empty).toBe('no_hidden');
    await insertProduct({ slug: 'uno' });
    expect(await listProductsForAdmin(query({ hiddenOnly: true }))).toMatchObject({ total: 0, empty: 'no_hidden' });
    expect((await listProductsForAdmin(query({ term: 'nada', hiddenOnly: true }))).empty).toBe('no_match');
    expect((await listProductsForAdmin(query())).empty).toBeNull();
  });
});

describe('paging: stable order, a count, a bad and an out-of-range page (AC 20)', () => {
  async function many(n: number, tied = false): Promise<void> {
    const created = new Date('2026-10-01T10:00:00Z');
    for (let i = 1; i <= n; i += 1) {
      await insertProduct({
        slug: `p-${String(i).padStart(3, '0')}`,
        createdAt: tied ? created : new Date(created.getTime() + i * 1000),
      });
    }
  }

  it('lists newest first, ties on the id descending, and puts each product on exactly one page', async () => {
    await many(120, true);

    const first = await listProductsForAdmin(query({ page: 1 }));
    const second = await listProductsForAdmin(query({ page: 2 }));
    const third = await listProductsForAdmin(query({ page: 3 }));

    expect(first).toMatchObject({ total: 120, pageCount: 3, pageSize: ADMIN_PRODUCTS_PAGE_SIZE, pastLast: false });
    expect([first.rows.length, second.rows.length, third.rows.length]).toEqual([50, 50, 20]);
    // Equal created_at: the highest id first.
    expect(first.rows[0].slug).toBe('p-120');
    expect(first.rows[49].slug).toBe('p-071');
    const all = [...first.rows, ...second.rows, ...third.rows].map((row) => row.slug);
    expect(new Set(all).size).toBe(120);
    expect(all).toEqual(Array.from({ length: 120 }, (_, i) => `p-${String(120 - i).padStart(3, '0')}`));
    // The same request twice gives the same page.
    expect(slugs((await listProductsForAdmin(query({ page: 2 }))).rows)).toEqual(slugs(second.rows));
  });

  it('orders by created_at first, newest first', async () => {
    await many(3);
    expect(slugs((await listProductsForAdmin(query())).rows)).toEqual(['p-003', 'p-002', 'p-001']);
  });

  it('puts a page past the last in pastLast, with no rows and no error', async () => {
    await many(60);
    const past = await listProductsForAdmin(query({ page: 3 }));
    expect(past).toMatchObject({ total: 60, pageCount: 2, pastLast: true, rows: [], empty: null, page: 3 });
    const huge = await listProductsForAdmin(query({ page: Number.MAX_SAFE_INTEGER }));
    expect(huge).toMatchObject({ pastLast: true, rows: [] });
  });

  it('reads a bad page as page 1 through the parser the page uses', async () => {
    await many(3);
    for (const pagina of ['0', '-1', 'x', '1.5', undefined]) {
      const parsed = parseAdminProductListQuery({ pagina });
      expect((await listProductsForAdmin(parsed)).page, String(pagina)).toBe(1);
    }
  });

  it('counts with the filter and the term, not the whole table', async () => {
    await many(5);
    expect(await listProductsForAdmin(query({ term: 'p-002' }))).toMatchObject({ total: 1, pageCount: 1 });
  });
});

describe('the product read: every offer, in the public order, with its state (AC 22 to 25)', () => {
  it('lists every offer whatever its state, each with its shop, feed, price and both states', async () => {
    const cheap = await approvedFeed({ shopName: 'Barata' });
    const dear = await approvedFeed({ shopName: 'Cara' });
    const feedOff = await approvedFeed({ shopName: 'Sin Aprobar', feedApproved: false });
    const product = await insertProduct({ slug: 'p-ofertas', title: 'Producto', brand: 'Marca' });
    const ids = {
      cheap: await insertOffer({ productId: product.id, feedId: cheap.feedId, priceCents: 1000 }),
      dear: await insertOffer({ productId: product.id, feedId: dear.feedId, priceCents: 2550 }),
      hidden: await insertOffer({ productId: product.id, feedId: dear.feedId, priceCents: 900, isHidden: true }),
      review: await insertOffer({ productId: product.id, feedId: cheap.feedId, priceCents: 1100, inReview: true }),
      unapproved: await insertOffer({ productId: product.id, feedId: feedOff.feedId, priceCents: 1200 }),
    };

    const detail = await readProductForAdmin(product.id);

    expect(detail).toMatchObject({ id: product.id, slug: 'p-ofertas', title: 'Producto', brand: 'Marca', hidden: false, publicNow: true });
    expect(detail?.offers.map((offer) => offer.id)).toEqual([ids.hidden, ids.cheap, ids.review, ids.unapproved, ids.dear]);
    const byId = Object.fromEntries((detail?.offers ?? []).map((offer) => [offer.id, offer]));
    expect(byId[ids.cheap]).toEqual({ id: ids.cheap, shopName: 'Barata', feedId: cheap.feedId, priceCents: 1000, hidden: false, publicNow: true, reason: null });
    expect(byId[ids.dear]).toEqual({ id: ids.dear, shopName: 'Cara', feedId: dear.feedId, priceCents: 2550, hidden: false, publicNow: true, reason: null });
    expect(byId[ids.hidden]).toMatchObject({ priceCents: 900, hidden: true, publicNow: false });
    expect(byId[ids.review]).toMatchObject({ hidden: false, publicNow: false });
    expect(byId[ids.unapproved]).toMatchObject({ shopName: 'Sin Aprobar', hidden: false, publicNow: false });
  });

  it('agrees with the public page: the offers it calls public now are the ones the page lists (AC 10, 23)', async () => {
    const a = await approvedFeed({ shopName: 'A' });
    const b = await approvedFeed({ shopName: 'B' });
    const product = await insertProduct({ slug: 'p-coincide' });
    await insertOffer({ productId: product.id, feedId: a.feedId, priceCents: 1500 });
    await insertOffer({ productId: product.id, feedId: b.feedId, priceCents: 1000 });
    await insertOffer({ productId: product.id, feedId: b.feedId, priceCents: 800, isHidden: true });

    const detail = await readProductForAdmin(product.id);
    const page = await getPublicProductBySlug('p-coincide');

    const publicPrices = (detail?.offers ?? []).filter((offer) => offer.publicNow).map((offer) => offer.priceCents);
    expect(publicPrices).toEqual(page?.offers.map((offer) => offer.priceCents));
  });

  it('says no offer of a hidden or unmapped product is public now, though its own flags are clear (AC 23)', async () => {
    const live = await approvedFeed();
    const hidden = await insertProduct({ slug: 'p-oculto', isHidden: true });
    const unmapped = await insertProduct({ slug: 'p-libre', categoryId: null });
    await insertOffer({ productId: hidden.id, feedId: live.feedId });
    await insertOffer({ productId: unmapped.id, feedId: live.feedId });

    const a = await readProductForAdmin(hidden.id);
    const b = await readProductForAdmin(unmapped.id);
    expect(a).toMatchObject({ hidden: true, publicNow: false });
    expect(a?.offers).toEqual([expect.objectContaining({ hidden: false, publicNow: false })]);
    expect(b).toMatchObject({ hidden: false, publicNow: false });
    expect(b?.offers).toEqual([expect.objectContaining({ hidden: false, publicNow: false })]);
  });

  it('returns an empty offer list for a product with no offers, and null for an id with no product (AC 5, 25)', async () => {
    const lone = await insertProduct({ slug: 'p-solo' });
    expect(await readProductForAdmin(lone.id)).toMatchObject({ slug: 'p-solo', offers: [], publicNow: false });
    expect(await readProductForAdmin(lone.id + 999)).toBeNull();
  });

  it('carries only the offers of that product', async () => {
    const live = await approvedFeed();
    const one = await insertProduct({ slug: 'p-uno' });
    const two = await insertProduct({ slug: 'p-dos' });
    await insertOffer({ productId: one.id, feedId: live.feedId });
    const other = await insertOffer({ productId: two.id, feedId: live.feedId });
    expect((await readProductForAdmin(two.id))?.offers.map((offer) => offer.id)).toEqual([other]);
  });

  it('puts no offer address and no feed address anywhere in what it returns (AC 24)', async () => {
    const KEY = 'KEY-SENTINEL-5b81';
    const live = await approvedFeed({ url: `https://feeds.example/f.csv?apikey=${KEY}` });
    const product = await insertProduct({ slug: 'p-privado' });
    await insertOffer({ productId: product.id, feedId: live.feedId, url: `https://affiliate.example/${KEY}` });

    const text = JSON.stringify([await readProductForAdmin(product.id), await listProductsForAdmin(query())]);
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/affiliate\.example|feeds\.example|https?:/);
    expect(text).not.toMatch(/"url"/);
  });
});

describe('a failed read logs a code only and throws a fixed error (AC 18, 57)', () => {
  it('holds no term, id, slug or driver message in the log or the thrown value', async () => {
    const lines = capture();
    await closeDb();
    vi.stubEnv('DATABASE_URL', 'postgres://nobody:nothing@127.0.0.1:1/none');
    const TERM = 'TERM-SENTINEL-3f9a';
    try {
      const failure = await listProductsForAdmin(query({ term: TERM })).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(failure).toBeInstanceOf(Error);
      expect(failure?.message).toBe('admin-products: read failed');
      expect(failure?.cause).toBeUndefined();
      const second = await readProductForAdmin(424242).then(
        () => null,
        (error: unknown) => error as Error,
      );
      expect(second?.message).toBe('admin-products: read failed');
      expect(second?.cause).toBeUndefined();
    } finally {
      vi.unstubAllEnvs();
      await closeDb();
    }
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(/^admin-products: failed \([A-Za-z0-9_]{1,32}\)$/);
    expect(lines.join('\n')).not.toMatch(/TERM-SENTINEL|424242|nothing|127\.0\.0\.1/);
  });

  it('logs nothing on a read that works, whatever the term', async () => {
    const lines = capture();
    await insertProduct({ slug: 'p-uno' });
    await listProductsForAdmin(query({ term: 'TERM-SENTINEL-3f9a' }));
    await readProductForAdmin(1);
    expect(lines).toEqual([]);
  });
});
