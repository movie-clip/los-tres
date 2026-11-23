import { readFileSync } from 'node:fs';
import path from 'node:path';

import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSiteName } from '@/config/site';
import { closeDb } from '@/db/client';
import { ADMIN_PRODUCTS_PAGE_SIZE } from '@/server/admin/product-rules';
import { formatEuroCents } from '@/server/money';

import messages from '../../messages/es-ES.json';
import { SITE_ORIGIN, createAdmin, signInForCookie } from '../support/admin';
import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { redirectOf, startAdminRequest, startRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// US-2.4 / T2.4.2: the two admin product screens, rendered from the real page modules with a real
// translator, so the markup is what the browser's first response carries. The reads and writers are
// covered by admin-product-read, admin-product-writer and admin-product-actions; this file covers
// what a page does with them: the states of 03-ux.md, their copy keys, the links that keep the list
// state, and what the markup never holds (no address, no stored flag name).

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const all = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages: all, namespace } as never) as unknown,
  };
});

const copy = messages.Admin.Products;
const detail = messages.Admin.Products.Detail;

beforeEach(async () => {
  await resetDatabase();
  await createAdmin();
  const { cookie } = await signInForCookie();
  startAdminRequest({ cookie, origin: SITE_ORIGIN });
});
afterEach(() => {
  vi.restoreAllMocks();
});
afterAll(async () => {
  await closeDb();
});

type Query = Record<string, string | string[] | undefined>;

const html = (element: unknown) => renderToStaticMarkup(element as never);

async function listPage(searchParams: Query = {}) {
  const { default: Page } = await import('@/app/admin/(shell)/productos/page');
  return html(await Page({ searchParams: Promise.resolve(searchParams) }));
}

async function productPage(id: number | string, searchParams: Query = {}) {
  const { default: Page } = await import('@/app/admin/(shell)/productos/[id]/page');
  return html(await Page({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(searchParams) }));
}

/** The digest Next puts on a thrown notFound(), whatever its version prefix. */
async function notFoundOf(run: () => Promise<unknown>): Promise<boolean> {
  try {
    await run();
  } catch (error) {
    return /404|NOT_FOUND/.test(String((error as { digest?: unknown }).digest ?? ''));
  }
  return false;
}

/** The rows of the list, in page order, each as its own markup. */
const rowsOf = (page: string): string[] => page.split('data-testid="product-row"').slice(1);

/** One approved shop and feed. */
async function approvedFeed(shopName?: string) {
  const shop = await insertShop({ name: shopName });
  return { shop, feedId: await insertFeed(shop.id) };
}

describe('the list with products in several states (AC 8 to 11, L1, 03-ux Screens 1)', () => {
  it('draws the heading, the intro, the search form, the count and one row per product, newest first', async () => {
    const feed = await approvedFeed();
    const older = await insertProduct({ slug: 'p-antiguo', title: 'Aceite antiguo' });
    const newer = await insertProduct({ slug: 'p-nuevo', title: 'Aceite nuevo' });
    await insertOffer({ productId: older.id, feedId: feed.feedId });
    await insertOffer({ productId: newer.id, feedId: feed.feedId });

    const page = await listPage();

    expect(page).toContain(`<h1`);
    expect(page).toContain(`>${copy.heading}</h1>`);
    expect(page).toContain(copy.intro);
    expect(page).toMatch(new RegExp(`<form role="search" aria-label="${copy.searchFormLabel}"[^>]*method="get"`));
    expect(page).toMatch(new RegExp(`<label for="products-q"[^>]*>${copy.searchLabel}</label>`));
    expect(page).toContain(copy.searchHint);
    expect(page).toContain(`>${copy.hiddenOnlyLabel}</span>`);
    expect(page).toContain(`>${copy.searchButton}</button>`);
    expect(page).toMatch(/data-testid="products-summary"[^>]*><span>2 productos<\/span><\/p>/);
    expect(page).not.toContain('data-testid="products-clear"');
    expect(page).not.toContain('data-testid="pagination"');
    expect(page).toContain(`aria-label="${copy.listLabel}"`);

    const rows = rowsOf(page);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain('Aceite nuevo');
    expect(rows[1]).toContain('Aceite antiguo');
  });

  it('puts the title as the one link of a row, to that product with the list query, and no control on the row', async () => {
    const product = await insertProduct({ slug: 'p-uno', title: 'Filtro uno' });
    const page = await listPage({ q: 'filtro', pagina: '1' });
    const [row] = rowsOf(page);
    expect(row).toMatch(new RegExp(`<h2[^>]*><a href="/admin/productos/${product.id}\\?q=filtro"[^>]*data-testid="product-row-title">Filtro uno</a></h2>`));
    expect(row.match(/<a /g)).toHaveLength(1);
    expect(row).not.toContain('<button');
    expect(row).not.toContain('<form');
  });

  it('shows the hidden flag and public-now as two different things, from the server read', async () => {
    const feed = await approvedFeed();
    const live = await insertProduct({ slug: 'p-publico', title: 'Producto publico' });
    const hidden = await insertProduct({ slug: 'p-oculto', title: 'Producto oculto', isHidden: true });
    const noOffer = await insertProduct({ slug: 'p-sin-oferta', title: 'Producto sin oferta' });
    await insertOffer({ productId: live.id, feedId: feed.feedId });
    await insertOffer({ productId: hidden.id, feedId: feed.feedId });

    const rows = Object.fromEntries(rowsOf(await listPage()).map((row) => [/>(Producto [a-z ]+)<\/a>/.exec(row)?.[1], row]));

    expect(rows['Producto publico']).toContain(`>${copy.tagNotHidden}<`);
    expect(rows['Producto publico']).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowYes}</span>`));
    expect(rows['Producto oculto']).toContain(`>${copy.tagHidden}<`);
    expect(rows['Producto oculto']).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowNo}</span>`));
    // Not hidden and still not on the site (no offer): the two facts differ, and the words keep them apart.
    expect(rows['Producto sin oferta']).toContain(`>${copy.tagNotHidden}<`);
    expect(rows['Producto sin oferta']).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowNo}</span>`));
    expect(noOffer.id).toBeGreaterThan(0);
  });

  it('shows only the identifiers the product has, in the fixed order, and never a blank or a dash (AC 9)', async () => {
    await insertProduct({ slug: 'p-completo', title: 'Completo', brand: 'Bosch', partNumber: 'OF-3306', ean: '4047024000000' });
    await insertProduct({ slug: 'p-sin-marca', title: 'Sin marca', brand: null, partNumber: null, ean: null });

    const rows = Object.fromEntries(rowsOf(await listPage()).map((row) => [/>(Completo|Sin marca)<\/a>/.exec(row)?.[1], row]));

    const full = rows.Completo;
    const order = [copy.brandLabel, copy.partNumberLabel, copy.eanLabel, copy.slugLabel].map((label) => full.indexOf(label));
    expect(order.every((position) => position > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(full).toContain('>Bosch<');
    expect(full).toContain('>OF-3306<');
    expect(full).toContain('>4047024000000<');
    expect(full).toContain('>p-completo<');

    const bare = rows['Sin marca'];
    for (const label of [copy.brandLabel, copy.partNumberLabel, copy.eanLabel]) expect(bare).not.toContain(label);
    expect(bare).toContain(copy.slugLabel);
    expect(bare).not.toMatch(/>\s*[—–-]\s*</);
  });

  it('never prints an id, an address or the stored flag name, and links to no public page and no shop', async () => {
    const feed = await approvedFeed();
    const product = await insertProduct({ slug: 'p-limpio' });
    await insertOffer({ productId: product.id, feedId: feed.feedId, url: 'https://affiliate.example/never-public' });

    const page = await listPage();
    expect(page).not.toContain('affiliate.example');
    expect(page).not.toMatch(/https?:/);
    expect(page).not.toContain('/go/');
    expect(page).not.toContain('/producto/');
    expect(page).not.toMatch(/isHidden|is_hidden/);
    expect(page).not.toContain(`>${product.id}<`);
  });
});

describe('the search and the filter (AC 12 to 19, L3 to L5, L8, L11, L12)', () => {
  it('refills the field with the cleaned term and echoes it in the count, with the way back to the bare list', async () => {
    const product = await insertProduct({ slug: 'p-filtro', title: 'Filtro de aceite' });
    await insertProduct({ slug: 'p-aceite', title: 'Aceite de motor' });

    const page = await listPage({ q: '  filtro ' });

    expect(page).toMatch(/<input[^>]*id="products-q"[^>]*value="filtro"/);
    expect(page).toContain('<span>1 producto para «filtro»</span>');
    expect(page).toMatch(/<a href="\/admin\/productos"[^>]*data-testid="products-clear">Ver todos los productos<\/a>/);
    expect(rowsOf(page)).toHaveLength(1);
    expect(page).toContain(`/admin/productos/${product.id}?q=filtro"`);
  });

  it('ticks the box and says "ocultos" when only the hidden are asked for, and lists only them', async () => {
    await insertProduct({ slug: 'p-visible', title: 'Visible uno' });
    await insertProduct({ slug: 'p-oculto', title: 'Oculto uno', isHidden: true });

    const page = await listPage({ ocultos: '1' });

    const box = /<input[^>]*name="ocultos"[^>]*>/.exec(page)?.[0] ?? '';
    expect(box).toContain('type="checkbox"');
    expect(box).toContain('value="1"');
    expect(box).toContain('checked=""');
    expect(page).toContain('<span>1 producto oculto</span>');
    expect(rowsOf(page)).toHaveLength(1);
    expect(rowsOf(page)[0]).toContain('Oculto uno');
    expect(page).toContain('data-testid="products-clear"');
  });

  it('leaves the box unticked for any value but 1', async () => {
    for (const value of ['0', 'true', '']) {
      expect(/<input[^>]*name="ocultos"[^>]*>/.exec(await listPage({ ocultos: value }))?.[0], value).not.toContain('checked');
    }
  });

  it('says both the filter and the term when both are on', async () => {
    await insertProduct({ slug: 'p-filtro-oculto', title: 'Filtro oculto', isHidden: true });
    const page = await listPage({ q: 'filtro', ocultos: '1' });
    expect(page).toContain('<span>1 producto oculto para «filtro»</span>');
  });

  it('a term that matches nothing says so by name, offers the bare list as a button and still answers (AC 17)', async () => {
    await insertProduct({ slug: 'p-uno', title: 'Filtro uno' });
    const page = await listPage({ q: 'zzzz' });
    expect(page).toContain('data-testid="products-empty"');
    expect(page).toContain(copy.emptyNoMatch.replace('{term}', 'zzzz'));
    expect(page).toMatch(/<a href="\/admin\/productos"[^>]*data-testid="products-empty-link">Ver todos los productos<\/a>/);
    expect(page).toContain('<span>0 productos para «zzzz»</span>');
    // The summary does not carry a second copy of the same link.
    expect(page).not.toContain('data-testid="products-clear"');
    expect(page).not.toContain('data-testid="products-list"');
  });

  it('a term with the filter on that matches nothing names the filter in its sentence', async () => {
    await insertProduct({ slug: 'p-uno', title: 'Filtro uno' });
    await insertProduct({ slug: 'p-oculto', title: 'Otro', isHidden: true });
    const page = await listPage({ q: 'filtro', ocultos: '1' });
    expect(page).toContain(copy.emptyNoMatchHidden.replace('{term}', 'filtro'));
  });

  it('with the filter on and nothing hidden, says so and offers the bare list', async () => {
    await insertProduct({ slug: 'p-uno' });
    const page = await listPage({ ocultos: '1' });
    expect(page).toContain(copy.emptyNoHidden);
    expect(page).toContain('data-testid="products-empty-link"');
    expect(page).toContain(`>${copy.clearAll}</a>`);
    expect(page).not.toContain('data-testid="products-list"');
  });

  it('shows markup in a term as plain text, escaped, in the field, the count and the sentence (L12)', async () => {
    const page = await listPage({ q: '<script>alert(1)</script>' });
    expect(page).not.toContain('<script>');
    expect(page).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('takes the first of a repeated parameter and treats an empty term as no term (L11)', async () => {
    await insertProduct({ slug: 'p-uno', title: 'Uno' });
    expect(await listPage({ q: '' })).toContain('<span>1 producto</span>');
    expect(await listPage({ q: ['Uno', 'otro'] })).toContain('para «Uno»');
  });
});

describe('the page with no products at all (AC 21, L6)', () => {
  it('answers with the form, one sentence about importing a feed and a button to Tiendas y feeds, and no count', async () => {
    const page = await listPage();
    expect(page).toContain('data-testid="products-search"');
    expect(page).toContain(copy.emptyNoProducts);
    expect(page).toMatch(/<a href="\/admin\/tiendas"[^>]*data-testid="products-empty-link">Ir a Tiendas y feeds<\/a>/);
    expect(page).not.toContain('data-testid="products-summary"');
    expect(page).not.toContain('data-testid="products-list"');
    expect(page).not.toContain('data-testid="pagination"');
  });

  it('is the same with a page number far past the end: zero products is empty whatever the page (L6 outranks L9)', async () => {
    const page = await listPage({ pagina: '9' });
    expect(page).toContain(copy.emptyNoProducts);
    expect(page).not.toContain(copy.pastLastLink);
  });
});

describe('paging (AC 20, L2, L9, L10)', () => {
  const total = ADMIN_PRODUCTS_PAGE_SIZE + 3;

  beforeEach(async () => {
    for (let n = 1; n <= total; n += 1) await insertProduct({ slug: `filtro-${n}`, title: `Filtro ${n}` });
  });

  it('page 1 has a full page, "Siguiente" and no "Anterior", and the links keep the term and the filter', async () => {
    const page = await listPage({ q: 'filtro' });
    expect(rowsOf(page)).toHaveLength(ADMIN_PRODUCTS_PAGE_SIZE);
    expect(page).toContain('data-testid="pagination"');
    expect(page).toContain('Página 1 de 2');
    expect(page).not.toContain('data-testid="pagination-prev"');
    expect(page).toMatch(/<a href="\/admin\/productos\?q=filtro&amp;pagina=2"[^>]*data-testid="pagination-next"/);
    expect(page).toContain(`<span>${total} productos para «filtro»</span>`);
  });

  it('the last page has the rest, "Anterior" back to the clean first page and no "Siguiente"', async () => {
    const page = await listPage({ q: 'filtro', pagina: '2' });
    expect(rowsOf(page)).toHaveLength(3);
    expect(page).toContain('Página 2 de 2');
    expect(page).not.toContain('data-testid="pagination-next"');
    expect(page).toMatch(/<a href="\/admin\/productos\?q=filtro"[^>]*data-testid="pagination-prev"/);
  });

  it('a product opened from page 2 carries the term and the page, so its way back lands on the same list', async () => {
    const page = await listPage({ q: 'filtro', pagina: '2' });
    expect(page).toMatch(/href="\/admin\/productos\/\d+\?q=filtro&amp;pagina=2"/);
  });

  it('a page past the last is an in-page state with the page count, a link to page 1, no rows and no pager', async () => {
    const page = await listPage({ pagina: '3' });
    expect(page).toContain('data-testid="products-empty"');
    expect(page).toContain('Esta página no existe: la lista tiene 2 páginas.');
    expect(page).toMatch(/<a href="\/admin\/productos"[^>]*data-testid="products-empty-link">Ir a la primera página<\/a>/);
    expect(rowsOf(page)).toHaveLength(0);
    expect(page).not.toContain('data-testid="pagination"');
  });

  it('the first-page link of a past-last page keeps the term and the filter', async () => {
    const page = await listPage({ q: 'filtro', ocultos: '', pagina: '9' });
    expect(page).toMatch(/<a href="\/admin\/productos\?q=filtro"[^>]*data-testid="products-empty-link">/);
  });

  it('a page that is not a whole number above zero is page 1, with no message', async () => {
    for (const pagina of ['abc', '0', '-1', '1.5', '']) {
      const page = await listPage({ pagina });
      expect(rowsOf(page), pagina).toHaveLength(ADMIN_PRODUCTS_PAGE_SIZE);
      expect(page, pagina).toContain('Página 1 de 2');
      expect(page, pagina).not.toContain('data-testid="products-empty"');
    }
  });
});

describe('the product page (AC 22 to 25, P1 to P3, P9, P13 and P14)', () => {
  it('shows the way back, the title, the rule, the product box with its two facts, identifiers and one button', async () => {
    const product = await insertProduct({ slug: 'p-uno', title: 'Filtro de aceite', brand: 'Bosch', partNumber: 'OF-1', ean: '4047024000000' });
    const feed = await approvedFeed();
    await insertOffer({ productId: product.id, feedId: feed.feedId });

    const page = await productPage(product.id);

    expect(page).toMatch(new RegExp(`<a href="/admin/productos"[^>]*data-testid="product-back">${detail.backLink}</a>`));
    expect(page).toContain('>Filtro de aceite</h1>');
    expect(page).toContain(detail.intro);
    expect(page).toContain(`>${detail.productHeading}</h2>`);
    const box = page.slice(page.indexOf('data-testid="product-box"'), page.indexOf('data-testid="offers-section"'));
    expect(box).toContain(`>${copy.tagNotHidden}<`);
    expect(box).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowYes}</span>`));
    for (const value of ['Bosch', 'OF-1', '4047024000000', 'p-uno']) expect(box).toContain(`>${value}<`);
    expect(box.match(/<button/g)).toHaveLength(1);
    expect(box).toContain(`>${detail.hideProduct}</button>`);
    expect(box).toMatch(/<input type="hidden" name="target" value="hide"\/>/);
    expect(box).toMatch(new RegExp(`<input type="hidden" name="id" value="${product.id}"/>`));
    expect(box).toContain('role="status"');
    expect(box).not.toContain('data-testid="admin-error"');
  });

  it('a hidden product shows "Oculto", "En el sitio ahora: No" and the unhide button that names the opposite target', async () => {
    const product = await insertProduct({ slug: 'p-oculto', isHidden: true });
    const page = await productPage(product.id);
    expect(page).toContain(`>${copy.tagHidden}<`);
    expect(page).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowNo}</span>`));
    expect(page).toContain(`>${detail.unhideProduct}</button>`);
    expect(page).toMatch(/name="target" value="unhide"/);
  });

  it('lists every offer lowest price first, with shop, price, feed line, own tag, own button and its own accessible name', async () => {
    const product = await insertProduct({ slug: 'p-dos' });
    const dear = await approvedFeed('Tienda Cara');
    const cheap = await approvedFeed('Tienda Barata');
    const hiddenOffer = await insertOffer({ productId: product.id, feedId: dear.feedId, priceCents: 1390, isHidden: true });
    const liveOffer = await insertOffer({ productId: product.id, feedId: cheap.feedId, priceCents: 1250 });

    const page = await productPage(product.id);

    expect(page).toContain(`>${detail.offersHeading}</h2>`);
    expect(page).toMatch(/data-testid="offers-count">2 ofertas</);
    expect(page).toContain(detail.offersIntro);
    expect(page.split(detail.offersIntro)).toHaveLength(2);
    const offers = page.split('data-testid="offer-row"').slice(1);
    expect(offers).toHaveLength(2);

    expect(offers[0]).toContain('>Tienda Barata</h3>');
    expect(offers[0]).toContain(`>${formatEuroCents(1250)}<`);
    expect(offers[0]).toContain(`>Feed ${cheap.feedId}<`);
    expect(offers[0]).toContain(`>${copy.tagOfferNotHidden}<`);
    expect(offers[0]).toContain(`>${detail.hideOffer}</button>`);
    expect(offers[0]).toContain(`aria-label="Ocultar oferta de Tienda Barata, feed ${cheap.feedId}"`);
    expect(offers[0]).toMatch(new RegExp(`name="id" value="${liveOffer}"`));

    expect(offers[1]).toContain('>Tienda Cara</h3>');
    expect(offers[1]).toContain(`>${formatEuroCents(1390)}<`);
    expect(offers[1]).toContain(`>${copy.tagOfferHidden}<`);
    expect(offers[1]).toMatch(new RegExp(`${copy.publicNowLabel}</span> <span[^>]*>${copy.publicNowNo}</span>`));
    expect(offers[1]).toContain(`>${detail.unhideOffer}</button>`);
    expect(offers[1]).toContain(`aria-label="Dejar de ocultar oferta de Tienda Cara, feed ${dear.feedId}"`);
    expect(offers[1]).toMatch(new RegExp(`name="id" value="${hiddenOffer}"`));
    expect(offers[1]).toMatch(/name="target" value="unhide"/);
  });

  it('a product with no offers says so, draws no list, no offer control and not the independence sentence (P9)', async () => {
    const product = await insertProduct({ slug: 'p-sin-ofertas' });
    const page = await productPage(product.id);
    expect(page).toContain('data-testid="offers-count">Sin ofertas<');
    expect(page).toContain(detail.offersEmpty);
    expect(page).not.toContain('data-testid="offers-list"');
    expect(page).not.toContain(detail.offersIntro);
    expect(page.match(/<button/g)).toHaveLength(1);
  });

  it('holds no address anywhere: no offer link, no feed address, no link to the shop, no public page, no flag name (AC 24)', async () => {
    const product = await insertProduct({ slug: 'p-limpio' });
    const feed = await approvedFeed();
    await insertOffer({ productId: product.id, feedId: feed.feedId, url: 'https://affiliate.example/never-public' });
    const page = await productPage(product.id);
    expect(page).not.toContain('affiliate.example');
    expect(page).not.toMatch(/https?:/);
    expect(page).not.toContain('/go/');
    expect(page).not.toContain('/producto/');
    expect(page).not.toMatch(/isHidden|is_hidden/);
    expect(page).not.toMatch(/target="_blank"/);
  });

  it('puts a 120-character title and shop name in the h1 and the h3 as text, and the price after the shop', async () => {
    const title = `T${'x'.repeat(119)}`;
    const shop = `S${'y'.repeat(119)}`;
    const product = await insertProduct({ slug: 'p-largo', title });
    const feed = await approvedFeed(shop);
    await insertOffer({ productId: product.id, feedId: feed.feedId, priceCents: 123456 });
    const page = await productPage(product.id);
    expect(page).toContain(`>${title}</h1>`);
    expect(page).toContain(`>${shop}</h3>`);
    expect(page.indexOf(`>${formatEuroCents(123456)}<`)).toBeGreaterThan(page.indexOf(`>${shop}</h3>`));
    expect(formatEuroCents(123456)).toBe('1.234,56 €');
  });

  it('lists every offer of a product with many, with no pager (P14)', async () => {
    const product = await insertProduct({ slug: 'p-muchas' });
    const feed = await approvedFeed();
    for (let n = 0; n < 60; n += 1) await insertOffer({ productId: product.id, feedId: feed.feedId, priceCents: 1000 + n });
    const page = await productPage(product.id);
    expect(page.split('data-testid="offer-row"')).toHaveLength(61);
    expect(page).toContain('data-testid="offers-count">60 ofertas<');
    expect(page).not.toContain('data-testid="pagination"');
  });

  it('builds the way back from the list state in its own address: term, filter and page (AC 31)', async () => {
    const product = await insertProduct({ slug: 'p-uno' });
    const page = await productPage(product.id, { q: 'filtro', ocultos: '1', pagina: '2' });
    expect(page).toMatch(
      new RegExp(`<a href="/admin/productos\\?q=filtro&amp;ocultos=1&amp;pagina=2"[^>]*data-testid="product-back"`),
    );
    // A junk query is dropped by the same rule as the list's.
    const junk = await productPage(product.id, { q: 'x', pagina: 'abc', evil: 'https://evil.example' });
    expect(junk).toMatch(/<a href="\/admin\/productos\?q=x"[^>]*data-testid="product-back"/);
    expect(junk).not.toContain('evil.example');
  });
});

describe('a missing product is the admin not-found screen (AC 5, P10)', () => {
  it.each(['abc', '0', '-1', '1.5', '2147483648', '99999', '', 'no-existe'])('id %j', async (id) => {
    expect(await notFoundOf(() => productPage(id))).toBe(true);
  });
});

describe('both pages refuse an anonymous request before reading anything (guardrail 3, AC 1)', () => {
  beforeEach(() => {
    startRequest();
  });

  it('the list page, its metadata, the product page and its metadata redirect to sign-in with the session notice', async () => {
    const list = await import('@/app/admin/(shell)/productos/page');
    const one = await import('@/app/admin/(shell)/productos/[id]/page');
    const to = '/admin/acceso?aviso=sesion';
    expect(await redirectOf(() => list.default({ searchParams: Promise.resolve({}) }))).toBe(to);
    expect(await redirectOf(() => list.generateMetadata())).toBe(to);
    expect(
      await redirectOf(() => one.default({ params: Promise.resolve({ id: '1' }), searchParams: Promise.resolve({}) })),
    ).toBe(to);
    expect(await redirectOf(() => one.generateMetadata({ params: Promise.resolve({ id: '1' }) }))).toBe(to);
  });

  it('the product page reads nothing for an anonymous request, even for a product that exists', async () => {
    const product = await insertProduct({ slug: 'p-secreto', title: 'Titulo secreto' });
    const one = await import('@/app/admin/(shell)/productos/[id]/page');
    await expect(
      one.default({ params: Promise.resolve({ id: String(product.id) }), searchParams: Promise.resolve({}) }),
    ).rejects.toMatchObject({ digest: expect.stringContaining('/admin/acceso') });
  });
});

describe('the tab titles and the menu', () => {
  it('titles the list and a product by their copy, and a missing product as not found', async () => {
    const list = await import('@/app/admin/(shell)/productos/page');
    const one = await import('@/app/admin/(shell)/productos/[id]/page');
    const product = await insertProduct({ slug: 'p-titulo', title: 'Filtro de aceite' });
    const site = getSiteName();
    expect(await list.generateMetadata()).toEqual({ title: messages.Admin.Meta.productsTitle.replace('{siteName}', site) });
    expect(await one.generateMetadata({ params: Promise.resolve({ id: String(product.id) }) })).toEqual({
      title: messages.Admin.Meta.productTitle.replace('{title}', 'Filtro de aceite').replace('{siteName}', site),
    });
    expect(await one.generateMetadata({ params: Promise.resolve({ id: '999999' }) })).toEqual({
      title: messages.Admin.Meta.notFoundTitle.replace('{siteName}', site),
    });
  });

  it('links "Productos" in the admin menu to the list and leaves the review entry a placeholder (AC 7)', () => {
    const layout = readFileSync(path.resolve(process.cwd(), 'src/app/admin/(shell)/layout.tsx'), 'utf8');
    expect(layout).toMatch(/key: 'products', label: nav\('products'\), href: '\/admin\/productos'/);
    expect(layout).toMatch(/key: 'review', label: nav\('review'\) \}/);
  });
});
