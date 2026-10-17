import 'server-only';

import { eq } from 'drizzle-orm';

import type { Database } from '../../db/client';
import { categories, feeds, networks, shops } from '../../db/schema';
import { demoCategories, demoNetwork, demoShops } from './demo-data';

export type SeedReport = {
  networks: number;
  shops: number;
  feeds: number;
  categories: number;
};

/**
 * Loads the demo network, two demo shops with one demo feed each, and the
 * category tree. Loads no products: the first import is manual (TD-22).
 *
 * Insert-only: every insert is `on conflict do nothing` on the natural key, so
 * running it again changes nothing and an admin's un-approve or hide survives a
 * restart (TD-21, guardrail 1). It approves only the demo shops and the
 * `is_demo` feeds it creates. The report counts rows inserted by this run.
 */
export async function seedDemoData(db: Database): Promise<SeedReport> {
  return db.transaction(async (tx) => {
    const report: SeedReport = { networks: 0, shops: 0, feeds: 0, categories: 0 };

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

    for (const [position, root] of demoCategories.entries()) {
      report.categories += (
        await tx
          .insert(categories)
          .values({ slug: root.slug, name: root.name, position })
          .onConflictDoNothing({ target: categories.slug })
          .returning({ id: categories.id })
      ).length;
      const [parent] = await tx
        .select({ id: categories.id })
        .from(categories)
        .where(eq(categories.slug, root.slug));
      for (const [childPosition, child] of root.children.entries()) {
        report.categories += (
          await tx
            .insert(categories)
            .values({
              slug: child.slug,
              name: child.name,
              parentId: parent.id,
              position: childPosition,
            })
            .onConflictDoNothing({ target: categories.slug })
            .returning({ id: categories.id })
        ).length;
      }
    }
    return report;
  });
}
