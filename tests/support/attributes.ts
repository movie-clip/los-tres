import { products } from '@/db/schema';
import type { AttributeValues } from '@/server/category-attributes';

import { insertCategoryMapping } from './catalogue';
import { fiveTargets } from './categories';
import { keyRow, MAPPED } from './matching';
import type { CatalogueRow } from './catalogue-files';

// Support for the S15.3 attribute tests (US-15.3). A row is `keyRow` plus the five attribute cells, so a test
// names the one cell it is about. Every cell and every held value is invented; none is from a real shop.

/** The five cells of a row that all read, written in the shop's own forms (not the stored forms). */
export const OIL_CELLS = {
  viscosity: '10w40',
  volume_l: '4',
  acea: 'A3/B4 + C2',
  oil_type: 'Sintético',
  approvals: 'VW 504 00; VW 507 00',
} as const;

/** What `OIL_CELLS` is held as. */
export const OIL_HELD: AttributeValues = {
  viscosity: '10W-40',
  volumeMl: 4000,
  acea: ['A3/B4', 'C2'],
  oilType: 'synthetic',
  approvals: ['VW 504 00', 'VW 507 00'],
};

/** A second set of cells that read, differing from `OIL_CELLS` in every attribute. */
export const OTHER_CELLS = {
  viscosity: '5W-30',
  volume_l: '5 litros',
  acea: 'C3',
  oil_type: 'Mineral',
  approvals: 'MB 229.51',
} as const;

export const OTHER_HELD: AttributeValues = {
  viscosity: '5W-30',
  volumeMl: 5000,
  acea: ['C3'],
  oilType: 'mineral',
  approvals: ['MB 229.51'],
};

/** Five cells that are not blank and read as nothing, so each is counted as unparsed. */
export const BAD_CELLS = {
  viscosity: '5W-35',
  volume_l: '4 kg',
  acea: 'E4',
  oil_type: 'aceite sintético',
  approvals: 'x'.repeat(61),
} as const;

/** Five blank cells. */
export const BLANK_CELLS = { viscosity: '', volume_l: '', acea: '', oil_type: '', approvals: '' } as const;

export const NO_HELD: AttributeValues = { viscosity: null, volumeMl: null, acea: null, oilType: null, approvals: null };

type Cells = Partial<Record<'viscosity' | 'volume_l' | 'acea' | 'oil_type' | 'approvals', string>>;

/**
 * A feed row (`keyRow`: key, price, title, link built from the id) with the attribute cells given. Pass
 * `category: MAPPED` through `o` when the feed is mapped by `mapFeed`.
 */
export function oilRow(
  id: string,
  cells: Cells = OIL_CELLS,
  o: Parameters<typeof keyRow>[1] = {},
): CatalogueRow {
  return { ...keyRow(id, o), ...cells };
}

/** The stored attributes of a product row, as `AttributeValues`. */
export function heldOf(row: typeof products.$inferSelect): AttributeValues {
  return {
    viscosity: row.attrViscosity as AttributeValues['viscosity'],
    volumeMl: row.attrVolumeMl,
    acea: row.attrAcea as AttributeValues['acea'],
    oilType: row.attrOilType as AttributeValues['oilType'],
    approvals: row.attrApprovals,
  };
}

/** The product row with the five attribute columns removed, for a "nothing but the attributes changed" diff (AC 29). */
export function apartFromAttributes(row: typeof products.$inferSelect) {
  const { attrViscosity, attrVolumeMl, attrAcea, attrOilType, attrApprovals, ...rest } = row;
  void [attrViscosity, attrVolumeMl, attrAcea, attrOilType, attrApprovals];
  return rest;
}

/** The slug of a fixed category by tree position name: the engine-oil category is the first child. */
export async function engineOilTarget() {
  const [target] = await fiveTargets();
  if (target.slug !== 'aceite-de-motor') throw new Error('the first fixed category is not the engine oil');
  return target;
}

/** A fixed category that is not the engine oil (the oil-filter category), for a product that stores but never shows. */
export async function filterTarget() {
  const target = (await fiveTargets()).find((candidate) => candidate.slug === 'filtros-de-aceite');
  if (!target) throw new Error('the oil-filter category is missing');
  return target;
}

/** Maps the feed's `MAPPED` text to the given category, so the row's product is public there. */
export async function mapFeedTo(feedId: number, target: { id: number }): Promise<void> {
  await insertCategoryMapping(feedId, MAPPED, target.id);
}
