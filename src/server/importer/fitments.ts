import 'server-only';

import { eq, inArray } from 'drizzle-orm';

import type { Executor } from '../../db/client';
import { fitments, vehicles } from '../../db/schema';
import type { FeedImportReport, UnknownVehicleSlug } from './types';

// The only writer of `fitments` (guardrail 1, 2). A fitment is "this product
// fits this vehicle, said by this feed". A feed replaces only its own fitments,
// and only for the products its accepted rows name; the rest keep theirs (D-3).
// The write is a diff, once per feed at the end of the import: rows that already
// match are left untouched, so a second import changes no id and no created_at.
// Prints nothing: the report carries the unknown-slug tally.

/** What the vehicles.slug check accepts; only slugs of this shape are ever printed. */
export const PRINTABLE_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A longer value is counted but not printed. */
export const MAX_PRINTED_SLUG_LENGTH = 80;
/** Distinct unknown slugs listed per feed; the tally never holds more. */
export const MAX_UNKNOWN_SLUG_LINES = 20;

const CHUNK = 1000;

/** Vehicle slug to id. */
export type VehicleIds = ReadonlyMap<string, number>;

/** Every vehicle row, retired included (AC 15). Once per feed, inside the feed transaction. */
export async function loadVehicleIds(tx: Executor): Promise<VehicleIds> {
  const rows = await tx.select({ id: vehicles.id, slug: vehicles.slug }).from(vehicles);
  return new Map(rows.map((vehicle) => [vehicle.slug, vehicle.id]));
}

/** Per-feed accumulator: the vehicles wanted per product (union of rows) and the unknown tally. */
export class FeedFitments {
  private readonly vehicleIds: VehicleIds;
  private readonly touched = new Map<number, Set<number>>();
  private readonly unknown = new Map<string, number>();
  private unknownTotal = 0;
  private notShown = 0;

  constructor(vehicleIds: VehicleIds) {
    this.vehicleIds = vehicleIds;
  }

  /** Product to its wanted vehicle ids, for every product an accepted row named. */
  get wanted(): ReadonlyMap<number, ReadonlySet<number>> {
    return this.touched;
  }

  /**
   * Called for every accepted row. An empty list still marks the product
   * touched, so this feed's fitments for it are cleared (D-2).
   */
  add(productId: number, slugs: readonly string[]): void {
    let ids = this.touched.get(productId);
    if (!ids) {
      ids = new Set<number>();
      this.touched.set(productId, ids);
    }
    for (const slug of slugs) {
      const vehicleId = this.vehicleIds.get(slug);
      if (vehicleId !== undefined) ids.add(vehicleId);
      else this.countUnknown(slug);
    }
  }

  /** Writes the three unknown* fields onto the report. */
  fillReport(report: FeedImportReport): void {
    const slugs: UnknownVehicleSlug[] = [];
    for (const [slug, rows] of this.unknown) slugs.push({ slug, rows });
    report.unknownVehicles = this.unknownTotal;
    report.unknownVehicleSlugs = slugs;
    report.unknownVehiclesNotShown = this.notShown;
  }

  private countUnknown(slug: string): void {
    this.unknownTotal += 1;
    if (!PRINTABLE_SLUG.test(slug) || slug.length > MAX_PRINTED_SLUG_LENGTH) {
      this.notShown += 1;
      return;
    }
    const seen = this.unknown.get(slug);
    if (seen !== undefined) this.unknown.set(slug, seen + 1);
    else if (this.unknown.size < MAX_UNKNOWN_SLUG_LINES) this.unknown.set(slug, 1);
    else this.notShown += 1;
  }
}

/**
 * Diffs this feed's stored fitments against `wanted`, for the products in
 * `wanted` only (D-3): deletes the rows no longer wanted, inserts the missing
 * ones, leaves matching rows untouched. No conflict clause: the diff makes a
 * conflict a bug, and a bug should fail the feed.
 */
export async function replaceFeedFitments(
  tx: Executor,
  feedId: number,
  wanted: ReadonlyMap<number, ReadonlySet<number>>,
): Promise<void> {
  if (wanted.size === 0) return;

  const existing = await tx
    .select({ id: fitments.id, productId: fitments.productId, vehicleId: fitments.vehicleId })
    .from(fitments)
    .where(eq(fitments.feedId, feedId));

  const stale: number[] = [];
  const kept = new Map<number, Set<number>>();
  for (const row of existing) {
    const wantedIds = wanted.get(row.productId);
    if (!wantedIds) continue;
    if (wantedIds.has(row.vehicleId)) {
      let ids = kept.get(row.productId);
      if (!ids) {
        ids = new Set<number>();
        kept.set(row.productId, ids);
      }
      ids.add(row.vehicleId);
    } else {
      stale.push(row.id);
    }
  }

  const missing: { productId: number; vehicleId: number; feedId: number }[] = [];
  for (const [productId, vehicleIds] of wanted) {
    const have = kept.get(productId);
    for (const vehicleId of vehicleIds) {
      if (!have?.has(vehicleId)) missing.push({ productId, vehicleId, feedId });
    }
  }

  for (let start = 0; start < stale.length; start += CHUNK) {
    await tx.delete(fitments).where(inArray(fitments.id, stale.slice(start, start + CHUNK)));
  }
  for (let start = 0; start < missing.length; start += CHUNK) {
    await tx.insert(fitments).values(missing.slice(start, start + CHUNK));
  }
}
