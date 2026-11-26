# Capability pack: backend — project `los-tres`

For the `backend` lane (`engineer`). Server code, the data schema and migrations.

Slices A and B set the layout, delivery and migration conventions below. Route
shape is still to be written by the slice that adds one, through
`pack_corrections`.

---

## Contents

Read this file in full.

- **Before the stack is recorded**
- **Layout**
- **Guardrails, in code terms**
- **Definition of done for this lane**

---

## Before the stack is recorded

The stack is recorded in `CLAUDE.md` § Stack. Report `BLOCKED` if the tech-lead plan names no directory or file for what you are asked to build, or if it needs a framework or package-manager choice no recorded decision covers (`project.md` § Building before the stack exists).

## Layout

One Next.js app at the repo root, npm, Node 22. Server-only code: `src/config` (`local-flag.ts` (pure, no `server-only`, no `env.ts`): the only reader of `LOCAL_COLLECTED_DATA`, imported only by `visibility.ts`, `src/instrumentation-node.ts` and `src/cli/start-check.ts` (seams S-1, S-2); env readers, `getSiteName`, `isDemoSeedEnabled`, `getOwnerIdentity` in `owner.ts`: the only reader of `OWNER_*` and `CONTACT_EMAIL`; the four required throw "NAME is not set", `OWNER_REGISTRY` is optional), `src/db` (`getDb()`, `schema/`, `migrations/`, `runMigrations`, `category-tree.ts` (`FIXED_CATEGORY_TREE` and `ensureFixedCategoryTree`; no `server-only`, imported by `migrate.ts`, the seed and tests; its slugs are frozen public URLs, decision 0015), `vehicle-catalogue.ts` (`VEHICLE_CATALOGUE` and `ensureVehicleCatalogue`; no `server-only`; slugs frozen, retire a vehicle by removing its entry, upsert on slug; called by `runMigrations` and `resetDatabase`)), `src/server` (`visibility.ts`, `money.ts`, `matching.ts` (`matchProduct` and `selectByBrandPartNumber` take a `MatchScope`, default an unmarked row, for which marked products are invisible; the importer's `assignCategory` takes the same scope, DS-9), `slug.ts` (with `isWellFormedSlug` and `toSlugWords(text, max)`, the one slug transform that `slugify` and `brandSlug` share), `error-code.ts`, `catalogue/` (`product-page.ts`, `category-page.ts`, `category-query.ts` (pure; sort and brand parsers, `brandSlug`, the one URL-value table, code English), `search-query.ts` (pure, no `server-only`; `parseSearchTerm`, `eanCandidate`), `search-page.ts` (`getPublicSearchPage(term, page, vehicleId = null)`; names no visibility flag, logs only `search: failed (<code>)`, never the term or the vehicle id; with a car it groups fits, unknown, exact-code no-fit through `fit-listing.ts`), `category-tree.ts` (`getPublicCategoryTree`, and `getPublicSubcategories(slug)`, its projection for one root's children, #313), `fit-state.ts` (`fitStateSql` composable over products, `findActiveVehicle`, `readFitStates`, and by product slug `readProductFitState` and `readProductVehicles` (distinct counted vehicles in vehicle-list order, `FittedVehicle` = no id); names no flag, logs nothing, throws `FitStateError`: fixed message, the database code in `code`, no `cause`), `product-fit.ts` (`getProductFit(productSlug, car)`, S5.9: the banner read and the vehicles read run together, each caught on its own, so it never throws), `fit-listing.ts` (`fitScope` derived table over `fitStateSql`, `groupRankSql`, `listedFitSql`, `fitCountsSql`, `listingGroupOf`; names no flag; listings take a trailing `vehicleId` and throw a fixed error; `groupRankSql` and `fitCountsSql` take an optional `exact` (search only: a non-null boolean, `coalesce(codeMatch, false)`); with it a no-fit exact hit ranks 2 and counts in `exactNoFitCount`), `page-param.ts`, `product-jsonld.ts` (pure builder and serializer, no `server-only`: `JsonLd.tsx` imports it, decisions D-2, so it must stay free of `server-only`, `src/db` and `src/config` imports), `demo.ts` (`indexableProductWhere`, the only demo-and-collected-by-offer condition; it excludes demo and collected alike, flag-independent, S12.2), `paths.ts` (`categoryListingPath` carries `marca`, `orden` and `pagina` for chip, sort and pagination links; `categoryPath` stays the canonical-only builder; `searchPath` is the only builder of a /buscar URL), `seo.ts` and `sitemap-xml.ts` (all three pure, no `server-only`), `sitemap.ts`), `clicks/` (`go-path.ts`, `counting.ts`, `source-page.ts`, `offer-target.ts`, `record.ts`, `handle-go.ts`), `importer/`, `seed/`), `src/cli` (thin mains for `migrate`, `seed`, `import-feeds`). Files in these four directories import each other relatively, never with `@/`: the CLI is compiled by `tsc -p tsconfig.cli.json` to `dist/` and run with `node --conditions=react-server`, and tsc does not rewrite aliases. ESLint enforces it. `tsconfig.cli.json` needs `lib: ["ES2023"]`: the default ES2022 lib types `useGrouping` as boolean and rejects `'always'`. Delivery files at the root: `Dockerfile`, `docker-entrypoint.sh` (verb dispatcher: `server`, `migrate`, `seed`, `import-feeds`; unknown verb exits 64), `compose.yaml`, `docker/db-init`. Every public route is under `src/app/(public)/`, every admin route under `src/app/admin/`. The public route `src/app/(public)/go/[offer]/route.ts` exports GET, HEAD and OPTIONS as one function and builds every response in one `respond()`. The sitemap routes are `src/app/(public)/sitemap.xml/route.ts` and `src/app/(public)/sitemaps/[file]/route.ts`. `src/proxy.ts` (the first proxy; matcher: every page except /_next, /api, /go, /admin and any path with a dot; it forwards the car as two request headers and rewrites missing pages) rewrites missing product, category and past-last search URLs to `/_404` using `src/server/catalogue/missing-page.ts` (`isMissingPublicPage`), which only calls the page loaders and parsers.

`.github/workflows/gate-repeat.yml` (manual): jobs `plan`, `copy-static`/`copy-integration`/`copy-e2e` (`repeat <n> <part>`; steps, runner and timeout = the matching gate.yml job's, but the checkout ref), `timing`; inputs reach shell only through `env:` in `plan`; no `continue-on-error`, no retry words on non-comment lines (gate-determinism `retryLines`).

`src/server/car/` (S5.7, the selected car): `state.ts` (pure CarContext types, `openedWithCoche`, `selectedSlug`, `selectedVehicleId`), `request.ts` (pure; the header names `x-car-slug` and `x-car-path`, `carRequestHeaders`, called by `src/proxy.ts`, and `carSlugFromUrl`, the one `coche` rule shared with `missing-page.ts`), `context.ts` (server-only `getCarContext()`, the only reader of `x-car-slug` and `x-car-path`), `vehicles.ts` (`readActiveVehicles`), `picker.ts` (the picker tree and `resolvePickerStep`) and `return-path.ts` (pure; `parseReturnPath`, `returnPath`, `carLinks`).

Admin reads and writes live in `src/server/admin/` (server-only, no `'use server'`); `sources.ts` is the only writer of networks, shops and feeds outside the seed (insert and update, no delete anywhere; `createFileFeed(form, kind)` and the `updateFeed` file branch serve both file kinds (`catalogue_file`, `collected_file`), and no `.set()` on feeds names `sourceType` (seams S-11); its createFeed and updateFeed branch on the `source` field (create) or the stored source (edit) for a catalogue-file feed, and `displayableFileName` is called only there (S3.7, seams test); the seam, `architecture.md` § The seams the product forces); `feed-host.ts` `feedHost` is the only function that turns a stored feed URL into text, the host or null; `source-rules.ts` holds the pure form rules and notice keys (a `'use server'` file may export only async functions). `category-mappings.ts` holds the S4.2 reader and the three mapping writers; an action file may re-export their types with `export type { ... } from` (type-only). `products.ts` is the S2.4 admin product read and the only writer of the hidden flags; it sets that flag and nothing else, and the closed offers-write list is [importer/index.ts, admin/products.ts]. `product-rules.ts` holds the pure list-query and href rules and is the only server file besides auth that may name an admin path. Admin server actions live beside their page as `src/app/admin/(shell)/<route>/actions.ts` and import server code with `@/`.

Admin sign-in code is `src/server/auth`: `config.ts` (no `server-only`), `auth.ts` (`getAuth()`), `accounts.ts` (`upsertAdmin`, the only writer of `admin_users` and `admin_accounts`, and the only deleter of `admin_sessions` besides Better Auth), `guard.ts`, `actions.ts`, `origin.ts`. `src/cli` also holds `create-admin.ts` and `stdin.ts`.

`better-auth` is ESM-only and the CLI is CommonJS: a static import in the CLI graph fails `tsc` with TS1479, so import it with `await import('better-auth/crypto')`; Node 22 loads it. Never switch the CLI to ESM for this.

Compose binds every published port to `127.0.0.1`. The `app` image runs `HOSTNAME=0.0.0.0`. `.gitattributes` keeps `*.sh` LF. Pinned: TypeScript 5.9 (npm `latest` is 7.x, unverified against eslint-config-next), ESLint 9, Next 16, Postgres 17.

`src/instrumentation.ts` `register()` runs once per server under `next dev`, `next start` and `server.js`; Node-only code goes in `src/instrumentation-node.ts` behind `NEXT_RUNTIME === 'nodejs'`. A union member whose discriminant is itself a union (`'catalogue_file' | 'collected_file'`) is not removed by a `!==` test on one literal: narrow on the other member's literal instead.

Next 16 loads `.env` itself, so `npm run dev` needs no env loader. If a host port is taken (for example 3000), set `APP_PORT` in `.env`; never stop another project's container to free it.

English in code and the database, Spanish only in URLs and messages (owner ruling D-8, S11.4): identifiers, enum values, column values and collations are English or locale-neutral; Spanish appears only as public URL segments and parameter values (`categoria`, `producto`, `marca`, `orden`, `precio-desc`) and in `messages/es-ES.json`. Where a URL value is Spanish, one table maps it to the English internal value (`category-query.ts`). Name sort uses `collate "und-x-icu"`, never a Spanish collation.

Identity ids are not reused or rewound: a seed re-run burns identity values on `on conflict do nothing`, so ids 1 and 2 hold only on a fresh database. Tests and scripts look feeds up by slug or url, never assume an id after a second seed.

Working-copy files are CRLF on Windows (autocrlf), so a scripted multi-line string replace on an existing file silently does nothing: use the Edit tool and check `git diff`.

To read the SQL a builder renders, run `NODE_PATH=<repo>/node_modules node --conditions=react-server --import tsx <script>` with `PgDialect.sqlToQuery`; `server-only` needs the condition.

## Guardrails, in code terms

- **(1) Visibility.** Every public read goes through the one visibility scope,
  `src/server/visibility.ts`: approved feed, not hidden, not in the matching
  queue, and product mapped to a category (`products.category_id` is not null). The same file holds `countedFitmentWhere()` and `activeVehicleWhere()`: a fitment counts when its feed and shop are approved and the vehicle is not retired. Only admin-scoped paths approve feeds or hide items: the admin approval writer `sources.ts` and the admin hide writer `products.ts`. Seeds are
  insert-only (`on conflict do nothing`) and create nothing approved except
  rows marked `is_demo` and the demo shops, and insert the demo
  `feed_category_mappings` (on conflict do nothing). Seeds create no category: the fixed tree comes from `ensureFixedCategoryTree` at the end of `runMigrations`, and the seed throws if a fixed slug is missing. A mapping decides category
  only, never the visibility of a feed. They never change an existing row.
  The importer sets `products.category_id` after creation only from null (first
  mapped wins) and never clears it: the one product column it touches later. The admin mapping writer is the second and only other writer of that column: it moves and clears it in one transaction with the mapping record (S4.2).
  A mapping record with `category_id` null means outside scope; the importer's `loadMappings` must use `isNotNull(feedCategoryMappings.categoryId)` in Drizzle, never raw SQL text, or the S5.1 'is not null' seams rule fails. The importer's per-feed transaction takes `FOR SHARE` on its feed row and an admin mapping save takes `FOR NO KEY UPDATE` on it (S4.2, D-16).
  `SEED_DEMO_DATA` is true in `.env.example` and false by default in Compose.
  `src/server/importer/index.ts` is the only writer of `offers.is_removed` (S3.3): it sets it on a feed's live offers absent from an import that passed `decideRemoval` (`importer/removal.ts`, pure, guard 10 and 50%), clears it in the `writeOffer` upsert, and writes no other flag.
  `demoOnly` on the product and category page data is computed only in `src/server/catalogue` from `feeds.is_demo` over visible offers; no file under `src/app` or `src/components` names `isDemo`.
  Drizzle 0.45 `update().set().from(table).where().returning()` works and qualifies RETURNING columns (`setFeedApproval` reads the shop's flag in the same statement).
  The category and product read models inner-join `categories` and return `categorySlug`; the join is not a filter (`isNotNull` stays in `visibility.ts`).
  Sitemap and `indexable` = `indexableProductWhere()` (`demo.ts`; excludes demo and collected alike, flag-independent, S12.2); the literal call must appear in `sitemap.ts`;
  marked rows are excluded only inside `visibleOfferWhere`/`visibleProductWhere` via `collectedRowsShown()`; `markedFeedSql`/`markedProductSql` are named only in `visibility.ts`, `demo.ts`, `offer-target.ts` and `category-mappings.ts` (seams S-7); seams C-4 reads the literal text `collectedRowsShown() ? undefined : not(markedFeedSql())` (and the `markedProductSql` twin) inside the bodies of `visibleOfferWhere` and `visibleProductWhere`, so a refactor must keep that expression written in those two bodies;
  the not-public reason (US-2.5) is computed only in `visibility.ts` from `offerRules`/`productRules`, the same tables the public conditions AND; admin files only select it;
  admin counts take their conditions from `visibility.ts`: `currentOfferWhere()` (not removed) and `offerOnSiteWhere()` (`visibleOfferWhere` AND `visibleProductWhere`, the S2.5 on-site meaning); `sources.ts` names neither flag (S2.6);
  `/admin/categorias` `hasOffers` comes from `category-mappings.ts`'s own `carried` and `emptyCells` reads (any offer row), not from `AdminFeed.offerCount` (S2.6 D-5);
  `products.is_collected` is written only in `createProduct` (`importer/index.ts`), once, from the feed's source kind (seams S-4, S-5); `demo.ts` names `feeds.isDemo` only inside `src/server/catalogue`.
- **(2) No scraping in this repo.** The importer fetches only the URL of a feed registered in
  the database, and parses it as CSV or XML feed data (a file from the owner's
  separate local-only collector is such a feed, decision 0017). Never add a
  crawler, a headless browser or an HTML parser for shop pages to this repo.
  `src/server/importer/source.ts` is the only place that fetches or reads a
  feed. It is also the only place in src/ that names the folders `catalogue-files/` and `collected-files/` (S12.2; a `collected_file` feed reads only the second, through the same `readCatalogueFile`); `src/server/catalogue-file-name.ts` is the pure name rule shared by the admin writers and the importer (seams test). `src/server/importer/fitments.ts` is the only writer of `fitments` (a seams test fails on any other); a new optional feed column is appended last to `OPTIONAL_COLUMNS` in `validate.ts`, which XML picks up through `CANONICAL_COLUMNS`; new report fields are zeroed in `emptyReport` and printed in `report.ts`; a new offers write stays in `importer/index.ts`, and a pure helper module beside it must not contain the text `update offers` or `.update(offers)`, even in a comment, or the seams offer-writer list grows.
- **(3) Roles.** Every route declares whether it is public or admin. Admin
  routes and server actions check the session on the server. The session check is `src/server/auth/guard.ts` (`requireAdminPage`, `requireAdminAction`, `checkAdminSession`); sign-in and sign-out are `src/server/auth/actions.ts`, the only code that writes a cookie. Better Auth runs through `auth.api` only, with no `nextCookies` plugin and no route handler.
- **(4) Money.** Integer cents, through the single money helper,
  `src/server/money.ts` (parse and format).
  Feed prices are parsed from their decimal text straight to cents, never
  through a float. No float column and no float arithmetic.
- **(5) Personal data.** The click row (`src/db/schema/clicks.ts`) has no IP, user agent, cookie or referer field; `source_page` is a same-origin site path validated in code and by a database check.
  - Only `src/server/clicks/counting.ts` reads the user agent, in memory.
  - Only `src/server/clicks/record.ts` writes `clicks`.
  - Every offer in a fresh dev or e2e database sits on a demo feed, so a `/go` request never writes a click there.
  - A counted click is provable only in the integration project, where a test makes a non-demo feed.
  - `admin_sessions.ip_address` and `user_agent` are always null (hook plus check constraint); Better Auth stores `''` and the request UA by default.
  The selected car is request-only: the `x-car-slug` and `x-car-path` request headers, never a cookie, a response header, storage or a log line; a failed vehicle read logs only `car: vehicles failed (<code>)`.
  Never log a search term, query string or URL; a Drizzle query error message embeds its bound params, so a loader that takes user text catches, logs `errorCode(error.cause)` only and rethrows a fixed Error with no cause.
  A read that takes a car or a slug and throws keeps the driver error out of the thrown value: `FitStateError` carries only `errorCode(driver)` in `code`, and its catcher logs `errorCode(error)` (the code is already on the thrown value, which has no cause to read).
  **A supplementary read degrades, it does not fail the page** (S5.9, `product-fit.ts`): a read that adds to a page that already has its own data (the product page's fit banner and vehicle list) is caught where it is composed, logs one fixed `<module>: <read> failed (<code>)` line naming no car, id, slug or product, and returns a marker (`'unchecked'`, `null`) the page renders as a notice or an omission. Two such reads fail independently. A listing's read still fails the page (S5.8).
  Admin form actions log only `admin-sources: refused (ORIGIN)` or `admin-sources: failed (<code>)`, the code read from `error.cause` then `error`; never an error message (a `DrizzleQueryError` message carries the bound params, i.e. the feed URL). A catalogue-file name is never logged or returned in a refusal: a writer returns the fixed code only, and the read returns the name only through displayableFileName. Redirects sit after the `try`.
  Admin category actions log only `admin-categories: refused (ORIGIN)` or `admin-categories: failed (<code>)`; the code comes from `driverErrorCode` in `error-code.ts` (the `error.cause` code, else the error's own); never a feed category, id or message.
  Admin product actions log only `admin-products: refused (ORIGIN)` or `admin-products: failed (<code>)`, the code from `driverErrorCode`; the admin reads log `admin-products: failed (<code>)` once and throw a fixed Error with no cause, because the bound search term is in Drizzle's message.
  Log ids, not emails. Read secrets from the environment, and add each new
  variable to `.env.example`: secrets blank and generated by
  `npm run env:init`, non-secret settings with their local default. Never read
  `process.env` at module load; read it in a function.
  `compose.yaml` forwards optional or legal-identity values as `${NAME:-}` and never `:?`, so `migrate`, `import-feeds` and the e2e setup keep working with them blank.
- **Import side effects.** Importing a `src/db` or `src/config` module must not
  open a connection or throw; `next build` runs with no database.
- **Imports are isolated.** One failing feed records its error in its import
  report and never stops the other feeds.
- **Migrations.** Every schema change is a migration, never a hand edit to
  the database. `npm run db:generate -- --name <name>` writes SQL to
  `src/db/migrations/`; commit it. Once a migration is merged to `main` it is
  never edited. The app container migrates on every `server` start.
  drizzle-kit is pinned `^0.31.11` against drizzle-orm 0.45.4.
  A generated tsvector column depends on SQL objects (extension, text-search configurations, functions): prepend them by hand to the generated SQL, each ending `--> statement-breakpoint`; drizzle-kit writes only the column and indexes.
  A new enum value cannot be compared in the transaction that adds it: a CHECK in the same migration casts the column, `source_type::text <> 'x'` (S3.7, migration 0008).
- **Feed URLs and lint.** A feed URL may hold an API key: never print or log
  one; CLI mains print only an error code. ESLint `no-restricted-imports`
  overrides do not merge: an override must repeat the scraping-library
  patterns.

## Definition of done for this lane

- [ ] Every guardrail above checked against your diff, with any tension named
      in `risks`
- [ ] `npm run check` run and passing (0006 rule 8); the full `npm run gate` runs at the integration review
- [ ] Contract notes emitted for every field the frontend will consume
- [ ] A change to feeds or the importer is verified with a real import on a scratch database, not the dev volume (create db, set `DATABASE_URL`, migrate, seed, import, drop)
- [ ] Compose logs checked for no feed URL, database URL or `.example` host
      (Next's own `http://localhost:3000` and `http://0.0.0.0:3000` start-up
      lines are expected)
- [ ] Any convention you established (path, command, pattern) written as a
      `pack_corrections` entry for this file
