import { describe, expect, it } from 'vitest';

import { openedWithCoche, selectedSlug, type CarContext, type SelectedVehicle } from '@/server/car/state';
import { withCar } from '@/server/catalogue/paths';
import { noindexWhenCar } from '@/server/catalogue/seo';

const vehicle: SelectedVehicle = {
  id: 1,
  slug: 'seat-leon',
  makeSlug: 'seat',
  modelSlug: 'seat-leon-iii',
  name: 'Seat León III',
};

const states: CarContext[] = [
  { state: 'none', path: '/' },
  { state: 'selected', vehicle, path: '/' },
  { state: 'unrecognised', raw: 'gone', path: '/' },
  { state: 'unrecognised', raw: null, path: null },
  { state: 'unavailable', path: '/' },
];

describe('withCar', () => {
  it('appends coche to a bare path', () => {
    expect(withCar('/categoria/f', 'seat-leon')).toBe('/categoria/f?coche=seat-leon');
  });

  it('puts coche last after the other parameters, which keep order and spelling', () => {
    expect(withCar('/categoria/f?orden=precio&marca=Bosch%20X&pagina=2', 'seat-leon')).toBe(
      '/categoria/f?orden=precio&marca=Bosch%20X&pagina=2&coche=seat-leon',
    );
  });

  it('sets exactly one coche, replacing every existing one', () => {
    expect(withCar('/a?coche=x&b=1&coche=y', 'new-one')).toBe('/a?b=1&coche=new-one');
  });

  it('with null removes every coche', () => {
    expect(withCar('/a?coche=x&b=1&coche=y', null)).toBe('/a?b=1');
  });

  it('with null leaves a query-free href unchanged', () => {
    expect(withCar('/a', null)).toBe('/a');
  });

  it('drops the question mark when coche was the only parameter', () => {
    expect(withCar('/a?coche=x', null)).toBe('/a');
  });

  it('removes an encoded spelling of coche', () => {
    expect(withCar('/a?%63oche=x&b=1', null)).toBe('/a?b=1');
  });

  it('does not remove a parameter that merely contains the word', () => {
    expect(withCar('/a?cochez=1&xcoche=2', null)).toBe('/a?cochez=1&xcoche=2');
  });

  it('keeps the fragment, after the query', () => {
    expect(withCar('/producto/x#ofertas', 'seat-leon')).toBe('/producto/x?coche=seat-leon#ofertas');
    expect(withCar('/producto/x?coche=old#ofertas', null)).toBe('/producto/x#ofertas');
  });

  it('works on the root and on an empty query part', () => {
    expect(withCar('/', 'seat-leon')).toBe('/?coche=seat-leon');
    expect(withCar('/a?', 'seat-leon')).toBe('/a?coche=seat-leon');
  });

  it('is idempotent', () => {
    const once = withCar('/a?b=1', 'seat-leon');
    expect(withCar(once, 'seat-leon')).toBe(once);
  });
});

describe('car state helpers', () => {
  it('openedWithCoche is true for every state but none', () => {
    expect(states.map(openedWithCoche)).toEqual([false, true, true, true, true]);
  });

  it('selectedSlug is the slug only when selected', () => {
    expect(states.map(selectedSlug)).toEqual([null, 'seat-leon', null, null, null]);
  });
});

describe('noindexWhenCar', () => {
  it('adds nothing when the page was not opened with coche', () => {
    expect(noindexWhenCar(states[0])).toEqual({});
  });

  it.each(states.slice(1))('marks the page noindex for $state', (car) => {
    expect(noindexWhenCar(car)).toEqual({ robots: { index: false } });
  });

  it('never adds a canonical', () => {
    for (const car of states) expect(noindexWhenCar(car).alternates).toBeUndefined();
  });
});
