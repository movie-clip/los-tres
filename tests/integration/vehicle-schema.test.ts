import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { fitments, vehicles } from '@/db/schema';

import {
  insertFeed,
  insertFitment,
  insertProduct,
  insertShop,
  insertVehicle,
  vehicleIdBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { pgErrorOf } from '../support/pg-error';

beforeEach(resetDatabase);
afterAll(closeDb);

const CHECK_VIOLATION = '23514';
const FOREIGN_KEY_VIOLATION = '23503';
const UNIQUE_VIOLATION = '23505';
const INVALID_ENUM = '22P02';

const MISSING_ID = 2_000_000_000;

describe('vehicles constraints (S5.5, AC 4, 5, 9)', () => {
  it('refuses a fuel outside the five codes', async () => {
    const error = await pgErrorOf(insertVehicle({ fuel: 'bogus' as never }));
    expect(error.code).toBe(INVALID_ENUM);
  });

  it.each(['gasolina', 'diesel', 'hibrido', 'electrico', 'glp'] as const)('accepts the fuel %s', async (fuel) => {
    const { id } = await insertVehicle({ fuel });
    expect(id).toBeGreaterThan(0);
  });

  it('refuses an accented fuel label: the stored values are ASCII codes', async () => {
    const error = await pgErrorOf(insertVehicle({ fuel: 'diésel' as never }));
    expect(error.code).toBe(INVALID_ENUM);
  });

  it('refuses an end year before the start year', async () => {
    const error = await pgErrorOf(insertVehicle({ yearFrom: 2020, yearTo: 2019 }));
    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: 'vehicles_years_valid' });
  });

  it('accepts an end year equal to the start year, and an absent end year', async () => {
    await insertVehicle({ yearFrom: 2020, yearTo: 2020 });
    await insertVehicle({ yearFrom: 2020, yearTo: null });
  });

  it('refuses a missing start year', async () => {
    const error = await pgErrorOf(insertVehicle({ yearFrom: null as never }));
    expect(error.code).toBe('23502');
  });

  it.each([
    ['slug', 'Slug Con Mayúsculas', 'vehicles_slug_format'],
    ['slug', 'con--guiones', 'vehicles_slug_format'],
    ['makeSlug', 'Marca', 'vehicles_make_slug_format'],
    ['modelSlug', 'marca_modelo', 'vehicles_model_slug_format'],
  ] as const)('refuses a malformed %s (%s)', async (key, value, constraint) => {
    const error = await pgErrorOf(insertVehicle({ [key]: value }));
    expect(error).toEqual({ code: CHECK_VIOLATION, constraint });
  });

  it('refuses an empty engine code but accepts an absent one', async () => {
    const error = await pgErrorOf(insertVehicle({ engineCode: '' }));
    expect(error).toEqual({ code: CHECK_VIOLATION, constraint: 'vehicles_engine_code_not_empty' });
    await insertVehicle({ engineCode: null });
    await insertVehicle({ engineCode: 'H4B' });
  });

  it.each([
    ['powerKw', 'vehicles_power_kw_positive'],
    ['powerCv', 'vehicles_power_cv_positive'],
  ] as const)('refuses a %s of zero', async (key, constraint) => {
    const error = await pgErrorOf(insertVehicle({ [key]: 0 }));
    expect(error).toEqual({ code: CHECK_VIOLATION, constraint });
  });

  it('refuses a second vehicle with a slug already in the database', async () => {
    const slug = (await getDb().select({ slug: vehicles.slug }).from(vehicles).limit(1))[0].slug;
    const error = await pgErrorOf(insertVehicle({ slug }));
    expect(error.code).toBe(UNIQUE_VIOLATION);
  });

  it('starts active: a new vehicle is not retired unless it says so', async () => {
    const { slug } = await insertVehicle();
    const [row] = await getDb().select().from(vehicles).where(sql`${vehicles.slug} = ${slug}`);
    expect(row.isRetired).toBe(false);
  });
});

describe('fitments constraints (S5.5, AC 17, 18)', () => {
  async function pieces() {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const otherFeedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const vehicleId = await vehicleIdBySlug((await getDb().select({ slug: vehicles.slug }).from(vehicles).limit(1))[0].slug);
    return { feedId, otherFeedId, productId: product.id, vehicleId };
  }

  it('refuses a fitment to a product that does not exist', async () => {
    const { feedId, vehicleId } = await pieces();
    const error = await pgErrorOf(insertFitment(MISSING_ID, vehicleId, feedId));
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses a fitment to a vehicle that does not exist', async () => {
    const { feedId, productId } = await pieces();
    const error = await pgErrorOf(insertFitment(productId, MISSING_ID, feedId));
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses a fitment from a feed that does not exist', async () => {
    const { productId, vehicleId } = await pieces();
    const error = await pgErrorOf(insertFitment(productId, vehicleId, MISSING_ID));
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it('refuses the same product, vehicle and feed twice', async () => {
    const { feedId, productId, vehicleId } = await pieces();
    await insertFitment(productId, vehicleId, feedId);
    const error = await pgErrorOf(insertFitment(productId, vehicleId, feedId));
    expect(error).toEqual({ code: UNIQUE_VIOLATION, constraint: 'fitments_product_id_vehicle_id_feed_id_unique' });
  });

  it('accepts the same product and vehicle from a different feed', async () => {
    const { feedId, otherFeedId, productId, vehicleId } = await pieces();
    await insertFitment(productId, vehicleId, feedId);
    await insertFitment(productId, vehicleId, otherFeedId);
    expect(await getDb().select().from(fitments)).toHaveLength(2);
  });

  it('accepts the same feed and vehicle for a different product, and the same product and feed for a different vehicle', async () => {
    const { feedId, productId, vehicleId } = await pieces();
    const otherProduct = await insertProduct();
    const otherVehicle = await insertVehicle();
    await insertFitment(productId, vehicleId, feedId);
    await insertFitment(otherProduct.id, vehicleId, feedId);
    await insertFitment(productId, otherVehicle.id, feedId);
    expect(await getDb().select().from(fitments)).toHaveLength(3);
  });

  it('does not let a vehicle with fitments be deleted (restrict)', async () => {
    const { feedId, productId, vehicleId } = await pieces();
    await insertFitment(productId, vehicleId, feedId);
    const error = await pgErrorOf(getDb().execute(sql`delete from vehicles where id = ${vehicleId}`));
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});
