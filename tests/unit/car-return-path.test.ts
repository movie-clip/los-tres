import { describe, expect, it } from 'vitest';

import { carLinks, parseReturnPath, returnPath } from '@/server/car/return-path';
import type { CarContext, SelectedVehicle } from '@/server/car/state';
import { withCar } from '@/server/catalogue/paths';

// `volver` is user input (S5.7, C4, AC 18): the hostile table is the open-redirect guard.

describe('parseReturnPath: accepted', () => {
  it.each([
    ['/', '/'],
    ['/categoria/aceite-de-motor', '/categoria/aceite-de-motor'],
    ['/categoria/aceite?pagina=2&marca=bosch', '/categoria/aceite?pagina=2&marca=bosch'],
    ['/buscar?q=aceite+5w30', '/buscar?q=aceite+5w30'],
  ])('keeps %s', (raw, expected) => {
    expect(parseReturnPath(raw)).toBe(expected);
  });

  it('drops the fragment', () => {
    expect(parseReturnPath('/producto/x#ofertas')).toBe('/producto/x');
  });

  it('keeps a coche as given (returnPath replaces it later)', () => {
    expect(parseReturnPath('/categoria/f?coche=old-one')).toBe('/categoria/f?coche=old-one');
  });

  it('resolves dot segments that stay on the site', () => {
    expect(parseReturnPath('/a/../categoria/f')).toBe('/categoria/f');
  });

  it('accepts exactly 512 characters', () => {
    const value = `/${'a'.repeat(511)}`;
    expect(parseReturnPath(value)).toBe(value);
  });

  it('accepts a path that merely starts like a refused one', () => {
    expect(parseReturnPath('/mi-coche-viejo')).toBe('/mi-coche-viejo');
    expect(parseReturnPath('/goal')).toBe('/goal');
    expect(parseReturnPath('/apis')).toBe('/apis');
  });
});

describe('parseReturnPath: hostile table (AC 18)', () => {
  it.each([
    ['absent', undefined],
    ['empty', ''],
    ['a repeated parameter (array)', ['/a', '/b']],
    ['an array of one', ['/a']],
    ['an empty array', []],
    ['no leading slash', 'categoria/f'],
    ['an absolute URL', 'https://evil.example/'],
    ['a scheme-relative URL', '//evil.example'],
    ['a scheme-relative URL with path', '//evil.example/x'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,x'],
    ['slash backslash', '/\\evil.example'],
    ['a backslash later', '/a\\evil.example'],
    ['a space', '/a b'],
    ['a tab', '/a\tb'],
    ['a newline', '/a\nb'],
    ['a carriage return', '/a\rb'],
    ['a NUL', '/a\u0000b'],
    ['DEL', '/a\u007fb'],
    ['a leading space', ' /a'],
    ['dot slash slash', '/.//evil.example'],
    ['dot-dot with double slash', '/a/..//evil.example'],
    ['an encoded dot with double slash', '/.%2e//evil.example'],
    ['a longer dot-dot chain', '/a/b/../..//evil.example'],
    ['513 characters', `/${'a'.repeat(512)}`],
  ])('is null for %s', (_label, raw) => {
    expect(parseReturnPath(raw as string | string[] | undefined)).toBeNull();
  });

  it('never returns a path starting with two slashes', () => {
    for (const raw of ['/.//x', '/a/..//x', '/././/x', '/a/b/../..//x']) {
      const out = parseReturnPath(raw);
      expect(out === null || !out.startsWith('//')).toBe(true);
    }
  });

  it.each([
    ['the picker', '/mi-coche'],
    ['the picker with a query', '/mi-coche?marca=seat'],
    ['the picker through a dot segment', '/a/../mi-coche'],
    ['the click redirect', '/go/123'],
    ['the API', '/api/vehiculos'],
    ['the admin area', '/admin'],
    ['an admin page', '/admin/acceso'],
    ['an admin look-alike', '/administrador'],
    ['the click redirect through a dot segment', '/x/../go/1'],
  ])('is null for %s', (_label, raw) => {
    expect(parseReturnPath(raw)).toBeNull();
  });
});

describe('returnPath', () => {
  it('goes home when there is nowhere to return', () => {
    expect(returnPath(null, 'seat-leon')).toBe('/?coche=seat-leon');
  });

  it('appends coche last', () => {
    expect(returnPath('/categoria/f?pagina=2', 'seat-leon')).toBe('/categoria/f?pagina=2&coche=seat-leon');
  });

  it('replaces any coche already in the path, once and last', () => {
    expect(returnPath('/categoria/f?coche=old&pagina=2&coche=other', 'new-one')).toBe(
      '/categoria/f?pagina=2&coche=new-one',
    );
  });
});

describe('carLinks', () => {
  const vehicle: SelectedVehicle = {
    id: 7,
    slug: 'seat-leon-iii-1-6-tdi',
    makeSlug: 'seat',
    modelSlug: 'seat-leon-iii',
    name: 'Seat León III 1.6 TDI',
  };
  const PATH = '/categoria/aceite?pagina=2';

  it('none: select returns to the page, no change or remove', () => {
    const car: CarContext = { state: 'none', path: PATH };
    expect(carLinks(car)).toEqual({
      select: `/mi-coche?volver=${encodeURIComponent(PATH)}`,
      change: null,
      remove: null,
    });
  });

  it('selected: volver carries the car, change starts at the model step, remove is the coche-free page', () => {
    const car: CarContext = { state: 'selected', vehicle, path: PATH };
    const volver = encodeURIComponent(withCar(PATH, vehicle.slug));
    expect(carLinks(car)).toEqual({
      select: `/mi-coche?volver=${volver}`,
      change: `/mi-coche?marca=seat&modelo=seat-leon-iii&volver=${volver}`,
      remove: PATH,
    });
  });

  it('selected with no path: bare picker links and a home remove', () => {
    const car: CarContext = { state: 'selected', vehicle, path: null };
    expect(carLinks(car)).toEqual({
      select: '/mi-coche',
      change: '/mi-coche?marca=seat&modelo=seat-leon-iii',
      remove: '/',
    });
  });

  it.each<CarContext>([
    { state: 'unrecognised', raw: 'gone', path: PATH },
    { state: 'unrecognised', raw: null, path: PATH },
    { state: 'unavailable', path: PATH },
  ])('$state: volver has no car and there is no change or remove', (car) => {
    expect(carLinks(car)).toEqual({
      select: `/mi-coche?volver=${encodeURIComponent(PATH)}`,
      change: null,
      remove: null,
    });
  });

  it('encodes a volver so it stays one parameter', () => {
    const car: CarContext = { state: 'none', path: '/buscar?q=a&b=c' };
    const { select } = carLinks(car);
    expect(new URL(select, 'http://h.test').searchParams.get('volver')).toBe('/buscar?q=a&b=c');
  });

  it('round-trips: the select link volver parses back to the page', () => {
    const car: CarContext = { state: 'none', path: PATH };
    const volver = new URL(carLinks(car).select, 'http://h.test').searchParams.get('volver');
    expect(parseReturnPath(volver ?? undefined)).toBe(PATH);
  });
});
