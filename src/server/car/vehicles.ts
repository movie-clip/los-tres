import 'server-only';

import { asc } from 'drizzle-orm';
import { cache } from 'react';

import { getDb } from '../../db/client';
import { vehicles, type VehicleFuel } from '../../db/schema';
import { activeVehicleWhere } from '../visibility';

// The vehicles a visitor can pick (S5.7, C3). The one read of the vehicle list for the
// public site; it names no flag but the vehicle scope in visibility.ts, writes nothing
// and logs nothing (guardrail 5).

export type ActiveVehicle = {
  id: number;
  slug: string;
  make: string;
  makeSlug: string;
  model: string;
  modelSlug: string;
  generation: string;
  yearFrom: number;
  /** Null = still on sale. */
  yearTo: number | null;
  engine: string;
  fuel: VehicleFuel;
  powerCv: number;
};

/**
 * Every active (not retired) vehicle in list order, once per request. A few dozen
 * rows from one indexed table. A database error propagates; the caller decides.
 */
export const readActiveVehicles = cache(async (): Promise<ActiveVehicle[]> => {
  return getDb()
    .select({
      id: vehicles.id,
      slug: vehicles.slug,
      make: vehicles.make,
      makeSlug: vehicles.makeSlug,
      model: vehicles.model,
      modelSlug: vehicles.modelSlug,
      generation: vehicles.generation,
      yearFrom: vehicles.yearFrom,
      yearTo: vehicles.yearTo,
      engine: vehicles.engine,
      fuel: vehicles.fuel,
      powerCv: vehicles.powerCv,
    })
    .from(vehicles)
    .where(activeVehicleWhere())
    .orderBy(asc(vehicles.position), asc(vehicles.id));
});
