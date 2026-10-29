import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, offers, products, shops } from '@/db/schema';
import { importFeeds } from '@/server/importer';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getPublicSearchPage, SEARCH_PAGE_SIZE } from '@/server/catalogue/search-page';
import { parseSearchTerm } from '@/server/catalogue/search-query';

import {
  insertCategory,
  insertCategoryMapping,
  insertFeed,
  insertFixtureFeed,
  insertListedProduct,
  insertOffer,
  insertProduct,
  insertShop,
  insertVisibleOffer,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { fixtureDeps } from '../support/feeds';
import { unusedPort } from '../support/net';

beforeEach(resetDatabase);
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await closeDb();
});
afterAll(closeDb);

type Result = Awaited<ReturnType<typeof getPublicSearchPage>>;

/** The page loader as the route calls it: the raw `q` goes through parseSearchTerm first. */
const search = (raw: string, page = 1): Promise<Result> => getPublicSearchPage(parseSearchTerm(raw), page);

const slugsOf = (result: Result): string[] =>
  result?.state === 'results' ? result.products.map((card) => card.slug) : [];

const sorted = (values: string[]) => [...values].sort();

const EAN = '8410076472540';
const EAN_OTHER = '4006381333931';

// ---------------------------------------------------------------------------
describe('matching: text (AC 1 to 4)', () => {
  it('AC 1: every word must be found, in the title or in the brand, in any order', async () => {
    await insertListedProduct({
      slug: 'castrol-sintetico',
      title: 'Aceite sintético 5W-30 4L',
      brand: 'Castrol',
      prices: [3000],
    });
    await insertListedProduct({ slug: 'filtro-aceite', title: 'Filtro de aceite', brand: 'Bosch', prices: [900] });

    expect(slugsOf(await search('aceite castrol'))).toEqual(['castrol-sintetico']);
    expect(slugsOf(await search('castrol aceite'))).toEqual(['castrol-sintetico']);
    expect(slugsOf(await search('castrol sintetico 4L'))).toEqual(['castrol-sintetico']);
    expect(sorted(slugsOf(await search('aceite')))).toEqual(['castrol-sintetico', 'filtro-aceite']);
    // One word that no field has fails the whole term.
    expect(await search('aceite castrol bosch')).toEqual({ state: 'no-results', term: 'aceite castrol bosch' });
  });

  it('AC 1: a word found only in the brand is enough for that word', async () => {
    await insertListedProduct({ slug: 'solo-marca', title: 'Pastillas de freno', brand: 'Ferodo', prices: [1000] });
    expect(slugsOf(await search('ferodo'))).toEqual(['solo-marca']);
    expect(slugsOf(await search('ferodo pastillas'))).toEqual(['solo-marca']);
  });

  it('AC 2: ignores case and accents in both directions', async () => {
    await insertListedProduct({ slug: 'con-tilde', title: 'Aceite sintético', prices: [1000] });
    await insertListedProduct({ slug: 'sin-tilde', title: 'Aceite sintetico', prices: [1100] });
    await insertListedProduct({ slug: 'marca-tilde', title: 'Escobilla', brand: 'Citroën', prices: [1200] });

    for (const term of ['SINTETICO', 'sintético', 'sintetico', 'SINTÉTICO']) {
      expect(sorted(slugsOf(await search(term)))).toEqual(['con-tilde', 'sin-tilde']);
    }
    expect(slugsOf(await search('citroen'))).toEqual(['marca-tilde']);
    expect(slugsOf(await search('CITROËN'))).toEqual(['marca-tilde']);
  });

  it('AC 3: singular and plural match each other, in both directions', async () => {
    await insertListedProduct({ slug: 'singular', title: 'Filtro de aceite', prices: [1000] });
    await insertListedProduct({ slug: 'plural', title: 'Filtros de aire', prices: [1100] });

    expect(slugsOf(await search('filtros aceite'))).toEqual(['singular']);
    expect(slugsOf(await search('filtro aire'))).toEqual(['plural']);
    expect(sorted(slugsOf(await search('filtro')))).toEqual(['plural', 'singular']);
    expect(sorted(slugsOf(await search('filtros')))).toEqual(['plural', 'singular']);
  });

  it('AC 3: brand names are not altered by the stemmer, and are found as written', async () => {
    await insertListedProduct({ slug: 'valeo', title: 'Escobilla', brand: 'Valeo', prices: [1000] });
    expect(slugsOf(await search('valeo'))).toEqual(['valeo']);
    expect(slugsOf(await search('VALEO'))).toEqual(['valeo']);
    // A plural of the brand is a different word: the brand has no stem.
    expect(await search('valeos')).toEqual({ state: 'no-results', term: 'valeos' });
  });

  describe('AC 4 (D-6): viscosity codes', () => {
    const spellings = ['5W-30', '5w30', '5W 30', '5w-30', '5W-30 aceite'];

    it('a title with 5W-30 and a title with 5W30 are both found by every spelling', async () => {
      await insertListedProduct({ slug: 'con-guion', title: 'Aceite 5W-30 4L', prices: [1000] });
      await insertListedProduct({ slug: 'junto', title: 'Aceite 5W30 5L', prices: [1100] });
      await insertListedProduct({ slug: 'otro-grado', title: 'Aceite 5W-40 4L', prices: [900] });

      for (const spelling of spellings) {
        expect(sorted(slugsOf(await search(spelling)))).toEqual(['con-guion', 'junto']);
      }
    });

    it('two codes in one title are each found, and a different grade is not', async () => {
      await insertListedProduct({ slug: 'dos-codigos', title: 'Aceite 10W-40 y 0W-20', prices: [1000] });
      expect(slugsOf(await search('10w40'))).toEqual(['dos-codigos']);
      expect(slugsOf(await search('0w 20'))).toEqual(['dos-codigos']);
      expect(await search('5w30')).toEqual({ state: 'no-results', term: '5w30' });
    });
  });

  it('decided: a partly typed word does not match ("cast" never finds Castrol)', async () => {
    await insertListedProduct({ slug: 'castrol', title: 'Aceite', brand: 'Castrol', prices: [1000] });
    expect(await search('cast')).toEqual({ state: 'no-results', term: 'cast' });
    expect(await search('acei')).toEqual({ state: 'no-results', term: 'acei' });
    expect(slugsOf(await search('castrol'))).toEqual(['castrol']);
  });

  it('decided: no minimum length; a one-character word is searched', async () => {
    await insertListedProduct({ slug: 'con-x', title: 'Filtro X', prices: [1000] });
    await insertListedProduct({ slug: 'sin-x', title: 'Filtro Y', prices: [1000] });
    expect(slugsOf(await search('x'))).toEqual(['con-x']);
  });

  it('decided: Spanish stop words are dropped, and a term of only stop words is no-results', async () => {
    await insertListedProduct({ slug: 'filtro-de-aceite', title: 'Filtro de aceite', prices: [1000] });
    expect(await search('de')).toEqual({ state: 'no-results', term: 'de' });
    expect(await search('de la')).toEqual({ state: 'no-results', term: 'de la' });
    // Dropped inside a longer term, so the rest still matches.
    expect(slugsOf(await search('filtro de aceite'))).toEqual(['filtro-de-aceite']);
    expect(slugsOf(await search('de aceite'))).toEqual(['filtro-de-aceite']);
  });

  it('decided: brand plus part number is not supported unless the number is in the title', async () => {
    await insertListedProduct({
      slug: 'solo-campo',
      title: 'Pastillas de freno',
      brand: 'Bosch',
      prices: [1000],
      extra: { partNumber: '0986494123', partNumberNormalised: '0986494123' },
    });
    await insertListedProduct({
      slug: 'en-titulo',
      title: 'Pastillas 0986494124',
      brand: 'Bosch',
      prices: [1000],
    });

    expect(await search('Bosch 0986494123')).toEqual({ state: 'no-results', term: 'Bosch 0986494123' });
    // The number alone is the supported way.
    expect(slugsOf(await search('0986494123'))).toEqual(['solo-campo']);
    // In the title the text route finds it with the brand.
    expect(slugsOf(await search('Bosch 0986494124'))).toEqual(['en-titulo']);
  });
});

// ---------------------------------------------------------------------------
describe('matching: EAN and part number (AC 5, 6, 7)', () => {
  beforeEach(async () => {
    await insertListedProduct({
      slug: 'con-codigos',
      title: 'Filtro de aceite',
      prices: [1500],
      extra: { ean: EAN, eanNormalised: EAN, partNumber: 'OC1234', partNumberNormalised: 'OC1234' },
    });
  });

  it('AC 5: an EAN finds the product however spaces, hyphens and dots are placed', async () => {
    for (const term of [EAN, '8 410076 472540', '8410076-472540', '8410076.472540', ` ${EAN} `]) {
      expect(slugsOf(await search(term))).toEqual(['con-codigos']);
    }
  });

  it('AC 5: a different number, and a number of the wrong length, give no match', async () => {
    expect(await search(EAN_OTHER)).toEqual({ state: 'no-results', term: EAN_OTHER });
    expect(await search('841007647254')).toEqual({ state: 'no-results', term: '841007647254' });
    expect(await search('84100764725400')).toEqual({ state: 'no-results', term: '84100764725400' });
  });

  it('AC 5: an 8-digit EAN is found the same way', async () => {
    await insertListedProduct({
      slug: 'ean-corto',
      title: 'Bujía',
      prices: [700],
      extra: { eanNormalised: '96385074' },
    });
    expect(slugsOf(await search('9638-5074'))).toEqual(['ean-corto']);
  });

  it('AC 6: a part number is found whatever the spaces, dashes, dots and case', async () => {
    for (const term of ['oc-12.34', 'OC 1234', 'oc1234', 'OC1234', 'Oc-1234']) {
      expect(slugsOf(await search(term))).toEqual(['con-codigos']);
    }
  });

  it('AC 6: a part number that merely starts with the term does not match', async () => {
    await insertListedProduct({
      slug: 'prefijo',
      title: 'Otro filtro',
      prices: [1000],
      extra: { partNumber: 'OC12345', partNumberNormalised: 'OC12345' },
    });
    expect(slugsOf(await search('oc1234'))).toEqual(['con-codigos']);
    expect(await search('oc12')).toEqual({ state: 'no-results', term: 'oc12' });
    expect(slugsOf(await search('oc12345'))).toEqual(['prefijo']);
  });

  it('AC 6: the dotted spelling reaches the part-number route, not the title', async () => {
    // "oc.1234" is one token to the text search, so only the code route can find it.
    await insertListedProduct({ slug: 'sin-codigo', title: 'Filtro OC1234 compatible', prices: [900] });
    expect(slugsOf(await search('oc.1234'))).toEqual(['con-codigos']);
  });

  it('AC 7: a product matched by text and by EAN appears once, with one count', async () => {
    await insertListedProduct({
      slug: 'texto-y-ean',
      title: `Pastillas ${EAN_OTHER}`,
      prices: [1000, 1200],
      extra: { eanNormalised: EAN_OTHER },
    });
    const result = await search(EAN_OTHER);
    expect(slugsOf(result)).toEqual(['texto-y-ean']);
    expect(result).toMatchObject({ state: 'results', productCount: 1, pageCount: 1 });
    expect(result?.state === 'results' && result.products[0].offerCount).toBe(2);
  });

  it('AC 7: a product matched by text and by part number appears once', async () => {
    await insertListedProduct({
      slug: 'texto-y-pn',
      title: 'Filtro OC9999',
      prices: [1000],
      extra: { partNumber: 'OC9999', partNumberNormalised: 'OC9999' },
    });
    const result = await search('OC9999');
    expect(slugsOf(result)).toEqual(['texto-y-pn']);
    expect(result).toMatchObject({ productCount: 1 });
  });

  it('AC 7: one term matched by the EAN of one product and the title of another lists both', async () => {
    await insertListedProduct({ slug: 'por-titulo', title: `Kit ${EAN}`, prices: [100] });
    expect(sorted(slugsOf(await search(EAN)))).toEqual(['con-codigos', 'por-titulo']);
  });
});

// ---------------------------------------------------------------------------
describe('ranking (AC 8, 9)', () => {
  it('AC 8: an exact part number ranks before a cheaper text match', async () => {
    await insertListedProduct({ slug: 'texto-barato', title: 'Filtro OC1234 compatible', prices: [100] });
    await insertListedProduct({
      slug: 'por-codigo',
      title: 'Filtro de aceite',
      prices: [5000],
      extra: { partNumber: 'OC-1234', partNumberNormalised: 'OC1234' },
    });
    expect(slugsOf(await search('OC1234'))).toEqual(['por-codigo', 'texto-barato']);
  });

  it('AC 8: an exact EAN ranks before a cheaper text match', async () => {
    await insertListedProduct({ slug: 'texto-barato', title: `Filtro ${EAN} compatible`, prices: [100] });
    await insertListedProduct({
      slug: 'por-ean',
      title: 'Filtro de aceite',
      prices: [5000],
      extra: { eanNormalised: EAN },
    });
    expect(slugsOf(await search(EAN))).toEqual(['por-ean', 'texto-barato']);
  });

  it('AC 8: among code matches, the cheaper comes first, and the text-only ones follow', async () => {
    await insertListedProduct({
      slug: 'codigo-caro',
      title: 'A',
      prices: [4000],
      extra: { partNumberNormalised: 'ZX1' },
    });
    await insertListedProduct({
      slug: 'codigo-barato',
      title: 'B',
      prices: [3000],
      extra: { partNumberNormalised: 'ZX1' },
    });
    await insertListedProduct({ slug: 'texto', title: 'Pieza ZX1', prices: [10] });
    expect(slugsOf(await search('zx1'))).toEqual(['codigo-barato', 'codigo-caro', 'texto']);
  });

  it('AC 9: among text matches the lowest visible price comes first', async () => {
    await insertListedProduct({ slug: 'caro', title: 'Filtro caro', prices: [3000] });
    await insertListedProduct({ slug: 'barato', title: 'Filtro barato', prices: [1000] });
    await insertListedProduct({ slug: 'medio', title: 'Filtro medio', prices: [2500, 2000] });
    expect(slugsOf(await search('filtro'))).toEqual(['barato', 'medio', 'caro']);
  });

  it('AC 9: the order uses the lowest VISIBLE price, not a hidden cheaper offer', async () => {
    const hiddenCheap = await insertListedProduct({ slug: 'oferta-oculta', title: 'Filtro uno', prices: [100, 2000] });
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, hiddenCheap.offerIds[0]));
    await insertListedProduct({ slug: 'normal', title: 'Filtro dos', prices: [1500] });
    expect(slugsOf(await search('filtro'))).toEqual(['normal', 'oferta-oculta']);
  });

  it('AC 9: equal tier and price break on the product id, and the order repeats', async () => {
    const first = await insertListedProduct({ slug: 'empate-z', title: 'Filtro empate', prices: [1000] });
    const second = await insertListedProduct({ slug: 'empate-a', title: 'Filtro empate', prices: [1000] });
    const third = await insertListedProduct({ slug: 'empate-m', title: 'Filtro empate', prices: [1000] });
    expect(first.id).toBeLessThan(second.id);
    expect(second.id).toBeLessThan(third.id);

    const expected = ['empate-z', 'empate-a', 'empate-m'];
    for (let call = 0; call < 3; call += 1) {
      expect(slugsOf(await search('filtro'))).toEqual(expected);
    }
    expect(await search('filtro')).toEqual(await search('filtro'));
  });
});

// ---------------------------------------------------------------------------
describe('states and pages (AC 21, 22, 23, 24)', () => {
  it('AC 23: an empty term is empty-query whatever the page, and reads no database', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    expect(await getPublicSearchPage('', 1)).toEqual({ state: 'empty-query', term: '' });
    expect(await getPublicSearchPage('', 7)).toEqual({ state: 'empty-query', term: '' });
    expect(await search('   ', 3)).toEqual({ state: 'empty-query', term: '' });
    expect(await search('\u0000')).toEqual({ state: 'empty-query', term: '' });
  });

  it('AC 24: a term with no match is no-results and echoes the cleaned term', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    expect(await search('  zzzz   yyyy ')).toEqual({ state: 'no-results', term: 'zzzz yyyy' });
  });

  it('AC 22: page 2 of a term with no public match is null (404)', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    expect(await search('zzzz', 2)).toBeNull();
    expect(await search('zzzz', 99)).toBeNull();
  });

  it('AC 21: a single page has pageCount 1; page 2 is null', async () => {
    await insertListedProduct({ slug: 'filtro-a', title: 'Filtro A', prices: [1000] });
    const result = await search('filtro');
    expect(result).toMatchObject({ state: 'results', term: 'filtro', page: 1, pageCount: 1, productCount: 1 });
    expect(await search('filtro', 2)).toBeNull();
  });

  it('AC 21, 22: pages hold 24, the last holds the rest, a page beyond is null, and no product repeats or is skipped', async () => {
    expect(SEARCH_PAGE_SIZE).toBe(24);
    const total = SEARCH_PAGE_SIZE + 1;
    const slugs: string[] = [];
    for (let n = 1; n <= total; n += 1) {
      const slug = `filtro-${String(n).padStart(2, '0')}`;
      slugs.push(slug);
      await insertListedProduct({ slug, title: `Filtro ${slug}`, prices: [n * 100] });
    }

    const first = await search('filtro', 1);
    const second = await search('filtro', 2);
    expect(first).toMatchObject({ state: 'results', page: 1, pageCount: 2, productCount: total });
    expect(second).toMatchObject({ state: 'results', page: 2, pageCount: 2, productCount: total });
    expect(slugsOf(first)).toHaveLength(SEARCH_PAGE_SIZE);
    expect(slugsOf(second)).toHaveLength(1);
    // Cheapest first, so the two pages together are the whole list in price order.
    expect([...slugsOf(first), ...slugsOf(second)]).toEqual(slugs);
    expect(await search('filtro', 3)).toBeNull();
  });

  it('AC 21: exactly one page of products has no second page', async () => {
    for (let n = 1; n <= SEARCH_PAGE_SIZE; n += 1) {
      await insertListedProduct({ slug: `lote-${n}`, title: `Lote ${n}`, prices: [n * 100] });
    }
    expect(await search('lote', 1)).toMatchObject({ pageCount: 1, productCount: SEARCH_PAGE_SIZE });
    expect(await search('lote', 2)).toBeNull();
  });

  it('AC 21: a tie across the page boundary still splits on id, with no repeat', async () => {
    const slugs: string[] = [];
    for (let n = 1; n <= SEARCH_PAGE_SIZE + 3; n += 1) {
      const slug = `igual-${n}`;
      slugs.push(slug);
      await insertListedProduct({ slug, title: 'Filtro igual', prices: [1000] });
    }
    const both = [...slugsOf(await search('filtro', 1)), ...slugsOf(await search('filtro', 2))];
    expect(both).toEqual(slugs);
  });
});

// ---------------------------------------------------------------------------
describe('the card (AC 16, 20)', () => {
  it('AC 16, 20: carries the product fields, the lowest visible price and the visible shop count', async () => {
    const category = await insertCategory({ slug: 'aceites', name: 'Aceites' });
    await insertListedProduct({
      slug: 'castrol',
      title: 'Aceite sintético',
      brand: 'Castrol',
      prices: [2999, 2499, 3500],
      categoryId: category.id,
      extra: { partNumber: ' CS 30 ' },
    });

    const result = await search('castrol');
    expect(result).toMatchObject({ state: 'results' });
    expect(result?.state === 'results' && result.products[0]).toEqual({
      slug: 'castrol',
      title: 'Aceite sintético',
      brand: 'Castrol',
      partNumber: 'CS 30',
      lowestPriceCents: 2499,
      offerCount: 3,
      categorySlug: 'aceites',
    });
  });

  it('AC 20: a product with no brand has a null brand and no placeholder; a blank part number is null', async () => {
    await insertListedProduct({ slug: 'sin-marca', title: 'Filtro anonimo', prices: [1000], extra: { partNumber: '  ' } });
    const result = await search('anonimo');
    const card = result?.state === 'results' ? result.products[0] : undefined;
    expect(card?.brand).toBeNull();
    expect(card?.partNumber).toBeNull();
  });

  it('AC 16: only visible offers set the price and the shop count; the card price equals the product page first price', async () => {
    const product = await insertListedProduct({ slug: 'mixto', title: 'Filtro mixto', prices: [500, 900, 1200, 1300] });
    // The cheapest is hidden, the next is in review, one more is from an unapproved feed.
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, product.offerIds[0]));
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, product.offerIds[1]));
    const [unapproved] = await getDb()
      .select({ feedId: offers.feedId })
      .from(offers)
      .where(eq(offers.id, product.offerIds[2]));
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, unapproved.feedId));

    const result = await search('mixto');
    const card = result?.state === 'results' ? result.products[0] : undefined;
    expect(card?.lowestPriceCents).toBe(1300);
    expect(card?.offerCount).toBe(1);

    const page = await getPublicProductBySlug('mixto');
    expect(card?.lowestPriceCents).toBe(page?.offers[0].priceCents);
    expect(card?.offerCount).toBe(page?.offers.length);
  });

  it('AC 16: a product with one shop reads as one shop', async () => {
    await insertListedProduct({ slug: 'unica', title: 'Filtro unica', prices: [1000] });
    const result = await search('unica');
    expect(result?.state === 'results' && result.products[0].offerCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe('demoOnly (AC 17)', () => {
  it('is true when every card on the page has only demo offers, false when any card has a real offer', async () => {
    const demoShop = await insertShop();
    const demoFeed = await insertFeed(demoShop.id, { isDemo: true });
    const realShop = await insertShop();
    const realFeed = await insertFeed(realShop.id, { isDemo: false });

    await insertListedProduct({ slug: 'demo-uno', title: 'Filtro demo uno', prices: [1000], feedId: demoFeed });
    const onlyDemo = await search('filtro');
    expect(onlyDemo).toMatchObject({ state: 'results', demoOnly: true });
    expect(slugsOf(onlyDemo)).toEqual(['demo-uno']);

    await insertListedProduct({ slug: 'real-uno', title: 'Filtro real uno', prices: [1100], feedId: realFeed });
    expect(await search('filtro')).toMatchObject({ state: 'results', demoOnly: false });
    expect(slugsOf(await search('filtro'))).toEqual(['demo-uno', 'real-uno']);
  });

  it('is false when one product has a demo offer and a real offer', async () => {
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const realFeed = await insertFeed((await insertShop()).id, { isDemo: false });
    const product = await insertProduct({ slug: 'mezcla', title: 'Filtro mezcla' });
    await insertOffer({ productId: product.id, feedId: demoFeed, priceCents: 1000 });
    await insertOffer({ productId: product.id, feedId: realFeed, priceCents: 1200 });
    expect(await search('mezcla')).toMatchObject({ state: 'results', demoOnly: false });
  });

  it('ignores a real offer that is not visible: the card is still demo-only', async () => {
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    const hiddenRealFeed = await insertFeed((await insertShop()).id, { isDemo: false, isApproved: false });
    const product = await insertProduct({ slug: 'demo-y-oculta', title: 'Filtro demo oculta' });
    await insertOffer({ productId: product.id, feedId: demoFeed, priceCents: 1000 });
    await insertOffer({ productId: product.id, feedId: hiddenRealFeed, priceCents: 900 });
    expect(await search('oculta')).toMatchObject({ state: 'results', demoOnly: true });
  });
});

// ---------------------------------------------------------------------------
describe('hostile and long terms (AC 10, 11)', () => {
  beforeEach(async () => {
    await insertListedProduct({
      slug: 'filtro-a',
      title: 'Filtro A 100% original',
      prices: [1000],
      extra: { partNumber: 'OC-1234', partNumberNormalised: 'OC1234' },
    });
  });

  const hostile = ['%', '_', '&|!:(', '\\', "'", '"', 'a:*', '😀', '()', '!', '&', '|', '*', ':', '<->', '--', ';', "'; drop table products; --"];

  it.each(hostile)('AC 11: %j answers no-results, never an error and never "everything"', async (term) => {
    const result = await search(term);
    expect(result).toEqual({ state: 'no-results', term: parseSearchTerm(term) });
  });

  it('AC 11: the same terms on page 2 are 404, not an error', async () => {
    for (const term of hostile) expect(await search(term, 2)).toBeNull();
  });

  it('AC 11: a hostile word beside a real one does not break the real one', async () => {
    // Punctuation-only words add no condition; the real word still decides.
    expect(slugsOf(await search('filtro &'))).toEqual(['filtro-a']);
    expect(slugsOf(await search('filtro (|!:'))).toEqual(['filtro-a']);
    expect(await search('zzzz &')).toEqual({ state: 'no-results', term: 'zzzz &' });
    expect(slugsOf(await search("filtro 'original'"))).toEqual(['filtro-a']);
  });

  it('AC 11: a lone % or _ never matches everything', async () => {
    for (const term of ['%', '_', '%%', '__']) {
      expect(slugsOf(await search(term))).toEqual([]);
    }
  });

  it('AC 11: an encoded NUL becomes whitespace, not an error', async () => {
    expect(slugsOf(await search('filtro\u0000'))).toEqual(['filtro-a']);
    expect(slugsOf(await search('fil\u0000tro'))).toEqual([]);
  });

  it('AC 10: a term cut at 100 characters finds what its first 100 characters name', async () => {
    const word = 'z'.repeat(100);
    await insertListedProduct({ slug: 'palabra-larga', title: `Pieza ${word}`, prices: [1000] });
    expect(slugsOf(await search(word + 'y'.repeat(50)))).toEqual(['palabra-larga']);
  });

  it('AC 10: surrounding and inner whitespace, and the first of several q, do not change the result', async () => {
    const plain = await search('filtro original');
    expect(await search('  filtro \t  original\n')).toEqual(plain);
    expect(await getPublicSearchPage(parseSearchTerm(['filtro original', 'zzzz']), 1)).toEqual(plain);
  });
});

// ---------------------------------------------------------------------------
describe('visibility (guardrail 1, AC 13 to 15, 17)', () => {
  type Ids = { shopId: number; feedId: number; productId: number; offerId: number };

  const states: [string, (ids: Ids) => Promise<unknown>][] = [
    ['the product is hidden', (ids) => getDb().update(products).set({ isHidden: true }).where(eq(products.id, ids.productId))],
    ['the product has no category', (ids) => getDb().update(products).set({ categoryId: null }).where(eq(products.id, ids.productId))],
    ['the only offer is hidden', (ids) => getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, ids.offerId))],
    ['the only offer is in the matching queue', (ids) => getDb().update(offers).set({ inReview: true }).where(eq(offers.id, ids.offerId))],
    ['the feed is not approved', (ids) => getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, ids.feedId))],
    ['the shop is not approved', (ids) => getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, ids.shopId))],
    ['the product has no offer at all', (ids) => getDb().delete(offers).where(eq(offers.id, ids.offerId))],
  ];

  /** One fully visible product with a title, a brand, an EAN and a part number to search by. */
  async function visibleProduct() {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct({
      slug: 'objetivo',
      title: 'Filtro objetivo unico',
      brand: 'Marcaunica',
      eanNormalised: EAN,
      partNumber: 'OB-77',
      partNumberNormalised: 'OB77',
    });
    const offerId = await insertOffer({ productId: product.id, feedId, priceCents: 1000 });
    return { shopId: shop.id, feedId, productId: product.id, offerId };
  }

  const terms: [string, string][] = [
    ['title', 'Filtro objetivo unico'],
    ['brand', 'marcaunica'],
    ['EAN', EAN],
    ['part number', 'ob-77'],
  ];

  it('baseline: the visible product is found by title, brand, EAN and part number', async () => {
    await visibleProduct();
    for (const [, term] of terms) expect(slugsOf(await search(term))).toEqual(['objetivo']);
  });

  describe.each(states)('when %s', (_label, mutate) => {
    it('AC 14, 15: is never found, by any route, and the answer equals a term that matches nothing', async () => {
      const ids = await visibleProduct();
      await mutate(ids);
      for (const [, term] of terms) {
        const result = await search(term);
        expect(result).toEqual({ state: 'no-results', term });
        expect(await search(term, 2)).toBeNull();
      }
      // The same shape as a term that matches nothing at all.
      expect(await search('zzzzinexistente')).toEqual({ state: 'no-results', term: 'zzzzinexistente' });
    });

    it('AC 17: takes effect on the next call, with no re-index', async () => {
      const ids = await visibleProduct();
      expect(slugsOf(await search('objetivo'))).toEqual(['objetivo']);
      await mutate(ids);
      expect(slugsOf(await search('objetivo'))).toEqual([]);
    });
  });

  it('AC 15: a hidden-only match is indistinguishable from no match, count and status included', async () => {
    await insertListedProduct({ slug: 'oculto', title: 'Filtro secreto', prices: [1000], isHidden: true });
    const hidden = await search('secreto');
    const nothing = await search('inexistente');
    expect(hidden).toEqual({ state: 'no-results', term: 'secreto' });
    expect(nothing).toEqual({ state: 'no-results', term: 'inexistente' });
    expect(Object.keys(hidden ?? {}).sort()).toEqual(Object.keys(nothing ?? {}).sort());
    expect(await search('secreto', 2)).toBeNull();
    expect(await search('inexistente', 2)).toBeNull();
  });

  it('AC 14, 16: a product with a hidden and a visible offer is found, counted by its visible offer only', async () => {
    const product = await insertListedProduct({ slug: 'parcial', title: 'Filtro parcial', prices: [100, 900] });
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, product.offerIds[0]));
    const result = await search('parcial');
    expect(result).toMatchObject({ state: 'results', productCount: 1 });
    expect(result?.state === 'results' && result.products[0]).toMatchObject({ lowestPriceCents: 900, offerCount: 1 });
  });

  it('AC 16: the result and page counts ignore products that are not public', async () => {
    for (let n = 1; n <= SEARCH_PAGE_SIZE; n += 1) {
      await insertListedProduct({ slug: `publico-${n}`, title: 'Filtro publico', prices: [n * 100] });
    }
    for (let n = 1; n <= 5; n += 1) {
      await insertListedProduct({ slug: `oculto-${n}`, title: 'Filtro publico', prices: [50], isHidden: true });
    }
    await insertListedProduct({ slug: 'sin-categoria', title: 'Filtro publico', prices: [50], categoryId: null });
    const result = await search('publico');
    expect(result).toMatchObject({ productCount: SEARCH_PAGE_SIZE, pageCount: 1 });
    expect(await search('publico', 2)).toBeNull();
  });

  it('AC 17: hiding then un-hiding a product moves it out and back on the next call', async () => {
    const product = await insertListedProduct({ slug: 'vaiven', title: 'Filtro vaiven', prices: [1000] });
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect(slugsOf(await search('vaiven'))).toEqual([]);
    await getDb().update(products).set({ isHidden: false }).where(eq(products.id, product.id));
    expect(slugsOf(await search('vaiven'))).toEqual(['vaiven']);
  });

  it('AC 17: demo products appear like any public product', async () => {
    const demoFeed = await insertFeed((await insertShop()).id, { isDemo: true });
    await insertListedProduct({ slug: 'demo', title: 'Filtro demo', prices: [1000], feedId: demoFeed });
    expect(slugsOf(await search('demo'))).toEqual(['demo']);
  });

  it('AC 14: an unmapped product is not found even when searched by its exact EAN and part number', async () => {
    await insertVisibleOffer({ slug: 'base', categoryId: null });
    await insertListedProduct({
      slug: 'sin-cat',
      title: 'Filtro sin categoria',
      prices: [1000],
      categoryId: null,
      extra: { eanNormalised: EAN_OTHER, partNumberNormalised: 'SC1' },
    });
    expect(await search(EAN_OTHER)).toEqual({ state: 'no-results', term: EAN_OTHER });
    expect(await search('sc1')).toEqual({ state: 'no-results', term: 'sc1' });
  });
});

// ---------------------------------------------------------------------------
describe('freshness (AC 12)', () => {
  it('a product created by import-feeds is findable straight after, by title, EAN and part number', async () => {
    const { feedId } = await insertFixtureFeed('category-ean-one.csv');
    const category = await insertCategory({ slug: 'cat-uno', name: 'Cat uno' });
    await insertCategoryMapping(feedId, 'Cat Uno', category.id);

    expect(await search('alpha')).toEqual({ state: 'no-results', term: 'alpha' });
    await importFeeds(getDb(), { feedId, deps: fixtureDeps });

    expect(slugsOf(await search('alpha filtro'))).toHaveLength(1);
    expect(slugsOf(await search('FILTROS alpha'))).toHaveLength(1);
    expect(slugsOf(await search('marcauno'))).toHaveLength(1);
    expect(slugsOf(await search('2000000000046'))).toHaveLength(1);
    expect(slugsOf(await search('pn-100'))).toHaveLength(1);
    expect(slugsOf(await search('PN 100'))).toHaveLength(1);
  });

  it('an update of the title or brand refreshes the searchable text with no other step', async () => {
    const product = await insertListedProduct({ slug: 'cambia', title: 'Filtro viejo', brand: 'Antes', prices: [1000] });
    expect(slugsOf(await search('viejo'))).toEqual(['cambia']);

    await getDb().update(products).set({ title: 'Filtro nuevo', brand: 'Despues' }).where(eq(products.id, product.id));

    expect(slugsOf(await search('viejo'))).toEqual([]);
    expect(slugsOf(await search('antes'))).toEqual([]);
    expect(slugsOf(await search('nuevo despues'))).toEqual(['cambia']);
  });
});

// ---------------------------------------------------------------------------
describe('failure handling (AC 31, guardrail 5)', () => {
  it('logs exactly one fixed-code line without the term, and throws a fixed error with no cause', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logs = [
      vi.spyOn(console, 'log').mockImplementation(() => undefined),
      vi.spyOn(console, 'warn').mockImplementation(() => undefined),
      vi.spyOn(console, 'info').mockImplementation(() => undefined),
      vi.spyOn(console, 'debug').mockImplementation(() => undefined),
    ];
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

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
    expect(String((thrown as Error).stack)).not.toContain(marker);

    expect(errors).toHaveBeenCalledTimes(1);
    const line = String(errors.mock.calls[0]?.[0]);
    expect(errors.mock.calls[0]).toHaveLength(1);
    expect(line).toMatch(/^search: failed \([A-Za-z0-9_]{1,32}\)$/);
    expect(line).not.toContain(marker);
    for (const spy of logs) expect(spy).not.toHaveBeenCalled();
  });

  it('a failure on page 2 or with a term that matches nothing logs the same fixed shape', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    for (const [term, page] of [['zqmarkerdos', 2], ['100%', 1]] as const) {
      await expect(getPublicSearchPage(term, page)).rejects.toThrow(/^search: failed$/);
    }
    expect(errors).toHaveBeenCalledTimes(2);
    for (const call of errors.mock.calls) {
      expect(String(call[0])).toMatch(/^search: failed \([A-Za-z0-9_]{1,32}\)$/);
      expect(JSON.stringify(call)).not.toContain('zqmarkerdos');
    }
  });
});
