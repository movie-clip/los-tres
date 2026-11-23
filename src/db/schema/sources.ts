import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

// S12.2: `collected_file` is a feed whose rows come from a file made by the owner's local-only
// collector (decision 0017). Set at creation, never changed; its offers and the products it creates
// are the marked rows the visibility scope keeps off a public site.
export const feedSourceType = pgEnum('feed_source_type', [
  'affiliate_network',
  'shop_upload',
  'catalogue_file',
  'collected_file',
]);

export const networks = pgTable('networks', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const shops = pgTable('shops', {
  id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  // Set by an admin only; the demo seed sets it on the demo shops (guardrail 1).
  isApproved: boolean('is_approved').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const feeds = pgTable(
  'feeds',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    networkId: integer('network_id').references(() => networks.id, { onDelete: 'restrict' }),
    sourceType: feedSourceType('source_type').notNull(),
    // May embed a network API key: never printed, logged or reported (TD-36).
    url: text('url').notNull(),
    // Set by an admin only; the demo seed sets it on demo feeds (guardrail 1).
    isApproved: boolean('is_approved').notNull().default(false),
    isDemo: boolean('is_demo').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('feeds_shop_id_url_unique').on(table.shopId, table.url),
    check(
      'feeds_affiliate_network_required',
      sql`${table.sourceType} <> 'affiliate_network' or ${table.networkId} is not null`,
    ),
    // S3.7: a catalogue-file feed names a file, never a network. The cast to
    // text keeps this valid in the migration that adds the enum value: a new
    // value cannot be compared in the transaction that adds it.
    check(
      'feeds_catalogue_file_no_network',
      sql`${table.sourceType}::text <> 'catalogue_file' or ${table.networkId} is null`,
    ),
    // S12.2: a collected-file feed names a file, never a network, and is never a demo feed. The
    // same text cast as above, for the same reason.
    check(
      'feeds_collected_file_no_network',
      sql`${table.sourceType}::text <> 'collected_file' or ${table.networkId} is null`,
    ),
    check(
      'feeds_collected_file_not_demo',
      sql`${table.sourceType}::text <> 'collected_file' or ${table.isDemo} = false`,
    ),
  ],
);
