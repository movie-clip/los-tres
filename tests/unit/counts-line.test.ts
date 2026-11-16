import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CountsLine, type CountsLineProps } from '../../src/components/CountsLine';
import { groupCopy } from '../../src/components/listing-group-copy';
import { createTranslator } from 'use-intl/core';

import messages from '../../messages/es-ES.json';

// S5.8 follow-ups (D-14, D-17): the counts line wraps between parts, and the group copy is one shared helper.

const render = (props: CountsLineProps) => renderToStaticMarkup(createElement(CountsLine, props));
const text = (html: string) => html.replace(/<[^>]*>/g, '');
const spans = (html: string) => [...html.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)].map((match) => match[1]);

describe('CountsLine', () => {
  it('renders one span per part, with " · " between parts', () => {
    const html = render({ parts: ['10 compatibles', '23 sin datos', '17 ocultos'] });
    expect(spans(html)).toEqual(['10 compatibles', '23 sin datos', '17 ocultos']);
    expect(text(html)).toBe('10 compatibles · 23 sin datos · 17 ocultos');
  });

  it('renders a single part with no separator', () => {
    const html = render({ parts: ['10 compatibles'] });
    expect(spans(html)).toEqual(['10 compatibles']);
    expect(text(html)).toBe('10 compatibles');
    expect(html).not.toContain('·');
  });

  it('never starts or ends with a separator', () => {
    const plain = text(render({ parts: ['a', 'b'] }));
    expect(plain.startsWith(' · ')).toBe(false);
    expect(plain.startsWith('·')).toBe(false);
    expect(plain.endsWith('·')).toBe(false);
    expect(plain.endsWith(' · ')).toBe(false);
  });

  it('puts the prefix and one space before the first part, outside any span', () => {
    const html = render({ prefix: 'Para «filtro»:', parts: ['a', 'b'] });
    expect(text(html)).toBe('Para «filtro»: a · b');
    expect(spans(html)).toEqual(['a', 'b']);
  });

  it('renders no prefix text for an omitted or null prefix', () => {
    expect(text(render({ parts: ['a'] }))).toBe('a');
    expect(text(render({ prefix: null, parts: ['a'] }))).toBe('a');
  });

  it('renders no element of its own: only the part spans', () => {
    const html = render({ prefix: 'P:', parts: ['a', 'b'] });
    expect(html.replace(/<span[^>]*>[^<]*<\/span>/g, '')).not.toMatch(/<[a-z]/);
  });

  it('keeps the text content equal to the plain joined string', () => {
    const parts = ['0 compatibles', '23 sin datos', '2 ocultos'];
    expect(text(render({ prefix: 'X:', parts }))).toBe(`X: ${parts.join(' · ')}`);
  });

  it('escapes part text', () => {
    expect(render({ parts: ['<b>&'] })).toContain('&lt;b&gt;&amp;');
  });
});

describe('groupCopy', () => {
  const tFit = createTranslator({ locale: 'es-ES', messages, namespace: 'Fit' }) as unknown as Parameters<typeof groupCopy>[0];
  const CAR = 'Seat Ibiza 1.0 TSI';

  it('fits: heading names the car, no help', () => {
    const copy = groupCopy(tFit, 'fits', CAR, null);
    expect(copy.heading).toContain(CAR);
    expect(copy.help).toBeNull();
  });

  it('unknown: fixed heading and help, independent of the car and the count', () => {
    const copy = groupCopy(tFit, 'unknown', CAR, null);
    expect(copy.heading).toBe(messages.Fit.unknownHeading);
    expect(copy.help).toBe(messages.Fit.unknownHelp);
    expect(groupCopy(tFit, 'unknown', 'Otro', 5)).toEqual(copy);
  });

  it('no-fit-exact: the heading is fixed and the help names the car and the count', () => {
    const copy = groupCopy(tFit, 'no-fit-exact', CAR, 3);
    expect(copy.heading).toBe(messages.Fit.exactHeading);
    expect(copy.help).toContain(CAR);
    // The count only selects the plural form: "No son" for many, "No es" for one.
    expect(copy.help).toMatch(/^No son compatibles/);
    expect(groupCopy(tFit, 'no-fit-exact', CAR, 1).help).toMatch(/^No es compatible/);
  });

  it('no-fit-exact with a null exact count throws: the category page never has that group', () => {
    expect(() => groupCopy(tFit, 'no-fit-exact', CAR, null)).toThrow(/exact-hit group/);
  });

  it('a zero exact count is a count, not a missing one', () => {
    expect(() => groupCopy(tFit, 'no-fit-exact', CAR, 0)).not.toThrow();
  });
});
