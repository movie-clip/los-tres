import { createElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CarControl, type CarControlProps } from '@/components/CarControl';
import { CarNotice } from '@/components/CarNotice';

// M3 (#339): the three states of the car control, rendered as the server draws them (before hydration
// the actions are plain links, so a visitor without script still reaches the picker). The journeys J4
// and J5 keep the dialog and the no-script round trip in a browser.

const CAR = {
  slug: 'seat-leon-iii-2012-2020-1-6-tdi-105cv',
  makeSlug: 'seat',
  modelSlug: 'seat-leon-iii',
  name: 'Seat León III 1.6 TDI',
};

const LINKS = {
  select: '/mi-coche?volver=%2F',
  change: `/mi-coche?coche=${CAR.slug}&volver=%2F`,
  remove: '/',
};

function strings(selected: ReactNode): CarControlProps['strings'] {
  return {
    groupLabel: 'GRUPO',
    select: 'SELECCIONAR',
    selected,
    change: 'CAMBIAR',
    changeLabel: 'CAMBIAR-ETIQUETA',
    remove: 'QUITAR',
    removeLabel: 'QUITAR-ETIQUETA',
    dialog: {
      title: 'T',
      close: 'C',
      closeLabel: 'CL',
      picker: {} as CarControlProps['strings']['dialog']['picker'],
    },
  };
}

function render(props: Partial<CarControlProps>): string {
  const full: CarControlProps = {
    car: null,
    unrecognised: null,
    cochePresent: false,
    options: [],
    links: LINKS,
    strings: strings(null),
    ...props,
  };
  return renderToStaticMarkup(createElement(CarControl, full));
}

const anchor = (html: string, testId: string) =>
  html.match(new RegExp(`<a\\b[^>]*data-testid="${testId}"[^>]*>`))?.[0] ?? null;

describe('CarControl states (M3)', () => {
  it('with no car shows the select action as a link to the picker page, and nothing else', () => {
    const html = render({});
    expect(html).toContain('role="group"');
    expect(html).toContain('aria-label="GRUPO"');
    const select = anchor(html, 'car-select');
    expect(select).not.toBeNull();
    expect(select).toContain(`href="${LINKS.select}"`);
    expect(html).toContain('SELECCIONAR');
    expect(html).not.toContain('data-testid="car-label"');
    expect(html).not.toContain('data-testid="car-change"');
    expect(html).not.toContain('data-testid="car-remove"');
    expect(html).not.toContain('<dialog');
  });

  it('with a car shows the label, a change link at the car and a remove link without coche', () => {
    const html = render({
      car: CAR,
      strings: strings(createElement('strong', null, CAR.name)),
    });
    expect(html).toMatch(/data-testid="car-label"[^>]*>.*<strong>Seat León III 1\.6 TDI<\/strong>/);
    const change = anchor(html, 'car-change');
    expect(change).toContain(`href="${LINKS.change.replace(/&/g, '&amp;')}"`);
    expect(change).toContain('aria-label="CAMBIAR-ETIQUETA"');
    const remove = anchor(html, 'car-remove');
    expect(remove).toContain(`href="${LINKS.remove}"`);
    expect(remove).not.toContain('coche');
    expect(remove).toContain('aria-label="QUITAR-ETIQUETA"');
    expect(html).not.toContain('data-testid="car-select"');
  });

  it('with a car and no change link falls back to the picker link', () => {
    const html = render({
      car: CAR,
      links: { select: LINKS.select, change: null, remove: null },
      strings: strings('x'),
    });
    expect(anchor(html, 'car-change')).toContain(`href="${LINKS.select}"`);
    expect(anchor(html, 'car-remove')).toContain('href="/"');
  });

  it('with an unrecognised car draws the no-car control, never a car it does not know', () => {
    const html = render({ car: null, unrecognised: 'gone-car', cochePresent: true });
    expect(anchor(html, 'car-select')).not.toBeNull();
    expect(html).not.toContain('gone-car');
    expect(html).not.toContain('data-testid="car-label"');
    expect(html).not.toContain('data-testid="car-remove"');
  });
});

describe('CarNotice (M3)', () => {
  it('is a note carrying the finished sentence, with no control and no script', () => {
    const html = renderToStaticMarkup(createElement(CarNotice, { text: 'No reconocemos ese coche.' }));
    expect(html).toMatch(/^<p\b[^>]*role="note"[^>]*>No reconocemos ese coche\.<\/p>$/);
    expect(html).not.toContain('<button');
    expect(html).not.toContain('<a ');
  });

  it('escapes the sentence it is given', () => {
    const html = renderToStaticMarkup(createElement(CarNotice, { text: '<script>x()</script>' }));
    expect(html).not.toContain('<script>');
  });
});
