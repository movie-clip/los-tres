# 0007 — Affiliate network feeds as the only data source; no scraping

Status: accepted, 2026-10-16

## Decision

Products and prices come only from **product feeds of affiliate networks**
(Awin, Kwanko, Effinity, and others the admin adds). Each network, shop and
feed is a row the admin manages. A feed is imported only once an admin has
approved it.

**No scraping, ever**: no crawler, headless browser or HTML parsing of any
shop's site, for any purpose, including price checks. This is a guardrail.

Later, shops will be able to upload their own feed, as on hotline.ua. The feed
model has a source type (`affiliate_network` now, `shop_upload` later), so that
addition needs no rework.

## Why

- Scraping a retailer's catalogue is high legal risk in the EU. The database
  maker's right (Directive 96/9, LPI art. 133 ff.; CJEU C-762/19 CV-Online)
  covers a search engine that copies a database. A shop's terms can also ban
  extraction by contract (CJEU C-30/14 Ryanair).
- Network feeds are licensed for promoting the shop, and they come with the
  affiliate links that pay the commission.
- Autodoc publishes no feed or API, so it is the design reference, not a
  source. If its affiliate programme gives us a feed, it becomes one.

## Considered

- **Scraping Autodoc and other shops.** Rejected for the legal risk above.
- **Shops uploading feeds from day one.** Postponed: that needs sales work
  with each shop, which the team cannot do yet.

## Consequences

- Feed images are not used. The admin uploads product images (`mvp.md`).
- The site launches with only the shops whose network approves us, so
  applying to networks is on the critical path. It needs a live site (0004)
  and, at payout, a payee (autónomo or company).
