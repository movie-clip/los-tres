import { describe, expect, it } from 'vitest';

import {
  CAR_HEADER,
  CAR_UNRECOGNISED,
  PATH_HEADER,
  carRequestHeaders,
  isForwardablePath,
  readForwardedCar,
  readForwardedPath,
} from '@/server/car/request';

// The proxy side of the selected car (S5.7, C1): the two request headers.

const headersFor = (url: string, incoming: Record<string, string> = {}) =>
  carRequestHeaders(new URL(url, 'http://site.test'), new Headers(incoming));

describe('car request header names', () => {
  it('are the ruled names and never carry the code name', () => {
    expect(CAR_HEADER).toBe('x-car-slug');
    expect(PATH_HEADER).toBe('x-car-path');
    expect(CAR_UNRECOGNISED).toBe('-');
  });
});

describe('carRequestHeaders: x-car-slug', () => {
  it('is absent when the URL has no coche', () => {
    expect(headersFor('/categoria/aceite').has(CAR_HEADER)).toBe(false);
  });

  it('carries a single well-formed coche', () => {
    expect(headersFor('/?coche=seat-leon-iii-1-6-tdi').get(CAR_HEADER)).toBe('seat-leon-iii-1-6-tdi');
  });

  it.each([
    ['empty', '/?coche='],
    ['malformed (upper case)', '/?coche=Seat'],
    ['malformed (underscore)', '/?coche=a_b'],
    ['malformed (encoded slash)', '/?coche=a%2Fb'],
    ['repeated', '/?coche=a&coche=b'],
    ['repeated, same value', '/?coche=a&coche=a'],
    ['repeated, one empty', '/?coche=a&coche='],
  ])('is "-" for a %s coche', (_label, url) => {
    expect(headersFor(url).get(CAR_HEADER)).toBe('-');
  });

  it('strips a client-sent copy of both headers', () => {
    const headers = headersFor('/categoria/aceite', {
      [CAR_HEADER]: 'seat-leon',
      [PATH_HEADER]: '/forged',
    });
    expect(headers.has(CAR_HEADER)).toBe(false);
    expect(headers.get(PATH_HEADER)).toBe('/categoria/aceite');
  });

  it('replaces a client-sent copy with the URL value, not the forged one', () => {
    const headers = headersFor('/?coche=real-one', { [CAR_HEADER]: 'forged', [PATH_HEADER]: '/forged' });
    expect(headers.get(CAR_HEADER)).toBe('real-one');
    expect(headers.get(PATH_HEADER)).toBe('/');
  });

  it('strips a forged path header even when the real path cannot be forwarded', () => {
    const long = `/${'a'.repeat(600)}`;
    const headers = headersFor(long, { [PATH_HEADER]: '/forged' });
    expect(headers.has(PATH_HEADER)).toBe(false);
  });

  it('leaves the other incoming headers alone and does not mutate the input', () => {
    const incoming = new Headers({ accept: 'text/html', [CAR_HEADER]: 'forged' });
    const out = carRequestHeaders(new URL('http://site.test/'), incoming);
    expect(out.get('accept')).toBe('text/html');
    expect(incoming.get(CAR_HEADER)).toBe('forged');
  });
});

describe('carRequestHeaders: x-car-path', () => {
  it('is the path alone when there is no query', () => {
    expect(headersFor('/producto/filtro-a').get(PATH_HEADER)).toBe('/producto/filtro-a');
  });

  it('removes coche and keeps the other parameters in order', () => {
    expect(headersFor('/categoria/f?orden=precio&coche=x&marca=bosch&pagina=2').get(PATH_HEADER)).toBe(
      '/categoria/f?orden=precio&marca=bosch&pagina=2',
    );
  });

  it('removes every coche, repeated or not', () => {
    expect(headersFor('/buscar?q=aceite&coche=a&coche=b').get(PATH_HEADER)).toBe('/buscar?q=aceite');
  });

  it('has no trailing question mark when coche was the only parameter', () => {
    expect(headersFor('/?coche=x').get(PATH_HEADER)).toBe('/');
  });

  it('is ASCII even for a non-ASCII path and query', () => {
    const path = headersFor('/buscar?q=ni%C3%B1o+%C3%A9&coche=x').get(PATH_HEADER);
    expect(path).not.toBeNull();
    expect(path).toMatch(/^[\x21-\x7e]+$/);
    expect(path?.startsWith('/buscar?q=')).toBe(true);
  });

  it('is forwarded at exactly 512 characters and dropped at 513', () => {
    const at512 = `/${'a'.repeat(511)}`;
    const at513 = `/${'a'.repeat(512)}`;
    expect(headersFor(at512).get(PATH_HEADER)).toBe(at512);
    expect(headersFor(at513).has(PATH_HEADER)).toBe(false);
  });

  it('measures the length without coche, so a long coche does not drop it', () => {
    const at512 = `/${'a'.repeat(511)}`;
    expect(headersFor(`${at512}?coche=x`).get(PATH_HEADER)).toBe(at512);
  });
});

describe('isForwardablePath', () => {
  it.each(['/', '/a', '/a?b=c', `/${'a'.repeat(511)}`])('accepts %s', (value) => {
    expect(isForwardablePath(value)).toBe(true);
  });

  it.each([
    ['empty', ''],
    ['relative', 'a'],
    ['protocol-relative', '//evil'],
    ['backslash', '/a\\b'],
    ['space', '/a b'],
    ['control character', '/a\u0001b'],
    ['DEL', '/a\u007fb'],
    ['non-ASCII', '/ñ'],
    ['too long', `/${'a'.repeat(512)}`],
  ])('rejects %s', (_label, value) => {
    expect(isForwardablePath(value)).toBe(false);
  });
});

describe('readForwardedCar', () => {
  it('is none when the header is absent', () => {
    expect(readForwardedCar(null)).toEqual({ kind: 'none' });
  });

  it('reads a well-formed slug', () => {
    expect(readForwardedCar('seat-leon')).toEqual({ kind: 'slug', slug: 'seat-leon' });
  });

  it.each(['-', '', 'Seat', 'a b', 'a_b'])('treats %j as invalid', (value) => {
    expect(readForwardedCar(value)).toEqual({ kind: 'invalid' });
  });
});

describe('readForwardedPath', () => {
  it('is null when absent or unusable', () => {
    expect(readForwardedPath(null)).toBeNull();
    expect(readForwardedPath('//evil')).toBeNull();
    expect(readForwardedPath('')).toBeNull();
  });

  it('returns a usable path unchanged', () => {
    expect(readForwardedPath('/categoria/f?pagina=2')).toBe('/categoria/f?pagina=2');
  });
});
