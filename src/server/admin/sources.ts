import 'server-only';

import { asc, eq, sql } from 'drizzle-orm';

// Relative on purpose: files in src/server import each other relatively.
import { getDb } from '../../db/client';
import { feeds, networks, offers, shops } from '../../db/schema';

// The admin's view of shops and feeds, and the only code that writes
// `shops.is_approved` and `feeds.is_approved` outside the seed (guardrail 1,
// US-2.3). A write sets one flag on one row to an explicit target and returns
// what the database stored. Nothing here selects `feeds.url`: it may embed a
// network API key (guardrail 5), so no type below has a field for it.

export type AdminFeedSource = 'affiliate_network' | 'shop_upload';

export type AdminFeed = {
  id: number;
  approved: boolean;
  demo: boolean;
  source: AdminFeedSource;
  /** `networks.name`; null when the feed has no network (a shop upload). */
  networkName: string | null;
  /** All stored offers of this feed, hidden and in-review included. */
  offerCount: number;
};

export type AdminShop = {
  id: number;
  name: string;
  approved: boolean;
  /** The sum of its feeds' offer counts. */
  offerCount: number;
  /** By id ascending. */
  feeds: AdminFeed[];
};

export type ShopApprovalStored = { shopId: number; approved: boolean };
export type FeedApprovalStored = { feedId: number; approved: boolean; shopApproved: boolean };

/**
 * Every shop with its feeds and offer counts, shops by name then id. Named
 * columns only, and never the feed URL.
 */
export async function listSourcesForAdmin(): Promise<AdminShop[]> {
  const db = getDb();

  const shopRows = await db
    .select({ id: shops.id, name: shops.name, approved: shops.isApproved })
    .from(shops)
    .orderBy(asc(shops.name), asc(shops.id));

  const feedRows = await db
    .select({
      id: feeds.id,
      shopId: feeds.shopId,
      approved: feeds.isApproved,
      demo: feeds.isDemo,
      source: feeds.sourceType,
      networkName: networks.name,
      offerCount: sql<number>`count(${offers.id})::int`,
    })
    .from(feeds)
    .leftJoin(networks, eq(feeds.networkId, networks.id))
    .leftJoin(offers, eq(offers.feedId, feeds.id))
    .groupBy(feeds.id, networks.name)
    .orderBy(asc(feeds.id));

  const feedsByShop = new Map<number, AdminFeed[]>();
  for (const row of feedRows) {
    const feed: AdminFeed = {
      id: row.id,
      approved: row.approved,
      demo: row.demo,
      source: row.source,
      networkName: row.networkName,
      offerCount: Number(row.offerCount),
    };
    const list = feedsByShop.get(row.shopId);
    if (list) list.push(feed);
    else feedsByShop.set(row.shopId, [feed]);
  }

  return shopRows.map((shop) => {
    const shopFeeds = feedsByShop.get(shop.id) ?? [];
    return {
      id: shop.id,
      name: shop.name,
      approved: shop.approved,
      offerCount: shopFeeds.reduce((sum, feed) => sum + feed.offerCount, 0),
      feeds: shopFeeds,
    };
  });
}

/**
 * Sets one shop's approval to `approved` and returns the stored value, or null
 * when no such shop exists. Touches no feed and no other column. Idempotent.
 */
export async function setShopApproval(
  shopId: number,
  approved: boolean,
): Promise<ShopApprovalStored | null> {
  const rows = await getDb()
    .update(shops)
    .set({ isApproved: approved })
    .where(eq(shops.id, shopId))
    .returning({ shopId: shops.id, approved: shops.isApproved });
  return rows[0] ?? null;
}

/**
 * Sets one feed's approval to `approved` and returns the stored value with its
 * shop's stored approval, or null when no such feed exists. One statement;
 * touches no shop and no other column. Idempotent.
 */
export async function setFeedApproval(
  feedId: number,
  approved: boolean,
): Promise<FeedApprovalStored | null> {
  const rows = await getDb()
    .update(feeds)
    .set({ isApproved: approved })
    .from(shops)
    .where(sql`${feeds.id} = ${feedId} and ${feeds.shopId} = ${shops.id}`)
    .returning({ feedId: feeds.id, approved: feeds.isApproved, shopApproved: shops.isApproved });
  return rows[0] ?? null;
}
