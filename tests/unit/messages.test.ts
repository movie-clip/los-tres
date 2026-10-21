import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import messages from '../../messages/es-ES.json';

// The code name, assembled so this file does not itself contain the literal.
const CODE_NAME = new RegExp(['los', 'tres'].join('[\\s_-]*'), 'i');

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

function collectStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === 'string') into.push(node);
  else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, into);
  }
  return into;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe('messages/es-ES.json (C-8)', () => {
  it.each([
    'Metadata.title',
    'Metadata.description',
    'Home.heading',
    'Home.tagline',
    'NotFound.heading',
    'NotFound.body',
    'NotFound.backHome',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it.each(['Metadata.title', 'Home.heading'])('%s takes the {siteName} placeholder', (key) => {
    expect(lookup(key)).toContain('{siteName}');
  });

  it('contains the code name in no message', () => {
    for (const text of collectStrings(messages)) {
      expect(text).not.toMatch(CODE_NAME);
    }
  });

  it('contains the code name in no file under src/', () => {
    const offenders = listFiles(path.resolve(process.cwd(), 'src')).filter((file) =>
      CODE_NAME.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});

describe('messages/es-ES.json Product namespace (C-14)', () => {
  it.each([
    'Product.metaTitle',
    'Product.metaDescription',
    'Product.brand',
    'Product.partNumber',
    'Product.ean',
    'Product.shopCount',
    'Product.offersHeading',
    'Product.vatIncluded',
    'Product.priceUpdatedOn',
    'Product.goToShop',
    'Product.imagePlaceholder',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('takes the placeholders C-14 fixes', () => {
    expect(lookup('Product.metaTitle')).toContain('{title}');
    expect(lookup('Product.metaTitle')).toContain('{siteName}');
    expect(lookup('Product.metaDescription')).toContain('{title}');
    expect(lookup('Product.priceUpdatedOn')).toContain('{date, date, medium}');
    expect(lookup('Product.goToShop')).toContain('{shopName}');
  });

  it('writes the shop count as an ICU plural with one and other branches', () => {
    const message = lookup('Product.shopCount') as string;
    expect(message).toMatch(/^\{count, plural,/);
    expect(message).toMatch(/one\s*\{[^}]*#[^}]*\}/);
    expect(message).toMatch(/other\s*\{[^}]*#[^}]*\}/);
  });

  it('puts no price and no mention of shipping in the copy', () => {
    const product = collectStrings((messages as Record<string, unknown>).Product).join(' | ');
    expect(product).not.toMatch(/\d+[.,]\d{2}\s*€/);
    expect(product).not.toMatch(/env[ií]o/i);
  });
});

describe('messages/es-ES.json Category namespace (S5.1)', () => {
  it.each([
    'Category.metaTitle',
    'Category.metaTitlePaged',
    'Category.metaDescription',
    'Category.summary',
    'Category.summaryPaged',
    'Category.paginationLabel',
    'Category.previousPage',
    'Category.nextPage',
    'Category.pageIndicator',
    'Category.priceFrom',
    'Category.emptyHeading',
    'Category.emptyBody',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('takes the placeholders the page passes', () => {
    expect(lookup('Category.metaTitle')).toContain('{category}');
    expect(lookup('Category.metaTitle')).toContain('{siteName}');
    expect(lookup('Category.metaTitlePaged')).toContain('{page}');
    expect(lookup('Category.metaDescription')).toContain('{category}');
    expect(lookup('Category.pageIndicator')).toContain('{page}');
    expect(lookup('Category.pageIndicator')).toContain('{pages}');
    expect(lookup('Category.summaryPaged')).toContain('{page}');
    expect(lookup('Category.summaryPaged')).toContain('{pages}');
  });

  it.each(['Category.summary', 'Category.summaryPaged'])(
    'writes %s as an ICU plural with one and other branches',
    (key) => {
      const message = lookup(key) as string;
      expect(message).toMatch(/^\{count, plural,/);
      expect(message).toMatch(/one\s*\{[^}]*#[^}]*\}/);
      expect(message).toMatch(/other\s*\{[^}]*#[^}]*\}/);
    },
  );

  it('puts no price and no mention of shipping in the copy', () => {
    const category = collectStrings((messages as Record<string, unknown>).Category).join(' | ');
    expect(category).not.toMatch(/\d+[.,]\d{2}\s*€/);
    expect(category).not.toMatch(/env[ií]o/i);
  });
});
