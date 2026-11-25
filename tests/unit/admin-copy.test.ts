import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';

import { REASON_KEY, reasonLabels, type ProductsTranslate } from '@/components/admin/product-reason-labels';
import { NOT_PUBLIC_REASONS } from '@/server/visibility';

import messages from '../../messages/es-ES.json';

// AC 27, D-8: the admin screens hold no user-facing string of their own. Visible
// text comes from the Admin namespace of messages/es-ES.json. A text scan, so it
// needs neither a build nor a browser; the e2e checks the rendered copy.

const root = process.cwd();
const ADMIN_DIRS = ['src/app/admin', 'src/components/admin'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** The admin component and page files, with comments removed. */
function adminSources(): { file: string; code: string }[] {
  return ADMIN_DIRS.flatMap((dir) => walk(path.join(root, dir)))
    .filter((full) => /\.tsx$/.test(full))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      code: readFileSync(full, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/)
        .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
        .join('\n'),
    }));
}

const LETTERS = /[A-Za-zÁÉÍÓÚÜáéíóúüñÑ]{2,}/;

describe('the admin screens use no inline strings (AC 27)', () => {
  it('finds the admin files it scans, so the rules below are not vacuous', () => {
    const files = adminSources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/app/admin/acceso/page.tsx',
        'src/app/admin/acceso/SignInForm.tsx',
        'src/app/admin/(shell)/page.tsx',
        'src/components/admin/AdminHeader.tsx',
      ]),
    );
  });

  it('has no words between JSX tags', () => {
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(/<\/?[A-Za-z][\w.]*(?:\s[^<>]*)?>([^<>{}]+)</g)]
        .map((match) => match[1].trim())
        // Type arguments such as Promise<Record<...>> are not JSX.
        .filter((text) => LETTERS.test(text) && !/[;=)(]|=>|\bextends\b/.test(text))
        .map((text) => `${file}: ${text}`),
    );
    expect(found).toEqual([]);
  });

  it('has no literal text in the attributes a screen reader or browser shows', () => {
    const attribute = /\b(aria-label|aria-description|title|alt|placeholder|label|heading|body|message|text)=("([^"{}]*)"|'([^'{}]*)')/g;
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(attribute)]
        .filter((match) => LETTERS.test(match[3] ?? match[4] ?? ''))
        .map((match) => `${file}: ${match[0]}`),
    );
    expect(found).toEqual([]);
  });

  it('has no quoted Spanish sentence or accented word outside a message call', () => {
    const found = adminSources().flatMap(({ file, code }) =>
      [...code.matchAll(/(["'`])([^"'`\n]*[áéíóúñÁÉÍÓÚÑ¿¡][^"'`\n]*)\1/g)].map((match) => `${file}: ${match[2]}`),
    );
    expect(found).toEqual([]);
  });

  it('reads every visible string through next-intl, never from a local constant table', () => {
    const found = adminSources()
      .filter(({ file }) => /\/page\.tsx$|layout\.tsx$/.test(file))
      .filter(({ code }) => /return\s*\(?\s*</.test(code) && !/getTranslations/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe('the page language (AC 27)', () => {
  it('declares Spanish on the root element every admin page shares', () => {
    const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).toMatch(/<html[^>]*\blang=/);
    const request = readFileSync(path.join(root, 'src/i18n/request.ts'), 'utf8');
    expect(request).toMatch(/es-ES/);
  });

  it('renders no public header or footer on an admin page (the root layout is bare)', () => {
    const layout = readFileSync(path.join(root, 'src/app/layout.tsx'), 'utf8');
    expect(layout).not.toMatch(/SiteHeader|SiteFooter|PublicChrome/);
    for (const { file, code } of adminSources()) {
      expect(code, file).not.toMatch(/SiteHeader|SiteFooter|PublicChrome/);
    }
  });
});

// S3.1, AC 40 and 39 (D-6): no text on the page says or implies that approving a registered
// feed makes its offers appear. S3.1 alone does not publish a real feed (the importer reads
// canonical columns only, S3.5; since S4.2 an admin also maps categories on /admin/categorias,
// but a mapping gives a category and nothing else, see the Admin.Categories describe below), so
// a line that promised it would be false. The scan covers the whole Admin.Sources block, which
// is where the S2.3 result lines live, and Admin.Form, where the S3.1 forms add copy.

function leaves(node: unknown, prefix = ''): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([key, value]) => leaves(value, prefix ? `${prefix}.${key}` : key));
  }
  return [];
}

/** A phrase that says offers are, or will be, shown: "se muestran", "aparecen", "ya están en el sitio", "visibles". */
const SHOWS_OFFERS =
  /\b(?:se\s+muestra(?:n)?|se\s+mostrar[aá]n?|aparece(?:n)?|aparecer[aá]n?|se\s+ve(?:n)?|se\s+ver[aá]n?|ya\s+est[aá]n?\s+en\s+el\s+sitio|visibles?|publicad[oa]s?|se\s+publica(?:n)?)\b/i;
/** The same phrases in a negative or lapsing sentence ("ya no se muestran", "dejarán de mostrarse"), which are true. */
const NEGATED =
  /\b(?:no|nunca|ya\s+no)\s+(?:se\s+)?(?:muestra(?:n)?|mostrar[aá]n?|aparece(?:n)?|ve(?:n)?)\b|\bdejar[aá]n?\s+de\s+(?:mostrarse|aparecer|verse)\b/gi;
/** A condition: the sentence says when an offer is shown, not that approval shows it. */
const CONDITIONAL = /\b(?:solo|únicamente|si|aunque|sin)\b/i;

/** Sentences of `text` that claim, or imply, that offers appear and are not negated or conditional. */
function offerPromises(text: string): string[] {
  return text
    .split(/(?<=[.:;!?])\s+/)
    .map((sentence) => sentence.replace(NEGATED, ''))
    .filter((sentence) => SHOWS_OFFERS.test(sentence) && !CONDITIONAL.test(sentence));
}

describe('no copy promises that approval publishes offers (AC 40, D-6)', () => {
  const block = [...leaves(messages.Admin.Sources, 'Sources'), ...leaves(messages.Admin.Form, 'Form')];

  it('scans the whole Admin.Sources and Admin.Form blocks, so the rule is not vacuous', () => {
    expect(block.length).toBeGreaterThan(80);
    expect(block.map(([key]) => key)).toEqual(
      expect.arrayContaining(['Sources.doneFeedApproved', 'Sources.intro', 'Sources.noticeFeedCreated', 'Form.Feed.warningBody']),
    );
  });

  it('finds no sentence that says approval shows offers, in any key', () => {
    const found = block.flatMap(([key, value]) => offerPromises(value).map((sentence) => `${key}: ${sentence}`));
    expect(found).toEqual([]);
  });

  it('is shown to fail on the line the S2.3 page used to say, and on other promises', () => {
    for (const promise of [
      'Feed aprobado: sus ofertas ya se muestran.',
      'Feed aprobado. Sus ofertas aparecen en el sitio.',
      'Al aprobarlo, las ofertas serán visibles.',
      'Tienda aprobada: ya están en el sitio.',
    ]) {
      expect(offerPromises(promise), promise).not.toEqual([]);
    }
  });

  it('lets the true lines through: negated, lapsing and conditional ones', () => {
    for (const fine of [
      'Tienda desactivada: sus ofertas ya no se muestran.',
      'Sus ofertas dejarán de mostrarse en el sitio al instante.',
      'Una oferta solo se muestra en el sitio si su tienda y su feed están aprobados.',
      'La tienda no está aprobada: sus ofertas no se muestran en el sitio, aunque tenga feeds aprobados.',
    ]) {
      expect(offerPromises(fine), fine).toEqual([]);
    }
  });

  it('says what the S2.3 approval line now says, and keeps the intro sentence that a new feed starts unapproved', () => {
    const copy = messages.Admin.Sources;
    expect(copy.doneFeedApproved).toBe('Feed aprobado. Las próximas importaciones lo tendrán en cuenta.');
    expect(copy.doneFeedApproved).not.toMatch(/oferta/i);
    expect(copy.intro).toContain('Un feed nuevo empieza sin aprobar');
    expect(copy.doneFeedApprovedPaused).not.toMatch(/ofertas ya se muestran/);
  });

  it('keeps the S3.1 notices free of any value: no name, slug or address placeholder', () => {
    for (const key of [
      'noticeNetworkCreated',
      'noticeNetworkSaved',
      'noticeShopCreated',
      'noticeShopSaved',
      'noticeFeedCreated',
      'noticeFeedSaved',
      'noticeFeedUnapproved',
    ] as const) {
      expect(messages.Admin.Sources[key], key).not.toMatch(/[{}]|https?:/);
    }
  });
});

// S4.2, AC 47 and 46: no text on the category screen says or implies that mapping a category, or
// approving a feed, makes products appear. The only sentence about visibility is a necessary
// condition ("únicamente si ... aprobados, no está oculto y tiene categoría"), and the removal and
// "not approved" lines are negative, so the same scan as for Sources applies to every Admin.Categories key.
describe('no copy on the category screen promises that a mapping publishes (AC 47)', () => {
  const block = leaves(messages.Admin.Categories, 'Categories');

  it('scans the whole Admin.Categories block and its page title, so the rule is not vacuous', () => {
    expect(block.length).toBeGreaterThan(40);
    expect(block.map(([key]) => key)).toEqual(
      expect.arrayContaining(['Categories.rulePublic', 'Categories.ruleRemove', 'Categories.doneMapped', 'Categories.confirmBody']),
    );
  });

  it('finds no sentence that says a mapping or an approval shows products, in any key', () => {
    const found = [...block, ['Meta.categoriesTitle', messages.Admin.Meta.categoriesTitle] as [string, string]].flatMap(([key, value]) =>
      offerPromises(value).map((sentence) => `${key}: ${sentence}`),
    );
    expect(found).toEqual([]);
  });

  it('is shown to fail on promises about mapping and about approving a feed', () => {
    for (const promise of [
      'Guardado: los productos de esta categoría ya se muestran en el sitio.',
      'Al asignar la categoría, los productos aparecen en la tienda.',
      'Con la categoría asignada, los productos serán visibles.',
      'Feed aprobado: sus productos se publican.',
    ]) {
      expect(offerPromises(promise), promise).not.toEqual([]);
    }
  });

  it('keeps the one true statement about visibility: it needs the feed and shop approved, not hidden and a category', () => {
    const copy = messages.Admin.Categories;
    expect(copy.rulePublic).toContain('no aprueba ningún feed ni ninguna tienda');
    expect(copy.rulePublic).toContain('únicamente si su feed y su tienda están aprobados, no está oculto y tiene categoría');
    expect(copy.ruleRemove).toContain('dejan de mostrarse en el sitio al instante');
  });

  it('says in no key that a saved mapping is public, and the result lines state only what changed', () => {
    const results = ['doneMapped', 'doneOutside', 'doneRemoved', 'doneUnchanged', 'productsMoved', 'productsCleared'] as const;
    for (const key of results) {
      expect(messages.Admin.Categories[key], key).not.toMatch(/p[úu]blic|visible|aparec/i);
    }
    // "no se muestra en el sitio" appears only after a clearing, which is true and negative.
    expect(messages.Admin.Categories.productsCleared).toContain('no se muestra');
  });

  it('keeps the notice that a not-approved feed shows nothing, true wherever it is said', () => {
    expect(messages.Admin.Categories.feedNoteNotApproved).toContain('no se muestran en el sitio aunque tengan categoría');
  });
});

// S2.4, AC 59, 58, 61 and 63: no text on the product screens says or implies that unhiding, or
// anything else the admin does there, makes a product or an offer appear. Unhiding gives back the
// chance to be shown; whether the site shows it now is a separate fact, "En el sitio ahora", read
// from the server. The same scan as for Sources and Categories covers every Admin.Products key and
// the two product tab titles.
describe('no copy on the product screens promises that unhiding publishes (AC 59)', () => {
  const block = leaves(messages.Admin.Products, 'Products');
  const titles: [string, string][] = [
    ['Meta.productsTitle', messages.Admin.Meta.productsTitle],
    ['Meta.productTitle', messages.Admin.Meta.productTitle],
  ];

  it('scans the whole Admin.Products block and the two tab titles, so the rule is not vacuous', () => {
    expect(block.length).toBeGreaterThan(55);
    expect(block.map(([key]) => key)).toEqual(
      expect.arrayContaining([
        'Products.intro',
        'Products.publicNowLabel',
        'Products.emptyPastLast',
        'Products.Detail.unhideProduct',
        'Products.Detail.doneProductUnhidden',
        'Products.Detail.doneOfferUnhidden',
        'Products.Detail.offersIntro',
      ]),
    );
    expect(titles.map(([, value]) => value).join(' ')).toContain('{title}');
  });

  it('finds no sentence that says an unhide or a hide shows anything, in any key', () => {
    const found = [...block, ...titles].flatMap(([key, value]) =>
      offerPromises(value).map((sentence) => `${key}: ${sentence}`),
    );
    expect(found).toEqual([]);
  });

  it('is shown to fail on the promises an unhide line could make', () => {
    for (const promise of [
      'Guardado: el producto ahora aparece en el sitio.',
      'Al dejar de ocultarlo, el producto se muestra.',
      'Guardado: la oferta ya es visible.',
      'Producto publicado: los visitantes lo verán.',
      'Guardado: el producto ya está en el sitio.',
    ]) {
      expect(offerPromises(promise), promise).not.toEqual([]);
    }
  });

  it('lets the true lines through: the hide, the definition of "en el sitio ahora" and the empty lists', () => {
    for (const fine of [
      'Ocultar un producto o una oferta lo quita del sitio al instante.',
      'Aquí están todos los productos, se muestren o no en el sitio.',
      'No hay ningún producto oculto. Cuando ocultes uno, lo verás aquí.',
      'Guardado: el producto ya no está oculto.',
    ]) {
      expect(offerPromises(fine), fine).toEqual([]);
    }
  });

  it('says in no unhide line that anything appears or is visible, and states only what was saved', () => {
    const unhide = [
      messages.Admin.Products.Detail.unhideProduct,
      messages.Admin.Products.Detail.unhideOffer,
      messages.Admin.Products.Detail.unhideOfferName,
      messages.Admin.Products.Detail.doneProductUnhidden,
      messages.Admin.Products.Detail.doneOfferUnhidden,
    ];
    for (const line of unhide) expect(line).not.toMatch(/p[úu]blic|visible|aparec|muestr|ver[aá]n?\b/i);
    expect(messages.Admin.Products.Detail.doneProductUnhidden).toBe('Guardado: el producto ya no está oculto.');
    expect(messages.Admin.Products.Detail.doneOfferUnhidden).toBe('Guardado: la oferta ya no está oculta.');
  });

  it('names the two facts with different words: the hide is "oculto", the site now is "En el sitio ahora"', () => {
    const copy = messages.Admin.Products;
    expect(copy.publicNowLabel).toBe('En el sitio ahora:');
    expect(copy.tagHidden).toBe('Oculto');
    expect(copy.tagNotHidden).toBe('No oculto');
    expect(copy.tagOfferHidden).toBe('Oculta');
    expect(copy.tagOfferNotHidden).toBe('No oculta');
    // "Visible" and "público" never appear on these screens (the second fact is always "En el sitio ahora").
    expect(block.filter(([, value]) => /\bvisibles?\b|\bp[úu]blic[oa]s?\b/i.test(value))).toEqual([]);
  });

  it('keeps the button names to "Ocultar" and "Dejar de ocultar" (AC 63)', () => {
    const detail = messages.Admin.Products.Detail;
    for (const name of [detail.hideProduct, detail.hideOffer, detail.hideOfferName]) expect(name).toMatch(/^Ocultar\b/);
    for (const name of [detail.unhideProduct, detail.unhideOffer, detail.unhideOfferName]) {
      expect(name).toMatch(/^Dejar de ocultar\b/);
    }
    expect(block.filter(([, value]) => /\b(mostrar|publicar|aprobar|eliminar|borrar)\b/i.test(value))).toEqual([]);
  });

  it('puts no id, slug, term or shop in a result or an error line (AC 61)', () => {
    const detail = messages.Admin.Products.Detail;
    for (const line of [
      detail.doneProductHidden,
      detail.doneProductUnhidden,
      detail.doneOfferHidden,
      detail.doneOfferUnhidden,
      detail.errorTitle,
      detail.errorProductBody,
      detail.errorOfferBody,
      detail.goneProductBody,
      detail.goneOfferBody,
    ]) {
      expect(line).not.toMatch(/[{}]/);
    }
  });
});

// US-2.5 (T-2.5.3b), ACs 8, 30 to 33 and 5: the 17 reason lines of Admin.Products. Each code has its own line
// (one key per code, no key left over), the lines pass the S2.4 pins that scan the whole block (the "promises"
// describe above reads them because they are keys of Admin.Products), and a line never holds a value, an address
// or a promise. The wording is the owner's; these tests pin its rules, not its sentences.
describe('the not-public reason lines of the product screens (US-2.5, AC 30 to 33)', () => {
  const copy = messages.Admin.Products as Record<string, unknown>;
  const reasonKeys = Object.keys(copy).filter((key) => /^reason[A-Z]/.test(key) && key !== 'reasonLabel');
  const lineOf = (code: (typeof NOT_PUBLIC_REASONS)[number]): string => copy[REASON_KEY[code]] as string;
  const lines = NOT_PUBLIC_REASONS.map((code) => [code, lineOf(code)] as const);
  const translator = createTranslator({
    locale: 'es-ES',
    messages,
    namespace: 'Admin.Products',
  } as never) as unknown as ProductsTranslate;

  it('gives every code its own line: one key per code, all different, and no reason key without a code (AC 30)', () => {
    expect(Object.keys(REASON_KEY).sort()).toEqual([...NOT_PUBLIC_REASONS].sort());
    const keys = NOT_PUBLIC_REASONS.map((code) => REASON_KEY[code]);
    expect(new Set(keys).size).toBe(NOT_PUBLIC_REASONS.length);
    expect([...keys].sort()).toEqual([...reasonKeys].sort());
    for (const [code, line] of lines) {
      expect(typeof line, code).toBe('string');
      expect(line.trim(), code).not.toBe('');
    }
    expect(new Set(lines.map(([, line]) => line)).size).toBe(NOT_PUBLIC_REASONS.length);
    expect(messages.Admin.Products.reasonLabel).toMatch(/:$/);
  });

  it('builds the finished text of every code through the real translator, as the two pages do (AC 30)', () => {
    const built = reasonLabels(translator);
    expect(Object.keys(built).sort()).toEqual([...NOT_PUBLIC_REASONS].sort());
    for (const [code, line] of lines) expect(built[code], code).toBe(line);
  });

  it('is scanned by the existing Admin.Products pins: the block holds every reason key (AC 31)', () => {
    const block = leaves(messages.Admin.Products, 'Products').map(([key]) => key);
    for (const key of [...reasonKeys, 'reasonLabel']) expect(block, key).toContain(`Products.${key}`);
    expect(reasonKeys).toHaveLength(NOT_PUBLIC_REASONS.length);
    for (const [code, line] of lines) {
      expect(offerPromises(line), code).toEqual([]);
      expect(line, code).not.toMatch(/\bvisibles?\b|\bp[úu]blic[oa]s?\b/i);
      expect(line, code).not.toMatch(/\b(mostrar|publicar|aprobar|eliminar|borrar)\b/i);
    }
  });

  it('lets the "only on the local site" lines through only because they are conditional (non-vacuity of AC 31)', () => {
    const conditional = lines.filter(([, line]) => SHOWS_OFFERS.test(line));
    expect(conditional.map(([code]) => code).sort()).toEqual(['offer_collected', 'offers_collected', 'product_collected']);
    for (const [code, line] of conditional) {
      expect(offerPromises(line), code).toEqual([]);
      expect(offerPromises(line.replace(/\bSolo\b/g, 'Se muestra y')), code).not.toEqual([]);
    }
  });

  it('says no step makes the item appear: no future or promise verb on any line (AC 32)', () => {
    for (const [code, line] of lines) {
      expect(line, code).not.toMatch(/\b(aparec\w*|publicar\w*|mostrar\w*|ver[aá]n?|quedar\w*|volver\w*|saldr\w*|ser[aá]n? visible\w*)\b/i);
    }
  });

  it('holds no placeholder, number, address, file name, table or column: the cause is a name, the text fixed (AC 33)', () => {
    for (const [code, line] of lines) {
      expect(line, code).not.toMatch(/[{}]/);
      expect(line, code).not.toMatch(/\d/);
      expect(line, code).not.toMatch(/[/\\]/);
      expect(line, code).not.toMatch(/https?:|www\.|\.(?:csv|xml|gz)\b/i);
      expect(line, code).not.toMatch(/\b(?:offers|products|feeds|shops)\.\w+|\b\w+_(?:id|at)\b|is_\w+|\bisHidden\b|\binReview\b|\bisRemoved\b/);
    }
  });

  it('follows the label "Motivo:": lower case at the start, whole sentences, and says where the cause is changed (AC 8, D-7)', () => {
    for (const [code, line] of lines) {
      expect(line[0], code).toBe(line[0].toLowerCase());
      expect(line, code).toMatch(/[.»]$/);
    }
    const nav = messages.Admin.Nav;
    const detail = messages.Admin.Products.Detail;
    expect(lineOf('offer_shop_not_approved')).toContain(nav.feeds);
    expect(lineOf('offer_feed_not_approved')).toContain(nav.feeds);
    expect(lineOf('offers_shop_not_approved')).toContain(nav.feeds);
    expect(lineOf('offers_feed_not_approved')).toContain(nav.feeds);
    expect(lineOf('product_no_category')).toContain(nav.categories);
    // A hidden item says which of the two existing buttons undoes it.
    expect(lineOf('offer_hidden')).toContain(detail.unhideOffer);
    expect(lineOf('offers_hidden')).toContain(detail.unhideOffer);
    expect(lineOf('product_hidden')).toContain(detail.unhideProduct);
    // The general line names both places the admin can look, so it never reads as a dead end.
    expect(lineOf('unknown')).toContain(nav.feeds);
    expect(lineOf('unknown')).toContain(nav.categories);
  });
});
