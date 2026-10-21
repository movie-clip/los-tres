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

Umami answers 307 at `/`. Assert 200 on `/api/heartbeat`, and on `/` only through a client that follows redirects. Host port 3000 may be taken, so never write a literal base URL: specs use the `baseURL` and `request` fixtures, and only `playwright.config.ts` computes it from `.env` (`appBaseUrl()` is gone).

Home e2e selects by the S5.2 testids (`home-panel`, `category-tree`, `category-group[-link|-count]`, `category-row[-link|-count]`, `site-header-link`); the home count text is `icuPlural(messages.Home.productCount, n)`.

Listing e2e select only by the `data-testid` values of the design contract; the category name is read by `getByRole` heading level 1. Category pages are server pages: parse `request().get` HTML with `openRawHtml` for JS-off checks.

Product JSON-LD e2e reads the raw `request.get` HTML with a regex over script tags (expect one match) and `JSON.parse`, then `openRawHtml` for the selector and the visible-price comparison; selector `script[type="application/ld+json"][data-testid="product-jsonld"]`.

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
- **(4)** Feed prices parse to integer cents. Include a case where float
  parsing would round wrongly (for example `19.99`, `0.29`).
- **(5)** A `/go/<offer>` click row holds no IP, user agent or cookie, and the
  response sets no cookie.
  - Counting rules are proven in the integration project one rule at a time on an otherwise countable request.
  - The e2e cannot show a counted row because every e2e offer is a demo offer.
  - The privacy test spies on `console.*` and reads `row_to_json` of the click row.
- **Matching (0008), slice B cut:** EAN attach, EAN with a different brand
  rejected into the report (`ean_brand_conflict`), null brand on either side
  attaches, no EAN creates a product, invalid EAN rejected. Brand + part-number
  matching and the queue are tested when they ship.
- **es-ES prices and seams.** Assertions on es-ES prices normalise U+00A0
  (`normaliseSpaces`, `tests/support/messages.ts`). `tests/unit/seams.test.ts`
  scans the source so the visibility flags, `fetch(`, `node:fs`, `@/db` in
  pages and `/ 100` stay out of places they do not belong.

Never call a live affiliate network in a test. Import from local fixture feed
files.

Any integration test or helper that writes to the database calls `assertTestDatabase()` (`tests/support/db.ts`) first, so it only ever writes `${DB_NAME}_test`; e2e writes only through `import-feeds` in `globalSetup` (§ Running tests).

Every public response is asserted to have no `Set-Cookie`; a browser visit also asserts `context.cookies()` is empty and no request leaves the app origin. The one exception is the `/go` click-through, which asserts the browser's request to the shop's `.example` host (§ Shared scaffolding and gotchas).

## Shared scaffolding and gotchas

- `tests/support/catalogue.ts`: insert helpers whose defaults are the fully
  VISIBLE state, so a test sets only the one flag it is about. `insertProduct` defaults `categoryId` to a shared test category (`defaultCategoryId`, found by slug so it survives `resetDatabase`); pass `categoryId: null` for the unmapped state. `insertCategory({slug,name,parentId,position})`, `insertCategoryMapping` and `insertListedProduct` (a product with one visible offer per price) live in the same file.
- Category feed fixtures are `tests/fixtures/feeds/category-*.csv` (mixed, ean-one/two/three, no-column); demo category expectations are `DEMO_CATEGORY_COUNTS` and friends in `tests/fixtures/demo.ts`, and `DEMO_COUNTS` carries `publicProducts` and `categoryMappings`.
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
- Also in `tests/support`: `pg-error.ts`, `page-checks.ts`, `messages.ts`.
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
- On Windows (autocrlf) existing files are CRLF, so a multi-line Edit
  `old_string` fails: use single-line edits or rewrite the file with Write.
- A Python script that opens a file with `open(p,'wb')` before building the
  content truncates it if the build raises: read, build, then write. Pass
  `encoding='utf-8'`; the default is cp1252.
- A long Bash heredoc containing apostrophes failed to parse: use Write.
- A Bash command holding several heredocs with apostrophes inside TypeScript strings failed to parse (exit 2, nothing ran): write test files with Write and run edit scripts from the scratchpad.

## Definition of done for this lane

- [ ] Every seam the slice touched has its guardrail test above
- [ ] Tests assert the contract, not the implementation
- [ ] Any runner, fixture or command convention you established written as a
      `pack_corrections` entry for this file
