import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { offers, products, vehicles } from '@/db/schema';
import type { CarContext } from '@/server/car/state';
import { FitStateError, readProductFitState } from '@/server/catalogue/fit-state';
import { getProductFit } from '@/server/catalogue/product-fit';

import {
  insertFeed,
  insertFitment,
  insertListedProduct,
  insertProduct,
  insertShop,
  insertVehicle,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { unusedPort } from '../support/net';

// S5.9 T5.9.1 (#279): the product page's fit read (readProductFitState) and the wrapper that never
// fails the page (getProductFit). The wrapper's read is mocked ONLY to inject a failure; every other
// case runs the real read against PostgreSQL, so the wrapper is proven on both sides of its seam.

const hoisted = vi.hoisted(() => ({
  read: vi.fn(),
  actual: undefined as undefined | ((slug: string, id: number) => Promise<unknown>),
}));

vi.mock('@/server/catalogue/fit-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/catalogue/fit-state')>();
  hoisted.actual = actual.readProductFitState;
  return { ...actual, readProductFitState: hoisted.read };
});

beforeEach(async () => {
  await resetDatabase();
  hoisted.read.mockReset();
  hoisted.read.mockImplementation((slug: string, id: number) => hoisted.actual!(slug, id));
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

      expect(await getProductFit(product.slug, car)).toEqual({ banner: null });
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

    expect(await getProductFit(product.slug, selected(a))).toEqual({ banner: 'fits' });
    expect(await getProductFit(other.slug, selected(a))).toEqual({ banner: 'no-fit' });
    expect(await getProductFit(bare.slug, selected(a))).toEqual({ banner: 'unknown' });
    expect(hoisted.read).toHaveBeenCalledTimes(3);
    expect(hoisted.read).toHaveBeenCalledWith(product.slug, a.id);
    expect(error).not.toHaveBeenCalled();
  });

  it('a fitment only from an unapproved feed gives unknown, not no-fit (AC 5)', async () => {
    const { product, a, b } = await world();
    await insertFitment(product.id, b.id, (await source({ feedApproved: false })).feedId);
    expect(await getProductFit(product.slug, selected(a))).toEqual({ banner: 'unknown' });
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
    expect(result).toEqual({ banner: 'unchecked' });
    expect(lines).toEqual(['product-fit: fit failed (57P01)']);
    for (const spy of others) expect(spy).not.toHaveBeenCalled();
    expectNothingPersonal(lines);
  });

  it('a FitStateError carries its code into the line', async () => {
    const { result, lines } = await failWith(new FitStateError('ECONNREFUSED'));
    expect(result).toEqual({ banner: 'unchecked' });
    expect(lines).toEqual(['product-fit: fit failed (ECONNREFUSED)']);
  });

  it('an error with no code logs UNKNOWN, never its message', async () => {
    const { result, lines } = await failWith(new Error(`could not read ${SLUG} for ${CAR_NAME} (${VEHICLE.id})`));
    expect(result).toEqual({ banner: 'unchecked' });
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
    expect(result).toEqual({ banner: 'unchecked' });
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

    expect(result).toEqual({ banner: 'unchecked' });
    const lines = errorLines();
    expect(error).toHaveBeenCalledTimes(1);
    expect(lines[0]).toMatch(/^product-fit: fit failed \([A-Za-z0-9_]{1,32}\)$/);
    expect(lines[0]).not.toContain(product.slug);
    expect(lines[0]).not.toContain('nobody');
    expect(lines[0]).not.toContain(String(port));

    vi.unstubAllEnvs();
    await closeDb();
  });
});
