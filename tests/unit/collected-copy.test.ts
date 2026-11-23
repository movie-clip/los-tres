import { describe, expect, it } from 'vitest';

import messages from '../../messages/es-ES.json';

// S12.2 (decision 0017), AC 50 and OD-6: the copy this story adds is Spanish admin copy in the message files,
// and no public page, public message or sign changes. Nothing a visitor reads says that a row is "recopilado",
// and no admin sentence prints the flag's name, a folder or a path. That no admin sentence promises publication
// is admin-copy.test.ts, whose scan covers the new keys; the {kinds} pin is catalogue-file-copy.test.ts.

function leaves(node: unknown, prefix: string): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, `${prefix}.${key}`));
}

const all = leaves(messages, 'root');
const admin = all.filter(([key]) => key.startsWith('root.Admin.'));
const publicCopy = all.filter(([key]) => !key.startsWith('root.Admin.'));

const COLLECTED_WORDS = /recopilad|uso local|ajuste local|sitio local|herramienta de recopilaci/i;

describe('no public message speaks of collected data (AC 50, OD-6)', () => {
  it('reads the public copy it checks, so the check is not vacuous', () => {
    expect(publicCopy.length).toBeGreaterThan(100);
    expect(admin.length).toBeGreaterThan(100);
  });

  it('holds no word about a collected file, a local flag or a local site outside the Admin section', () => {
    expect(publicCopy.filter(([, value]) => COLLECTED_WORDS.test(value)).map(([key]) => key)).toEqual([]);
  });

  it('puts the collected copy under the Admin section, and only there (the sweep finds it)', () => {
    const found = all.filter(([, value]) => COLLECTED_WORDS.test(value)).map(([key]) => key);
    expect(found.length).toBeGreaterThanOrEqual(8);
    expect(found.filter((key) => !key.startsWith('root.Admin.'))).toEqual([]);
  });

  it.each(['Admin.Form.Feed.sourceOptionCollected', 'Admin.Form.Feed.collectedInfoTitle', 'Admin.Sources.feedMetaCollected', 'Admin.Categories.collectedNote'])(
    'has the admin key %s, in Spanish text',
    (key) => {
      const entry = admin.find(([name]) => name === `root.${key}`);
      expect(entry?.[1]).toMatch(/\S/);
    },
  );
});

describe('no admin sentence shows an internal name, a folder or a path (ACs 8, 50)', () => {
  it('names neither the flag variable, nor the environment, nor either folder, nor a drive or a container path', () => {
    const offenders = admin.filter(([, value]) => /LOCAL_COLLECTED_DATA|SITE_URL|\.env\b|collected-files|catalogue-files|[A-Za-z]:\\|\/app\//.test(value));
    expect(offenders.map(([key]) => key)).toEqual([]);
  });

  it('names the folder by kind only, never by its location, in the one sentence that mentions it', () => {
    const mentions = admin.filter(([, value]) => /carpeta de archivos recopilados/i.test(value));
    expect(mentions.length).toBeGreaterThanOrEqual(1);
    for (const [, value] of mentions) expect(value).not.toMatch(/[\\/]/);
  });
});
