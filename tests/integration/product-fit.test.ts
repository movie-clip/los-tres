import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { offers, products, vehicles } from '@/db/schema';
import type { CarContext } from '@/server/car/state';
import { FitStateError, readProductFitState, readProductVehicles } from '@/server/catalogue/fit-state';
import { getProductFit } from '@/server/catalogue/product-fit';

import { VEHICLE_CATALOGUE } from '../../src/db/vehicle-catalogue';
import {
  insertFeed,
  insertFitment,
  insertListedProduct,
  insertProduct,
  insertShop,
  insertVehicle,
  vehicleIdBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';

// S5.9 T5.9.1 (#279): the product page's fit read (readProductFitState) and the wrapper that never
// fails the page (getProductFit). The wrapper's read is mocked ONLY to inject a failure; every other
// case runs the real read against PostgreSQL, so the wrapper is proven on both sides of its seam.

const hoisted = vi.hoisted(() => ({
  read: vi.fn(),
  actual: undefined as undefined | ((slug: string, id: number) => Promise<unknown>),
  // #280: the vehicles read is injectable the same way.
  list: vi.fn(),
  actualList: undefined as undefined | ((slug: string) => Promise<unknown>),
}));

vi.mock('@/server/catalogue/fit-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/catalogue/fit-state')>();
  hoisted.actual = actual.readProductFitState;
  hoisted.actualList = actual.readProductVehicles;
  return { ...actual, readProductFitState: hoisted.read, readProductVehicles: hoisted.list };
});

beforeEach(async () => {
  await resetDatabase();
  hoisted.read.mockReset();
  hoisted.read.mockImplementation((slug: string, id: number) => hoisted.actual!(slug, id));
  hoisted.list.mockReset();
  hoisted.list.mockImplementation((slug: string) => hoisted.actualList!(slug));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
afterAll(closeDb);

/** An approved shop and feed: the source of a COUNTED fitment unless said otherwise. */
async function source(o: { feedApproved?: boolean; shopApproved?: boolean } = {}) {
  const shop = await insertShop({ isApproved: o.shopApproved });
  const feedId = await insertFeed(shop.id, { isApproved: o.feedApproved });
  return { feedId };
}

/** A fully public product (one visible offer) and two extra active vehicles. */
async function world() {
  const product = await insertListedProduct({ slug: 'producto-publico', prices: [1500] });
  const a = await insertVehicle();
  const b = await insertVehicle();
  return { product, a, b };
}

function selected(vehicle: { id: number; slug: string }, name = 'Marca Modelo I 1.0'): CarContext {
  return {
    state: 'selected',
    vehicle: { id: vehicle.id, slug: vehicle.slug, makeSlug: 'marca', modelSlug: 'marca-modelo-i', name },
    path: null,
  };
}

/** The list entry the real read gives for an `insertVehicle` vehicle: its defaults, no id. */
const vehicleOf = (vehicle: { slug: string }) => ({
  slug: vehicle.slug,
  make: 'Marca',
  makeSlug: 'marca',
  model: 'Modelo',
  modelSlug: 'marca-modelo-i',
  generation: 'I',
  yearFrom: 2010,
  yearTo: null,
  engine: '1.0',
  fuel: 'gasolina',
  powerCv: 68,
});

const errorLines = () => vi.mocked(console.error).mock.calls.map((call) => call.join(' '));

describe('readProductFitState: the three states (AC 2, 3, 4)', () => {
  it('fits when a counted fitment names the vehicle', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('fits');
  });

  it('no-fit when the product has counted fitments and none is the vehicle', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, b.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('no-fit');
  });

  it('unknown when the product has no fitment at all', async () => {
    const { product, a } = await world();
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('answers for the vehicle asked: fits for one car and no-fit for another', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('fits');
    expect(await readProductFitState(product.slug, b.id)).toBe('no-fit');
  });

  it('counts a vehicle given by two feeds once and still says fits', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    await insertFitment(product.id, a.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('fits');
  });
});

describe('readProductFitState: counted fitments only (AC 5)', () => {
  it('a fitment from an unapproved feed is unknown, not fits and not no-fit', async () => {
    const { product, a, b } = await world();
    const bad = await source({ feedApproved: false });
    await insertFitment(product.id, a.id, bad.feedId);
    await insertFitment(product.id, b.id, bad.feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
    expect(await readProductFitState(product.slug, b.id)).toBe('unknown');
  });

  it('a fitment from an unapproved shop is unknown', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source({ shopApproved: false })).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('a fitment to a retired vehicle is unknown for any car', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, b.id, (await source()).feedId);
    await getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.id, b.id));
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('an uncounted fitment to the vehicle does not make it fits when another counted one exists', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, a.id, (await source({ feedApproved: false })).feedId);
    await insertFitment(product.id, b.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('no-fit');
  });
});

describe('readProductFitState: a product that is not public is unknown (AC 26, guardrail 1)', () => {
  it('a hidden product with a counted fitment to the vehicle', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product.id));
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('a product with no offer', async () => {
    const a = await insertVehicle();
    const product = await insertProduct();
    await insertFitment(product.id, a.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('a product whose only offer is hidden', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    await getDb().update(offers).set({ isHidden: true }).where(eq(offers.productId, product.id));
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('a product that is not mapped to a category', async () => {
    const a = await insertVehicle();
    const product = await insertListedProduct({ slug: 'sin-categoria', prices: [900], categoryId: null });
    await insertFitment(product.id, a.id, (await source()).feedId);
    expect(await readProductFitState(product.slug, a.id)).toBe('unknown');
  });

  it('a slug that names no product', async () => {
    const { a } = await world();
    expect(await readProductFitState('no-existe-este-producto', a.id)).toBe('unknown');
  });
});

describe('readProductFitState: failure (AC 10, 27)', () => {
  it('rejects with the fixed error, holding no slug, no id and no cause, and logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const slug = 'producto-que-no-debe-aparecer';
    const error = await readProductFitState(slug, 424242).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FitStateError);
    const failure = error as FitStateError;
    expect(failure.message).toBe('fit-state: failed');
    expect(failure.cause).toBeUndefined();
    expect(failure.code).toMatch(/^[A-Za-z0-9_]{1,32}$/);
    expect(failure.message).not.toContain(slug);
    expect(failure.message).not.toContain('424242');
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    await closeDb();
  });
});

describe('getProductFit: no banner without a selected car (AC 7, 8, 9)', () => {
  const states: [string, CarContext][] = [
    ['no car', { state: 'none', path: null }],
    ['an unrecognised car', { state: 'unrecognised', raw: 'coche-que-no-existe', path: null }],
    ['an unrecognised malformed value', { state: 'unrecognised', raw: null, path: null }],
    ['an unavailable car', { state: 'unavailable', path: null }],
  ];

  for (const [name, car] of states) {
    it(`${name}: banner is null, the read is never called and nothing is logged`, async () => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const { product, a } = await world();
      await insertFitment(product.id, a.id, (await source()).feedId);

      expect(await getProductFit(product.slug, car)).toEqual({ banner: null, vehicles: [vehicleOf(a)] });
      expect(hoisted.read).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });
  }
});

describe('getProductFit: a selected car gets the state of the real read (AC 1 to 5)', () => {
  it('fits, no-fit and unknown, with no log line', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { product, a, b } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    const other = await insertListedProduct({ slug: 'otro-producto', prices: [800] });
    await insertFitment(other.id, b.id, (await source()).feedId);
    const bare = await insertListedProduct({ slug: 'producto-sin-datos', prices: [700] });

    expect(await getProductFit(product.slug, selected(a))).toEqual({ banner: 'fits', vehicles: [vehicleOf(a)] });
    expect(await getProductFit(other.slug, selected(a))).toEqual({ banner: 'no-fit', vehicles: [vehicleOf(b)] });
    expect(await getProductFit(bare.slug, selected(a))).toEqual({ banner: 'unknown', vehicles: [] });
    expect(hoisted.read).toHaveBeenCalledTimes(3);
    expect(hoisted.read).toHaveBeenCalledWith(product.slug, a.id);
    expect(error).not.toHaveBeenCalled();
  });

  it('a fitment only from an unapproved feed gives unknown, not no-fit (AC 5)', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, b.id, (await source({ feedApproved: false })).feedId);
    expect(await getProductFit(product.slug, selected(a))).toEqual({ banner: 'unknown', vehicles: [] });
  });
});

describe('getProductFit: a failed read degrades to unchecked with one code-only line (AC 10, 27)', () => {
  const SLUG = 'producto-secreto-abc';
  const CAR_NAME = 'Marca Secreta Modelo Oculto 9.9 XYZ';
  const VEHICLE = { id: 8675309, slug: 'vehiculo-secreto-slug' };

  async function failWith(rejection: unknown) {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const others = (['log', 'info', 'warn', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    hoisted.read.mockReset();
    hoisted.read.mockRejectedValue(rejection);
    const result = await getProductFit(SLUG, selected(VEHICLE, CAR_NAME));
    return { result, lines: errorLines(), error, others };
  }

  function expectNothingPersonal(lines: string[]): void {
    const text = lines.join('\n');
    for (const secret of [SLUG, CAR_NAME, VEHICLE.slug, String(VEHICLE.id), 'Secreta', 'password']) {
      expect(text).not.toContain(secret);
    }
  }

  it('unchecked, with exactly one line holding only the database code', async () => {
    const { result, lines, others } = await failWith(Object.assign(new Error('fit-state: failed'), { code: '57P01' }));
    expect(result).toEqual({ banner: 'unchecked', vehicles: [] });
    expect(lines).toEqual(['product-fit: fit failed (57P01)']);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
    expectNothingPersonal(lines);
  });

  it('a FitStateError carries its code into the line', async () => {
    const { result, lines } = await failWith(new FitStateError('ECONNREFUSED'));
    expect(result).toEqual({ banner: 'unchecked', vehicles: [] });
    expect(lines).toEqual(['product-fit: fit failed (ECONNREFUSED)']);
  });

  it('an error with no code logs UNKNOWN, never its message', async () => {
    const { result, lines } = await failWith(new Error(`could not read ${SLUG} for ${CAR_NAME} (${VEHICLE.id})`));
    expect(result).toEqual({ banner: 'unchecked', vehicles: [] });
    expect(lines).toEqual(['product-fit: fit failed (UNKNOWN)']);
    expectNothingPersonal(lines);
  });

  it('a code that is not code-shaped logs UNKNOWN', async () => {
    const { lines } = await failWith(Object.assign(new Error('x'), { code: `bad code ${SLUG}` }));
    expect(lines).toEqual(['product-fit: fit failed (UNKNOWN)']);
    expectNothingPersonal(lines);
  });

  it('a rejection that is not an Error logs UNKNOWN', async () => {
    const { result, lines } = await failWith(`${SLUG} ${CAR_NAME}`);
    expect(result).toEqual({ banner: 'unchecked', vehicles: [] });
    expect(lines).toEqual(['product-fit: fit failed (UNKNOWN)']);
    expectNothingPersonal(lines);
  });

  it('a real database failure gives unchecked and a line with only a driver code', async () => {
    const { product, a } = await world();
    await insertFitment(product.id, a.id, (await source()).feedId);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);
    hoisted.read.mockImplementation((slug: string, id: number) => hoisted.actual!(slug, id));

    const result = await getProductFit(product.slug, selected(a));

    // Both reads hit the dead database: each fails alone and writes its own one line.
    expect(result).toEqual({ banner: 'unchecked', vehicles: null });
    const lines = errorLines();
    expect(error).toHaveBeenCalledTimes(2);
    expect(lines.filter((line) => line.startsWith('product-fit: fit failed'))).toEqual([
      expect.stringMatching(/^product-fit: fit failed \([A-Za-z0-9_]{1,32}\)$/),
    ]);
    expect(lines.filter((line) => line.startsWith('product-fit: vehicles failed'))).toEqual([
      expect.stringMatching(/^product-fit: vehicles failed \([A-Za-z0-9_]{1,32}\)$/),
    ]);
    for (const line of lines) {
      expect(line).not.toContain(product.slug);
      expect(line).not.toContain(a.slug);
      expect(line).not.toContain('nobody');
      expect(line).not.toContain(String(port));
    }

    vi.unstubAllEnvs();
    await closeDb();
  });
});

// ---- #280: the vehicles read and its place in getProductFit (ACs 12 to 17, 21, 26, 27) ----

/** The slugs of a vehicles result, in the order given. */
const slugsOf = (list: { slug: string }[] | null) => (list ?? []).map((vehicle) => vehicle.slug);

/** Twelve catalogue vehicles in list order (ids 1 to 50 exist after resetDatabase), 6 makes. */
const TWELVE = [
  'seat-leon-iii-2012-2020-1-6-tdi-115cv',
  'seat-leon-iii-2012-2020-1-4-tsi-125cv',
  'volkswagen-golf-vii-2012-2020-1-6-tdi-110cv',
  'volkswagen-golf-vii-2012-2020-1-4-tsi-125cv',
  'volkswagen-polo-vi-2017-1-0-tsi-95cv',
  'renault-clio-iv-2012-2019-0-9-tce-90cv',
  'renault-clio-iv-2012-2019-1-5-dci-90cv',
  'renault-megane-iv-2015-1-5-dci-110cv',
  'peugeot-308-ii-2013-2021-1-6-bluehdi-120cv',
  'dacia-sandero-iii-2020-1-0-tce-90cv',
  'dacia-sandero-iii-2020-1-0-tce-eco-g-100cv',
  'ford-puma-i-2019-1-0-ecoboost-hybrid-125cv',
];

describe('readProductVehicles: scope, distinctness and order (AC 12 to 17)', () => {
  async function twelveWorld() {
    const product = await insertListedProduct({ slug: 'producto-doce', prices: [1500] });
    const ids = await Promise.all(TWELVE.map(vehicleIdBySlug));
    return { product, ids };
  }

  it('lists 12 vehicles from three feeds once each, in list position order, whatever the insert order', async () => {
    const { product, ids } = await twelveWorld();
    const feeds = [(await source()).feedId, (await source()).feedId, (await source()).feedId];
    // Reverse insert order, each vehicle from one feed, and every third vehicle from all three.
    for (const [index, id] of [...ids].reverse().entries()) {
      await insertFitment(product.id, id, feeds[index % 3]);
      if (index % 3 === 0) {
        for (const feed of feeds) if (feed !== feeds[index % 3]) await insertFitment(product.id, id, feed);
      }
    }
    const list = await readProductVehicles(product.slug);
    expect(slugsOf(list)).toEqual(TWELVE);
    expect(new Set(slugsOf(list)).size).toBe(12);
    // The catalogue order is the position order (the picker's order).
    const positions = TWELVE.map((slug) => VEHICLE_CATALOGUE.find((entry) => entry.slug === slug)!.position);
    expect(positions).toEqual([...positions].sort((x, y) => x - y));
  });

  it('gives each entry the page fields and no id', async () => {
    const { product, ids } = await twelveWorld();
    await insertFitment(product.id, ids[0], (await source()).feedId);
    const [first] = await readProductVehicles(product.slug);
    const entry = VEHICLE_CATALOGUE.find((item) => item.slug === TWELVE[0])!;
    expect(first).toEqual({
      slug: entry.slug,
      make: entry.make,
      makeSlug: entry.makeSlug,
      model: entry.model,
      modelSlug: entry.modelSlug,
      generation: entry.generation,
      yearFrom: entry.yearFrom,
      yearTo: entry.yearTo,
      engine: entry.engine,
      fuel: entry.fuel,
      powerCv: entry.powerCv,
    });
    expect(first).not.toHaveProperty('id');
  });

  it('breaks a position tie by id', async () => {
    const product = await insertListedProduct({ slug: 'producto-empate', prices: [1000] });
    const first = await insertVehicle({ position: 20000 });
    const second = await insertVehicle({ position: 20000 });
    const feed = (await source()).feedId;
    await insertFitment(product.id, second.id, feed);
    await insertFitment(product.id, first.id, feed);
    expect(slugsOf(await readProductVehicles(product.slug))).toEqual([first.slug, second.slug]);
  });

  it('counted only: unapproved feed, unapproved shop and retired vehicle are left out', async () => {
    const product = await insertListedProduct({ slug: 'producto-alcance', prices: [1000] });
    const ok = await insertVehicle({ position: 30001 });
    const onlyBadFeed = await insertVehicle({ position: 30002 });
    const onlyBadShop = await insertVehicle({ position: 30003 });
    const retired = await insertVehicle({ position: 30004 });
    const good = (await source()).feedId;
    await insertFitment(product.id, ok.id, good);
    await insertFitment(product.id, onlyBadFeed.id, (await source({ feedApproved: false })).feedId);
    await insertFitment(product.id, onlyBadShop.id, (await source({ shopApproved: false })).feedId);
    await insertFitment(product.id, retired.id, good);
    await getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.id, retired.id));
    expect(slugsOf(await readProductVehicles(product.slug))).toEqual([ok.slug]);
  });

  it('a vehicle counted through one feed stays in even when an unapproved feed also names it', async () => {
    const product = await insertListedProduct({ slug: 'producto-mixto', prices: [1000] });
    const car = await insertVehicle();
    await insertFitment(product.id, car.id, (await source({ feedApproved: false })).feedId);
    await insertFitment(product.id, car.id, (await source()).feedId);
    expect(slugsOf(await readProductVehicles(product.slug))).toEqual([car.slug]);
  });

  it('does not list the vehicles of another product', async () => {
    const mine = await insertListedProduct({ slug: 'producto-mio', prices: [1000] });
    const other = await insertListedProduct({ slug: 'producto-ajeno', prices: [1000] });
    const a = await insertVehicle();
    const b = await insertVehicle();
    const feed = (await source()).feedId;
    await insertFitment(mine.id, a.id, feed);
    await insertFitment(other.id, b.id, feed);
    expect(slugsOf(await readProductVehicles(mine.slug))).toEqual([a.slug]);
  });

  it('gives [] for no counted fitment and for a slug that names no product', async () => {
    const bare = await insertListedProduct({ slug: 'producto-vacio', prices: [1000] });
    expect(await readProductVehicles(bare.slug)).toEqual([]);
    expect(await readProductVehicles('no-existe-este-producto')).toEqual([]);
  });
});

describe('readProductVehicles: a product that is not public gives [] (AC 26, guardrail 1)', () => {
  /** A public product with one counted vehicle (proved listed first), then made non-public. */
  async function fitted(extra: Partial<typeof products.$inferInsert> = {}, hideOffer = false) {
    const product = await insertListedProduct({ slug: 'producto-no-publico', prices: [1000] });
    const car = await insertVehicle();
    await insertFitment(product.id, car.id, (await source()).feedId);
    expect(slugsOf(await readProductVehicles(product.slug))).toEqual([car.slug]);
    if (Object.keys(extra).length > 0) await getDb().update(products).set(extra).where(eq(products.id, product.id));
    if (hideOffer) await getDb().update(offers).set({ isHidden: true }).where(eq(offers.productId, product.id));
    return product;
  }

  it('a hidden product', async () => {
    const product = await fitted({ isHidden: true });
    expect(await readProductVehicles(product.slug)).toEqual([]);
  });

  it('a product whose only offer is hidden', async () => {
    const product = await fitted({}, true);
    expect(await readProductVehicles(product.slug)).toEqual([]);
  });

  it('a product with no category', async () => {
    const product = await fitted({ categoryId: null });
    expect(await readProductVehicles(product.slug)).toEqual([]);
  });

  it('a product with no offer', async () => {
    const car = await insertVehicle();
    const product = await insertProduct();
    await insertFitment(product.id, car.id, (await source()).feedId);
    expect(await readProductVehicles(product.slug)).toEqual([]);
  });
});

describe('readProductVehicles: failure (AC 21, 27)', () => {
  it('rejects with the fixed error, no slug, no cause, and logs nothing', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const port = await unusedPort();
    await closeDb();
    vi.stubEnv('DATABASE_URL', `postgres://nobody:pw@127.0.0.1:${port}/nothing`);

    const slug = 'producto-que-no-debe-aparecer';
    const error = await readProductVehicles(slug).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(FitStateError);
    expect((error as FitStateError).message).toBe('fit-state: failed');
    expect((error as FitStateError).message).not.toContain(slug);
    expect((error as FitStateError).cause).toBeUndefined();
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();

    vi.unstubAllEnvs();
    await closeDb();
  });
});

describe('getProductFit: the vehicles for every visitor (AC 12, 13, 15)', () => {
  const cars: [string, (vehicle: { id: number; slug: string }) => CarContext][] = [
    ['no car', () => ({ state: 'none', path: null })],
    ['an unrecognised car', () => ({ state: 'unrecognised', raw: 'coche-que-no-existe', path: null })],
    ['an unavailable car', () => ({ state: 'unavailable', path: null })],
    ['a selected car in the list', (vehicle) => selected(vehicle)],
  ];

  for (const [name, car] of cars) {
    it(`${name}: the list is the product's vehicles`, async () => {
      const { product, a, b } = await world();
      const feed = (await source()).feedId;
      await insertFitment(product.id, a.id, feed);
      await insertFitment(product.id, b.id, feed);
      const fit = await getProductFit(product.slug, car(a));
      expect(slugsOf(fit.vehicles)).toEqual([a.slug, b.slug]);
    });
  }

  it('the banner and the list agree: fits when the list holds the car, no-fit when it does not (AC 15)', async () => {
    const { product, a, b } = await world();
    const outside = await insertVehicle();
    const feed = (await source()).feedId;
    await insertFitment(product.id, a.id, feed);
    await insertFitment(product.id, b.id, feed);

    const inside = await getProductFit(product.slug, selected(a));
    expect(inside.banner).toBe('fits');
    expect(slugsOf(inside.vehicles)).toContain(a.slug);

    const out = await getProductFit(product.slug, selected(outside));
    expect(out.banner).toBe('no-fit');
    expect(slugsOf(out.vehicles)).not.toContain(outside.slug);
    expect(out.vehicles).not.toHaveLength(0);
  });

  it('a product with no counted fitment: [] and the unknown banner (AC 13)', async () => {
    const { product, a } = await world();
    expect(await getProductFit(product.slug, selected(a))).toEqual({ banner: 'unknown', vehicles: [] });
  });
});

describe('getProductFit: each read fails alone, with its own code-only line (AC 10, 21, 27)', () => {
  const SLUG = 'producto-secreto-abc';
  const CAR_NAME = 'Marca Secreta Modelo Oculto 9.9 XYZ';

  function spyAll() {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    return (['log', 'info', 'warn', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
  }

  it('the list read fails: vehicles null, banner as the working read gives it, one vehicles line', async () => {
    const others = spyAll();
    const { product, a, b } = await world();
    const feed = (await source()).feedId;
    await insertFitment(product.id, a.id, feed);
    await insertFitment(product.id, b.id, feed);
    const works = await getProductFit(product.slug, selected(a, CAR_NAME));
    expect(works.banner).toBe('fits');
    expect(errorLines()).toEqual([]);

    hoisted.list.mockReset();
    hoisted.list.mockRejectedValue(Object.assign(new Error(`${SLUG} ${CAR_NAME}`), { code: '57P01' }));
    const result = await getProductFit(product.slug, selected(a, CAR_NAME));

    expect(result).toEqual({ banner: works.banner, vehicles: null });
    expect(errorLines()).toEqual(['product-fit: vehicles failed (57P01)']);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
    for (const secret of [SLUG, CAR_NAME, a.slug, product.slug, String(a.id), 'Secreta']) {
      expect(errorLines().join('\n')).not.toContain(secret);
    }
  });

  it('the list read fails for a visitor with no car: vehicles null, banner null, one line', async () => {
    spyAll();
    hoisted.list.mockReset();
    hoisted.list.mockRejectedValue(new FitStateError('ECONNREFUSED'));
    const result = await getProductFit(SLUG, { state: 'none', path: null });
    expect(result).toEqual({ banner: null, vehicles: null });
    expect(errorLines()).toEqual(['product-fit: vehicles failed (ECONNREFUSED)']);
  });

  it('the banner read fails: banner unchecked, the list intact, one fit line', async () => {
    const others = spyAll();
    const { product, a, b } = await world();
    const feed = (await source()).feedId;
    await insertFitment(product.id, a.id, feed);
    await insertFitment(product.id, b.id, feed);

    hoisted.read.mockReset();
    hoisted.read.mockRejectedValue(new FitStateError('57P01'));
    const result = await getProductFit(product.slug, selected(a, CAR_NAME));

    expect(result.banner).toBe('unchecked');
    expect(slugsOf(result.vehicles)).toEqual([a.slug, b.slug]);
    expect(errorLines()).toEqual(['product-fit: fit failed (57P01)']);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
  });

  it('both fail: unchecked and null, two lines, one each', async () => {
    spyAll();
    hoisted.read.mockReset();
    hoisted.read.mockRejectedValue(new FitStateError('57P01'));
    hoisted.list.mockReset();
    hoisted.list.mockRejectedValue(new FitStateError('08006'));
    const result = await getProductFit(SLUG, selected({ id: 1, slug: 'x' }, CAR_NAME));
    expect(result).toEqual({ banner: 'unchecked', vehicles: null });
    expect([...errorLines()].sort()).toEqual([
      'product-fit: fit failed (57P01)',
      'product-fit: vehicles failed (08006)',
    ]);
  });

  it('a list read that rejects with a non-error logs UNKNOWN, never its text', async () => {
    spyAll();
    hoisted.list.mockReset();
    hoisted.list.mockRejectedValue(`${SLUG} ${CAR_NAME}`);
    const result = await getProductFit(SLUG, { state: 'none', path: null });
    expect(result.vehicles).toBeNull();
    expect(errorLines()).toEqual(['product-fit: vehicles failed (UNKNOWN)']);
  });
});
