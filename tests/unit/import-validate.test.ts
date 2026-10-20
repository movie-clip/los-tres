import { describe, expect, it } from 'vitest';

import { readHeader, validateRow, type ColumnIndex } from '@/server/importer/validate';

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
];

function columns(): ColumnIndex {
  const found = readHeader(HEADER);
  if (!found) throw new Error('header fixture is invalid');
  return found;
}

/** A valid record; each test overrides the one cell it is about. */
function record(overrides: Partial<Record<(typeof HEADER)[number], string>> = {}): string[] {
  const base: Record<string, string> = {
    id: 'X-1',
    title: 'Titulo',
    brand: 'Marca',
    part_number: 'PN 1',
    ean: '2000000000015',
    price: '12.99',
    currency: 'EUR',
    url: 'https://shop.example/p/1',
    description: 'Descripcion',
    category: 'Recambios > Filtros',
    ...overrides,
  };
  return HEADER.map((name) => base[name]);
}

describe('readHeader (C-15)', () => {
  it('matches names trimmed and case-insensitively and ignores extra columns', () => {
    const found = readHeader([' ID ', 'Title', 'PRICE', 'Url', 'extra_column']);
    expect(found).toMatchObject({ id: 0, title: 1, price: 2, url: 3 });
  });

  it.each(['id', 'title', 'price', 'url'])('returns null when %s is missing', (missing) => {
    expect(readHeader(HEADER.filter((name) => name !== missing))).toBeNull();
  });

  it('returns null for an empty header', () => {
    expect(readHeader([])).toBeNull();
  });

  it('leaves absent optional columns undefined', () => {
    const found = readHeader(['id', 'title', 'price', 'url']);
    expect(found?.brand).toBeUndefined();
    expect(found?.ean).toBeUndefined();
  });
});

describe('validateRow reject codes (C-16)', () => {
  const reject = (cells: string[], at = 7) => {
    const result = validateRow(cells, columns(), at);
    if (result.ok) throw new Error('expected a reject');
    return result.reject;
  };

  it('accepts the valid base record', () => {
    expect(validateRow(record(), columns(), 2).ok).toBe(true);
  });

  it('missing_id: blank id, with the record number and field', () => {
    expect(reject(record({ id: '  ' }))).toEqual({ record: 7, code: 'missing_id', field: 'id' });
  });

  it('missing_title: blank title', () => {
    expect(reject(record({ title: '' }))).toEqual({
      record: 7,
      code: 'missing_title',
      field: 'title',
    });
  });

  it.each(['abc', '', '0', '1.005', '1.234,50', '-3', '1e3'])('invalid_price: %j', (price) => {
    expect(reject(record({ price }))).toEqual({ record: 7, code: 'invalid_price', field: 'price' });
  });

  it('invalid_currency: anything but EUR', () => {
    expect(reject(record({ currency: 'USD' }))).toEqual({
      record: 7,
      code: 'invalid_currency',
      field: 'currency',
    });
  });

  it('invalid_ean: present but not a valid GTIN', () => {
    expect(reject(record({ ean: '2000000000016' }))).toEqual({
      record: 7,
      code: 'invalid_ean',
      field: 'ean',
    });
  });

  it.each(['ftp://shop.example/x', 'javascript:alert(1)', 'not a url', '/relative/path', ''])(
    'invalid_url: %j',
    (url) => {
      expect(reject(record({ url }))).toEqual({ record: 7, code: 'invalid_url', field: 'url' });
    },
  );
});

describe('validateRow accepted rows (C-15, TD-42)', () => {
  const accept = (cells: string[], cols = columns()) => {
    const result = validateRow(cells, cols, 2);
    if (!result.ok) throw new Error(`expected a valid row, got ${result.reject.code}`);
    return result.row;
  };

  it('parses the price to integer cents', () => {
    expect(accept(record({ price: '19.99' })).priceCents).toBe(1999);
    expect(accept(record({ price: '0,29' })).priceCents).toBe(29);
  });

  it('turns empty optional cells into null, never an empty string', () => {
    const row = accept(record({ brand: ' ', part_number: '', ean: '', description: '  ' }));
    expect(row.brand).toBeNull();
    expect(row.partNumber).toBeNull();
    expect(row.ean).toBeNull();
    expect(row.eanNormalised).toBeNull();
    expect(row.description).toBeNull();
  });

  it('treats an absent currency as EUR and accepts eur in any case', () => {
    expect(validateRow(record({ currency: '' }), columns(), 2).ok).toBe(true);
    expect(validateRow(record({ currency: 'eur' }), columns(), 2).ok).toBe(true);
  });

  it('accepts a feed with only the four required columns', () => {
    const cols = readHeader(['id', 'title', 'price', 'url']);
    if (!cols) throw new Error('header');
    const row = accept(['A', 'T', '3.50', 'http://shop.example/a'], cols);
    expect(row).toMatchObject({ externalId: 'A', title: 'T', priceCents: 350, brand: null });
  });

  it('keeps the EAN as received (trimmed) and the digit string normalised', () => {
    const row = accept(record({ ean: ' 200-0000-000015 ' }));
    expect(row.ean).toBe('200-0000-000015');
    expect(row.eanNormalised).toBe('2000000000015');
  });

  it('trims id, title and url', () => {
    const row = accept(record({ id: ' X-9 ', title: ' T ', url: ' https://shop.example/p ' }));
    expect(row).toMatchObject({ externalId: 'X-9', title: 'T', url: 'https://shop.example/p' });
  });

  it('treats a short record as empty cells for the missing columns', () => {
    const result = validateRow(['X-1', 'T', '', '', '', '5.00', 'EUR', 'https://s.example/p'], columns(), 2);
    expect(result.ok).toBe(true);
  });
});

describe('the optional category column (S5.1, AC 3, AC 7)', () => {
  const rowOf = (cells: string[], index: ColumnIndex = columns()) => {
    const result = validateRow(cells, index, 2);
    if (!result.ok) throw new Error(`expected a valid row, got ${result.reject.code}`);
    return result.row;
  };

  it('reads the category cell as given, trimmed', () => {
    expect(rowOf(record({ category: '  Recambios > Filtros  ' })).feedCategory).toBe('Recambios > Filtros');
  });

  it('keeps the case and the inner spacing of the cell: the mapping match is exact', () => {
    expect(rowOf(record({ category: 'Filtros  de ACEITE' })).feedCategory).toBe('Filtros  de ACEITE');
  });

  it('reads an empty or blank cell as null, never an empty string', () => {
    expect(rowOf(record({ category: '' })).feedCategory).toBeNull();
    expect(rowOf(record({ category: '   ' })).feedCategory).toBeNull();
  });

  it('reads null when the feed has no category column at all, and the row is still valid', () => {
    const without = readHeader(['id', 'title', 'price', 'url']);
    if (!without) throw new Error('header fixture is invalid');
    expect(rowOf(['X-1', 'Titulo', '9.99', 'https://shop.example/p/1'], without).feedCategory).toBeNull();
  });

  it('never rejects a row for its category', () => {
    for (const category of ['', 'Categoría que no existe', 'x'.repeat(500)]) {
      expect(validateRow(record({ category }), columns(), 2).ok).toBe(true);
    }
  });

  it('finds the category column with a differently cased header', () => {
    expect(readHeader(['id', 'title', 'price', 'url', ' Category '])).toMatchObject({ category: 4 });
  });
});
