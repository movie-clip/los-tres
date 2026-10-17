import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import messages from '../../messages/es-ES.json';

// The code name, assembled so this file does not itself contain the literal.
const CODE_NAME = new RegExp(['los', 'tres'].join('[\\s_-]*'), 'i');

function lookup(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      messages,
    );
}

function collectStrings(node: unknown, into: string[] = []): string[] {
  if (typeof node === 'string') into.push(node);
  else if (node && typeof node === 'object') {
    for (const value of Object.values(node)) collectStrings(value, into);
  }
  return into;
}

function listFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? listFiles(full) : [full];
  });
}

describe('messages/es-ES.json (C-8)', () => {
  it.each([
    'Metadata.title',
    'Metadata.description',
    'Home.heading',
    'Home.tagline',
    'NotFound.heading',
    'NotFound.body',
    'NotFound.backHome',
  ])('has a non-empty string at %s', (key) => {
    const value = lookup(key);
    expect(typeof value).toBe('string');
    expect((value as string).trim().length).toBeGreaterThan(0);
  });

  it.each(['Metadata.title', 'Home.heading'])('%s takes the {siteName} placeholder', (key) => {
    expect(lookup(key)).toContain('{siteName}');
  });

  it('contains the code name in no message', () => {
    for (const text of collectStrings(messages)) {
      expect(text).not.toMatch(CODE_NAME);
    }
  });

  it('contains the code name in no file under src/', () => {
    const offenders = listFiles(path.resolve(process.cwd(), 'src')).filter((file) =>
      CODE_NAME.test(readFileSync(file, 'utf8')),
    );
    expect(offenders).toEqual([]);
  });
});
