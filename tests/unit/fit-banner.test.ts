import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FitBanner } from '@/components/FitBanner';

import messages from '../../messages/es-ES.json';

// S5.9 T5.9.1: the banner takes finished strings. These cover the branches the demo cannot reach (the
// could-not-check kind) and the rules the page relies on: one note, the kind in `data-fit`, the words as
// real text, the glyph decorative and absent for `unchecked`, the help and the link only when given.

type Props = Parameters<typeof FitBanner>[0];

function banner(props: Partial<Props> & Pick<Props, 'kind' | 'text'>): string {
  return renderToStaticMarkup(createElement(FitBanner, { help: null, link: null, ...props }));
}

const KINDS = ['fits', 'no-fit', 'unknown', 'unchecked'] as const;

describe('FitBanner', () => {
  for (const kind of KINDS) {
    it(`${kind}: one note carrying the kind and the words as text`, () => {
      const html = banner({ kind, text: `Texto de ${kind}` });
      expect(html.match(/role="note"/g)).toHaveLength(1);
      expect(html).toContain('data-testid="fit-banner"');
      expect(html).toContain(`data-fit="${kind}"`);
      expect(html).toContain(`>Texto de ${kind}<`);
      expect(html).not.toContain('<a ');
      expect(html).not.toContain('<p');
    });
  }

  it('draws a decorative glyph for fits, no-fit and unknown, and none for unchecked', () => {
    for (const kind of ['fits', 'no-fit', 'unknown'] as const) {
      expect(banner({ kind, text: 'x' }), kind).toMatch(/<span[^>]*aria-hidden="true"[^>]*><\/span>/);
    }
    expect(banner({ kind: 'unchecked', text: 'x' })).not.toContain('aria-hidden');
  });

  it('renders the help line only when given', () => {
    const html = banner({ kind: 'unknown', text: 'Sin datos', help: 'Compruébalo antes de comprar.' });
    expect(html).toMatch(/<p[^>]*>Compruébalo antes de comprar\.<\/p>/);
    expect(banner({ kind: 'unknown', text: 'Sin datos' })).not.toContain('<p');
  });

  it('renders the link as a plain anchor with exactly the href it is given, and only when given', () => {
    const html = banner({
      kind: 'no-fit',
      text: 'No es compatible',
      link: { href: '/categoria/filtros-de-aceite?coche=un-coche', label: 'Ver productos compatibles' },
    });
    expect(html).toContain('data-testid="fit-banner-link"');
    expect(html).toContain('href="/categoria/filtros-de-aceite?coche=un-coche"');
    expect(html).toContain('>Ver productos compatibles</a>');
    expect(html).not.toMatch(/\b(rel|target)=/);
    expect(banner({ kind: 'no-fit', text: 'x' })).not.toContain('<a ');
  });

  it('escapes the text it is given', () => {
    const html = banner({ kind: 'fits', text: '<img src=x onerror=alert(1)>' });
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
  });

  it('keeps the could-not-check message neutral: it says neither fits nor does not fit', () => {
    const text = messages.ProductFit.bannerUnchecked;
    expect(text).not.toMatch(/\bcompatible\b/i);
    expect(banner({ kind: 'unchecked', text })).toContain(text);
  });

  it('the four banner messages differ from one another and name the car where they should', () => {
    const { bannerFits, bannerNoFit, bannerUnknown, bannerUnchecked } = messages.ProductFit;
    expect(new Set([bannerFits, bannerNoFit, bannerUnknown, bannerUnchecked]).size).toBe(4);
    expect(bannerFits).toContain('{car}');
    expect(bannerNoFit).toContain('{car}');
    expect(bannerUnknown).not.toMatch(/\bcompatible con tu\b/i);
  });
});
