# Capability pack: backend — project `los-tres`

For the `backend-engineer` lane. Server code, the data schema and migrations.

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

One Next.js app at the repo root, npm, Node 22. Server-only code: `src/config` (env readers, `getSiteName`, `isDemoSeedEnabled`), `src/db` (`getDb()`, `schema/`, `migrations/`, `runMigrations`), `src/server` (`visibility.ts`, `money.ts`, `matching.ts`, `slug.ts` (with `isWellFormedSlug`), `error-code.ts`, `catalogue/` (`product-page.ts`, `category-page.ts`, `category-tree.ts`, `page-param.ts`, `product-jsonld.ts` (pure builder and serializer, no `server-only`: `JsonLd.tsx` imports it, decisions D-2, so it must stay free of `server-only`, `src/db` and `src/config` imports)), `clicks/` (`go-path.ts`, `counting.ts`, `source-page.ts`, `offer-target.ts`, `record.ts`, `handle-go.ts`), `importer/`, `seed/`), `src/cli` (thin mains for `migrate`, `seed`, `import-feeds`). Files in these four directories import each other relatively, never with `@/`: the CLI is compiled by `tsc -p tsconfig.cli.json` to `dist/` and run with `node --conditions=react-server`, and tsc does not rewrite aliases. ESLint enforces it. `tsconfig.cli.json` needs `lib: ["ES2023"]`: the default ES2022 lib types `useGrouping` as boolean and rejects `'always'`. Delivery files at the root: `Dockerfile`, `docker-entrypoint.sh` (verb dispatcher: `server`, `migrate`, `seed`, `import-feeds`; unknown verb exits 64), `compose.yaml`, `docker/db-init`. Every public route is under `src/app/(public)/`, every admin route under `src/app/admin/`. The public route `src/app/(public)/go/[offer]/route.ts` exports GET, HEAD and OPTIONS as one function and builds every response in one `respond()`.

Compose binds every published port to `127.0.0.1`. The `app` image runs `HOSTNAME=0.0.0.0`. `.gitattributes` keeps `*.sh` LF. Pinned: TypeScript 5.9 (npm `latest` is 7.x, unverified against eslint-config-next), ESLint 9, Next 16, Postgres 17, Umami `postgresql-v2.20.2`.

Next 16 loads `.env` itself, so `npm run dev` needs no env loader. If a host port is taken (for example 3000), set `APP_PORT` in `.env`; never stop another project's container to free it.

Identity ids are not reused or rewound: a seed re-run burns identity values on `on conflict do nothing`, so ids 1 and 2 hold only on a fresh database. Tests and scripts look feeds up by slug or url, never assume an id after a second seed.

Working-copy files are CRLF on Windows (autocrlf), so a scripted multi-line string replace on an existing file silently does nothing: use the Edit tool and check `git diff`.

## Guardrails, in code terms

- **(1) Visibility.** Every public read goes through the one visibility scope,
  `src/server/visibility.ts`: approved feed, not hidden, not in the matching
  queue, and product mapped to a category (`products.category_id` is not null). Only admin-scoped paths approve feeds or hide items. Seeds are
  insert-only (`on conflict do nothing`) and create nothing approved except
  rows marked `is_demo` and the demo shops, and insert the demo
  `feed_category_mappings` (on conflict do nothing); a mapping decides category
  only, never the visibility of a feed. They never change an existing row.
  The importer sets `products.category_id` after creation only from null (first
  mapped wins) and never clears it: the one product column it touches later.
  `SEED_DEMO_DATA` is true in `.env.example` and false by default in Compose.
- **(2) No scraping.** The importer fetches only the URL of a feed registered in
  the database, and parses it as CSV or XML feed data. Never add a crawler, a
  headless browser or an HTML parser for shop pages.
  `src/server/importer/source.ts` is the only place that fetches or reads a
  feed.
- **(3) Roles.** Every route declares whether it is public or admin. Admin
  routes and server actions check the session on the server.
- **(4) Money.** Integer cents, through the single money helper,
  `src/server/money.ts` (parse and format).
  Feed prices are parsed from their decimal text straight to cents, never
  through a float. No float column and no float arithmetic.
- **(5) Personal data.** The click row (`src/db/schema/clicks.ts`) has no IP, user agent, cookie or referer field; `source_page` is a same-origin site path validated in code and by a database check.
  - Only `src/server/clicks/counting.ts` reads the user agent, in memory.
  - Only `src/server/clicks/record.ts` writes `clicks`.
  - Every offer in a fresh dev or e2e database sits on a demo feed, so a `/go` request never writes a click there.
  - A counted click is provable only in the integration project, where a test makes a non-demo feed.
  Log ids, not emails. Read secrets from the environment, and add each new
  variable to `.env.example`: secrets blank and generated by
  `npm run env:init`, non-secret settings with their local default. Never read
  `process.env` at module load; read it in a function.
- **Import side effects.** Importing a `src/db` or `src/config` module must not
  open a connection or throw; `next build` runs with no database.
- **Imports are isolated.** One failing feed records its error in its import
  report and never stops the other feeds.
- **Migrations.** Every schema change is a migration, never a hand edit to
  the database. `npm run db:generate -- --name <name>` writes SQL to
  `src/db/migrations/`; commit it. Once a migration is merged to `main` it is
  never edited. The app container migrates on every `server` start.
  drizzle-kit is pinned `^0.31.11` against drizzle-orm 0.45.4.
- **Feed URLs and lint.** A feed URL may hold an API key: never print or log
  one; CLI mains print only an error code. ESLint `no-restricted-imports`
  overrides do not merge: an override must repeat the scraping-library
  patterns.

## Definition of done for this lane

- [ ] Every guardrail above checked against your diff, with any tension named
      in `risks`
- [ ] Lint and test commands from `CLAUDE.md` § Commands run and passing, or
      their absence reported
- [ ] Contract notes emitted for every field the frontend will consume
- [ ] Compose logs checked for no feed URL, database URL or `.example` host
      (Next's own `http://localhost:3000` and `http://0.0.0.0:3000` start-up
      lines are expected)
- [ ] Any convention you established (path, command, pattern) written as a
      `pack_corrections` entry for this file
