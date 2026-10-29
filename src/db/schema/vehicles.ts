import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { products } from './catalogue';
import { feeds } from './sources';

// Fuel of a vehicle (S5.5). ASCII codes; accented display labels belong in the
// es-ES message files (D-8). Postgres refuses any other value.
export const vehicleFuel = pgEnum('vehicle_fuel', [
  'gasolina',
  'diesel',
  'hibrido',
  'electrico',
  'glp',
]);

export type VehicleFuel = (typeof vehicleFuel.enumValues)[number];

// The car list, defined in code (src/db/vehicle-catalogue.ts) and upserted on
// every migrate. A vehicle that leaves the list is flagged retired, never
// deleted (decision 0016). Slugs are frozen identifiers.
export const vehicles = pgTable(
  'vehicles',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    slug: text('slug').notNull().unique(),
    make: text('make').notNull(),
    makeSlug: text('make_slug').notNull(),
    model: text('model').notNull(),
    // Picker step-2 key: make + model + generation, e.g. seat-leon-iii.
    modelSlug: text('model_slug').notNull(),
    generation: text('generation').notNull(),
    yearFrom: integer('year_from').notNull(),
    // Null = still on sale.
    yearTo: integer('year_to'),
    engine: text('engine').notNull(),
    // Null when absent, never an empty string.
    engineCode: text('engine_code'),
    fuel: vehicleFuel('fuel').notNull(),
    powerKw: integer('power_kw').notNull(),
    powerCv: integer('power_cv').notNull(),
    // Order of the list; not unique in the database (a unit test pins it).
    position: integer('position').notNull(),
    isRetired: boolean('is_retired').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('vehicles_make_slug_position_idx').on(table.makeSlug, table.position),
    check('vehicles_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('vehicles_make_slug_format', sql`${table.makeSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('vehicles_model_slug_format', sql`${table.modelSlug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check(
      'vehicles_years_valid',
      sql`${table.yearFrom} >= 1950 and (${table.yearTo} is null or ${table.yearTo} >= ${table.yearFrom})`,
    ),
    check(
      'vehicles_engine_code_not_empty',
      sql`${table.engineCode} is null or ${table.engineCode} <> ''`,
    ),
    check('vehicles_power_kw_positive', sql`${table.powerKw} > 0`),
    check('vehicles_power_cv_positive', sql`${table.powerCv} > 0`),
  ],
);

// "Product P fits vehicle V", with the feed that said so. Enters through feeds
// only (guardrail 2); counted only while the feed and its shop are approved
// (src/server/visibility.ts, countedFitmentWhere).
export const fitments = pgTable(
  'fitments',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    vehicleId: integer('vehicle_id')
      .notNull()
      .references(() => vehicles.id, { onDelete: 'restrict' }),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('fitments_product_id_vehicle_id_feed_id_unique').on(
      table.productId,
      table.vehicleId,
      table.feedId,
    ),
    // Replace-per-feed on import (S5.6).
    index('fitments_feed_id_product_id_idx').on(table.feedId, table.productId),
  ],
);
