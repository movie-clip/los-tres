import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setFeedApprovalAction,
  setShopApprovalAction,
  type SourceActionState,
} from '@/app/admin/(shell)/tiendas/actions';
import { closeDb, getDb } from '@/db/client';
import { feeds, networks, shops } from '@/db/schema';
import { listSourcesForAdmin, setFeedApproval, setShopApproval } from '@/server/admin/sources';
import { getPublicProductBySlug } from '@/server/catalogue/product-page';
import { getSitemapProductSlugs } from '@/server/catalogue/sitemap';
import { getRedirectTarget } from '@/server/clicks/offer-target';
import { importFeeds } from '@/server/importer';

import { SITE_ORIGIN, createAdmin, signInForCookie } from '../support/admin';
import {
  insertFeed,
  insertOffer,
  insertProduct,
  insertShop,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { bytesOf, readFeedFixture } from '../support/feeds';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// US-2.3 / T2.3.3. Guardrail 1: an approval change made through the admin
// writer is reflected on every public reader at once, with no import in
// between. Guardrail 3: an anonymous or refused call writes nothing. Guardrail
// 5: the feed URL never leaves the read model and a failure logs only a code.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
// revalidatePath needs a Next request store that vitest does not have.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const failures = vi.hoisted(() => ({ write: null as Error | null }));
vi.mock('@/server/admin/sources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/admin/sources')>();
  return {
    ...actual,
    setShopApproval: (...args: Parameters<typeof actual.setShopApproval>) => {
      if (failures.write) throw failures.write;
      return actual.setShopApproval(...args);
    },
    setFeedApproval: (...args: Parameters<typeof actual.setFeedApproval>) => {
      if (failures.write) throw failures.write;
      return actual.setFeedApproval(...args);
    },
  };
});

const IDLE: SourceActionState = { status: 'idle' };

beforeEach(async () => {
  failures.write = null;
  await resetDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

/** One approved shop and feed, one product with one offer: visible everywhere until a flag changes. */
async function visibleOffer(slug = 'producto-aprobacion') {
  const shop = await insertShop();
  const feedId = await insertFeed(shop.id);
  const product = await insertProduct({ slug });
  const offerId = await insertOffer({ productId: product.id, feedId, priceCents: 1500 });
  return { shop, feedId, product, offerId };
}

async function flagsOf(shopId: number, feedId?: number) {
  const [shop] = await getDb().select({ approved: shops.isApproved }).from(shops).where(eq(shops.id, shopId));
  if (feedId === undefined) return { shop: shop.approved };
  const [feed] = await getDb().select({ approved: feeds.isApproved }).from(feeds).where(eq(feeds.id, feedId));
  return { shop: shop.approved, feed: feed.approved };
}

/** What each public reader says about the offer, side by side. */
async function publicView(slug: string, offerId: number) {
  const page = await getPublicProductBySlug(slug);
  return {
    pageOfferIds: page ? page.offers.map((offer) => offer.offerId) : null,
    target: (await getRedirectTarget(offerId)) !== null,
    inSitemap: ((await getSitemapProductSlugs(1)) ?? []).includes(slug),
  };
}

const VISIBLE = (offerId: number) => ({ pageOfferIds: [offerId], target: true, inSitemap: true });
const GONE = { pageOfferIds: null, target: false, inSitemap: false };

describe('guardrail 1: a feed approval change reaches every public reader at once', () => {
  it('disabling the feed removes the offer from the product page, /go and the sitemap; approving restores it, no import between', async () => {
    const { feedId, offerId, shop } = await visibleOffer();
    expect(await publicView('producto-aprobacion', offerId)).toEqual(VISIBLE(offerId));

    expect(await setFeedApproval(feedId, false)).toEqual({ feedId, approved: false, shopApproved: true });
    expect(await publicView('producto-aprobacion', offerId)).toEqual(GONE);

    expect(await setFeedApproval(feedId, true)).toEqual({ feedId, approved: true, shopApproved: true });
    expect(await publicView('producto-aprobacion', offerId)).toEqual(VISIBLE(offerId));
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });

  it('drops only the disabled feed offer from a product that another feed also sells', async () => {
    const first = await visibleOffer('producto-dos-tiendas');
    const otherShop = await insertShop();
    const otherFeed = await insertFeed(otherShop.id);
    const otherOffer = await insertOffer({ productId: first.product.id, feedId: otherFeed, priceCents: 900 });

    await setFeedApproval(first.feedId, false);

    const page = await getPublicProductBySlug('producto-dos-tiendas');
    expect(page?.offers.map((offer) => offer.offerId)).toEqual([otherOffer]);
    expect(await getRedirectTarget(first.offerId)).toBeNull();
    expect(await getRedirectTarget(otherOffer)).not.toBeNull();
    expect(await getSitemapProductSlugs(1)).toContain('producto-dos-tiendas');
  });
});

describe('guardrail 1: a shop approval change reaches every public reader at once', () => {
  it('disabling the shop hides the offers of all its feeds and leaves the feed flags alone; re-approving restores exactly the approved feeds', async () => {
    const shop = await insertShop();
    const approvedFeed = await insertFeed(shop.id);
    const disabledFeed = await insertFeed(shop.id, { isApproved: false });
    const product = await insertProduct({ slug: 'producto-tienda' });
    const fromApproved = await insertOffer({ productId: product.id, feedId: approvedFeed });
    const fromDisabled = await insertOffer({ productId: product.id, feedId: disabledFeed });
    expect((await getPublicProductBySlug('producto-tienda'))?.offers.map((o) => o.offerId)).toEqual([fromApproved]);

    expect(await setShopApproval(shop.id, false)).toEqual({ shopId: shop.id, approved: false });
    expect(await publicView('producto-tienda', fromApproved)).toEqual(GONE);
    expect(await getRedirectTarget(fromDisabled)).toBeNull();
    expect((await getDb().select({ id: feeds.id, approved: feeds.isApproved }).from(feeds).orderBy(feeds.id))).toEqual([
      { id: approvedFeed, approved: true },
      { id: disabledFeed, approved: false },
    ]);

    expect(await setShopApproval(shop.id, true)).toEqual({ shopId: shop.id, approved: true });
    expect(await publicView('producto-tienda', fromApproved)).toEqual(VISIBLE(fromApproved));
    expect(await getRedirectTarget(fromDisabled)).toBeNull();
  });

  it('an approved feed under an unapproved shop reports shopApproved false and its offers stay hidden', async () => {
    const { shop, feedId, offerId } = await visibleOffer();
    await setShopApproval(shop.id, false);

    expect(await setFeedApproval(feedId, true)).toEqual({ feedId, approved: true, shopApproved: false });
    expect(await publicView('producto-aprobacion', offerId)).toEqual(GONE);

    expect(await setFeedApproval(feedId, false)).toEqual({ feedId, approved: false, shopApproved: false });
  });

  it('approving a feed of a shop that was never approved does not approve the shop', async () => {
    const shop = await insertShop({ isApproved: false });
    const feedId = await insertFeed(shop.id, { isApproved: false });
    await setFeedApproval(feedId, true);
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: false, feed: true });
  });
});

describe('the writers touch one flag on one row', () => {
  it('a feed write changes neither the shop, its other feeds, nor any other column', async () => {
    const shop = await insertShop();
    const target = await insertFeed(shop.id, { url: 'target.csv' });
    const sibling = await insertFeed(shop.id, { url: 'sibling.csv' });
    const before = await getDb().select().from(feeds).orderBy(feeds.id);

    await setFeedApproval(target, false);

    const after = await getDb().select().from(feeds).orderBy(feeds.id);
    expect(after.find((row) => row.id === target)).toEqual({ ...before.find((row) => row.id === target), isApproved: false });
    expect(after.find((row) => row.id === sibling)).toEqual(before.find((row) => row.id === sibling));
    expect(await flagsOf(shop.id)).toEqual({ shop: true });
  });

  it('a shop write changes no other shop and no column but the flag', async () => {
    const one = await insertShop();
    const two = await insertShop();
    const before = await getDb().select().from(shops).orderBy(shops.id);

    await setShopApproval(one.id, false);

    const after = await getDb().select().from(shops).orderBy(shops.id);
    expect(after[0]).toEqual({ ...before[0], isApproved: false });
    expect(after[1]).toEqual(before[1]);
    expect(two.id).toBe(after[1].id);
  });

  it('returns null for an unknown id and writes nothing', async () => {
    const { shop, feedId } = await visibleOffer();
    expect(await setShopApproval(shop.id + 1000, false)).toBeNull();
    expect(await setFeedApproval(feedId + 1000, false)).toBeNull();
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });

  it('is idempotent: the same target twice returns the stored value both times', async () => {
    const { shop, feedId } = await visibleOffer();
    expect(await setFeedApproval(feedId, true)).toEqual({ feedId, approved: true, shopApproved: true });
    expect(await setShopApproval(shop.id, false)).toEqual({ shopId: shop.id, approved: false });
    expect(await setShopApproval(shop.id, false)).toEqual({ shopId: shop.id, approved: false });
    expect(await setFeedApproval(feedId, false)).toEqual({ feedId, approved: false, shopApproved: false });
    expect(await setFeedApproval(feedId, false)).toEqual({ feedId, approved: false, shopApproved: false });
  });

  it('a disabled feed is skipped by the next import', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id, { url: 'ean-first.csv' });
    await setFeedApproval(feedId, false);
    const readSource = vi.fn(async () => bytesOf(readFeedFixture('ean-first.csv')));

    const report = await importFeeds(getDb(), { deps: { readSource } });

    expect(report.feeds.map((feed) => feed.feedId)).not.toContain(feedId);
    expect(readSource).not.toHaveBeenCalled();
  });
});

describe('listSourcesForAdmin', () => {
  it('returns the exact shape, ordered, with numeric counts, a network name or null, and no url', async () => {
    const [network] = await getDb().insert(networks).values({ name: 'Red Prueba', slug: 'red-prueba' }).returning({ id: networks.id });
    const zeta = await insertShop({ name: 'Zeta' });
    const alfa = await insertShop({ name: 'Alfa', isApproved: false });
    const empty = await insertShop({ name: 'Beta' });
    const uploadFeed = await insertFeed(alfa.id, { url: 'https://feeds.example/up.csv?apikey=KEY-SENTINEL-71c2', isApproved: false });
    const [affiliate] = await getDb()
      .insert(feeds)
      .values({
        shopId: alfa.id,
        networkId: network.id,
        sourceType: 'affiliate_network',
        url: 'https://api.example/feed?token=TOKEN-SENTINEL-9e4d',
        isApproved: true,
        isDemo: true,
      })
      .returning({ id: feeds.id });
    const zetaFeed = await insertFeed(zeta.id);
    const product = await insertProduct({ slug: 'p-listado' });
    await insertOffer({ productId: product.id, feedId: affiliate.id });
    await insertOffer({ productId: product.id, feedId: affiliate.id, isHidden: true });
    await insertOffer({ productId: product.id, feedId: affiliate.id, inReview: true });

    const result = await listSourcesForAdmin();

    expect(result).toEqual([
      {
        id: alfa.id,
        name: 'Alfa',
        approved: false,
        offerCount: 3,
        feeds: [
          { id: uploadFeed, approved: false, demo: false, source: 'shop_upload', networkName: null, offerCount: 0 },
          { id: affiliate.id, approved: true, demo: true, source: 'affiliate_network', networkName: 'Red Prueba', offerCount: 3 },
        ],
      },
      { id: empty.id, name: 'Beta', approved: true, offerCount: 0, feeds: [] },
      {
        id: zeta.id,
        name: 'Zeta',
        approved: true,
        offerCount: 0,
        feeds: [{ id: zetaFeed, approved: true, demo: false, source: 'shop_upload', networkName: null, offerCount: 0 }],
      },
    ]);
    for (const shop of result) {
      expect(Object.keys(shop).sort()).toEqual(['approved', 'feeds', 'id', 'name', 'offerCount']);
      expect(typeof shop.offerCount).toBe('number');
      for (const feed of shop.feeds) {
        expect(Object.keys(feed).sort()).toEqual(['approved', 'demo', 'id', 'networkName', 'offerCount', 'source']);
        expect(typeof feed.offerCount).toBe('number');
      }
    }
    const text = JSON.stringify(result);
    for (const secret of ['KEY-SENTINEL', 'TOKEN-SENTINEL', 'feeds.example', 'api.example', '"url"']) {
      expect(text).not.toContain(secret);
    }
  });

  it('orders shops of the same name by id and returns an empty array for no shops', async () => {
    expect(await listSourcesForAdmin()).toEqual([]);
    const first = await insertShop({ name: 'Igual' });
    const second = await insertShop({ name: 'Igual' });
    expect((await listSourcesForAdmin()).map((shop) => shop.id)).toEqual([first.id, second.id]);
  });

  it('shows the state a write stored, without reordering', async () => {
    const a = await insertShop({ name: 'A' });
    const b = await insertShop({ name: 'B' });
    await setShopApproval(a.id, false);
    const result = await listSourcesForAdmin();
    expect(result.map((shop) => [shop.id, shop.approved])).toEqual([
      [a.id, false],
      [b.id, true],
    ]);
  });
});

describe('the actions (guardrail 3)', () => {
  async function signedIn() {
    await createAdmin();
    const { cookie } = await signInForCookie();
    return cookie;
  }

  it('write the stored values when called by a signed-in admin from the site origin', async () => {
    const { shop, feedId } = await visibleOffer();
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });

    expect(await setFeedApprovalAction(IDLE, form({ id: String(feedId), target: 'disable' }))).toEqual({
      status: 'done',
      kind: 'feed',
      id: feedId,
      approved: false,
      shopApproved: true,
    });
    expect(await setShopApprovalAction(IDLE, form({ id: String(shop.id), target: 'disable' }))).toEqual({
      status: 'done',
      kind: 'shop',
      id: shop.id,
      approved: false,
    });
    expect(await setFeedApprovalAction(IDLE, form({ id: String(feedId), target: 'approve' }))).toEqual({
      status: 'done',
      kind: 'feed',
      id: feedId,
      approved: true,
      shopApproved: false,
    });
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: false, feed: true });
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it.each([
    ['shop', setShopApprovalAction],
    ['feed', setFeedApprovalAction],
  ] as const)('an anonymous %s call redirects to sign-in and changes nothing', async (kind, action) => {
    const { shop, feedId } = await visibleOffer();
    const id = kind === 'shop' ? shop.id : feedId;
    for (const cookie of [undefined, 'admin.session_token=forged.value']) {
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => action(IDLE, form({ id: String(id), target: 'disable' })))).toBe(
        '/admin/acceso?aviso=sesion',
      );
    }
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it.each([
    ['shop', setShopApprovalAction],
    ['feed', setFeedApprovalAction],
  ] as const)('a %s call with the check unavailable returns failed and changes nothing', async (kind, action) => {
    const { shop, feedId } = await visibleOffer();
    const id = kind === 'shop' ? shop.id : feedId;
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });
    vi.stubEnv('AUTH_SECRET', 'short');

    expect(await action(IDLE, form({ id: String(id), target: 'disable' }))).toEqual({
      status: 'failed',
      kind,
      id: null,
    });
    vi.unstubAllEnvs();
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });

  it.each([
    ['shop', setShopApprovalAction],
    ['feed', setFeedApprovalAction],
  ] as const)('a %s call from another origin, or none, returns failed, logs the refusal and changes nothing', async (kind, action) => {
    const { shop, feedId } = await visibleOffer();
    const id = kind === 'shop' ? shop.id : feedId;
    const cookie = await signedIn();
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    for (const origin of ['https://evil.example', 'null', null]) {
      startAdminRequest({ cookie, origin });
      expect(await action(IDLE, form({ id: String(id), target: 'disable' }))).toEqual({
        status: 'failed',
        kind,
        id: null,
      });
    }
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
    expect(errors.mock.calls.map((call) => call.join(' '))).toEqual(Array(3).fill('admin-sources: refused (ORIGIN)'));
  });

  it.each([
    ['no id', { target: 'disable' }],
    ['empty id', { id: '', target: 'disable' }],
    ['zero id', { id: '0', target: 'disable' }],
    ['negative id', { id: '-1', target: 'disable' }],
    ['decimal id', { id: '1.5', target: 'disable' }],
    ['exponent id', { id: '1e1', target: 'disable' }],
    ['padded id', { id: ' 1', target: 'disable' }],
    ['id above the integer ceiling', { id: '2147483648', target: 'disable' }],
    ['a very long id', { id: '9'.repeat(40), target: 'disable' }],
    ['no target', { id: '1' }],
    ['toggle as target', { id: '1', target: 'toggle' }],
    ['a differently cased target', { id: '1', target: 'Disable' }],
    ['an empty target', { id: '1', target: '' }],
  ])('rejects %s with failed and writes nothing', async (_label, fields) => {
    const { shop, feedId } = await visibleOffer();
    expect([shop.id, feedId]).toEqual([1, 1]);
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });

    for (const [kind, action] of [['shop', setShopApprovalAction], ['feed', setFeedApprovalAction]] as const) {
      const state = await action(IDLE, form(fields));
      expect(state.status, kind).toBe('failed');
      expect(state).toMatchObject({ kind });
    }
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });

  it('an unknown id returns failed carrying that id', async () => {
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });
    expect(await setShopApprovalAction(IDLE, form({ id: '4242', target: 'approve' }))).toEqual({
      status: 'failed',
      kind: 'shop',
      id: 4242,
    });
    expect(await setFeedApprovalAction(IDLE, form({ id: '4242', target: 'approve' }))).toEqual({
      status: 'failed',
      kind: 'feed',
      id: 4242,
    });
  });

  it('a file field in place of the id is rejected', async () => {
    const { shop, feedId } = await visibleOffer();
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });
    const data = new FormData();
    data.set('id', new Blob(['1']), 'id.txt');
    data.set('target', 'disable');
    expect((await setFeedApprovalAction(IDLE, data)).status).toBe('failed');
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });

  it('a write that throws returns failed and logs only the fixed prefix and the code', async () => {
    const { shop, feedId } = await visibleOffer();
    startAdminRequest({ cookie: await signedIn(), origin: SITE_ORIGIN });
    const lines: string[] = [];
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
      });
    }
    failures.write = Object.assign(new Error('relation postgres://u:PW-SENTINEL-3f@db/x broke'), { code: '57P01' });

    expect(await setFeedApprovalAction(IDLE, form({ id: String(feedId), target: 'disable' }))).toEqual({
      status: 'failed',
      kind: 'feed',
      id: feedId,
    });
    expect(await setShopApprovalAction(IDLE, form({ id: String(shop.id), target: 'disable' }))).toEqual({
      status: 'failed',
      kind: 'shop',
      id: shop.id,
    });

    expect(lines).toEqual(['admin-sources: failed (57P01)', 'admin-sources: failed (57P01)']);
    failures.write = null;
    expect(await flagsOf(shop.id, feedId)).toEqual({ shop: true, feed: true });
  });
});
