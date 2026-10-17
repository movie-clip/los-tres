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
(`.agentic/projects/los-tres/project.md` § Hard guardrails) carries the same
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

## Commands

npm and Node 22 (`.nvmrc`). **`npm run gate` is the gate**: every lane and the
integration check run it. A story is not done until it exits 0.

First run on a fresh clone: `npm ci`, `npm run env:init`,
`npm run test:e2e:install`. The gate also needs Docker running and a free host
port for each published service (app, db, Umami); if one is taken, set
`APP_PORT`, `DB_HOST_PORT` or `UMAMI_PORT` in `.env` to change the host port.

| Purpose | Command | Needs |
|---|---|---|
| lint | `npm run lint` (`eslint .`) | nothing |
| types | `npm run typecheck` (`tsc --noEmit`) | nothing |
| unit tests | `npm run test:unit` (`vitest run --project unit`) | nothing, no database |
| integration tests | `npm run test:integration` (`vitest run --project integration`) | `npm run db:up` |
| unit + integration | `npm test` (`vitest run`) | `npm run db:up` |
| e2e | `npm run test:e2e` (`playwright test`) | `npm run stack:up`, Playwright browser |
| **gate** | `npm run gate` | Docker running, `.env`, Playwright browser |

`npm run gate` is `lint`, `typecheck`, `db:up`, `test`, `stack:up`, `test:e2e`,
in that order. It rebuilds the app image and runs the e2e against the Compose
stack, so it takes minutes, and it leaves the stack running.

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
