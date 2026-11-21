import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { createTranslator } from 'use-intl/core';
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

/** Every string leaf as [dotted key, text], whatever the nesting. */
function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
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
    'Home.searchLabel',
    'Home.searchButton',
    'Home.searchHint',
    'Home.allLink',
    'Home.productCount',
    'Home.emptyHeading',
    'Home.emptyBody',
    'NotFound.heading',
    'NotFound.body',
    'NotFound.backHome',
    'NotFound.metaTitle',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('Metadata.title takes the {siteName} placeholder', () => {
    expect(lookup('Metadata.title')).toContain('{siteName}');
  });

  it('Home.heading is the promise and takes no placeholder', () => {
    expect(lookup('Home.heading')).not.toContain('{siteName}');
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
    'Product.breadcrumbLabel',
    'Product.partNumber',
    'Product.ean',
    'Product.shopCount',
    'Product.offersHeading',
    'Product.vatIncluded',
    'Product.bestPrice',
    'Product.descriptionHeading',
    'Product.priceUpdatedOn',
    'Product.goToShopShort',
    'Product.goToShop',
    'Product.imagePlaceholder',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('words the S11.5 product copy and no longer has a brand label', () => {
    expect(lookup('Product.breadcrumbLabel')).toBe('Ruta de navegación');
    expect(lookup('Product.bestPrice')).toBe('Mejor precio');
    expect(lookup('Product.goToShopShort')).toBe('Ir a la tienda');
    expect(lookup('Product.descriptionHeading')).toBe('Descripción');
    expect(lookup('Product.priceUpdatedOn')).toBe('Actualizado el {date, date, medium}');
    expect(lookup('Product.brand')).toBeUndefined();
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

  it.each(['Category.brandChipLabel', 'Category.brandChipSelectedLabel'])(
    'writes %s with an ICU plural on the count',
    (key) => {
      const message = lookup(key) as string;
      expect(message).toMatch(/\{count, plural,/);
      expect(message).toMatch(/one\s*\{[^}]*#[^}]*\}/);
      expect(message).toMatch(/other\s*\{[^}]*#[^}]*\}/);
    },
  );

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
    'Category.brandGroupLabel',
    'Category.brandAll',
    'Category.brandChipLabel',
    'Category.brandChipSelectedLabel',
    'Category.brandMore',
    'Category.sortLabel',
    'Category.sortSubmit',
    'Category.sortPriceAsc',
    'Category.sortPriceDesc',
    'Category.sortName',
    'Category.specRef',
    'Category.noMatchHeading',
    'Category.noMatchBody',
    'Category.noMatchAction',
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
    expect(lookup('Category.brandChipLabel')).toContain('{brand}');
    expect(lookup('Category.brandChipSelectedLabel')).toContain('{brand}');
    expect(lookup('Category.brandMore')).toContain('{count}');
    expect(lookup('Category.specRef')).toContain('{partNumber}');
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

describe('messages/es-ES.json Search and Error namespaces (S5.4)', () => {
  it.each([
    'Search.metaTitle',
    'Search.metaTitleTerm',
    'Search.metaTitleTermPaged',
    'Search.heading',
    'Search.formLabel',
    'Search.fieldLabel',
    'Search.hint',
    'Search.button',
    'Search.summary',
    'Search.summaryPaged',
    'Search.promptHeading',
    'Search.promptBody',
    'Search.noResultsHeading',
    'Search.noResultsBody',
    'Search.browseAction',
    'Search.summaryCarPrefix',
    'Search.allOutHeading',
    'Search.allOutBody',
    'Error.heading',
    'Error.body',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it('has no Search key the list above does not know', () => {
    expect(Object.keys((messages as Record<string, unknown>).Search as object).sort()).toEqual(
      [
        'metaTitle',
        'metaTitleTerm',
        'metaTitleTermPaged',
        'heading',
        'formLabel',
        'fieldLabel',
        'hint',
        'button',
        'headerPlaceholder',
        'summary',
        'summaryPaged',
        'promptHeading',
        'promptBody',
        'noResultsHeading',
        'noResultsBody',
        'browseAction',
        'summaryCarPrefix',
        'allOutHeading',
        'allOutBody',
      ].sort(),
    );
  });

  it('takes the placeholders the page passes', () => {
    expect(lookup('Search.metaTitle')).toContain('{siteName}');
    expect(lookup('Search.metaTitleTerm')).toContain('{term}');
    expect(lookup('Search.metaTitleTerm')).toContain('{siteName}');
    expect(lookup('Search.metaTitleTermPaged')).toContain('{term}');
    expect(lookup('Search.metaTitleTermPaged')).toContain('{page}');
    expect(lookup('Search.metaTitleTermPaged')).toContain('{siteName}');
    expect(lookup('Search.summary')).toContain('{term}');
    expect(lookup('Search.summaryPaged')).toContain('{term}');
    expect(lookup('Search.summaryPaged')).toContain('{page}');
    expect(lookup('Search.summaryPaged')).toContain('{pages}');
    expect(lookup('Search.noResultsBody')).toContain('{term}');
  });

  it.each(['Search.summary', 'Search.summaryPaged'])(
    'writes %s as an ICU plural with one and other branches',
    (key) => {
      const message = lookup(key) as string;
      expect(message).toMatch(/^\{count, plural,/);
      expect(message).toMatch(/one\s*\{[^}]*#[^}]*\}/);
      expect(message).toMatch(/other\s*\{[^}]*#[^}]*\}/);
    },
  );

  it('renders the summary with the term in guillemets and the right plural', () => {
    const t = createTranslator({ locale: 'es-ES', messages, namespace: 'Search' });
    expect(t('summary', { count: 1, term: 'filtro' })).toBe('1 producto para «filtro»');
    expect(t('summary', { count: 5, term: 'filtro' })).toBe('5 productos para «filtro»');
  });

  it('the prompt and the hint name no placeholder', () => {
    for (const key of ['Search.promptHeading', 'Search.promptBody', 'Search.hint', 'Error.heading', 'Error.body']) {
      expect(lookup(key), key).not.toMatch(/\{/);
    }
  });

  it('Home.searchNotice is gone', () => {
    expect((messages.Home as Record<string, unknown>).searchNotice).toBeUndefined();
  });
});

describe('legal pages messages (S9.3)', () => {
  const keysOf = (namespace: string): string[] =>
    Object.keys((messages as unknown as Record<string, Record<string, string>>)[namespace] ?? {});

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
        'cookiesBody', 'dataHeading', 'dataClicks', 'dataLogs', 'dataSearch', 'dataBasis',
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
    // Walks nested namespaces (Admin) too, so a leaf anywhere is checked.
    const offenders = leaves(messages)
      .filter(([key, value]) => value.includes('{ownerRegistry}') && key !== 'LegalNotice.registry')
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });

  it('keeps bold as <b> tags and never leaves a ** marker in any message', () => {
    expect(collectStrings(messages).filter((value) => value.includes('**'))).toEqual([]);
    for (const key of ['Privacy.dataClicks', 'Privacy.dataLogs', 'Privacy.dataSearch', 'Funding.noExtraCost', 'Funding.noSales', 'Funding.noPaidRanking']) {
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

describe('messages/es-ES.json Admin namespace (US-2.1, D-8)', () => {
  const admin = (messages as unknown as Record<string, Record<string, Record<string, string>>>).Admin;

  // The keys the admin screens read (05-ux.md section Copy). Containment, not
  // equality: later admin stories add keys to the same namespace.
  const REQUIRED: Record<string, string[]> = {
    Meta: ['title', 'signInTitle', 'homeTitle'],
    Chrome: ['areaLabel', 'signedInAs', 'identityFallback', 'signOut', 'signingOut', 'navLabel'],
    Nav: ['home', 'feeds', 'categories', 'products', 'review', 'comingSoon'],
    SignIn: [
      'heading', 'emailLabel', 'passwordLabel', 'submit', 'submitting', 'signInRequired', 'signedOut',
      'emailRequired', 'emailInvalid', 'passwordRequired', 'errorTitle', 'invalidCredentials', 'unavailable',
    ],
    Home: ['heading', 'emptyBody'],
    NotFound: ['heading', 'body', 'backHome'],
    Unavailable: ['heading', 'body', 'retry'],
  };

  it('is its own top-level section, apart from the public namespaces', () => {
    expect(typeof admin).toBe('object');
    expect(Object.keys(messages)).toContain('Admin');
    for (const [namespace, keys] of Object.entries(REQUIRED)) {
      expect(Object.keys(admin)).toContain(namespace);
      expect(Object.keys(admin[namespace])).toEqual(expect.arrayContaining(keys));
    }
  });

  it('keeps every admin string under Admin and none among the public namespaces', () => {
    const publicKeys = leaves(Object.fromEntries(Object.entries(messages).filter(([name]) => name !== 'Admin'))).map(
      ([key]) => key,
    );
    expect(publicKeys.filter((key) => /sign.?in|sign.?out|log.?in|password/i.test(key))).toEqual([]);
  });

  it('has a non-empty string at every Admin key', () => {
    const all = leaves(admin);
    expect(all.length).toBeGreaterThan(20);
    for (const [key, value] of all) {
      expect(value.trim().length, `Admin.${key}`).toBeGreaterThan(0);
    }
  });

  it('takes {siteName} in the three page titles', () => {
    for (const key of ['title', 'signInTitle', 'homeTitle']) {
      expect(admin.Meta[key]).toContain('{siteName}');
    }
  });

  it('has the admin not-found tab title, which takes {siteName} (6B)', () => {
    expect(admin.Meta.notFoundTitle).toBe('Página no encontrada | Administración | {siteName}');
  });

  it('names the Búsquedas item in the third data lead-in of the privacy page (6A)', () => {
    const lead = (key: string) => String(lookup(key)).match(/^<b>([^<]+)<\/b>/)?.[1];
    expect([lead('Privacy.dataClicks'), lead('Privacy.dataLogs'), lead('Privacy.dataSearch')]).toEqual([
      'Clics hacia las tiendas.',
      'Registros del servidor.',
      'Búsquedas.',
    ]);
  });

  it('keeps the S4.2 screen copy in Admin.Categories, its title in Admin.Meta and the Nav keys as they were (AC 46)', () => {
    expect(admin.Meta.categoriesTitle).toContain('{siteName}');
    expect(Object.keys(admin.Categories)).toEqual(
      expect.arrayContaining([
        'heading', 'intro', 'rulePublic', 'ruleRemove', 'summary', 'feedsEmpty', 'feedHeading', 'emptyCellNote',
        'tagPending', 'tagMapped', 'tagOutside', 'selectLabel', 'assign', 'change', 'markOutside', 'removeMapped',
        'removeOutside', 'confirmBody', 'doneMapped', 'doneOutside', 'doneRemoved', 'doneUnchanged', 'productsMoved',
        'productsCleared', 'errorTargetRequired', 'errorTargetInvalid', 'refusedGone',
      ]),
    );
    expect(admin.Nav.categories).toBe('Categorías');
  });

  it('pluralises the session lifetime for 1 and 8 hours', () => {
    const t = createTranslator({
      locale: 'es-ES',
      messages,
      namespace: 'Admin.SignIn',
      onError: (error) => {
        throw error;
      },
    });
    expect(t('signInRequired', { hours: 8 })).toContain('8 horas');
    expect(t('signInRequired', { hours: 1 })).toContain('1 hora.');
    expect(t('signInRequired', { hours: 1 })).not.toContain('horas');
  });

  it('writes the sign-in screen text the UX spec fixes', () => {
    expect(admin.SignIn.heading).toBe('Acceso de administración');
    expect(admin.SignIn.errorTitle).toBe('No se ha podido iniciar sesión');
    expect(admin.SignIn.signedOut).toBe('Has cerrado sesión.');
    expect(admin.Chrome.signOut).toBe('Cerrar sesión');
  });

  it('uses no ICU placeholder the pages do not pass', () => {
    // Admin.Sources (US-2.3) passes the counts, the shop name and the feed id and network its page formats.
    // S3.1 adds `count` (Sources.networksCount) and `max` (the three Form.Errors length messages).
    // S4.2 (Admin.Categories) adds the counts and their grouped text (`pending`, `pendingText`, `total`,
    // `totalText`, `countText`: four digits keep their separator, so the page passes the text too), the
    // target category's name (`target`), the feed category string (`category`) and the feed's heading (`feed`).
    // S3.7 adds `kinds` (the accepted file endings of Form.Feed.fileHint* and Form.Errors.fileWrongKind).
    const allowed = new Set([
      'siteName', 'hours', 'shops', 'feeds', 'shop', 'id', 'network', 'offers', 'offersText', 'count', 'max',
      'pending', 'pendingText', 'total', 'totalText', 'countText', 'target', 'category', 'feed', 'kinds',
    ]);
    for (const [key, value] of leaves(admin)) {
      for (const match of value.matchAll(/\{([A-Za-z]+)[,}]/g)) {
        expect(allowed.has(match[1]), `Admin.${key} names {${match[1]}}`).toBe(true);
      }
    }
  });

  it('puts no recovery, sign-up or remember-me wording in any admin copy but Sources and Form (AC 1)', () => {
    // Sources and Form legitimately say "registrar" (a feed is registered); every other Admin leaf
    // (SignIn, Chrome, Meta, Nav, Home, NotFound, Categories, ...) is scanned, so a new namespace is covered by default.
    expect(signInWordingOffenders(admin)).toEqual([]);
    // The scan reads the sign-in screen itself, so it cannot go vacuous.
    expect(leaves(admin).filter(([key]) => key.startsWith('SignIn.')).length).toBeGreaterThan(5);
  });

  it('proves the wording scan: it flags an offender in any other namespace and skips Sources and Form', () => {
    const tree = {
      SignIn: { heading: 'Acceso', hint: 'Si lo has olvidado, restablece la clave' },
      Chrome: { signOut: 'Cerrar sesión', remember: 'Recuérdame en este equipo' },
      Home: { cta: 'Registrar una cuenta' },
      Sources: { add: 'Registrar un feed' },
      Form: { Feed: { title: 'Registrar feed' } },
    };
    expect(signInWordingOffenders(tree)).toEqual(['SignIn.hint', 'Chrome.remember', 'Home.cta']);
    expect(signInWordingOffenders({ Sources: tree.Sources, Form: tree.Form })).toEqual([]);
  });

  // S4.2: Admin.Categories.feedsEmpty says "Registra uno en Tiendas y feeds": it sends the admin to
  // register a feed, the same sense as Admin.Sources, and has nothing to do with sign-up. The exemption is
  // that one key and not the whole namespace (50 other keys stay scanned), and it holds only while the
  // sentence is about a feed.
  it('exempts only the feed-registration sentence of Admin.Categories, and keeps the rest of that namespace scanned', () => {
    expect(FEED_REGISTRATION_KEYS).toEqual(['Categories.feedsEmpty']);
    expect(admin.Categories.feedsEmpty).toMatch(/\bRegistra uno en Tiendas y feeds\b/);
    expect(leaves(admin).filter(([key]) => key.startsWith('Categories.')).length).toBeGreaterThan(40);

    const tree = {
      Categories: {
        feedsEmpty: 'Todavía no hay feeds. Registra uno en Tiendas y feeds.',
        heading: 'Categorías de los feeds',
        hint: 'Registra tu cuenta para guardar los cambios',
      },
    };
    expect(signInWordingOffenders(tree)).toEqual(['Categories.hint']);
    // A feed-registration sentence under another key is not exempt.
    expect(signInWordingOffenders({ Categories: { intro: 'Registra uno en Tiendas y feeds.' } })).toEqual(['Categories.intro']);
  });
});

/** The keys whose "registr..." is about registering a feed, the sense Sources and Form already carry. */
const FEED_REGISTRATION_KEYS = ['Categories.feedsEmpty'];

/** The keys of every leaf outside Sources and Form whose text offers recovery, sign-up or remember-me. */
function signInWordingOffenders(adminTree: Record<string, unknown>): string[] {
  const scanned = Object.fromEntries(Object.entries(adminTree).filter(([name]) => name !== 'Sources' && name !== 'Form'));
  return leaves(scanned)
    .filter(([key]) => !FEED_REGISTRATION_KEYS.includes(key))
    .filter(([, value]) => /olvid|registr|recuérd|recuerd|restablec/i.test(value))
    .map(([key]) => key);
}
