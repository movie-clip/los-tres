# Los Tres

A price-comparison site in and for Spain, in the family of hotline.ua: a
catalogue of products, each with the shops that sell it, sorted by price, and
a link to buy there. The MVP covers **auto parts and consumables** and **power
and hand tools** only. Autodoc is the design reference. Products and prices
come from affiliate network feeds, and revenue is affiliate commission. The
goal is an **MVP**, not feature parity. "Los Tres" is a code name: the public
site name is configuration.

## Non-negotiable guardrails

- **The admin decides what the public sees.** Only offers from a feed an admin
  has approved are public, and an admin can hide any product or offer. No
  import, seed, script or API publishes data from an unapproved feed or shows a
  hidden item.
- **No scraping.** Data enters only through a registered feed: an affiliate
  network feed now, or a feed a shop submits later. No crawler, headless
  browser or HTML parsing of any shop's site, for any purpose.
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

## Stack

Chosen by the owner, one decision per file in `docs/decisions/`. A change to a
line here is the owner's call: propose it and stop.

- **App:** one Next.js app in TypeScript, server-rendered, `es-ES` copy in
  message files (0001)
- **Data:** PostgreSQL with Drizzle ORM; search in PostgreSQL (0002)
- **Delivery:** Docker Compose (app, db, umami), local first, then an EU VPS (0004)
- **Gate:** ESLint, `tsc`, Vitest, Playwright (0006)
- **Data source:** affiliate network feeds only, imported by a manual
  `import-feeds` command or admin button; no scraping (0007)
- **Matching:** EAN, then brand + normalised part number; conflicts to an admin
  queue (0008)
- **Clicks and analytics:** `/go/<offer>` click log without personal data;
  cookieless Umami; no ads (0009)
- **Styling:** CSS Modules, co-located `*.module.css`; `globals.css` keeps the
  variables and reset (0011)

## Commands

npm and Node 22 (`.nvmrc`). **`npm run gate` is the gate**: every lane and the
integration check run it. A story is not done until it exits 0.

First run on a fresh clone: `npm ci`, `npm run env:init`,
`npm run test:e2e:install`. The gate also needs Docker running and a free host
port for each published service (app, db, Umami); if one is taken, set
`APP_PORT`, `DB_HOST_PORT` or `UMAMI_PORT` in `.env` to change the host port.

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

1. `npm run stack:up`: builds and starts `app`, `db` and `umami`. The app
   container migrates the database on every start and, when `SEED_DEMO_DATA` is
   `true`, seeds the demo shops, feeds and categories.
2. `docker compose run --rm app import-feeds`: the first import, which creates
   the demo products and offers. Seeding loads no products; this does.
3. Open `http://127.0.0.1:3000/producto/demo-filtro-de-aceite-oc-1234`
   (replace `3000` with `APP_PORT` if you changed it). It lists two shops,
   cheapest first. Running step 2 again changes nothing but prices and dates.

`SEED_DEMO_DATA` in `.env` turns the start-up seed on when it is exactly `true`
(case-insensitive). `.env.example` sets it to `true`, so `npm run env:init`
writes it. Compose defaults it to `false` when unset, so a server that omits it
shows no demo data. A `.env` created before slice B lacks the line and
`env:init` will not touch it: add `SEED_DEMO_DATA=true` by hand and run
`docker compose up -d` to recreate `app`. Without it, the gate's e2e setup
fails with this message, on one line:

> e2e setup: the import found no approved feed. Set SEED_DEMO_DATA=true in .env and run: docker compose up -d

The migrate, seed and import verbs also run inside the app image through
Compose, against the Compose database: `docker compose run --rm app migrate`,
`docker compose run --rm app seed` (always seeds), and
`docker compose run --rm app import-feeds [--feed <id>]`. Scripts and tests add
`-T` (no TTY) and `--no-deps` when the stack is already up. Any other verb
exits 64. The `npm run` forms read `.env` through `node --env-file`, rebuild
`dist/` first and use the host database; the Compose forms do not need `npm`
or a host port.

| Purpose | Command | Needs |
|---|---|---|
| lint | `npm run lint` (`eslint .`) | nothing |
| types | `npm run typecheck` (`tsc --noEmit`, then `tsc -p tsconfig.cli.json --noEmit` for the CLI) | nothing |
| unit tests | `npm run test:unit` (`vitest run --project unit`) | nothing, no database |
| integration tests | `npm run test:integration` (`vitest run --project integration`) | `npm run db:up` |
| unit + integration | `npm test` (`vitest run`) | `npm run db:up` |
| migrate | `npm run db:migrate` (applies `src/db/migrations` to the database in `.env`) | `npm run db:up`, `.env` |
| seed | `npm run db:seed` (demo network, shops, feeds and categories; no products; always seeds, whatever `SEED_DEMO_DATA` says) | `npm run db:up`, migrated database, `.env` |
| import feeds | `npm run import-feeds` (imports every approved feed and prints counts and rejected rows; `npm run import-feeds -- --feed <id>` imports one) | `npm run db:up`, migrated and seeded database, `.env` |
| new migration | `npm run db:generate -- --name <name>` (`drizzle-kit generate`, writes SQL from `src/db/schema` to `src/db/migrations`; commit it) | nothing, no database |
| build CLI | `npm run cli:build` (`tsc -p tsconfig.cli.json`, output in `dist/`, git-ignored) | nothing; the three verbs above run it first |
| e2e | `npm run test:e2e` (`playwright test`; its setup runs `docker compose run --rm -T --no-deps app import-feeds`) | `npm run stack:up` with `SEED_DEMO_DATA=true`, Playwright browser |
| **gate** | `npm run gate` | Docker running, `.env` with `SEED_DEMO_DATA=true`, Playwright browser |

`npm run gate` is `lint`, `typecheck`, `db:up`, `test`, `stack:up`, `test:e2e`,
in that order. It rebuilds the app image and runs the e2e against the Compose
stack, so it takes minutes, and it leaves the stack running. `typecheck` in the
gate covers both `tsconfig.json` and `tsconfig.cli.json`. The gate has no
migrate step: the test database is dropped, recreated and migrated on every
integration run, and the app container migrates on start.

Helpers:

- `npm run env:init`: create `.env` with generated secrets; exits 1 and changes
  nothing if `.env` already exists. Never commit `.env`.
- `npm run db:up`: start the `db` service and wait until healthy.
- `npm run stack:up`: build and start `app`, `db` and `umami`, and wait until healthy.
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
- **Only a human merges.** No agent merges a pull request, pushes to `main` or
  force-pushes. `.claude/settings.json` denies those commands.
- **The repo and the board are public.** Never put a secret, token, email or
  personal data in an issue, comment, branch name or commit message.

## Conventions

- User-facing copy is Spanish (`es-ES`), kept out of inline markup in message
  files so another language can be added later.
