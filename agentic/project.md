# Project profile: `los-tres`

Repo: `C:\projects\investments\los-tres` (Los Tres)
Bound via `los-tres/.agentic.json`.

**`CLAUDE.md` is already in your context.** Claude Code loads the repo's
`CLAUDE.md` into every dispatched lane at startup, so the product, the stack,
the layout, the canonical-doc map and the command list reach you
without a read. Treat it as read. (If it is genuinely not in your context, read
it — that is the one case where it is worth a tool call.)

This file carries what `CLAUDE.md` does not: the lane map, the **numbering** a
`REFUSED` cites, and the rules for building on the recorded stack and for a choice no decision covers.
Phase bindings live in `phases.md`, which the orchestrator reads at intake and
no specialist lane needs.

**This profile is young.** The stack is recorded (`CLAUDE.md` § Stack) and the
tracer-bullet slices A and B exist, but the packs still carry mostly the
product's constraints and few code conventions. Later slices *set* the
conventions; `pack_corrections` is how they land in the packs, and the next
several runs should produce more of them than a mature project does. That is the
loop working (`protocol/packs.md`), not a finding.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Hard guardrails — no plan or lane may violate these** · **Building before the stack exists** · **Mechanical gates — never bypass**

| Section | Read it when |
|---|---|
| The product | you are the producer, or shaping a request into work |
| Lane routing | you are choosing which lane owns a piece of work |
| Why `quant` is not bound | you are about to propose a mathematics gate |

Elsewhere: **`phases.md`** — which lane fills each phase and the clause that
fires it (orchestrator, at intake). **`CLAUDE.md`** — product, stack, layout,
canonical docs, commands (already in your context).

---

## Hard guardrails — no plan or lane may violate these

1. **The admin decides what the public sees.** An offer reaches the public
   site only if it comes from a feed an admin has approved, and is not hidden.
   A product is public only while it is not hidden and is not waiting in the
   matching queue. No path — import, seed script, API — publishes data from an
   unapproved feed or shows a hidden item. Approving and disabling feeds, and
   hiding products and offers, are the admin's alone.
2. **No scraping.** Product and price data enter only through a registered
   feed: an affiliate network feed now, a feed a shop submits later
   (`docs/decisions/0007`). No crawler, headless browser or HTML parsing of any
   shop's site, for any purpose, including price checks.
3. **Roles are enforced on the server.** Public visitors are anonymous, and
   admin is the only logged-in role. Every admin route and action checks the
   role on the server. An admin capability hidden only in the UI counts as
   unprotected.
4. **Money is integer cents in EUR.** No floating-point amount is stored,
   summed or sent. Every price shown is the final product price with IVA
   included. Shipping is never shown or summed.
5. **Personal data is minimal and stays out of logs and git (RGPD).** No
   cookie, IP address or user agent is stored for public visitors; the click
   log holds offer, shop, product, time and source page only
   (`docs/decisions/0009`). Never log tokens, passwords or emails in plaintext,
   and never commit a secret. `.env` files stay out of git.

An order that requires breaking one of these gets `status: REFUSED` naming the
guardrail. **This is the system's only numbered copy.** `CLAUDE.md` restates the
same five without numbers, so a cited number resolves to exactly one rule.

## The product

A price-comparison site in and for Spain, in the family of hotline.ua, with
Autodoc as the design reference. Each product has one page listing the shops
that sell it, sorted by price, with an affiliate link out. The MVP covers auto
parts and consumables, and power and hand tools. Los Tres sells nothing
itself: there is no cart, checkout, payment or seller account. The target is an
**MVP, not feature parity.** The owner runs an admin area that controls which
feeds, products and offers the public sees (guardrail 1).

The approved scope is `docs/product/mvp.md` (2026-10-16). It replaced an
earlier marketplace scope, so a brief, plan or note that mentions sellers,
orders, Stripe or vehicle fitment is stale. The backlog is GitHub Project 3
(`CLAUDE.md` § Canonical documentation); the build order is the Slice field on
each story.

A brief that depends on a market fact nobody has established (for example,
whether a network will approve us) says so in `risks`.

## Building before the stack exists

**No lane picks the stack.** Language, framework, database, hosting and data
sources are the owner's decisions. Each one is recorded in `docs/decisions/` and
summarised in `CLAUDE.md` § Stack. The stack is recorded there, so a build lane builds on it and does not reopen it. A change to a
`CLAUDE.md` § Stack line is the owner's call: propose it and stop. For a
choice the recorded decisions do not cover:

- `tech-lead` (DESIGN) may **propose** an option, comparing options against the
  five guardrails, but the proposal is a report, not a decision.
- A build lane that would have to choose a framework, a package manager or a
  directory layout that no decision covers reports `BLOCKED` and names the
  decision it needs. It does not choose.

A slice that builds on a recorded decision also writes the conventions it set
into the matching pack, through `pack_corrections`. That covers layout,
commands and the test runner.

## Lane routing

| Lane | Agent | Pack | Owns |
|---|---|---|---|
| recon | `scout`; `reviewer` (CHECK) | — | read-only exploration of what already exists in the repo |
| product | `producer` | `product.md` | MVP scope, which change this is, where "no" lives |
| story | `story-author` | — | drafts a ticketed story when a slice needs one |
| ux | `designer` (UX) | `ux.md` | the flow, screens, states, copy and design system a change commits to, before the tech lead plans it. Edits no repo file |
| design | `tech-lead` (DESIGN) | `architecture.md` | stack proposals, the frontend/backend contract, the lane split |
| backend | `backend-engineer` | `backend.md` | server code, data schema and migrations (non-test) |
| frontend | `frontend-engineer` | `frontend.md` | the public catalogue and the admin UI (non-test) |
| test | `test-engineer` | `testing.md` | test files and test infrastructure |
| docs | `docs-engineer` | `docs.md` | `docs/**` and `CLAUDE.md` § Stack / § Commands, and — at close-out only — `agentic/capabilities/**` when applying `pack-corrections.md` |
| integration | `tech-lead` (INTEGRATION) | `architecture.md` | engineering gate: PASS / CHANGES_REQUESTED |
| ux-review | `designer` (UX-REVIEW) | `ux.md` | **design gate**: the running app, screenshotted at phone and desktop widths, against the UX spec: PASS / FAIL |
| review | `reviewer` | — | acceptance gate: PASS / FAIL — only where a story exists |
| protocol-lint | `protocol-linter` | — | on request only: audits this project's profile and packs, at onboarding or when an order asks. Not a delivery phase |

**No project tool server.** `los-tres/.mcp.json` declares only `github`, the
GitHub MCP server the orchestrator uses for the tracker (`phases.md`
§ Tracker). No `mcp__project__*` or `mcp__github__*` tool is granted to any
lane. Lanes run the commands `CLAUDE.md` names, under `Bash`. Before wiring a
project tool server, read `protocol/authoring.md` § "The project tool server".

## Why `quant` is not bound

Nothing here needs the mathematics gate. The site sorts prices, takes daily
minimums for price history and counts clicks, and those are arithmetic covered
by guardrail 4 and by tests. They are not a methodology anyone has to re-derive. Gates that apply:
`integration`, `ux-review` when a screen changed, and `review` when a story
exists. `phases.md`'s `verify` rows are what `check_report.py` reads.

## Mechanical gates — never bypass

- **The gate is `npm run gate`** (`CLAUDE.md` § Commands): lint, typecheck,
  tests and e2e against the Compose stack.
- **`integration` cannot pass a build until the gate exits 0**
  (`architecture.md` § Integration review).
- **Git and GitHub:** `CLAUDE.md` § Git and tickets.
