// The one statement of the attribute-fill rule (S15.3, D-2, D-12). Pure: no
// database, no `server-only`. It decides a later fill onto a stored product
// from what the importer already read; the row that creates a product writes
// its attributes itself and never comes here (D-16). The write is
// `fillAttributes` in ./index.ts. The eligibility is the S7.6 gate, shared with
// the EAN fill (`fillGate` in ./ean-fill.ts): it reads raw approval, hidden and
// review states, never the visibility scope, so the local flag never decides a
// fill (AC 35).

import { ATTRIBUTES, type AttributeKey, type AttributeValues } from '../category-attributes';
import { fillGate, type FillGateFacts, type FillGateSkip } from './ean-fill';

/** What the importer knows about one accepted row when it may fill attributes. */
export type AttributeFillFacts = FillGateFacts & {
  /** The row's readable values (ValidRow.attributes); null is absent. */
  row: AttributeValues;
  /** The product the offer sits on: which attributes it holds already. */
  product: FillGateFacts['product'] & { held: Record<AttributeKey, boolean> };
};

export type AttributeFillSkip =
  | 'no_values' // the row read none of the five
  | 'nothing_absent' // every attribute the row read is already held (AC 25)
  | FillGateSkip;

export type AttributeFillDecision =
  | { kind: 'skip'; reason: AttributeFillSkip }
  /** Only the attributes the row read and the product does not hold; never empty. */
  | { kind: 'fill'; values: Partial<AttributeValues> };

/** The stored field of each attribute key. */
const FIELD: { readonly [K in AttributeKey]: keyof AttributeValues } = {
  viscosity: 'viscosity',
  volume: 'volumeMl',
  acea: 'acea',
  oilType: 'oilType',
  approvals: 'approvals',
};

/** True when the row read at least one of the five. */
export function readsAnyAttribute(row: AttributeValues): boolean {
  return ATTRIBUTES.some(({ key }) => row[FIELD[key]] !== null);
}

/**
 * Whether the row may fill its product's absent attributes. Checks
 * `no_values`, then `nothing_absent`, then the shared gate; the first that
 * holds is the reason. A set value (ACEA, approvals) fills as a whole or not at
 * all (D-12); attributes fill one by one (AC 26). The reason is never reported.
 */
export function decideAttributeFill(facts: AttributeFillFacts): AttributeFillDecision {
  const skip = (reason: AttributeFillSkip): AttributeFillDecision => ({ kind: 'skip', reason });
  if (!readsAnyAttribute(facts.row)) return skip('no_values');
  const values: Partial<Record<keyof AttributeValues, unknown>> = {};
  for (const { key } of ATTRIBUTES) {
    const field = FIELD[key];
    if (facts.row[field] !== null && !facts.product.held[key]) values[field] = facts.row[field];
  }
  if (Object.keys(values).length === 0) return skip('nothing_absent');
  const gate = fillGate(facts);
  if (gate !== null) return skip(gate);
  return { kind: 'fill', values: values as Partial<AttributeValues> };
}
