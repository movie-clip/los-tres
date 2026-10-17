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

export const feedSourceType = pgEnum('feed_source_type', ['affiliate_network', 'shop_upload']);

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
  ],
);
