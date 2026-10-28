# Capability pack: testing — project `los-tres`

For the `test-engineer` lane.

Slice A set the runners, commands and directory layout (§ Running tests).
Whoever adds a runner, fixture or command convention records it here through
`pack_corrections`.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **What must always be covered** · **Shared scaffolding and gotchas** · **Definition of done for this lane**

| Section | Read it when |
|---|---|
| Running tests | you are running or adding tests, or touching a test config |

---

## Running tests

Vitest 5 with two projects in `vitest.config.mts` (the package stays CommonJS; the config uses `import.meta.dirname`): `unit` (`tests/unit`, no database, no network) and `integration` (`tests/integration`, serial, real PostgreSQL, database `${DB_NAME}_test` on the Compose `db` service, pointed at by `tests/support/test-database-env.ts`, needs `npm run db:up`). `tests/support/global-setup.ts` drops and recreates `${DB_NAME}_test` on every integration run (`drop database ... with (force)`) and migrates it with `runMigrations` from `src/db/migrate.ts`. Integration files call `resetDatabase()` (`tests/support/db.ts`) in `beforeEach` and `closeDb()` in `afterAll`. Playwright in `tests/e2e`, chromium only, against the Compose `app` at `E2E_BASE_URL` (default `http://127.0.0.1:${APP_PORT}`), no webServer, needs `npm run stack:up`. Commands: `npm run test:unit`, `test:integration`, `test` (both), `test:e2e`, `test:e2e:install`, and `npm run gate` = lint, tsc, db:up, test, stack:up, test:e2e. Env comes from `.env` via `process.loadEnvFile`. Helpers in `tests/support`, fixtures in `tests/fixtures`.

`CLAUDE.md` § Commands is the authority for the command list.

`vitest.config.mts` and `playwright.config.ts` must not import from `tests/`: tsconfig includes them, `next build` typechecks them in the image, and `.dockerignore` removes `tests/`. Put shared logic behind `setupFiles` or `globalSetup` instead (Playwright's takes a string path).

E2E data comes from Playwright `globalSetup` (`tests/e2e/global-setup.ts`), which runs `docker compose run --rm -T --no-deps app import-feeds` and throws a named message on `feeds=0` (quoted in `CLAUDE.md` § Commands). The e2e write rule is in § What must always be covered.

`legal.spec.ts` branches on the host `.env`: all four required `OWNER_*` values non-blank means 200 and values asserted as booleans (never printed), otherwise 500 and no brace in the visible text. To exercise the 200 branch without touching `.env`, export fake `OWNER_*` in the shell, run `docker compose up -d app`, run playwright with the same exports, then unset and run `docker compose up -d app` again.

Integration workers get fixed `AUTH_SECRET` and `SITE_URL` (`http://127.0.0.1:3000`) from `tests/support/test-database-env.ts`, so admin tests run without them in `.env`. Server components and actions are called directly with `next/headers` mocked: `vi.mock('next/headers', async () => (await import('../support/next-request')).nextHeadersModule)`; `startAdminRequest({cookie, origin})` sets the request, `nextRequest.cookieWrites` records every cookie the code under test would send, `redirectOf(fn)` returns the `NEXT_REDIRECT` target.

Actions in `src/app/admin` are tested by importing them with `next/headers` mocked and `next/cache` mocked as `{ revalidatePath: vi.fn() }`; without the second mock `revalidatePath` throws outside a Next request.

`e2e/admin.spec.ts` is serial and creates its admin with `docker compose run --rm -T --no-deps app create-admin` (stdin: email, then password; the fixed e2e admin is defined in that spec). A re-run ends that admin's sessions, so no other spec may use the account. It needs `AUTH_SECRET` and `SITE_URL` in the container: without them the sign-in answers unavailable and the spec throws a hint. To run it on an old `.env` without editing it: export `AUTH_SECRET` (32+ chars) and `SITE_URL=http://127.0.0.1:<APP_PORT>` in the shell, run `docker compose up -d --build --wait`, run playwright with the same exports, then `docker compose up -d app` in a clean shell.

E2E canonical, robots and sitemap checks read the `baseURL` origin, which equals `SITE_URL` in `.env` (the app container reads it); demo data makes the indexable side e2e-unreachable, so it lives in `integration/indexable.test.ts`.

The default host port is 3010 and may be taken, so never write a literal base URL: specs use the `baseURL` and `request` fixtures, and only `playwright.config.ts` computes it from `.env` (`appBaseUrl()` is gone).

Home e2e selects `home-panel`, `home-search[-input|-button|-notice]`, `home-all-link`, `home-all-count`, `category-tiles`, `category-tile[-link|-name|-count]` and `site-header-link`; the home count text is `icuPlural(messages.Home.productCount, n)`. Demo state is four tiles (the empty fuel category has none, in position order); the five-tile and one-tile states are unit renders (S11.3).

A raw-HTML "value never appears" assertion must strip `<script>` blocks first: Next puts the request URL (query included) in the inline flight payload, so the typed `q` is in the raw response even though app code never renders it.

Listing e2e select only by the `data-testid` values of the design contract; the category name is read by `getByRole` heading level 1. Category pages are server pages: parse `request().get` HTML with `openRawHtml` for JS-off checks.

Category listing (S11.4): integration tests call `getPublicCategoryPage(slug, page, brand, sort)` and set `products.brandNormalised` and `partNumber` themselves (`insertListedProduct` sets neither; the local helper `listBranded` in `category-page.test.ts` does it). Canonical on `?marca=`/`?orden=` is proven by importing `generateMetadata` from `src/app/(public)/categoria/[slug]/page` in an integration test with `vi.mock('next-intl/server', () => ({ getTranslations: async () => (key) => key }))`; `SITE_URL` comes from `test-database-env.ts`.

The product e2e clicks nothing; the Referer click source is proven once in `go.spec.ts`, `product.spec.ts` asserts only that anchors are plain (no target, noreferrer, referrerpolicy, meta referrer).

Product JSON-LD e2e reads the raw `request.get` HTML with a regex over script tags (expect one match) and `JSON.parse`, then `openRawHtml` for the selector and the visible-price comparison; selector `script[type="application/ld+json"][data-testid="product-jsonld"]`.

The nested 404 (`notFound()` raised inside `(public)`) is client-rendered; assert its DOM and `document.title` in a browser (`tests/e2e/not-found.spec.ts`), not on raw HTML. A Tab walk right after `goto` can lose the first Tab to hydration: wait for the button visible and `networkidle` before pressing.

Expected site name and copy come from `SITE_NAME` in `.env` and `messages/es-ES.json`, never a literal. Raw server HTML is parsed by `page.setContent` in a context with `javaScriptEnabled: false`, not by an HTML parser dependency.

## What must always be covered

These are the guardrails' tests. A slice that touches a seam owes the
matching test, and it should be one that would fail if the rule broke:

- **(1)** No public read (search, category, product page, sitemap,
  `/go/<offer>`) returns an offer from an unapproved or disabled feed, a hidden
  product or offer, or a product waiting in the matching queue.
  - A product with `products.category_id` null is not public: assert it on the shared scope (`visibility.test.ts`), the product page, `/go` and the category page. `tests/unit/seams.test.ts` keeps the `isNotNull(products.categoryId)` condition in `src/server/visibility.ts` only.
- **(2)** The importer refuses a source that is not a registered feed.
- **(3)** An anonymous request cannot reach any admin route or server action.
  - Proven by `tests/integration/admin-routes.test.ts`: any page, layout or route handler under `src/app/admin` that answers anonymous with content fails, and every `'use server'` export in `src` must start with `requireAdminAction` plus `isAdminRefusal` except `signInAction` and `signOutAction`; a `'use server'` file outside `src/server/auth`, `src/app/admin` and `src/components/admin` fails.
  - `findUnguardedAdminRoutes` also calls the `generate*` exports of admin pages and layouts; entries look like `file#generateMetadata`; `admin/layout.tsx` is in `METADATA_ALLOWLIST` (static title, serves sign-in).
- **(4)** Feed prices parse to integer cents. Include a case where float
  parsing would round wrongly (for example `19.99`, `0.29`).
- **(5)** A `/go/<offer>` click row holds no IP, user agent or cookie, and the
  response sets no cookie.
  - Counting rules are proven in the integration project one rule at a time on an otherwise countable request.
  - The e2e cannot show a counted row because every e2e offer is a demo offer.
  - The privacy test spies on `console.*` and reads `row_to_json` of the click row.
  - Admin cookie rules: only `signInAction` writes a cookie (`nextRequest.cookieWrites` is empty for every refusal, guard call and expired cookie); `admin_sessions` `ip_address` and `user_agent` are null (`admin-storage.test.ts`); sentinel logs in `admin-logs.test.ts`; the public no-cookie e2e stays on public routes and `admin.spec.ts` asserts the one `admin.session_token` cookie.
- **Matching (0008), slice B cut:** EAN attach, EAN with a different brand
  rejected into the report (`ean_brand_conflict`), null brand on either side
  attaches, no EAN creates a product, invalid EAN rejected. Brand + part-number
  matching and the queue are tested when they ship.
- **es-ES prices and seams.** Assertions on es-ES prices normalise U+00A0
  (`normaliseSpaces`, `tests/support/messages.ts`). `tests/unit/seams.test.ts`
  scans the source so the visibility flags, `fetch(`, `node:fs`, `@/db` in
  pages and `/ 100` stay out of places they do not belong.

- **Sitemap and robots seam.** `seams.test.ts` `isSitemapOrRobotsFile` covers metadata files, route handlers under `sitemap.xml/` and `sitemaps/`, and `src/server/catalogue/sitemap*.ts`, and asserts at least 5 files so it cannot go vacuous.

- **Fixture size.** A fixture-size change reaches literals outside `tests/fixtures/demo.ts` that a grep for the constant misses: `entrypoint.spec.ts` `feeds=2`, the page-count and page-length asserts, seed `approvedFeeds`. After changing the demo size grep tests for `feeds=`, `toHaveLength(1|2)`, `pageCount`, `[1, 2]` and `ROOT, 2`.

- **Count text.** A count-text guard must not substring-match (`/0 producto/` matches "50 productos"): anchor with `(^|\D)`, and escape query strings correctly in a template-literal RegExp.

- **Demo notice.** Any e2e that reads the first paragraph of `main` on a demo product or category page must skip `p[role=note]`.

Never call a live affiliate network in a test. Import from local fixture feed
files.

Any integration test or helper that writes to the database calls `assertTestDatabase()` (`tests/support/db.ts`) first, so it only ever writes `${DB_NAME}_test`; e2e writes only through `import-feeds` in `globalSetup` (§ Running tests).

Every public response is asserted to have no `Set-Cookie`; a browser visit also asserts `context.cookies()` is empty and no request leaves the app origin. The one exception is the `/go` click-through, which asserts the browser's request to the shop's `.example` host (§ Shared scaffolding and gotchas).

## Shared scaffolding and gotchas

- `tests/support/catalogue.ts`: insert helpers whose defaults are the fully
  VISIBLE state, so a test sets only the one flag it is about. `insertProduct` defaults `categoryId` to a shared test category (`defaultCategoryId`, found by slug so it survives `resetDatabase`); pass `categoryId: null` for the unmapped state. `insertCategory({slug,name,parentId,position})`, `insertCategoryMapping` and `insertListedProduct` (a product with one visible offer per price) live in the same file.
- Category feed fixtures are `tests/fixtures/feeds/category-*.csv` (mixed, ean-one/two/three, no-column); demo category expectations are `DEMO_CATEGORY_COUNTS` and `DEMO_CATEGORY_NAMES`, keyed by the six fixed slugs, in `tests/fixtures/demo.ts`, and `DEMO_COUNTS` carries `publicProducts` and `categoryMappings`. `DEMO_NO_BRAND` is the oil (`aceite-de-motor`); `DEMO_DRILL` and `DEMO_WRENCHES` are unmapped and never public; the paging dataset is the root (50, three pages); e2e specs use `rootPageUrls`, never a hardcoded page 2; `filtros-de-combustible` is the empty child. `DEMO_FEED_ROWS` is `{ uno|dos|tres|cuatro: {rows, productsCreated} }`; `DEMO_FILLER` is gone; `DEMO_CHEAPEST`, `DEMO_FOUR_OFFERS` and `DEMO_ILLUSTRATED` are new. `tests/unit/demo-feeds.test.ts` reads `demo/feeds/*.csv` with `parseCsv`, `readHeader` and `validateRow` and pins the CSV invariants; `tests/unit/category-illustration.test.ts` renders all five drawings.
- `resetDatabase` re-ensures the fixed category tree (`ensureFixedCategoryTree`) after truncating, so tests must not assume an empty `categories` table or ids starting at 1: the six fixed categories take ids 1 to 6. Fixed slugs come from `FIXED_CATEGORY_TREE` in `src/db/category-tree.ts`; e2e specs import it by relative path. Never retype a fixed slug.
- A migration SQL file is tested by reading it, splitting on `--> statement-breakpoint` and executing each statement with `sql.raw` against legacy rows (`tests/integration/fixed-category-tree.test.ts`, with `tests/unit/category-tree-constant.test.ts` as the template for pinning fixed reference data).
- A malformed category slug needs no DB bypass, `categories.slug` has no check constraint; insert it directly. A parent cycle is built by inserting then updating `parent_id`.
- `tests/support/feeds.ts`: `fixtureDeps`, where a feed row's `url` is the
  fixture file name, and `textDeps`. Local feed files live in
  `tests/fixtures/feeds/`; shipped-demo expectations in `tests/fixtures/demo.ts`.
- `tests/support/network-off.ts`: `stubNetworkOff`; every importer test stubs
  fetch to throw.
- `tests/support/go.ts`: `callGo(offer, {method, headers})` calls the route's GET/HEAD/OPTIONS with a countable default request (Host `shop.test`, browser UA; a header set to null is removed), `allClicks()`, `insertGoOffer({shop, feed, product, offer})` (visible by default, `feed.isDemo` for demo).
- Playwright `page.route` does not intercept the redirect target of a navigation (`/go` 302 to a shop host): the click-through asserts the browser's request to the `.example` host with `page.waitForRequest`, and the page ends on a chrome-error page.
- Force a failure in the real route by `vi.mock` of `@/server/clicks/record` or `@/server/clicks/offer-target` with `importOriginal` and a `vi.hoisted` switch.
- A `\b` in a Python non-raw string, a Python heredoc or a regex literal (in an e2e spec too) written into a test file becomes a backspace character, so write regexes with Write or a raw string.
- `tests/integration/product-jsonld.test.ts` feeds `getPublicProductBySlug` into `buildProductJsonLd` to prove hidden and unapproved offers cannot reach the JSON-LD.
- The escape for U+2028 or U+2029 (backslash, `u`, then the four digits) typed in a test string literal may arrive as the raw character: use `String.raw` for expected escape text.
- Check a written test file for a stray raw character with `cat -A`.
- `tests/support/admin.ts`: `createAdmin`, `signInForCookie` (real Better Auth sign-in, returns cookie/setCookie/token), `requestWith(cookie)`, `expireSessionRow`, `forge`, `sessionRows`/`accountRows`/`userRows`. `tests/support/admin-routes.ts`: `findUnguardedAdminRoutes(appDir, allowlist?, metadataAllowlist?)` (AC 22; imports each admin page and handler and calls it anonymously; returns sorted entries, `file` for an unguarded page or handler, `file#name` for an unguarded generate export; allow-list `admin/acceso/page.tsx`) and `unguardedActions(file, code)`; fixtures in `tests/fixtures/admin-routes/{guarded,unguarded,unguarded-metadata}`.
- A second e2e admin account is allowed for a spec that needs a signed-in admin: create it with `create-admin` under its own email (`admin-sources.spec.ts` uses `e2e-sources-admin@example.test`); only the first account is reserved to `admin.spec.ts`. There is no delete verb, so the account stays in the dev database.
- A server action's failed state is reached in e2e without a write by rewriting the hidden id input to an id no row has (`2000000000`, under the integer ceiling) before confirming. A `page.route` that fulfils the action POST (header `next-action`) with a 500 also gives the row error block, now that `SourceRow` wraps the action in try/catch; a component that does not wrap it shows Next's global error page instead.
- Replaying a server action anonymously: capture the browser request with `page.route` and `route.abort()` (the `Next-Action` header and the multipart body), rewrite the id field (`_1_id`) to a missing row, and post it with `playwright.request.newContext`, with the session cookie as control and without as the test. The anonymous answer carries `x-action-redirect` to `/admin/acceso`.
- A Playwright `request` fixture keeps a cookie jar: after a successful sign-in the next POST carries the session and the sign-in page redirects to `/admin`. Use `playwright.request.newContext` per post when proving a refusal. Chromium ignores a `route.continue` override of the `Origin` header, so prove the Origin check with a raw multipart POST to `/admin/acceso` built from the page's hidden `$ACTION_*` inputs, with a control post from the site origin.
- A server-only module imported in a vitest page-module call (`await import(path)` then call `default` with `{params, searchParams}` promises) works under the existing alias; real `next/navigation` `redirect()` throws an error whose digest is `NEXT_REDIRECT;replace;<url>;307;` and needs no mock.
- Better Auth under vitest: `vi.useFakeTimers({ toFake: ['Date'] })` moves session expiry correctly (it compares in JS), `pg` still works. Compile the CLI inside the test (`node node_modules/typescript/bin/tsc -p tsconfig.cli.json` in `beforeAll`) before spawning `dist/cli/*.js` with `--conditions=react-server`, so a stale `dist` cannot pass.
- S6.2 tests: sitemap routes are called directly (`GET` from `sitemap.xml/route` and `sitemaps/[file]/route`, with `params` as a Promise; `SITE_URL` comes from `test-database-env.ts`, `vi.stubEnv('SITE_URL','')` gives the 503 path); the 10,000-product fixture is one `generate_series` insert in `sitemap-performance.test.ts`.
- Also in `tests/support`: `pg-error.ts`, `page-checks.ts`, `messages.ts`.
- `expectLocalScriptsAndLinks(page, { allowHrefs })` lets exact hrefs through (legal pages pass the `mailto:` and `https://www.aepd.es`); `expectLegalFooter(page)` asserts the contentinfo landmark, three exact hrefs and labels, no `p` or heading. Legal content components render in unit tests with `createTranslator` from `use-intl/core` and the real messages; the owner fake values are in `tests/unit/owner-config.test.ts` and `legal-pages.test.ts`.
- React components render in the unit project with `renderToStaticMarkup` from
  `react-dom/server` and `createElement`; `.module.css` imports need no config.
- The ESLint Node API runs in Vitest (`new ESLint({cwd})`, `lintText(code,
  {filePath})` on virtual paths under `src/`). The first call loads
  eslint-config-next and takes seconds, so those tests pass a 60 s timeout.
- `getDb` caches its pool: close it with `closeDb()` before and after
  `vi.stubEnv` changes `DATABASE_URL`.
- Prove a malformed slug runs no query black-box: stop the pool, point
  `DATABASE_URL` at an unused port, call the read function. A malformed slug
  returns null; a well-formed one rejects.
- On Windows (autocrlf) existing files are CRLF, so a scripted multi-line
  string replace silently does nothing: use the Edit tool, which matches
  across CRLF, and check `git diff`.
- A Python script that opens a file with `open(p,'wb')` before building the
  content truncates it if the build raises: read, build, then write. Pass
  `encoding='utf-8'`; the default is cp1252.
- Category e2e demo facts (after one import): `filtros-de-aire` has 6 brands of 2 products, `aceite-de-motor` 7, the root 15 (on 1280 the root shows 8 chips plus "Más marcas (7)" (wide list); on 375 it shows 2 brands plus "Más marcas (13)" (narrow list); `filtros-de-aire` shows all six at 1280 and 2 plus "Más marcas (4)" at 375; `total` is outside the first 8); no demo brand has more than one page on the root, so a brand's pagination is not e2e-reachable. `DEMO_NO_BRAND` has no part number (no spec line); `DEMO_SHARED` has "OC 1234".
- A JS-off interaction (form submit) uses `browser.newContext({ javaScriptEnabled: false, baseURL })`, not `openRawHtml`, which is for static HTML only. A ring drawn on a stretched link is on `::after`: read `getComputedStyle(node, '::after')` when the element's own outline is none.
- `sed -i` in Git Bash strips CRs from CRLF test files; use Edit or a Python read/replace/write with `newline=''`.
- A long Bash heredoc containing apostrophes failed to parse: use Write.
- `tests/unit/styles.test.ts` (S11.1, #242) scans every css file under `src`, comments included, for `box-shadow`, `transition`, `transform`, `animation`, `100vw`, raw colours outside `:root` and a `var(--x)` with no `:root` definition; its pure helpers are exercised on in-memory CSS. Never name a variable `module` in a test: `@next/next/no-assign-module-variable` fails lint.
- A Bash command holding several heredocs with apostrophes inside TypeScript strings failed to parse (exit 2, nothing ran): write test files with Write and run edit scripts from the scratchpad.
- S11.5 product page: integration `product-page.test.ts` seeds trails with `insertCategory({parentId})` and ties with `insertListedProduct({prices})`; a parent cycle is built as above. e2e testids: `breadcrumb`, `product-brand`, `product-price`, `shop-count` (hero), `best-price`, `product-description`, `offer-go` (visible 'Ir a la tienda', aria-label has the shop).

- Brand chips render twice (S11.6). e2e select through the helpers in `category.spec.ts`: `brandList(page, 'wide'|'narrow')` = `brand-chips-<which>`, and `brandChips`/`chipAll`/`chipMore` take the same argument. The default viewport (1280) shows the wide list; the narrow list is the one on screen below 40rem, so a phone test passes `'narrow'` and filters hidden chips with `.filter({ visible: true })` because the closed details holds them. Never select by the bare `brand-chip`, `brand-chip-all` or `brand-more` testid. Raw-HTML pages (`openRawHtml`) have no stylesheet, so both lists are visible there: scope to one.
- eslint ignores `agentic/runs/**` (scratch scripts in run dirs); a `.cjs` left there no longer fails `npm run lint`.

## Definition of done for this lane

- [ ] Every seam the slice touched has its guardrail test above
- [ ] Tests assert the contract, not the implementation
- [ ] Any runner, fixture or command convention you established written as a
      `pack_corrections` entry for this file
- [ ] The local stack left as you found it: containers you started stopped,
      `.env` and compose state you changed restored, test data you created
      (admin accounts, imported feeds) deleted unless a spec's fixture or
      Playwright `globalSetup` owns it; anything you could not undo named in `risks`
