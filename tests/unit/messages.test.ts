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
    'Home.categoriesHeading',
    'Home.productCount',
    'Home.emptyHeading',
    'Home.emptyBody',
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

  it('writes Home.productCount as an ICU plural with one and other branches', () => {
    const message = lookup('Home.productCount') as string;
    expect(message).toMatch(/^\{count, plural,/);
    expect(message).toMatch(/one\s*\{[^}]*#[^}]*\}/);
    expect(message).toMatch(/other\s*\{[^}]*#[^}]*\}/);
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

describe('legal pages messages (S9.3)', () => {
  const keysOf = (namespace: string): string[] =>
    Object.keys((messages as Record<string, Record<string, string>>)[namespace] ?? {});

  it.each([
    ['Footer', ['legalNotice', 'privacy', 'funding']],
    ['DemoNotice', ['body']],
    [
      'LegalNotice',
      [
        'metaTitle', 'heading', 'intro', 'holder', 'nif', 'address', 'email', 'registry',
        'objectHeading', 'objectBody', 'pricesHeading', 'pricesBody', 'demoHeading', 'demoBody',
        'ipHeading', 'ipBody', 'linksHeading', 'linksBody', 'lawHeading', 'lawBody',
      ],
    ],
    [
      'Privacy',
      [
        'metaTitle', 'heading', 'controllerHeading', 'controllerBody', 'cookiesHeading',
        'cookiesBody', 'dataHeading', 'dataClicks', 'dataStats', 'dataLogs', 'dataBasis',
        'leavingHeading', 'leavingBody', 'writingHeading', 'writingBody', 'adminsHeading',
        'adminsBody', 'recipientsHeading', 'recipientsBody', 'rightsHeading', 'rightsBody',
        'changesHeading', 'changesBody',
      ],
    ],
    ['Funding', ['metaTitle', 'heading', 'intro', 'noExtraCost', 'noSales', 'noPaidRanking']],
  ])('%s has exactly the contract keys, each a non-empty string', (namespace, keys) => {
    expect(keysOf(namespace).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      const value = lookup(`${namespace}.${key}`);
      expect(typeof value).toBe('string');
      expect((value as string).trim().length).toBeGreaterThan(0);
    }
  });

  it('labels the footer links as the contract says', () => {
    expect(lookup('Footer.legalNotice')).toBe('Aviso legal');
    expect(lookup('Footer.privacy')).toBe('Privacidad');
    expect(lookup('Footer.funding')).toBe('Cómo nos financiamos');
  });

  it.each(['LegalNotice', 'Privacy', 'Funding'])('%s.metaTitle takes {siteName}', (namespace) => {
    expect(lookup(`${namespace}.metaTitle`)).toContain('{siteName}');
  });

  it('takes the owner placeholders where the owner text needs them', () => {
    expect(lookup('LegalNotice.holder')).toContain('{ownerName}');
    expect(lookup('LegalNotice.nif')).toContain('{ownerNif}');
    expect(lookup('LegalNotice.address')).toContain('{ownerAddress}');
    expect(lookup('LegalNotice.email')).toContain('<email>{contactEmail}</email>');
    expect(lookup('LegalNotice.registry')).toContain('{ownerRegistry}');
    const controller = lookup('Privacy.controllerBody') as string;
    for (const placeholder of ['{ownerName}', '{ownerNif}', '{ownerAddress}']) {
      expect(controller).toContain(placeholder);
    }
    expect(controller).toContain('<email>{contactEmail}</email>');
    expect(lookup('Privacy.rightsBody')).toContain('<email>{contactEmail}</email>');
    expect(lookup('Privacy.rightsBody')).toContain('<aepd>www.aepd.es</aepd>');
  });

  it('names {ownerRegistry} in LegalNotice.registry only', () => {
    const offenders = Object.entries(messages as Record<string, Record<string, string>>).flatMap(
      ([namespace, entries]) =>
        Object.entries(entries)
          .filter(([key, value]) => value.includes('{ownerRegistry}') && `${namespace}.${key}` !== 'LegalNotice.registry')
          .map(([key]) => `${namespace}.${key}`),
    );
    expect(offenders).toEqual([]);
  });

  it('keeps bold as <b> tags and never leaves a ** marker in any message', () => {
    expect(collectStrings(messages).filter((value) => value.includes('**'))).toEqual([]);
    for (const key of ['Privacy.dataClicks', 'Privacy.dataStats', 'Privacy.dataLogs', 'Funding.noExtraCost', 'Funding.noSales', 'Funding.noPaidRanking']) {
      expect(lookup(key)).toMatch(/^<b>[^<]+<\/b>/);
    }
  });

  it('uses only the tags b, email and aepd in the legal namespaces', () => {
    const legal = ['LegalNotice', 'Privacy', 'Funding', 'Footer', 'DemoNotice'].flatMap((namespace) =>
      collectStrings((messages as Record<string, unknown>)[namespace]),
    );
    const tags = new Set(legal.flatMap((value) => [...value.matchAll(/<\/?([a-z]+)>/g)].map((m) => m[1])));
    expect([...tags].sort()).toEqual(['aepd', 'b', 'email']);
  });
});
