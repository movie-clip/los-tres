import { describe, expect, it } from 'vitest';

import {
  FEED_URL_MAX,
  NAME_MAX,
  SLUG_MAX,
  SOURCE_NOTICES,
  checkName,
  checkSlug,
  isSourceNotice,
  parseId,
  textField,
} from '@/server/admin/source-rules';

// S3.1, ACs 8, 12, 46: the pure rules of the network, shop and feed forms.

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe('checkName (AC 8, 12, D-T6)', () => {
  it('trims the name and accepts it', () => {
    expect(checkName('  Mi tienda  ')).toEqual({ value: 'Mi tienda', error: null });
  });

  it.each(['', '   ', '\t\n ', ' '])('refuses an empty or blank-only name (%j) as required', (raw) => {
    expect(checkName(raw).error).toBe('required');
  });

  it('accepts a name of exactly the limit and refuses one code point more', () => {
    expect(checkName('n'.repeat(NAME_MAX)).error).toBeNull();
    expect(checkName('n'.repeat(NAME_MAX + 1)).error).toBe('too_long');
  });

  it('counts code points, not UTF-16 units: 120 emoji are accepted, 121 are not', () => {
    expect(checkName('😀'.repeat(NAME_MAX)).error).toBeNull();
    expect(checkName('😀'.repeat(NAME_MAX + 1)).error).toBe('too_long');
  });

  it('measures the length after the trim', () => {
    expect(checkName(` ${'n'.repeat(NAME_MAX)} `).error).toBeNull();
  });
});

describe('checkSlug (AC 8, 12, 46, D-T5)', () => {
  it.each([
    ['demo-like but fine', 'mi-demo'],
    ['demo as a suffix', 'red-demo'],
    ['tienda-demo alone', 'tienda-demo'],
    ['one letter', 's'],
    ['digits', '2024'],
    ['a hyphenated lowercase slug', 'mi-tienda-2'],
    ['every shape the seed uses', 'red-prueba'],
  ])('accepts %s', (_label, slug) => {
    expect(checkSlug(slug, 'shop').error).toBeNull();
    expect(checkSlug(slug, 'network').error).toBeNull();
  });

  it.each([
    ['empty', '', 'required'],
    ['blank only', '   ', 'required'],
    ['upper case', 'Mi-Tienda', 'invalid'],
    ['an accent', 'tiénda', 'invalid'],
    ['a space inside', 'mi tienda', 'invalid'],
    ['an underscore', 'mi_tienda', 'invalid'],
    ['a leading hyphen', '-mi', 'invalid'],
    ['a trailing hyphen', 'mi-', 'invalid'],
    ['a double hyphen', 'mi--tienda', 'invalid'],
    ['padding, not repaired', ' mi-tienda ', 'invalid'],
    ['a slash', 'a/b', 'invalid'],
  ])('refuses %s as %s', (_label, slug, error) => {
    expect(checkSlug(slug, 'shop').error).toBe(error);
    expect(checkSlug(slug, 'network').error).toBe(error);
  });

  it('accepts a slug of exactly the limit and refuses one character more', () => {
    expect(checkSlug('s'.repeat(SLUG_MAX), 'shop').error).toBeNull();
    expect(checkSlug('s'.repeat(SLUG_MAX + 1), 'shop').error).toBe('too_long');
  });

  it('reserves the network slug demo exactly and the shop prefix tienda-demo-', () => {
    expect(checkSlug('demo', 'network').error).toBe('reserved');
    expect(checkSlug('demo', 'shop').error).toBeNull();
    expect(checkSlug('tienda-demo-uno', 'shop').error).toBe('reserved');
    expect(checkSlug('tienda-demo-x', 'shop').error).toBe('reserved');
    expect(checkSlug('tienda-demo-x', 'network').error).toBeNull();
  });

  it('checks in the order required, too_long, invalid, reserved', () => {
    // Too long and invalid at once: too_long wins. Invalid and reserved cannot overlap by shape.
    expect(checkSlug(`TIENDA-DEMO-${'x'.repeat(80)}`, 'shop').error).toBe('too_long');
    expect(checkSlug('TIENDA-DEMO-X', 'shop').error).toBe('invalid');
  });
});

describe('parseId', () => {
  it.each(['1', '42', '2147483647'])('reads %s', (raw) => {
    expect(parseId(raw)).toBe(Number(raw));
  });

  it.each(['', '0', '-1', '1.5', '1e1', ' 1', '1 ', '01', '2147483648', '9'.repeat(40), 'abc'])('refuses %j', (raw) => {
    expect(parseId(raw)).toBeNull();
  });

  it('refuses a value that is not a string', () => {
    expect(parseId(null)).toBeNull();
    expect(parseId(undefined)).toBeNull();
    expect(parseId(new Blob(['1']))).toBeNull();
  });
});

describe('textField', () => {
  it('returns the text, an empty string for an absent field and for a file', () => {
    const data = form({ name: ' x ' });
    data.set('file', new Blob(['1']), 'f.txt');
    expect(textField(data, 'name')).toBe(' x ');
    expect(textField(data, 'absent')).toBe('');
    expect(textField(data, 'file')).toBe('');
  });
});

describe('the notice keys', () => {
  it('are the seven the page maps, and only those are accepted', () => {
    expect([...SOURCE_NOTICES]).toEqual([
      'red-creada',
      'red-guardada',
      'tienda-creada',
      'tienda-guardada',
      'feed-creado',
      'feed-guardado',
      'feed-sin-aprobar',
    ]);
    for (const key of SOURCE_NOTICES) expect(isSourceNotice(key)).toBe(true);
    for (const other of ['', 'Red-creada', 'x', 'https://evil.example', '__proto__', undefined, null, 7, ['red-creada']]) {
      expect(isSourceNotice(other)).toBe(false);
    }
  });

  it('keeps the address limit the writer and the pages share', () => {
    expect(FEED_URL_MAX).toBe(2048);
  });
});
