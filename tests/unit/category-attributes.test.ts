import { describe, expect, it } from 'vitest';

import { FIXED_CATEGORY_TREE } from '@/db/category-tree';
import {
  ACEA_SEQUENCES,
  APPROVAL_MAX_CHARS,
  APPROVALS_MAX_ITEMS,
  ATTRIBUTES,
  ENGINE_OIL_CATEGORY,
  formatVolumeMl,
  OIL_TYPES,
  readAcea,
  readApprovals,
  readOilType,
  readViscosity,
  readVolume,
  VISCOSITY_EXCLUDED,
  VISCOSITY_GRADES,
  VISCOSITY_HOT,
  VISCOSITY_WINTER,
  VOLUME_MAX_ML,
  VOLUME_MIN_ML,
} from '@/server/category-attributes';

// S15.3 (US-15.3) ACs 6 to 17: the fixed list, its closed sets as the owner amended them (D-3 to D-5,
// D-22, D-23, D-24, D-27) and the five strict readers. Pure: no database, no network. Every value is the
// spec's illustrative form or invented. A reader answers blank (absent, never counted, D-7), unparsed
// (absent, counted) or a value, and these tests keep those three apart.

const BLANK = { kind: 'blank' };
const UNPARSED = { kind: 'unparsed' };
const value = <T>(v: T) => ({ kind: 'value', value: v });

describe('the fixed list and its closed sets are pinned whole (rule 1, D-3 to D-5)', () => {
  it('the engine-oil category is a slug of the fixed tree', () => {
    expect(ENGINE_OIL_CATEGORY).toBe('aceite-de-motor');
    expect(FIXED_CATEGORY_TREE.children.map((child) => child.slug)).toContain(ENGINE_OIL_CATEGORY);
  });

  it('lists the five attributes in the spec order, each with its feed column', () => {
    expect(ATTRIBUTES).toEqual([
      { key: 'viscosity', column: 'viscosity' },
      { key: 'volume', column: 'volume_l' },
      { key: 'acea', column: 'acea' },
      { key: 'oilType', column: 'oil_type' },
      { key: 'approvals', column: 'approvals' },
    ]);
  });

  it('pins the viscosity halves and the four excluded pairings (D-5)', () => {
    expect(VISCOSITY_WINTER).toEqual(['0W', '5W', '10W', '15W', '20W', '25W']);
    expect(VISCOSITY_HOT).toEqual([8, 12, 16, 20, 30, 40, 50, 60]);
    expect(VISCOSITY_EXCLUDED).toEqual(['25W-8', '25W-12', '25W-16', '25W-20']);
  });

  it('holds exactly the 44 grades, winter-major, with the four excluded ones absent', () => {
    expect(VISCOSITY_GRADES).toHaveLength(44);
    expect(VISCOSITY_GRADES.slice(0, 9)).toEqual(['0W-8', '0W-12', '0W-16', '0W-20', '0W-30', '0W-40', '0W-50', '0W-60', '5W-8']);
    expect(VISCOSITY_GRADES.slice(-4)).toEqual(['25W-30', '25W-40', '25W-50', '25W-60']);
    for (const excluded of VISCOSITY_EXCLUDED) expect(VISCOSITY_GRADES).not.toContain(excluded);
    expect(new Set(VISCOSITY_GRADES).size).toBe(44);
  });

  it('pins the twelve ACEA sequences in closed-set order, the withdrawn ones marked (D-3, D-4)', () => {
    expect(ACEA_SEQUENCES).toEqual([
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
    ]);
  });

  it('pins the oil families and the limits', () => {
    expect(OIL_TYPES).toEqual(['synthetic', 'semi-synthetic', 'mineral']);
    expect([VOLUME_MIN_ML, VOLUME_MAX_ML]).toEqual([100, 220_000]);
    expect([APPROVALS_MAX_ITEMS, APPROVAL_MAX_CHARS]).toEqual([20, 60]);
  });
});

describe('readViscosity (AC 6, 7, 8)', () => {
  it.each<[string, string]>([
    ['10w40', '10W-40'],
    ['10W-40', '10W-40'],
    ['SAE 15W 40', '15W-40'],
    ['0W/20', '0W-20'],
    ['  5w-30  ', '5W-30'],
    ['5W–' + '30', '5W-30'],
    ['sae5w30', '5W-30'],
    ['SAE  10W - 40', '10W-40'],
    ['10W / 40', '10W-40'],
    ['sae 20w50', '20W-50'],
  ])('reads %j as %s', (cell, grade) => {
    expect(readViscosity(cell)).toEqual(value(grade));
  });

  const PAIRINGS = VISCOSITY_WINTER.flatMap((winter) => VISCOSITY_HOT.map((hot) => ({ winter, hot })));

  it('covers all 48 pairings of the six winter and eight hot grades', () => {
    expect(PAIRINGS).toHaveLength(48);
  });

  it.each(PAIRINGS.map(({ winter, hot }) => [`${winter}-${hot}`, winter, hot] as const))(
    '%s: in the closed set it reads in every joining form, outside it it does not (D-5)',
    (grade, winter, hot) => {
      const inSet = !(VISCOSITY_EXCLUDED as readonly string[]).includes(grade);
      const forms = [`${winter}-${hot}`, `${winter}${hot}`, `${winter}/${hot}`, `${winter} ${hot}`, `sae ${winter.toLowerCase()}-${hot}`];
      for (const form of forms) {
        expect(readViscosity(form)).toEqual(inSet ? value(grade) : UNPARSED);
      }
      expect(VISCOSITY_GRADES.includes(grade as never)).toBe(inSet);
    },
  );

  it.each([
    ['a winter half alone', '5W'],
    ['a winter half alone with SAE', 'SAE 10W'],
    ['a hot half alone', '40'],
    ['a pair outside the set', '5W-35'],
    ['another winter grade', '30W-40'],
    ['a monograde oil', 'SAE 30'],
    ['two grades in one cell', '10W-40 / 5W-30'],
    ['two grades separated by a comma', '10W-40, 5W-30'],
    ['text after the grade', '10W-40 sintetico'],
    ['other text', 'aceite de motor'],
    ['a missing winter number', 'W-40'],
    ['no W', '10-40'],
    ['a double joiner', '10W--40'],
  ])('does not read %s (%j is unparsed, not blank)', (_label, cell) => {
    expect(readViscosity(cell)).toEqual(UNPARSED);
  });

  it('does not read a cell over 64 characters, even one that starts with a grade', () => {
    expect(readViscosity(`10W-40${' '.repeat(10)}x`.padEnd(65, 'x'))).toEqual(UNPARSED);
    expect(readViscosity(`10W-40${' '.repeat(80)}`)).toEqual(value('10W-40')); // trailing blanks are trimmed first
  });

  it.each(['', ' ', ' \t '])('reads %j as blank, which is absent and not counted (D-7)', (cell) => {
    expect(readViscosity(cell)).toEqual(BLANK);
  });
});

describe('readVolume and formatVolumeMl (AC 9, 10, 11, 12)', () => {
  /** The cell as the page would write it. */
  const shown = (cell: string): string | null => {
    const reading = readVolume(cell);
    return reading.kind === 'value' ? formatVolumeMl(reading.value) : null;
  };

  it.each<[string, string]>([
    ['4', '4 l'],
    ['4 L', '4 l'],
    ['1,5 litros', '1,5 l'],
    ['500 ml', '0,5 l'],
    ['75 cl', '0,75 l'],
    ['1005 ml', '1,005 l'],
    ['1.5', '1,5 l'],
    ['5l', '5 l'],
    ['4,5L', '4,5 l'],
    ['2 LT', '2 l'],
    ['2 lts', '2 l'],
    ['1 Litro', '1 l'],
    ['1 LITROS', '1 l'],
    ['500ML', '0,5 l'],
    ['10,5 cl', '0,105 l'],
    ['10 cl', '0,1 l'],
    ['  4  ', '4 l'],
    ['205', '205 l'],
  ])('reads %j and shows %s', (cell, text) => {
    expect(shown(cell)).toBe(text);
  });

  it('holds millilitres as an integer, exact to one millilitre, never through a binary float (AC 9)', () => {
    expect(readVolume('1005 ml')).toEqual(value(1005));
    expect(readVolume('1,005')).toEqual(value(1005));
    expect(readVolume('4,999')).toEqual(value(4999));
    expect(readVolume('0,29')).toEqual(value(290));
    expect(readVolume('1,1')).toEqual(value(1100));
    expect(readVolume('1,001')).toEqual(value(1001));
    expect(readVolume('75 cl')).toEqual(value(750));
  });

  it.each([
    ['2.000', '2 l'],
    ['2,000', '2 l'],
    ['1.234', '1,234 l'],
    ['0.5', '0,5 l'],
  ])('a dot or a comma and up to three digits is the decimal separator: %j reads %s (AC 10)', (cell, text) => {
    expect(shown(cell)).toBe(text);
  });

  it.each([
    ['a thousands separator and a decimal part', '1.234,5'],
    ['both separators the other way round', '1,234.5'],
    ['two thousands separators', '1.000.000'],
    ['four decimals', '1,2345'],
    ['a leading separator', '.5'],
    ['a sign', '-4'],
    ['a plus sign', '+4'],
  ])('does not read %s (%j)', (_label, cell) => {
    expect(readVolume(cell)).toEqual(UNPARSED);
  });

  it.each([
    ['0,1', '0,1 l'],
    ['100 ml', '0,1 l'],
    ['220', '220 l'],
    ['220 L', '220 l'],
    ['22000 cl', '220 l'],
    ['220000 ml', '220 l'],
  ])('%j is in range, 0,1 l to 220 l inclusive (AC 11)', (cell, text) => {
    expect(shown(cell)).toBe(text);
  });

  it.each(['0,099', '99 ml', '0', '0 l', '220,001', '221', '220001 ml', '22001 cl', '7,5 cl'])(
    '%j is outside the range and does not read (AC 11)',
    (cell) => {
      expect(readVolume(cell)).toEqual(UNPARSED);
    },
  );

  it.each([
    ['a mass unit', '4 kg'],
    ['a gallon', '1 gal'],
    ['gallons spelled out', '1 galon'],
    ['a ratio', '1:5'],
    ['a pack of a count times a size', '4 x 1 l'],
    ['a pack with a multiplication sign', '6 × 500 ml'],
    ['a range', '4-5 l'],
    ['two values', '4 l 5 l'],
    ['a value and text', '4 litros de aceite'],
    ['other text', 'cuatro litros'],
    ['a trailing full stop', '4 l.'],
    ['a fractional millilitre', '500,5 ml'],
    ['a centilitre that is not a whole millilitre', '12,55 cl'],
    ['more than six integer digits', '1234567'],
  ])('does not read %s (%j) (AC 12)', (_label, cell) => {
    expect(readVolume(cell)).toEqual(UNPARSED);
  });

  it('does not read a cell over 64 characters', () => {
    expect(readVolume(`4${' '.repeat(70)}x`)).toEqual(UNPARSED);
  });

  it.each(['', '  ', '\t'])('reads %j as blank', (cell) => {
    expect(readVolume(cell)).toEqual(BLANK);
  });

  describe('formatVolumeMl', () => {
    it.each<[number, string]>([
      [100, '0,1 l'],
      [105, '0,105 l'],
      [750, '0,75 l'],
      [1000, '1 l'],
      [1005, '1,005 l'],
      [1500, '1,5 l'],
      [4000, '4 l'],
      [5200, '5,2 l'],
      [200000, '200 l'],
      [220000, '220 l'],
    ])('%i ml is %s: a decimal comma, trailing zeros dropped, a plain space, a lower-case l', (ml, text) => {
      expect(formatVolumeMl(ml)).toBe(text);
    });

    it('writes back what the reader holds, for every whole litre in range and the boundaries', () => {
      for (const litres of [1, 2, 3, 4, 5, 10, 20, 100, 220]) {
        expect(readVolume(formatVolumeMl(litres * 1000))).toEqual(value(litres * 1000));
      }
      for (const ml of [VOLUME_MIN_ML, 105, 999, 1005, 4999, VOLUME_MAX_ML]) {
        expect(readVolume(formatVolumeMl(ml))).toEqual(value(ml));
      }
    });
  });
});

describe('readAcea (AC 13, 14, 15; D-3, D-4, D-27)', () => {
  const tokens = ACEA_SEQUENCES.map((sequence) => sequence.token);

  it.each(tokens)('reads %s alone, withdrawn or not', (token) => {
    expect(readAcea(token)).toEqual(value([token]));
    expect(readAcea(token.toLowerCase())).toEqual(value([token]));
    expect(readAcea(`ACEA ${token}`)).toEqual(value([token]));
  });

  it('has twelve sequences, so the loop above is the whole closed set', () => {
    expect(tokens).toHaveLength(12);
  });

  it.each(['E4', 'E7', 'E9', 'A3', 'B4', 'A5', 'B3', 'C8', 'C0', 'A1', 'A9/B9', 'A3 B4'])(
    '%s alone is not in the set, and a half sequence is never read: unparsed',
    (cell) => {
      expect(readAcea(cell)).toEqual(UNPARSED);
    },
  );

  it.each<[string, string[]]>([
    ['ACEA C5', ['C5']],
    ['A3/B4 + C2', ['A3/B4', 'C2']],
    ['C3-21', ['C3']],
    ['c2/c3', ['C2', 'C3']],
    ['A3/B4, C2', ['A3/B4', 'C2']],
    ['A3/B4; C3', ['A3/B4', 'C3']],
    ['A3/B4 y C2', ['A3/B4', 'C2']],
    ['A3/B4 Y C2', ['A3/B4', 'C2']],
    ['A3 / B4', ['A3/B4']],
    ['C2 / C3', ['C2', 'C3']],
    ['A3/B4-08', ['A3/B4']],
    ['a5/b5', ['A5/B5']],
    ['  ACEA   C2  ', ['C2']],
    ['C1/C2/C3', ['C1', 'C2', 'C3']],
  ])('reads %j as %j', (cell, held) => {
    expect(readAcea(cell)).toEqual(value(held));
  });

  it('accepts the ACEA prefix on each sequence, not only on the cell (D-27)', () => {
    expect(readAcea('ACEA C2, ACEA C3')).toEqual(value(['C2', 'C3']));
    expect(readAcea('ACEA A3/B4 + ACEA C2')).toEqual(value(['A3/B4', 'C2']));
  });

  it('ignores only a two-digit year suffix (D-27): a four-digit year drops that sequence', () => {
    expect(readAcea('C3-21')).toEqual(value(['C3']));
    expect(readAcea('C3-2021')).toEqual(UNPARSED);
    expect(readAcea('C3 (2021)')).toEqual(UNPARSED);
    expect(readAcea('C2, C3-2021')).toEqual(value(['C2']));
  });

  it('does not let a slash join an A/B sequence to a C sequence', () => {
    expect(readAcea('A3/B4/C2')).toEqual(UNPARSED);
  });

  it('holds the sequences it recognised and drops the rest, without counting the cell as unparsed (AC 15)', () => {
    expect(readAcea('A3/B4, E4, nada')).toEqual(value(['A3/B4']));
    expect(readAcea('E7; C2')).toEqual(value(['C2']));
  });

  it('holds each sequence once however often the cell names it', () => {
    expect(readAcea('C2, C2, c2, ACEA C2')).toEqual(value(['C2']));
    expect(readAcea('C2/C3, C3')).toEqual(value(['C2', 'C3']));
  });

  it('holds them in the closed-set order, not the order the feed wrote', () => {
    expect(readAcea('C3, A3/B4, C1, A1/B1')).toEqual(value(['A1/B1', 'A3/B4', 'C1', 'C3']));
    expect(readAcea('C7 + C6 + C5 + C4 + C3 + C2 + C1 + A7/B7 + A5/B5 + A3/B4 + A3/B3 + A1/B1')).toEqual(value(tokens));
  });

  it.each(['E4, E7', 'ACEA', 'ACEA E4', 'nada', ',,,', '+'])('a non-blank cell with no recognised sequence is unparsed: %j', (cell) => {
    expect(readAcea(cell)).toEqual(UNPARSED);
  });

  it.each(['', '   '])('a blank cell is blank: %j', (cell) => {
    expect(readAcea(cell)).toEqual(BLANK);
  });
});

describe('readOilType (AC 16; D-15, D-22, D-23)', () => {
  it.each([
    'sintético',
    'Sintético',
    'SINTETICO',
    'synthetic',
    'Synthetic',
    '100% sintético',
    '100 % synthetic',
    'base sintética',
    'Base Sintetica',
    '100% base sintético',
    'sintética',
    'Sintética',
  ])('%j is synthetic (the feminine forms are D-22)', (cell) => {
    expect(readOilType(cell)).toEqual(value('synthetic'));
  });

  it.each([
    'semisintético',
    'semi sintético',
    'semi-sintético',
    'Semi-Sintético',
    'semi-synthetic',
    'semi synthetic',
    'Semi Synthetic',
    'semisynthetic',
    'semisintética',
    'semi sintética',
    'semi-sintética',
    'base semisintético',
    '100% semi-synthetic',
  ])('%j is semi-synthetic, tested before synthetic', (cell) => {
    expect(readOilType(cell)).toEqual(value('semi-synthetic'));
  });

  it.each(['mineral', 'Mineral', 'MINERAL', 'base mineral', '100% mineral', '  mineral  '])('%j is mineral', (cell) => {
    expect(readOilType(cell)).toEqual(value('mineral'));
  });

  it.each([
    ['a family and an extra word (D-23: the whole value must be a family word)', 'aceite sintético'],
    ['an English phrase', 'synthetic blend'],
    ['a technology phrase', 'tecnología sintética'],
    ['two families named', 'sintético mineral'],
    ['two families, the other order', 'mineral synthetic'],
    ['the semi prefix alone', 'semi'],
    ['a family that is not in the list', 'vegetal'],
    ['semi-mineral', 'semi-mineral'],
    ['a plural', 'sintéticos'],
    ['a hybrid word', 'hybrid'],
    ['only the word base', 'base'],
    ['only 100%', '100%'],
    ['a family and a viscosity', 'sintético 5W-30'],
  ])('does not read %s: %j is unparsed', (_label, cell) => {
    expect(readOilType(cell)).toEqual(UNPARSED);
  });

  it.each(['', '  ', '\t'])('reads %j as blank', (cell) => {
    expect(readOilType(cell)).toEqual(BLANK);
  });
});

describe('readApprovals (AC 17; D-24)', () => {
  it('splits on a comma or a semicolon, as written and in order', () => {
    expect(readApprovals('VW 504 00; VW 507 00, MB 229.51')).toEqual(value(['VW 504 00', 'VW 507 00', 'MB 229.51']));
  });

  it('keeps a slash or a space inside an item', () => {
    expect(readApprovals('MB 229.5/229.51; Porsche A40')).toEqual(value(['MB 229.5/229.51', 'Porsche A40']));
  });

  it('trims each item and collapses inner whitespace, and keeps the written case', () => {
    expect(readApprovals('  VW   504  00 ;\tmb 229.51 ')).toEqual(value(['VW 504 00', 'mb 229.51']));
  });

  it('drops blank items', () => {
    expect(readApprovals('a;; b; ,  ,c')).toEqual(value(['a', 'b', 'c']));
  });

  it('drops case-insensitive duplicates and keeps the first spelling', () => {
    expect(readApprovals('vw 504 00; VW 504 00; Vw 504   00; BMW LL-04')).toEqual(value(['vw 504 00', 'BMW LL-04']));
  });

  it('keeps an item of 60 characters and drops one of 61, never cutting it', () => {
    const sixty = 'a'.repeat(60);
    const sixtyOne = 'b'.repeat(61);
    expect(readApprovals(sixty)).toEqual(value([sixty]));
    expect(readApprovals(`${sixty}; ${sixtyOne}; c`)).toEqual(value([sixty, 'c']));
  });

  it('counts the 60 characters as characters, not UTF-16 units', () => {
    const sixtyEmoji = '\u{1F6E2}'.repeat(60);
    expect(readApprovals(sixtyEmoji)).toEqual(value([sixtyEmoji]));
    expect(readApprovals('\u{1F6E2}'.repeat(61))).toEqual(UNPARSED);
  });

  it('keeps 20 items and drops the 21st', () => {
    const items = Array.from({ length: 21 }, (_, index) => `Item ${index + 1}`);
    expect(readApprovals(items.slice(0, 20).join('; '))).toEqual(value(items.slice(0, 20)));
    expect(readApprovals(items.join('; '))).toEqual(value(items.slice(0, 20)));
  });

  it('never lets a dropped item (over-long or repeated) use one of the 20 slots', () => {
    const long = 'x'.repeat(61);
    const items = ['Item 1', long, 'item 1', ...Array.from({ length: 20 }, (_, index) => `Otro ${index + 1}`)];
    const read = readApprovals(items.join('; '));
    expect(read.kind).toBe('value');
    const held = read.kind === 'value' ? read.value : [];
    expect(held).toHaveLength(20);
    expect(held[0]).toBe('Item 1');
    expect(held[1]).toBe('Otro 1');
    expect(held[19]).toBe('Otro 19');
  });

  it('keeps markup characters as plain text', () => {
    expect(readApprovals('<b>VW</b> 504 00; A & B')).toEqual(value(['<b>VW</b> 504 00', 'A & B']));
  });

  it('is unparsed when a non-blank cell cleans to nothing: every item over 60 characters (D-24)', () => {
    expect(readApprovals(`${'x'.repeat(61)}; ${'y'.repeat(80)}`)).toEqual(UNPARSED);
  });

  it('is not unparsed when only some items were dropped', () => {
    expect(readApprovals(`${'x'.repeat(61)}; ok`)).toEqual(value(['ok']));
  });

  it.each(['', '   ', ' ; , ;', ',,,'])('a cell with no non-blank item is blank, not counted: %j', (cell) => {
    expect(readApprovals(cell)).toEqual(BLANK);
  });
});
