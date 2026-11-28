import { readFileSync } from 'node:fs';
import path from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator } from 'use-intl/core';
import { describe, expect, it } from 'vitest';

import {
  APPROVALS_VISIBLE,
  ProductAttributes,
  type ProductAttributeRow,
  type ProductAttributesProps,
} from '@/components/ProductAttributes';
import { OIL_TYPES } from '@/server/category-attributes';

import messages from '../../messages/es-ES.json';

// S15.3 (US-15.3) ACs 36 to 38 and 40 on the rendered card, in each state of 06-ux § States. The component
// takes finished display strings and draws them (the page decides which rows exist, and the reader decides
// the category); this renders it with `renderToStaticMarkup`, the way product-components.test.ts does. The
// copy is read from messages/es-ES.json, never retyped. No database, no browser. Values are invented.

const t = createTranslator({ locale: 'es-ES', messages, namespace: 'Product' });
const label = (key: 'viscosity' | 'volume' | 'acea' | 'oilType' | 'approvals') => t(`attributeLabel.${key}`);

const items = (n: number, prefix = 'Homologación demo') => Array.from({ length: n }, (_, index) => `${prefix} ${index + 1}`);

function approvals(list: string[]): ProductAttributeRow {
  const hidden = list.length - APPROVALS_VISIBLE;
  return {
    key: 'approvals',
    kind: 'list',
    label: label('approvals'),
    items: list,
    moreLabel: hidden > 0 ? t('approvalsMore', { count: hidden }) : null,
    fewerLabel: t('approvalsFewer'),
  };
}

const VISCOSITY: ProductAttributeRow = { key: 'viscosity', kind: 'value', label: label('viscosity'), value: '10W-40' };
const VOLUME: ProductAttributeRow = { key: 'volume', kind: 'value', label: label('volume'), value: '1,5 l' };
const ACEA: ProductAttributeRow = { key: 'acea', kind: 'tokens', label: label('acea'), tokens: ['A3/B4', 'C2'] };
const OIL_TYPE: ProductAttributeRow = { key: 'oilType', kind: 'value', label: label('oilType'), value: t('oilType.semi-synthetic') };

function card(rows: ProductAttributeRow[], props: Partial<ProductAttributesProps> = {}): string {
  return renderToStaticMarkup(createElement(ProductAttributes, { heading: t('attributesHeading'), rows, ...props }));
}

/** The text of every element the card draws as a row term, in order. */
const terms = (html: string) => [...html.matchAll(/<dt\b[^>]*>(.*?)<\/dt>/g)].map((match) => match[1]);
/** The tags' text with the markup removed. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, '');
const countOf = (html: string, pattern: RegExp) => html.match(pattern)?.length ?? 0;

describe('ProductAttributes: all five present (AC 36, 38)', () => {
  const html = card([VISCOSITY, VOLUME, ACEA, OIL_TYPE, approvals(['VW 504 00', 'VW 507 00', 'MB-Freigabe 229.51'])]);

  it('draws one section with its heading, and a description list of five rows in the spec order', () => {
    expect(countOf(html, /data-testid="product-attributes"/g)).toBe(1);
    expect(html).toMatch(/<h2\b[^>]*>Características<\/h2>/);
    expect(countOf(html, /<dl\b/g)).toBe(1);
    expect(countOf(html, /data-testid="product-attribute"/g)).toBe(5);
    expect(terms(html)).toEqual(['Viscosidad SAE', 'Volumen', 'Norma ACEA', 'Tipo de aceite', 'Homologaciones']);
  });

  it('draws each value as held: 10W-40, 1,5 l, A3/B4, C2 and the Spanish word of the oil family', () => {
    const text = textOf(html);
    expect(text).toContain('10W-40');
    expect(text).toContain('1,5 l');
    expect(text).toContain('A3/B4, C2');
    expect(text).toContain('Semisintético');
    for (const item of ['VW 504 00', 'VW 507 00', 'MB-Freigabe 229.51']) expect(text).toContain(item);
  });

  it('takes every label from the message file: the copy is the file\'s, in this order', () => {
    expect(terms(html)).toEqual([
      messages.Product.attributeLabel.viscosity,
      messages.Product.attributeLabel.volume,
      messages.Product.attributeLabel.acea,
      messages.Product.attributeLabel.oilType,
      messages.Product.attributeLabel.approvals,
    ]);
    expect(html).toContain(`>${messages.Product.attributesHeading}</h2>`);
  });

  it('draws the approvals as a list of plain items inside the row, with no control for three items', () => {
    expect(countOf(html, /<li\b/g)).toBe(3);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('product-attributes-more');
  });

  it('ships no script, no inline style and no raw-markup escape hatch', () => {
    expect(html).not.toMatch(/<script|style=|dangerouslySetInnerHTML/);
  });
});

describe('ProductAttributes: some present, the rest absent (AC 37)', () => {
  it('draws only the rows it is given, in the order given, with no dash, placeholder or empty value', () => {
    const html = card([VISCOSITY, approvals(['VW 504 00'])]);
    expect(terms(html)).toEqual(['Viscosidad SAE', 'Homologaciones']);
    expect(countOf(html, /data-testid="product-attribute"/g)).toBe(2);
    const text = textOf(html);
    for (const absent of ['Volumen', 'Norma ACEA', 'Tipo de aceite']) expect(text).not.toContain(absent);
    expect(text).not.toMatch(/—|–|sin datos|N\/A/i);
    expect(html).not.toMatch(/<dd\b[^>]*><\/dd>/);
  });

  it.each<[string, ProductAttributeRow]>([
    ['viscosity', VISCOSITY],
    ['volume', VOLUME],
    ['acea', ACEA],
    ['oil type', OIL_TYPE],
    ['approvals', approvals(['VW 504 00'])],
  ])('a product holding only %s draws exactly that one row', (_name, row) => {
    const html = card([row]);
    expect(countOf(html, /data-testid="product-attribute"/g)).toBe(1);
    expect(terms(html)).toEqual([row.label]);
  });
});

describe('ProductAttributes: ACEA tokens (AC 38, 06-ux States)', () => {
  const TWELVE = ['A1/B1', 'A3/B3', 'A3/B4', 'A5/B5', 'A7/B7', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7'];
  const html = card([{ key: 'acea', kind: 'tokens', label: label('acea'), tokens: TWELVE }]);

  it('joins the tokens with a comma and one space, in the order given', () => {
    expect(textOf(html)).toContain(TWELVE.join(', '));
  });

  it('puts each token in its own unbreakable span with its comma, so a line never ends inside one', () => {
    const spans = [...html.matchAll(/<span class="[^"]*_nowrap_[^"]*">([^<]*)<\/span>/g)].map((match) => match[1]);
    expect(spans).toEqual(TWELVE.map((token, index) => (index < TWELVE.length - 1 ? `${token},` : token)));
  });

  it('draws one token with no comma and no stray space', () => {
    const one = card([{ key: 'acea', kind: 'tokens', label: label('acea'), tokens: ['C5'] }]);
    expect(textOf(one)).toContain('C5');
    expect(textOf(one)).not.toContain('C5,');
    expect(one).toMatch(/_nowrap_[^"]*">C5<\/span><\/span><\/dd>/);
  });
});

describe('ProductAttributes: the approvals list and its control (AC 36; 06-ux States)', () => {
  it.each([1, 7, 8])('%i approvals: all drawn, no control', (n) => {
    const html = card([approvals(items(n))]);
    expect(countOf(html, /<li\b/g)).toBe(n);
    expect(html).not.toContain('<details');
  });

  it('exactly 8 approvals draw no control even when a stray label is offered with them', () => {
    const row = { ...approvals(items(8)), moreLabel: 'Mostrar 0 más' } as ProductAttributeRow;
    expect(card([row])).not.toContain('<details');
  });

  it('9 approvals: 8 in the first list and one behind a closed native details', () => {
    const html = card([approvals(items(9))]);
    expect(countOf(html, /<li\b/g)).toBe(9);
    expect(countOf(html, /<ul\b/g)).toBe(2);
    expect(countOf(html, /<details\b/g)).toBe(1);
    expect(html).not.toMatch(/<details[^>]*\bopen\b/);
    expect(html).toContain('data-testid="product-attributes-more"');
    expect(html).toContain('data-testid="product-attributes-toggle"');
    const [shown, rest] = html.split('<details');
    expect(countOf(shown, /<li\b/g)).toBe(8);
    expect(countOf(rest, /<li\b/g)).toBe(1);
    expect(shown).toContain('Homologación demo 8');
    expect(shown).not.toContain('Homologación demo 9');
    expect(rest).toContain('Homologación demo 9');
    expect(rest).toContain('>Mostrar 1 más</span>');
  });

  it('20 approvals: 8 drawn, 12 behind the control, and the control names the number behind it, with both labels in the summary', () => {
    const html = card([approvals(items(20))]);
    const [shown, rest] = html.split('<details');
    expect(countOf(shown, /<li\b/g)).toBe(8);
    expect(countOf(rest, /<li\b/g)).toBe(12);
    expect(rest).toContain(`>${t('approvalsMore', { count: 12 })}</span>`);
    expect(rest).toContain('>Mostrar 12 más</span>');
    expect(rest).toContain(`>${messages.Product.approvalsFewer}</span>`);
    expect(rest).toContain('>Mostrar menos</span>');
    expect(rest).toMatch(/<summary\b[^>]*data-testid="product-attributes-toggle"/);
  });

  it('keeps the control in the first HTML as a native details, with no script to open it', () => {
    const html = card([approvals(items(12))]);
    expect(html).toMatch(/<details\b[^>]*><summary\b/);
    expect(html).not.toMatch(/<script|onclick| hidden=/i);
  });

  it('uses no control when the page gives no label, whatever the length', () => {
    const row = { ...approvals(items(12)), moreLabel: null } as ProductAttributeRow;
    const html = card([row]);
    expect(countOf(html, /<li\b/g)).toBe(12);
    expect(html).not.toContain('<details');
  });
});

describe('ProductAttributes: values are text, never markup (AC 38)', () => {
  const HOSTILE = '<b>VW</b> 504 00';

  it('shows an approvals item holding markup characters as the literal characters', () => {
    const html = card([approvals([HOSTILE, 'A & B'])]);
    expect(html).not.toContain('<b>');
    expect(html).not.toContain('</b>');
    expect(html).toContain('&lt;b&gt;VW&lt;/b&gt; 504 00');
    expect(html).toContain('A &amp; B');
    // The browser's reading of the text is the written characters.
    const text = textOf(html).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    expect(text).toContain(HOSTILE);
  });

  it('does the same for an item that sits behind the control', () => {
    const html = card([approvals([...items(8), '<script>x()</script>'])]);
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;x()&lt;/script&gt;');
  });

  it('does the same for a label, a heading and a single value', () => {
    const html = card([{ key: 'viscosity', kind: 'value', label: '<i>L</i>', value: '<u>V</u>' }], { heading: '<h1>H</h1>' });
    expect(html).not.toMatch(/<i>|<u>|<h1>/);
    expect(html).toContain('&lt;i&gt;L&lt;/i&gt;');
    expect(html).toContain('&lt;u&gt;V&lt;/u&gt;');
    expect(html).toContain('&lt;h1&gt;H&lt;/h1&gt;');
  });
});

describe('ProductAttributes: the stacking hook (06-ux Screens)', () => {
  it('marks the approvals row as the one that stacks below 40rem, and no other row', () => {
    const html = card([VISCOSITY, approvals(['VW 504 00'])]);
    expect(countOf(html, /_stacks_/g)).toBe(1);
    expect(html.indexOf('_stacks_')).toBeGreaterThan(html.indexOf('Viscosidad SAE'));
  });
});

describe('the card\'s copy comes from the message file (AC 36)', () => {
  it('holds a label for each of the five, a heading, the control labels and a word for every stored oil family', () => {
    for (const key of ['viscosity', 'volume', 'acea', 'oilType', 'approvals'] as const) {
      expect(messages.Product.attributeLabel[key]).toBeTruthy();
    }
    expect(messages.Product.attributesHeading).toBe('Características');
    expect(messages.Product.approvalsMore).toBe('Mostrar {count} más');
    expect(messages.Product.approvalsFewer).toBe('Mostrar menos');
    // Keyed by the stored family value: the page asks for `oilType.<stored value>`.
    expect(Object.keys(messages.Product.oilType).sort()).toEqual([...OIL_TYPES].sort());
    expect(OIL_TYPES.map((family) => t(`oilType.${family}`))).toEqual(['Sintético', 'Semisintético', 'Mineral']);
  });

  it('writes no Spanish label or word inline in the component source', () => {
    const source = readFileSync(path.resolve(import.meta.dirname, '../../src/components/ProductAttributes.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const word of ['Características', 'Viscosidad', 'Volumen', 'Homologaciones', 'Sintético', 'Semisintético', 'Mineral', 'Mostrar']) {
      expect(source).not.toContain(word);
    }
  });
});
