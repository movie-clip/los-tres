REPORT 2026-10-21-legal-pages/01
status:      DONE
verdict:     NONE

changed:
  - none

verification:
  command:   NONE
  result:    NOT_RUN
  detail:    read-only recon, order verification NONE

contract_notes:
  - The PublicOffer / PublicProductPage / PublicCategoryPage contracts (src/server/catalogue/product-page.ts:13-38, category-page.ts:16-48) carry no demo flag; a demo notice needs a new field on these, and they are the backend/frontend contract (C-11, C-3).
  - compose.yaml:11-18 lists app env explicitly (nothing is forwarded by env_file), so the five OWNER_*/CONTACT_EMAIL names must be added there or the container never sees them.
  - tests/unit/messages.test.ts:6-78 and :80-167 hold per-namespace key lists; a new namespace for legal pages has no entry until a test adds one.
  - tests/unit/route-classification.test.ts:16-37 requires every page.tsx under src/app to sit below (public) or admin; new legal routes must go under src/app/(public)/.
  - docs/design/system.md § Components (lines 47-56) has no Footer or Notice row; a footer and demo notice are new components the design system does not yet describe.
  - mvp.md:178-182 says demo products are "noindex and left out of the sitemap"; no noindex, robots or sitemap exists in the repo (grep), so that clause is unimplemented and not part of S9.3 unless ordered.

pack_corrections:
  - none

handoff:
  - Footer home: src/app/layout.tsx:20-30 (RootLayout renders SiteHeader then children); every route, including not-found, inherits it. See § Layout and footer.
  - SiteHeader takes siteName as a prop and components never read config (SiteHeader.tsx:5); the footer can follow that shape. See § Layout and footer.
  - Server env reads go through src/config/env.ts:9-29 (readRequiredEnv throws, readOptionalEnv returns undefined when blank); optional is the existing fit for an empty OWNER_REGISTRY. See § SITE_NAME path.
  - Messages are ICU via next-intl 4.14.9: t(), t.rich, t.markup, t.raw, t.has exist; a missing value yields a FORMATTING_ERROR and the "Namespace.key" string, not a throw. See § i18n.
  - Demo identity is feeds.is_demo (src/db/schema/sources.ts:44), set true by the seed (src/server/seed/index.ts:66); no public read selects it today. See § Demo identification.
  - Offer-listing public pages: product page and category page only; home lists categories and counts, there is no search page. See § Demo identification.
  - Test patterns to copy: unit env stubs (tests/unit/site-config.test.ts), message key tests (tests/unit/messages.test.ts), renderToStaticMarkup component tests (tests/unit/home-components.test.ts), Playwright raw-HTML specs (tests/e2e/home.spec.ts). See § Test patterns.
  - legal-es.md structure is in § legal-es.md structure; it contains placeholders only, no identity values were found in it.

skill_calls:
  - none

risks:
  - E2E runs against the Compose stack, which reads the developer's real .env; tests that assert OWNER_* text on the stack would see real values or empty ones, so fake values can only be asserted in unit or render tests.
  - Compose uses `${SITE_NAME:?...}` for required values (compose.yaml:12); a `:?` on an owner variable would break `docker compose run ... import-feeds` in the e2e global setup (tests/e2e/global-setup.ts:15-18) when the key is empty. A default form is the likely fit; I did not test it.
  - The seams scan (tests/unit/seams.test.ts:96-104) forbids importing src/db from any page or component, so demo detection must come through a src/server read, as the catalogue modules do.
  - ICU quoting: I did not verify how the message text behaves with the characters `**`, `www.aepd.es`, or `(artículo 6.1.f ...)`; the file has no apostrophes or braces other than placeholders, but the bold markers (`**...**`) in the privacy list items have no ICU equivalent and need a rich tag or plain text.
  - I did not find where a link `rel` or prefetch rule applies to footer links; next/link is banned only in OfferList (seams.test.ts:205-209), SiteHeader and NotFound already use it.
  - The root layout is force-dynamic (layout.tsx:10) and every page also is, so env reads per request fit; I did not check whether the not-found page renders the layout's footer in production, only that Next wraps not-found in the root layout.

## Orchestrator brief
- Footer has no home yet: only src/app/layout.tsx:20-30 renders chrome (SiteHeader); there is no footer, no legal route, no demo notice, no OWNER_* anywhere in the repo.
- SITE_NAME path: getSiteName() (src/config/site.ts:10) -> readRequiredEnv (src/config/env.ts:9) per call; pages pass it as a value to t('key', { siteName }); components get finished strings or a prop.
- i18n is next-intl 4.14.9, fixed locale, one messages file loaded by dynamic import (src/i18n/request.ts:7-11); ICU placeholders, plurals, and t.rich/t.markup exist; missing value logs and returns the key, no throw.
- Demo identity is feeds.is_demo only (sources.ts:44); no public contract exposes it; offers appear on exactly two public pages (product, category); home lists categories; no search page exists.
- Env passing: .env.example (14 keys, SITE_NAME at :4) -> scripts/init-env.mjs copies lines verbatim -> compose.yaml:11-18 passes an explicit list; new vars must be added to both example and compose.
- Tests: unit env stubs, per-key message tests, renderToStaticMarkup component tests, Playwright raw-HTML specs with messages-driven copy; seams and route-classification scans constrain new files.
- legal-es.md: three page blocks, a demo-notice block, a footer-label block; placeholder map is in its own section below; the file holds placeholders only.
- Premise check: no contradiction with the order; mvp.md says demo products noindex and sitemap-excluded, but neither exists (out of S9.3 unless ordered).
- Sections below: SITE_NAME path (a), i18n (b), Layout and footer (c), Demo identification (d), Test patterns (e), Env and Compose (f), legal-es.md structure (g), Governing docs.

## SITE_NAME path
Answers (a). Paths are relative to C:\projects\investments\los-tres.
- src/config/env.ts:9-15 readRequiredEnv(name): `process.env[name]?.trim()`, throws `Error("<NAME> is not set")` when blank; imports `server-only`; comment says never read at module load (TD-5).
- src/config/env.ts:26-29 readOptionalEnv(name): returns the trimmed value or `undefined` when unset or blank. Used by src/config/seed.ts:11 (SEED_DEMO_DATA).
- src/config/site.ts:10-12 getSiteName() = readRequiredEnv('SITE_NAME'); the only reader.
- Callers: src/app/layout.tsx:15 (metadata title) and :25 (SiteHeader prop); src/app/(public)/page.tsx:18; src/app/(public)/producto/[slug]/page.tsx:28; src/app/(public)/categoria/[slug]/page.tsx:35.
- Pattern: the server component calls getSiteName() and passes it either into `t(key, { siteName })` or as a prop to a component; components never read configuration (SiteHeader.tsx:5 comment).
- Files under src/config, src/cli, src/db, src/server import relatively, not through `@/` (eslint.config.mjs:57-76), so a new config reader in src/config must import `./env`.
- Every page and the root layout export `dynamic = 'force-dynamic'` (layout.tsx:10, page.tsx:10, producto page.tsx:15, categoria page.tsx:16); a legal page that reads env must do the same (frontend.md:57).
- Unit pattern for a reader: tests/unit/site-config.test.ts:10-51 uses vi.stubEnv, afterEach vi.unstubAllEnvs, tests trimming, per-call read, the fixed error text, and that no other env value enters the error.

## i18n
Answers (b).
- src/i18n/request.ts:7-11: getRequestConfig returns locale 'es-ES' (src/i18n/locale.ts:2), timeZone 'Europe/Madrid', and `messages: (await import('../../messages/es-ES.json')).default`. No middleware, no routing (TD-4). No onError or getMessageFallback is configured, so the use-intl defaults apply.
- messages/es-ES.json: one file, top-level namespaces Metadata, Home, NotFound, Category, Product (file lines 2, 6, 14, 19, 33). Flat string values, no nested objects below namespace level.
- Server use: `const t = await getTranslations('Namespace')` then `t('key', values)` (home page.tsx:13, categoria page.tsx:48-52).
- Placeholders in use: `{siteName}`, `{title}`, `{category}`, `{page}`, `{pages}`, `{shopName}`, `{count, plural, one {# x} other {# xs}}` (es-ES.json:10, 23, 39) and `{date, date, medium}` (es-ES.json:42). So ICU MessageFormat is on.
- Rich text: use-intl exposes `translateFn.rich` (initializeConfig-CUsOI8u2.js:167) and `translateFn.markup` (:170-185) and `translateFn.raw` (:186); no message in the repo uses a tag yet and no caller uses t.rich.
- Missing value / missing key: a formatting failure is caught and routed to getFallbackFromErrorAndNotify (initializeConfig-CUsOI8u2.js:145-155), which calls onError (default logs) and returns the fallback string built from namespace and key; a missing key is the same with MISSING_MESSAGE (:124-130). Neither throws.
- A non-string result from t() (when a message holds a tag) is an INVALID_MESSAGE fallback (:162-164): the message says to use t.rich.
- Existing message constraints enforced by tests: no message contains the code name (messages.test.ts:66-70); no src file contains it (:72-77); Product and Category copy has no price and no word "envío" (:114-118, :162-166). The legal copy would sit in new namespaces and those regexes apply only to Product and Category.
- Test-side message helpers: tests/support/messages.ts:10-16 icuPlural, :23-30 dateMessagePattern, :4-6 normaliseSpaces; unit-pinned in tests/unit/message-helpers.test.ts.
- Pages import the JSON directly in specs: `import messages from '../../messages/es-ES.json'` (home.spec.ts:3) and replace `{siteName}` by string replace (product.spec.ts:38-40); there is no helper that renders a general ICU message.

## Layout and footer
Answers (c).
- Root layout src/app/layout.tsx:20-30: `<html lang={locale}><body><SiteHeader siteName=.../>{children}</body></html>`. No footer, no wrapper element around children.
- Route tree under src/app: layout.tsx, not-found.tsx, globals.css, and `(public)/` with page.tsx, api/health/route.ts, go/[offer]/route.ts, categoria/[slug]/page.tsx, producto/[slug]/page.tsx. No admin dir exists yet; no route group layout file exists.
- src/components/SiteHeader.tsx:6-16: header > div.inner > next/link to "/" with data-testid="site-header-link"; styles in SiteHeader.module.css (full-width border-bottom, inner column at --content-width with --space-3 sides, link min-height --tap-target, focus ring --focus-ring).
- Page shell: `.page` in globals.css:40-49 (max-width --content-width, padding --space-4/--space-3, `.page p` coloured --color-muted). Pages render `<main className="page">`; tests assert exactly one `<main>` (home.spec.ts:37, product.spec.ts:35).
- Constraint on new markup: the product e2e asserts `main a` count equals the offer-row count (product.spec.ts:126), and home.spec asserts exactly one `<p>` in the page (home.spec.ts:41). A footer outside `<main>` is not hit by `main a`, but a `<p>` in a footer or a notice would break the home `p` count unless it is outside the parsed page or the test is updated.
- Every-page footer check surface: expectLocalScriptsAndLinks (tests/support/page-checks.ts:24-37) requires every `a[href]` to be a same-origin path starting with `/`; footer links to internal paths pass.
- Not-found: src/app/not-found.tsx:4-15 is a `<main className="page">` with h1, p and a Link home; it renders inside the root layout.
- Design system: docs/design/system.md § Components (lines 47-56) lists Site header, Brand panel, Category group, Product card, Pagination, Empty state, Offer row, Image placeholder; no footer or notice. Principle 4 (line 15) says no other page gets a filled panel. Type tokens --text-sm/md/lg/xl and spacing tokens are in globals.css:2-19.
- CSS convention: co-located `*.module.css` per component (decision 0011); globals.css holds variables and reset only (CLAUDE.md § Stack).
- Component convention: components take finished strings and hrefs and no config (SiteHeader.tsx:5; home-components.test.ts:8-9 says "take finished strings and hrefs only").

## Demo identification
Answers (d).
- Schema: `feeds.is_demo boolean not null default false` (src/db/schema/sources.ts:44; migration src/db/migrations/0000_init.sql:51). `shops` has no demo column (sources.ts:22-29); offers have none (grep of isDemo found no use in src/db/schema/catalogue.ts).
- Seed: src/server/seed/index.ts:58-69 inserts one feed per demo shop with `url: demo-feed:<file>`, `isApproved: true`, `isDemo: true`; shops are inserted `isApproved: true` (:50-53). Demo network/shops/categories come from src/server/seed/demo-data.ts (not read in full).
- Only readers of is_demo today: click offer-target (src/server/clicks/offer-target.ts:21-37 isDemoFeed), click counting skip reason 'demo' (src/server/clicks/counting.ts:55), the importer (src/server/importer/index.ts:36,72,112) and its source reader (source.ts:32-37).
- Visibility scope: src/server/visibility.ts:22-29 visibleOfferWhere() = feed approved AND shop approved AND offer not hidden AND not in review; :32-44 visibleProductWhere(). It joins offers -> feeds -> shops, so feeds.isDemo is reachable in the same queries. The seams test lets only visibility.ts, src/db, seed and importer name the approval/hidden/review flags (seams.test.ts:57-68); it does not constrain isDemo.
- Public readers and what they return: getPublicProductBySlug (src/server/catalogue/product-page.ts:45-84) selects offers joined to feeds and shops; PublicOffer has offerId, shopName, priceCents, priceUpdatedAt. getPublicCategoryPage (category-page.ts:73-122) groups offers per product; card has slug, title, brand, lowestPriceCents, offerCount. Neither selects feeds.isDemo.
- Pages that list offers: product page `(public)/producto/[slug]/page.tsx` (OfferList) and category page `(public)/categoria/[slug]/page.tsx` (ProductGrid of cards with price and shop count). Home `(public)/page.tsx` lists categories and product counts only. No search route or search module exists (grep of src/app).
- Category page empty branch (page.tsx:54-67) lists no offers; the home empty state likewise.
- Demo e2e fixtures: tests/fixtures/demo.ts (DEMO_SHARED, DEMO_DRILL, DEMO_SHOP_HOSTS, DEMO_CATEGORY_*) hold the demo product slugs and counts used by home/product/category specs; I did not open it in full.
- Test support to make a demo or non-demo feed: tests/support/catalogue.ts:39-49 (`isDemo` option on the feed helper), tests/support/go.ts:50 insertGoOffer({ feed: { isDemo } }); integration tests tests/integration/product-page.test.ts, category-page.test.ts, visibility.test.ts exist for the read modules.
- Today every approved feed in the dev stack is a demo feed (seed approves only demo feeds, seed.test.ts:139-149), so a notice keyed on "only demo offers" shows on every offer page there.
- mvp.md:178-182 and decision 0009:38-39 already treat demo offers as special (not counted, noindex stated); mvp.md:181 states the notice rule: pages that list only demo offers carry a short notice.

## Test patterns
Answers (e).
- Runners: vitest.config.mts defines `unit` and `integration` projects (npm scripts package.json:22-24); playwright.config.ts:15-25 uses tests/e2e, globalSetup tests/e2e/global-setup.ts, no webServer, baseURL from E2E_BASE_URL or APP_PORT.
- Unit env pattern: vi.stubEnv + vi.unstubAllEnvs (tests/unit/site-config.test.ts:6-8); seed flag test tests/unit/seed-config.test.ts.
- Unit component pattern: createElement + renderToStaticMarkup, assert data-testid and text (tests/unit/home-components.test.ts:1-84; product-components.test.ts, category-components.test.ts exist).
- Message pattern: tests/unit/messages.test.ts has a lookup(key) helper (:11-19) and per-namespace `it.each` key lists that assert non-empty strings (:37-53, :81-97, :122-139), placeholder presence (:55-57, :99-105, :141-150) and ICU plural shape.
- Scan tests: tests/unit/seams.test.ts walks src/ and asserts where things may live (visibility flags, fetch, fs, db import from pages, money, user agent, cookie in /go); tests/unit/eslint-guardrails.test.ts; tests/unit/route-classification.test.ts uses tests/support/routes.ts classifyRoute.
- E2E page pattern (tests/e2e/home.spec.ts, product.spec.ts, category.spec.ts): `loadEnv()` then `siteName = process.env.SITE_NAME`; `request.get(path)` for the raw HTML; expectNoSetCookie(response); openRawHtml(browser, html) parses it in a JS-off context (tests/support/page-checks.ts:8-16); assertions use messages JSON and data-testid; expectLocalScriptsAndLinks(page).
- E2E cookie/origin pattern: real page visit with `page.on('request')`, `context.cookies()` equals [] and expectNoForeignOrigin (home.spec.ts:52-66; product.spec.ts:132-147).
- E2E 404 pattern: unknown slug returns 404, Spanish not-found heading from messages.NotFound.heading, no set-cookie (product.spec.ts:149-169).
- E2E env: tests/support/env.ts:8-13 loadEnv() calls process.loadEnvFile('.env'); process env wins over the file. The Playwright process reads the host .env; the app under test reads the Compose container env.
- Env-init test: tests/unit/init-env.test.ts:44-62 runs scripts/init-env.mjs in a temp tree copied with .env.example, asserts generated secrets, DATABASE_URL, SEED_DEMO_DATA 'true' and SITE_NAME equal to the example; it checks named keys only, so extra empty keys do not break it.
- Integration DB tests need `npm run db:up`; helper tests/support/catalogue.ts, go.ts, db.ts.
- No existing test covers a footer, a static text page, or an env value that is optional-and-empty.
- Testing pack on copy: agentic/capabilities/testing.md:43 says expected copy comes from messages/es-ES.json and SITE_NAME from .env, never a literal; raw HTML is parsed by page.setContent with JS off.

## Env and Compose
Answers (f).
- .env.example (14 lines): `SITE_NAME=Los Tres` at line 4; other keys APP_PORT, DB_USER, DB_PASSWORD (blank), DB_NAME, DB_HOST_PORT, DATABASE_URL (blank), UMAMI_APP_SECRET (blank), UMAMI_PORT, SEED_DEMO_DATA=true, E2E_BASE_URL (blank). Header comment lines 1-3 say blanks are filled by env:init and .env is never committed.
- scripts/init-env.mjs:14-34 reads every `NAME=value` line, fills blanks for DB_PASSWORD and UMAMI_APP_SECRET only, derives DATABASE_URL, and writes all lines back verbatim otherwise; extra empty keys pass through unchanged.
- compose.yaml:11-18 `app.environment` is an explicit list: SITE_NAME `${SITE_NAME:?run npm run env:init}` (:12), DATABASE_URL, SEED_DEMO_DATA `${SEED_DEMO_DATA:-false}` (:15, with a comment), PORT, HOSTNAME, NODE_ENV. No env_file. Nothing else reaches the app container.
- Dockerfile:23 says no database or environment is needed to build (TD-5); the `ENV` lines at :20 and :30 are NEXT_TELEMETRY_DISABLED and NODE_ENV-class settings, not site config.
- Frontend pack note: a changed SITE_NAME takes `docker compose up -d`, not a rebuild (frontend.md:57); same would apply to owner variables.
- `docker compose run --rm app import-feeds/migrate/seed` and the e2e global setup (tests/e2e/global-setup.ts:15-18) use the same compose service definition, so the interpolation form chosen for new variables applies to them as well.
- .gitignore and .dockerignore exist; I did not read them. CLAUDE.md says `.env` is never committed.

## legal-es.md structure
Answers (g). Source: C:\projects\investments\los-tres-private\legal-es.md (180 lines). Structure only; this file's body holds placeholders and final prose, no identity values were seen.
- Lines 1-5: title and a note that the file lives outside the repo and is never committed.
- Lines 7-16: placeholder table: `{siteName}` from SITE_NAME; `{ownerName}` OWNER_NAME; `{ownerNif}` OWNER_NIF; `{ownerAddress}` OWNER_ADDRESS; `{ownerRegistry}` OWNER_REGISTRY (empty for an autónomo, "and then its line does not render"); `{contactEmail}` CONTACT_EMAIL. Line 18: headings are `##`/`###`, list items `-`.
- `## Página: Aviso legal` (lines 22-72), page heading `### Aviso legal`: intro paragraph citing LSSI-CE art. 10, then five list items (lines 30-34) in this order: Titular {ownerName}, NIF {ownerNif}, Domicilio {ownerAddress}, Correo electrónico {contactEmail}, Datos registrales {ownerRegistry}. The "Datos registrales" line (34) is the one that does not render when OWNER_REGISTRY is empty.
- Aviso legal subsections (`###`): Objeto (36; uses {siteName} twice), Información de precios (44; {siteName} once), Datos de demostración (52; no placeholder; says demo pages may appear and indicate it visibly), Propiedad intelectual e industrial (58; {siteName}), Enlaces a terceros (65; {siteName} twice), Legislación aplicable (70; no placeholder).
- `## Página: Política de privacidad` (76-145), page heading `### Política de privacidad` (78) followed immediately by another `###` with no body of its own.
- Privacy subsections: Responsable del tratamiento (80; {ownerName}, {ownerNif}, {ownerAddress}, {contactEmail} in one sentence), No usamos cookies (85; {siteName}), Qué datos registramos cuando visitas el sitio (90; three bold-lead list items "Clics hacia las tiendas", "Estadísticas de visitas", "Registros del servidor", then a closing paragraph about legal basis art. 6.1.f RGPD), Al salir hacia una tienda (110; {siteName}), Si nos escribes (117), Administradores (123; states an admin session cookie), Destinatarios (129), Tus derechos (135; {contactEmail}; names www.aepd.es), Cambios en esta política (143).
- The three list items at lines 92-104 use `**bold**` lead-ins and wrap across lines with indented continuation; they are the only markup beyond headings and `-` lists.
- `## Página: Cómo nos financiamos (divulgación de afiliación)` (149-162): page heading `### Cómo se financia {siteName}` (151); intro paragraph with {siteName} (153); three bold-lead list items (157-162): "No pagas más.", "No vendemos nada.", "Ninguna tienda paga por aparecer antes."
- `## Aviso de demostración (T9.3.3)` (166-171): line 168 says "Shown on pages that list only demo offers."; the notice text is one sentence in lines 170-171, no placeholders. This is the demo-notice text location.
- `## Pie de página: enlaces` (175-179): footer labels as three list items, in order: "Aviso legal", "Privacidad", "Cómo nos financiamos". Page titles differ from two footer labels ("Política de privacidad" vs "Privacidad"; "Cómo se financia {siteName}" vs "Cómo nos financiamos").
- Placeholder use summary: {siteName} appears in Aviso legal, Privacy, Financiación; the five identity placeholders appear only in Aviso legal (30-34) and Privacy (82, 138); {ownerRegistry} appears only at line 34; {contactEmail} appears in Aviso legal, Responsable del tratamiento and Tus derechos; the demo notice and footer labels have none.
- The text is prose in the first or second person plural ("registramos", "Puedes contactar") and uses tú, consistent with the design-system voice (system.md:60).
- File line counts differ from rendered ones; line numbers above are from the file as read.

## Governing docs
Sources of truth and whether they look current.
- docs/product/mvp.md (approved 2026-10-16, amended 2026-10-18): § Legal pages (186-190) and § Delivery (178-182) govern S9.3; looks current. It says legal pages are linked "from the footer of every page" and that "pages that list only demo offers carry a short notice".
- docs/decisions/0009-click-log-and-analytics.md: no cookies for public visitors, no banner; admin session cookie strictly necessary; Umami cookieless. Matches the privacy text's cookie statements. Umami is not yet wired into any page (no script tag in src; grep).
- docs/design/system.md (approved 2026-10-21): current but has no footer or notice component rows (see contract_notes).
- agentic/capabilities/frontend.md:56-57 and ux.md:147: no literal site name, `{siteName}` in copy, force-dynamic for env readers; current.
- CLAUDE.md guardrail 5 and the run request forbid real identity values in src/, messages/, tests, docs; the privacy text promises "no IP, no browser" in click logs, consistent with the click log columns in decision 0009.
