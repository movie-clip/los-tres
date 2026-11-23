import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GET as getFile } from '@/app/(public)/sitemaps/[file]/route';
import { closeDb } from '@/db/client';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';

import { SITE_ORIGIN, createAdmin, signInForCookie } from '../support/admin';
import { insertCategory, insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { allClicks, callGo } from '../support/go';
import { allRows } from '../support/hide';
import { startAdminRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// US-2.4 AC 62: opening either admin product screen writes nothing and changes no public page, sitemap
// file or /go answer. The two pages are the real page modules, rendered as a signed-in admin.

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

async function productPage(id: number, searchParams: Query = {}) {
  const { default: Page } = await import('@/app/admin/(shell)/productos/[id]/page');
  return html(await Page({ params: Promise.resolve({ id: String(id) }), searchParams: Promise.resolve(searchParams) }));
}

async function sitemapFile(file: string): Promise<{ status: number; body: string }> {
  const response = await getFile(new Request(`${SITE_ORIGIN}/sitemaps/${file}`), { params: Promise.resolve({ file }) });
  return { status: response.status, body: await response.text() };
}

/** What the public sees: the product page, both sitemap files and /go of each offer (status and target). */
async function publicView(slug: string, offerIds: number[]) {
  const go: { status: number; location: string | null }[] = [];
  for (const id of offerIds) {
    const response = await callGo(id);
    go.push({ status: response.status, location: response.headers.get('location') });
  }
  return {
    page: await getPublicProductBySlug(slug),
    pages: await sitemapFile('paginas.xml'),
    products: await sitemapFile('productos-1.xml'),
    go,
  };
}

describe('opening the admin product screens is read only (AC 62)', () => {
  it('changes no row and no public answer: the list (every state it has) and the product page', async () => {
    const category = await insertCategory({ slug: 'filtros' });
    const feedA = await insertFeed((await insertShop({ name: 'Tienda A' })).id);
    const feedB = await insertFeed((await insertShop({ name: 'Tienda B' })).id);
    const visible = await insertProduct({ slug: 'visible', title: 'Filtro visible', categoryId: category.id });
    const offerA = await insertOffer({ productId: visible.id, feedId: feedA, priceCents: 1000 });
    const offerB = await insertOffer({ productId: visible.id, feedId: feedB, priceCents: 2000, isHidden: true });
    const hidden = await insertProduct({ slug: 'oculto', title: 'Filtro oculto', isHidden: true });
    await insertOffer({ productId: hidden.id, feedId: feedA });
    await insertProduct({ slug: 'sin-oferta' });

    const before = await allRows();
    const clicksBefore = (await allClicks()).length;
    const publicBefore = await publicView('visible', [offerA, offerB]);
    // Non-vacuous: the public side has something to compare.
    expect(publicBefore.page?.offers).toHaveLength(1);
    expect(publicBefore.products.body).toContain('visible');
    expect(publicBefore.go.map((answer) => answer.status)).toEqual([302, 404]);
    const clicksAfterBaseline = (await allClicks()).length;
    expect(clicksAfterBaseline).toBeGreaterThan(clicksBefore);
    const rowsAfterBaseline = await allRows();

    const opened = [
      await listPage(),
      await listPage({ q: 'filtro' }),
      await listPage({ q: 'zzz-sin-coincidencia' }),
      await listPage({ ocultos: '1' }),
      await listPage({ q: 'oculto', ocultos: '1' }),
      await listPage({ pagina: '99' }),
      await productPage(visible.id),
      await productPage(visible.id, { q: 'filtro', ocultos: '1', pagina: '2' }),
      await productPage(hidden.id),
    ];
    // Each page rendered real content, so the comparison below is not over empty renders.
    for (const page of opened) expect(page.length).toBeGreaterThan(200);
    expect(opened[6]).toContain('Filtro visible');

    expect(await allRows()).toEqual(rowsAfterBaseline);
    expect(rowsAfterBaseline.clicks).toHaveLength(clicksAfterBaseline);
    // The public answers, taken again after the opens, are the same (the /go calls above added their own click rows).
    const publicAfter = await publicView('visible', [offerA, offerB]);
    expect(publicAfter).toEqual(publicBefore);
    // Neither screen changed any row beyond what the public readers' own clicks wrote.
    expect({ ...(await allRows()), clicks: [] }).toEqual({ ...rowsAfterBaseline, clicks: [] });
    // `before` is kept to show the seed rows were all there at the start.
    expect(before.products).toHaveLength(3);
  });
});
