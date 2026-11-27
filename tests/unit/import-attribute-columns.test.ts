import { describe, expect, it } from 'vitest';

import { ATTRIBUTES } from '@/server/category-attributes';
import { openRecords } from '@/server/importer/records';
import { CANONICAL_COLUMNS, readHeader, validateRow, type ColumnIndex, type ValidRow } from '@/server/importer/validate';

import { ATTRIBUTE_COLUMNS, bytesOf, csvOf, gzipOf, xmlOf, type FeedRow } from '../support/feeds';

// S15.3 (US-15.3) ACs 1 to 5 and 18, the pure half: the five optional attribute columns through the
// importer's own header and row validators, and through the CSV and XML readers (plain and gzip). What a
// cell reads as is category-attributes.test.ts's; this file proves the entry reaches the reader, that it
// never rejects a row and that a blank, an unreadable value and an absent column are three different
// things. No database, no network. Every value is invented.

const HEADER = [
  'id',
  'title',
  'brand',
  'part_number',
  'ean',
  'price',
  'currency',
  'url',
  'description',
  'category',
  'fitment',
  ...ATTRIBUTE_COLUMNS,
];

function columnsOf(header: string[] = HEADER): ColumnIndex {
  const found = readHeader(header);
  if (!found) throw new Error('header fixture is invalid');
  return found;
}

/** A valid record under HEADER; each test overrides the cells it is about. */
function record(overrides: Record<string, string> = {}, header: string[] = HEADER): string[] {
  const base: Record<string, string> = {
    id: 'X-1',
    title: 'Aceite de prueba',
    brand: 'Marca',
    part_number: 'PN 1',
    ean: '2000000000015',
    price: '12.99',
    currency: 'EUR',
    url: 'https://shop.example/p/1',
    description: 'Descripcion',
    category: 'Aceites',
    fitment: '',
    viscosity: '',
    volume_l: '',
    acea: '',
    oil_type: '',
    approvals: '',
    ...overrides,
  };
  return header.map((name) => base[name.trim().toLowerCase()] ?? '');
}

function rowOf(cells: string[], index: ColumnIndex = columnsOf()): ValidRow {
  const result = validateRow(cells, index, 2);
  if (!result.ok) throw new Error(`expected a valid row, got ${result.reject.code}`);
  return result.row;
}

const NO_ATTRIBUTES = { viscosity: null, volumeMl: null, acea: null, oilType: null, approvals: null };
const ALL_FIVE = {
  viscosity: '10w40',
  volume_l: '4',
  acea: 'A3/B4 + C2',
  oil_type: 'Sintético',
  approvals: 'VW 504 00; VW 507 00',
};
const ALL_FIVE_HELD = {
  viscosity: '10W-40',
  volumeMl: 4000,
  acea: ['A3/B4', 'C2'],
  oilType: 'synthetic',
  approvals: ['VW 504 00', 'VW 507 00'],
};
/** Five cells that are not blank and read as nothing. */
const ALL_FIVE_BAD = {
  viscosity: '5W-35',
  volume_l: '4 kg',
  acea: 'E4',
  oil_type: 'aceite sintético',
  approvals: `${'x'.repeat(61)}`,
};

describe('the five attribute columns reach the row validator (AC 1)', () => {
  it('reads each cell into its stored form, whatever the form the shop wrote', () => {
    const row = rowOf(record(ALL_FIVE));
    expect(row.attributes).toEqual(ALL_FIVE_HELD);
    expect(row.unparsed).toEqual([]);
  });

  it('finds the five headers trimmed and in any letter case, and lets the first of two equal columns win', () => {
    const header = [' ID ', 'Title', 'price', 'url', ' VISCOSITY ', 'Volume_L', 'ACEA', 'Oil_Type', 'APPROVALS', 'viscosity'];
    const index = columnsOf(header);
    const cells = ['X-1', 'T', '9.99', 'https://shop.example/p/1', '5w30', '1,5', 'c3', 'mineral', 'a; b', '10W-40'];
    expect(rowOf(cells, index).attributes).toEqual({
      viscosity: '5W-30',
      volumeMl: 1500,
      acea: ['C3'],
      oilType: 'mineral',
      approvals: ['a', 'b'],
    });
  });

  it('keeps the old ten columns where they were and appends the five after fitment, in ATTRIBUTES order', () => {
    expect(CANONICAL_COLUMNS.slice(0, 11)).toEqual([
      'id',
      'title',
      'price',
      'url',
      'brand',
      'part_number',
      'description',
      'ean',
      'currency',
      'category',
      'fitment',
    ]);
    expect(CANONICAL_COLUMNS.slice(11)).toEqual(ATTRIBUTES.map((attribute) => attribute.column));
    expect(CANONICAL_COLUMNS).toHaveLength(16);
  });

  it('reads every attribute as absent, with nothing unparsed, when the feed has none of the columns (AC 2)', () => {
    const old = readHeader(['id', 'title', 'price', 'url']);
    if (!old) throw new Error('header fixture is invalid');
    const row = rowOf(['X-1', 'Titulo', '9.99', 'https://shop.example/p/1'], old);
    expect(row.attributes).toEqual(NO_ATTRIBUTES);
    expect(row.unparsed).toEqual([]);
  });
});

describe('an entry never rejects a row (AC 3)', () => {
  it('accepts a row whose five cells are all blank, all unreadable, or all far outside their sets', () => {
    const outside = {
      viscosity: '99W-999',
      volume_l: '999999999999 l',
      acea: 'ZZZ',
      oil_type: '???',
      approvals: ';;;',
    };
    for (const cells of [{}, ALL_FIVE_BAD, outside]) {
      expect(validateRow(record(cells), columnsOf(), 2).ok).toBe(true);
    }
  });

  it('accepts a very long cell in every attribute column, and keeps the row\'s other fields', () => {
    const long = 'x'.repeat(100_000);
    const result = validateRow(record({ viscosity: long, volume_l: long, acea: long, oil_type: long, approvals: long }), columnsOf(), 2);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.row).toMatchObject({ externalId: 'X-1', priceCents: 1299 });
    // 100,000 characters of x are one approvals item, over 60 characters: dropped, so that cell is unparsed.
    expect(result.row.unparsed).toEqual(['viscosity', 'volume', 'acea', 'oilType', 'approvals']);
  });

  it('keeps every existing reject reason: an invalid row is still rejected for its own code, whatever its entries hold', () => {
    const bad = validateRow(record({ ...ALL_FIVE, price: 'gratis' }), columnsOf(), 7);
    expect(bad).toEqual({ ok: false, reject: { record: 7, code: 'invalid_price', field: 'price' } });
    const noId = validateRow(record({ ...ALL_FIVE, id: '' }), columnsOf(), 3);
    expect(noId.ok).toBe(false);
  });

  it('changes nothing else about the row: the same row with five blank entries differs only in `attributes`', () => {
    const blank = rowOf(record());
    const full = rowOf(record(ALL_FIVE));
    expect({ ...full, attributes: NO_ATTRIBUTES, unparsed: [] }).toEqual(blank);
  });
});

describe('a blank, an unreadable value and an absent column are three different things (AC 18; D-7)', () => {
  it('a blank cell (empty or whitespace) is absent and not listed as unparsed', () => {
    const row = rowOf(record({ viscosity: '', volume_l: '   ', acea: '\t', oil_type: ' ', approvals: ' ; , ' }));
    expect(row.attributes).toEqual(NO_ATTRIBUTES);
    expect(row.unparsed).toEqual([]);
  });

  it('a cell that does not read is absent and listed, in ATTRIBUTES order, with no raw value anywhere in the row', () => {
    const row = rowOf(record(ALL_FIVE_BAD));
    expect(row.attributes).toEqual(NO_ATTRIBUTES);
    expect(row.unparsed).toEqual(['viscosity', 'volume', 'acea', 'oilType', 'approvals']);
    const text = JSON.stringify(row);
    for (const raw of ['5W-35', '4 kg', 'E4', 'aceite sintético']) expect(text).not.toContain(raw);
  });

  it('lists only the unreadable ones, in ATTRIBUTES order, wherever their columns sit in the header', () => {
    const shuffled = ['id', 'title', 'price', 'url', 'approvals', 'oil_type', 'acea', 'volume_l', 'viscosity'];
    const index = columnsOf(shuffled);
    const cells = record({ viscosity: '10W-40', volume_l: 'mucho', acea: 'C2', oil_type: 'raro', approvals: 'a' }, shuffled);
    const row = rowOf(cells, index);
    expect(row.unparsed).toEqual(['volume', 'oilType']);
    expect(row.attributes).toMatchObject({ viscosity: '10W-40', volumeMl: null, acea: ['C2'], oilType: null, approvals: ['a'] });
  });

  it('a partial ACEA cell holds what it recognised and is not listed; an approvals cell that cleans to nothing is listed (D-24)', () => {
    expect(rowOf(record({ acea: 'A3/B4, E4' }))).toMatchObject({ attributes: { acea: ['A3/B4'] }, unparsed: [] });
    expect(rowOf(record({ approvals: 'x'.repeat(61) }))).toMatchObject({ attributes: { approvals: null }, unparsed: ['approvals'] });
    expect(rowOf(record({ approvals: `${'x'.repeat(61)}; ok` }))).toMatchObject({ attributes: { approvals: ['ok'] }, unparsed: [] });
  });
});

describe('a value is read from the entry only, and nothing else becomes an attribute (AC 4, 5)', () => {
  it('holds nothing for a row whose title and description name a grade, volume, norm, type and approval but whose entries are blank', () => {
    const row = rowOf(
      record({
        title: 'Aceite sintético 5W-30 ACEA C3 4 L',
        description: 'Viscosidad 10W-40, 5 litros, ACEA A3/B4, mineral, homologación VW 504 00',
      }),
    );
    expect(row.attributes).toEqual(NO_ATTRIBUTES);
    expect(row.unparsed).toEqual([]);
  });

  it('ignores a column that is not one of the five: it is never held, listed or a reason to reject', () => {
    const header = [...HEADER, 'gama', 'norma_api', 'tipo_de_envase', 'viscosity_grade'];
    const cells = record({ ...ALL_FIVE }, header);
    cells[header.indexOf('gama')] = 'Premium';
    cells[header.indexOf('norma_api')] = 'SN';
    cells[header.indexOf('viscosity_grade')] = '0W-20';
    const row = rowOf(cells, columnsOf(header));
    expect(row.attributes).toEqual(ALL_FIVE_HELD);
    expect(row.unparsed).toEqual([]);
    expect(Object.keys(row).sort()).toEqual(Object.keys(rowOf(record(ALL_FIVE))).sort());
  });
});

describe('the XML and the CSV carry the same entry, plain and gzip (AC 1)', () => {
  async function validRows(bytes: AsyncIterable<Uint8Array>): Promise<ValidRow[]> {
    const opened = await openRecords(bytes);
    try {
      const header = opened.header;
      if (header === null) throw new Error('no header');
      const index = readHeader(header);
      if (!index) throw new Error('header refused');
      const rows: ValidRow[] = [];
      for await (const { cells } of opened.records) rows.push(rowOf(cells, index));
      return rows;
    } finally {
      await opened.close();
    }
  }

  const FEED_ROW: FeedRow = {
    id: 'O-1',
    title: 'Aceite invented',
    price: '19.99',
    url: 'https://shop.example/p/o-1',
    brand: 'Marca',
    ean: '2000000000015',
    currency: 'EUR',
    ...ALL_FIVE,
  };

  it('reads the five columns of a CSV, plain and gzip, to the same row', async () => {
    const csv = csvOf([FEED_ROW]);
    const plain = await validRows(bytesOf(csv));
    const zipped = await validRows(bytesOf(gzipOf(csv)));
    expect(plain[0].attributes).toEqual(ALL_FIVE_HELD);
    expect(zipped).toEqual(plain);
  });

  it('reads the five elements of an XML record, plain and gzip, to the same row as the CSV', async () => {
    const csvRow = (await validRows(bytesOf(csvOf([FEED_ROW]))))[0];
    const xml = xmlOf([FEED_ROW]);
    const plain = await validRows(bytesOf(xml));
    const zipped = await validRows(bytesOf(gzipOf(xml)));
    expect(plain[0].attributes).toEqual(ALL_FIVE_HELD);
    expect(plain[0]).toEqual(csvRow);
    expect(zipped).toEqual(plain);
  });

  it('finds the elements with a prefix and in any letter case, and the first of a repeated child wins', async () => {
    const xml =
      '<r><p><id>1</id><title>T</title><price>1.00</price><url>https://a.example/1</url>' +
      '<g:viscosity>5w30</g:viscosity><g:VOLUME_L>1,5</g:VOLUME_L><Acea>C3</Acea><g:oil_type>Mineral</g:oil_type>' +
      '<approvals>a; b</approvals><approvals>c</approvals><viscosity>10W-40</viscosity></p></r>';
    const [row] = await validRows(bytesOf(xml));
    expect(row.attributes).toEqual({ viscosity: '5W-30', volumeMl: 1500, acea: ['C3'], oilType: 'mineral', approvals: ['a', 'b'] });
  });

  it('reads an empty element and an absent element alike, as a blank that is not listed as unparsed', async () => {
    const xml =
      '<r><p><id>1</id><title>T</title><price>1.00</price><url>https://a.example/1</url><viscosity></viscosity><acea/></p></r>';
    const [row] = await validRows(bytesOf(xml));
    expect(row.attributes).toEqual(NO_ATTRIBUTES);
    expect(row.unparsed).toEqual([]);
  });

  it('keeps markup characters of an approvals element as text, whether escaped or in CDATA', async () => {
    const xml =
      '<r><p><id>1</id><title>T</title><price>1.00</price><url>https://a.example/1</url>' +
      '<approvals>&lt;b&gt;VW&lt;/b&gt; 504 00</approvals></p>' +
      '<p><id>2</id><title>T</title><price>1.00</price><url>https://a.example/2</url>' +
      '<approvals><![CDATA[<b>VW</b> 504 00]]></approvals></p></r>';
    const rows = await validRows(bytesOf(xml));
    expect(rows.map((row) => row.attributes.approvals)).toEqual([['<b>VW</b> 504 00'], ['<b>VW</b> 504 00']]);
  });

  it('writes no attribute column from a generator when no row defines one, so an old caller\'s file is unchanged (AC 2)', () => {
    const old: FeedRow[] = [{ id: 'A-1', title: 'T', price: '1.00', url: 'https://a.example/1', fitment: 'a-1' }];
    expect(csvOf(old).split('\n')[0]).toBe('id,title,price,url,brand,ean,currency,fitment');
    expect(csvOf([{ id: 'A-1' }]).split('\n')[0]).toBe('id,title,price,url,brand,ean,currency');
    expect(xmlOf(old)).not.toMatch(/viscosity|volume_l|acea|oil_type|approvals/);
    expect(csvOf([{ id: 'A-1', acea: 'C2' }]).split('\n')[0]).toBe('id,title,price,url,brand,ean,currency,acea');
  });
});
