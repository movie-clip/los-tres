import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

// File-scan tests that keep the guardrail seams single-sourced. Each rule says
// where a thing may live; a second copy anywhere else fails the scan. They read
// source text, so they need neither a database nor a build.

const root = process.cwd();
const SOURCE_FILE = /\.(ts|tsx|mts|js|jsx|mjs)$/;

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

/** Source files under src/, as posix paths relative to the repo root, with code stripped of comments. */
function sources(): { file: string; code: string }[] {
  return walk(path.join(root, 'src'))
    .filter((full) => SOURCE_FILE.test(full))
    .map((full) => ({
      file: path.relative(root, full).split(path.sep).join('/'),
      code: stripComments(readFileSync(full, 'utf8')),
    }));
}

/** Drops block comments and line comments (not a `//` that follows a colon, as in a URL). */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:'"`])\/\/.*$/, '$1'))
    .join('\n');
}

function offenders(pattern: RegExp, allowed: (file: string) => boolean): string[] {
  return sources()
    .filter(({ file, code }) => pattern.test(code) && !allowed(file))
    .map(({ file }) => file);
}

describe('seams (guardrails 1, 2, 4)', () => {
  it('finds the source tree it scans', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/server/visibility.ts',
        'src/server/importer/source.ts',
        'src/server/money.ts',
      ]),
    );
  });

  const flagNames = /\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_removed|isRemoved)\b/;
  const mayNameFlags = (file: string): boolean =>
    file === 'src/server/visibility.ts' ||
    file.startsWith('src/db/') ||
    file.startsWith('src/server/seed/') ||
    file.startsWith('src/server/importer/') ||
    // Deliberate (issue #24, S2.3): the admin approval writer.
    file === 'src/server/admin/sources.ts' ||
    // Deliberate (issue #25, S2.4): the admin hide writer and product read. Every
    // screen file and the actions file name the state `hidden`, never the column.
    file === 'src/server/admin/products.ts';

  it('names the approval, hidden and review flags only in the visibility scope, schema, seed, importer and the two admin writers', () => {
    const found = offenders(flagNames, mayNameFlags);
    expect(found).toEqual([]);
  });

  it('finds the admin hide writer naming the hidden flag, and reports a screen or actions file that names it (S2.4, AC 52)', () => {
    const find = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
    expect(find('src/server/admin/products.ts')).toMatch(/\bisHidden\b/);
    expect(find('src/app/admin/(shell)/productos/actions.ts').length).toBeGreaterThan(0);
    const planted = [
      { file: 'src/server/admin/products.ts', code: 'set({ isHidden: hidden })' },
      { file: 'src/app/admin/(shell)/productos/actions.ts', code: 'set({ isHidden: hidden })' },
      { file: 'src/app/admin/(shell)/productos/page.tsx', code: 'row.isHidden' },
      { file: 'src/components/admin/ProductRow.tsx', code: 'product.is_hidden' },
      { file: 'src/server/catalogue/product-page.ts', code: 'eq(products.isHidden, false)' },
    ]
      .filter(({ code }) => flagNames.test(code))
      .map(({ file }) => file)
      .filter((file) => !mayNameFlags(file));
    expect(planted).toEqual([
      'src/app/admin/(shell)/productos/actions.ts',
      'src/app/admin/(shell)/productos/page.tsx',
      'src/components/admin/ProductRow.tsx',
      'src/server/catalogue/product-page.ts',
    ]);
  });

  // CR-1 (S2.4): mayNameFlags admits products.ts for every flag word, but the
  // hide writer may only name isHidden. Any other flag there would be a second
  // copy of the visibility scope.
  const namesOtherFlag = (code: string): boolean => flagNames.test(code.replace(/\bisHidden\b/g, ''));

  it('the admin hide writer names no flag word other than isHidden (CR-1)', () => {
    const code = sources().find(({ file }) => file === 'src/server/admin/products.ts')?.code ?? '';
    expect(code).toMatch(/\bisHidden\b/);
    expect(namesOtherFlag(code)).toBe(false);
  });

  it('reports a planted hide writer that names another flag, and passes one naming only isHidden (CR-1)', () => {
    expect(namesOtherFlag('set({ isHidden: hidden })')).toBe(false);
    for (const word of ['isApproved', 'is_approved', 'is_hidden', 'inReview', 'in_review', 'isRemoved', 'is_removed']) {
      expect(namesOtherFlag(`set({ isHidden: hidden }); where(eq(feeds.${word}, true))`)).toBe(true);
    }
  });

  it('the visibility scope itself names every flag, so the scan above is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/visibility.ts')?.code ?? '';
    for (const flag of ['isApproved', 'isHidden', 'inReview', 'isRemoved']) {
      expect(code).toContain(flag);
    }
  });

  // S3.3 (AC 21): the removed flag is narrower than the other three. Only the visibility scope reads
  // it, the schema and the seed know the column, and the importer is its one writer. The two admin
  // writers that `mayNameFlags` lets name the other flags may not name this one.
  const removedFlag = /\b(is_removed|isRemoved)\b/;
  const mayNameRemoved = (file: string): boolean =>
    file === 'src/server/visibility.ts' ||
    file.startsWith('src/db/') ||
    file.startsWith('src/server/seed/') ||
    file.startsWith('src/server/importer/');

  it('names the removed flag only in the visibility scope, schema, seed and importer (S3.3, AC 21)', () => {
    expect(offenders(removedFlag, mayNameRemoved)).toEqual([]);
  });

  it('keeps the removed-flag rule able to fail and not vacuous (S3.3, AC 21)', () => {
    const codeIn = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
    // The scan sees the flag where the design puts it.
    expect(codeIn('src/server/visibility.ts')).toMatch(removedFlag);
    expect(codeIn('src/server/importer/index.ts')).toMatch(removedFlag);
    expect(codeIn('src/db/schema/catalogue.ts')).toMatch(removedFlag);
    // Both spellings are caught, a screen or an admin writer naming it is reported, a longer word is not.
    expect(removedFlag.test('where(eq(offers.isRemoved, false))')).toBe(true);
    expect(removedFlag.test('offers.is_removed')).toBe(true);
    expect(removedFlag.test('isRemovedAt')).toBe(false);
    const planted = [
      'src/server/admin/products.ts',
      'src/server/admin/sources.ts',
      'src/app/admin/(shell)/productos/page.tsx',
      'src/server/catalogue/product-page.ts',
      'src/server/visibility.ts',
      'src/server/importer/index.ts',
    ].filter((file) => !mayNameRemoved(file));
    expect(planted).toEqual([
      'src/server/admin/products.ts',
      'src/server/admin/sources.ts',
      'src/app/admin/(shell)/productos/page.tsx',
      'src/server/catalogue/product-page.ts',
    ]);
  });

  it('writes the removed flag on an offer only in the importer (S3.3, AC 21)', () => {
    const writesRemoved = /isRemoved\s*:\s*(true|false)\b/;
    const found = sources()
      .filter(({ code }) => writesRemoved.test(code))
      .map(({ file }) => file)
      .filter((file) => !file.startsWith('src/db/'));
    expect(found).toEqual(['src/server/importer/index.ts']);
  });

  it('calls fetch( only in src/server/importer/source.ts', () => {
    const found = offenders(/(^|[^.\w$])fetch\s*\(|globalThis\.fetch|XMLHttpRequest/, (file) => file === 'src/server/importer/source.ts');
    expect(found).toEqual([]);
  });

  it('imports no HTTP client and no raw socket module anywhere in src', () => {
    const client = /from\s+['"](node:)?(https?|net|tls|http2|undici|axios|got|node-fetch|ky|superagent)['"]/;
    expect(offenders(client, () => false)).toEqual([]);
  });

  it('reads files from disk only in src/server/importer/source.ts and src/db/migrate.ts', () => {
    const fileSystem = /from\s+['"](node:)?fs(\/promises)?['"]/;
    const found = offenders(
      fileSystem,
      (file) => file === 'src/server/importer/source.ts' || file === 'src/db/migrate.ts',
    );
    expect(found).toEqual([]);
  });

  // Deliberate (issue #29, XML and gzip feeds): two new single-source rules join
  // the fetch and fs rules above, which are unchanged. Decompression lives in
  // decode.ts alone, so the inflated-size cap (512 MiB) cannot be bypassed by a
  // second inflate path; the XML parser lives in xml.ts alone, so its strict
  // mode, DOCTYPE refusal and cell cap hold for every XML read.
  it('imports node:zlib only in src/server/importer/decode.ts', () => {
    const zlib = /from\s+['"](node:)?zlib['"]|require\(\s*['"](node:)?zlib['"]\s*\)|import\(\s*['"](node:)?zlib['"]\s*\)/;
    expect(offenders(zlib, (file) => file === 'src/server/importer/decode.ts')).toEqual([]);
    const decode = sources().find(({ file }) => file === 'src/server/importer/decode.ts')?.code ?? '';
    expect(decode).toMatch(zlib);
  });

  it('imports the XML parser (sax) only in src/server/importer/xml.ts', () => {
    const parser = /from\s+['"](sax|saxes|fast-xml-parser|xml2js|htmlparser2|@xmldom\/xmldom)(\/[^'"]*)?['"]|require\(\s*['"](sax|saxes|fast-xml-parser|xml2js)['"]\s*\)/;
    expect(offenders(parser, (file) => file === 'src/server/importer/xml.ts')).toEqual([]);
    const xml = sources().find(({ file }) => file === 'src/server/importer/xml.ts')?.code ?? '';
    expect(xml).toMatch(/from\s+['"]sax['"]/);
  });

  it('imports the database from no page or component (a route handler may)', () => {
    const database = /from\s+['"](@\/db\/|(\.\.\/)+db\/)/;
    const found = sources()
      .filter(({ file }) => file.startsWith('src/app/') || file.startsWith('src/components/'))
      .filter(({ file }) => !/\/route\.(ts|js)$/.test(file))
      .filter(({ code }) => database.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('divides by 100 only in src/server/money.ts', () => {
    const found = offenders(/\/\s*100\b(?!\s*[*/])/, (file) => file === 'src/server/money.ts');
    expect(found).toEqual([]);
  });

  it('uses no float parsing or fixed-point formatting anywhere in src', () => {
    expect(offenders(/\b(parseFloat|toFixed)\b/, () => false)).toEqual([]);
  });

  it('declares no floating-point or money column in the migrations', () => {
    const sql = walk(path.join(root, 'src/db/migrations'))
      .filter((full) => full.endsWith('.sql'))
      .map((full) => readFileSync(full, 'utf8'))
      .join('\n');
    expect(sql).toContain('CREATE TABLE');
    expect(sql).not.toMatch(/\b(real|double precision|numeric|decimal|money|float\d?)\b/i);
  });
});

describe('seams (guardrail 1, S5.1 mapped products)', () => {
  it('names the mapped condition in the visibility scope, so the scan below is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/visibility.ts')?.code ?? '';
    expect(code).toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('tests products.category_id for null only in the visibility scope', () => {
    const found = offenders(
      /isNotNull\(\s*products\.categoryId\s*\)|categor(y_id|yId)\s+is\s+not\s+null/i,
      (file) => file === 'src/server/visibility.ts',
    );
    expect(found).toEqual([]);
  });

  it('has the category read go through the shared visibility scope, never its own flag test', () => {
    const code =
      sources().find(({ file }) => file === 'src/server/catalogue/category-page.ts')?.code ?? '';
    expect(code).toContain('visibleProductWhere()');
    expect(code).toContain('visibleOfferWhere()');
  });

  it('has the home tree read go through the shared visibility scope, never its own flag test', () => {
    const code =
      sources().find(({ file }) => file === 'src/server/catalogue/category-tree.ts')?.code ?? '';
    expect(code).toContain('visibleProductWhere()');
  });

  it('has the search read go through the shared visibility scope and name no flag of its own (S5.4, AC 13)', () => {
    const code =
      sources().find(({ file }) => file === 'src/server/catalogue/search-page.ts')?.code ?? '';
    expect(code).toContain('visibleProductWhere()');
    expect(code).toContain('visibleOfferWhere()');
    expect(code).not.toMatch(/\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_removed|isRemoved)\b/);
    expect(code).not.toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('keeps console output in the search files to the one fixed-code line (S5.4, AC 31)', () => {
    for (const file of ['src/server/catalogue/search-page.ts', 'src/server/catalogue/search-query.ts']) {
      const code = sources().find((entry) => entry.file === file)?.code ?? '';
      expect(code.length).toBeGreaterThan(0);
      const calls = code.match(/console\.\w+\s*\(/g) ?? [];
      expect(calls.length).toBe(file.endsWith('search-page.ts') ? 1 : 0);
      for (const call of calls) expect(call).toBe('console.error(');
    }
    const loader =
      sources().find(({ file }) => file === 'src/server/catalogue/search-page.ts')?.code ?? '';
    expect(loader).toContain('search: failed');
  });

  // Deliberate (issue #110, S4.2): the admin mapping writer joins the importer
  // and the seed as the third and last file group that updates products, and it
  // may set the category and nothing else. The list is closed and named.
  const MAPPER = 'src/server/admin/category-mappings.ts';
  const updatesProducts = /\.update\(\s*products\s*\)/;
  const updatesProductCategoryOnly = /\.update\(\s*products\s*\)\s*\.set\(\s*\{\s*categoryId\s*:\s*[^,}]+\}\s*\)/g;
  const mappingWrite = (code: string): boolean =>
    /\.(insert|update|delete)\(\s*feedCategoryMappings\s*\)/.test(code) ||
    /\b(insert\s+into|update|delete\s+from)\s+"?feed_category_mappings\b/i.test(code);
  const productUpdatesOutsideCategory = (code: string): boolean =>
    (code.match(new RegExp(updatesProducts, 'g')) ?? []).length !==
    (code.match(updatesProductCategoryOnly) ?? []).length;
  const codeOf = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';

  // Deliberate (issue #25, S2.4): the admin hide writer joins the closed list as
  // the fourth file group that updates products, and it may set the hidden flag
  // and nothing else. The mapper rule below it is unchanged.
  const HIDER = 'src/server/admin/products.ts';
  const updatesProductHiddenOnly = /\.update\(\s*products\s*\)\s*\.set\(\s*\{\s*isHidden\s*:\s*[^,}]+\}\s*\)/g;
  const updatesOffers = /\.update\(\s*offers\s*\)/;
  const updatesOfferHiddenOnly = /\.update\(\s*offers\s*\)\s*\.set\(\s*\{\s*isHidden\s*:\s*[^,}]+\}\s*\)/g;
  const countOf = (pattern: RegExp, code: string): number => (code.match(new RegExp(pattern, 'g')) ?? []).length;
  const productUpdatesOutsideHidden = (code: string): boolean =>
    countOf(updatesProducts, code) !== countOf(updatesProductHiddenOnly, code);
  const offerUpdatesOutsideHidden = (code: string): boolean =>
    countOf(updatesOffers, code) !== countOf(updatesOfferHiddenOnly, code);
  const writesOffers = (code: string): boolean =>
    /\.(insert|update|delete)\(\s*offers\s*\)/.test(code) ||
    /\b(insert\s+into|update|delete\s+from)\s+"?offers\b/i.test(code);

  it('updates products only in the importer, the seed, the admin mapping writer and the admin hide writer (S4.2, AC 42; S2.4, AC 53)', () => {
    const found = offenders(
      updatesProducts,
      (file) =>
        file.startsWith('src/server/importer/') ||
        file.startsWith('src/server/seed/') ||
        file === MAPPER ||
        file === HIDER,
    );
    expect(found).toEqual([]);
  });

  it('finds the admin hide writer and sees it update products and offers, so the hide rules are not vacuous (S2.4, AC 53, 54)', () => {
    expect(codeOf(HIDER)).toMatch(updatesProducts);
    expect(codeOf(HIDER)).toMatch(updatesOffers);
  });

  it('lets the admin hide writer set the product hidden flag and no other product column (S2.4, AC 53)', () => {
    expect(productUpdatesOutsideHidden(codeOf(HIDER))).toBe(false);
  });

  it('lets the admin hide writer set the offer hidden flag, with no insert, delete or other offer column (S2.4, AC 54)', () => {
    const code = codeOf(HIDER);
    expect(offerUpdatesOutsideHidden(code)).toBe(false);
    expect(code).not.toMatch(/\.(insert|delete)\(\s*offers\s*\)/);
    expect(code).not.toMatch(/\b(insert\s+into|delete\s+from)\s+"?offers\b/i);
    expect(code).not.toMatch(/\.(insert|update|delete)\(\s*(shops|feeds|networks|clicks|fitments)\s*\)/);
  });

  it('writes offers only in the importer and the admin hide writer (S2.4, AC 54)', () => {
    const found = sources()
      .filter(({ code }) => writesOffers(code))
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual(['src/server/admin/products.ts', 'src/server/importer/index.ts']);
  });

  it('has the admin read go through the shared visibility scope and tests no mapped condition of its own (S2.4, AC 10)', () => {
    const code = codeOf(HIDER);
    expect(code).toContain('visibleProductWhere()');
    expect(code).toContain('visibleOfferWhere()');
    expect(code).not.toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('keeps the hide writer rules able to fail (S2.4, AC 53, 54)', () => {
    // The product writer setting a second column, in either order, or another column alone, is reported.
    expect(productUpdatesOutsideHidden('tx.update(products).set({ isHidden: hidden })')).toBe(false);
    expect(productUpdatesOutsideHidden('tx\n  .update(products)\n  .set({ isHidden: false })')).toBe(false);
    expect(productUpdatesOutsideHidden('tx.update(products).set({ isHidden: x, categoryId: 1 })')).toBe(true);
    expect(productUpdatesOutsideHidden('tx.update(products).set({ categoryId: 1, isHidden: x })')).toBe(true);
    expect(productUpdatesOutsideHidden('tx.update(products).set({ title: x })')).toBe(true);
    // The category mapper's own shape is not the hider's: the two rules do not borrow from each other.
    expect(productUpdatesOutsideHidden('tx.update(products).set({ categoryId: 1 })')).toBe(true);
    expect(productUpdatesOutsideCategory('tx.update(products).set({ isHidden: x })')).toBe(true);
    // The offer writer likewise.
    expect(offerUpdatesOutsideHidden('tx.update(offers).set({ isHidden: hidden })')).toBe(false);
    expect(offerUpdatesOutsideHidden('tx.update(offers).set({ isHidden: x, inReview: false })')).toBe(true);
    expect(offerUpdatesOutsideHidden('tx.update(offers).set({ priceCents: 1 })')).toBe(true);
    // Any form of an offers write is reported, and a read is not.
    expect(writesOffers('await tx.insert(offers).values(row)')).toBe(true);
    expect(writesOffers('await tx.update( offers ).set({})')).toBe(true);
    expect(writesOffers('await tx.delete(offers).where(x)')).toBe(true);
    expect(writesOffers('DELETE FROM "offers" where 1=1')).toBe(true);
    expect(writesOffers('update offers set is_hidden = true')).toBe(true);
    expect(writesOffers('const rows = await tx.select().from(offers)')).toBe(false);
    // A file outside the two writers is reported.
    const found = [
      { file: 'src/server/admin/category-mappings.ts', code: 'await tx.update(offers).set({ isHidden: true })' },
      { file: HIDER, code: 'await tx.update(offers).set({ isHidden: true })' },
    ]
      .filter(({ code }) => writesOffers(code))
      .map(({ file }) => file)
      .filter((file) => ![HIDER, 'src/server/importer/index.ts'].includes(file));
    expect(found).toEqual(['src/server/admin/category-mappings.ts']);
  });

  it('finds the admin mapping writer and sees it update products, so the rule above is not vacuous (S4.2, AC 42)', () => {
    expect(codeOf(MAPPER)).toMatch(updatesProducts);
  });

  it('lets the admin mapping writer set the product category and no other column (S4.2, AC 42)', () => {
    expect(productUpdatesOutsideCategory(codeOf(MAPPER))).toBe(false);
  });

  it('writes feed category mappings only in the seed and the admin mapping writer, which inserts and deletes (S4.2, AC 43)', () => {
    const found = sources()
      .filter(({ code }) => mappingWrite(code))
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual([MAPPER, 'src/server/seed/index.ts'].sort());
    const code = codeOf(MAPPER);
    expect(code).toMatch(/\.insert\(\s*feedCategoryMappings\s*\)/);
    expect(code).toMatch(/\.delete\(\s*feedCategoryMappings\s*\)/);
  });

  it('keeps the product update and mapping write rules able to fail (S4.2, AC 42, 43)', () => {
    // A second file updating products is reported by the closed-list rule.
    expect(updatesProducts.test('await tx.update(products).set({ categoryId: 1 })')).toBe(true);
    const found = [
      { file: 'src/server/admin/sources.ts', code: 'await tx.update( products ).set({ categoryId: 1 })' },
      { file: MAPPER, code: 'await tx.update(products).set({ categoryId: 1 })' },
    ]
      .filter(({ code }) => updatesProducts.test(code))
      .map(({ file }) => file)
      .filter((file) => file !== MAPPER);
    expect(found).toEqual(['src/server/admin/sources.ts']);
    // The writer setting a second column, in either order, is reported.
    expect(productUpdatesOutsideCategory('tx.update(products).set({ categoryId: next })')).toBe(false);
    expect(productUpdatesOutsideCategory('tx.update(products).set({ categoryId: null })')).toBe(false);
    expect(productUpdatesOutsideCategory('tx.update(products).set({ isHidden: true, categoryId: 1 })')).toBe(true);
    expect(productUpdatesOutsideCategory('tx.update(products).set({ categoryId: 1, isHidden: true })')).toBe(true);
    expect(productUpdatesOutsideCategory('tx.update(products).set({ title: x })')).toBe(true);
    // Any form of a mapping write elsewhere is reported.
    expect(mappingWrite('await tx.insert(feedCategoryMappings).values(row)')).toBe(true);
    expect(mappingWrite('await tx.update( feedCategoryMappings ).set({})')).toBe(true);
    expect(mappingWrite('await tx.delete(feedCategoryMappings).where(x)')).toBe(true);
    expect(mappingWrite('DELETE FROM "feed_category_mappings" where 1=1')).toBe(true);
    expect(mappingWrite('insert into feed_category_mappings (a) values (1)')).toBe(true);
    expect(mappingWrite('const rows = await tx.select().from(feedCategoryMappings)')).toBe(false);
  });
});

describe('seams (guardrail 5, S1.1 click log)', () => {
  it('finds the click modules it scans, so the rules below are not vacuous', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/server/clicks/counting.ts',
        'src/server/clicks/record.ts',
        'src/server/clicks/offer-target.ts',
        'src/app/(public)/go/[offer]/route.ts',
      ]),
    );
    const counting = sources().find(({ file }) => file === 'src/server/clicks/counting.ts');
    expect(counting?.code).toMatch(/user-agent/i);
  });

  // The two admin auth files name the column; they never read the header. The
  // allow-list is these exact files, and the next test pins how they use it.
  const USER_AGENT_FILES = new Set([
    'src/server/clicks/counting.ts',
    'src/db/schema/auth.ts',
    'src/server/auth/auth.ts',
  ]);

  it('reads the user agent only in the click counter and the two admin auth files that null it', () => {
    const found = offenders(/user-agent|userAgent/i, (file) => USER_AGENT_FILES.has(file));
    expect(found).toEqual([]);
  });

  it('lets the admin auth files name the user agent only as a null column or a null assignment', () => {
    const code = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
    const mentions = (file: string) =>
      code(file)
        .split(/\r?\n/)
        .filter((line) => /user-agent|userAgent|user_agent/i.test(line))
        .map((line) => line.trim());

    // The hook that nulls it: no header read, no value from the request.
    expect(mentions('src/server/auth/auth.ts')).not.toEqual([]);
    for (const line of mentions('src/server/auth/auth.ts')) {
      expect(line).toMatch(/userAgent:\s*null/);
      expect(line).not.toMatch(/headers?\b|\.get\(/i);
    }
    // The schema: the nullable column and the check that keeps it null.
    expect(mentions('src/db/schema/auth.ts')).not.toEqual([]);
    for (const line of mentions('src/db/schema/auth.ts')) {
      expect(line).toMatch(/userAgent: text\('user_agent'\)|no_ip_or_user_agent|userAgent\} is null/i);
    }
  });

  it('reads no client address header anywhere in src', () => {
    expect(offenders(/x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip/i, () => false)).toEqual([]);
  });

  it('inserts into clicks only in src/server/clicks/record.ts, and never updates or deletes a click', () => {
    expect(offenders(/\.insert\(\s*clicks\s*\)/, (file) => file === 'src/server/clicks/record.ts')).toEqual([]);
    expect(offenders(/\.(update|delete)\(\s*clicks\s*\)/, () => false)).toEqual([]);
    const record = sources().find(({ file }) => file === 'src/server/clicks/record.ts')?.code ?? '';
    expect(record).toMatch(/\.insert\(\s*clicks\s*\)/);
  });

  it('names the shop URL (offers.url) only under src/db/, the importer and offer-target.ts', () => {
    const found = offenders(
      /\boffers\.url\b/,
      (file) =>
        file.startsWith('src/db/') ||
        file.startsWith('src/server/importer/') ||
        file === 'src/server/clicks/offer-target.ts',
    );
    expect(found).toEqual([]);
    const target = sources().find(({ file }) => file === 'src/server/clicks/offer-target.ts')?.code ?? '';
    expect(target).toMatch(/\boffers\.url\b/);
  });

  it('does not import next/link in the offer list (it prefetches in production)', () => {
    const code = sources().find(({ file }) => file === 'src/components/OfferList.tsx')?.code;
    expect(code).toBeDefined();
    expect(code).not.toMatch(/next\/link/);
  });

  it('mentions no cookie in the /go route or the click modules', () => {
    const found = sources()
      .filter(
        ({ file }) => file.startsWith('src/app/(public)/go/') || file.startsWith('src/server/clicks/'),
      )
      .filter(({ code }) => /cookie/i.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });
});

describe('seams (S9.3: demo flag and owner identity)', () => {
  it('names the feed demo flag nowhere under src/app or src/components', () => {
    const found = sources()
      .filter(({ file }) => file.startsWith('src/app/') || file.startsWith('src/components/'))
      .filter(({ code }) => /\b(isDemo|is_demo)\b/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('reads OWNER_* and CONTACT_EMAIL only in src/config/owner.ts', () => {
    const found = offenders(/\b(OWNER_[A-Z]+|CONTACT_EMAIL)\b/, (file) => file === 'src/config/owner.ts');
    expect(found).toEqual([]);
    const owner = sources().find(({ file }) => file === 'src/config/owner.ts')?.code ?? '';
    expect(owner).toMatch(/OWNER_NAME/);
  });

  it('calls getOwnerIdentity only from the two pages that need it', () => {
    const found = sources()
      .filter(({ code }) => /\bgetOwnerIdentity\(/.test(code))
      .map(({ file }) => file)
      .filter((file) => file !== 'src/config/owner.ts')
      .sort();
    expect(found).toEqual(['src/app/(public)/aviso-legal/page.tsx', 'src/app/(public)/privacidad/page.tsx']);
  });
});

describe('seams (guardrails 3 and 5, US-2.1 admin sign-in)', () => {
  const inAuth = (file: string) => file.startsWith('src/server/auth/');

  it('finds the auth modules it scans, so the rules below are not vacuous', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/server/auth/auth.ts',
        'src/server/auth/guard.ts',
        'src/server/auth/actions.ts',
        'src/server/auth/accounts.ts',
      ]),
    );
  });

  it('imports better-auth only under src/server/auth', () => {
    expect(offenders(/['"]better-auth(\/[a-z/-]+)?['"]/, inAuth)).toEqual([]);
  });

  it('mounts no Better Auth HTTP handler and installs no cookie plugin', () => {
    expect(offenders(/\b(toNextJsHandler|nextCookies)\b/, () => false)).toEqual([]);
  });

  it('reads and writes cookies only under src/server/auth', () => {
    expect(offenders(/\bcookies\s*\(|\.cookies\b|set-cookie/i, inAuth)).toEqual([]);
  });

  it('writes the cookie only in the sign-in and sign-out actions', () => {
    const found = sources()
      .filter(({ file }) => inAuth(file))
      .filter(({ code }) => /\bstore\.set\(|\bcookies\(\)\.set\(|\.set\(\s*name\b/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual(['src/server/auth/actions.ts']);
  });

  it('keeps the admin UI free of the database and the auth library', () => {
    const found = sources()
      .filter(({ file }) => file.startsWith('src/app/admin/') || file.startsWith('src/components/admin/'))
      .filter(({ code }) => /['"]@\/db|\/db\/|better-auth/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('links to the admin area from nowhere outside the admin code (AC 26)', () => {
    const found = offenders(
      /['"`]\/admin\b/,
      (file) =>
        file.startsWith('src/app/admin/') ||
        file.startsWith('src/components/admin/') ||
        inAuth(file) ||
        // Deliberate (issue #25, S2.4): the pure href builders of the admin product
        // list and page (04-design.md § Contract); no other server file may name an admin path.
        file === 'src/server/admin/product-rules.ts',
    );
    expect(found).toEqual([]);
  });

  // Every file that builds a sitemap or robots response: the metadata files
  // (sitemap.ts, robots.ts), the route handlers (sitemap.xml/route.ts,
  // sitemaps/[file]/route.ts) and the catalogue sitemap modules (S6.2).
  const isSitemapOrRobotsFile = (file: string): boolean =>
    /^src\/app\/.*\/(sitemap|robots)[^/]*(\/|\.[a-z]+$)/.test(file) ||
    /^src\/app\/(sitemap|robots)[^/]*(\/|\.[a-z]+$)/.test(file) ||
    /^src\/app\/.*\/sitemaps\//.test(file) ||
    /^src\/server\/catalogue\/sitemap[^/]*\.ts$/.test(file);

  it('scans the sitemap and robots files, route handlers included (AC 23, not vacuous)', () => {
    const files = sources()
      .map(({ file }) => file)
      .filter(isSitemapOrRobotsFile);
    expect(files.length).toBeGreaterThanOrEqual(5);
    expect(files).toEqual(
      expect.arrayContaining([
        'src/app/robots.ts',
        'src/app/(public)/sitemap.xml/route.ts',
        'src/app/(public)/sitemaps/[file]/route.ts',
        'src/server/catalogue/sitemap.ts',
        'src/server/catalogue/sitemap-xml.ts',
      ]),
    );
  });

  it('lists no admin URL in a sitemap or robots file (AC 23)', () => {
    const found = sources()
      .filter(({ file }) => isSitemapOrRobotsFile(file))
      .filter(({ code }) => /admin/i.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('builds the sitemap set from the visibility scope and the non-demo condition (S6.2)', () => {
    const code =
      sources().find(({ file }) => file === 'src/server/catalogue/sitemap.ts')?.code ?? '';
    expect(code).toContain('visibleProductWhere()');
    expect(code).toContain('indexableProductWhere()');
  });

  it('keeps the sitemap routes off the database layer and the visibility flags (S6.2)', () => {
    const found = sources()
      .filter(({ file }) => /^src\/app\/.*\/(sitemap\.xml|sitemaps)\/.*route\.ts$/.test(file))
      .filter(({ code }) => /['"]@\/db|\/db\/|\bis(Hidden|Approved)\b|\binReview\b/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  // S12.2 (S-10): the local-flag module also judges SITE_URL, for the loopback rule.
  it('reads AUTH_SECRET and SITE_URL only in src/config/auth.ts and src/config/local-flag.ts', () => {
    const found = offenders(
      /\b(AUTH_SECRET|SITE_URL)\b/,
      (file) => file === 'src/config/auth.ts' || file === 'src/config/local-flag.ts',
    );
    expect(found).toEqual([]);
  });

  it('keeps the AUTH_SECRET and SITE_URL rule able to fail (S-10)', () => {
    const settings = /\b(AUTH_SECRET|SITE_URL)\b/;
    const allowed = (file: string) => file === 'src/config/auth.ts' || file === 'src/config/local-flag.ts';
    for (const file of ['src/config/auth.ts', 'src/config/local-flag.ts']) {
      expect(sources().find((entry) => entry.file === file)?.code ?? '', file).toMatch(settings);
    }
    const found = [
      { file: 'src/server/visibility.ts', code: 'process.env.SITE_URL' },
      { file: 'src/instrumentation-node.ts', code: "process.env['AUTH_SECRET']" },
      { file: 'src/config/local-flag.ts', code: 'env.SITE_URL' },
    ]
      .filter(({ file, code }) => settings.test(code) && !allowed(file))
      .map(({ file }) => file);
    expect(found).toEqual(['src/server/visibility.ts', 'src/instrumentation-node.ts']);
  });

  // Deliberate (issue #26, S3.1): the writer of networks, shops and feeds is one
  // admin file next to the seed, the feed address is named in that writer and in
  // one masking function, and nothing deletes the three tables (D-7). Each rule
  // is a named predicate, proved below on inline offenders, so it can fail.
  // S3.7 settles the same list: a catalogue-file feed is created and edited by
  // the two shipped writers in sources.ts, so [WRITER, SEED] does not grow, and
  // the file name, which lives in `feeds.url`, is confined by the rules below.
  const WRITER = 'src/server/admin/sources.ts';
  const MASK = 'src/server/admin/feed-host.ts';
  const SEED = 'src/server/seed/index.ts';

  const writesSourceTable = (code: string): boolean =>
    /\.(insert|update)\(\s*(shops|feeds|networks)\s*\)/.test(code) ||
    /\b(insert\s+into|update)\s+"?(shops|feeds|networks)"?\s/i.test(code);
  const deletesSourceTable = (code: string): boolean =>
    /\.delete\(\s*(shops|feeds|networks)\s*\)/.test(code) ||
    /\bdelete\s+from\s+"?(shops|feeds|networks)\b/i.test(code);
  const namesFeedUrl = (code: string): boolean => /(feeds|offers)\.url|\burl\s*:/.test(code);
  const namesFeedColumn = (code: string): boolean => /\bfeeds\.url\b/.test(code);
  const isClientFile = (code: string): boolean => /^\s*['"]use client['"]/.test(code);
  const clientNamesUrl = (code: string): boolean =>
    isClientFile(code) && /(feeds|offers)\.url|\burl\s*:|\.url\b/.test(code);

  // Deliberate (issue #25, S2.4): the product screens and their actions are in this
  // scope too, so an offer address cannot reach the admin product code. Tightening only.
  const inAdminUrlScope = (file: string): boolean =>
    file.startsWith('src/server/admin/') ||
    file.startsWith('src/app/admin/(shell)/tiendas/') ||
    file.startsWith('src/app/admin/(shell)/productos/');

  it('writes networks, shops and feeds only in the admin writer and the seed, and the writer writes all three (S3.1, AC 30)', () => {
    const found = sources()
      .filter(({ code }) => writesSourceTable(code))
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual([WRITER, SEED]);
    const code = sources().find(({ file }) => file === WRITER)?.code ?? '';
    for (const table of ['networks', 'shops', 'feeds']) {
      expect(code).toMatch(new RegExp(`\\.insert\\(\\s*${table}\\s*\\)`));
      expect(code).toMatch(new RegExp(`\\.update\\(\\s*${table}\\s*\\)`));
    }
  });

  it('keeps the source-table write rule able to fail (S3.1, AC 30)', () => {
    expect(writesSourceTable('await db.insert(shops).values(row)')).toBe(true);
    expect(writesSourceTable('await tx.update( feeds ).set({})')).toBe(true);
    expect(writesSourceTable('await db.insert(networks).values(row)')).toBe(true);
    expect(writesSourceTable('INSERT INTO "shops" (a) values (1)')).toBe(true);
    expect(writesSourceTable('update feeds set is_approved = true')).toBe(true);
    expect(writesSourceTable('await db.update(products).set({})')).toBe(false);
    const found = [
      { file: 'src/app/admin/(shell)/tiendas/x.ts', code: 'db.insert(feeds).values(r)' },
      { file: WRITER, code: 'db.insert(feeds).values(r)' },
    ]
      .filter(({ code }) => writesSourceTable(code))
      .map(({ file }) => file)
      .filter((file) => ![WRITER, SEED].includes(file));
    expect(found).toEqual(['src/app/admin/(shell)/tiendas/x.ts']);
  });

  it('names a feed or offer address only in the admin writer and the masking function under the admin code (S3.1, AC 31)', () => {
    const files = sources().filter(({ file }) => inAdminUrlScope(file));
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining([
        WRITER,
        MASK,
        'src/app/admin/(shell)/tiendas/actions.ts',
        'src/server/admin/products.ts',
        'src/app/admin/(shell)/productos/actions.ts',
      ]),
    );
    const found = files
      .filter(({ code }) => namesFeedUrl(code))
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual([MASK, WRITER].sort());
  });

  it('makes the masking function the one export of its file (S3.1, AC 31)', () => {
    const code = sources().find(({ file }) => file === MASK)?.code ?? '';
    expect(code).toMatch(/export\s+function\s+feedHost\s*\(/);
    const exported = [
      ...code.matchAll(/\bexport\s+(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+(\w+)/g),
    ].map((match) => match[1]);
    expect(exported).toEqual(['feedHost']);
    expect(code).not.toMatch(/\bexport\s*(\{|default\b|\*)/);
  });

  it('reads feeds.url only in the schema, the importer, the seed and the admin writer (S3.1)', () => {
    const found = offenders(
      /\bfeeds\.url\b/,
      (file) =>
        file.startsWith('src/db/schema/') ||
        file.startsWith('src/server/importer/') ||
        file.startsWith('src/server/seed/') ||
        file === WRITER,
    );
    expect(found).toEqual([]);
    const code = sources().find(({ file }) => file === WRITER)?.code ?? '';
    expect(code).toMatch(/\bfeeds\.url\b/);
  });

  it('names no feed address in a client component (S3.1, AC 25, 31)', () => {
    const found = sources()
      .filter(({ code }) => clientNamesUrl(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('keeps the feed address rules able to fail (S3.1, AC 31)', () => {
    // A third admin file naming the address is reported by the name predicate.
    expect(namesFeedUrl('const row = { url: stored };')).toBe(true);
    expect(namesFeedUrl('const column = feeds.url;')).toBe(true);
    expect(namesFeedUrl('const column = offers.url;')).toBe(true);
    expect(namesFeedUrl('const host = feedHost(row.stored);')).toBe(false);
    const adminOffender = [
      { file: 'src/app/admin/(shell)/tiendas/page.tsx', code: 'const view = { url: feed.url };' },
      { file: WRITER, code: 'select({ stored: feeds.url })' },
    ]
      .filter(({ code }) => namesFeedUrl(code))
      .map(({ file }) => file)
      .filter((file) => ![WRITER, MASK].includes(file));
    expect(adminOffender).toEqual(['src/app/admin/(shell)/tiendas/page.tsx']);
    // The column rule reports a file outside its list.
    expect(namesFeedColumn('db.select({ u: feeds.url })')).toBe(true);
    expect(namesFeedColumn('db.select({ u: offers.url })')).toBe(false);
    // A client file that names the address in any form is reported; a server file is not.
    expect(clientNamesUrl("'use client';\nconst p = { url: props.url };")).toBe(true);
    expect(clientNamesUrl("'use client';\nconst u = feed.url;")).toBe(true);
    expect(clientNamesUrl('"use client"\nconst p = { url: x };')).toBe(true);
    expect(clientNamesUrl("'use client';\nconst p = { host: props.host };")).toBe(false);
    expect(clientNamesUrl('const p = { url: x };')).toBe(false);
  });

  it('deletes from the shops, feeds and networks tables nowhere in src, with no allow-list (S3.1, AC 32, D-7)', () => {
    const found = sources()
      .filter(({ code }) => deletesSourceTable(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('keeps the delete rule able to fail (S3.1, AC 32)', () => {
    expect(deletesSourceTable('await db.delete(shops).where(x)')).toBe(true);
    expect(deletesSourceTable('await tx.delete( feeds )')).toBe(true);
    expect(deletesSourceTable('await db.delete(networks)')).toBe(true);
    expect(deletesSourceTable('DELETE FROM "feeds" where 1=1')).toBe(true);
    expect(deletesSourceTable('delete from networks')).toBe(true);
    expect(deletesSourceTable('await db.delete(fitments).where(x)')).toBe(false);
    const found = [{ file: WRITER, code: 'await db.delete(shops).where(x)' }]
      .filter(({ code }) => deletesSourceTable(code))
      .map(({ file }) => file);
    expect(found).toEqual([WRITER]);
  });

  // S3.7, AC 37: the file name of a catalogue-file feed is shown only through
  // `displayableFileName` (the admin writer's reads) and checked at import only
  // through `isCatalogueFileName` (the importer's reader); no page, action or
  // client component decides for itself what a stored value may show.
  const FILE_NAME_MODULE = 'src/server/catalogue-file-name.ts';
  const IMPORT_READER = 'src/server/importer/source.ts';
  const callsDisplayable = (code: string): boolean => /\bdisplayableFileName\b/.test(code);
  const callsIsName = (code: string): boolean => /\bisCatalogueFileName\b/.test(code);

  it('shows a stored file name only through displayableFileName, called in the admin writer alone (S3.7, AC 37)', () => {
    const found = sources()
      .filter(({ code }) => callsDisplayable(code))
      .map(({ file }) => file)
      .sort();
    expect(found).toEqual([FILE_NAME_MODULE, WRITER].sort());
    expect(offenders(/\bdisplayableFileName\b/, (file) => file === WRITER || file === FILE_NAME_MODULE)).toEqual([]);
  });

  it('checks a stored file name with isCatalogueFileName only in the importer reader, the admin writer and its own module (S3.7, AC 37)', () => {
    const found = sources()
      .filter(({ code }) => callsIsName(code))
      .map(({ file }) => file);
    expect(found).toEqual(expect.arrayContaining([FILE_NAME_MODULE, IMPORT_READER]));
    expect(
      offenders(/\bisCatalogueFileName\b/, (file) => [WRITER, IMPORT_READER, FILE_NAME_MODULE].includes(file)),
    ).toEqual([]);
  });

  it('keeps the file-name rules able to fail (S3.7, AC 37)', () => {
    expect(callsDisplayable('const name = displayableFileName(row.stored);')).toBe(true);
    expect(callsIsName('if (!isCatalogueFileName(feed.url)) throw new SourceError();')).toBe(true);
    expect(callsDisplayable('const host = feedHost(row.stored);')).toBe(false);
    expect(callsIsName('checkCatalogueFileName(raw)')).toBe(false);
    const displayOffender = [
      { file: 'src/app/admin/(shell)/tiendas/page.tsx', code: 'displayableFileName(feed.stored)' },
      { file: WRITER, code: 'displayableFileName(row.stored)' },
    ]
      .filter(({ code }) => callsDisplayable(code))
      .map(({ file }) => file)
      .filter((file) => ![WRITER, FILE_NAME_MODULE].includes(file));
    expect(displayOffender).toEqual(['src/app/admin/(shell)/tiendas/page.tsx']);
    const checkOffender = [
      { file: 'src/server/catalogue/product-page.ts', code: 'isCatalogueFileName(x)' },
      { file: IMPORT_READER, code: 'isCatalogueFileName(feed.url)' },
    ]
      .filter(({ code }) => callsIsName(code))
      .map(({ file }) => file)
      .filter((file) => ![WRITER, IMPORT_READER, FILE_NAME_MODULE].includes(file));
    expect(checkOffender).toEqual(['src/server/catalogue/product-page.ts']);
  });

  it('keeps the admin writer from importing the importer, so registering a file feed reads no file (S3.7, AC 9)', () => {
    const code = sources().find(({ file }) => file === WRITER)?.code ?? '';
    expect(code).not.toMatch(/from\s+['"][^'"]*importer[^'"]*['"]/);
    expect(code).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/);
    expect('import { readFeedSource } from "../importer/source";').toMatch(/from\s+['"][^'"]*importer[^'"]*['"]/);
  });

  it('writes admin accounts only in src/server/auth/accounts.ts', () => {
    const found = offenders(
      /\.(insert|update|delete)\(\s*admin(Users|Accounts)\s*\)/,
      (file) => file === 'src/server/auth/accounts.ts',
    );
    expect(found).toEqual([]);
  });
});

describe('seams (guardrail 1, S5.5 vehicle fitment)', () => {
  const codeOf = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
  const FIT_STATE = 'src/server/catalogue/fit-state.ts';

  it('finds the fitment modules it scans, so the rules below are not vacuous', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(
      expect.arrayContaining([FIT_STATE, 'src/server/visibility.ts', 'src/db/vehicle-catalogue.ts']),
    );
  });

  it('decides which fitments count in the visibility scope, from the feed, the shop and the vehicle (AC 27)', () => {
    const code = codeOf('src/server/visibility.ts');
    const body = code.match(/function\s+countedFitmentWhere\s*\([^)]*\)[^{]*\{([\s\S]*?)\r?\n\}/)?.[1] ?? '';
    expect(body).toMatch(/feeds\.isApproved/);
    expect(body).toMatch(/shops\.isApproved/);
    expect(body).toContain('activeVehicleWhere()');
    expect(code).toMatch(/function\s+activeVehicleWhere/);
  });

  it('has the fit-state read go through the shared fitment condition and name no flag of its own (AC 27)', () => {
    const code = codeOf(FIT_STATE);
    expect(code.length).toBeGreaterThan(0);
    expect(code).toContain('countedFitmentWhere()');
    expect(code).toContain('activeVehicleWhere()');
    expect(code).not.toMatch(/\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_removed|isRemoved|is_retired|isRetired)\b/);
    expect(code).not.toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('names the fitment condition only in the visibility scope and the fit-state read, and the vehicle filter also in the vehicle list (D-1)', () => {
    const VEHICLES = 'src/server/car/vehicles.ts';
    const inScope = (file: string) => file === 'src/server/visibility.ts' || file === FIT_STATE;
    expect(offenders(/\bcountedFitmentWhere\b/, inScope)).toEqual([]);
    expect(offenders(/\bactiveVehicleWhere\b/, (file) => inScope(file) || file === VEHICLES)).toEqual([]);
  });

  it('keeps the fitment naming rules non-vacuous: the allowed files match and the patterns catch a violation (D-1)', () => {
    const counted = /\bcountedFitmentWhere\b/;
    const active = /\bactiveVehicleWhere\b/;
    const visibility = codeOf('src/server/visibility.ts');
    expect(visibility).toMatch(counted);
    expect(visibility).toMatch(active);
    const vehicles = codeOf('src/server/car/vehicles.ts');
    expect(vehicles).toMatch(active);
    expect(vehicles).not.toMatch(counted);
    expect(counted.test('.where(countedFitmentWhere())')).toBe(true);
    expect(active.test('.where(activeVehicleWhere())')).toBe(true);
    // A file outside the allowed set is reported.
    const found = [{ file: 'src/app/x.ts', code: 'and(activeVehicleWhere(), countedFitmentWhere())' }]
      .filter(({ code }) => active.test(code) || counted.test(code))
      .map(({ file }) => file);
    expect(found).toEqual(['src/app/x.ts']);
    // The flag-word rule is a word match, not a literal "b...b".
    const flags = /\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_retired|isRetired)\b/;
    expect(flags.test('where(eq(feeds.isApproved, true))')).toBe(true);
    expect(flags.test('where(notAnisApprovedX)')).toBe(false);
  });

  it('writes nothing and logs nothing in the fit-state read (AC 28, guardrail 5)', () => {
    const code = codeOf(FIT_STATE);
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/console\.\w+\s*\(/);
    expect(code).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it('writes fitments only in the importer\'s fitments.ts: no admin action, route, seed or script (S5.6, AC 20, guardrail 2)', () => {
    const WRITER = 'src/server/importer/fitments.ts';
    expect(offenders(/\.(insert|delete)\(\s*fitments\s*\)/, (file) => file === WRITER)).toEqual([]);
    expect(offenders(/\.update\(\s*fitments\s*\)/, () => false)).toEqual([]);
    // Raw SQL, which the query builder rule above cannot see.
    expect(offenders(/\b(insert\s+into|delete\s+from|update)\s+"?fitments\b/i, () => false)).toEqual([]);
    expect(offenders(/\.execute\(\s*sql`[^`]*\bfitments\b/i, () => false)).toEqual([]);
  });

  it('keeps the fitment write rule non-vacuous: the writer matches both patterns and the patterns catch a violation (S5.6, AC 20)', () => {
    const writer = codeOf('src/server/importer/fitments.ts');
    expect(writer).toMatch(/\.insert\(\s*fitments\s*\)/);
    expect(writer).toMatch(/\.delete\(\s*fitments\s*\)/);
    expect(writer).not.toMatch(/console\.\w+\s*\(/);
    const write = /\.(insert|delete)\(\s*fitments\s*\)/;
    const update = /\.update\(\s*fitments\s*\)/;
    const raw = /\b(insert\s+into|delete\s+from|update)\s+"?fitments\b/i;
    expect(write.test('await db.insert(fitments).values(rows)')).toBe(true);
    expect(write.test('await tx.delete( fitments ).where(x)')).toBe(true);
    expect(update.test('await db.update(fitments).set({})')).toBe(true);
    expect(raw.test('delete from fitments where 1=1')).toBe(true);
    expect(raw.test('INSERT INTO "fitments" (a) values (1)')).toBe(true);
    // A file outside the writer would be reported.
    const found = [{ file: 'src/app/admin/x.ts', code: 'db.insert(fitments).values(r)' }]
      .filter(({ code }) => write.test(code))
      .map(({ file }) => file);
    expect(found).toEqual(['src/app/admin/x.ts']);
  });

  it('keeps the vehicle list free of the server-only marker and the client, so the CLI can run it', () => {
    const code = codeOf('src/db/vehicle-catalogue.ts');
    expect(code).not.toMatch(/server-only/);
    expect(code).not.toMatch(/\.(delete)\(/);
  });
});

// S3.7 (catalogue file source). The folder a catalogue-file feed reads is named
// in one place, so no second reader can be pointed at it, and the file-name rule
// stays pure so the admin and the importer share it without a disk read.
describe('seams (guardrail 2, S3.7 catalogue folder)', () => {
  const FOLDER = /catalogue-files/;

  it('names the catalogue folder in src/ only in src/server/importer/source.ts', () => {
    expect(offenders(FOLDER, (file) => file === 'src/server/importer/source.ts')).toEqual([]);
  });

  it('finds the folder name in source.ts, so the rule above is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/importer/source.ts')?.code ?? '';
    expect(code).toMatch(FOLDER);
  });

  it('would flag a second file that names the folder', () => {
    const planted = [{ file: 'src/server/other.ts', code: "const dir = 'catalogue-files';" }];
    const found = planted.filter(({ code }) => FOLDER.test(code)).map(({ file }) => file);
    expect(found).toEqual(['src/server/other.ts']);
  });

  it('keeps the file-name rule in src/server/catalogue-file-name.ts free of node:fs and server-only', () => {
    const code = sources().find(({ file }) => file === 'src/server/catalogue-file-name.ts')?.code;
    expect(code).toBeDefined();
    expect(code).not.toMatch(/from\s+['"](node:)?fs(\/promises)?['"]/);
    expect(code).not.toMatch(/server-only/);
    expect(code).toMatch(/export function checkCatalogueFileName/);
  });
});

// S12.2 (T-12.2.1, AC 47): the collected source kind, its folder and the product
// marker are each named in the modules the design lists and nowhere else, and no
// update of a feed ever writes its kind. Each rule is a named pattern and
// allow-list, proved non-vacuous on the real tree and able to fail on a planted
// offender. Lane B adds the flag and the marked-helper rules beside these.
describe('seams (guardrails 1 and 2, S12.2 collected source and marker)', () => {
  const codeOf = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
  const planted = (
    files: { file: string; code: string }[],
    test: (code: string) => boolean,
    allowed: (file: string) => boolean,
  ): string[] => files.filter(({ file, code }) => test(code) && !allowed(file)).map(({ file }) => file);

  const SOURCE_READER = 'src/server/importer/source.ts';
  const IMPORTER = 'src/server/importer/index.ts';
  const ADMIN_WRITER = 'src/server/admin/sources.ts';

  // S-4: the product marker column, by its SQL or its TypeScript name.
  const productMarker = /\bis_collected\b|\.isCollected\b/;
  const mayNameProductMarker = (file: string): boolean =>
    file.startsWith('src/db/') ||
    [IMPORTER, 'src/server/matching.ts', 'src/server/visibility.ts'].includes(file);

  it('names the product marker only in the schema, the importer, the matcher and the visibility scope (S-4)', () => {
    expect(offenders(productMarker, mayNameProductMarker)).toEqual([]);
    expect(codeOf('src/db/schema/catalogue.ts')).toMatch(productMarker);
  });

  it('keeps the product marker rule able to fail (S-4)', () => {
    expect(productMarker.test('where(eq(products.isCollected, false))')).toBe(true);
    expect(productMarker.test('sql`p.is_collected = true`')).toBe(true);
    expect(productMarker.test('const isCollectedFeed = true')).toBe(false);
    const found = planted(
      [
        { file: 'src/server/catalogue/product-page.ts', code: 'and(eq(products.isCollected, false))' },
        { file: 'src/app/admin/(shell)/productos/page.tsx', code: 'sql`is_collected`' },
        { file: 'src/server/visibility.ts', code: 'eq(products.isCollected, true)' },
      ],
      (code) => productMarker.test(code),
      mayNameProductMarker,
    );
    expect(found).toEqual(['src/server/catalogue/product-page.ts', 'src/app/admin/(shell)/productos/page.tsx']);
  });

  // S-5: a write of the product marker (an object key), only at product creation.
  const writesProductMarker = /\bisCollected\s*:/;
  const mayWriteProductMarker = (file: string): boolean => file.startsWith('src/db/') || file === IMPORTER;

  it('writes the product marker only in the schema and the importer, once, at product creation (S-5)', () => {
    expect(offenders(writesProductMarker, mayWriteProductMarker)).toEqual([]);
    const importer = codeOf(IMPORTER);
    expect(importer.match(new RegExp(writesProductMarker.source, 'g')) ?? []).toHaveLength(1);
    const create = importer.match(/async function createProduct\([\s\S]*?\r?\n\}/)?.[0] ?? '';
    expect(create).toMatch(/\.insert\(\s*products\s*\)/);
    expect(create).toMatch(writesProductMarker);
  });

  it('keeps the product marker write rule able to fail (S-5)', () => {
    expect(writesProductMarker.test('.values({ isCollected: markedRow })')).toBe(true);
    expect(writesProductMarker.test('.set({ isCollected : true })')).toBe(true);
    expect(writesProductMarker.test('eq(products.isCollected, true)')).toBe(false);
    const found = planted(
      [
        { file: 'src/server/admin/products.ts', code: 'tx.update(products).set({ isCollected: false })' },
        { file: IMPORTER, code: '.values({ isCollected: markedRow })' },
      ],
      (code) => writesProductMarker.test(code),
      mayWriteProductMarker,
    );
    expect(found).toEqual(['src/server/admin/products.ts']);
  });

  // S-6: the collected source value. Never in the public catalogue reads, the click
  // modules, the public routes or the proxy: they see marked rows only through the
  // visibility scope.
  const collectedSource = /collected_file/;
  const mayNameCollectedSource = (file: string): boolean =>
    file.startsWith('src/db/') ||
    [SOURCE_READER, 'src/server/importer/types.ts', IMPORTER, 'src/server/visibility.ts', ADMIN_WRITER].includes(
      file,
    ) ||
    file.startsWith('src/app/admin/(shell)/tiendas/') ||
    file.startsWith('src/app/admin/(shell)/categorias/') ||
    file.startsWith('src/components/admin/');

  it('names the collected source value only where the design lists it (S-6)', () => {
    expect(offenders(collectedSource, mayNameCollectedSource)).toEqual([]);
    for (const file of ['src/db/schema/sources.ts', SOURCE_READER, IMPORTER, ADMIN_WRITER]) {
      expect(codeOf(file), file).toMatch(collectedSource);
    }
  });

  it('keeps the collected source rule able to fail, in the catalogue, clicks, public routes and proxy (S-6)', () => {
    expect(collectedSource.test("eq(feeds.sourceType, 'collected_file')")).toBe(true);
    expect(collectedSource.test("'catalogue_file'")).toBe(false);
    const found = planted(
      [
        { file: 'src/server/catalogue/product-page.ts', code: "feeds.sourceType <> 'collected_file'" },
        { file: 'src/server/clicks/offer-target.ts', code: "'collected_file'" },
        { file: 'src/app/(public)/producto/[slug]/page.tsx', code: "'collected_file'" },
        { file: 'src/proxy.ts', code: "'collected_file'" },
        { file: 'src/server/admin/category-mappings.ts', code: "'collected_file'" },
        { file: ADMIN_WRITER, code: "'collected_file'" },
        { file: 'src/components/admin/FeedForm.tsx', code: "'collected_file'" },
      ],
      (code) => collectedSource.test(code),
      mayNameCollectedSource,
    );
    expect(found).toEqual([
      'src/server/catalogue/product-page.ts',
      'src/server/clicks/offer-target.ts',
      'src/app/(public)/producto/[slug]/page.tsx',
      'src/proxy.ts',
      'src/server/admin/category-mappings.ts',
    ]);
  });

  // S-9: the collected folder, named by the one reader alone (as the catalogue folder is).
  const collectedFolder = /collected-files/;

  it('names the collected folder in src/ only in src/server/importer/source.ts (S-9)', () => {
    expect(offenders(collectedFolder, (file) => file === SOURCE_READER)).toEqual([]);
    expect(codeOf(SOURCE_READER)).toMatch(collectedFolder);
  });

  it('keeps the collected folder rule able to fail (S-9)', () => {
    expect(collectedFolder.test("path.resolve(process.cwd(), 'collected-files')")).toBe(true);
    expect(collectedFolder.test("'catalogue-files'")).toBe(false);
    const found = planted(
      [
        { file: IMPORTER, code: "const dir = 'collected-files';" },
        { file: SOURCE_READER, code: "const COLLECTED_FOLDER = 'collected-files';" },
      ],
      (code) => collectedFolder.test(code),
      (file) => file === SOURCE_READER,
    );
    expect(found).toEqual([IMPORTER]);
  });

  // S-11: a feed's kind is set by its insert and never by an update (AC 5). Each
  // `.update(feeds)` statement, up to its `;`, and each raw `update feeds set`,
  // must not name the source column. No file is allowed.
  const feedUpdates = (code: string): string[] => [
    ...[...code.matchAll(/\.update\(\s*feeds\s*\)[^;]*/g)].map((match) => match[0]),
    ...[...code.matchAll(/\bupdate\s+"?feeds"?\s+set\b[^;]*/gi)].map((match) => match[0]),
  ];
  const updatesFeedSource = (code: string): boolean =>
    feedUpdates(code).some((statement) => /\bsource(Type|_type)\b/.test(statement));

  it('never writes a feed source kind in an update, anywhere in src (S-11, AC 5)', () => {
    expect(sources().filter(({ code }) => updatesFeedSource(code)).map(({ file }) => file)).toEqual([]);
    // Not vacuous: the admin writer's feed updates are found and scanned.
    expect(feedUpdates(codeOf(ADMIN_WRITER)).length).toBeGreaterThanOrEqual(3);
  });

  it('keeps the feed source update rule able to fail (S-11)', () => {
    expect(updatesFeedSource("await tx.update(feeds).set({ sourceType: 'collected_file' }).where(x);")).toBe(true);
    expect(
      updatesFeedSource('await tx\n  .update(feeds)\n  .set(next ? { url, sourceType: kind } : { url })\n  .where(x);'),
    ).toBe(true);
    expect(updatesFeedSource("await db.execute(sql`UPDATE \"feeds\" SET source_type = 'shop_upload'`);")).toBe(true);
    expect(
      updatesFeedSource('await tx.update(feeds).set({ url: name.value, isApproved: false }).where(eq(feeds.id, id));'),
    ).toBe(false);
    expect(updatesFeedSource('await tx.insert(feeds).values({ sourceType: kind });')).toBe(false);
    // A source select after an unrelated update statement is not a write.
    expect(
      updatesFeedSource('await tx.update(feeds).set({ isApproved: false });\nselect({ source: feeds.sourceType })'),
    ).toBe(false);
    const found = planted(
      [
        { file: ADMIN_WRITER, code: "tx.update(feeds).set({ sourceType: 'catalogue_file' }).where(x);" },
        { file: 'src/server/seed/index.ts', code: 'tx.update(feeds).set({ isApproved: true });' },
      ],
      updatesFeedSource,
      () => false,
    );
    expect(found).toEqual([ADMIN_WRITER]);
  });
});

// S12.2 (T-12.2.2, T-12.2.3, AC 47): the local flag is read from the environment
// in one pure module, imported only by the visibility scope and the two start
// checks; whether marked rows are shown is named only in that module and the
// scope; and the two marked-row helpers are named only in the scope and the
// three readers the design lists (indexability, the /go lookup, the mapping
// writer). Each rule is proved non-vacuous on the real tree and able to fail on
// a planted offender.
describe('seams (guardrails 1 and 2, S12.2 local flag and the one marked-row rule)', () => {
  const codeOf = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
  const planted = (
    files: { file: string; code: string }[],
    test: (code: string) => boolean,
    allowed: (file: string) => boolean,
  ): string[] => files.filter(({ file, code }) => test(code) && !allowed(file)).map(({ file }) => file);

  const FLAG_MODULE = 'src/config/local-flag.ts';
  const VISIBILITY = 'src/server/visibility.ts';
  const INSTRUMENTATION_NODE = 'src/instrumentation-node.ts';
  const START_CHECK = 'src/cli/start-check.ts';

  // S-1: the flag's variable name.
  const flagVariable = /\bLOCAL_COLLECTED_DATA\b/;

  it('names LOCAL_COLLECTED_DATA in src/ only in src/config/local-flag.ts (S-1)', () => {
    expect(offenders(flagVariable, (file) => file === FLAG_MODULE)).toEqual([]);
    expect(codeOf(FLAG_MODULE)).toMatch(flagVariable);
  });

  it('keeps the flag variable rule able to fail (S-1)', () => {
    expect(flagVariable.test("process.env.LOCAL_COLLECTED_DATA === 'true'")).toBe(true);
    expect(flagVariable.test('LOCAL_COLLECTED_DATA_X')).toBe(false);
    const found = planted(
      [
        { file: VISIBILITY, code: 'process.env.LOCAL_COLLECTED_DATA' },
        { file: 'src/server/catalogue/product-page.ts', code: "env['LOCAL_COLLECTED_DATA']" },
        { file: FLAG_MODULE, code: 'env.LOCAL_COLLECTED_DATA' },
      ],
      (code) => flagVariable.test(code),
      (file) => file === FLAG_MODULE,
    );
    expect(found).toEqual([VISIBILITY, 'src/server/catalogue/product-page.ts']);
  });

  // S-2: an import of the flag module, by any relative or alias path.
  const importsFlagModule = /from\s+['"][^'"]*config\/local-flag['"]|import\(\s*['"][^'"]*config\/local-flag['"]\s*\)/;
  const mayImportFlagModule = (file: string): boolean =>
    [VISIBILITY, INSTRUMENTATION_NODE, START_CHECK].includes(file);

  it('imports src/config/local-flag only in the visibility scope and the two start checks (S-2)', () => {
    expect(offenders(importsFlagModule, mayImportFlagModule)).toEqual([]);
    for (const file of [VISIBILITY, INSTRUMENTATION_NODE, START_CHECK]) {
      expect(codeOf(file), file).toMatch(importsFlagModule);
    }
  });

  it('keeps the flag import rule able to fail (S-2)', () => {
    expect(importsFlagModule.test("import { collectedRowsShown } from '../config/local-flag';")).toBe(true);
    expect(importsFlagModule.test("import { x } from '@/config/local-flag';")).toBe(true);
    expect(importsFlagModule.test("const m = await import('../../config/local-flag');")).toBe(true);
    expect(importsFlagModule.test("import { getSiteUrl } from '../config/auth';")).toBe(false);
    const found = planted(
      [
        { file: 'src/server/catalogue/search-page.ts', code: "import { isLocalFlagOn } from '../../config/local-flag';" },
        { file: 'src/app/(public)/page.tsx', code: "import { collectedRowsShown } from '@/config/local-flag';" },
        { file: START_CHECK, code: "import { localFlagRefusal } from '../config/local-flag';" },
      ],
      (code) => importsFlagModule.test(code),
      mayImportFlagModule,
    );
    expect(found).toEqual(['src/server/catalogue/search-page.ts', 'src/app/(public)/page.tsx']);
  });

  // S-3: whether marked rows are shown is asked only by the one scope.
  const shownCall = /\bcollectedRowsShown\b/;
  const mayAskShown = (file: string): boolean => file === FLAG_MODULE || file === VISIBILITY;

  it('names collectedRowsShown only in the flag module and the visibility scope (S-3)', () => {
    expect(offenders(shownCall, mayAskShown)).toEqual([]);
    expect(codeOf(FLAG_MODULE)).toMatch(shownCall);
    expect(codeOf(VISIBILITY)).toMatch(shownCall);
  });

  it('keeps the shown rule able to fail (S-3)', () => {
    expect(shownCall.test('collectedRowsShown() ? undefined : x')).toBe(true);
    const found = planted(
      [
        { file: 'src/server/clicks/offer-target.ts', code: 'if (collectedRowsShown()) return null;' },
        { file: 'src/server/catalogue/sitemap.ts', code: 'collectedRowsShown()' },
        { file: VISIBILITY, code: 'collectedRowsShown()' },
      ],
      (code) => shownCall.test(code),
      mayAskShown,
    );
    expect(found).toEqual(['src/server/clicks/offer-target.ts', 'src/server/catalogue/sitemap.ts']);
  });

  // S-7: the two marked-row helpers. Every public read sees marked rows only
  // through the scope; the three named readers are flag-independent by design.
  const markedHelpers = /\b(markedFeedSql|markedProductSql)\b/;
  const mayNameMarkedHelpers = (file: string): boolean =>
    [
      VISIBILITY,
      'src/server/catalogue/demo.ts',
      'src/server/clicks/offer-target.ts',
      'src/server/admin/category-mappings.ts',
    ].includes(file);

  it('names the marked-row helpers only in the scope, indexability, the /go lookup and the mapping writer (S-7)', () => {
    expect(offenders(markedHelpers, mayNameMarkedHelpers)).toEqual([]);
    for (const file of [
      VISIBILITY,
      'src/server/catalogue/demo.ts',
      'src/server/clicks/offer-target.ts',
      'src/server/admin/category-mappings.ts',
    ]) {
      expect(codeOf(file), file).toMatch(markedHelpers);
    }
  });

  it('keeps the marked-row helper rule able to fail (S-7)', () => {
    expect(markedHelpers.test('not(markedFeedSql())')).toBe(true);
    expect(markedHelpers.test('and(markedProductSql())')).toBe(true);
    expect(markedHelpers.test('markedRow')).toBe(false);
    const found = planted(
      [
        { file: 'src/server/catalogue/category-page.ts', code: 'not(markedProductSql())' },
        { file: 'src/server/catalogue/search-page.ts', code: 'not(markedFeedSql())' },
        { file: 'src/server/catalogue/fit-state.ts', code: 'markedFeedSql()' },
        { file: 'src/server/catalogue/demo.ts', code: 'not(markedFeedSql())' },
      ],
      (code) => markedHelpers.test(code),
      mayNameMarkedHelpers,
    );
    expect(found).toEqual([
      'src/server/catalogue/category-page.ts',
      'src/server/catalogue/search-page.ts',
      'src/server/catalogue/fit-state.ts',
    ]);
  });

  it('excludes marked rows in the scope only when they are not shown, and never counts a collected fitment (C-4)', () => {
    const code = codeOf(VISIBILITY);
    const body = (name: string) =>
      code.match(new RegExp(`function\\s+${name}\\s*\\([^)]*\\)[^{]*\\{([\\s\\S]*?)\\r?\\n\\}`))?.[1] ?? '';
    expect(body('visibleOfferWhere')).toMatch(/collectedRowsShown\(\)\s*\?\s*undefined\s*:\s*not\(markedFeedSql\(\)\)/);
    expect(body('visibleProductWhere')).toMatch(
      /collectedRowsShown\(\)\s*\?\s*undefined\s*:\s*not\(markedProductSql\(\)\)/,
    );
    expect(body('countedFitmentWhere')).toContain('not(markedFeedSql())');
    expect(body('countedFitmentWhere')).not.toMatch(shownCall);
    expect(codeOf('src/server/catalogue/demo.ts')).not.toMatch(shownCall);
  });
});

// US-2.5 (T-2.5.3b), ACs 9 and 5: the not-public reason is computed in the visibility scope and only selected
// by the admin files. No seam rule above is edited; these rules are additive.
describe('seams (guardrail 1, US-2.5 the not-public reason)', () => {
  const ADMIN_DIRS = ['src/server/admin/', 'src/app/admin/', 'src/components/admin/'];
  const inAdmin = (file: string) => ADMIN_DIRS.some((dir) => file.startsWith(dir));
  /** A SQL CASE, however it is spaced or cased; a TypeScript `case 'x':` label never matches. */
  const sqlCase = /\bcase\s+when\b/i;

  it('finds the admin files it scans, so the rule below is not vacuous', () => {
    const files = sources().filter(({ file }) => inAdmin(file));
    expect(files.length).toBeGreaterThan(20);
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining(['src/server/admin/products.ts', 'src/components/admin/ProductState.tsx']),
    );
  });

  it('has the admin product read select both reasons from the visibility scope', () => {
    const code = sources().find(({ file }) => file === 'src/server/admin/products.ts')?.code ?? '';
    expect(code).toMatch(/\bofferNotPublicReasonSql\(\)/);
    expect(code).toMatch(/\bproductNotPublicReasonSql\(\)/);
    // The reason is read, never rebuilt: the public scope calls stay, and nothing builds a reason here.
    expect(code).toMatch(/\bvisibleProductWhere\(\)/);
    expect(code).toMatch(/\bvisibleOfferWhere\(\)/);
  });

  it('keeps every SQL case of a reason out of the admin files, and sees one planted there', () => {
    const found = sources()
      .filter(({ file, code }) => inAdmin(file) && sqlCase.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);

    const planted = [
      "sql`case when ${offers.isHidden} then 'offer_hidden' end`",
      'sql`(CASE\n  WHEN ${products.isHidden} THEN 1 END)`',
      "sql`select case   when x then 'a' else null end`",
    ];
    for (const code of planted) expect(sqlCase.test(code), code).toBe(true);
    for (const fine of ["switch (kind) { case 'saved': return 1; }", 'const showcase = whenReady();', 'a case of when']) {
      expect(sqlCase.test(fine), fine).toBe(false);
    }
  });
});

describe('seams (guardrail 5, #398 theme choice)', () => {
  // The visitor's theme lives in this browser only: `localStorage` key `tema`, read by the head script and
  // written by the switch, both client side. It is never a cookie, never a request, and the server never
  // reads it. theme-storage.ts is the one file that names the key and the stored words.
  const STORAGE = 'src/components/theme-storage.ts';
  const code = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
  const KEY = /\btema\b/;
  const STORED_WORDS = /['"`](claro|oscuro)['"`]/;
  const importsStorage = /\btheme-storage\b/;
  const importsSwitch = /\bThemeSwitch\b/;
  const inDir = (file: string, dir: string) => file.startsWith(dir);

  it('finds the files it pins, so the rules below are not vacuous', () => {
    expect(code(STORAGE)).toMatch(/\bTHEME_STORAGE_KEY\b/);
    expect(code('src/app/layout.tsx').length).toBeGreaterThan(0);
    expect(code('src/components/ThemeSwitch.tsx').length).toBeGreaterThan(0);
    expect(code('src/app/admin/layout.tsx').length).toBeGreaterThan(0);
    expect(sources().filter(({ file }) => inDir(file, 'src/server/')).length).toBeGreaterThan(20);
  });

  it('names the key tema in theme-storage.ts and in no other file under src', () => {
    expect(code(STORAGE)).toMatch(/'tema'/);
    expect(offenders(KEY, (file) => file === STORAGE)).toEqual([]);
  });

  it('names the stored words claro and oscuro in theme-storage.ts and in no other file under src', () => {
    expect(code(STORAGE)).toMatch(/claro/);
    expect(code(STORAGE)).toMatch(/oscuro/);
    expect(offenders(STORED_WORDS, (file) => file === STORAGE)).toEqual([]);
  });

  it('sees the key, a stored word and an import planted in a file that may not hold them', () => {
    expect(KEY.test("localStorage.getItem('tema')")).toBe(true);
    expect(KEY.test('const temas = 1')).toBe(false);
    for (const planted of ["x === 'claro'", 'y === "oscuro"', 'z === `oscuro`']) expect(STORED_WORDS.test(planted), planted).toBe(true);
    expect(STORED_WORDS.test("'Oscuro'")).toBe(false);
    expect(importsStorage.test("import { chooseScheme } from '@/components/theme-storage';")).toBe(true);
    expect(importsSwitch.test("import { ThemeSwitch } from './ThemeSwitch';")).toBe(true);
  });

  it('never names a cookie, a request or a beacon in theme-storage.ts', () => {
    const storage = code(STORAGE);
    expect(storage.length).toBeGreaterThan(0);
    for (const word of [/cookie/i, /\bfetch\b/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /\bnavigator\b/, /\bheaders\b/]) {
      expect(storage, String(word)).not.toMatch(word);
    }
  });

  it('writes document.cookie nowhere under src', () => {
    expect(offenders(/document\s*\.\s*cookie/, () => false)).toEqual([]);
  });

  it('has the server read nothing of the scheme: no server file or proxy imports the storage module, and no src code but the storage module and the admin wrapper names the attribute or the media query', () => {
    const serverSide = (file: string) => inDir(file, 'src/server/') || file === 'src/proxy.ts';
    const serverImports = sources().filter(({ file, code: text }) => serverSide(file) && importsStorage.test(text));
    expect(serverImports.map(({ file }) => file)).toEqual([]);
    expect(offenders(/prefers-color-scheme/i, (file) => file === STORAGE)).toEqual([]);
    expect(offenders(/\bdata-theme\b/, (file) => file === STORAGE || file === 'src/app/admin/layout.tsx')).toEqual([]);
  });

  it('lets only the root layout and the switch import theme-storage, and only the header import the switch', () => {
    const importers = sources().filter(({ code: text }) => importsStorage.test(text));
    expect(importers.map(({ file }) => file).sort()).toEqual(['src/app/layout.tsx', 'src/components/ThemeSwitch.tsx']);
    const app = importers.filter(({ file }) => inDir(file, 'src/app/'));
    expect(app.map(({ file }) => file)).toEqual(['src/app/layout.tsx']);
    const switchUsers = sources().filter(({ file, code: text }) => importsSwitch.test(text) && file !== 'src/components/ThemeSwitch.tsx');
    expect(switchUsers.map(({ file }) => file)).toEqual(['src/components/SiteHeader.tsx']);
  });

  it('puts the head script in the root layout as the constant, beside suppressHydrationWarning on html', () => {
    const layout = code('src/app/layout.tsx');
    expect(layout).toMatch(/\bTHEME_SCRIPT\b/);
    expect(layout).toMatch(/__html:\s*THEME_SCRIPT\s*\}/);
    expect(layout).toMatch(/\bsuppressHydrationWarning\b/);
    expect(offenders(/\bTHEME_SCRIPT\b/, (file) => file === STORAGE || file === 'src/app/layout.tsx')).toEqual([]);
  });

  it('CR-3: reruns the head script through next/script afterInteractive, in head after the blocking one, for a document React renders on the client', () => {
    const layout = code('src/app/layout.tsx');
    expect(layout).toMatch(/import Script from 'next\/script';/);
    const head = layout.slice(layout.indexOf('<head>'), layout.indexOf('</head>'));
    expect(head.length).toBeGreaterThan(0);
    const blocking = head.indexOf('<script ');
    const rerun = head.indexOf('<Script ');
    expect(blocking).toBeGreaterThan(-1);
    expect(rerun).toBeGreaterThan(blocking);
    const blockingTag = head.slice(blocking, head.indexOf('/>', blocking));
    expect(blockingTag).toMatch(/__html:\s*THEME_SCRIPT\s*\}/);
    expect(blockingTag).not.toMatch(/\b(async|defer)\b/);
    const rerunTag = head.slice(rerun, head.indexOf('/>', rerun));
    expect(rerunTag).toMatch(/\bid="[\w-]+"/);
    expect(rerunTag).toMatch(/strategy="afterInteractive"/);
    expect(rerunTag).toMatch(/__html:\s*THEME_SCRIPT\s*\}/);
    expect(rerunTag).not.toMatch(/beforeInteractive|lazyOnload|worker/);
    // Both run the one constant; neither builds script text from the request.
    expect(head.match(/THEME_SCRIPT/g)).toHaveLength(2);
    expect(head.match(/<script\b/g)).toHaveLength(1);
    expect(head.match(/<Script\b/g)).toHaveLength(1);
  });

  it('keeps the admin dark by a server-rendered wrapper attribute, with no switch and no theme storage in any admin file', () => {
    expect(code('src/app/admin/layout.tsx')).toMatch(/<div\b[^>]*\bdata-theme="dark"/);
    const admin = sources().filter(({ file }) => ['src/app/admin/', 'src/components/admin/', 'src/server/admin/'].some((dir) => inDir(file, dir)));
    expect(admin.length).toBeGreaterThan(20);
    const named = admin.filter(({ code: text }) => importsStorage.test(text) || importsSwitch.test(text) || /\blocalStorage\b/.test(text));
    expect(named.map(({ file }) => file)).toEqual([]);
  });
});

// S15.3 (US-15.3, D-1, D13 of the design). The stored engine-oil attributes (`products.attr_*`) are the
// importer's alone: the row that creates a product writes them and a later eligible row fills an absent one
// once. No admin screen, action or route enters, edits or clears one (AC 41, guardrails 1 and 3), no seed,
// script or public route writes one, and only the page reader reads them, through aliases (D13). In the
// pattern of the pin that only the import writes `fitments` (S5.6, AC 20).
describe('seams (guardrails 1, 2 and 3, S15.3 attribute store)', () => {
  const codeOf = (file: string) => sources().find((entry) => entry.file === file)?.code ?? '';
  const planted = (
    files: { file: string; code: string }[],
    test: (code: string) => boolean,
    allowed: (file: string) => boolean,
  ): string[] => files.filter(({ file, code }) => test(code) && !allowed(file)).map(({ file }) => file);

  const IMPORTER = 'src/server/importer/index.ts';
  const PAGE_READER = 'src/server/catalogue/product-page.ts';
  const ATTRIBUTE_PROPERTIES = 'Viscosity|VolumeMl|Acea|OilType|Approvals';
  const ATTRIBUTE_COLUMNS = 'viscosity|volume_ml|acea|oil_type|approvals';

  // The store, by its TypeScript property or its SQL column name.
  const namesStore = new RegExp(`\\battr(?:${ATTRIBUTE_PROPERTIES})\\b|\\battr_(?:${ATTRIBUTE_COLUMNS})\\b`);
  const mayNameStore = (file: string): boolean => file.startsWith('src/db/') || file === IMPORTER || file === PAGE_READER;

  // A write: an object key (a `.values({...})` or `.set({...})`), or raw SQL that updates or inserts.
  const writesStoreKey = new RegExp(`\\battr(?:${ATTRIBUTE_PROPERTIES})\\s*:`);
  const writesStoreSql = new RegExp(`\\b(?:update|insert\\s+into)\\b[^;\`]*?\\battr_(?:${ATTRIBUTE_COLUMNS})\\b`, 'i');
  const writesStore = (code: string): boolean => writesStoreKey.test(code) || writesStoreSql.test(code);
  const mayWriteStore = (file: string): boolean => file.startsWith('src/db/') || file === IMPORTER;

  it('finds the files it scans, so the rules below are not vacuous', () => {
    const files = sources().map(({ file }) => file);
    expect(files).toEqual(expect.arrayContaining([IMPORTER, PAGE_READER, 'src/db/schema/catalogue.ts', 'src/server/admin/products.ts']));
    expect(codeOf('src/db/schema/catalogue.ts')).toMatch(namesStore);
  });

  it('names the stored attribute columns only in the schema and migrations, the importer and the page reader (AC 41)', () => {
    expect(offenders(namesStore, mayNameStore)).toEqual([]);
  });

  it('writes the stored attributes only in the schema and the importer: no admin action, writer, route, seed or script (AC 41)', () => {
    expect(offenders(writesStoreKey, mayWriteStore)).toEqual([]);
    expect(offenders(writesStoreSql, mayWriteStore)).toEqual([]);
    expect(offenders(/\.execute\(\s*sql`[^`]*\battr_/i, () => false)).toEqual([]);
  });

  it('keeps the admin area, the seed, the CLI and the public routes away from the attribute modules and the store (AC 41)', () => {
    const admin = (file: string) =>
      file.startsWith('src/app/admin/') || file.startsWith('src/components/admin/') || file.startsWith('src/server/admin/');
    const modules = /category-attributes|importer\/attribute-fill/;
    expect(offenders(modules, (file) => !admin(file) && !file.startsWith('src/server/seed') && !file.startsWith('src/cli/'))).toEqual([]);
    for (const { file, code } of sources().filter((entry) => admin(entry.file))) {
      expect(code, file).not.toMatch(namesStore);
      expect(code, file).not.toMatch(/\b(?:readViscosity|readVolume|readAcea|readOilType|readApprovals|decideAttributeFill)\b/);
    }
    expect(sources().filter((entry) => admin(entry.file)).length).toBeGreaterThan(10);
  });

  it('keeps the importer\'s two writes in the two places the design names: the creating insert and the guarded fill update', () => {
    const importer = codeOf(IMPORTER);
    const create = importer.match(/async function createProduct\([\s\S]*?\r?\n\}/)?.[0] ?? '';
    expect(create).toMatch(/\.insert\(\s*products\s*\)/);
    for (const property of ['attrViscosity', 'attrVolumeMl', 'attrAcea', 'attrOilType', 'attrApprovals']) {
      expect(create, property).toMatch(new RegExp(`\\b${property}\\s*:`));
    }
    const fill = importer.match(/async function fillAttributes\([\s\S]*?\r?\n\}/)?.[0] ?? '';
    expect(fill).toMatch(/\.update\(\s*products\s*\)/);
    expect(fill).toMatch(/coalesce\(/);
    expect(fill).toMatch(/isHidden/);
    // Nowhere else in the importer does a statement name the store as a written key.
    const outside = importer.replace(create, '').replace(fill, '');
    expect(outside).not.toMatch(writesStoreKey);
    expect(outside).not.toMatch(/\bset\.attr/);
  });

  it('keeps the page reader read-only: it names the columns through non-attr aliases and writes nothing (D13)', () => {
    const reader = codeOf(PAGE_READER);
    expect(reader).toMatch(namesStore);
    expect(reader).not.toMatch(writesStoreKey);
    expect(reader).not.toMatch(/\.(insert|update|delete)\(/);
    expect(reader).toMatch(/viscosity:\s*products\.attrViscosity/);
  });

  it('keeps the attribute modules free of the database and of the server-only marker, so the CLI build can load them', () => {
    for (const file of ['src/server/category-attributes.ts', 'src/server/importer/attribute-fill.ts']) {
      const code = codeOf(file);
      expect(code.length, file).toBeGreaterThan(0);
      expect(code, file).not.toMatch(/server-only|from\s+['"]@\/|drizzle-orm|\.(insert|update|delete)\(|\bfetch\(|node:fs/);
    }
  });

  it('keeps the store rules able to fail: the patterns catch each way of naming and writing it, and a planted admin file is reported (AC 41)', () => {
    expect(namesStore.test('products.attrViscosity')).toBe(true);
    expect(namesStore.test('p.attr_oil_type')).toBe(true);
    expect(namesStore.test('row.attributes.viscosity')).toBe(false);
    expect(namesStore.test('const attrViscosityLabel = 1')).toBe(false);
    for (const property of ATTRIBUTE_PROPERTIES.split('|')) {
      expect(writesStoreKey.test(`.set({ attr${property}: null })`), property).toBe(true);
      expect(writesStoreKey.test(`.values({ attr${property} : x })`), property).toBe(true);
    }
    expect(writesStoreKey.test('viscosity: products.attrViscosity')).toBe(false);
    expect(writesStoreSql.test('update products set attr_acea = null')).toBe(true);
    expect(writesStoreSql.test('UPDATE "products" SET "attr_approvals" = NULL')).toBe(true);
    expect(writesStoreSql.test('insert into products (slug, attr_viscosity) values (1, 2)')).toBe(true);
    expect(writesStoreSql.test('select attr_viscosity from products')).toBe(false);
    const found = planted(
      [
        { file: 'src/app/admin/(shell)/productos/actions.ts', code: 'tx.update(products).set({ attrViscosity: null })' },
        { file: 'src/server/admin/products.ts', code: 'sql`update products set attr_acea = null`' },
        { file: 'src/server/seed/index.ts', code: '.values({ attrOilType: "mineral" })' },
        { file: IMPORTER, code: '.values({ attrViscosity: row.attributes.viscosity })' },
        { file: 'src/db/schema/catalogue.ts', code: 'attrViscosity: text()' },
      ],
      writesStore,
      mayWriteStore,
    );
    expect(found).toEqual(['src/app/admin/(shell)/productos/actions.ts', 'src/server/admin/products.ts', 'src/server/seed/index.ts']);
  });
});
