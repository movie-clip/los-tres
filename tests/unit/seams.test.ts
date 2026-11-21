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

  const flagNames = /\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview)\b/;
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

  it('the visibility scope itself names every flag, so the scan above is not vacuous', () => {
    const code = sources().find(({ file }) => file === 'src/server/visibility.ts')?.code ?? '';
    for (const flag of ['isApproved', 'isHidden', 'inReview']) {
      expect(code).toContain(flag);
    }
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
    expect(code).not.toMatch(/\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview)\b/);
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
    expect(code).toContain('hasNonDemoOfferWhere()');
  });

  it('keeps the sitemap routes off the database layer and the visibility flags (S6.2)', () => {
    const found = sources()
      .filter(({ file }) => /^src\/app\/.*\/(sitemap\.xml|sitemaps)\/.*route\.ts$/.test(file))
      .filter(({ code }) => /['"]@\/db|\/db\/|\bis(Hidden|Approved)\b|\binReview\b/.test(code))
      .map(({ file }) => file);
    expect(found).toEqual([]);
  });

  it('reads AUTH_SECRET and SITE_URL only in src/config/auth.ts', () => {
    const found = offenders(/\b(AUTH_SECRET|SITE_URL)\b/, (file) => file === 'src/config/auth.ts');
    expect(found).toEqual([]);
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
    expect(code).not.toMatch(/\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_retired|isRetired)\b/);
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
