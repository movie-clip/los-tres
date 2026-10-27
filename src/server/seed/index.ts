import 'server-only';

import { and, eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { categories, feedCategoryMappings, feeds, networks, shops } from '../../db/schema';
import { demoCategoryMappings, demoNetwork, demoShops } from './demo-data';

export type SeedReport = {
  networks: number;
  shops: number;
  feeds: number;
  categoryMappings: number;
};

/**
 * Loads the demo network, two demo shops with one demo feed each and each demo
 * feed's category mappings onto the fixed tree. Creates no category: the tree
 * comes from `ensureFixedCategoryTree` at the end of migrate, and a missing
 * fixed slug throws. Loads no products: the first import is manual (TD-22).
 *
 * Insert-only: every insert is `on conflict do nothing` on the natural key, so
 * running it again changes nothing and an admin's un-approve or hide survives a
 * restart (TD-21, guardrail 1). It approves only the demo shops and the
 * `is_demo` feeds it creates. The report counts rows inserted by this run.
 */
export async function seedDemoData(db: Database): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    const report: SeedReport = {
      networks: 0,
      shops: 0,
      feeds: 0,
      categoryMappings: 0,
    };

    const insertedNetworks = await tx
      .insert(networks)
      .values(demoNetwork)
      .onConflictDoNothing({ target: networks.slug })
      .returning({ id: networks.id });
    report.networks = insertedNetworks.length;
    const [network] = await tx
      .select({ id: networks.id })
      .from(networks)
      .where(eq(networks.slug, demoNetwork.slug));

    // One insert per shop and feed, in order, so a fresh database gets ids 1 and 2.
    for (const shop of demoShops) {
      const insertedShops = await tx
        .insert(shops)
        .values({ slug: shop.slug, name: shop.name, isApproved: true })
        .onConflictDoNothing({ target: shops.slug })
        .returning({ id: shops.id });
      report.shops += insertedShops.length;
      const [row] = await tx.select({ id: shops.id }).from(shops).where(eq(shops.slug, shop.slug));

      const insertedFeeds = await tx
        .insert(feeds)
        .values({
          shopId: row.id,
          networkId: network.id,
          sourceType: 'affiliate_network',
          url: `demo-feed:${shop.feedFile}`,
          isApproved: true,
          isDemo: true,
        })
        .onConflictDoNothing({ target: [feeds.shopId, feeds.url] })
        .returning({ id: feeds.id });
      report.feeds += insertedFeeds.length;
    }

    for (const mapping of demoCategoryMappings) {
      const [feed] = await tx
        .select({ id: feeds.id })
        .from(feeds)
        .where(and(eq(feeds.url, `demo-feed:${mapping.feedFile}`), eq(feeds.isDemo, true)));
      const [category] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, mapping.categorySlug));
      if (!feed) continue;
      // The fixed tree comes from migrate, not from this seed: a missing slug
      // means migrate has not run, so fail rather than seed a half state.
      if (!category) {
        throw new Error(`seed: fixed category missing: ${mapping.categorySlug}; run migrate first`);
      }
      report.categoryMappings += (
        await tx
          .insert(feedCategoryMappings)
          .values({
            feedId: feed.id,
            feedCategory: mapping.feedCategory,
            categoryId: category.id,
          })
          .onConflictDoNothing({
            target: [feedCategoryMappings.feedId, feedCategoryMappings.feedCategory],
          })
          .returning({ id: feedCategoryMappings.id })
      ).length;
    }
    return report;
  });
}
