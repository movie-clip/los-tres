import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as getIndex } from '@/app/(public)/sitemap.xml/route';
import { GET as getFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb, getDb } from '@/db/client';
import { products } from '@/db/schema';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import {
  SITEMAP_CHUNK_SIZE,
  countSitemapProductChunks,
  getSitemapCategorySlugs,
  getSitemapProductSlugs,
} from '@/server/catalogue/sitemap';

import {
  insertCategory,
  insertFeed,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// S6.2: what a search engine is offered. The sitemap set is the one visibility
// scope (guardrail 1) AND "has an offer from a non-demo feed". Each excluded
// case changes exactly one thing from the listed baseline.

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

const ORIGIN = 'http://127.0.0.1:3000';

/** Every slug in every product chunk, in order. */
async function listedSlugs(chunkSize?: number): Promise<string[]> {
  const chunks = await countSitemapProductChunks(chunkSize);
  const all: string[] = [];
  for (let chunk = 1; chunk <= chunks; chunk += 1) {
    all.push(...((await getSitemapProductSlugs(chunk, chunkSize)) ?? []));
  }
  return all;
}

/** A product with one offer from a fresh shop and feed; the flags are set one at a time. */
async function productWithOffer(
  slug: string,
  o: {
    product?: { isHidden?: boolean; categoryId?: number | null };
    shop?: { isApproved?: boolean };
    feed?: { isApproved?: boolean; isDemo?: boolean };
    offer?: { isHidden?: boolean; inReview?: boolean };
  } = {},
) {
  const shop = await insertShop(o.shop);
  const feedId = await insertFeed(shop.id, o.feed);
  const product = await insertProduct({ slug, ...o.product });
  await insertOffer({ productId: product.id, feedId, ...o.offer });
  return product;
}

describe('sitemap product set (guardrail 1)', () => {
  it('lists a visible product with an offer from a real feed', async () => {
    await productWithOffer('visible');
    expect(await listedSlugs()).toEqual(['visible']);
  });

  it.each([
    ['the product is hidden', { product: { isHidden: true } }],
    ['the product is unmapped (no category)', { product: { categoryId: null } }],
    ['the only offer is from an unapproved feed', { feed: { isApproved: false } }],
    ['the only offer is from an unapproved shop', { shop: { isApproved: false } }],
    ['the only offer is hidden', { offer: { isHidden: true } }],
    ['the only offer is in review', { offer: { inReview: true } }],
    ['the only offer is from a demo feed', { feed: { isDemo: true } }],
  ] as const)('does not list a product when %s', async (_name, setup) => {
    await productWithOffer('excluido', setup);
    await productWithOffer('control');
    expect(await listedSlugs()).toEqual(['control']);
  });

  it('does not list a product that has no offer at all', async () => {
    await insertProduct({ slug: 'sin-oferta' });
    expect(await listedSlugs()).toEqual([]);
    expect(await countSitemapProductChunks()).toBe(0);
  });

  it('lists a product with a visible demo offer and a hidden real offer, and marks it indexable', async () => {
    const product = await insertProduct({ slug: 'demo-con-real-oculta' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id, { isDemo: false });
    await insertOffer({ productId: product.id, feedId: demoFeed });
    await insertOffer({ productId: product.id, feedId: realFeed, isHidden: true });

    expect(await listedSlugs()).toEqual(['demo-con-real-oculta']);
    const page = await getPublicProductBySlug('demo-con-real-oculta');
    expect(page?.indexable).toBe(true);
    // The demo notice still shows: it depends on the visible offers only.
    expect(page?.demoOnly).toBe(true);
  });

  it('counts an offer from an unapproved real feed as a non-demo offer (the rule is any state, D-7)', async () => {
    const product = await insertProduct({ slug: 'demo-y-real-sin-aprobar' });
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id, { isApproved: false });
    await insertOffer({ productId: product.id, feedId: demoFeed });
    await insertOffer({ productId: product.id, feedId: realFeed });
    // Listed: the visible demo offer keeps it public, and a non-demo offer in any state makes it indexable.
    expect(await listedSlugs()).toEqual(['demo-y-real-sin-aprobar']);
    expect((await getPublicProductBySlug('demo-y-real-sin-aprobar'))?.indexable).toBe(true);
  });

  it('keeps the listed set and the indexable flag in step', async () => {
    await productWithOffer('real');
    await productWithOffer('demo', { feed: { isDemo: true } });
    const listed = await listedSlugs();
    for (const slug of ['real', 'demo']) {
      const page = await getPublicProductBySlug(slug);
      expect(page?.indexable).toBe(listed.includes(slug));
    }
  });
});

describe('sitemap categories', () => {
  it('lists a leaf and every ancestor of a listed product, and nothing else', async () => {
    const root = await insertCategory({ slug: 'raiz' });
    const mid = await insertCategory({ slug: 'media', parentId: root.id });
    const leaf = await insertCategory({ slug: 'hoja', parentId: mid.id });
    await insertCategory({ slug: 'otra-vacia' });
    await insertListedProduct({ slug: 'p', prices: [100], categoryId: leaf.id });

    expect(await getSitemapCategorySlugs()).toEqual(['raiz', 'media', 'hoja']);
  });

  it('omits a category whose products are all excluded or all demo', async () => {
    const soloDemo = await insertCategory({ slug: 'solo-demo' });
    const soloOculto = await insertCategory({ slug: 'solo-oculto' });
    const buena = await insertCategory({ slug: 'buena' });
    await productWithOffer('d', { product: { categoryId: soloDemo.id }, feed: { isDemo: true } });
    await productWithOffer('h', { product: { categoryId: soloOculto.id, isHidden: true } });
    await productWithOffer('b', { product: { categoryId: buena.id } });

    expect(await getSitemapCategorySlugs()).toEqual(['buena']);
  });

  it('lists a category that has both a demo product and a real product', async () => {
    const mixta = await insertCategory({ slug: 'mixta' });
    await productWithOffer('d', { product: { categoryId: mixta.id }, feed: { isDemo: true } });
    await productWithOffer('r', { product: { categoryId: mixta.id } });
    expect(await getSitemapCategorySlugs()).toEqual(['mixta']);
  });

  it('omits a category with a malformed slug, which no page can serve', async () => {
    const malformed = await insertCategory({ slug: 'Mala_Slug' });
    await insertListedProduct({ slug: 'p', prices: [100], categoryId: malformed.id });
    expect(await getSitemapCategorySlugs()).toEqual([]);
  });
});

describe('sitemap chunking', () => {
  it('splits 5 listed products over 3 chunks of 2, in id order, with no repeat or gap', async () => {
    for (const slug of ['a', 'b', 'c', 'd', 'e']) await productWithOffer(slug);

    expect(await countSitemapProductChunks(2)).toBe(3);
    expect(await getSitemapProductSlugs(1, 2)).toEqual(['a', 'b']);
    expect(await getSitemapProductSlugs(2, 2)).toEqual(['c', 'd']);
    expect(await getSitemapProductSlugs(3, 2)).toEqual(['e']);
    expect(await listedSlugs(2)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('answers null outside 1..chunk count', async () => {
    for (const slug of ['a', 'b', 'c']) await productWithOffer(slug);
    expect(await getSitemapProductSlugs(0, 2)).toBeNull();
    expect(await getSitemapProductSlugs(-1, 2)).toBeNull();
    expect(await getSitemapProductSlugs(3, 2)).toBeNull();
    expect(await getSitemapProductSlugs(1.5, 2)).toBeNull();
  });

  it('has zero chunks and no chunk 1 when nothing is listed', async () => {
    expect(await countSitemapProductChunks()).toBe(0);
    expect(await getSitemapProductSlugs(1)).toBeNull();
  });

  it('counts exactly one chunk at the chunk size and two one past it', async () => {
    for (const slug of ['a', 'b']) await productWithOffer(slug);
    expect(await countSitemapProductChunks(2)).toBe(1);
    await productWithOffer('c');
    expect(await countSitemapProductChunks(2)).toBe(2);
  });

  it('uses a chunk size well under the protocol cap of 50,000 urls', () => {
    expect(SITEMAP_CHUNK_SIZE).toBeGreaterThan(0);
    expect(SITEMAP_CHUNK_SIZE).toBeLessThanOrEqual(50000);
  });
});

describe('sitemap route handlers', () => {
  const fileRequest = (file: string) =>
    getFile(new Request(`${ORIGIN}/sitemaps/${file}`), { params: Promise.resolve({ file }) });
  const indexRequest = () => getIndex();

  const XML_HEADERS = {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'no-store',
  };

  it('serves the index with the page sitemap first and the product chunk after it', async () => {
    await productWithOffer('a');
    const response = await indexRequest();
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject(XML_HEADERS);
    expect(response.headers.get('set-cookie')).toBeNull();
    const body = await response.text();
    const locs = [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]);
    expect(locs).toEqual([`${ORIGIN}/sitemaps/paginas.xml`, `${ORIGIN}/sitemaps/productos-1.xml`]);
    expect(body).toContain('<sitemapindex');
  });

  it('serves an index with only the page sitemap when no product is listed', async () => {
    const body = await (await indexRequest()).text();
    expect(body).toContain(`${ORIGIN}/sitemaps/paginas.xml`);
    expect(body).not.toContain('productos-');
  });

  it('lists the home and the listed categories in paginas.xml', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    await insertListedProduct({ slug: 'p', prices: [100], categoryId: category.id });
    const response = await fileRequest('paginas.xml');
    expect(response.status).toBe(200);
    expect(Object.fromEntries(response.headers)).toMatchObject(XML_HEADERS);
    const body = await response.text();
    expect(body).toContain(`<loc>${ORIGIN}/</loc>`);
    expect(body).toContain(`<loc>${ORIGIN}/categoria/filtros</loc>`);
    expect(body).not.toContain('pagina=');
    expect(body).not.toContain('/producto/');
  });

  it('lists the chunk products with absolute urls, and nothing excluded', async () => {
    await productWithOffer('visible');
    await productWithOffer('oculto', { product: { isHidden: true } });
    await productWithOffer('demo', { feed: { isDemo: true } });
    await productWithOffer('sin-aprobar', { feed: { isApproved: false } });
    await productWithOffer('sin-categoria', { product: { categoryId: null } });

    const body = await (await fileRequest('productos-1.xml')).text();
    expect(body).toContain('<urlset');
    expect(body).toContain(`<loc>${ORIGIN}/producto/visible</loc>`);
    for (const slug of ['oculto', 'demo', 'sin-aprobar', 'sin-categoria']) {
      expect(body).not.toContain(`/producto/${slug}<`);
    }
  });

  it('drops a product from the sitemap on the next fetch once it is hidden', async () => {
    const product = await productWithOffer('se-oculta');
    expect(await (await fileRequest('productos-1.xml')).text()).toContain('/producto/se-oculta');
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    // No chunk is left at all now.
    expect((await fileRequest('productos-1.xml')).status).toBe(404);
  });

  it.each(['productos-99.xml', 'productos-0.xml', 'productos-01.xml', 'foo.xml', 'productos-1', 'paginas', 'productos-1.xml.gz'])(
    'answers 404 with an empty body for %s',
    async (file) => {
      await productWithOffer('a');
      const response = await fileRequest(file);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
      expect(response.headers.get('set-cookie')).toBeNull();
    },
  );

  it('answers 503 with an empty body on every sitemap route when no public origin is configured', async () => {
    await productWithOffer('a');
    vi.stubEnv('SITE_URL', '');
    for (const response of [await indexRequest(), await fileRequest('paginas.xml'), await fileRequest('productos-1.xml')]) {
      expect(response.status).toBe(503);
      expect(await response.text()).toBe('');
      expect(Object.fromEntries(response.headers)).toMatchObject(XML_HEADERS);
    }
  });

  it('still answers 404, not 503, for an unknown file when no public origin is configured', async () => {
    vi.stubEnv('SITE_URL', '');
    expect((await fileRequest('foo.xml')).status).toBe(404);
  });

  it('names no admin url and no affiliate url in any sitemap body', async () => {
    await productWithOffer('a');
    const bodies = [
      await (await indexRequest()).text(),
      await (await fileRequest('paginas.xml')).text(),
      await (await fileRequest('productos-1.xml')).text(),
    ].join('\n');
    expect(bodies).not.toMatch(/admin/i);
    expect(bodies).not.toContain('/go/');
    expect(bodies).not.toContain('affiliate.example');
  });
});
