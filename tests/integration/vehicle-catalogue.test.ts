import { asc, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { runMigrations } from '@/db/migrate';
import {
  categories,
  feedCategoryMappings,
  feeds,
  fitments,
  offers,
  products,
  shops,
  vehicles,
} from '@/db/schema';
import { ensureVehicleCatalogue, VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { seedDemoData } from '@/server/seed';

import {
  insertCategoryMapping,
  insertFeed,
  insertFitment,
  insertOffer,
  insertProduct,
  insertShop,
  insertVehicle,
  vehicleIdBySlug,
} from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(closeDb);

const allVehicles = () => getDb().select().from(vehicles).orderBy(asc(vehicles.id));
const vehicleRow = async (slug: string) =>
  (await getDb().select().from(vehicles).where(eq(vehicles.slug, slug)))[0];

const FIRST = VEHICLE_CATALOGUE[0];
const SECOND = VEHICLE_CATALOGUE[1];

describe('the vehicle list after migrate (S5.5, AC 10, 16)', () => {
  it('exists after the per-test reset: every listed vehicle, active, with the values of the list', async () => {
    const rows = await allVehicles();
    expect(rows).toHaveLength(VEHICLE_CATALOGUE.length);
    for (const entry of VEHICLE_CATALOGUE) {
      const row = rows.find((candidate) => candidate.slug === entry.slug);
      expect(row, entry.slug).toBeDefined();
      expect(row).toMatchObject({ ...entry, isRetired: false });
    }
  });

  it.each([
    ['unset', undefined],
    ['blank', ''],
    ['false', 'false'],
  ])(
    'runMigrations on an empty vehicles table fills the list with SEED_DEMO_DATA %s (AC 11)',
    async (_label, value) => {
      if (value === undefined) vi.stubEnv('SEED_DEMO_DATA', undefined as unknown as string);
      else vi.stubEnv('SEED_DEMO_DATA', value);
      await getDb().delete(vehicles);
      expect(await allVehicles()).toEqual([]);

      await runMigrations(getDb());

      const rows = await allVehicles();
      expect(rows.map((row) => row.slug).sort()).toEqual(VEHICLE_CATALOGUE.map((entry) => entry.slug).sort());
      expect(rows.every((row) => !row.isRetired)).toBe(true);
    },
  );

  it('the seed creates no vehicle (AC 11)', async () => {
    await getDb().delete(vehicles);
    await seedDemoData(getDb());
    expect(await allVehicles()).toEqual([]);
  });
});

describe('running migrate again (S5.5, AC 12, 15)', () => {
  it('runMigrations twice keeps every vehicle row, id included', async () => {
    const before = await allVehicles();
    await runMigrations(getDb());
    await runMigrations(getDb());
    expect(await allVehicles()).toEqual(before);
  });

  it('keeps the fitments of a vehicle, row for row', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const vehicleId = await vehicleIdBySlug(FIRST.slug);
    await insertFitment(product.id, vehicleId, feedId);
    const before = await getDb().select().from(fitments);

    await runMigrations(getDb());
    await runMigrations(getDb());

    expect(await getDb().select().from(fitments)).toEqual(before);
    expect(before).toHaveLength(1);
  });

  it('touches no other table: shops, feeds, products, offers, mappings, categories and fitments are unchanged', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    await insertOffer({ productId: product.id, feedId });
    await insertCategoryMapping(feedId, 'Recambios > Filtros', (await getDb().select().from(categories))[0].id);
    await insertFitment(product.id, await vehicleIdBySlug(FIRST.slug), feedId);
    const snapshot = async () => ({
      shops: await getDb().select().from(shops).orderBy(asc(shops.id)),
      feeds: await getDb().select().from(feeds).orderBy(asc(feeds.id)),
      products: await getDb().select().from(products).orderBy(asc(products.id)),
      offers: await getDb().select().from(offers).orderBy(asc(offers.id)),
      mappings: await getDb().select().from(feedCategoryMappings),
      categories: await getDb().select().from(categories).orderBy(asc(categories.id)),
      fitments: await getDb().select().from(fitments).orderBy(asc(fitments.id)),
    });
    const before = await snapshot();

    await runMigrations(getDb());
    await ensureVehicleCatalogue(getDb(), [FIRST]);

    expect(await snapshot()).toEqual(before);
  });
});

describe('a hand-edited vehicle row (S5.5, AC 13)', () => {
  it('goes back to the list on the next migrate, keeping its id', async () => {
    const before = await vehicleRow(FIRST.slug);
    await getDb()
      .update(vehicles)
      .set({
        model: 'Renombrado a mano',
        engine: 'Motor a mano',
        engineCode: 'XYZ',
        yearTo: 2015,
        fuel: 'glp',
        powerKw: 1,
        powerCv: 2,
        position: 99999,
        isRetired: true,
      })
      .where(eq(vehicles.slug, FIRST.slug));

    await runMigrations(getDb());

    expect(await vehicleRow(FIRST.slug)).toEqual(before);
  });

  it('restores an engine code that was set by hand on a vehicle that lists none', async () => {
    const entry = VEHICLE_CATALOGUE.find((candidate) => candidate.engineCode === null);
    expect(entry).toBeDefined();
    await getDb().update(vehicles).set({ engineCode: 'A MANO' }).where(eq(vehicles.slug, entry!.slug));

    await ensureVehicleCatalogue(getDb());

    expect((await vehicleRow(entry!.slug)).engineCode).toBeNull();
  });
});

describe('a vehicle that leaves the list (S5.5, AC 7, 14, 15)', () => {
  const shorter = VEHICLE_CATALOGUE.filter((entry) => entry.slug !== FIRST.slug);

  it('is flagged retired, not deleted, and keeps its fitments; the others stay active', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const before = await vehicleRow(FIRST.slug);
    await insertFitment(product.id, before.id, feedId);

    await ensureVehicleCatalogue(getDb(), shorter);

    const rows = await allVehicles();
    expect(rows).toHaveLength(VEHICLE_CATALOGUE.length);
    expect(await vehicleRow(FIRST.slug)).toEqual({ ...before, isRetired: true });
    expect(rows.filter((row) => row.isRetired).map((row) => row.slug)).toEqual([FIRST.slug]);
    const kept = await getDb().select().from(fitments);
    expect(kept).toHaveLength(1);
    expect(kept[0].vehicleId).toBe(before.id);
  });

  it('is active again with the same id when it is put back under the same slug', async () => {
    const before = await vehicleRow(FIRST.slug);
    await ensureVehicleCatalogue(getDb(), shorter);
    expect((await vehicleRow(FIRST.slug)).isRetired).toBe(true);

    await ensureVehicleCatalogue(getDb());

    expect(await vehicleRow(FIRST.slug)).toEqual(before);
  });

  it('retires a vehicle added to the database outside the list on the next runMigrations, and keeps it', async () => {
    const extra = await insertVehicle();
    expect((await vehicleRow(extra.slug)).isRetired).toBe(false);

    await runMigrations(getDb());

    const row = await vehicleRow(extra.slug);
    expect(row.id).toBe(extra.id);
    expect(row.isRetired).toBe(true);
    expect(await allVehicles()).toHaveLength(VEHICLE_CATALOGUE.length + 1);
  });

  it('writes nothing on a re-run once the vehicle is retired', async () => {
    await ensureVehicleCatalogue(getDb(), shorter);
    const retired = await allVehicles();
    await ensureVehicleCatalogue(getDb(), shorter);
    expect(await allVehicles()).toEqual(retired);
  });

  it('refuses an empty list and retires nothing', async () => {
    await expect(ensureVehicleCatalogue(getDb(), [])).rejects.toThrow(/empty/);
    const rows = await allVehicles();
    expect(rows).toHaveLength(VEHICLE_CATALOGUE.length);
    expect(rows.some((row) => row.isRetired)).toBe(false);
  });

  it('retires several at once, and leaves the survivors untouched', async () => {
    const before = await vehicleRow(SECOND.slug);
    await ensureVehicleCatalogue(getDb(), [SECOND]);
    const rows = await allVehicles();
    expect(rows.filter((row) => !row.isRetired).map((row) => row.slug)).toEqual([SECOND.slug]);
    expect(await vehicleRow(SECOND.slug)).toEqual(before);
  });
});

describe('the per-test reset (S5.5, AC 16)', () => {
  it('truncates an extra vehicle and its fitments, then restores exactly the list', async () => {
    const shop = await insertShop();
    const feedId = await insertFeed(shop.id);
    const product = await insertProduct();
    const extra = await insertVehicle();
    await insertFitment(product.id, extra.id, feedId);

    await resetDatabase();

    const rows = await allVehicles();
    expect(rows.map((row) => row.slug).sort()).toEqual(VEHICLE_CATALOGUE.map((entry) => entry.slug).sort());
    expect(rows.every((row) => !row.isRetired)).toBe(true);
    expect(await getDb().select().from(fitments)).toEqual([]);
  });
});
