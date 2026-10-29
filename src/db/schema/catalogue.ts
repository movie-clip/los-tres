import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

import { feeds } from './sources';

// PostgreSQL full-text vector (S5.4). Only ever written by the database, as the
// generated column below; no application code binds or reads a value of it.
const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

export const categories = pgTable('categories', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  parentId: integer('parent_id').references((): AnyPgColumn => categories.id, {
    onDelete: 'restrict',
  }),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const products = pgTable(
  'products',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    slug: text('slug').notNull().unique(),
    title: text('title').notNull(),
    brand: text('brand'),
    brandNormalised: text('brand_normalised'),
    partNumber: text('part_number'),
    partNumberNormalised: text('part_number_normalised'),
    ean: text('ean'),
    eanNormalised: text('ean_normalised'),
    description: text('description'),
    // The category a mapped feed category assigned. Null = unmapped = not
    // public. Written by the importer only, from null, never cleared (D-3).
    categoryId: integer('category_id').references(() => categories.id, { onDelete: 'restrict' }),
    // Set by an admin only (guardrail 1).
    isHidden: boolean('is_hidden').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Searchable text (S5.4), generated and stored by PostgreSQL so the importer
    // never writes it and every insert or update refreshes it. The title is
    // stemmed and unaccented (public.search_es, viscosity codes folded by
    // public.search_fold_codes, D-6); the brand is unaccented only
    // (public.search_simple). The functions and configurations come from
    // migration 0005_search; src/server/catalogue/search-page.ts queries it.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`to_tsvector('public.search_es'::regconfig, public.search_fold_codes(title)) || to_tsvector('public.search_simple'::regconfig, coalesce(brand, ''))`,
    ),
  },
  (table) => [
    index('products_ean_normalised_idx').on(table.eanNormalised),
    index('products_part_number_normalised_idx').on(table.partNumberNormalised),
    index('products_search_vector_idx').using('gin', table.searchVector),
    index('products_category_id_idx').on(table.categoryId),
    check('products_slug_format', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

export const offers = pgTable(
  'offers',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'restrict' }),
    // The feed's own row id.
    externalId: text('external_id').notNull(),
    // Integer cents, EUR, IVA included (guardrail 4).
    priceCents: integer('price_cents').notNull(),
    // The feed's affiliate link. Kept for the /go slice; no public read returns it.
    url: text('url').notNull(),
    // The feed row's category cell, trimmed; null when empty. Feed data, so the
    // importer refreshes it on every import like the price.
    feedCategory: text('feed_category'),
    // Set by an admin only (guardrail 1).
    isHidden: boolean('is_hidden').notNull().default(false),
    // Waiting in the matching queue; nothing writes it until that slice.
    inReview: boolean('in_review').notNull().default(false),
    priceUpdatedAt: timestamp('price_updated_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('offers_feed_id_external_id_unique').on(table.feedId, table.externalId),
    index('offers_product_id_idx').on(table.productId),
    check('offers_price_cents_positive', sql`${table.priceCents} > 0`),
  ],
);

// One feed's own category string mapped to one of our categories ("mapped
// once", mvp.md). Keyed per feed, not per network: merchant taxonomies differ
// within a network (D-1). Exact string match after trim.
export const feedCategoryMappings = pgTable(
  'feed_category_mappings',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    feedId: integer('feed_id')
      .notNull()
      .references(() => feeds.id, { onDelete: 'restrict' }),
    feedCategory: text('feed_category').notNull(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('feed_category_mappings_feed_id_feed_category_unique').on(
      table.feedId,
      table.feedCategory,
    ),
  ],
);
