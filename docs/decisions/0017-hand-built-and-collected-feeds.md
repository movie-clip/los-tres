# 0017 — Hand-built and collected feeds; no scraping in this repository

Status: accepted, 2026-11-19. Amends 0007.

## Decision

- **Every row enters through a registered feed.** Besides affiliate network
  feeds, a feed may be a **hand-written catalogue file** in the canonical feed
  layout, imported by `import-feeds` like any other. Matching (0008),
  validation, integer cents and category mapping apply unchanged.
- **A separate collector.** The owner may run a collector: a separate tool kept
  in a **separate private repository**, never in this one. Its only output is a
  feed file in the canonical layout. It never writes to the database and never
  touches products or offers. The app never imports it, and it is not in the
  app's dependencies, image or build context.
- **Manual runs only.** The owner starts the collector by hand on his own
  machine. It is never scheduled and never deployed.
- **Fields it may take:** title, brand, part number, EAN, price with IVA, the
  product link and the shop's category name. Not descriptions, images, fitment
  or shipping. A row whose IVA status cannot be established is dropped.
- **Politeness and no evasion.** It honours `robots.txt` and skips what it
  disallows; it makes one request at a time with a delay between requests; it
  sends an honest user agent; it stops after a page cap per run; and it stops on
  a block (403, 429 or a captcha page) with no evasion: no proxies, no spoofed
  browser, no captcha solving.
- **An HTML parser only.** The collector may use an HTML parser. A headless
  browser is not approved; if a target shows prices only through JavaScript,
  that returns to the owner.
- **Agents never fetch live shop pages.** Only the owner runs the collector.
  He saves sample pages into a git-ignored folder for lanes to build from; tests
  use invented pages.
- **Provenance marker and local flag.** The importer marks rows that come from
  a collected file. Marked rows are hidden on every public surface unless a
  local flag is on. The flag is off by default; the app refuses to start with it
  set against a public https `SITE_URL`. Marked rows are never indexed, never in
  the sitemap, and never committed.
- **Two approvals, as for any feed.** A hand-written or collected feed belongs
  to a registered shop and feed row. The admin approves the shop and the feed
  separately, and can hide any product or offer (guardrail 1 is unchanged).
- **Any public use of collected data needs a new owner decision** and a new
  decision record. This decision does not allow it.
- **Out of scope:** images, shop descriptions, fitment from collected data,
  scheduled runs, an admin import button, price history and publication.

## Why

- The owner has no affiliate partnership available now and wants real products
  and links to judge the prototype (`mvp.md` § Goal).
- The legal risk named in 0007 (database right, shop terms) is about a
  **public** site. Copyright of descriptions and photos is a further risk, which
  is why images and descriptions are out of scope here. Keeping the collector
  outside this repository, local, manual and polite, and keeping its data off
  any public site, leaves 0007's reasoning in force where it matters.
- A separate private repository means this public repository does not publish
  the collector, and the app and its guards (lint bans, seams tests) stay
  unchanged and still describe an app that never scrapes.
- A hand-written file reuses every check the importer has, and is the one source
  that can be published later without a new legal question.

## Considered

- **Keeping 0007 as written.** Rejected by the owner for local use: he wants to
  see whether such a collector can be built.
- **A collector folder inside this repository** (git-ignored or committed).
  Rejected: a public repository would publish the tool and, through commits and
  issues, its targets.
- **Scraping inside the app behind a flag.** Not chosen: the code would ship in
  the image, so nothing mechanical could show it is off.
- **Lifting the guardrail altogether.** Not chosen: it removes the only wall
  between collected data and the public site.
- **Self-serve programmes with an API.** Not chosen now; the owner may
  reconsider.

## Consequences

- 0007's "no scraping, ever" becomes "no scraping in this repository"; its Why
  and Considered stand.
- The collector's own repository is bound to the agentic network separately.
- Plain shop links carry no tracking; `/go` redirects to the offer's shop URL
  (0009).
- Before any public deploy, collected data and its provenance marker need the
  new owner decision above.
- Hand-written files are read from one fixed folder, `catalogue-files/`,
  git-ignored and kept out of the image (S3.7). A file made by the collector
  does not go in it before S12.2 adds the provenance marker.
