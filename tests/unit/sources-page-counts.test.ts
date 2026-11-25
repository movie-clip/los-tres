import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdminFeed, AdminShop } from '@/server/admin/sources';

import { sourceRowOf } from '../support/source-rows';

// US-2.6 (T-2.6.3b), ACs 1 to 5, 28 (the shop line's prefix) and 29: the lines `/admin/tiendas` draws from the
// two counts, rendered from the real page module with a real translator and the reader replaced by a holder, so
// the states a database would need a thousand rows for (1.000 or more) are reached without one. The lines are
// the exact ones of 03-ux § States. The reader's own numbers are tests/integration/admin-sources-counts.test.ts;
// the notes beside the counts are admin-source-pages.test.ts.

const holder = vi.hoisted(() => ({ shops: [] as unknown[], failure: null as Error | null }));

vi.mock('@/server/admin/sources', () => ({
  listSourcesForAdmin: async () => {
    if (holder.failure) throw holder.failure;
    return holder.shops;
  },
  listNetworksForAdmin: async () => [],
}));
vi.mock('@/server/auth/guard', () => ({ requireAdminPage: async () => ({}) }));
vi.mock('@/app/admin/(shell)/tiendas/actions', () => ({
  setShopApprovalAction: vi.fn(),
  setFeedApprovalAction: vi.fn(),
}));
vi.mock('next-intl/server', async () => {
  const { createTranslator } = await import('use-intl/core');
  const all = (await import('../../messages/es-ES.json')).default;
  return {
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: 'es-ES', messages: all, namespace } as never) as unknown,
  };
});

beforeEach(() => {
  holder.shops = [];
  holder.failure = null;
});

let serial = 0;
function feed(o: Partial<AdminFeed> = {}): AdminFeed {
  serial += 1;
  return {
    id: serial,
    approved: true,
    demo: false,
    source: 'catalogue_file',
    networkId: null,
    networkName: null,
    offerCount: 0,
    onSiteOfferCount: 0,
    host: null,
    fileName: `archivo-${serial}.csv`,
    ...o,
  };
}

function shop(o: Partial<AdminShop> = {}): AdminShop {
  serial += 1;
  return {
    id: serial,
    name: `Tienda de prueba ${serial}`,
    slug: `tienda-de-prueba-${serial}`,
    approved: true,
    demo: false,
    offerCount: 0,
    onSiteOfferCount: 0,
    feeds: [],
    ...o,
  };
}

/** A shop whose counts are the sums of the feeds given, as the reader makes them. */
function shopOf(feeds: AdminFeed[], o: Partial<AdminShop> = {}): AdminShop {
  return shop({
    offerCount: feeds.reduce((sum, row) => sum + row.offerCount, 0),
    onSiteOfferCount: feeds.reduce((sum, row) => sum + row.onSiteOfferCount, 0),
    feeds,
    ...o,
  });
}

async function renderPage(shops: AdminShop[]): Promise<string> {
  holder.shops = shops;
  const { default: Page } = await import('@/app/admin/(shell)/tiendas/page');
  return renderToStaticMarkup((await Page({ searchParams: Promise.resolve({}) })) as never);
}

const metaOf = (page: string, kind: 'shop' | 'feed', id: number): string => sourceRowOf(page, kind, id).meta;

describe('the shop line and the feed line carry both counts, each with its words (AC 1, 3, 5)', () => {
  it('a shop with several feeds: feeds, offers, then the offers on the site now', async () => {
    const a = feed({ offerCount: 5, onSiteOfferCount: 3 });
    const b = feed({ offerCount: 3, onSiteOfferCount: 1 });
    const group = shopOf([a, b]);
    const page = await renderPage([group]);

    expect(metaOf(page, 'shop', group.id)).toBe('2 feeds · 8 ofertas · 4 en el sitio ahora');
    expect(metaOf(page, 'feed', a.id)).toBe('Archivo de catálogo · 5 ofertas · 3 en el sitio ahora');
    expect(metaOf(page, 'feed', b.id)).toBe('Archivo de catálogo · 3 ofertas · 1 en el sitio ahora');
  });

  it('exactly one offer on both: "oferta" in the singular, and the second count never has a plural of its own', async () => {
    const only = feed({ offerCount: 1, onSiteOfferCount: 1 });
    const group = shopOf([only]);
    const page = await renderPage([group]);

    expect(metaOf(page, 'shop', group.id)).toBe('1 feed · 1 oferta · 1 en el sitio ahora');
    expect(metaOf(page, 'feed', only.id)).toBe('Archivo de catálogo · 1 oferta · 1 en el sitio ahora');
  });

  it('zero is written, never blank, a dash or left out: a new shop and a feed with nothing imported', async () => {
    const bare = feed();
    const withFeed = shopOf([bare]);
    const none = shop();
    const page = await renderPage([withFeed, none]);

    expect(metaOf(page, 'shop', none.id)).toBe('Sin feeds · 0 ofertas · 0 en el sitio ahora');
    expect(metaOf(page, 'feed', bare.id)).toBe('Archivo de catálogo · 0 ofertas · 0 en el sitio ahora');
    expect(metaOf(page, 'shop', withFeed.id)).toBe('1 feed · 0 ofertas · 0 en el sitio ahora');
    expect(page).toContain('data-testid="shop-no-feeds"');
  });

  it('a second count of 0 beside a first count above 0 reads as a fact, with no word of its own for the cause', async () => {
    const waiting = feed({ offerCount: 8, onSiteOfferCount: 0 });
    const group = shopOf([waiting], { approved: false });
    const page = await renderPage([group]);

    expect(metaOf(page, 'feed', waiting.id)).toBe('Archivo de catálogo · 8 ofertas · 0 en el sitio ahora');
    expect(metaOf(page, 'shop', group.id)).toBe('1 feed · 8 ofertas · 0 en el sitio ahora');
  });

  it.each([
    ['affiliate network', { source: 'affiliate_network', networkId: 1, networkName: 'Awin', fileName: null } as const, 'Red: Awin'],
    ['shop upload', { source: 'shop_upload', fileName: null } as const, 'Subido por la tienda'],
    ['collected file', { source: 'collected_file' } as const, 'Archivo recopilado (solo local)'],
  ])('a %s feed keeps its source label first and both counts after it', async (_label, source, label) => {
    const row = feed({ ...source, offerCount: 40, onSiteOfferCount: 0 });
    const page = await renderPage([shopOf([row])]);
    expect(metaOf(page, 'feed', row.id)).toBe(`${label} · 40 ofertas · 0 en el sitio ahora`);
  });

  it('a feed with no source label reads the two counts alone', async () => {
    const row = feed({ source: 'affiliate_network', networkId: null, networkName: null, fileName: null, offerCount: 2, onSiteOfferCount: 2 });
    const page = await renderPage([shopOf([row])]);
    expect(metaOf(page, 'feed', row.id)).toBe('2 ofertas · 2 en el sitio ahora');
  });

  it('the labels are words in the page text, not an attribute only (AC 5)', async () => {
    const row = feed({ offerCount: 4, onSiteOfferCount: 2 });
    const page = await renderPage([shopOf([row])]);
    expect(page).toContain('>Archivo de catálogo · 4 ofertas · 2 en el sitio ahora</span>');
    for (const attribute of ['title', 'aria-label', 'alt']) {
      expect(page, attribute).not.toMatch(new RegExp(`${attribute}="[^"]*en el sitio ahora`));
    }
  });
});

describe('a count of 1.000 or more carries its thousands separator, on both counts (AC 4)', () => {
  it('writes 1.234 and 1.000, never 1234 or 1000', async () => {
    const big = feed({ offerCount: 1234, onSiteOfferCount: 1000 });
    const group = shopOf([big, feed(), feed()]);
    const page = await renderPage([group]);

    expect(metaOf(page, 'shop', group.id)).toBe('3 feeds · 1.234 ofertas · 1.000 en el sitio ahora');
    expect(metaOf(page, 'feed', big.id)).toBe('Archivo de catálogo · 1.234 ofertas · 1.000 en el sitio ahora');
    expect(page).not.toMatch(/(^|\D)1234(\D|$)/);
    expect(page).not.toMatch(/(^|\D)1000(\D|$)/);
  });

  it('the longest line, with millions on both counts, is whole and separated', async () => {
    const huge = feed({ source: 'collected_file', offerCount: 1_234_567, onSiteOfferCount: 1_234_567 });
    const page = await renderPage([shopOf([huge])]);
    expect(metaOf(page, 'feed', huge.id)).toBe('Archivo recopilado (solo local) · 1.234.567 ofertas · 1.234.567 en el sitio ahora');
  });

  it('999 stays without a separator', async () => {
    const edge = feed({ offerCount: 999, onSiteOfferCount: 999 });
    const page = await renderPage([shopOf([edge])]);
    expect(metaOf(page, 'feed', edge.id)).toBe('Archivo de catálogo · 999 ofertas · 999 en el sitio ahora');
  });
});

describe('the shop line keeps "N feeds · N ofertas" first and contiguous (AC 28)', () => {
  it.each([
    ['no feed', shopOf([])],
    ['one feed', shopOf([feed({ offerCount: 1, onSiteOfferCount: 1 })])],
    ['many feeds and offers', shopOf([feed({ offerCount: 1500, onSiteOfferCount: 2 }), feed({ offerCount: 7, onSiteOfferCount: 7 })])],
  ])('%s: the unanchored pattern of the e2e smoke still matches', async (_label, group) => {
    const page = await renderPage([group]);
    // The pattern of tests/e2e/admin-smoke.spec.ts: a count of feeds, " · ", a count of offers.
    expect(metaOf(page, 'shop', group.id)).toMatch(/(Sin feeds|\d+ feeds?) · [\d.]+ ofertas?/);
    // The second count follows, last on the line.
    expect(metaOf(page, 'shop', group.id)).toMatch(/ · [\d.]+ ofertas? · [\d.]+ en el sitio ahora$/);
  });
});

describe('a read that fails is the existing error screen, never a count (AC 29)', () => {
  it('rejects with the reader\'s own error and renders no partial counts, no zero', async () => {
    holder.failure = Object.assign(new Error('sources: failed'), { code: '57P01' });
    holder.shops = [shopOf([feed({ offerCount: 3, onSiteOfferCount: 3 })])];
    const { default: Page } = await import('@/app/admin/(shell)/tiendas/page');

    await expect(Page({ searchParams: Promise.resolve({}) })).rejects.toBe(holder.failure);
  });
});
