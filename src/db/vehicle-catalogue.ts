import { and, eq, notInArray } from 'drizzle-orm';

import type { Database } from './client';
import { vehicles, type VehicleFuel } from './schema';

export type VehicleEntry = {
  readonly slug: string;
  readonly make: string;
  readonly makeSlug: string;
  readonly model: string;
  /** Picker step-2 key: make + model + generation, e.g. `seat-leon-iii`. */
  readonly modelSlug: string;
  readonly generation: string;
  readonly yearFrom: number;
  /** Null = still on sale. */
  readonly yearTo: number | null;
  readonly engine: string;
  /** Null when absent, never an empty string. */
  readonly engineCode: string | null;
  readonly fuel: VehicleFuel;
  readonly powerKw: number;
  readonly powerCv: number;
  readonly position: number;
};

/**
 * The vehicles of the MVP: cars common in Spain, one entry per make + model
 * generation + engine (S5.5, decision 0016). Defined once, here.
 *
 * Every slug is a frozen identifier, written by hand and never re-derived from
 * the fields (a generation's end year arriving later must not change it). A new
 * entry follows `<make>-<model>-<generation>-<yearFrom>[-<yearTo>]-<engine>-<cv>cv`.
 * A slug is never reused for a different car. To retire a vehicle, delete its
 * entry: the next migrate flags the row retired and keeps it, with its
 * fitments. Positions are steps of 10 in list order. A unit test pins the whole
 * constant on purpose.
 */
export const VEHICLE_CATALOGUE: readonly VehicleEntry[] = [
  // Seat
  { slug: 'seat-leon-iii-2012-2020-1-6-tdi-115cv', make: 'Seat', makeSlug: 'seat', model: 'León', modelSlug: 'seat-leon-iii', generation: 'III', yearFrom: 2012, yearTo: 2020, engine: '1.6 TDI', engineCode: null, fuel: 'diesel', powerKw: 85, powerCv: 115, position: 10 },
  { slug: 'seat-leon-iii-2012-2020-1-4-tsi-125cv', make: 'Seat', makeSlug: 'seat', model: 'León', modelSlug: 'seat-leon-iii', generation: 'III', yearFrom: 2012, yearTo: 2020, engine: '1.4 TSI', engineCode: null, fuel: 'gasolina', powerKw: 92, powerCv: 125, position: 20 },
  { slug: 'seat-ibiza-iv-2008-2017-1-2-tsi-90cv', make: 'Seat', makeSlug: 'seat', model: 'Ibiza', modelSlug: 'seat-ibiza-iv', generation: 'IV', yearFrom: 2008, yearTo: 2017, engine: '1.2 TSI', engineCode: null, fuel: 'gasolina', powerKw: 66, powerCv: 90, position: 30 },
  { slug: 'seat-ibiza-v-2017-1-0-tsi-95cv', make: 'Seat', makeSlug: 'seat', model: 'Ibiza', modelSlug: 'seat-ibiza-v', generation: 'V', yearFrom: 2017, yearTo: null, engine: '1.0 TSI', engineCode: null, fuel: 'gasolina', powerKw: 70, powerCv: 95, position: 40 },
  { slug: 'seat-arona-i-2017-1-0-tsi-110cv', make: 'Seat', makeSlug: 'seat', model: 'Arona', modelSlug: 'seat-arona-i', generation: 'I', yearFrom: 2017, yearTo: null, engine: '1.0 TSI', engineCode: null, fuel: 'gasolina', powerKw: 81, powerCv: 110, position: 50 },
  // Volkswagen
  { slug: 'volkswagen-golf-vii-2012-2020-1-6-tdi-110cv', make: 'Volkswagen', makeSlug: 'volkswagen', model: 'Golf', modelSlug: 'volkswagen-golf-vii', generation: 'VII', yearFrom: 2012, yearTo: 2020, engine: '1.6 TDI', engineCode: null, fuel: 'diesel', powerKw: 81, powerCv: 110, position: 60 },
  { slug: 'volkswagen-golf-vii-2012-2020-1-4-tsi-125cv', make: 'Volkswagen', makeSlug: 'volkswagen', model: 'Golf', modelSlug: 'volkswagen-golf-vii', generation: 'VII', yearFrom: 2012, yearTo: 2020, engine: '1.4 TSI', engineCode: null, fuel: 'gasolina', powerKw: 92, powerCv: 125, position: 70 },
  { slug: 'volkswagen-polo-vi-2017-1-0-tsi-95cv', make: 'Volkswagen', makeSlug: 'volkswagen', model: 'Polo', modelSlug: 'volkswagen-polo-vi', generation: 'VI', yearFrom: 2017, yearTo: null, engine: '1.0 TSI', engineCode: null, fuel: 'gasolina', powerKw: 70, powerCv: 95, position: 80 },
  { slug: 'volkswagen-passat-b8-2014-2-0-tdi-150cv', make: 'Volkswagen', makeSlug: 'volkswagen', model: 'Passat', modelSlug: 'volkswagen-passat-b8', generation: 'B8', yearFrom: 2014, yearTo: null, engine: '2.0 TDI', engineCode: null, fuel: 'diesel', powerKw: 110, powerCv: 150, position: 90 },
  { slug: 'volkswagen-tiguan-ii-2016-2-0-tdi-150cv', make: 'Volkswagen', makeSlug: 'volkswagen', model: 'Tiguan', modelSlug: 'volkswagen-tiguan-ii', generation: 'II', yearFrom: 2016, yearTo: null, engine: '2.0 TDI', engineCode: null, fuel: 'diesel', powerKw: 110, powerCv: 150, position: 100 },
  // Renault
  { slug: 'renault-clio-iv-2012-2019-0-9-tce-90cv', make: 'Renault', makeSlug: 'renault', model: 'Clio', modelSlug: 'renault-clio-iv', generation: 'IV', yearFrom: 2012, yearTo: 2019, engine: '0.9 TCe', engineCode: 'H4B', fuel: 'gasolina', powerKw: 66, powerCv: 90, position: 110 },
  { slug: 'renault-clio-iv-2012-2019-1-5-dci-90cv', make: 'Renault', makeSlug: 'renault', model: 'Clio', modelSlug: 'renault-clio-iv', generation: 'IV', yearFrom: 2012, yearTo: 2019, engine: '1.5 dCi', engineCode: null, fuel: 'diesel', powerKw: 66, powerCv: 90, position: 120 },
  { slug: 'renault-clio-v-2019-1-0-tce-100cv', make: 'Renault', makeSlug: 'renault', model: 'Clio', modelSlug: 'renault-clio-v', generation: 'V', yearFrom: 2019, yearTo: null, engine: '1.0 TCe', engineCode: null, fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 130 },
  { slug: 'renault-megane-iv-2015-1-5-dci-110cv', make: 'Renault', makeSlug: 'renault', model: 'Mégane', modelSlug: 'renault-megane-iv', generation: 'IV', yearFrom: 2015, yearTo: null, engine: '1.5 dCi', engineCode: null, fuel: 'diesel', powerKw: 81, powerCv: 110, position: 140 },
  { slug: 'renault-captur-ii-2019-1-3-tce-140cv', make: 'Renault', makeSlug: 'renault', model: 'Captur', modelSlug: 'renault-captur-ii', generation: 'II', yearFrom: 2019, yearTo: null, engine: '1.3 TCe', engineCode: null, fuel: 'gasolina', powerKw: 103, powerCv: 140, position: 150 },
  // Peugeot
  { slug: 'peugeot-208-i-2012-2019-1-2-puretech-82cv', make: 'Peugeot', makeSlug: 'peugeot', model: '208', modelSlug: 'peugeot-208-i', generation: 'I', yearFrom: 2012, yearTo: 2019, engine: '1.2 PureTech', engineCode: null, fuel: 'gasolina', powerKw: 60, powerCv: 82, position: 160 },
  { slug: 'peugeot-208-ii-2019-1-2-puretech-100cv', make: 'Peugeot', makeSlug: 'peugeot', model: '208', modelSlug: 'peugeot-208-ii', generation: 'II', yearFrom: 2019, yearTo: null, engine: '1.2 PureTech', engineCode: null, fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 170 },
  { slug: 'peugeot-308-ii-2013-2021-1-6-bluehdi-120cv', make: 'Peugeot', makeSlug: 'peugeot', model: '308', modelSlug: 'peugeot-308-ii', generation: 'II', yearFrom: 2013, yearTo: 2021, engine: '1.6 BlueHDi', engineCode: null, fuel: 'diesel', powerKw: 88, powerCv: 120, position: 180 },
  { slug: 'peugeot-2008-ii-2019-1-2-puretech-130cv', make: 'Peugeot', makeSlug: 'peugeot', model: '2008', modelSlug: 'peugeot-2008-ii', generation: 'II', yearFrom: 2019, yearTo: null, engine: '1.2 PureTech', engineCode: null, fuel: 'gasolina', powerKw: 96, powerCv: 130, position: 190 },
  { slug: 'peugeot-3008-ii-2016-1-5-bluehdi-130cv', make: 'Peugeot', makeSlug: 'peugeot', model: '3008', modelSlug: 'peugeot-3008-ii', generation: 'II', yearFrom: 2016, yearTo: null, engine: '1.5 BlueHDi', engineCode: null, fuel: 'diesel', powerKw: 96, powerCv: 130, position: 200 },
  // Citroën
  { slug: 'citroen-c3-iii-2016-1-2-puretech-82cv', make: 'Citroën', makeSlug: 'citroen', model: 'C3', modelSlug: 'citroen-c3-iii', generation: 'III', yearFrom: 2016, yearTo: null, engine: '1.2 PureTech', engineCode: null, fuel: 'gasolina', powerKw: 60, powerCv: 82, position: 210 },
  { slug: 'citroen-c4-cactus-i-2014-2020-1-6-bluehdi-100cv', make: 'Citroën', makeSlug: 'citroen', model: 'C4 Cactus', modelSlug: 'citroen-c4-cactus-i', generation: 'I', yearFrom: 2014, yearTo: 2020, engine: '1.6 BlueHDi', engineCode: null, fuel: 'diesel', powerKw: 73, powerCv: 100, position: 220 },
  { slug: 'citroen-c3-aircross-i-2017-1-2-puretech-110cv', make: 'Citroën', makeSlug: 'citroen', model: 'C3 Aircross', modelSlug: 'citroen-c3-aircross-i', generation: 'I', yearFrom: 2017, yearTo: null, engine: '1.2 PureTech', engineCode: null, fuel: 'gasolina', powerKw: 81, powerCv: 110, position: 230 },
  { slug: 'citroen-berlingo-iii-2018-1-5-bluehdi-130cv', make: 'Citroën', makeSlug: 'citroen', model: 'Berlingo', modelSlug: 'citroen-berlingo-iii', generation: 'III', yearFrom: 2018, yearTo: null, engine: '1.5 BlueHDi', engineCode: null, fuel: 'diesel', powerKw: 96, powerCv: 130, position: 240 },
  // Toyota
  { slug: 'toyota-yaris-iv-2020-1-5-hybrid-116cv', make: 'Toyota', makeSlug: 'toyota', model: 'Yaris', modelSlug: 'toyota-yaris-iv', generation: 'IV', yearFrom: 2020, yearTo: null, engine: '1.5 Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 85, powerCv: 116, position: 250 },
  { slug: 'toyota-corolla-e210-2019-1-8-hybrid-122cv', make: 'Toyota', makeSlug: 'toyota', model: 'Corolla', modelSlug: 'toyota-corolla-e210', generation: 'E210', yearFrom: 2019, yearTo: null, engine: '1.8 Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 90, powerCv: 122, position: 260 },
  { slug: 'toyota-auris-ii-2012-2018-1-4-d-4d-90cv', make: 'Toyota', makeSlug: 'toyota', model: 'Auris', modelSlug: 'toyota-auris-ii', generation: 'II', yearFrom: 2012, yearTo: 2018, engine: '1.4 D-4D', engineCode: null, fuel: 'diesel', powerKw: 66, powerCv: 90, position: 270 },
  { slug: 'toyota-rav4-v-2018-2-5-hybrid-218cv', make: 'Toyota', makeSlug: 'toyota', model: 'RAV4', modelSlug: 'toyota-rav4-v', generation: 'V', yearFrom: 2018, yearTo: null, engine: '2.5 Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 160, powerCv: 218, position: 280 },
  { slug: 'toyota-c-hr-i-2016-1-8-hybrid-122cv', make: 'Toyota', makeSlug: 'toyota', model: 'C-HR', modelSlug: 'toyota-c-hr-i', generation: 'I', yearFrom: 2016, yearTo: null, engine: '1.8 Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 90, powerCv: 122, position: 290 },
  // Dacia
  { slug: 'dacia-sandero-iii-2020-1-0-tce-90cv', make: 'Dacia', makeSlug: 'dacia', model: 'Sandero', modelSlug: 'dacia-sandero-iii', generation: 'III', yearFrom: 2020, yearTo: null, engine: '1.0 TCe', engineCode: null, fuel: 'gasolina', powerKw: 67, powerCv: 90, position: 300 },
  { slug: 'dacia-sandero-iii-2020-1-0-tce-eco-g-100cv', make: 'Dacia', makeSlug: 'dacia', model: 'Sandero', modelSlug: 'dacia-sandero-iii', generation: 'III', yearFrom: 2020, yearTo: null, engine: '1.0 TCe Eco-G', engineCode: null, fuel: 'glp', powerKw: 74, powerCv: 100, position: 310 },
  { slug: 'dacia-duster-ii-2018-1-5-dci-115cv', make: 'Dacia', makeSlug: 'dacia', model: 'Duster', modelSlug: 'dacia-duster-ii', generation: 'II', yearFrom: 2018, yearTo: null, engine: '1.5 dCi', engineCode: null, fuel: 'diesel', powerKw: 85, powerCv: 115, position: 320 },
  { slug: 'dacia-jogger-i-2022-1-0-tce-110cv', make: 'Dacia', makeSlug: 'dacia', model: 'Jogger', modelSlug: 'dacia-jogger-i', generation: 'I', yearFrom: 2022, yearTo: null, engine: '1.0 TCe', engineCode: null, fuel: 'gasolina', powerKw: 81, powerCv: 110, position: 330 },
  // Ford
  { slug: 'ford-fiesta-vii-2017-2023-1-0-ecoboost-100cv', make: 'Ford', makeSlug: 'ford', model: 'Fiesta', modelSlug: 'ford-fiesta-vii', generation: 'VII', yearFrom: 2017, yearTo: 2023, engine: '1.0 EcoBoost', engineCode: null, fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 340 },
  { slug: 'ford-focus-iii-2011-2018-1-6-tdci-115cv', make: 'Ford', makeSlug: 'ford', model: 'Focus', modelSlug: 'ford-focus-iii', generation: 'III', yearFrom: 2011, yearTo: 2018, engine: '1.6 TDCi', engineCode: null, fuel: 'diesel', powerKw: 85, powerCv: 115, position: 350 },
  { slug: 'ford-focus-iv-2018-1-0-ecoboost-125cv', make: 'Ford', makeSlug: 'ford', model: 'Focus', modelSlug: 'ford-focus-iv', generation: 'IV', yearFrom: 2018, yearTo: null, engine: '1.0 EcoBoost', engineCode: null, fuel: 'gasolina', powerKw: 92, powerCv: 125, position: 360 },
  { slug: 'ford-kuga-ii-2012-2019-2-0-tdci-150cv', make: 'Ford', makeSlug: 'ford', model: 'Kuga', modelSlug: 'ford-kuga-ii', generation: 'II', yearFrom: 2012, yearTo: 2019, engine: '2.0 TDCi', engineCode: null, fuel: 'diesel', powerKw: 110, powerCv: 150, position: 370 },
  { slug: 'ford-puma-i-2019-1-0-ecoboost-hybrid-125cv', make: 'Ford', makeSlug: 'ford', model: 'Puma', modelSlug: 'ford-puma-i', generation: 'I', yearFrom: 2019, yearTo: null, engine: '1.0 EcoBoost Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 92, powerCv: 125, position: 380 },
  // Opel
  { slug: 'opel-corsa-d-2006-2014-1-4-100cv', make: 'Opel', makeSlug: 'opel', model: 'Corsa', modelSlug: 'opel-corsa-d', generation: 'D', yearFrom: 2006, yearTo: 2014, engine: '1.4', engineCode: 'A14XER', fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 390 },
  { slug: 'opel-corsa-f-2019-1-2-turbo-100cv', make: 'Opel', makeSlug: 'opel', model: 'Corsa', modelSlug: 'opel-corsa-f', generation: 'F', yearFrom: 2019, yearTo: null, engine: '1.2 Turbo', engineCode: null, fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 400 },
  { slug: 'opel-astra-k-2015-2021-1-6-cdti-110cv', make: 'Opel', makeSlug: 'opel', model: 'Astra', modelSlug: 'opel-astra-k', generation: 'K', yearFrom: 2015, yearTo: 2021, engine: '1.6 CDTI', engineCode: null, fuel: 'diesel', powerKw: 81, powerCv: 110, position: 410 },
  { slug: 'opel-mokka-b-2020-1-2-turbo-130cv', make: 'Opel', makeSlug: 'opel', model: 'Mokka', modelSlug: 'opel-mokka-b', generation: 'B', yearFrom: 2020, yearTo: null, engine: '1.2 Turbo', engineCode: null, fuel: 'gasolina', powerKw: 96, powerCv: 130, position: 420 },
  // Kia
  { slug: 'kia-ceed-iii-2018-1-0-t-gdi-120cv', make: 'Kia', makeSlug: 'kia', model: 'Ceed', modelSlug: 'kia-ceed-iii', generation: 'III', yearFrom: 2018, yearTo: null, engine: '1.0 T-GDi', engineCode: null, fuel: 'gasolina', powerKw: 88, powerCv: 120, position: 430 },
  { slug: 'kia-sportage-iv-2015-2021-1-7-crdi-115cv', make: 'Kia', makeSlug: 'kia', model: 'Sportage', modelSlug: 'kia-sportage-iv', generation: 'IV', yearFrom: 2015, yearTo: 2021, engine: '1.7 CRDi', engineCode: null, fuel: 'diesel', powerKw: 85, powerCv: 115, position: 440 },
  { slug: 'kia-picanto-iii-2017-1-0-67cv', make: 'Kia', makeSlug: 'kia', model: 'Picanto', modelSlug: 'kia-picanto-iii', generation: 'III', yearFrom: 2017, yearTo: null, engine: '1.0', engineCode: null, fuel: 'gasolina', powerKw: 49, powerCv: 67, position: 450 },
  { slug: 'kia-niro-i-2016-2022-1-6-gdi-hybrid-141cv', make: 'Kia', makeSlug: 'kia', model: 'Niro', modelSlug: 'kia-niro-i', generation: 'I', yearFrom: 2016, yearTo: 2022, engine: '1.6 GDi Hybrid', engineCode: null, fuel: 'hibrido', powerKw: 104, powerCv: 141, position: 460 },
  // Hyundai
  { slug: 'hyundai-i30-iii-2017-1-0-t-gdi-120cv', make: 'Hyundai', makeSlug: 'hyundai', model: 'i30', modelSlug: 'hyundai-i30-iii', generation: 'III', yearFrom: 2017, yearTo: null, engine: '1.0 T-GDi', engineCode: null, fuel: 'gasolina', powerKw: 88, powerCv: 120, position: 470 },
  { slug: 'hyundai-tucson-iii-2015-2020-1-7-crdi-115cv', make: 'Hyundai', makeSlug: 'hyundai', model: 'Tucson', modelSlug: 'hyundai-tucson-iii', generation: 'III', yearFrom: 2015, yearTo: 2020, engine: '1.7 CRDi', engineCode: null, fuel: 'diesel', powerKw: 85, powerCv: 115, position: 480 },
  { slug: 'hyundai-i20-iii-2020-1-0-t-gdi-100cv', make: 'Hyundai', makeSlug: 'hyundai', model: 'i20', modelSlug: 'hyundai-i20-iii', generation: 'III', yearFrom: 2020, yearTo: null, engine: '1.0 T-GDi', engineCode: null, fuel: 'gasolina', powerKw: 74, powerCv: 100, position: 490 },
  { slug: 'hyundai-kona-i-2017-2023-electrico-64-kwh-204cv', make: 'Hyundai', makeSlug: 'hyundai', model: 'Kona', modelSlug: 'hyundai-kona-i', generation: 'I', yearFrom: 2017, yearTo: 2023, engine: 'Eléctrico 64 kWh', engineCode: null, fuel: 'electrico', powerKw: 150, powerCv: 204, position: 500 },
];

/**
 * Makes the vehicle list exist in `vehicles`, in one transaction: an upsert on
 * slug of every field of every listed entry (a hand edit of a listed row is
 * overwritten, its id kept), then every row whose slug is no longer listed is
 * flagged retired. A listed slug is active again, same id. Never deletes, and
 * touches no other table, fitments included. An empty list throws before it
 * writes, so a mistake can never retire everything. Imports no `server-only`
 * and no client: `runMigrations` and the test reset call it. The `catalogue`
 * parameter exists for the retire and re-activate tests; production callers
 * pass nothing.
 */
export async function ensureVehicleCatalogue(
  db: Database,
  catalogue: readonly VehicleEntry[] = VEHICLE_CATALOGUE,
): Promise<void> {
  if (catalogue.length === 0) {
    throw new Error('ensureVehicleCatalogue: the vehicle list is empty');
  }
  await db.transaction(async (tx) => {
    for (const entry of catalogue) {
      const fields = {
        make: entry.make,
        makeSlug: entry.makeSlug,
        model: entry.model,
        modelSlug: entry.modelSlug,
        generation: entry.generation,
        yearFrom: entry.yearFrom,
        yearTo: entry.yearTo,
        engine: entry.engine,
        engineCode: entry.engineCode,
        fuel: entry.fuel,
        powerKw: entry.powerKw,
        powerCv: entry.powerCv,
        position: entry.position,
        isRetired: false,
      };
      await tx
        .insert(vehicles)
        .values({ slug: entry.slug, ...fields })
        .onConflictDoUpdate({ target: vehicles.slug, set: fields });
    }
    await tx
      .update(vehicles)
      .set({ isRetired: true })
      .where(
        and(
          notInArray(
            vehicles.slug,
            catalogue.map((entry) => entry.slug),
          ),
          eq(vehicles.isRetired, false),
        ),
      );
  });
}
