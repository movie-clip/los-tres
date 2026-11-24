# Los Tres

A price-comparison site in and for Spain, in the family of hotline.ua: a
catalogue of products, each with the shops that sell it, sorted by price, and
a link to buy there. The MVP covers **car maintenance basics** only: engine
oil and oil, air, fuel and cabin filters, in one fixed category tree. The Sixt car-rental results page is the design reference for the catalogue, and Autodoc for auto-parts content. Products and prices
come from registered feeds (affiliate networks, hand-written files, or the owner's local-only collector, 0017), and revenue is affiliate commission. The
goal is an **MVP**, not feature parity. "Los Tres" is a code name: the public
site name is configuration.

## Non-negotiable guardrails

- **The admin decides what the public sees.** Only offers from a feed an admin
  has approved are public, and an admin can hide any product or offer. No
  import, seed, script or API publishes data from an unapproved feed or shows a
  hidden item.
- **No scraping in this repository, and no collected data on a public site.**
  The app, its image, its scripts and its tests never crawl a shop, drive a
  browser against one or parse its HTML. Data enters the app only through a
  registered feed: an affiliate network feed, a feed a shop submits later, a
  feed file written by hand, or a feed file made by the owner's local-only
  collector (decision 0017). The collector is a separate tool kept in a
  separate private repository, run by hand on the owner's machine and never
  deployed. Rows that come from it are visible only where the local flag is
  set, are never indexed or committed, and never appear on a public site. Using
  collected data on a public site needs a new owner decision.
- **Roles are enforced on the server.** Public visitors are anonymous. Only
  admins log in, and every admin route and action checks the role on the
  server. An admin feature hidden only in the UI counts as unprotected.
- **Money is integer cents in EUR.** Never floats. Prices shown are the final
  product price with IVA included.
- **Personal data is minimal and stays out of logs and git (RGPD).** No cookie,
  IP or user agent is stored for public visitors. Never log tokens, passwords
  or emails. Never commit a secret.

Absolute, and unnumbered on purpose. The agentic network's profile
(`agentic/project.md` § Hard guardrails) carries the same
five, numbered, so a `REFUSED: guardrail 2` names exactly one thing.

A request to build, fix or investigate something here goes to
`agentic-core:orchestrate-feature` first, including "this price looks wrong".
The `mattpocock-skills` plugin is enabled for the network's dispatched lanes,
and their capability packs say when each skill fires. It is not an entry point
for a request: `diagnosing-bugs` on a wrong price, run outside a lane, changes
feed import or matching with no design pass and no integration gate, and
leaves no ledger saying it happened.

## Stack

Chosen by the owner, one decision per file in `docs/decisions/`. A change to a
line here is the owner's call: propose it and stop.

- **App:** one Next.js app in TypeScript, server-rendered, `es-ES` copy in
  message files (0001)
- **Data:** PostgreSQL with Drizzle ORM; search in PostgreSQL (0002)
- **Delivery:** Docker Compose (app, db), local first, then an EU VPS (0004)
- **Gate:** ESLint, `tsc`, Vitest, Playwright (0006)
- **Data source:** feeds only (affiliate network, hand-written, or from the
  owner's local-only collector), imported by a manual `import-feeds` command
  (an admin button is deferred); the app never scrapes (0007, 0017)
- **Matching:** EAN, then brand + normalised part number; on a conflict the
  offer stays its own product, the admin queue is deferred (0008)
- **Vehicle fitment:** own vehicle list in code, fitment from feeds only (the `fitment` field, `|`-separated slugs; the import is its only writer),
  selected car in `?coche=` and `localStorage`, never stored on the server (0016)
- **Clicks and analytics:** `/go/<offer>` click log without personal data;
  no ads (0009); no traffic analytics for now (0014)
- **Admin sign-in:** Better Auth 1.7.12 used as a library, server-stored
  sessions, no cookie before sign-in (0012)
- **Styling:** CSS Modules, co-located `*.module.css`; `globals.css` keeps the
  variables and reset (0011)
- **Feed formats:** CSV or XML, plain or gzip, streamed; XML parsed by `sax`
  1.6.1 in strict mode (0013)

## Commands

npm and Node 22 (`.nvmrc`). **`npm run gate` is the gate**: the
integration review runs it, it runs before every pull request and in CI, and a
story is not done until it exits 0. Build lanes verify with `npm run check`
while they build (0006 rule 8).

First run on a fresh clone: `npm ci`, `npm run env:init`,
`npm run test:e2e:install`. The gate also needs Docker running and a free host
port for each published service (app on 3010, db on 5433); if one is taken, set
`APP_PORT` or `DB_HOST_PORT` in `.env` (and `SITE_URL` to match `APP_PORT`) to change the host port.

After `npm run env:init`, fill in the owner identity in `.env` for the legal
pages: `OWNER_NAME`, `OWNER_NIF`, `OWNER_ADDRESS` and `CONTACT_EMAIL` are
required, and `OWNER_REGISTRY` is optional (blank omits the "Datos registrales"
line). `env:init` writes all five empty. While any of the four required values
is blank, `/aviso-legal` and `/privacidad` return 500; every other page, the
gate, `migrate`, `seed` and `import-feeds` still work, and
`/como-nos-financiamos` needs no identity. A changed value takes
`docker compose up -d`, not a rebuild. Never commit `.env` or a real value.

To load the demo data and see the demo product page (which carries the demo
notice, and a footer linking the three legal pages), continue with:

1. `npm run stack:up`: builds and starts `app` and `db`. The app
   container migrates the database on every start and, when `SEED_DEMO_DATA` is
   `true`, seeds the demo shops, feeds and feed-category mappings.
2. `docker compose run --rm app import-feeds`: the first import, which creates
   the demo products and offers. Seeding loads no products; this does.
3. Open `http://127.0.0.1:3010/producto/demo-filtro-de-aceite-oc-1234`
   (replace `3010` with `APP_PORT` if you changed it). It lists two shops,
   cheapest first. Running step 2 again changes nothing but prices and dates.

`SEED_DEMO_DATA` in `.env` turns the start-up seed on when it is exactly `true`
(case-insensitive). `.env.example` sets it to `true`, so `npm run env:init`
writes it. Compose defaults it to `false` when unset, so a server that omits it
shows no demo data. A `.env` created before slice B lacks the line and
`env:init` will not touch it: add `SEED_DEMO_DATA=true` by hand and run
`docker compose up -d` to recreate `app`. Without it, the gate's e2e setup
fails with this message, on one line:

> e2e setup: the import found no approved feed. Set SEED_DEMO_DATA=true in .env and run: docker compose up -d

The migrate, seed, import and create-admin verbs also run inside the app image
through Compose, against the Compose database: `docker compose run --rm app migrate`,
`docker compose run --rm app seed` (always seeds),
`docker compose run --rm app import-feeds [--feed <id>]` and
`docker compose run --rm app create-admin`. Scripts and tests add
`-T` (no TTY) and `--no-deps` when the stack is already up. Any verb other than
`server`, `migrate`, `seed`, `import-feeds` and `create-admin` exits 64. The
`npm run` forms read `.env` through `node --env-file`, rebuild
`dist/` first and use the host database; the Compose forms do not need `npm`
or a host port.

**Admin sign-in (S2.1).** There is no sign-up: an admin is created by
`create-admin`, which takes **no arguments** (any argument prints a usage line
and exits 2) and reads the email, then the password, from stdin. On a terminal
it prompts `Email:` then `Password:` and does not echo the password. Piped, line
1 is the email and line 2 the password:
`printf 'admin@example.test\npassword\n' | docker compose run --rm -T --no-deps app create-admin`.
Passwords are at least 6 and at most 128 characters. It prints
`create-admin: created` or, when the email already exists,
`create-admin: updated, sessions ended` (the password is replaced and all of
that admin's sessions end; this is also the password recovery). Exit 0 on
success, 2 on a refusal (missing or invalid email, missing or short or long
password, any argument; nothing is written and the output never repeats the
input), 1 on a failure (an error code only).

`.env` needs two settings for the admin area, both written by `npm run env:init`:
`AUTH_SECRET` (generated, at least 32 characters) and `SITE_URL`
(`http://127.0.0.1:<APP_PORT>`). A `.env` created before S2.1 lacks both and
`env:init` will not touch it: add them by hand and run `docker compose up -d`.
`SITE_URL` must be exactly the origin the browser uses, so open the admin at
`127.0.0.1`, not `localhost`; a different origin makes sign-in answer
"unavailable". Without them the admin pages show the Unavailable screen and
public pages are unaffected; the gate's e2e (`tests/e2e/admin.spec.ts`) fails
until both are set. That e2e creates its admin, `e2e-admin@example.test`, in the
development database through `create-admin`. **S2.1 is password-only: do not
deploy the admin area before S2.2 adds a second factor** (0012).

**Catalogue file (S3.7).** The owner can add real products from a CSV or XML
file he writes (plain or gzip, the canonical layout `import-feeds` already
reads). The full guide, with the columns, the file-name rule and the failure
codes, is `docs/feeds/catalogue-file.md`. In short:

- **Folder:** `catalogue-files/` at the repo root, the only folder a catalogue
  file is read from. It holds `.gitkeep` and nothing else tracked: its other
  contents are git-ignored (`.gitignore`) and excluded from the Docker build
  context and image (`.dockerignore`). **Never commit a real catalogue file.**
  **No file made by the collector goes in it**: that is `collected-files/`
  (next paragraph). The app cannot tell a collected file placed here from a
  hand-written one, so it would import unmarked.
- **Mount:** `compose.yaml` bind-mounts the folder read-only into `app` at
  `/app/catalogue-files`, so `npm run import-feeds` and
  `docker compose run --rm app import-feeds` read the same file with no step
  beyond placing it. A clone or `.env` from before S3.7 needs
  `docker compose up -d` once, so `app` is recreated with the mount.
- **Steps:** write the file; place it in the folder; on `/admin/tiendas` create
  the shop and a feed with the source "Archivo de catálogo" and the bare file
  name (no network); approve the feed first and leave the shop unapproved (two
  separate approvals, each starts unapproved; the import reads approved feeds
  only); run `import-feeds [--feed <id>]`; review the output, `/admin/productos`
  and `/admin/categorias` while nothing is public, mapping the file's
  categories there; then approve the shop and check the product. Registering, approving,
  importing or mapping alone publishes nothing: a product is public only with
  both approvals and a mapped category.
- **File name:** a bare name, at most 100 characters, only letters without
  accents, digits, `.`, `-` and `_`, ending `.csv`, `.xml`, `.csv.gz` or
  `.xml.gz`; matched exactly, upper and lower case included. Renaming the file
  of an approved file feed returns it to unapproved.
- **Failures:** a failed feed prints `failed <code>` with no path and the run
  exits 1 (the others still run): `file_name_refused` (stored name not a bare
  name), `file_not_found` (folder or exact file missing), `file_refused` (a
  link, not a regular file, or changed while opened).
- **Removal (S3.3, 0018):** an import flags `offers.is_removed` on the feed's
  offers absent from the file (never a delete), takes them off the site, and
  restores them if a later import has the row again; it never writes hide.
- **Not done:** no brand alias
  (`Bosch` and `Robert Bosch` stay two products, S7.3) and no re-matching of
  rows already stored. Two shops converge on a shared valid `ean`, or on the
  same normalised brand and part number (S7.1). Hide and unhide of a
  product or offer exist (S2.4): an admin finds a product at `/admin/productos`
  and hides or unhides it and its offers; hidden items stay hidden through
  every import, and an unhide publishes nothing by itself.

**Collected file (S12.2, 0017).** A file made by the owner's local-only collector
goes in its own folder, never in `catalogue-files/`. The full guide is the
"Collected files" section of `docs/feeds/catalogue-file.md`. In short:

- **Folder and registration:** `collected-files/` at the repo root, with the same
  rules as `catalogue-files/` (`.gitkeep` only tracked, git-ignored, kept out of
  the Docker context and image, mounted read-only at `/app/collected-files`).
  **Never commit a collected file.** Register it on `/admin/tiendas` with the
  source "Archivo recopilado (solo local)" and the bare file name; the name rule
  and the two separate approvals are those of a catalogue file. The place decides
  the marker: the importer marks every row of a collected feed, and nothing can
  detect a collected file put in `catalogue-files/`.
- **The local flag ("el ajuste local"):** `LOCAL_COLLECTED_DATA=true` in the
  owner's local `.env` only; on only for `true` (any case, trimmed). `.env.example`
  and `env:init` do not write it and Compose defaults it to `false`. After this
  change, and after any change of the value, run `docker compose up -d` once, so
  `app` is recreated with the new mount and the flag pass-through.
- **What the flag does:** it lifts the exclusion of collected rows on the local
  site and nothing else. Feed and shop approval, hide, review, removal and the
  category mapping all still apply. Without the flag, collected rows are on no
  public page. Collected rows are never indexed, never in the sitemap and never a
  counted click, flag on or off, and their `fitment` never counts. A hand-written
  row never merges into a collected product.
- **Refusal (exit 78):** with the flag on and `SITE_URL` not a loopback origin
  (`localhost`, `127.x.x.x`, `[::1]`; unset or unparsable counts as not loopback),
  the container `server` verb, `npm run dev`, `next start` and `node server.js`
  exit 78 and print one line,
  `start refused: LOCAL_COLLECTED_DATA is on and SITE_URL is not a loopback origin`.
  `migrate`, `seed`, `import-feeds` and `create-admin` do not refuse. As a backstop
  the flag counts as off on every request whenever `SITE_URL` is not loopback.
- **Not done:** the flag covers collected files only, not hand-written ones.
  Using collected data on a public site needs a new owner decision (0017).

**Search engines (S6.2).** `SITE_URL` is also the public origin of canonical
links, the sitemap and the `Sitemap:` line of `/robots.txt`; **before any public
deploy it must be the public https origin**, or all of them point at
`127.0.0.1`. When it is unset, public pages still work but carry no canonical,
`/robots.txt` has no `Sitemap:` line and the sitemap answers 503.

- `/sitemap.xml` is an index of `/sitemaps/paginas.xml` (home and category pages)
  and `/sitemaps/productos-<n>.xml` (5,000 products per file). It lists a
  product only if it is public and has at least one offer from a feed that is
  neither demo nor collected (S12.2); a category only if its subtree holds such a
  product. No `lastmod`.
- Demo-only and collected-only products and categories are `noindex` and carry no
  canonical, whatever the local flag says.
- Canonical keeps only `?pagina=<n>` for n above 1; any other query parameter,
  including any future filter, is dropped from it; `marca` and `orden` on a
  category page (S11.4) are dropped like any other, and so is `coche` (S5.7).
- Every page opened with `coche` (S5.7), whether or not the car is recognised,
  is `noindex` and carries no canonical; `coche` never appears in the sitemap.
- `/robots.txt` disallows `/go/`, `/api/`, `/mi-coche` (the car picker page,
  S5.7: also `noindex` with no canonical, `Referrer-Policy: same-origin`) and
  `/buscar` (the search page,
  which exists since S5.4: disallowed here and also `noindex` with no
  canonical, and it answers `Referrer-Policy: same-origin`). The search term
  travels in the URL, which the app never logs or stores; **the S9.1 deploy
  must keep any reverse proxy from logging the `/buscar` or `/mi-coche` query
  string** (`/mi-coche?volver=` can hold a search term), and a
  managed PostgreSQL must allow `CREATE EXTENSION unaccent` (0002). It does not mention the admin area,
  which sends its own noindex signals. `/go/<offer>` also answers
  `X-Robots-Tag: noindex, nofollow`.

| Purpose | Command | Needs |
|---|---|---|
| lint | `npm run lint` (`eslint .`) | nothing |
| types | `npm run typecheck` (`tsc --noEmit`, then `tsc -p tsconfig.cli.json --noEmit` for the CLI) | nothing |
| unit tests | `npm run test:unit` (`vitest run --project unit`) | nothing, no database |
| integration tests | `npm run test:integration` (`vitest run --project integration`) | `npm run db:up` |
| unit + integration | `npm test` (`vitest run`) | `npm run db:up` |
| timing tests | `npm run test:timing` (`vitest run --config vitest.timing.config.mts`: the files `tests/timing/**/*.timing.test.ts`, one worker, one file at a time; writes its tables to `timing-results/`, git- and docker-ignored; no gate step runs it) | `npm run db:up`; not beside another Vitest run, its setup drops every integration database and the next integration run rebuilds them |
| migrate | `npm run db:migrate` (applies `src/db/migrations` to the database in `.env`, then upserts the fixed category tree from `src/db/category-tree.ts` and the vehicle list from `src/db/vehicle-catalogue.ts`; every migrate path does both, whatever `SEED_DEMO_DATA` says; 0015) | `npm run db:up`, `.env` |
| seed | `npm run db:seed` (demo network, shops, feeds and feed-category mappings; creates no category and no products, and fails if the fixed tree is missing, so migrate first; prints `seed: networks=N shops=N feeds=N categoryMappings=N`; always seeds, whatever `SEED_DEMO_DATA` says) | `npm run db:up`, migrated database, `.env` |
| import feeds | `npm run import-feeds` (imports every approved feed, CSV or XML, plain or gzip, detected from the bytes, and prints counts and rejected rows; each imported feed line reads `... offers_created=<n> offers_updated=<n> offers_removed=<n> rejected=<n> unknown_vehicles=<n>` and ends `unknown_vehicles=<n>`, followed by `  fitment: unknown vehicle <slug> rows=<n>` lines, at most 20 per feed, and one `  fitment: unknown vehicle values not shown rows=<n>` line when some are not listed; a row that became its own product because of an EAN or brand + part number conflict or ambiguity prints `  record <n>: own_product <reason>` (S7.1; one of `ean_brand_conflict`, `ambiguous_ean`, `brand_part_number_ean_conflict`, `ambiguous_brand_part_number`; after the rejected lines, no row text, never fails the run); when the removal guard skips removal (S3.3, decision 0018) the last indented line of that feed is `  removal: skipped <reason> missing=<n> current=<n>`, `<reason>` being `empty_import` or `small_import`, and the skip does not change the exit code (exit 1 still means a feed failed); `npm run import-feeds -- --feed <id>` imports one, and `npm run import-feeds -- --feed <id> --allow-large-removal` also lifts `small_import` for that feed (any other argument form prints `usage: import-feeds [--feed <id> [--allow-large-removal]]` and exits 2); a catalogue-file feed (S3.7) is read from `catalogue-files/`, see the Catalogue file paragraph of § Commands) | `npm run db:up`, migrated and seeded database, `.env`; for a catalogue-file feed also the file in `catalogue-files/` |
| new migration | `npm run db:generate -- --name <name>` (`drizzle-kit generate`, writes SQL from `src/db/schema` to `src/db/migrations`; commit it) | nothing, no database |
| build CLI | `npm run cli:build` (`tsc -p tsconfig.cli.json`, output in `dist/`, git-ignored) | nothing; the three verbs above run it first |
| create admin | `npm run create-admin` (email, then password, on stdin; no arguments; prints `created` or `updated, sessions ended`) | `npm run db:up`, migrated database, `.env` with `AUTH_SECRET` |
| e2e | `npm run test:e2e` (`playwright test`; its setup runs `docker compose run --rm -T --no-deps app import-feeds`) | `npm run stack:up` with `SEED_DEMO_DATA=true`, Playwright browser |
| e2e (CI) | `npm run test:e2e:ci` (`playwright test --grep-invert @layout`: `test:e2e` without the specs tagged `@layout`) | as `test:e2e` |
| check | `npm run check` (`lint`, `typecheck`, `db:up`, `test`: all of Vitest; no image build, no Playwright; budget 90 s, 0006 rule 13) | Docker running, `.env` |
| **gate** | `npm run gate` | Docker running, `.env` with `SEED_DEMO_DATA=true`, Playwright browser |
| gate (CI) | `npm run gate:ci` (`gate` with `test:e2e:ci` as its last step; what CI runs) | as `gate` |

`npm run gate` is `npm run check` (`lint`, `typecheck`, `db:up`, `test`), then
`stack:up` and `test:e2e`, in that order. It rebuilds the app image and runs the e2e against the Compose
stack, so it takes minutes, and it leaves the stack running. Playwright has three
projects, `chromium`, then `containers` (the specs that start a container) on one
worker, then `catalogue-file` (#361). `typecheck` in the
gate covers both `tsconfig.json` and `tsconfig.cli.json`. Its two cost tests
(`category-fit-cost`, `sitemap-performance`) assert a query-count ceiling
instead of a time, and their timings run on demand with `npm run test:timing`,
which writes them to `timing-results/`. The gate has no
migrate step, and the app container migrates on start. The integration tests
use their own databases on the same `db` service (0010): each run drops and
migrates a template, `<DB_NAME>_tpl_test`, from nothing and clones it into one
database per Vitest worker, `<DB_NAME>_w<n>_test` (n = 1 to the worker count).
The template and the clones stay in PostgreSQL after a run; the next run drops
them (and any old `<DB_NAME>_test`), so a failed run can be inspected. Test
files run in parallel, one per worker. The default worker count is
`min(8, CPUs - 1)`, at least 1; the optional `INTEGRATION_WORKERS=<n>` set in
the shell (Bash: `INTEGRATION_WORKERS=2 npm run test:integration`; PowerShell:
`$env:INTEGRATION_WORKERS=2; npm run test:integration`) sets it; `.env` is
not read for it. A value that is not a positive whole number fails the run.

Budgets on the dev machine (0006 rules 13 to 15): `check` 90 s, integration
60 s, e2e 90 s, full gate 4 min; the integration review reports the measured
times and the tests added and removed per level. The e2e and full-gate budgets
are provisional until #363.

**Time in tests (0006, § Amendment 2026-11-23).** The unit, integration and
support test files do not use `Date.now()`, `performance.now()`,
`process.hrtime`, `process.uptime()` or `new Date()` with no argument, except on
a line marked `// eslint-disable-next-line no-restricted-syntax -- clock:
<reason>`. ESLint flags exactly those forms; aliased or computed access, SQL
time functions and sleeps are not flagged and fall to the integration review
(0006 names them). Real timings are `npm run test:timing`, never a gate step.
The e2e tests are outside that rule.

**CI (D-5, D-6).** `.github/workflows/gate.yml` runs `npm run gate:ci` on every
pull request, on `ubuntu-latest`, with a fresh `.env` from `npm run env:init`
(random secrets, `SEED_DEMO_DATA=true`, blank owner identity). `gate:ci` is
`gate` except that its e2e step skips the tests tagged `@layout`: pixel
geometry written against Windows system-ui font metrics, which fails on the
Linux runner. The local `npm run gate` stays the gate and runs everything,
`@layout` included; a story is still not done until it exits 0. When a gate run
fails, `gate.yml` uploads `test-results/` (the trace and screenshot of each
failing test, which `playwright.config.ts` keeps on failure only) as a workflow
artifact for 7 days; `gate-repeat.yml` does the same from an identical step
(#361). A trace may hold the ephemeral CI admin session and test credentials, in
a public repository's artifacts (#361).

**Repeat run (`gate-repeat`, 0006 rule 7).** `.github/workflows/gate-repeat.yml`
starts only by hand (its one trigger is `workflow_dispatch`): on GitHub, Actions,
workflow `gate-repeat`, Run workflow. It takes two inputs:

- `runs`: how many copies, a whole number from 1 to 10, default 5.
- `pr`: optional, a pull request number, digits only. Blank tests the branch the
  run was started on. A number tests the merge commit `refs/pull/<pr>/merge`
  pointed at when the run began (what the `gate` check tests), and every job
  checks out that one commit.

A bad value, or a pull request with no merge ref (closed, merged or
conflicting), fails the first job and nothing else starts. The workflow then
runs, in parallel on separate runners:

- **`runs` copies**, named `repeat <n>`, each the steps of the `gate` job of
  `gate.yml` (checkout, Node, `npm ci`, `env:init`, Playwright chromium,
  `npm run gate:ci`, Compose logs on failure, Playwright output upload on
  failure, Compose down), with the same 45
  minute timeout. One red copy does not stop the others. A pin in
  `tests/unit/gate-determinism.test.ts` fails when a copy and the `gate` job
  drift apart.
- **One `timing` job**, which runs `npm run test:timing` twice, alone
  (`TIMING_LABEL=alone`) and beside three busy loops (`TIMING_LABEL=cpu-load`),
  and prints in its summary the commit, the runner's CPU count and model, for
  each run the exit code of `test:timing` and the load averages before and after,
  and the tables from `timing-results/`. It records the exit code instead of
  failing on it, so a slow or failing timing does not turn the job red; the job
  fails only when its setup fails (`npm ci`, `env:init`, the database).

With `pr` set, the jobs run that pull request's own code in this repository:
its `npm ci` scripts, `package.json` scripts, tests and `compose.yaml`. The
workflow references no secret and its token has `contents: read` only. For a
pull request from a fork, read its diff first and start the run from a branch
other than `main`: GitHub scopes the Actions cache by the ref a run starts on
(GitHub's documented behaviour, not something the repository checks), so cache
writes from the fork's code then stay in that branch's scope.

The workflow is never a required check: the required check is `gate`, from
`gate.yml`, and no job of `gate-repeat` is named `gate`. Use it before merging a
pull request that changes how tests execute (§ Git and tickets). At the time of
writing the workflow has not been run on GitHub: it can be started only once its
file is on `main`, so its first run, on `main`, is also its first check.

Helpers:

- `npm run env:init`: create `.env` with generated secrets; exits 1 and changes
  nothing if `.env` already exists. Never commit `.env`.
- `npm run db:up`: start the `db` service and wait until healthy.
- `npm run stack:up`: build and start `app` and `db`, and wait until healthy.
- `npm run stack:down`: stop the Compose stack (the database volume is kept).
- `npm run test:e2e:install`: install the Playwright chromium browser.
- `npm run dev`: Next.js dev server on the host; `npm run build`: production build.

## Canonical documentation

| Doc | Role |
|---|---|
| `docs/product/mvp.md` | approved MVP scope: in, out, settled owner calls |
| `docs/decisions/` | stack and architecture decisions, numbered |
| [GitHub Project 3](https://github.com/users/movie-clip/projects/3) | the board: status, priority and size of every epic, story and ticket |

## Git and tickets

- **GitHub Issues track the work; story files hold the spec.** An epic, a
  story and a ticket are each an issue, labelled `type:epic`, `type:story` or
  `type:ticket`, linked as sub-issues and placed on Project 3. A story issue
  links to its story file, which is what acceptance is checked against.
- **Board status:** Backlog → Ready → In progress → In review → Done. An issue
  reaches Ready only on a human's approval.
- **GitHub Flow.** `main` is always releasable. Each run that builds gets one
  branch, `<issue>-<slug>` (for example `12-feed-import`), and one pull request
  whose body says `Closes #<issue>`.
- **Agents may commit to the run's branch, push it and open a pull request.**
  Only the orchestrator does this, through the GitHub MCP server in `.mcp.json`.
  Specialist lanes never write to git or GitHub; read-only git is fine.
- **A change to how tests execute is repeated before it is merged (0006 rule
  7).** The owner starts `gate-repeat` on the pull request: five green copies of
  the gate, ten when it changes the worker count, the test-database setup or
  reset, or the CI job layout, with the run linked in the pull request body. A
  red copy is explained, not started again until it passes. Nothing checks this
  by machine. 0006 holds the file list and the uncovered case: the pull request
  that adds `gate-repeat.yml` before it is on `main`, and a fork pull request
  that changes `gate-repeat.yml` or `gate.yml`. A same-repository pull request
  that changes either file is expected to be repeatable by starting the run on
  its own branch with `pr` set: that is GitHub's documented behaviour, no run
  has shown it yet, and the first such dispatch will confirm it (0006).
- **Only a human merges.** No agent merges a pull request, pushes to `main` or
  force-pushes. `.claude/settings.json` denies those commands.
- **The repo and the board are public.** Never put a secret, token, email or
  personal data in an issue, comment, branch name or commit message.

## Conventions

- User-facing copy is Spanish (`es-ES`), kept out of inline markup in message
  files so another language can be added later.
