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

  it('names the approval, hidden and review flags only in the visibility scope, schema, seed and importer', () => {
    const flags = /\b(is_approved|isApproved|is_hidden|isHidden|in_review|inReview)\b/;
    const found = offenders(
      flags,
      (file) =>
        file === 'src/server/visibility.ts' ||
        file.startsWith('src/db/') ||
        file.startsWith('src/server/seed/') ||
        file.startsWith('src/server/importer/') ||
        // Deliberate (issue #24, S2.3): the admin approval writer.
        file === 'src/server/admin/sources.ts',
    );
    expect(found).toEqual([]);
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

  it('updates products only in the importer and the seed', () => {
    const found = offenders(
      /\.update\(\s*products\s*\)/,
      (file) => file.startsWith('src/server/importer/') || file.startsWith('src/server/seed/'),
    );
    expect(found).toEqual([]);
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
        inAuth(file),
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

  // Deliberate (issue #24, S2.3): the approval writer is one file, and it never
  // reads the feed URL, which may embed a network API key (guardrail 5).
  it('updates shops and feeds only in src/server/admin/sources.ts, which is found (not vacuous)', () => {
    const found = offenders(
      /\.update\(\s*(shops|feeds)\s*\)/,
      (file) => file === 'src/server/admin/sources.ts',
    );
    expect(found).toEqual([]);
    const code = sources().find(({ file }) => file === 'src/server/admin/sources.ts')?.code ?? '';
    expect(code).toMatch(/\.update\(\s*shops\s*\)/);
    expect(code).toMatch(/\.update\(\s*feeds\s*\)/);
  });

  it('never names a feed or offer url under src/server/admin or src/app/admin/(shell)/tiendas', () => {
    const files = sources().filter(
      ({ file }) => file.startsWith('src/server/admin/') || file.startsWith('src/app/admin/(shell)/tiendas/'),
    );
    expect(files.map(({ file }) => file)).toEqual(
      expect.arrayContaining(['src/server/admin/sources.ts', 'src/app/admin/(shell)/tiendas/actions.ts']),
    );
    const found = files.filter(({ code }) => /(feeds|offers)\.url|url\s*:/.test(code)).map(({ file }) => file);
    expect(found).toEqual([]);
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
    expect(code).not.toMatch(/(is_approved|isApproved|is_hidden|isHidden|in_review|inReview|is_retired|isRetired)/);
    expect(code).not.toMatch(/isNotNull\(\s*products\.categoryId\s*\)/);
  });

  it('names the fitment condition only in the visibility scope and the fit-state read', () => {
    const found = offenders(
      /(countedFitmentWhere|activeVehicleWhere)/,
      (file) => file === 'src/server/visibility.ts' || file === FIT_STATE,
    );
    expect(found).toEqual([]);
  });

  it('writes nothing and logs nothing in the fit-state read (AC 28, guardrail 5)', () => {
    const code = codeOf(FIT_STATE);
    expect(code.length).toBeGreaterThan(0);
    expect(code).not.toMatch(/console\.\w+\s*\(/);
    expect(code).not.toMatch(/\.(insert|update|delete)\(/);
  });

  it('keeps the vehicle list free of the server-only marker and the client, so the CLI can run it', () => {
    const code = codeOf('src/db/vehicle-catalogue.ts');
    expect(code).not.toMatch(/server-only/);
    expect(code).not.toMatch(/\.(delete)\(/);
  });
});
