// Support for the S2.6 tests of /admin/tiendas: one shop or feed row of the server-rendered page, read back from
// the markup. Used by tests/unit/sources-page-counts.test.ts (the reader replaced) and by
// tests/integration/admin-source-pages.test.ts (the real reader).

export type SourceRowText = {
  /** The text of the meta line, for example "1 feed · 3 ofertas · 2 en el sitio ahora". */
  meta: string;
  /** The text of the note under the meta line, or null when the row has none. */
  note: string | null;
};

/**
 * The meta line and the note of one row, cut from the markup by its `source-<kind>-<id>` testid up to the next row
 * (a shop's own row ends where its first feed begins). The meta span is found by its class name holding `meta`.
 * Throws when the row or its meta line is missing, so a page that lost a line fails loudly and not as a null.
 */
export function sourceRowOf(page: string, kind: 'shop' | 'feed', id: number): SourceRowText {
  const start = page.indexOf(`data-testid="source-${kind}-${id}"`);
  if (start < 0) throw new Error(`no ${kind} ${id} on the page`);
  const rest = page.slice(start + 1);
  const next = rest.search(/data-testid="source-(shop|feed)-/);
  const own = next < 0 ? rest : rest.slice(0, next);
  const meta = /<span class="[^"]*meta[^"]*">([^<]*)<\/span>/.exec(own);
  if (!meta) throw new Error(`no meta line for ${kind} ${id}`);
  return { meta: meta[1], note: /data-testid="source-note">([^<]*)<\/span>/.exec(own)?.[1] ?? null };
}
