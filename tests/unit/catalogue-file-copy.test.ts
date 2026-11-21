import { describe, expect, it } from 'vitest';

import messages from '../../messages/es-ES.json';

// S3.7 T3.7.4, ACs 13, 38 and 39 on the copy. The frontend lane widened the ICU allow-list of
// messages.test.ts by one name, `kinds`. Reviewed and kept; this file tightens it: `kinds` may
// appear only where the accepted file endings are listed, and no message of the file-name flow may
// take a placeholder that would print the typed name (the refusals never repeat it). That no
// sentence promises publication is already scanned over the whole Sources, Form and Categories
// blocks by admin-copy.test.ts, which now includes the new keys.

function leaves(node: unknown, prefix: string): [string, string][] {
  if (typeof node === 'string') return [[prefix, node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node).flatMap(([key, value]) => leaves(value, `${prefix}.${key}`));
}

const admin = leaves(messages.Admin, 'Admin');
const placeholdersOf = (text: string): string[] => [...text.matchAll(/\{([A-Za-z]+)[,}]/g)].map((match) => match[1]);

describe('the {kinds} placeholder of the catalogue-file copy', () => {
  const withKinds = admin.filter(([, value]) => placeholdersOf(value).includes('kinds')).map(([key]) => key);

  it('is used by exactly the three messages that list the accepted endings', () => {
    expect(withKinds.sort()).toEqual([
      'Admin.Form.Errors.fileWrongKind',
      'Admin.Form.Feed.fileHintEdit',
      'Admin.Form.Feed.fileHintNew',
    ]);
  });

  it('is not used anywhere else in the app copy', () => {
    const everywhere = leaves(messages, 'root').filter(([key, value]) => !key.startsWith('root.Admin') && placeholdersOf(value).includes('kinds'));
    expect(everywhere).toEqual([]);
  });
});

describe('no file-name message can print what the admin typed (AC 13)', () => {
  const fileMessages = admin.filter(([key]) => !key.startsWith('Admin.Meta.') && /\.(file[A-Z]\w*|source[A-Z]\w*|feedMetaFile|feedNeverImportedFile)$/.test(key));

  it('scans the file-name messages, so the check is not vacuous', () => {
    expect(fileMessages.length).toBeGreaterThanOrEqual(15);
    expect(fileMessages.map(([key]) => key)).toEqual(
      expect.arrayContaining(['Admin.Form.Errors.fileNotAName', 'Admin.Form.Feed.fileRefillNew', 'Admin.Sources.fileLabel']),
    );
  });

  it('takes no placeholder but the endings and the length limit', () => {
    const offenders = fileMessages.flatMap(([key, value]) =>
      placeholdersOf(value)
        .filter((name) => !['kinds', 'max', 'id'].includes(name))
        .map((name) => `${key}: {${name}}`),
    );
    expect(offenders).toEqual([]);
  });

  it('names no folder, drive or path in any sentence the admin reads', () => {
    const offenders = fileMessages.filter(([, value]) => /catalogue-files|[A-Za-z]:\\|\/app\//.test(value)).map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
