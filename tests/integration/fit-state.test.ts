import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { feeds, fitments, offers, products, shops, vehicles } from '@/db/schema';
import { fitStateSql, findActiveVehicle, readFitStates, type FitState } from '@/server/catalogue/fit-state';

import {
  insertFeed,
  insertFitment,
  insertOffer,
  insertProduct,
  insertShop,
  insertVehicle,
  vehicleIdBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';

beforeEach(resetDatabase);
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeDb);

// The fit-state question (S5.5, AC 20 to 28). Every helper defaults to the
// fully COUNTED state (shop and feed approved, vehicle active); a test sets
// the one thing it is about.

/** A shop and a feed, approved unless said otherwise. */
async function source(o: { feedApproved?: boolean; shopApproved?: boolean } = {}) {
  const shop = await insertShop({ isApproved: o.shopApproved });
  const feedId = await insertFeed(shop.id, { isApproved: o.feedApproved });
  return { shopId: shop.id, feedId };
}

/** Two extra active vehicles, so a test never depends on the list's contents. */
async function twoVehicles() {
  const a = await insertVehicle();
  const b = await insertVehicle();
  return { a, b };
}

async function statesFor(slug: string, ids: number[]): Promise<Map<number, FitState>> {
  const result = await readFitStates(slug, ids);
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
  return new Map(result.states);
}

describe('fits, no-fit and unknown (AC 20)', () => {
  it('answers all three states in one call over a mixed set', async () => {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const fits = await insertProduct();
    const noFit = await insertProduct();
    const unknown = await insertProduct();
    await insertFitment(fits.id, a.id, feedId);
    await insertFitment(noFit.id, b.id, feedId);

    const states = await statesFor(a.slug, [fits.id, noFit.id, unknown.id]);

    expect(states.get(fits.id)).toBe('fits');
    expect(states.get(noFit.id)).toBe('no-fit');
    expect(states.get(unknown.id)).toBe('unknown');
    expect(states.size).toBe(3);
  });

  it('answers for the vehicle asked: the same product is fits for one car and no-fit for another', async () => {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
    expect((await statesFor(b.slug, [product.id])).get(product.id)).toBe('no-fit');
  });

  it('answers a vehicle of the migrated list, found by slug', async () => {
    const { feedId } = await source();
    const product = await insertProduct();
    const slug = (await getDb().select({ slug: vehicles.slug }).from(vehicles).orderBy(asc(vehicles.id)).limit(1))[0].slug;
    await insertFitment(product.id, await vehicleIdBySlug(slug), feedId);
    expect((await statesFor(slug, [product.id])).get(product.id)).toBe('fits');
  });
});

describe('the union over feeds (AC 19)', () => {
  it('counts a vehicle that two feeds both list for the product once: one entry, fits', async () => {
    const one = await source();
    const two = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, one.feedId);
    await insertFitment(product.id, a.id, two.feedId);

    const result = await readFitStates(a.slug, [product.id]);

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect([...result.states.entries()]).toEqual([[product.id, 'fits']]);
    }
  });

  it('fits when only one of two feeds lists the vehicle, and the other lists another car', async () => {
    const one = await source();
    const two = await source();
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, one.feedId);
    await insertFitment(product.id, b.id, two.feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
    expect((await statesFor(b.slug, [product.id])).get(product.id)).toBe('fits');
  });
});

describe('only approved feeds and shops count (AC 21, 22)', () => {
  it('a product whose only fitment comes from an unapproved feed is unknown, not no-fit', async () => {
    const { feedId } = await source({ feedApproved: false });
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, b.id, feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('unknown');
  });

  it('a fitment to the asked vehicle from an unapproved feed is not fits', async () => {
    const { feedId } = await source({ feedApproved: false });
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('unknown');
  });

  it('is no-fit, not fits, when the asked vehicle comes only from an unapproved feed and another car from an approved one', async () => {
    const approved = await source();
    const unapproved = await source({ feedApproved: false });
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, unapproved.feedId);
    await insertFitment(product.id, b.id, approved.feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('no-fit');
  });

  it('a product whose only fitment comes from a feed of an unapproved shop is unknown', async () => {
    const { feedId } = await source({ shopApproved: false });
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);
    await insertFitment(product.id, b.id, feedId);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('unknown');
  });

  it('judges on the approved feed when the same product has fitments from an unapproved feed too', async () => {
    const approved = await source();
    const unapproved = await source({ feedApproved: false });
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, unapproved.feedId);
    await insertFitment(product.id, b.id, approved.feedId);

    expect((await statesFor(b.slug, [product.id])).get(product.id)).toBe('fits');
  });

  it('changes on the next call when an admin disables the feed, and back when it is approved again', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);
    const ask = async () => (await statesFor(a.slug, [product.id])).get(product.id);

    expect(await ask()).toBe('fits');
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));
    expect(await ask()).toBe('unknown');
    await getDb().update(feeds).set({ isApproved: true }).where(eq(feeds.id, feedId));
    expect(await ask()).toBe('fits');
  });

  it('changes on the next call when the shop is disabled, and back when it is approved again', async () => {
    const { feedId, shopId } = await source();
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, b.id, feedId);
    const ask = async () => (await statesFor(a.slug, [product.id])).get(product.id);

    expect(await ask()).toBe('no-fit');
    await getDb().update(shops).set({ isApproved: false }).where(eq(shops.id, shopId));
    expect(await ask()).toBe('unknown');
    await getDb().update(shops).set({ isApproved: true }).where(eq(shops.id, shopId));
    expect(await ask()).toBe('no-fit');
  });
});

describe('product and offer state does not change the answer (AC 22, OD-2)', () => {
  async function baseline() {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    const offerId = await insertOffer({ productId: product.id, feedId });
    await insertFitment(product.id, a.id, feedId);
    return { feedId, a, b, product, offerId };
  }

  it('is fits for a fully visible product (baseline)', async () => {
    const { a, product } = await baseline();
    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
  });

  it('is the same for a hidden product', async () => {
    const { a, b, product } = await baseline();
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
    expect((await statesFor(b.slug, [product.id])).get(product.id)).toBe('no-fit');
  });

  it('is the same for a hidden offer', async () => {
    const { a, product, offerId } = await baseline();
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.id, offerId));
    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
  });

  it('is the same for an offer in the matching queue', async () => {
    const { a, product, offerId } = await baseline();
    await getDb().update(offers).set({ inReview: true }).where(eq(offers.id, offerId));
    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
  });

  it('is the same for an unmapped product with no offer at all', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct({ categoryId: null });
    await insertFitment(product.id, a.id, feedId);
    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
  });
});

describe('retired vehicles (AC 23, 24, OD-3)', () => {
  const retire = (id: number) => getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.id, id));

  it('a product whose fitments are only to a retired vehicle is unknown, not no-fit', async () => {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, b.id, feedId);
    await retire(b.id);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('unknown');
  });

  it('judges a product with fitments to a retired and an active vehicle on the active one', async () => {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const c = await insertVehicle();
    const product = await insertProduct();
    await insertFitment(product.id, b.id, feedId);
    await insertFitment(product.id, c.id, feedId);
    await retire(b.id);

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('no-fit');
    expect((await statesFor(c.slug, [product.id])).get(product.id)).toBe('fits');
  });

  it('reports no such vehicle for a retired slug, even when the product has fitments to it', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);
    await retire(a.id);

    expect(await readFitStates(a.slug, [product.id])).toEqual({ status: 'no-such-vehicle' });
    expect(await findActiveVehicle(a.slug)).toBeNull();
  });

  it('reports no such vehicle for a slug that does not exist, not unknown for every product', async () => {
    const product = await insertProduct();
    expect(await readFitStates('no-existe-este-coche', [product.id])).toEqual({ status: 'no-such-vehicle' });
  });

  it('reports no such vehicle for an unknown slug even with an empty set of products', async () => {
    expect(await readFitStates('no-existe-este-coche', [])).toEqual({ status: 'no-such-vehicle' });
  });

  it('finds an active vehicle by slug, with its id', async () => {
    const { a } = await twoVehicles();
    expect(await findActiveVehicle(a.slug)).toEqual({ id: a.id, slug: a.slug });
  });

  it('answers again once the vehicle is back on the list', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);
    await retire(a.id);
    await getDb().update(vehicles).set({ isRetired: false }).where(eq(vehicles.id, a.id));

    expect((await statesFor(a.slug, [product.id])).get(product.id)).toBe('fits');
  });
});

describe('the set asked about (AC 25, 26)', () => {
  it('gives an empty answer for an empty set of products', async () => {
    const { a } = await twoVehicles();
    const result = await readFitStates(a.slug, []);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.vehicle).toEqual({ id: a.id, slug: a.slug });
      expect(result.states.size).toBe(0);
    }
  });

  it('gives a missing product no entry and no error', async () => {
    const { a } = await twoVehicles();
    const product = await insertProduct();
    const states = await statesFor(a.slug, [product.id, 2_000_000_000]);
    expect([...states.keys()]).toEqual([product.id]);
  });

  it('returns only the products asked about', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const asked = await insertProduct();
    const other = await insertProduct();
    await insertFitment(asked.id, a.id, feedId);
    await insertFitment(other.id, a.id, feedId);

    const states = await statesFor(a.slug, [asked.id]);

    expect([...states.keys()]).toEqual([asked.id]);
  });

  it('counts a product asked about twice once', async () => {
    const { a } = await twoVehicles();
    const product = await insertProduct();
    const states = await statesFor(a.slug, [product.id, product.id]);
    expect(states.size).toBe(1);
  });

  it('answers for a hidden or unmapped product by id: visibility is the product scope, not this query', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const hidden = await insertProduct({ isHidden: true });
    const unmapped = await insertProduct({ categoryId: null });
    await insertFitment(hidden.id, a.id, feedId);
    const states = await statesFor(a.slug, [hidden.id, unmapped.id]);
    expect(states.get(hidden.id)).toBe('fits');
    expect(states.get(unmapped.id)).toBe('unknown');
  });
});

describe('fitStateSql inside a listing query (design § Listing cost)', () => {
  it('filters and orders a select over products by the fit state', async () => {
    const { feedId } = await source();
    const { a, b } = await twoVehicles();
    const noFit = await insertProduct();
    const unknown = await insertProduct();
    const fits = await insertProduct();
    await insertFitment(fits.id, a.id, feedId);
    await insertFitment(noFit.id, b.id, feedId);

    const state = fitStateSql(a.id);
    const rows = await getDb()
      .select({ id: products.id, state })
      .from(products)
      .orderBy(asc(products.id));
    expect(new Map(rows.map((row) => [row.id, row.state]))).toEqual(
      new Map<number, FitState>([
        [noFit.id, 'no-fit'],
        [unknown.id, 'unknown'],
        [fits.id, 'fits'],
      ]),
    );

    const kept = await getDb()
      .select({ id: products.id })
      .from(products)
      .where(eq(state, 'fits'))
      .orderBy(asc(products.id));
    expect(kept.map((row) => row.id)).toEqual([fits.id]);
  });
});

describe('no write, no log, no leak (AC 28, guardrail 5)', () => {
  it('writes no row and logs nothing, whatever the answer', async () => {
    const { feedId } = await source();
    const { a } = await twoVehicles();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, feedId);
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const rowsBefore = {
      vehicles: await getDb().select().from(vehicles).orderBy(asc(vehicles.id)),
      fitments: await getDb().select().from(fitments).orderBy(asc(fitments.id)),
    };

    await readFitStates(a.slug, [product.id]);
    await readFitStates('no-existe-este-coche', [product.id]);
    await readFitStates(a.slug, []);
    await findActiveVehicle(a.slug);

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect({
      vehicles: await getDb().select().from(vehicles).orderBy(asc(vehicles.id)),
      fitments: await getDb().select().from(fitments).orderBy(asc(fitments.id)),
    }).toEqual(rowsBefore);
  });

  it('fails with a fixed message that holds neither the slug nor the ids, and logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const slug = 'coche-que-no-debe-aparecer';
    const error = await readFitStates(slug, [424242]).catch((caught: unknown) => caught);
    const lookup = await findActiveVehicle(slug).catch((caught: unknown) => caught);

    for (const caught of [error, lookup]) {
      expect(caught).toBeInstanceOf(Error);
      const failure = caught as Error;
      expect(failure.message).toBe('fit-state: failed');
      expect(failure.cause).toBeUndefined();
      expect(failure.message).not.toContain(slug);
      expect(failure.message).not.toContain('424242');
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    await closeDb();
  });
});
