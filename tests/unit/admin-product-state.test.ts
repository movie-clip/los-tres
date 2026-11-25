import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProductState } from '@/components/admin/ProductState';

import messages from '../../messages/es-ES.json';

// US-2.5 (T-2.5.3b), ACs 4, 6 and 25: the state block of a product or an offer row. The reason is one more line,
// drawn only when the row reads No, as words in the markup (never an attribute) with the "Motivo:" label, directly
// after the two facts it explains; the hidden tag and "En el sitio ahora" keep saying what they said. A static
// render needs no DOM, so the one-line states are proved here and not in a browser (0006 rules 9 and 10).

const copy = messages.Admin.Products;
type Props = Parameters<typeof ProductState>[0];

const REASON = 'la tienda no está aprobada. Se aprueba en Tiendas y feeds.';

function state(props: Partial<Props> = {}): string {
  return renderToStaticMarkup(
    createElement(ProductState, {
      hidden: false,
      tagHidden: copy.tagHidden,
      tagNotHidden: copy.tagNotHidden,
      publicNow: false,
      publicLabel: copy.publicNowLabel,
      publicYes: copy.publicNowYes,
      publicNo: copy.publicNowNo,
      reasonLabel: copy.reasonLabel,
      reason: null,
      testIdPrefix: 'product',
      ...props,
    }),
  );
}

/** The element of a test id: the opening tag and its text, as far as the first closing div. */
const lineOf = (html: string, testId: string): string =>
  new RegExp(`<div[^>]*data-testid="${testId}">.*?</div>`).exec(html)?.[0] ?? '';
const textOf = (markup: string): string => markup.replace(/<[^>]*>/g, '');

describe('ProductState with a reason (AC 1 to 3, 6)', () => {
  it.each(['product-row', 'product', 'offer'])(
    '%s: the reason is a line of text, with its label, after the two facts, under its own test id',
    (prefix) => {
      const html = state({ testIdPrefix: prefix, reason: REASON });

      const line = lineOf(html, `${prefix}-reason`);
      expect(line).not.toBe('');
      expect(textOf(line)).toBe(`${copy.reasonLabel} ${REASON}`);
      // Order in the markup: the tag, the public fact, then the reason.
      const order = [`${prefix}-tag`, `${prefix}-public`, `${prefix}-reason`].map((id) => html.indexOf(`data-testid="${id}"`));
      expect(order.every((position) => position >= 0)).toBe(true);
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // Words, not an attribute: the sentence is outside every tag and carried by no title or aria attribute.
      expect(html.replace(/>[^<]*</g, '><')).not.toContain('tienda no está');
      expect(html).not.toMatch(/(?:title|aria-[a-z]+|alt)="[^"]*Motivo/);
    },
  );

  it('draws one reason line however long the sentence, and escapes it as text', () => {
    const html = state({ reason: 'dos frases. Y una <b>marca</b> & más.' });
    expect(html.match(/data-testid="product-reason"/g)).toHaveLength(1);
    expect(html).toContain('&lt;b&gt;marca&lt;/b&gt; &amp; más.');
    expect(html).not.toContain('<b>');
  });
});

describe('ProductState with no reason, a row that reads Yes (AC 4)', () => {
  it('draws no reason line and no label, and the rest of the markup is the markup it has with one', () => {
    const none = state({ publicNow: true });
    expect(none).not.toContain('-reason');
    expect(none).not.toContain(copy.reasonLabel);

    const withReason = state({ publicNow: true, reason: REASON });
    const stripped = withReason.replace(/<div[^>]*><div[^>]*data-testid="product-reason">.*?<\/div><\/div>/, '');
    expect(stripped).not.toBe(withReason);
    expect(none).toBe(stripped);
  });
});

describe('ProductState keeps the two facts as they were beside a reason (AC 25)', () => {
  const FLAGS = [
    { hidden: true, publicNow: false },
    { hidden: false, publicNow: false },
    { hidden: true, publicNow: true },
    { hidden: false, publicNow: true },
  ];

  it.each(FLAGS)('hidden $hidden, public now $publicNow: the tag and the public line are the same with and without the reason', (flags) => {
    const bare = state(flags);
    const reasoned = state({ ...flags, reason: REASON });
    for (const id of ['product-tag', 'product-public']) {
      expect(reasoned.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>.*?</(?:span|div)>`))?.[0], id).toBe(
        bare.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>.*?</(?:span|div)>`))?.[0],
      );
    }
    expect(textOf(lineOf(reasoned, 'product-public'))).toBe(`${copy.publicNowLabel} ${flags.publicNow ? copy.publicNowYes : copy.publicNowNo}`);
    expect(reasoned).toContain(`>${flags.hidden ? copy.tagHidden : copy.tagNotHidden}<`);
  });

  it('says Oculta beside a feed reason on an offer: the flag of the item is not the cause', () => {
    const html = state({
      testIdPrefix: 'offer',
      hidden: true,
      tagHidden: copy.tagOfferHidden,
      tagNotHidden: copy.tagOfferNotHidden,
      reason: messages.Admin.Products.reasonOfferFeed,
    });
    expect(html).toContain(`>${copy.tagOfferHidden}<`);
    expect(textOf(lineOf(html, 'offer-reason'))).toBe(`${copy.reasonLabel} ${copy.reasonOfferFeed}`);
  });
});
