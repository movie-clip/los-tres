import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { eq } from 'drizzle-orm';

import { closeDb, getDb } from '@/db/client';
import { products } from '@/db/schema';
import { getPublicCategoryPage } from '@/server/catalogue/category-page';
import { isMissingPublicPage } from '@/server/catalogue/missing-page';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import {
  insertCategory,
  insertFeed,
  insertFitment,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
  insertVehicle,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// S11.7: src/proxy.ts rewrites a request to the root 404 when isMissingPublicPage says so. The
// rewrite is only safe if "missing" is exactly what the page's own loader says, so each case here
// asks both and requires them to agree (guardrail 1: the proxy must never call a hidden item present,
// nor a public one missing).

// The vehicle read the proxy shares with the page: a switch makes it fail, to prove an unavailable car
// decides as no car. Everything else is the real read.
const vehicleRead = vi.hoisted(() => ({ fail: false }));
vi.mock('@/server/car/vehicles', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/car/vehicles')>();
  return {
    ...actual,
    readActiveVehicles: () => {
      if (vehicleRead.fail) return Promise.reject(new Error('vehicles: down'));
      return actual.readActiveVehicles();
    },
  };
});

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
  it.each(['/', '/no-existe', '/go/1', '/producto', '/producto/', '/producto/a/b', '/categoria/a/b', '/admin/tiendas', '/sitemap.xml'])(
    'answers false for %s',
    async (path) => {
      expect(await isMissingPublicPage(at(path))).toBe(false);
    },
  );
});

// S5.8 (#275): the category half. With a selected car the page count is the combined list's, so the
// check must resolve the car from ?coche exactly as the page does and decide as the loader does.
// An unrecognised, retired, repeated or unavailable car is no car (D-4).

describe('isMissingPublicPage under a car agrees with the category loader (S5.8, AC 18)', () => {
  async function world() {
    const car = await insertVehicle();
    const other = await insertVehicle();
    const feed = await insertFeed((await insertShop()).id);
    const category = await insertCategory({ slug: 'filtros' });
    return { car, other, feed, category };
  }

  type World = Awaited<ReturnType<typeof world>>;

  async function add(w: World, slug: string, fit: 'fits' | 'no-fit' | 'unknown', extra: { brand?: string } = {}) {
    const product = await insertListedProduct({ slug, prices: [1000], categoryId: w.category.id, brand: extra.brand });
    if (extra.brand !== undefined) await brand(slug, extra.brand);
    if (fit === 'fits') await insertFitment(product.id, w.car.id, w.feed);
    if (fit === 'no-fit') await insertFitment(product.id, w.other.id, w.feed);
    return product;
  }

  /** Whether the proxy check calls the URL missing, which must be exactly whether the loader answers null. */
  async function agree(path: string, page: number, vehicleId: number | null, brandSlug: string | null = null) {
    const loader = await getPublicCategoryPage('filtros', page, brandSlug, 'price-asc', vehicleId);
    const missing = await isMissingPublicPage(at(path));
    expect(missing, path).toBe(loader === null);
    return missing;
  }

  it('is true for a page past the end of the combined list and false for the last page, though the no-car list is longer', async () => {
    const w = await world();
    for (let n = 0; n < PAGE_SIZE; n += 1) await add(w, `f-${n}`, 'fits');
    for (let n = 0; n < 6; n += 1) await add(w, `n-${n}`, 'no-fit');

    // Without a car the 30 products fill two pages.
    expect(await agree('/categoria/filtros?pagina=2', 2, null)).toBe(false);
    // With the car only the 24 that fit are listed: one page.
    expect(await agree(`/categoria/filtros?pagina=1&coche=${w.car.slug}`, 1, w.car.id)).toBe(false);
    expect(await agree(`/categoria/filtros?pagina=2&coche=${w.car.slug}`, 2, w.car.id)).toBe(true);
    expect(await agree(`/categoria/filtros?coche=${w.car.slug}&pagina=2`, 2, w.car.id)).toBe(true);
  });

  it('is false for the page after the group boundary while the combined list still has it', async () => {
    const w = await world();
    for (let n = 0; n < 20; n += 1) await add(w, `f-${n}`, 'fits');
    for (let n = 0; n < 10; n += 1) await add(w, `u-${n}`, 'unknown');
    for (let n = 0; n < 40; n += 1) await add(w, `n-${n}`, 'no-fit');
    expect(await agree(`/categoria/filtros?pagina=2&coche=${w.car.slug}`, 2, w.car.id)).toBe(false);
    expect(await agree(`/categoria/filtros?pagina=3&coche=${w.car.slug}`, 3, w.car.id)).toBe(true);
  });

  it('is false for page 1 when every product is left out, and true for page 2 of it', async () => {
    const w = await world();
    await add(w, 'n-1', 'no-fit');
    await add(w, 'n-2', 'no-fit');
    expect((await getPublicCategoryPage('filtros', 1, null, 'price-asc', w.car.id))?.state).toBe('all-left-out');
    expect(await agree(`/categoria/filtros?coche=${w.car.slug}`, 1, w.car.id)).toBe(false);
    expect(await agree(`/categoria/filtros?coche=${w.car.slug}&pagina=2`, 2, w.car.id)).toBe(true);
  });

  it('is false for a brand whose products are all left out (all-left-out, not missing) and true past its page', async () => {
    const w = await world();
    await add(w, 'b-1', 'fits', { brand: 'Bosch' });
    await add(w, 'm-1', 'no-fit', { brand: 'Mahle' });
    expect(await agree(`/categoria/filtros?marca=mahle&coche=${w.car.slug}`, 1, w.car.id, 'mahle')).toBe(false);
    expect(await agree(`/categoria/filtros?marca=mahle&pagina=2&coche=${w.car.slug}`, 2, w.car.id, 'mahle')).toBe(true);
    expect(await agree(`/categoria/filtros?marca=no-existe&coche=${w.car.slug}`, 1, w.car.id, 'no-existe')).toBe(false);
  });

  it('is false for an empty category with a car, and true for its page 2', async () => {
    const w = await world();
    await insertCategory({ slug: 'vacia' });
    expect(await isMissingPublicPage(at(`/categoria/vacia?coche=${w.car.slug}`))).toBe(false);
    expect(await isMissingPublicPage(at(`/categoria/vacia?coche=${w.car.slug}&pagina=2`))).toBe(true);
  });

  it('is true for an unknown category with a car, as without one', async () => {
    const w = await world();
    expect(await isMissingPublicPage(at(`/categoria/no-existe?coche=${w.car.slug}`))).toBe(true);
  });

  describe('decides as without a car when the car is not a selected one', () => {
    async function pastTheCombinedList(w: World) {
      for (let n = 0; n < PAGE_SIZE; n += 1) await add(w, `f-${n}`, 'fits');
      for (let n = 0; n < 6; n += 1) await add(w, `n-${n}`, 'no-fit');
    }

    it('for a retired vehicle, an unknown slug, a malformed value and a repeated coche', async () => {
      const w = await world();
      const retired = await insertVehicle({ isRetired: true });
      await pastTheCombinedList(w);
      // Page 2 exists in the no-car list of 30 products, so a car that does not filter keeps it present.
      expect(await isMissingPublicPage(at('/categoria/filtros?pagina=2'))).toBe(false);
      for (const query of [
        `coche=${retired.slug}`,
        'coche=coche-que-no-existe',
        'coche=Mal_Formado',
        'coche=',
        `coche=${w.car.slug}&coche=${w.car.slug}`,
        `coche=${w.car.slug}&coche=otro`,
      ]) {
        expect(await isMissingPublicPage(at(`/categoria/filtros?pagina=2&${query}`)), query).toBe(false);
      }
      // And the selected car, for contrast, finds page 2 missing.
      expect(await isMissingPublicPage(at(`/categoria/filtros?pagina=2&coche=${w.car.slug}`))).toBe(true);
    });

    it('for a car the vehicle read cannot give (unavailable), without throwing', async () => {
      const w = await world();
      await pastTheCombinedList(w);
      vehicleRead.fail = true;
      try {
        expect(await isMissingPublicPage(at(`/categoria/filtros?pagina=2&coche=${w.car.slug}`))).toBe(false);
        expect(await isMissingPublicPage(at(`/categoria/filtros?pagina=3&coche=${w.car.slug}`))).toBe(true);
      } finally {
        vehicleRead.fail = false;
      }
    });

    it('logging nothing about the car in any of these cases (guardrail 5)', async () => {
      const w = await world();
      await pastTheCombinedList(w);
      const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
        vi.spyOn(console, method).mockImplementation(() => undefined),
      );
      vehicleRead.fail = true;
      try {
        await isMissingPublicPage(at(`/categoria/filtros?pagina=2&coche=${w.car.slug}`));
        vehicleRead.fail = false;
        await isMissingPublicPage(at(`/categoria/filtros?pagina=2&coche=${w.car.slug}`));
        await isMissingPublicPage(at('/categoria/filtros?coche=Mal_Formado'));
        for (const spy of spies) expect(spy).not.toHaveBeenCalled();
      } finally {
        vehicleRead.fail = false;
        for (const spy of spies) spy.mockRestore();
      }
    });
  });

  it('leaves the product check to its own rule, car or not', async () => {
    const w = await world();
    await insertListedProduct({ slug: 'presente', prices: [1000] });
    expect(await isMissingPublicPage(at(`/producto/presente?coche=${w.car.slug}`))).toBe(false);
    expect(await isMissingPublicPage(at(`/producto/no-existe?coche=${w.car.slug}`))).toBe(true);
  });
});
