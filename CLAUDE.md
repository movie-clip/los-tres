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

*None yet.* The first slice that adds code adds a lint and a test command and
lists them here. They are the gate.

## Canonical documentation

| Doc | Role |
|---|---|
| `docs/product/mvp.md` | approved MVP scope: in, out, settled owner calls |
| `docs/decisions/` | stack and architecture decisions, numbered |

## Conventions

- User-facing copy is Spanish (`es-ES`), kept out of inline markup in message
  files so another language can be added later.
- No agent commits. The human commits.
