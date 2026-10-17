import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { ImportDeps } from '@/server/importer';

/** The text of one local fixture feed in tests/fixtures/feeds. Never a network read. */
export function readFeedFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), 'tests/fixtures/feeds', name), 'utf8');
}

/**
 * Importer dependencies that serve a feed from a local fixture. The feed row's
 * `url` is the fixture file name (for example `ean-first.csv`), so one import
 * can serve a different file per feed. Replaces the real source reader, so the
 * importer reads no network and no demo file.
 */
export const fixtureDeps: ImportDeps = {
  readSource: async (feed) => readFeedFixture(feed.url),
};

/** Importer dependencies that serve the given text per feed id; an Error value is thrown. */
export function textDeps(byFeedId: Record<number, string | Error>): ImportDeps {
  return {
    readSource: async (feed) => {
      const served = byFeedId[feed.id];
      if (served === undefined) throw new Error(`no text for feed ${feed.id}`);
      if (served instanceof Error) throw served;
      return served;
    },
  };
}
