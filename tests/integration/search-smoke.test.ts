import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb } from '@/db/client';
import { getPublicSearchPage } from '@/server/catalogue/search-page';

import {
  insertCategory,
  insertFeed,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

// Smoke coverage for the backend lane (S5.4, T5.4.1 and T5.4.2): the migration
// objects exist and the loader answers each of its states. The relevance suite
// is the test lane's (#128) and supersedes this file.

beforeEach(resetDatabase);
afterAll(async () => {
  vi.restoreAllMocks();
  await closeDb();
});

const slugsOf = (page: Awaited<ReturnType<typeof getPublicSearchPage>>) =>
  page?.state === 'results' ? page.products.map((card) => card.slug) : [];

describe('getPublicSearchPage smoke (S5.4)', () => {
  it('finds by accent-free word, stem, brand, viscosity spelling, part number and EAN', async () => {
    const category = await insertCategory({ slug: 'aceites', name: 'Aceites' });
    await insertListedProduct({
      slug: 'castrol-sintetico',
      title: 'Aceite sintético 5W-30 4L',
      brand: 'Castrol',
      prices: [3000],
      categoryId: category.id,
    });
    await insertListedProduct({
      slug: 'filtro-aceite',
      title: 'Filtro de aceite',
      brand: 'Bosch',
      prices: [900],
      categoryId: category.id,
    });

    expect(slugsOf(await getPublicSearchPage('aceite castrol', 1))).toEqual(['castrol-sintetico']);
    expect(slugsOf(await getPublicSearchPage('SINTETICO', 1))).toEqual(['castrol-sintetico']);
    for (const spelling of ['5w30', '5W 30', '5w-30', '5W-30']) {
      expect(slugsOf(await getPublicSearchPage(spelling, 1))).toEqual(['castrol-sintetico']);
    }
    expect(slugsOf(await getPublicSearchPage('filtros', 1))).toEqual(['filtro-aceite']);
    expect(slugsOf(await getPublicSearchPage('cast', 1))).toEqual([]);
  });

  it('answers each state, and null past the last page', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    await insertListedProduct({ slug: 'filtro-oculto', title: 'Filtro oculto', prices: [500], isHidden: true });

    expect(await getPublicSearchPage('', 7)).toEqual({ state: 'empty-query', term: '' });
    expect(await getPublicSearchPage('zzzz', 1)).toEqual({ state: 'no-results', term: 'zzzz' });
    expect(await getPublicSearchPage('zzzz', 2)).toBeNull();
    expect(await getPublicSearchPage('de', 1)).toEqual({ state: 'no-results', term: 'de' });
    expect(await getPublicSearchPage('filtro', 2)).toBeNull();
    const page = await getPublicSearchPage('filtro', 1);
    expect(page).toMatchObject({ state: 'results', productCount: 1, pageCount: 1, page: 1 });
    expect(slugsOf(page)).toEqual(['filtro-a']);
  });

  it('an exact part number or EAN ranks before a cheaper text match', async () => {
    await insertListedProduct({ slug: 'texto-barato', title: 'Filtro OC1234 compatible', prices: [100] });
    const code = await insertProduct({
      slug: 'por-codigo',
      title: 'Filtro de aceite',
      partNumber: 'OC-1234',
      partNumberNormalised: 'OC1234',
      eanNormalised: '4006381333931',
    });
    await insertOffer({ productId: code.id, feedId: await insertFeed((await insertShop()).id), priceCents: 5000 });

    expect(slugsOf(await getPublicSearchPage('OC1234', 1))).toEqual(['por-codigo', 'texto-barato']);
    expect(slugsOf(await getPublicSearchPage('4006381333931', 1))).toEqual(['por-codigo']);
    expect(slugsOf(await getPublicSearchPage('4006 3813-33931', 1))).toEqual(['por-codigo']);
  });

  it('takes the AC 11 terms without an error', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    for (const term of ['%', '_', '&|!:(', '\\', "'", '"', 'a:*', '😀']) {
      const page = await getPublicSearchPage(term, 1);
      expect(page).toEqual({ state: 'no-results', term });
    }
  });

  it('logs only a code and throws a fixed error with no cause when the database fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('DATABASE_URL', 'postgres://x:x@127.0.0.1:1/x');
    await closeDb();
    const marker = 'zqmarkerterm';
    let thrown: unknown;
    try {
      await getPublicSearchPage(marker, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('search: failed');
    expect((thrown as Error).cause).toBeUndefined();
    expect(errors).toHaveBeenCalledTimes(1);
    const line = String(errors.mock.calls[0]?.[0]);
    expect(line).toMatch(/^search: failed \([A-Za-z0-9_]+\)$/);
    expect(line).not.toContain(marker);
    vi.unstubAllEnvs();
    await closeDb();
  });
});
