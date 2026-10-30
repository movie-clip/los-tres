import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeDb, getDb } from '@/db/client';
import { VEHICLE_CATALOGUE } from '@/db/vehicle-catalogue';
import { feeds, fitments, offers, products, vehicles } from '@/db/schema';
import { readFitStates } from '@/server/catalogue/fit-state';
import { formatImportReport, importExitCode, importFeeds } from '@/server/importer';
import { MAX_PRINTED_SLUG_LENGTH, MAX_UNKNOWN_SLUG_LINES } from '@/server/importer/fitments';

import { allOffers, allProducts, insertFeed, insertShop, vehicleIdBySlug } from '../support/catalogue';
import { resetDatabase } from '../support/db';
import { csvOf, textDeps, xmlOf, type FeedRow } from '../support/feeds';
import { stubNetworkOff } from '../support/network-off';

// S5.6, AC 8 to 28: the import turns the fitment field into rows of the
// fitments table, per feed and per product, and reports slugs it does not know.
// Vehicles are the migrated list (never inserted here), so every slug is real.

beforeEach(async () => {
  await resetDatabase();
  stubNetworkOff();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  await closeDb();
});

const [A, B, C, D] = VEHICLE_CATALOGUE.slice(0, 4).map((vehicle) => vehicle.slug);
const EAN = '2000000000015';

async function newFeed(o: { isApproved?: boolean; shopName?: string } = {}): Promise<number> {
  const shop = await insertShop({ name: o.shopName });
  return insertFeed(shop.id, { isApproved: o.isApproved });
}

/** A valid row; each test sets the id and the fitment it is about. */
function row(id: string, fitment?: string, extra: FeedRow = {}): FeedRow {
  return { id, title: `Titulo ${id}`, price: '5.00', url: `https://shop.example/${id}`, fitment, ...extra };
}

const run = (feedId: number, content: string | Error) =>
  importFeeds(getDb(), { feedId, deps: textDeps({ [feedId]: content }) });

/** External id of this feed's offer -> the vehicle slugs this feed gave its product, sorted. */
async function fitmentsOf(feedId: number): Promise<Record<string, string[]>> {
  const found = await getDb()
    .select({ external: offers.externalId, slug: vehicles.slug })
    .from(fitments)
    .innerJoin(offers, and(eq(offers.productId, fitments.productId), eq(offers.feedId, fitments.feedId)))
    .innerJoin(vehicles, eq(vehicles.id, fitments.vehicleId))
    .where(eq(fitments.feedId, feedId));
  const byOffer: Record<string, string[]> = {};
  for (const { external, slug } of found) (byOffer[external] ??= []).push(slug);
  for (const slugs of Object.values(byOffer)) slugs.sort();
  return byOffer;
}

const sorted = (...slugs: string[]) => [...slugs].sort();

async function allFitmentRows() {
  return getDb().select().from(fitments).orderBy(fitments.id);
}

async function productIdOf(feedId: number, externalId: string): Promise<number> {
  const [found] = await getDb()
    .select({ productId: offers.productId })
    .from(offers)
    .where(and(eq(offers.feedId, feedId), eq(offers.externalId, externalId)));
  return found.productId;
}

describe('writing fitments on the three import paths (AC 8)', () => {
  it('a new product gets the row\'s vehicles', async () => {
    const feedId = await newFeed();
    const report = await run(feedId, csvOf([row('N-1', `${A}|${B}`), row('N-2', C)]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', productsCreated: 2, rejected: [] });
    expect(await fitmentsOf(feedId)).toEqual({ 'N-1': sorted(A, B), 'N-2': [C] });
  });

  it('a new offer attached to an existing product gives that product the feed\'s vehicles, and leaves the other feed\'s alone (AC 9)', async () => {
    const first = await newFeed();
    const second = await newFeed();
    await run(first, csvOf([row('P-1', A, { ean: EAN })]));

    const report = await run(second, csvOf([row('Q-1', `${B}|${C}`, { ean: EAN })]));

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 1 });
    expect(await allProducts()).toHaveLength(1);
    expect(await fitmentsOf(second)).toEqual({ 'Q-1': sorted(B, C) });
    expect(await fitmentsOf(first)).toEqual({ 'P-1': [A] });
  });

  it('an offer that already exists has its set replaced by the new list (AC 10)', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('E-1', `${A}|${B}`)]));

    const report = await run(feedId, csvOf([row('E-1', `${B}|${C}`)]));

    expect(report.feeds[0]).toMatchObject({ productsCreated: 0, offersCreated: 0, offersUpdated: 1 });
    expect(await fitmentsOf(feedId)).toEqual({ 'E-1': sorted(B, C) });
  });

  it('writes the same fitments from an XML feed as from a CSV feed', async () => {
    const csvFeed = await newFeed();
    const xmlFeed = await newFeed();
    await run(csvFeed, csvOf([row('X-1', ` ${A} | ${B}|${A}`)]));
    await run(xmlFeed, xmlOf([row('X-1', ` ${A} | ${B}|${A}`)]));

    expect(await fitmentsOf(xmlFeed)).toEqual({ 'X-1': sorted(A, B) });
    expect(await fitmentsOf(xmlFeed)).toEqual(await fitmentsOf(csvFeed));
  });

  it('counts a slug written twice in a row once and stores one row per vehicle', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('D-1', `${A}|${A}||${A}`)]));
    expect(await allFitmentRows()).toHaveLength(1);
  });
});

describe('what an empty list, an absent column and an absent element do (AC 6, 10)', () => {
  const given = (feedId: number) => run(feedId, csvOf([row('Z-1', `${A}|${B}`), row('Z-2', C)]));

  it('an empty cell clears this feed\'s fitments for that product and no other', async () => {
    const feedId = await newFeed();
    await given(feedId);

    const report = await run(feedId, csvOf([row('Z-1', ''), row('Z-2', C)]));

    expect(report.feeds[0].rejected).toEqual([]);
    expect(await fitmentsOf(feedId)).toEqual({ 'Z-2': [C] });
  });

  it('a feed with no fitment column clears the fitments of every product it still lists', async () => {
    const feedId = await newFeed();
    await given(feedId);

    const report = await run(feedId, csvOf([row('Z-1'), row('Z-2')]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rejected: [], unknownVehicles: 0 });
    expect(await allFitmentRows()).toEqual([]);
  });

  it('an XML record with no fitment element, and one with an empty element, clear alike', async () => {
    const feedId = await newFeed();
    await given(feedId);

    const report = await run(feedId, xmlOf([row('Z-1'), row('Z-2', '')]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rejected: [] });
    expect(await allFitmentRows()).toEqual([]);
  });

  it('clearing one feed\'s fitments leaves another feed\'s for the same product (AC 9)', async () => {
    const first = await newFeed();
    const second = await newFeed();
    await run(first, csvOf([row('P-1', A, { ean: EAN })]));
    await run(second, csvOf([row('Q-1', B, { ean: EAN })]));

    await run(second, csvOf([row('Q-1', '', { ean: EAN })]));

    expect(await fitmentsOf(first)).toEqual({ 'P-1': [A] });
    expect(await fitmentsOf(second)).toEqual({});
  });
});

describe('several rows of one import for one product (AC 11)', () => {
  const rows = [row('U-1', `${A}|${B}`, { ean: EAN }), row('U-2', `${B}|${C}`, { ean: EAN })];

  it.each([
    ['in file order', rows],
    ['in reverse order', [...rows].reverse()],
  ])('gives the product the union of the lists, %s', async (_name, ordered) => {
    const feedId = await newFeed();
    await run(feedId, csvOf(ordered));

    expect(await allProducts()).toHaveLength(1);
    const stored = (await allFitmentRows()).map((fitment) => fitment.vehicleId).sort((a, b) => a - b);
    const wanted = (await Promise.all([A, B, C].map(vehicleIdBySlug))).sort((a, b) => a - b);
    expect(stored).toEqual(wanted);
  });

  it('does not let an empty second row erase the first row\'s list, in either order', async () => {
    for (const ordered of [
      [row('U-1', A, { ean: EAN }), row('U-2', '', { ean: EAN })],
      [row('U-2', '', { ean: EAN }), row('U-1', A, { ean: EAN })],
    ]) {
      await resetDatabase();
      const feedId = await newFeed();
      await run(feedId, csvOf(ordered));
      expect((await allFitmentRows()).map((fitment) => fitment.vehicleId)).toEqual([await vehicleIdBySlug(A)]);
    }
  });

  it('a re-import of the same rows changes nothing', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf(rows));
    const before = await allFitmentRows();
    await run(feedId, csvOf([...rows].reverse()));
    expect(await allFitmentRows()).toEqual(before);
  });
});

describe('a product the import does not mention (AC 14)', () => {
  it('keeps the fitments this feed gave it, and its offer', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('K-1', A), row('K-2', B)]));

    await run(feedId, csvOf([row('K-1', C)]));

    expect(await fitmentsOf(feedId)).toEqual({ 'K-1': [C], 'K-2': [B] });
  });
});

describe('rejected rows write and remove nothing (AC 12)', () => {
  it('a rejected row leaves the stored fitments, and adds none for its list', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('R-1', A)]));

    const report = await run(feedId, csvOf([row('R-1', B, { price: 'no-es-precio' })]));

    expect(report.feeds[0].rejected).toEqual([{ record: 2, code: 'invalid_price', field: 'price' }]);
    expect(await fitmentsOf(feedId)).toEqual({ 'R-1': [A] });
  });

  it('a new product whose row is rejected gets nothing', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('R-2', A, { url: 'ftp://nope' })]));
    expect(await allFitmentRows()).toEqual([]);
  });

  it('a duplicate id inside the feed rejects the second row, whose list is ignored', async () => {
    const feedId = await newFeed();
    const report = await run(feedId, csvOf([row('R-3', A), row('R-3', B)]));
    expect(report.feeds[0].rejected).toMatchObject([{ record: 3, code: 'duplicate_id' }]);
    expect(await fitmentsOf(feedId)).toEqual({ 'R-3': [A] });
  });

  it('does not count an unknown slug of a rejected row', async () => {
    const feedId = await newFeed();
    const report = await run(feedId, csvOf([row('R-4', 'desconocido-uno', { price: 'x' })]));
    expect(report.feeds[0]).toMatchObject({ unknownVehicles: 0, unknownVehicleSlugs: [] });
  });
});

describe('skipped and failed feeds leave fitments as they were (AC 13)', () => {
  it('an unapproved feed named with feedId writes no fitment and is reported skipped', async () => {
    const feedId = await newFeed({ isApproved: false });

    const report = await run(feedId, csvOf([row('S-1', A)]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'skipped', skipReason: 'not_approved' });
    expect(await allFitmentRows()).toEqual([]);
  });

  it('an unapproved feed in a full run writes none either, while the approved one does', async () => {
    const off = await newFeed({ isApproved: false });
    const on = await newFeed();
    await importFeeds(getDb(), {
      deps: textDeps({ [off]: csvOf([row('S-2', A)]), [on]: csvOf([row('S-3', B)]) }),
    });
    expect(await fitmentsOf(off)).toEqual({});
    expect(await fitmentsOf(on)).toEqual({ 'S-3': [B] });
  });

  it('a feed switched off after an import keeps its rows, and a later run does not touch them', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('S-4', A)]));
    const before = await allFitmentRows();
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));

    const report = await run(feedId, csvOf([row('S-4', B)]));

    expect(report.feeds[0].outcome).toBe('skipped');
    expect(await allFitmentRows()).toEqual(before);
  });

  const FAILURES: [string, (feedId: number) => Promise<Awaited<ReturnType<typeof run>>>, string][] = [
    ['a source error', (feedId) => run(feedId, new Error('connection reset')), 'fetch_failed'],
    ['a missing required column', (feedId) => run(feedId, 'id,title,fitment\nF-1,T,x\n'), 'invalid_header'],
    [
      'XML cut off mid-stream',
      (feedId) =>
        run(
          feedId,
          '<r><p><id>F-1</id><title>T</title><price>1.00</price><url>https://a.example/1</url>' +
            `<fitment>${B}</fitment></p><p><id>F-2</id><title>T2</title>`,
        ),
      'invalid_xml',
    ],
    [
      'a database error after good rows',
      (feedId) =>
        run(feedId, csvOf([row('F-1', B), row('F-9', C, { title: 'Titulo\u0000roto' })])),
      'database_error',
    ],
  ];

  it.each(FAILURES)('%s leaves the fitments of the feed exactly as before', async (_name, fail, failure) => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('F-1', A), row('F-0', D)]));
    const before = await allFitmentRows();

    const report = await fail(feedId);

    expect(report.feeds[0]).toMatchObject({
      outcome: 'failed',
      failure,
      unknownVehicles: 0,
      unknownVehicleSlugs: [],
      unknownVehiclesNotShown: 0,
    });
    expect(importExitCode(report)).toBe(1);
    expect(await allFitmentRows()).toEqual(before);
  });

  it('a failed first import creates no fitment and no product', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('F-1', A), row('F-9', B, { title: 'Titulo\u0000roto' })]));
    expect(await allFitmentRows()).toEqual([]);
    expect(await allProducts()).toEqual([]);
  });

  it('a feed that fails does not stop the next feed from writing its fitments', async () => {
    const bad = await newFeed();
    const good = await newFeed();
    await importFeeds(getDb(), {
      deps: textDeps({ [bad]: new Error('boom'), [good]: csvOf([row('G-1', A)]) }),
    });
    expect(await fitmentsOf(good)).toEqual({ 'G-1': [A] });
  });
});

describe('retired vehicles (AC 15)', () => {
  it('stores a retired slug, does not report it as unknown, and does not count it while retired', async () => {
    const feedId = await newFeed();
    await getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.slug, A));

    const report = await run(feedId, csvOf([row('V-1', `${A}|${B}`)]));

    expect(report.feeds[0]).toMatchObject({ unknownVehicles: 0, unknownVehicleSlugs: [] });
    expect(formatImportReport(report)).not.toContain('fitment:');
    expect(await fitmentsOf(feedId)).toEqual({ 'V-1': sorted(A, B) });
    const product = await productIdOf(feedId, 'V-1');
    expect((await readFitStates(A, [product])).status).toBe('no-such-vehicle');
    expect(await states(B, [product])).toEqual([[product, 'fits']]);
  });

  it('a product with only a retired vehicle is unknown for the others, and counts again once the vehicle is back', async () => {
    const feedId = await newFeed();
    await getDb().update(vehicles).set({ isRetired: true }).where(eq(vehicles.slug, A));
    await run(feedId, csvOf([row('V-2', A)]));
    const product = await productIdOf(feedId, 'V-2');

    expect(await states(B, [product])).toEqual([[product, 'unknown']]);

    await getDb().update(vehicles).set({ isRetired: false }).where(eq(vehicles.slug, A));
    expect(await states(B, [product])).toEqual([[product, 'no-fit']]);
    expect(await states(A, [product])).toEqual([[product, 'fits']]);
  });
});

async function states(slug: string, ids: number[]): Promise<[number, string][]> {
  const result = await readFitStates(slug, ids);
  if (result.status !== 'ok') throw new Error(`expected ok, got ${result.status}`);
  return [...result.states].sort((a, b) => a[0] - b[0]);
}

describe('hidden and in-review products are replaced like any other (AC 16)', () => {
  it('replaces the fitments of a hidden product and of an offer in review, and changes neither flag', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('H-1', A)]));
    const product = await productIdOf(feedId, 'H-1');
    await getDb().update(products).set({ isHidden: true }).where(eq(products.id, product));
    await getDb().update(offers).set({ isHidden: true, inReview: true }).where(eq(offers.productId, product));

    await run(feedId, csvOf([row('H-1', `${B}|${C}`)]));

    expect(await fitmentsOf(feedId)).toEqual({ 'H-1': sorted(B, C) });
    expect((await allProducts())[0].isHidden).toBe(true);
    expect(await allOffers()).toMatchObject([{ isHidden: true, inReview: true }]);
  });
});

describe('the fit-state question end to end (AC 17)', () => {
  it('gives fits, no-fit and unknown, and follows the feed\'s approval with no further step', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('Y-1', A), row('Y-2', B), row('Y-3', '')]));
    const [fits, noFit, unknown] = await Promise.all(['Y-1', 'Y-2', 'Y-3'].map((id) => productIdOf(feedId, id)));
    const ids = [fits, noFit, unknown];
    const expected = (a: string, b: string, c: string): [number, string][] => [
      [fits, a],
      [noFit, b],
      [unknown, c],
    ];

    expect(await states(A, ids)).toEqual(expected('fits', 'no-fit', 'unknown'));

    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));
    expect(await states(A, ids)).toEqual(expected('unknown', 'unknown', 'unknown'));

    await getDb().update(feeds).set({ isApproved: true }).where(eq(feeds.id, feedId));
    expect(await states(A, ids)).toEqual(expected('fits', 'no-fit', 'unknown'));
  });

  it('adds no approval rule of its own: an unapproved feed that held fitments stays out of the answer after a skipped run', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('Y-4', A)]));
    const product = await productIdOf(feedId, 'Y-4');
    await getDb().update(feeds).set({ isApproved: false }).where(eq(feeds.id, feedId));
    await run(feedId, csvOf([row('Y-4', B)]));
    expect(await states(A, [product])).toEqual([[product, 'unknown']]);
  });
});

describe('importing the same feed twice (AC 18)', () => {
  it('keeps every fitment row: same ids, same creation times, same fitment output', async () => {
    const feedId = await newFeed();
    const csv = csvOf([row('T-1', `${A}|${B}`), row('T-2', C), row('T-3', `${A}|desconocido-uno`)]);
    const first = await run(feedId, csv);
    const before = await allFitmentRows();
    expect(before).toHaveLength(4);

    const second = await run(feedId, csv);

    expect(await allFitmentRows()).toEqual(before);
    const fitmentLines = (text: string) => text.split('\n').filter((line) => line.includes('fitment:'));
    expect(fitmentLines(formatImportReport(second))).toEqual(fitmentLines(formatImportReport(first)));
    expect(second.feeds[0].unknownVehicles).toBe(first.feeds[0].unknownVehicles);
  });

  it('keeps the rows it should and only changes the vehicles that changed', async () => {
    const feedId = await newFeed();
    await run(feedId, csvOf([row('T-4', `${A}|${B}`)]));
    const before = await allFitmentRows();
    const keptId = await vehicleIdBySlug(A);

    await run(feedId, csvOf([row('T-4', `${A}|${C}`)]));

    const after = await allFitmentRows();
    const kept = after.find((fitment) => fitment.vehicleId === keptId);
    expect(kept).toEqual(before.find((fitment) => fitment.vehicleId === keptId));
    expect(after.map((fitment) => fitment.vehicleId).sort((a, b) => a - b)).toEqual(
      (await Promise.all([A, C].map(vehicleIdBySlug))).sort((a, b) => a - b),
    );
  });
});

describe('a fitment column changes nothing else (AC 19)', () => {
  it('gives the same products, offers and rejected rows as the same file without the column', async () => {
    const rowsWith = [row('W-1', A), row('W-2', `${B}|desconocido-uno`), row('W-3', C, { price: 'mal' })];
    const rowsWithout = rowsWith.map((fed) => ({ ...fed, fitment: undefined }));
    const shape = async () => ({
      products: (await allProducts()).map(({ slug, title, brand, categoryId }) => ({ slug, title, brand, categoryId })),
      offers: (await allOffers()).map(({ externalId, priceCents, url }) => ({ externalId, priceCents, url })),
    });

    const withReport = await run(await newFeed(), csvOf(rowsWith));
    const withShape = await shape();
    await resetDatabase();
    const withoutReport = await run(await newFeed(), csvOf(rowsWithout));

    expect(await shape()).toEqual(withShape);
    expect(withReport.feeds[0].rejected).toEqual(withoutReport.feeds[0].rejected);
    expect(withReport.feeds[0]).toMatchObject({
      rows: withoutReport.feeds[0].rows,
      productsCreated: withoutReport.feeds[0].productsCreated,
      offersCreated: withoutReport.feeds[0].offersCreated,
    });
  });
});

describe('unknown slugs (AC 5, 21 to 26)', () => {
  it('skips the unknown slug, applies the others, imports the row and rejects nothing', async () => {
    const feedId = await newFeed();

    const report = await run(feedId, csvOf([row('X-1', `${A}|desconocido-uno|${B}`)]));

    expect(report.feeds[0]).toMatchObject({ outcome: 'imported', rows: 1, productsCreated: 1, rejected: [] });
    expect(report.feeds[0].unknownVehicles).toBe(1);
    expect(await fitmentsOf(feedId)).toEqual({ 'X-1': sorted(A, B) });
    expect(importExitCode(report)).toBe(0);
  });

  it('counts a slug once for each row that held it, and once for a row that repeats it', async () => {
    const feedId = await newFeed();

    const report = await run(
      feedId,
      csvOf([
        row('X-1', 'raro-uno|raro-uno'),
        row('X-2', `${A}|raro-uno|raro-dos`),
        row('X-3', 'raro-uno'),
      ]),
    );

    expect(report.feeds[0].unknownVehicles).toBe(4);
    expect(report.feeds[0].unknownVehicleSlugs).toEqual([
      { slug: 'raro-uno', rows: 3 },
      { slug: 'raro-dos', rows: 1 },
    ]);
    expect(report.feeds[0].unknownVehiclesNotShown).toBe(0);
  });

  it('prints the count on the imported line, the exact slug lines under it, and exits 0', async () => {
    const feedId = await newFeed({ shopName: 'Tienda Unica' });
    const report = await run(feedId, csvOf([row('X-1', 'raro-uno'), row('X-2', 'raro-uno|raro-dos')]));

    expect(formatImportReport(report)).toBe(
      [
        `feed ${feedId} "Tienda Unica": imported rows=2 products_created=2 offers_created=2 offers_updated=0 rejected=0 unknown_vehicles=3`,
        '  fitment: unknown vehicle raro-uno rows=2',
        '  fitment: unknown vehicle raro-dos rows=1',
        'total: feeds=1 imported=1 skipped=0 failed=0',
      ].join('\n'),
    );
    expect(importExitCode(report)).toBe(0);
  });

  it('puts the fitment lines after the reject lines', async () => {
    const feedId = await newFeed();
    const report = await run(feedId, csvOf([row('X-1', 'raro-uno'), row('X-2', 'raro-uno', { price: 'mal' })]));
    const lines = formatImportReport(report).split('\n');
    expect(lines.slice(1, 3)).toEqual(['  record 3: invalid_price (price)', '  fitment: unknown vehicle raro-uno rows=1']);
  });

  it('matches a slug exactly: a different letter case is unknown, counted and not printed (AC 5)', async () => {
    const feedId = await newFeed();

    const report = await run(feedId, csvOf([row('X-1', A.toUpperCase())]));

    expect(report.feeds[0]).toMatchObject({ unknownVehicles: 1, unknownVehicleSlugs: [], unknownVehiclesNotShown: 1 });
    expect(await allFitmentRows()).toEqual([]);
    expect(formatImportReport(report)).not.toContain(A.toUpperCase());
  });

  it('counts a value that is not shaped like a slug but never prints it (AC 24)', async () => {
    const feedId = await newFeed();
    const odd = ['Con Espacios Y Mayusculas', 'persona@correo.example', '<script>x</script>', 'ñandú', '-guion', 'a--b'];

    const report = await run(feedId, csvOf(odd.map((value, index) => row(`X-${index}`, `${value}|raro-uno`))));

    expect(report.feeds[0].unknownVehicles).toBe(odd.length + odd.length);
    expect(report.feeds[0].unknownVehiclesNotShown).toBe(odd.length);
    expect(report.feeds[0].unknownVehicleSlugs).toEqual([{ slug: 'raro-uno', rows: odd.length }]);
    const text = formatImportReport(report);
    for (const value of odd) expect(text).not.toContain(value);
    expect(text).toContain(`  fitment: unknown vehicle values not shown rows=${odd.length}`);
    expect(JSON.stringify(report)).not.toContain('correo.example');
  });

  it('prints a slug of exactly the longest length and counts, without printing, one character more', async () => {
    const feedId = await newFeed();
    const longest = 'a'.repeat(MAX_PRINTED_SLUG_LENGTH);
    const tooLong = 'a'.repeat(MAX_PRINTED_SLUG_LENGTH + 1);

    const report = await run(feedId, csvOf([row('X-1', longest), row('X-2', tooLong)]));

    expect(report.feeds[0].unknownVehicleSlugs).toEqual([{ slug: longest, rows: 1 }]);
    expect(report.feeds[0].unknownVehiclesNotShown).toBe(1);
    expect(report.feeds[0].unknownVehicles).toBe(2);
    expect(formatImportReport(report)).not.toContain(tooLong);
  });

  describe('the bound on the printed lines (AC 24, 25)', () => {
    const MANY = MAX_UNKNOWN_SLUG_LINES + 5;
    const slugAt = (n: number) => `desconocido-${String(n).padStart(2, '0')}`;
    const manyRows = () => [
      ...Array.from({ length: MANY }, (_unused, n) => row(`B-${n}`, slugAt(n))),
      row('B-again', slugAt(0)),
    ];

    it('lists at most the cap, in first-seen order, and keeps the full total', async () => {
      const feedId = await newFeed();

      const report = await run(feedId, csvOf(manyRows()));

      const [feedReport] = report.feeds;
      expect(feedReport.unknownVehicles).toBe(MANY + 1);
      expect(feedReport.unknownVehicleSlugs.map((entry) => entry.slug)).toEqual(
        Array.from({ length: MAX_UNKNOWN_SLUG_LINES }, (_unused, n) => slugAt(n)),
      );
      expect(feedReport.unknownVehicleSlugs[0]).toEqual({ slug: slugAt(0), rows: 2 });
      expect(feedReport.unknownVehiclesNotShown).toBe(MANY - MAX_UNKNOWN_SLUG_LINES);
      const listed = feedReport.unknownVehicleSlugs.reduce((sum, entry) => sum + entry.rows, 0);
      expect(feedReport.unknownVehicles).toBe(listed + feedReport.unknownVehiclesNotShown);
    });

    it('prints the cap of lines and one not-shown line, and says the full total on the imported line', async () => {
      const feedId = await newFeed();
      const text = formatImportReport(await run(feedId, csvOf(manyRows())));
      const lines = text.split('\n').filter((line) => line.startsWith('  fitment:'));
      expect(lines).toHaveLength(MAX_UNKNOWN_SLUG_LINES + 1);
      expect(lines.at(-1)).toBe(`  fitment: unknown vehicle values not shown rows=${MANY - MAX_UNKNOWN_SLUG_LINES}`);
      expect(text).toContain(` unknown_vehicles=${MANY + 1}\n`);
    });

    it('prints the same lines in the same order on every run of the same data', async () => {
      const feedId = await newFeed();
      const csv = csvOf(manyRows());
      const lines = async () =>
        formatImportReport(await run(feedId, csv))
          .split('\n')
          .filter((line) => line.startsWith('  fitment:'));
      const first = await lines();
      expect(await lines()).toEqual(first);
    });
  });

  it('counts per feed: a second feed starts from zero', async () => {
    const one = await newFeed();
    const two = await newFeed();
    const report = await importFeeds(getDb(), {
      deps: textDeps({ [one]: csvOf([row('X-1', 'raro-uno')]), [two]: csvOf([row('X-1', A)]) }),
    });
    expect(report.feeds.map((feed) => feed.unknownVehicles)).toEqual([1, 0]);
    expect(formatImportReport(report).split('\n')[0]).toMatch(/ unknown_vehicles=1$/);
  });

  it('prints unknown_vehicles=0 and no fitment line for a feed with no unknown slug', async () => {
    const feedId = await newFeed();
    const text = formatImportReport(await run(feedId, csvOf([row('X-1', A)])));
    expect(text).toMatch(/ rejected=0 unknown_vehicles=0\n/);
    expect(text).not.toContain('fitment:');
  });

  it('writes nothing to the console (AC 28)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    );
    const feedId = await newFeed();
    await run(feedId, csvOf([row('X-1', `${A}|raro-uno|MAYUS`)]));
    expect(spies.flatMap((spy) => spy.mock.calls)).toEqual([]);
  });
});

describe('the feed row of the report and the table agree', () => {
  it('stores each fitment against the feed that said it', async () => {
    const one = await newFeed();
    const two = await newFeed();
    await importFeeds(getDb(), {
      deps: textDeps({ [one]: csvOf([row('M-1', A, { ean: EAN })]), [two]: csvOf([row('M-2', A, { ean: EAN })]) }),
    });
    const stored = await allFitmentRows();
    expect(stored.map((fitment) => fitment.feedId).sort((a, b) => a - b)).toEqual([one, two].sort((a, b) => a - b));
    expect(new Set(stored.map((fitment) => fitment.productId)).size).toBe(1);
  });
});
