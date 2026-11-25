import { asc, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  setOfferHiddenAction,
  setProductHiddenAction,
  type HideActionState,
} from '@/app/admin/(shell)/productos/actions';
import { closeDb, getDb } from '@/db/client';
import { clicks, feeds, offers, products, shops } from '@/db/schema';
import { readProductForAdmin } from '@/server/admin/products';
import { signOutAction } from '@/server/auth/actions';

import { SITE_ORIGIN, consoleMethods, createAdmin, expireSessionRow, forge, signInForCookie } from '../support/admin';
import { insertFeed, insertOffer, insertProduct, insertShop } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { hideForm, withFailingHideWrites } from '../support/hide';
import { nextRequest, redirectOf, startAdminRequest } from '../support/next-request';

// A hang guard set at over ten times the slowest test of this file (0006, rule 4); the Vitest
// default of 5 s is not.
vi.setConfig({ testTimeout: 30_000 });

// S2.4 (T2.4.1), ACs 2 to 6 and 26 to 30 on the two actions, and 57 for a failing write: the role check
// comes before the form is read, another origin is refused, the target is explicit, a crafted request
// cannot set anything but the one flag of the one item, and a failure leaves a code and nothing else.

vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule);
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

type Action = (previous: HideActionState, form: FormData) => Promise<HideActionState>;
const IDLE: HideActionState = { status: 'idle' };
const KEY = 'KEY-SENTINEL-9c3e';
const SLUG = 'slug-sentinel-41ab';

const ACTIONS: [string, 'product' | 'offer', Action][] = [
  ['setProductHiddenAction', 'product', setProductHiddenAction],
  ['setOfferHiddenAction', 'offer', setOfferHiddenAction],
];

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await closeDb();
});

async function signedIn(): Promise<{ cookie: string; token: string }> {
  await createAdmin();
  return signInForCookie();
}

/** Two products, two offers on the first, one on the second; the feed address and the offer address hold a planted key. */
async function world() {
  const shop = await insertShop();
  const feedId = await insertFeed(shop.id, { url: `https://feeds.example/f.csv?apikey=${KEY}` });
  const product = await insertProduct({ slug: SLUG, title: 'Producto uno' });
  const other = await insertProduct({ slug: 'otro-producto' });
  const near = await insertOffer({ productId: product.id, feedId, priceCents: 1000, url: `https://affiliate.example/${KEY}` });
  const far = await insertOffer({ productId: product.id, feedId, priceCents: 2000 });
  const otherOffer = await insertOffer({ productId: other.id, feedId });
  return { shop, feedId, product, other, near, far, otherOffer };
}

async function snapshot() {
  const db = getDb();
  return {
    products: await db.select().from(products).orderBy(asc(products.id)),
    offers: await db.select().from(offers).orderBy(asc(offers.id)),
    feeds: await db.select().from(feeds).orderBy(asc(feeds.id)),
    shops: await db.select().from(shops).orderBy(asc(shops.id)),
    clicks: await db.select().from(clicks).orderBy(asc(clicks.id)),
  };
}

function capture(): string[] {
  const lines: string[] = [];
  for (const method of consoleMethods) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' '));
    });
  }
  return lines;
}

/** The id each action's table holds: the first product, the first offer. */
const idFor = (kind: 'product' | 'offer', w: Awaited<ReturnType<typeof world>>): number =>
  kind === 'product' ? w.product.id : w.near;

describe('a request with no valid session is refused before the form is read, and writes nothing (AC 2)', () => {
  it.each(ACTIONS)('%s: no cookie, a forged, an expired and a signed-out cookie redirect to sign-in', async (_name, kind, action) => {
    const w = await world();
    const before = await snapshot();

    const live = await signedIn();
    const expired = await signInForCookie();
    await expireSessionRow(expired.token);
    const out = await signInForCookie();
    startAdminRequest({ cookie: out.cookie, origin: SITE_ORIGIN });
    await redirectOf(() => signOutAction());

    for (const cookie of [undefined, 'admin.session_token=forged.value', forge(live.cookie), expired.cookie, out.cookie]) {
      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      // A form whose every read throws: the role check must answer before anything is read.
      const untouched = {
        get: vi.fn(() => {
          throw new Error('form read before the role check');
        }),
      } as unknown as FormData;
      expect(await redirectOf(() => action(IDLE, untouched)), String(cookie)).toBe('/admin/acceso?aviso=sesion');
      expect(untouched.get).not.toHaveBeenCalled();

      startAdminRequest({ cookie, origin: SITE_ORIGIN });
      expect(await redirectOf(() => action(IDLE, hideForm({ id: idFor(kind, w), target: 'hide' })))).toBe(
        '/admin/acceso?aviso=sesion',
      );
      expect(nextRequest.cookieWrites).toEqual([]);
    }

    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s: with the session check unavailable it returns failed and writes nothing', async (_name, kind, action) => {
    const w = await world();
    const before = await snapshot();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    vi.stubEnv('AUTH_SECRET', 'short');

    const state = await action(IDLE, hideForm({ id: idFor(kind, w), target: 'hide' }));

    expect(state).toEqual({ status: 'failed', kind, id: null });
    vi.unstubAllEnvs();
    expect(await snapshot()).toEqual(before);
  });
});

describe('a submission from another origin is refused and writes nothing (AC 3)', () => {
  it.each(ACTIONS)('%s: another origin, the string null and no origin all return failed and log only the refusal', async (_name, kind, action) => {
    const w = await world();
    const before = await snapshot();
    const { cookie } = await signedIn();
    const lines = capture();

    for (const origin of ['https://evil.example', 'null', 'http://127.0.0.1:3001', null]) {
      startAdminRequest({ cookie, origin });
      const state = await action(IDLE, hideForm({ id: idFor(kind, w), target: 'hide' }));
      expect(state, String(origin)).toEqual({ status: 'failed', kind, id: null });
    }

    expect(await snapshot()).toEqual(before);
    expect(lines).toEqual(Array(4).fill('admin-products: refused (ORIGIN)'));
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(nextRequest.cookieWrites).toEqual([]);
  });
});

describe('a signed-in call from the site origin hides and unhides, and revalidates only the admin product screens (AC 26 to 29)', () => {
  it('hides and unhides a product with the stored state, which says it is not public while hidden', async () => {
    const { product } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'hide' }))).toEqual({
      status: 'done',
      kind: 'product',
      id: product.id,
      hidden: true,
      publicNow: false,
      reason: 'product_hidden',
    });
    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'unhide' }))).toEqual({
      status: 'done',
      kind: 'product',
      id: product.id,
      hidden: false,
      publicNow: true,
      reason: null,
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ['/admin/productos', 'layout'],
      ['/admin/productos', 'layout'],
    ]);
    expect(nextRequest.cookieWrites).toEqual([]);
  });

  it('hides and unhides an offer with the stored state', async () => {
    const { near, far } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'hide' }))).toEqual({
      status: 'done',
      kind: 'offer',
      id: near,
      hidden: true,
      publicNow: false,
      reason: 'offer_hidden',
    });
    expect(await setOfferHiddenAction(IDLE, hideForm({ id: far, target: 'hide' }))).toMatchObject({
      status: 'done',
      id: far,
      hidden: true,
      publicNow: false,
    });
    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'unhide' }))).toEqual({
      status: 'done',
      kind: 'offer',
      id: near,
      hidden: false,
      publicNow: true,
      reason: null,
    });
    expect(vi.mocked(revalidatePath).mock.calls.every((call) => call[0] === '/admin/productos' && call[1] === 'layout')).toBe(true);
  });

  it('keeps the explicit state: a repeated or stale submission leaves the item as asked and is not an error (AC 4)', async () => {
    const { product, near } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    for (const target of ['hide', 'hide', 'hide']) {
      expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target }))).toMatchObject({ status: 'done', hidden: true });
    }
    for (const target of ['unhide', 'unhide']) {
      expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target }))).toMatchObject({ status: 'done', hidden: false });
      expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target }))).toMatchObject({ status: 'done', hidden: false });
    }
  });

  it('changes no flag on the other table and no other column (AC 6, 30, 44)', async () => {
    const w = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();

    await setProductHiddenAction(IDLE, hideForm({ id: w.product.id, target: 'hide' }));
    const afterProduct = await snapshot();
    expect(afterProduct.offers).toEqual(before.offers);
    expect({ ...afterProduct, products: null }).toEqual({ ...before, products: null });
    expect(afterProduct.products.filter((p) => p.isHidden).map((p) => p.id)).toEqual([w.product.id]);

    await setProductHiddenAction(IDLE, hideForm({ id: w.product.id, target: 'unhide' }));
    await setOfferHiddenAction(IDLE, hideForm({ id: w.near, target: 'hide' }));
    const afterOffer = await snapshot();
    expect(afterOffer.products).toEqual(before.products);
    expect(afterOffer.offers.filter((o) => o.isHidden).map((o) => o.id)).toEqual([w.near]);
    expect({ ...afterOffer, offers: null }).toEqual({ ...before, offers: null });
  });
});

describe('an id that names nothing, or a target that is not explicit, is refused and writes nothing (AC 4, 5)', () => {
  it.each(ACTIONS)('%s: a malformed or missing id returns failed with no id, and logs nothing', async (_name, kind, action) => {
    await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();
    const lines = capture();

    for (const id of ['', '0', '-1', '1.5', ' 1', '1 ', '01', 'abc', '1e3', '0x1', '99999999999', '2147483648']) {
      expect(await action(IDLE, hideForm({ id, target: 'hide' })), id).toEqual({ status: 'failed', kind, id: null });
    }
    expect(await action(IDLE, hideForm({ target: 'hide' }))).toEqual({ status: 'failed', kind, id: null });

    expect(await snapshot()).toEqual(before);
    expect(lines).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s: no target, or one that is not hide or unhide, returns failed with the id and writes nothing', async (_name, kind, action) => {
    const w = await world();
    const id = idFor(kind, w);
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();
    const lines = capture();

    for (const target of ['', 'toggle', 'Hide', 'HIDE', 'hide ', 'true', '1', 'approve', 'oculto']) {
      expect(await action(IDLE, hideForm({ id, target })), target).toEqual({ status: 'failed', kind, id });
    }
    expect(await action(IDLE, hideForm({ id }))).toEqual({ status: 'failed', kind, id });
    const twice = new FormData();
    twice.append('id', String(id));
    twice.append('target', 'toggle');
    twice.append('target', 'hide');
    expect(await action(IDLE, twice)).toEqual({ status: 'failed', kind, id });

    expect(await snapshot()).toEqual(before);
    expect(lines).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)('%s: a well-formed id with no row returns gone with that id, and writes nothing', async (_name, kind, action) => {
    await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();
    const lines = capture();

    for (const target of ['hide', 'unhide']) {
      expect(await action(IDLE, hideForm({ id: 987654, target }))).toEqual({ status: 'gone', kind, id: 987654 });
    }

    expect(await snapshot()).toEqual(before);
    expect(lines).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe('a crafted submission cannot set anything but the one hidden state of the one item it names (AC 6)', () => {
  it.each(ACTIONS)('%s: extra fields are ignored, and the item that is not named keeps its state', async (_name, kind, action) => {
    const w = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();

    const state = await action(
      IDLE,
      hideForm({
        id: idFor(kind, w),
        target: 'hide',
        categoryId: 99,
        category_id: 99,
        isApproved: 'true',
        isHidden: 'false',
        inReview: 'true',
        priceCents: 1,
        title: 'Otro título',
        slug: 'otro-slug',
        url: 'https://evil.example/',
        productId: w.other.id,
        offerId: w.otherOffer,
        feedId: 99,
        shopId: 99,
      }),
    );

    expect(state).toMatchObject({ status: 'done', kind, id: idFor(kind, w), hidden: true });
    const after = await snapshot();
    const changed = [
      ...after.products.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before.products[i])).map((row) => `p${row.id}`),
      ...after.offers.filter((row, i) => JSON.stringify(row) !== JSON.stringify(before.offers[i])).map((row) => `o${row.id}`),
    ];
    expect(changed).toEqual([kind === 'product' ? `p${w.product.id}` : `o${w.near}`]);
    expect({ ...after, products: null, offers: null }).toEqual({ ...before, products: null, offers: null });
  });

  it('acts on the table of its own action: ids overlap between products and offers, and a product hide never marks the offer with the same number', async () => {
    const w = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    // Both tables count from 1, so product 2 and offer 2 share a number.
    await setProductHiddenAction(IDLE, hideForm({ id: w.other.id, target: 'hide' }));
    const after = await snapshot();
    expect(after.offers.some((o) => o.isHidden)).toBe(false);
    expect(after.products.filter((p) => p.isHidden).map((p) => p.id)).toEqual([w.other.id]);
  });
});

describe('the states hold no address and the log holds no value (AC 24, 57)', () => {
  it.each(ACTIONS)('%s: no state of any kind carries the feed or offer address', async (_name, kind, action) => {
    const w = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const states = [
      await action(IDLE, hideForm({ id: idFor(kind, w), target: 'hide' })),
      await action(IDLE, hideForm({ id: idFor(kind, w), target: 'unhide' })),
      await action(IDLE, hideForm({ id: 987654, target: 'hide' })),
      await action(IDLE, hideForm({ id: 'x', target: 'hide' })),
    ];
    const text = JSON.stringify(states);
    expect(text).not.toMatch(/KEY|apikey|feeds\.example|affiliate\.example|https?:|"url"/);
    expect(text).not.toContain(SLUG);
  });

  it.each(ACTIONS)('%s: a write that throws returns failed with the id, logs a code only, and changes nothing', async (_name, kind, action) => {
    const w = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const before = await snapshot();
    const lines = capture();
    const id = idFor(kind, w);

    const state = await withFailingHideWrites(() => action(IDLE, hideForm({ id, target: 'hide' })));

    expect(state).toEqual({ status: 'failed', kind, id });
    expect(JSON.stringify(state)).not.toMatch(/boom|slug-sentinel/);
    expect(lines).toEqual(['admin-products: failed (P0001)']);
    expect(lines.join('\n')).not.toContain(SLUG);
    expect(await snapshot()).toEqual(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('logs nothing on a success', async () => {
    const { product, near } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    const lines = capture();
    await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'hide' }));
    await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'hide' }));
    expect(lines).toEqual([]);
  });
});

// US-2.5 (T-2.5.3b), ACs 28 and 29: the answer of a hide or an unhide carries the reason that applies after it, and the
// read that follows (the page's own re-read) agrees, also for the reasons an offer press changes on its product.
describe('the answer carries the reason that applies after the change (US-2.5, AC 28, 29)', () => {
  const stateOf = (kind: 'product' | 'offer', id: number, hidden: boolean, publicNow: boolean, reason: string | null) => ({
    status: 'done',
    kind,
    id,
    hidden,
    publicNow,
    reason,
  });

  it('an unhide of an item with another cause answers that cause, never none, and publishes nothing by itself', async () => {
    const { product, near, feedId } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));

    // The offer first: hidden while its feed is not approved, it names the hide only once nothing ranks before it.
    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'hide' }))).toEqual(
      stateOf('offer', near, true, false, 'offer_feed_not_approved'),
    );
    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'unhide' }))).toEqual(
      stateOf('offer', near, false, false, 'offer_feed_not_approved'),
    );
    // Then the product: its own hide, then the cause of its offers.
    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'hide' }))).toEqual(
      stateOf('product', product.id, true, false, 'product_hidden'),
    );
    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'unhide' }))).toEqual(
      stateOf('product', product.id, false, false, 'offers_feed_not_approved'),
    );
  });

  it('hiding the last offer on the site changes the product reason on the re-read, and unhiding one gives the product back', async () => {
    const { product, near, far } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'hide' }))).toMatchObject({ reason: 'offer_hidden', publicNow: false });
    // Another offer is still on the site, so the product reads Yes with no reason, and the hidden offer names itself.
    const first = await readProductForAdmin(product.id);
    expect(first).toMatchObject({ publicNow: true, reason: null });
    expect(first?.offers.map((offer) => [offer.id, offer.reason])).toEqual(
      expect.arrayContaining([[near, 'offer_hidden'], [far, null]]),
    );

    expect(await setOfferHiddenAction(IDLE, hideForm({ id: far, target: 'hide' }))).toMatchObject({ reason: 'offer_hidden' });
    const second = await readProductForAdmin(product.id);
    expect(second).toMatchObject({ publicNow: false, reason: 'offers_hidden' });
    expect(second?.offers.map((offer) => offer.reason)).toEqual(['offer_hidden', 'offer_hidden']);

    expect(await setOfferHiddenAction(IDLE, hideForm({ id: near, target: 'unhide' }))).toMatchObject({ reason: null, publicNow: true });
    expect(await readProductForAdmin(product.id)).toMatchObject({ publicNow: true, reason: null });
  });

  it('hiding a product gives its fine offers the product reason on the re-read, and unhiding it takes the reason away', async () => {
    const { product, near, far } = await world();
    startAdminRequest({ cookie: (await signedIn()).cookie, origin: SITE_ORIGIN });

    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'hide' }))).toMatchObject({ reason: 'product_hidden' });
    const hidden = await readProductForAdmin(product.id);
    expect(hidden).toMatchObject({ hidden: true, publicNow: false, reason: 'product_hidden' });
    for (const offer of hidden?.offers ?? []) expect(offer).toMatchObject({ hidden: false, publicNow: false, reason: 'product_hidden' });
    expect(hidden?.offers.map((offer) => offer.id).sort()).toEqual([near, far].sort());

    expect(await setProductHiddenAction(IDLE, hideForm({ id: product.id, target: 'unhide' }))).toMatchObject({ reason: null, publicNow: true });
    const back = await readProductForAdmin(product.id);
    expect(back).toMatchObject({ publicNow: true, reason: null });
    for (const offer of back?.offers ?? []) expect(offer).toMatchObject({ publicNow: true, reason: null });
  });
});
