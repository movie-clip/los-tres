import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { vehicles } from '@/db/schema';
import { readActiveVehicles } from '@/server/car/vehicles';

import { insertVehicle } from '../support/catalogue';
import { resetDatabase } from '../support/db';

beforeEach(resetDatabase);
afterAll(closeDb);

// The one read of the vehicle list for the public site (S5.7, C3).

async function retire(slug: string) {
  await getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.slug, slug));
}

describe('readActiveVehicles', () => {
  it('returns the seeded list in position order, ids breaking ties', async () => {
    const rows = await readActiveVehicles();
    expect(rows.length).toBeGreaterThan(0);
    const positions = await getDb()
      .select({ slug: vehicles.slug, position: vehicles.position, id: vehicles.id })
      .from(vehicles)
      .where(eq(vehicles.isRetired, false));
    const expected = [...positions]
      .sort((a, b) => a.position - b.position || a.id - b.id)
      .map((r) => r.slug);
    expect(rows.map((r) => r.slug)).toEqual(expected);
  });

  it('carries the fields the picker and the context need', async () => {
    const { slug } = await insertVehicle({
      make: 'Zeta',
      makeSlug: 'zeta',
      model: 'Uno',
      modelSlug: 'zeta-uno-i',
      generation: 'I',
      yearFrom: 2011,
      yearTo: 2015,
      engine: '2.0 X',
      fuel: 'diesel',
      powerCv: 150,
    });
    const row = (await readActiveVehicles()).find((r) => r.slug === slug);
    expect(row).toMatchObject({
      slug,
      make: 'Zeta',
      makeSlug: 'zeta',
      model: 'Uno',
      modelSlug: 'zeta-uno-i',
      generation: 'I',
      yearFrom: 2011,
      yearTo: 2015,
      engine: '2.0 X',
      fuel: 'diesel',
      powerCv: 150,
    });
    expect(typeof row?.id).toBe('number');
  });

  it('keeps yearTo null for a vehicle still on sale', async () => {
    const { slug } = await insertVehicle({ yearTo: null });
    expect((await readActiveVehicles()).find((r) => r.slug === slug)?.yearTo).toBeNull();
  });

  it('excludes a retired vehicle', async () => {
    const kept = await insertVehicle();
    const gone = await insertVehicle();
    await retire(gone.slug);
    const slugs = (await readActiveVehicles()).map((r) => r.slug);
    expect(slugs).toContain(kept.slug);
    expect(slugs).not.toContain(gone.slug);
  });

  it('lists a make again once one of its vehicles is active, and not before', async () => {
    const only = await insertVehicle({ make: 'Solo', makeSlug: 'solo', modelSlug: 'solo-a-i' });
    await retire(only.slug);
    expect((await readActiveVehicles()).some((r) => r.makeSlug === 'solo')).toBe(false);
    await getDb().update(vehicles).set({ isRetired: false }).where(eq(vehicles.slug, only.slug));
    expect((await readActiveVehicles()).some((r) => r.makeSlug === 'solo')).toBe(true);
  });

  it('drops every row of a make whose vehicles are all retired', async () => {
    const a = await insertVehicle({ make: 'Gone', makeSlug: 'gone', modelSlug: 'gone-a-i' });
    const b = await insertVehicle({ make: 'Gone', makeSlug: 'gone', modelSlug: 'gone-b-i' });
    await retire(a.slug);
    await retire(b.slug);
    expect((await readActiveVehicles()).filter((r) => r.makeSlug === 'gone')).toEqual([]);
  });

  it('drops a model whose vehicles are all retired but keeps its make with another model', async () => {
    const a = await insertVehicle({ makeSlug: 'mixto', modelSlug: 'mixto-a-i' });
    const b = await insertVehicle({ makeSlug: 'mixto', modelSlug: 'mixto-b-i' });
    await retire(a.slug);
    const rows = (await readActiveVehicles()).filter((r) => r.makeSlug === 'mixto');
    expect(rows.map((r) => r.slug)).toEqual([b.slug]);
    expect(rows.some((r) => r.modelSlug === 'mixto-a-i')).toBe(false);
  });

  it('orders by position, whatever the insertion order', async () => {
    const late = await insertVehicle({ position: 20002 });
    const early = await insertVehicle({ position: 20001 });
    const slugs = (await readActiveVehicles()).map((r) => r.slug);
    expect(slugs.indexOf(early.slug)).toBeLessThan(slugs.indexOf(late.slug));
  });

  it('lists a vehicle that has no fitment (it needs none to be pickable)', async () => {
    const { slug } = await insertVehicle();
    expect((await readActiveVehicles()).map((r) => r.slug)).toContain(slug);
  });

  it('reads the table afresh outside a request: a change shows on the next call', async () => {
    const { slug } = await insertVehicle();
    expect((await readActiveVehicles()).map((r) => r.slug)).toContain(slug);
    await retire(slug);
    expect((await readActiveVehicles()).map((r) => r.slug)).not.toContain(slug);
  });
});
