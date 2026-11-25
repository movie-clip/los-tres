import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, networks, shops } from '@/db/schema';
import { readProductForAdmin } from '@/server/admin/products';
import { setFeedApproval } from '@/server/admin/sources';
import { seedDemoData } from '@/server/seed';

import messages from '../../messages/es-ES.json';
import { DEMO_COUNTS } from '../fixtures/demo';
import { SITE_ORIGIN, createAdmin, signInForCookie } from '../support/admin';
import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { startAdminRequest } from '../support/next-request';
import { sourceRowOf } from '../support/source-rows';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// US-3.1 / T3.1.3, ACs 6, 9, 13, 18, 21, 26, 37 and 38 on the server-rendered pages: the
// sources list and the six form routes, rendered from the real page modules with a real
// translator, so the markup is what the browser's first response carries.

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

const copy = messages.Admin.Sources;
const form = messages.Admin.Form;

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

const html = (element: unknown) => renderToStaticMarkup(element as never);
const noSearch = Promise.resolve({});

async function sourcesPage(searchParams: Record<string, string | string[] | undefined> = {}) {
  const { default: Page } = await import('@/app/admin/(shell)/tiendas/page');
  return html(await Page({ searchParams: Promise.resolve(searchParams) }));
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

let networkCount = 0;
async function aNetwork(name = 'Red Uno', slug = `red-uno-${(networkCount += 1)}`): Promise<number> {
  const [row] = await getDb().insert(networks).values({ name, slug }).returning({ id: networks.id });
  return row.id;
}

describe('the list page with nothing in it (AC 38)', () => {
  it('renders an empty message for the shops and the networks, each with its create control, and no list', async () => {
    const page = await sourcesPage();
    expect(page).toContain(copy.heading);
    expect(page).toContain('data-testid="shops-empty"');
    expect(page).toContain(copy.shopsEmpty);
    expect(page).toContain('data-testid="networks-empty"');
    expect(page).toContain(copy.networksEmpty);
    expect(page).not.toContain('data-testid="sources-list"');
    expect(page).not.toContain('data-testid="networks-list"');
    for (const [id, href, label] of [
      ['add-shop', '/admin/tiendas/tienda/nueva', copy.addShop],
      ['add-feed', '/admin/tiendas/feed/nuevo', copy.addFeed],
      ['add-network', '/admin/tiendas/red/nueva', copy.addNetwork],
    ]) {
      expect(page, id).toMatch(new RegExp(`<a href="${href}"[^>]*data-testid="${id}">${label}</a>`));
    }
    expect(page).toContain('Sin redes');
  });

  it('a shop with no feed shows its own empty line and both of its links', async () => {
    const shop = await insertShop({ name: 'Sin feeds', isApproved: false });
    const page = await sourcesPage();
    expect(page).toContain('data-testid="shop-no-feeds"');
    expect(page).toContain(copy.shopNoFeeds);
    expect(page).toContain(`/admin/tiendas/tienda/${shop.id}/editar`);
    expect(page).toContain(`/admin/tiendas/feed/nuevo?tienda=${shop.id}`);
  });
});

describe('the notice after a save (AC 43)', () => {
  it.each([
    ['red-creada', copy.noticeNetworkCreated],
    ['red-guardada', copy.noticeNetworkSaved],
    ['tienda-creada', copy.noticeShopCreated],
    ['tienda-guardada', copy.noticeShopSaved],
    ['feed-creado', copy.noticeFeedCreated],
    ['feed-guardado', copy.noticeFeedSaved],
    ['feed-sin-aprobar', copy.noticeFeedUnapproved],
  ])('?aviso=%s shows its fixed text under the heading', async (key, text) => {
    const page = await sourcesPage({ aviso: key });
    expect(page).toContain('data-testid="admin-notice"');
    expect(page).toContain(text);
    expect(page.indexOf('data-testid="admin-notice"')).toBeGreaterThan(page.indexOf('<h1'));
  });

  it('any other value, an empty one or an injected one shows no notice and echoes nothing', async () => {
    for (const aviso of ['', 'otro', 'Red-creada', '<script>alert(1)</script>', 'https://evil.example']) {
      const page = await sourcesPage({ aviso });
      expect(page, aviso).not.toContain('data-testid="admin-notice"');
      expect(page, aviso).not.toContain('evil.example');
      expect(page, aviso).not.toContain('alert(1)');
    }
  });

  it('takes the first of a repeated parameter', async () => {
    expect(await sourcesPage({ aviso: ['red-guardada', 'feed-creado'] })).toContain(copy.noticeNetworkSaved);
  });
});

describe('the seeded page marks the demo rows and offers no delete (AC 34, 35)', () => {
  it('shows the Demo mark on the demo shops, feeds and network, and no delete control or link anywhere', async () => {
    await seedDemoData(getDb());
    const page = await sourcesPage();
    // The demo shops, their feeds and the demo network.
    expect(page.match(/data-testid="demo-mark"/g)).toHaveLength(DEMO_COUNTS.shops + DEMO_COUNTS.feeds + 1);
    expect(page).toContain(`>${copy.demoMark}<`);
    expect(page).toContain(copy.domainNone);
    expect(page).not.toMatch(/(eliminar|borrar|quitar|suprimir|delete|remove)/i);
    expect(page).not.toMatch(/href="[^"]*(eliminar|borrar|delete|remove)/i);
  });
});

describe('the network and shop forms (AC 9, 13, 26, 41)', () => {
  it('the create forms have a visible label per field, the slug hint, and the cancel and submit controls', async () => {
    const { default: NewNetwork } = await import('@/app/admin/(shell)/tiendas/red/nueva/page');
    const { default: NewShop } = await import('@/app/admin/(shell)/tiendas/tienda/nueva/page');
    for (const [element, hint, submit] of [
      [await NewNetwork(), form.slugHintNetwork, form.Network.submitNew],
      [await NewShop(), form.slugHintShop, form.Shop.submitNew],
    ] as const) {
      const page = html(element);
      expect(page).toMatch(new RegExp(`<label for="source-name"[^>]*>${form.nameLabel}</label>`));
      expect(page).toMatch(new RegExp(`<label for="source-slug"[^>]*>${form.slugLabel.replace(/[()]/g, '\\$&')}</label>`));
      expect(page).toContain(hint);
      expect(page).not.toContain('name="id"');
      expect(page).toContain(`>${submit}<`);
      expect(page).toContain('data-testid="form-cancel"');
    }
  });

  it('the edit forms show the stored name and the slug as text with no control for it', async () => {
    const networkId = await aNetwork('Red Fija', 'red-fija');
    const shop = await insertShop({ name: 'Tienda Fija', slug: 'tienda-fija' });
    const { default: EditNetwork } = await import('@/app/admin/(shell)/tiendas/red/[id]/editar/page');
    const { default: EditShop } = await import('@/app/admin/(shell)/tiendas/tienda/[id]/editar/page');
    for (const [element, name, slug, id] of [
      [await EditNetwork({ params: Promise.resolve({ id: String(networkId) }) }), 'Red Fija', 'red-fija', networkId],
      [await EditShop({ params: Promise.resolve({ id: String(shop.id) }) }), 'Tienda Fija', 'tienda-fija', shop.id],
    ] as const) {
      const page = html(element);
      expect(page).toMatch(new RegExp(`<input[^>]*name="name"[^>]*value="${name}"|<input[^>]*value="${name}"[^>]*name="name"`));
      expect(page).toContain('data-testid="source-slug-fixed"');
      expect(page).toContain(slug);
      expect(page).toContain(form.slugFixedHint);
      expect(page).not.toMatch(/name="slug"/);
      expect(page).not.toContain('id="source-slug"');
      expect(page).toMatch(new RegExp(`<input type="hidden" name="id" value="${id}"`));
    }
  });

  it('a malformed, absent or unknown id is the admin not-found screen on every edit route', async () => {
    const { default: EditNetwork } = await import('@/app/admin/(shell)/tiendas/red/[id]/editar/page');
    const { default: EditShop } = await import('@/app/admin/(shell)/tiendas/tienda/[id]/editar/page');
    const { default: EditFeed } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');
    for (const Page of [EditNetwork, EditShop, EditFeed]) {
      for (const id of ['abc', '0', '-1', '1.5', '2147483648', '2000000000', '99999', '']) {
        expect(await notFoundOf(() => Page({ params: Promise.resolve({ id }) })), `${Page.name} ${id}`).toBe(true);
      }
    }
  });

  it('a shop upload feed has no edit form: its id is not found', async () => {
    const shop = await insertShop();
    const [upload] = await getDb()
      .insert(feeds)
      .values({ shopId: shop.id, sourceType: 'shop_upload', url: 'upload.csv', isApproved: false, isDemo: false })
      .returning({ id: feeds.id });
    const { default: EditFeed } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');
    expect(await notFoundOf(() => EditFeed({ params: Promise.resolve({ id: String(upload.id) }) }))).toBe(true);
    // And the list offers no edit link for it.
    const page = await sourcesPage();
    expect(page).not.toContain(`/admin/tiendas/feed/${upload.id}/editar`);
    expect(page).toContain(copy.domainUnavailable);
    expect(page).not.toContain('upload.csv');
  });
});

describe('the feed create form (AC 15, 38, 41)', () => {
  async function newFeed(searchParams: Record<string, string | string[] | undefined> = {}) {
    const { default: Page } = await import('@/app/admin/(shell)/tiendas/feed/nuevo/page');
    return html(await Page({ searchParams: Promise.resolve(searchParams) }));
  }

  it('with no shop it says a shop is missing, links to create one and shows no select and no submit', async () => {
    const page = await newFeed();
    expect(page).toContain('data-testid="missing-shop"');
    expect(page).toContain(form.Feed.missingShopBody);
    expect(page).toContain('href="/admin/tiendas/tienda/nueva"');
    // A missing network no longer blocks the screen (S3.7): it is told inside the form, for the https source only.
    expect(page).not.toContain('data-testid="missing-network"');
    expect(page).not.toContain('<select');
    expect(page).not.toContain('data-testid="form-submit"');
    expect(page).toContain('data-testid="form-back-button"');
  });

  it('with a shop and no network the form opens on the file source, with no network field and a submit (S3.7)', async () => {
    await insertShop();
    const page = await newFeed();
    expect(page).not.toContain('data-testid="missing-shop"');
    expect(page).not.toContain('data-testid="missing-network"');
    expect(page).toContain('name="source"');
    expect(page).toMatch(new RegExp(`<option value="catalogue_file" selected="">${form.Feed.sourceOptionFile}</option>`));
    expect(page).toMatch(new RegExp(`<label for="source-file"[^>]*>${form.Feed.fileLabel}</label>`));
    expect(page).not.toContain('name="networkId"');
    expect(page).not.toContain('name="url"');
    expect(page).toContain('data-testid="form-submit"');
  });

  it('with a network and no shop only the shop is missing', async () => {
    await aNetwork();
    const page = await newFeed();
    expect(page).toContain('data-testid="missing-shop"');
    expect(page).not.toContain('data-testid="missing-network"');
  });

  it('with both, opens on the https source: the shop and network selects with their prompts and the empty address field', async () => {
    await insertShop({ name: 'Mi tienda' });
    await aNetwork('Mi red', 'mi-red');
    const page = await newFeed();
    expect(page).toContain(`<option value="" selected="">${form.Feed.shopPrompt}</option>`);
    expect(page).toContain(`<option value="" selected="">${form.Feed.networkPrompt}</option>`);
    expect(page).toMatch(new RegExp(`<label for="source-shop"[^>]*>${form.Feed.shopLabel}</label>`));
    expect(page).toMatch(new RegExp(`<label for="source-network"[^>]*>${form.Feed.networkLabel}</label>`));
    expect(page).toMatch(new RegExp(`<label for="source-address"[^>]*>${form.Feed.urlLabelNew}</label>`));
    expect(page).toContain(form.Feed.urlHintNew);
    expect(page).toContain(`>${form.Feed.submitNew}<`);
  });

  it('?tienda= preselects that shop, and an unknown or malformed one preselects nothing', async () => {
    const one = await insertShop({ name: 'Una' });
    const two = await insertShop({ name: 'Dos' });
    await aNetwork();
    expect(await newFeed({ tienda: String(two.id) })).toContain(`<option value="${two.id}" selected="">Dos</option>`);
    expect(await newFeed({ tienda: String(one.id) })).toContain(`<option value="${one.id}" selected="">Una</option>`);
    for (const tienda of ['99999', 'abc', '0', '']) {
      const page = await newFeed({ tienda });
      expect(page, tienda).toContain(`<option value="" selected="">${form.Feed.shopPrompt}</option>`);
    }
  });

  it('names a demo shop and a demo network as such in the choices', async () => {
    await seedDemoData(getDb());
    await insertShop({ name: 'Real' });
    const page = await newFeed();
    expect(page).toContain('Tienda Demo Uno (demostración)');
    expect(page).toContain('(demostración)</option>');
    expect(page).toContain('>Real</option>');
  });
});

describe('the feed edit form (AC 18, 21, 22, 26)', () => {
  async function editPage(feedId: number) {
    const { default: Page } = await import('@/app/admin/(shell)/tiendas/feed/[id]/editar/page');
    return html(await Page({ params: Promise.resolve({ id: String(feedId) }) }));
  }
  async function aFeed(approved: boolean) {
    const shop = await insertShop({ name: 'Tienda de edición' });
    const networkId = await aNetwork();
    const [feed] = await getDb()
      .insert(feeds)
      .values({
        shopId: shop.id,
        networkId,
        sourceType: 'affiliate_network',
        url: 'https://feeds.example/f.csv',
        isApproved: false,
        isDemo: false,
      })
      .returning({ id: feeds.id });
    if (approved) await setFeedApproval(feed.id, true);
    return feed.id;
  }

  it('shows the shop as text, the network as a select, the host and an empty address field with its hint', async () => {
    const id = await aFeed(false);
    const page = await editPage(id);
    expect(page).toContain('data-testid="source-shop-fixed"');
    expect(page).toContain('Tienda de edición');
    expect(page).not.toContain('name="shopId"');
    expect(page).toContain('name="networkId"');
    expect(page).toContain(`${form.Feed.currentDomainLabel}`);
    expect(page).toContain('feeds.example');
    expect(page).toContain(form.Feed.urlHintEdit);
    expect(page).toContain(`<h1`);
    expect(page).toContain(form.Feed.headingEdit.replace('{id}', String(id)));
  });

  it('an approved feed carries the warning above the address field, an unapproved one carries none (AC 21)', async () => {
    const approved = await editPage(await aFeed(true));
    expect(approved).toContain('data-testid="feed-warning"');
    expect(approved).toContain(form.Feed.warningBody);
    expect(approved.indexOf('feed-warning')).toBeLessThan(approved.indexOf('name="url"'));
    expect(approved).toContain('aria-describedby="feed-warning');

    const unapproved = await editPage(await aFeed(false));
    expect(unapproved).not.toContain('data-testid="feed-warning"');
  });

  it('a demo feed offers no address field, only the hint, and its network stays a choice (AC 22, D-13)', async () => {
    await seedDemoData(getDb());
    const [demo] = await getDb().select().from(feeds).orderBy(feeds.id);
    const page = await editPage(demo.id);
    expect(page).not.toMatch(/name="url"/);
    expect(page).toContain('data-testid="feed-demo-hint"');
    expect(page).toContain(form.Feed.demoUrlHint);
    expect(page).toContain('name="networkId"');
    expect(page).toContain(copy.domainNone);
    expect(page).not.toContain('data-testid="feed-warning"');
  });
});

describe('the shops table is untouched by a page render', () => {
  it('rendering every page writes nothing', async () => {
    await seedDemoData(getDb());
    const before = {
      shops: await getDb().select().from(shops).orderBy(shops.id),
      feeds: await getDb().select().from(feeds).orderBy(feeds.id),
    };
    await sourcesPage();
    const { default: NewFeed } = await import('@/app/admin/(shell)/tiendas/feed/nuevo/page');
    await NewFeed({ searchParams: noSearch });
    expect({
      shops: await getDb().select().from(shops).orderBy(shops.id),
      feeds: await getDb().select().from(feeds).orderBy(feeds.id),
    }).toEqual(before);
  });
});

// US-2.6 (T-2.6.3b), ACs 1, 3, 20 to 22: the real page over the real reader, the lines and the paused notes. The
// exact lines for 0, 1, many and 1.000 or more are tests/unit/sources-page-counts.test.ts (the reader replaced);
// here the numbers come from stored rows, and each note is compared with the S2.5 reason of the offer it speaks of.

describe('a real read draws both counts on the shop line and the feed line (AC 1, 3)', () => {
  it('a feed with a hidden offer reads three offers and two on the site, and its shop the same', async () => {
    const shop = await insertShop({ name: 'Tienda con oferta oculta' });
    const feedId = await insertFeed(shop.id);
    for (const [slug, hidden] of [['linea-uno', false], ['linea-dos', false], ['linea-tres', true]] as const) {
      const product = await insertProduct({ slug });
      await insertOffer({ productId: product.id, feedId, isHidden: hidden });
    }

    const page = await sourcesPage();

    expect(sourceRowOf(page, 'feed', feedId).meta).toMatch(/ · 3 ofertas · 2 en el sitio ahora$/);
    expect(sourceRowOf(page, 'shop', shop.id).meta).toBe('1 feed · 3 ofertas · 2 en el sitio ahora');
  });

  it('a shop with no feed and a feed with no offer read 0 and 0 in words', async () => {
    const bare = await insertShop({ name: 'Tienda sin feeds' });
    const withFeed = await insertShop({ name: 'Tienda con feed vacío' });
    const feedId = await insertFeed(withFeed.id);

    const page = await sourcesPage();

    expect(sourceRowOf(page, 'shop', bare.id).meta).toBe('Sin feeds · 0 ofertas · 0 en el sitio ahora');
    expect(sourceRowOf(page, 'feed', feedId).meta).toMatch(/ · 0 ofertas · 0 en el sitio ahora$/);
  });
});

describe('the paused notes agree with the shared rule and with the second count (S2.6, ACs 20 to 22)', () => {
  // The offer reason a note speaks of (S2.5): the two notes about the shop name its approval, the one about the feeds
  // names the feeds' approval.
  const REASON_OF_NOTE: Record<string, string> = {
    [copy.shopNotePaused]: 'offer_shop_not_approved',
    [copy.feedNotePaused]: 'offer_shop_not_approved',
    [copy.shopNoteNoApprovedFeed]: 'offer_feed_not_approved',
  };

  async function offerOf(feedId: number, slug: string) {
    const product = await insertProduct({ slug });
    const offerId = await insertOffer({ productId: product.id, feedId });
    return { productId: product.id, offerId };
  }

  async function reasonOf(productId: number, offerId: number): Promise<string | null> {
    const detail = await readProductForAdmin(productId);
    return detail?.offers.find((offer) => offer.id === offerId)?.reason ?? null;
  }

  it.each([
    [true, true],
    [true, false],
    [false, true],
    [false, false],
  ])('shop approved %s, feed approved %s: each note as before, agreeing with the offer reason and the second count', async (shopApproved, feedApproved) => {
    const shop = await insertShop({ isApproved: shopApproved });
    const feedId = await insertFeed(shop.id, { isApproved: feedApproved });
    const { productId, offerId } = await offerOf(feedId, `nota-${Number(shopApproved)}-${Number(feedApproved)}`);

    const page = await sourcesPage();
    const shopRow = sourceRowOf(page, 'shop', shop.id);
    const feedRow = sourceRowOf(page, 'feed', feedId);

    // AC 20: the conditions of the notes, as the story states them.
    expect(feedRow.note).toBe(feedApproved && !shopApproved ? copy.feedNotePaused : null);
    expect(shopRow.note).toBe(
      !shopApproved
        ? feedApproved
          ? copy.shopNotePaused
          : null
        : !feedApproved
          ? copy.shopNoteNoApprovedFeed
          : null,
    );

    // AC 21: wherever a note says why, the offer reads that reason on /admin/productos/[id].
    const reason = await reasonOf(productId, offerId);
    for (const note of [shopRow.note, feedRow.note]) {
      if (note !== null) expect(reason, note).toBe(REASON_OF_NOTE[note]);
    }

    // AC 22: a row whose note says its offers are not shown reads 0 on the site; the first count is untouched.
    const live = shopApproved && feedApproved;
    expect(reason === null).toBe(live);
    for (const row of [shopRow, feedRow]) {
      expect(row.meta).toMatch(live ? / · 1 ofertas? · 1 en el sitio ahora$/ : / · 1 ofertas? · 0 en el sitio ahora$/);
      if (row.note !== null) expect(row.meta).toMatch(/ · 0 en el sitio ahora$/);
    }
  });

  it('a shop not approved with one approved feed and one not: the shop note and the approved feed note only, 0 on every line', async () => {
    const shop = await insertShop({ isApproved: false });
    const approved = await insertFeed(shop.id, { isApproved: true });
    const unapproved = await insertFeed(shop.id, { isApproved: false });
    const first = await offerOf(approved, 'nota-dos-feeds-a');
    const second = await offerOf(unapproved, 'nota-dos-feeds-b');

    const page = await sourcesPage();

    expect(sourceRowOf(page, 'shop', shop.id).note).toBe(copy.shopNotePaused);
    expect(sourceRowOf(page, 'feed', approved).note).toBe(copy.feedNotePaused);
    expect(sourceRowOf(page, 'feed', unapproved).note).toBeNull();
    expect(await reasonOf(first.productId, first.offerId)).toBe('offer_shop_not_approved');
    expect(await reasonOf(second.productId, second.offerId)).toBe('offer_shop_not_approved');
    for (const row of [sourceRowOf(page, 'shop', shop.id), sourceRowOf(page, 'feed', approved), sourceRowOf(page, 'feed', unapproved)]) {
      expect(row.meta).toMatch(/ en el sitio ahora$/);
      expect(row.meta).toMatch(/ · 0 en el sitio ahora$/);
    }
  });

  it('an approved shop whose feeds are all not approved says so, and its offers read the feed reason', async () => {
    const shop = await insertShop();
    const one = await insertFeed(shop.id, { isApproved: false });
    const two = await insertFeed(shop.id, { isApproved: false });
    const first = await offerOf(one, 'nota-sin-feed-a');
    const second = await offerOf(two, 'nota-sin-feed-b');

    const page = await sourcesPage();

    expect(sourceRowOf(page, 'shop', shop.id).note).toBe(copy.shopNoteNoApprovedFeed);
    expect(sourceRowOf(page, 'feed', one).note).toBeNull();
    expect(sourceRowOf(page, 'feed', two).note).toBeNull();
    expect(await reasonOf(first.productId, first.offerId)).toBe('offer_feed_not_approved');
    expect(await reasonOf(second.productId, second.offerId)).toBe('offer_feed_not_approved');
    expect(sourceRowOf(page, 'shop', shop.id).meta).toMatch(/ · 2 ofertas · 0 en el sitio ahora$/);
  });

  it('a shop with no feed has no note, and an approved one with an approved feed has none either', async () => {
    const bare = await insertShop();
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    await offerOf(feedId, 'nota-ninguna');

    const page = await sourcesPage();

    expect(sourceRowOf(page, 'shop', bare.id).note).toBeNull();
    expect(sourceRowOf(page, 'shop', shop.id).note).toBeNull();
    expect(sourceRowOf(page, 'feed', feedId).note).toBeNull();
  });
});
