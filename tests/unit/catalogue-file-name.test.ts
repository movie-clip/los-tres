import { describe, expect, it } from 'vitest';

import {
  CATALOGUE_FILE_KINDS,
  CATALOGUE_FILE_NAME_MAX,
  checkCatalogueFileName,
  displayableFileName,
  isCatalogueFileName,
} from '@/server/catalogue-file-name';

// S3.7, C-2: the one rule for a catalogue file's name, shared by the admin
// writers and the importer. Every name here is invented.

const errorOf = (raw: string) => checkCatalogueFileName(raw).error;

describe('checkCatalogueFileName', () => {
  it('exports the limits the form copy is built from', () => {
    expect(CATALOGUE_FILE_NAME_MAX).toBe(100);
    expect(CATALOGUE_FILE_KINDS).toEqual(['.csv', '.xml', '.csv.gz', '.xml.gz']);
  });

  it.each([
    'mi-catalogo.csv',
    'catalogo_2026.XML',
    'a.csv',
    'filtros.v2.csv.gz',
    'ACEITES.Xml.Gz',
    '0.xml',
    'a-b_c.d.csv',
  ])('accepts %j', (name) => {
    expect(checkCatalogueFileName(name)).toEqual({ value: name, error: null });
  });

  it('trims the name and returns the trimmed value', () => {
    expect(checkCatalogueFileName('  mi-catalogo.csv\t\n')).toEqual({
      value: 'mi-catalogo.csv',
      error: null,
    });
  });

  it.each(['', '   ', '\t\n'])('refuses %j as required', (raw) => {
    expect(checkCatalogueFileName(raw)).toEqual({ value: '', error: 'required' });
  });

  it('refuses more than 100 characters as too_long and accepts exactly 100', () => {
    const exact = `${'a'.repeat(96)}.csv`;
    expect(exact).toHaveLength(100);
    expect(errorOf(exact)).toBeNull();
    expect(errorOf(`a${exact}`)).toBe('too_long');
  });

  it('counts code points, not UTF-16 units, for the length', () => {
    // 100 astral characters are 200 UTF-16 units: too_long only past 100 code points.
    expect(errorOf('\u{1F600}'.repeat(100))).not.toBe('too_long');
    expect(errorOf('\u{1F600}'.repeat(101))).toBe('too_long');
  });

  it.each([
    '/etc/hosts',
    '/x.csv',
    'sub/x.csv',
    'sub\\x.csv',
    '\\\\server\\share\\x.csv',
    'C:\\x.csv',
    'C:x.csv',
    'x.csv:stream',
    'https://shop.example/x.csv',
    'file:///x.csv',
    '..',
    '../x.csv',
    '..\\x.csv',
    'a..b.csv',
    'x..csv',
    '.hidden.csv',
    '.csv',
    '.gitkeep',
    'CON.csv',
    'con',
    'PRN.xml',
    'Aux.csv.gz',
    'nul.csv',
    'COM1.csv',
    'com9.xml',
    'LPT1.csv',
    'lpt9.csv',
  ])('refuses %j as not_a_name', (raw) => {
    expect(errorOf(raw)).toBe('not_a_name');
  });

  it('accepts a device name only as a part of a longer stem', () => {
    expect(errorOf('console.csv')).toBeNull();
    expect(errorOf('com10.csv')).toBeNull();
    expect(errorOf('lpt0.csv')).toBeNull();
  });

  it.each([
    'mi catalogo.csv',
    'catálogo.csv',
    'ñandú.csv',
    'x\u0000.csv',
    'x\u0007.csv',
    'x\u200b.csv',
    'x\u00a0y.csv',
    'x,y.csv',
    'x*.csv',
    'x?.csv',
    'x"y.csv',
    'x<y>.csv',
    'x|y.csv',
    'x%2e.csv',
    'x~1.csv',
    'x@y.csv',
  ])('refuses %j as unusable', (raw) => {
    expect(errorOf(raw)).toBe('unusable');
  });

  it.each(['x', 'x.txt', 'x.csv.txt', 'x.gz', 'x.csv.zip', 'x.xls', 'x.csvx', 'csv', 'x.tar.gz'])(
    'refuses %j as wrong_kind',
    (raw) => {
      expect(errorOf(raw)).toBe('wrong_kind');
    },
  );

  it('reports the first error in the form order: required, too_long, not_a_name, unusable, wrong_kind', () => {
    // Too long and also a path: the length comes first.
    expect(errorOf(`/${'a'.repeat(120)}`)).toBe('too_long');
    // A path with a space and a wrong kind: not_a_name outranks unusable and wrong_kind.
    expect(errorOf('a b/c.txt')).toBe('not_a_name');
    // A space and a wrong kind: unusable outranks wrong_kind.
    expect(errorOf('a b.txt')).toBe('unusable');
  });

  it('has exactly the five errors of the form order, and no duplicate error', () => {
    const seen: string[] = [];
    for (const raw of ['', 'a'.repeat(101), '../x', 'x y.csv', 'x.txt']) {
      const { error } = checkCatalogueFileName(raw);
      if (error) seen.push(error);
    }
    expect(seen).toEqual(['required', 'too_long', 'not_a_name', 'unusable', 'wrong_kind']);
  });
});

describe('isCatalogueFileName', () => {
  it('is true only for a stored value that is exactly an accepted name', () => {
    expect(isCatalogueFileName('mi-catalogo.csv')).toBe(true);
    expect(isCatalogueFileName('MI.XML.GZ')).toBe(true);
  });

  it('does not trim: a padded stored value is not a name', () => {
    expect(isCatalogueFileName(' mi-catalogo.csv')).toBe(false);
    expect(isCatalogueFileName('mi-catalogo.csv ')).toBe(false);
    expect(isCatalogueFileName('mi-catalogo.csv\n')).toBe(false);
  });

  it.each([
    '',
    'https://shop.example/f.csv',
    'demo-feed:tienda-demo-uno.csv',
    '../x.csv',
    '/etc/hosts',
    'C:\\x.csv',
    'x.txt',
    'catálogo.csv',
    '.gitkeep',
  ])('is false for %j', (stored) => {
    expect(isCatalogueFileName(stored)).toBe(false);
  });
});

describe('displayableFileName', () => {
  it('returns the stored value when it is a name and null otherwise', () => {
    expect(displayableFileName('mi-catalogo.csv')).toBe('mi-catalogo.csv');
    expect(displayableFileName(' mi-catalogo.csv')).toBeNull();
    expect(displayableFileName('https://shop.example/f.csv?key=secret')).toBeNull();
    expect(displayableFileName('../x.csv')).toBeNull();
  });
});
