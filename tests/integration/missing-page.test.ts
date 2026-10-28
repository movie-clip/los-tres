import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { closeDb, getDb } from '@/db/client';
import { products } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { isMissingPublicPage } from '@/server/catalogue/missing-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertFeed,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// S11.7: src/proxy.ts rewrites a request to the root 404 when isMissingPublicPage says so. The
// rewrite is only safe if "missing" is exactly what the page's own loader says, so each case here
// asks both and requires them to agree (guardrail 1: the proxy must never call a hidden item present,
// nor a public one missing).

beforeEach(async () => {
  await resetDatabase();
});
afterAll(async () => {
  await closeDb();
});

const at = (pathAndQuery: string) => new URL(`http://127.0.0.1:3010${pathAndQuery}`);
const PAGE_SIZE = 24;

async function brand(slug: string, brandName: string): Promise<void> {
  await getDb()
    .update(products)
    .set({ brand: brandName, brandNormalised: brandName.toUpperCase() })
    .where(eq(products.slug, slug));
}

describe('isMissingPublicPage agrees with the product loader', () => {
  it('is true for an unknown product and false for a public one, as the loader says', async () => {
    await insertListedProduct({ slug: 'presente', prices: [1000] });
    expect(await getPublicProductBySlug('presente')).not.toBeNull();
    expect(await isMissingPublicPage(at('/producto/presente'))).toBe(false);

    expect(await getPublicProductBySlug('no-existe')).toBeNull();
    expect(await isMissingPublicPage(at('/producto/no-existe'))).toBe(true);
  });

  it('is true for a hidden product (guardrail 1)', async () => {
    await insertListedProduct({ slug: 'oculto', prices: [1000], isHidden: true });
    expect(await getPublicProductBySlug('oculto')).toBeNull();
    expect(await isMissingPublicPage(at('/producto/oculto'))).toBe(true);
  });

  it('is true for a product whose only offers are hidden or from an unapproved feed', async () => {
    const approved = await insertFeed((await insertShop()).id);
    const hiddenOnly = await insertProduct({ slug: 'solo-oferta-oculta' });
    await insertOffer({ productId: hiddenOnly.id, feedId: approved, isHidden: true });

    const unapproved = await insertFeed((await insertShop()).id, { isApproved: false });
    const unapprovedOnly = await insertProduct({ slug: 'solo-feed-sin-aprobar' });
    await insertOffer({ productId: unapprovedOnly.id, feedId: unapproved });

    for (const slug of ['solo-oferta-oculta', 'solo-feed-sin-aprobar']) {
      expect(await getPublicProductBySlug(slug), slug).toBeNull();
      expect(await isMissingPublicPage(at(`/producto/${slug}`)), slug).toBe(true);
    }
  });

  it('is true for a product with no category', async () => {
    await insertListedProduct({ slug: 'sin-categoria', prices: [1000], categoryId: null });
    expect(await getPublicProductBySlug('sin-categoria')).toBeNull();
    expect(await isMissingPublicPage(at('/producto/sin-categoria'))).toBe(true);
  });

  it('decodes the slug the way Next decodes params, and leaves an undecodable one to the page', async () => {
    await insertListedProduct({ slug: 'presente', prices: [1000] });
    expect(await isMissingPublicPage(at('/producto/%70resente'))).toBe(false);
    expect(await isMissingPublicPage(at('/producto/%E0%A4%A'))).toBe(false);
  });

  it('treats a malformed slug like an unknown one, as the loader does', async () => {
    for (const slug of ['Bad_Slug', 'UPPER', 'a--b', 'x'.repeat(130)]) {
      expect(await getPublicProductBySlug(slug), slug.slice(0, 12)).toBeNull();
      expect(await isMissingPublicPage(at(`/producto/${slug}`)), slug.slice(0, 12)).toBe(true);
    }
  });
});

describe('isMissingPublicPage agrees with the category loader', () => {
  it('is true for an unknown category and false for one with products', async () => {
    const category = await insertCategory({ slug: 'con-productos' });
    await insertListedProduct({ slug: 'uno', prices: [1000], categoryId: category.id });
    expect(await getPublicCategoryPage('con-productos', 1, null, 'price-asc')).not.toBeNull();
    expect(await isMissingPublicPage(at('/categoria/con-productos'))).toBe(false);

    expect(await getPublicCategoryPage('no-existe', 1, null, 'price-asc')).toBeNull();
    expect(await isMissingPublicPage(at('/categoria/no-existe'))).toBe(true);
  });

  it('is false for an existing category that is empty, as the loader answers it', async () => {
    await insertCategory({ slug: 'vacia' });
    expect(await getPublicCategoryPage('vacia', 1, null, 'price-asc')).not.toBeNull();
    expect(await isMissingPublicPage(at('/categoria/vacia'))).toBe(false);
  });

  it('is true for a page past the last and false for the last page itself', async () => {
    const category = await insertCategory({ slug: 'dos-paginas' });
    for (let n = 0; n < PAGE_SIZE + 1; n += 1) {
      await insertListedProduct({ slug: `p-${n}`, prices: [100 + n], categoryId: category.id });
    }
    expect(await getPublicCategoryPage('dos-paginas', 2, null, 'price-asc')).not.toBeNull();
    expect(await isMissingPublicPage(at('/categoria/dos-paginas?pagina=2'))).toBe(false);

    expect(await getPublicCategoryPage('dos-paginas', 3, null, 'price-asc')).toBeNull();
    expect(await isMissingPublicPage(at('/categoria/dos-paginas?pagina=3'))).toBe(true);
    expect(await isMissingPublicPage(at(`/categoria/dos-paginas?pagina=${'9'.repeat(400)}`))).toBe(true);
  });

  it('reads an unparseable, zero or repeated pagina as page 1, exactly as the page does', async () => {
    const category = await insertCategory({ slug: 'dos-paginas' });
    for (let n = 0; n < PAGE_SIZE + 1; n += 1) {
      await insertListedProduct({ slug: `p-${n}`, prices: [100 + n], categoryId: category.id });
    }
    for (const query of ['?pagina=abc', '?pagina=0', '?pagina=-1', '?pagina=', '?pagina=2&pagina=3']) {
      expect(await getPublicCategoryPage('dos-paginas', 1, null, 'price-asc'), query).not.toBeNull();
      expect(await isMissingPublicPage(at(`/categoria/dos-paginas${query}`)), query).toBe(false);
    }
  });

  it('is true for a real brand past its last page and false for its first', async () => {
    const category = await insertCategory({ slug: 'con-marca' });
    await insertListedProduct({ slug: 'b1', prices: [1000], categoryId: category.id, brand: 'Bosch' });
    await brand('b1', 'Bosch');
    await insertListedProduct({ slug: 'm1', prices: [1100], categoryId: category.id, brand: 'Mahle' });
    await brand('m1', 'Mahle');

    expect(await getPublicCategoryPage('con-marca', 1, 'bosch', 'price-asc')).not.toBeNull();
    expect(await isMissingPublicPage(at('/categoria/con-marca?marca=bosch'))).toBe(false);

    expect(await getPublicCategoryPage('con-marca', 2, 'bosch', 'price-asc')).toBeNull();
    expect(await isMissingPublicPage(at('/categoria/con-marca?marca=bosch&pagina=2'))).toBe(true);
  });

  it('is false for a brand with no products, which the page answers 200 with the no-match state', async () => {
    const category = await insertCategory({ slug: 'con-marca' });
    await insertListedProduct({ slug: 'b1', prices: [1000], categoryId: category.id, brand: 'Bosch' });
    await brand('b1', 'Bosch');

    const read = await getPublicCategoryPage('con-marca', 1, 'no-existe', 'price-asc');
    expect(read?.state).toBe('no-match');
    expect(await isMissingPublicPage(at('/categoria/con-marca?marca=no-existe'))).toBe(false);
  });

  it('ignores an unknown or repeated orden and marca, as the page parsers do', async () => {
    const category = await insertCategory({ slug: 'con-marca' });
    await insertListedProduct({ slug: 'b1', prices: [1000], categoryId: category.id, brand: 'Bosch' });
    await brand('b1', 'Bosch');
    for (const query of ['?orden=raro', '?orden=nombre&orden=precio-desc', '?marca=bosch&marca=mahle', '?marca=BAD_BRAND']) {
      expect(await getPublicCategoryPage('con-marca', 1, null, 'price-asc'), query).not.toBeNull();
      expect(await isMissingPublicPage(at(`/categoria/con-marca${query}`)), query).toBe(false);
    }
  });

  it('is true for a malformed category slug, as the loader answers it', async () => {
    for (const slug of ['Bad_Slug', 'UPPER', 'a--b', 'x'.repeat(130)]) {
      expect(await getPublicCategoryPage(slug, 1, null, 'price-asc'), slug.slice(0, 12)).toBeNull();
      expect(await isMissingPublicPage(at(`/categoria/${slug}`)), slug.slice(0, 12)).toBe(true);
    }
  });
});

describe('isMissingPublicPage leaves every other path to Next', () => {
  it.each(['/', '/no-existe', '/buscar', '/go/1', '/producto', '/producto/', '/producto/a/b', '/categoria/a/b', '/admin/tiendas', '/sitemap.xml'])(
    'answers false for %s',
    async (path) => {
      expect(await isMissingPublicPage(at(path))).toBe(false);
    },
  );
});
