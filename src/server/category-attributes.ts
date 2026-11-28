// The attributes of a category, fixed in code with their closed sets (S15.3,
// docs/product/category-attributes.md rule 1: the code is their one home), and
// the strict readers that turn one feed cell into a stored value. Pure: no
// `server-only`, no database, no `@/` alias, because validate.ts imports it
// into the CLI build. No float anywhere: a volume is digit arithmetic on the
// integer and fraction strings.

import type { FixedCategorySlug } from '../db/category-tree';

/** The one category whose product page shows the attributes (D-26: stored whatever the category). */
export const ENGINE_OIL_CATEGORY = 'aceite-de-motor' satisfies FixedCategorySlug;

export type AttributeKey = 'viscosity' | 'volume' | 'acea' | 'oilType' | 'approvals';
export type AttributeColumn = 'viscosity' | 'volume_l' | 'acea' | 'oil_type' | 'approvals';

/** Spec order; also the card's row order and the count line's order. */
export const ATTRIBUTES: readonly { key: AttributeKey; column: AttributeColumn }[] = [
  { key: 'viscosity', column: 'viscosity' },
  { key: 'volume', column: 'volume_l' },
  { key: 'acea', column: 'acea' },
  { key: 'oilType', column: 'oil_type' },
  { key: 'approvals', column: 'approvals' },
];

// Viscosity grade: SAE J300 multigrade pairings. The grade set rests on
// secondary sources, not on a primary read of the standard (D-6).
export const VISCOSITY_WINTER = ['0W', '5W', '10W', '15W', '20W', '25W'] as const;
export const VISCOSITY_HOT = [8, 12, 16, 20, 30, 40, 50, 60] as const;
/** The four pairings left out of the closed set (D-5). */
export const VISCOSITY_EXCLUDED = ['25W-8', '25W-12', '25W-16', '25W-20'] as const;

type ViscosityWinter = (typeof VISCOSITY_WINTER)[number];
type ViscosityHot = (typeof VISCOSITY_HOT)[number];
export type ViscosityGrade = Exclude<
  `${ViscosityWinter}-${ViscosityHot}`,
  (typeof VISCOSITY_EXCLUDED)[number]
>;

function isExcludedViscosity(grade: string): boolean {
  return (VISCOSITY_EXCLUDED as readonly string[]).includes(grade);
}

/** The 44 grades, winter-major order. */
export const VISCOSITY_GRADES: readonly ViscosityGrade[] = VISCOSITY_WINTER.flatMap((winter) =>
  VISCOSITY_HOT.map((hot) => `${winter}-${hot}` as const).filter(
    (grade): grade is ViscosityGrade => !isExcludedViscosity(grade),
  ),
);

/**
 * The twelve light-duty ACEA sequences (D-3 adds C7; D-4 keeps the withdrawn
 * ones readable). A withdrawn sequence behaves exactly like a current one.
 * Closed-set order = held order = display order.
 */
export const ACEA_SEQUENCES = [
  { token: 'A1/B1', withdrawn: true },
  { token: 'A3/B3', withdrawn: true },
  { token: 'A3/B4', withdrawn: false },
  { token: 'A5/B5', withdrawn: false },
  { token: 'A7/B7', withdrawn: false },
  { token: 'C1', withdrawn: true },
  { token: 'C2', withdrawn: false },
  { token: 'C3', withdrawn: false },
  { token: 'C4', withdrawn: false },
  { token: 'C5', withdrawn: false },
  { token: 'C6', withdrawn: false },
  { token: 'C7', withdrawn: false },
] as const;
export type AceaSequence = (typeof ACEA_SEQUENCES)[number]['token'];

/** Oil-type family keys, stored as is; the page maps each to its message. */
export const OIL_TYPES = ['synthetic', 'semi-synthetic', 'mineral'] as const;
export type OilType = (typeof OIL_TYPES)[number];

export const VOLUME_MIN_ML = 100;
export const VOLUME_MAX_ML = 220_000;
export const APPROVALS_MAX_ITEMS = 20;
export const APPROVAL_MAX_CHARS = 60;

/** Longest viscosity or volume cell that can read; a longer one is unparsed. */
const MAX_SHORT_CELL = 64;

/** Stored form: what the import holds. Null = absent. Arrays never empty. */
export type AttributeValues = {
  /** '10W-40' */
  viscosity: ViscosityGrade | null;
  /** Integer millilitres, VOLUME_MIN_ML..VOLUME_MAX_ML. */
  volumeMl: number | null;
  /** Closed-set order, no repeats. */
  acea: readonly AceaSequence[] | null;
  oilType: OilType | null;
  /** Cleaned, feed order, 1..APPROVALS_MAX_ITEMS items. */
  approvals: readonly string[] | null;
};

/** One cell's reading. A blank cell is absent and never counted (D-7). */
export type AttributeReading<T> =
  | { kind: 'blank' }
  | { kind: 'unparsed' }
  | { kind: 'value'; value: T };

const BLANK = { kind: 'blank' } as const;
const UNPARSED = { kind: 'unparsed' } as const;
function valueOf<T>(value: T): AttributeReading<T> {
  return { kind: 'value', value };
}

const VISCOSITY_PATTERN =
  /^(?:SAE ?)?(0|5|10|15|20|25)W(?: ?[-–/] ?| )?(8|12|16|20|30|40|50|60)$/;

/**
 * Trimmed, upper-cased, whitespace collapsed; an optional leading SAE; the
 * halves joined by a hyphen, an en dash, a slash, a space or nothing. Written
 * `<winter>W-<hot>`.
 */
export function readViscosity(cell: string): AttributeReading<ViscosityGrade> {
  const text = cell.trim();
  if (text === '') return BLANK;
  if (text.length > MAX_SHORT_CELL) return UNPARSED;
  const match = VISCOSITY_PATTERN.exec(text.toUpperCase().replace(/\s+/g, ' '));
  if (!match) return UNPARSED;
  const grade = `${match[1]}W-${match[2]}`;
  if (isExcludedViscosity(grade)) return UNPARSED;
  return valueOf(grade as ViscosityGrade);
}

const VOLUME_PATTERN = /^(\d{1,6})(?:[.,](\d{1,3}))?\s*(l|lt|lts|litro|litros|ml|cl)?$/i;

/**
 * Millilitres. A bare number is litres; `ml` and `cl` are accepted. A dot or a
 * comma with one to three digits is the decimal separator; no thousands
 * separator. The value must be a whole number of millilitres and in range.
 */
export function readVolume(cell: string): AttributeReading<number> {
  const text = cell.trim();
  if (text === '') return BLANK;
  if (text.length > MAX_SHORT_CELL) return UNPARSED;
  const match = VOLUME_PATTERN.exec(text);
  if (!match) return UNPARSED;
  const whole = Number(match[1]);
  const fraction = (match[2] ?? '').padEnd(3, '0');
  const unit = (match[3] ?? 'l').toLowerCase();
  let millilitres: number;
  if (unit === 'ml') {
    if (fraction !== '000') return UNPARSED;
    millilitres = whole;
  } else if (unit === 'cl') {
    // One centilitre is ten millilitres: only the first fraction digit may be non-zero.
    if (fraction.slice(1) !== '00') return UNPARSED;
    millilitres = whole * 10 + Number(fraction[0]);
  } else {
    millilitres = whole * 1000 + Number(fraction);
  }
  if (millilitres < VOLUME_MIN_ML || millilitres > VOLUME_MAX_ML) return UNPARSED;
  return valueOf(millilitres);
}

/** Litres with a decimal comma, trailing zeros dropped, a space and `l`: 1005 -> '1,005 l', 4000 -> '4 l'. */
export function formatVolumeMl(ml: number): string {
  const digits = String(ml).padStart(4, '0');
  const whole = digits.slice(0, -3);
  const fraction = digits.slice(-3).replace(/0+$/, '');
  return fraction === '' ? `${whole} l` : `${whole},${fraction} l`;
}

const ACEA_AB_CHUNK = /^A\d\/B\d(-\d{2})?$/;
const ACEA_C_CHUNK = /^C\d(-\d{2})?(\/C\d(-\d{2})?)*$/;
const ACEA_TOKENS: readonly string[] = ACEA_SEQUENCES.map((sequence) => sequence.token);

/**
 * One or more sequences separated by `,`, `;`, `+` or the word `y`, or a slash
 * between two C sequences; an optional leading `ACEA` on each; a two-digit year
 * suffix ignored. Unrecognised chunks are dropped; the rest de-duplicated and
 * held in closed-set order. Nothing recognised is unparsed.
 */
export function readAcea(cell: string): AttributeReading<readonly AceaSequence[]> {
  const text = cell.trim().toUpperCase();
  if (text === '') return BLANK;
  const found = new Set<string>();
  for (const raw of text.split(/[,;+]|\bY\b/)) {
    const chunk = raw
      .trim()
      .replace(/^ACEA\s*/, '')
      .replace(/\s*([/-])\s*/g, '$1');
    let tokens: string[] = [];
    if (ACEA_AB_CHUNK.test(chunk)) tokens = [chunk.replace(/-\d{2}$/, '')];
    else if (ACEA_C_CHUNK.test(chunk)) tokens = chunk.split('/').map((c) => c.replace(/-\d{2}$/, ''));
    for (const token of tokens) {
      if (ACEA_TOKENS.includes(token)) found.add(token);
    }
  }
  if (found.size === 0) return UNPARSED;
  return valueOf(ACEA_SEQUENCES.map((s) => s.token).filter((token) => found.has(token)));
}

// Whole-value match (D-23), Spanish masculine and feminine and English (D-15, D-22).
const SYNTHETIC_WORD = '(?:sintetico|sintetica|synthetic)';
const SEMI_SYNTHETIC_PATTERN = new RegExp(`^semi[- ]?${SYNTHETIC_WORD}$`);
const SYNTHETIC_PATTERN = new RegExp(`^${SYNTHETIC_WORD}$`);

/**
 * Folded for case and accents; a leading `100%` (or `100 %`) and every whole
 * word `base` dropped; then the whole remainder must be one family word.
 * Semi-synthetic is tested before synthetic.
 */
export function readOilType(cell: string): AttributeReading<OilType> {
  if (cell.trim() === '') return BLANK;
  const text = cell
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/^100 ?%/, '')
    .replace(/\bbase\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (SEMI_SYNTHETIC_PATTERN.test(text)) return valueOf('semi-synthetic');
  if (SYNTHETIC_PATTERN.test(text)) return valueOf('synthetic');
  if (text === 'mineral') return valueOf('mineral');
  return UNPARSED;
}

/**
 * Split on `,` and `;`; each item trimmed, inner whitespace collapsed; blank
 * items, items over APPROVAL_MAX_CHARS code points and case-insensitive
 * repeats dropped (first spelling kept); then the first APPROVALS_MAX_ITEMS.
 * No non-blank item is blank; non-blank items all dropped is unparsed (D-24).
 */
export function readApprovals(cell: string): AttributeReading<readonly string[]> {
  const items = cell
    .split(/[,;]/)
    .map((item) => item.trim().replace(/\s+/g, ' '))
    .filter((item) => item !== '');
  if (items.length === 0) return BLANK;
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if ([...item].length > APPROVAL_MAX_CHARS) continue;
    const folded = item.toLowerCase();
    if (seen.has(folded)) continue;
    seen.add(folded);
    kept.push(item);
  }
  if (kept.length === 0) return UNPARSED;
  return valueOf(kept.slice(0, APPROVALS_MAX_ITEMS));
}
