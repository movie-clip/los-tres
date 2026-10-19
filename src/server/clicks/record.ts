import 'server-only';

import type { Executor } from '../../db/client';
import { clicks } from '../../db/schema';

export type ClickInsert = {
  offerId: number;
  shopId: number;
  productId: number;
  /** A same-origin site path or null, from sourcePageFromReferer. */
  sourcePage: string | null;
};

/**
 * The only writer of `clicks`. It stores the four fields of a click and lets
 * the database set the id and the time. Nothing about the visitor reaches it:
 * the type has no field for one (guardrail 5).
 */
export async function recordClick(db: Executor, click: ClickInsert): Promise<void> {
  await db.insert(clicks).values({
    offerId: click.offerId,
    shopId: click.shopId,
    productId: click.productId,
    sourcePage: click.sourcePage,
  });
}
