import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

import { offers, products } from './catalogue';
import { shops } from './sources';

// The click log (decision 0009, guardrail 5). These columns and no others:
// there is deliberately no ip, user agent, cookie, referer, session, visitor,
// hash or flag column. A request that is not counted has no row at all.
// Only src/server/clicks/record.ts writes this table.
export const clicks = pgTable(
  'clicks',
  {
    id: integer('id').primaryKey().generatedByDefaultAsIdentity(),
    offerId: integer('offer_id')
      .notNull()
      .references(() => offers.id, { onDelete: 'restrict' }),
    // The shop and the product of the offer at click time: snapshots, so a
    // later merge or split never rewrites history. Never updated.
    shopId: integer('shop_id')
      .notNull()
      .references(() => shops.id, { onDelete: 'restrict' }),
    productId: integer('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'restrict' }),
    // The database clock; code never passes a time.
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // A same-origin site path or null, never a URL: no scheme, host, query or
    // fragment can be stored, even by a buggy writer (the check below).
    sourcePage: text('source_page'),
  },
  (table) => [
    index('clicks_shop_id_created_at_idx').on(table.shopId, table.createdAt),
    index('clicks_product_id_created_at_idx').on(table.productId, table.createdAt),
    check(
      'clicks_source_page_format',
      sql`${table.sourcePage} is null or (length(${table.sourcePage}) <= 200 and ${table.sourcePage} ~ '^/([a-z0-9_-]+(/[a-z0-9_-]+)*/?)?$')`,
    ),
  ],
);
