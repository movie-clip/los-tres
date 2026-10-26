# Capability pack: product — project `los-tres`

For the `producer` lane. How requests get shaped in a price-comparison site
that has an approved MVP scope, a tracer-bullet code base (slices A and B) and a backlog on GitHub Project 3.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Where the plan lives** · **Guardrails you must respect when briefing** · **Definition of done for this lane**

| Section | Read it when |
|---|---|
| Shaping the MVP | the request adds to or changes `docs/product/mvp.md` |
| What is a story here, and what is not | you are deciding whether this needs a ticketed story |

---

## Where the plan lives

| Doc | Role |
|---|---|
| `docs/product/mvp.md` | the approved MVP scope (2026-10-16): what is in, what is explicitly out, and the owner's settled product calls |
| `docs/decisions/` | stack and architecture decisions, one file each, numbered |
| GitHub Project 3 | the backlog: epics, stories, tickets and owner tasks; the Slice field is the build order |

`mvp.md` replaced an earlier marketplace scope. Do not reconstruct scope from
memory of marketplaces: there are no sellers, orders or payments here.

## Shaping the MVP

The product is a hotline.ua-style price comparison for car maintenance
basics (engine oil and oil, air, fuel and cabin filters), fed by affiliate network feeds. Your
job is to cut, not to collect.

- **The core loop is: a feed is approved and imported, a visitor finds a
  product, compares offers and clicks out to a shop.** Everything outside that
  loop is a candidate for "later". Put it in an explicit *out of MVP* list
  rather than leaving it unmentioned.
- **`mvp.md` § Out of MVP is settled.** A request for something on that list
  (ads, accounts, shipping costs, fitment, shop uploads, scheduled imports) is
  a scope change for the owner, not a gap.
- **Name the owner's open calls as questions, not answers.** Each one goes in
  `risks` with what it blocks.
- **No market claims.** A brief that rests on "Spanish buyers want X", or on a
  network approving us, without a source marks that claim unverified.

## What is a story here, and what is not

Per `phases.md` § "When the brief is the specification": a slice that crosses
lanes with no approved brief fixing its shape gets a story. Feed import and
matching, the product page, and the admin feed and matching screens are all
likely to. A single endpoint,
component or copy change does not. State which applies in your brief, so the
`specification` clause can be evaluated rather than guessed.

## Guardrails you must respect when briefing

The five are in the project profile. Three shape scope decisions specifically:

- **Admin approval (1).** A request to publish a feed's data before an admin
  approves the feed is a request to weaken guardrail 1. Name it as such and
  leave it to the owner.
- **No scraping (2).** A request for data from a shop with no feed (including
  Autodoc) is answered with "apply to its affiliate programme" or "out of MVP",
  never with scraping.
- **Personal data (5).** Anything that stores data about public visitors
  (accounts, alerts, ads, a cookie) is an owner call with RGPD and consent
  consequences. Flag it.

## Definition of done for this lane

- [ ] `docs/product/mvp.md` read, or its absence stated
- [ ] Verdict stated plainly, including "already covered", "out of MVP" or
      "decline" when true
- [ ] An explicit *out of MVP* list whenever the brief proposes scope
- [ ] Owner's open calls listed as questions in `risks`, each with what it blocks
- [ ] Story-vs-brief decision stated against the `phases.md` clause
- [ ] Any guardrail tension named as such, with the decision left to the owner
- [ ] No implementation and no stack choice specified, and no files written
      outside the report artifact
