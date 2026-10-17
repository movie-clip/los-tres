# Los Tres — MVP scope

Agreed with the owner on 2026-10-16 in a grilling session. It replaces the
earlier marketplace scope of 2026-10-12, which was deleted. Amended on
2026-10-18 after the backlog revision, and the owner approved the amendment.
This is the approved MVP scope: what is in, what is out, and the owner calls
already settled. A change to anything here is the owner's call.

## Goal

A **price-comparison site for Spain**, in the family of hotline.ua: a
catalogue of products, each with a list of shops that sell it and a link to
buy there. Los Tres never sells anything itself.

The MVP is done when the site is live with its legal pages, at least 3 affiliate feeds are approved,
at least 10k products are indexed by Google, and it records its first outgoing
clicks and first commission.

The team is the owner (developer, steering AI agents) and two friends. There
is no deadline.

## Name

"Los Tres" is a code name. The public site name is configuration, not code, so
the owner can change it without a code change.

## Audience and language

- Consumers and talleres (workshops): anyone who wants to buy.
- All of Spain.
- The site is in **Spanish (`es-ES`)** from launch. All user-facing copy lives
  in message files, so another language can be added later.
- No public accounts. Visitors never log in.

## Catalogue scope

- **Auto:** spare parts plus consumables (oils, filters, bulbs, wipers and
  similar). **No tyres.**
- **Construction:** **power and hand tools** only, for now.
- **Categories:** a fixed tree of about 30 categories that the admin defines.
  Each feed category is mapped once by the admin to one of ours. Products from
  unmapped feed categories wait in an admin queue. Products from an unmapped
  feed category are not public until the admin maps the category (owner
  ruling, 2026-10-17).
- **No vehicle fitment.** Auto parts are found by part number, EAN or text. If
  a feed carries fitment text, it is shown as text and nothing more.

## Product and offers

- **One product, many offers.** A product page lists every shop that sells
  it, sorted by price from lowest to highest, like hotline.ua.
- **Price** is the product price only: integer cents in EUR, IVA included.
  **No shipping costs** anywhere.
- Each offer shows the shop, the price and "price updated on <date>", and links
  out through our redirect (see *Outgoing clicks*).
- **Products with a single offer are shown.** The page says "1 shop".
- **Product text** (title, brand, part number, EAN, description, attributes)
  comes from the feeds. When feeds disagree, the admin's ranking of shops
  decides which feed's text wins.
- **Product images are not taken from feeds.** The admin uploads them. Until an
  image is set, the product shows its category's placeholder.
- **Price history:** one point per day per product, the lowest offer price that
  day, shown as a chart on the product page. Imports are manual, so a day
  without an import has no point; the chart shows the gap and never invents a
  value.
- **When a product loses all its offers,** its page stays as it is
  (text, image, price history, still indexed), with two changes. The offer list
  shows "No offers right now" with the last known lowest price and its date,
  and the structured data is omitted while the product has no offers.

## Matching

Offers from different feeds are matched to one product by **EAN first**, then by
**brand + manufacturer part number** with spaces, dashes and dots removed and
upper-cased. If the EAN and the brand disagree, the offer goes to a review queue
instead of merging. The admin can **merge** two products and **split** one.
Decision 0008 holds the detail.

## Search and browsing

- Free-text search in PostgreSQL that also matches EAN and part numbers.
- Category pages with filters for brand, price range and shop.
- Product pages are server-rendered with schema.org `Product` / `AggregateOffer`
  structured data, so Google can show prices in its results.

## Data sources

- **Affiliate network feeds only** in the MVP (decision 0007).
- **No scraping, ever**, of any site, for any purpose. This is a guardrail.
- First shops to apply to:

  | Area | Shop | Network |
  |---|---|---|
  | Tools | Leroy Merlin | Awin |
  | Tools | ManoMano | Awin |
  | Tools | Brico Dépôt | Awin |
  | Auto | Oscaro | Kwanko |
  | Auto | Norauto | Effinity |

  Autodoc is the **design and UX reference**. It becomes a data source only if
  its affiliate programme provides a feed.
- **Later (out of MVP):** shops upload their own feed directly, as on
  hotline.ua. The data model must allow it without rework.

## Shops and feeds are data

Networks, shops, feeds and affiliate link patterns are **rows the admin
manages**, never code. Adding a shop means entering its name, logo, network,
feed URL and link pattern in the admin area. A product's offer list is built
only from imported data.

A feed URL may hold an API key. Feed URLs are encrypted at rest before the
first real feed is added (owner ruling, 2026-10-18); until then the admin area
shows them masked and nothing logs them.

## Feed import

- A **separate import command**, `import-feeds`, reads each approved feed (CSV
  or XML from the network's URL). It checks every row and writes an import
  report the admin can read.
- **It is not scheduled.** It runs when someone starts it, either from the
  command line or from an **"Import now"** button in the admin area (per feed,
  or all feeds). Both run the same code.
- One broken feed never stops the others, and an import never takes the site
  down.
- An offer missing from a feed's latest successful import is removed.

## Admin area

- Accounts for the three team members only, created by a command. There is no
  sign-up.
- Login is email + password + authenticator-app code (TOTP). Every admin route
  and action checks the role on the server.
- The admin:
  - approves or disables shops and feeds;
  - runs imports and reads their reports;
  - maintains the category tree and maps feed categories onto it;
  - uploads product images;
  - resolves the matching review queue, and merges and splits products;
  - hides any product or offer;
  - ranks shops for whose text wins.

## Visibility (guardrail 1)

Only offers from an **admin-approved feed** are public. Products from an
approved feed publish automatically once their feed category is mapped; until
then they wait in the admin queue and are not public. The admin can hide any product or offer,
and a hidden item is never public.

## Outgoing clicks

Every "go to shop" link goes through our own `/go/<offer>` redirect. It logs the
click and sends the visitor to the affiliate URL. The log holds offer, shop,
product, time and source page only: **no IP, no user agent, no cookie**
(decision 0009). It is the basis for per-click billing later. Prefetch and
HEAD requests, known crawlers and demo offers are not counted. The count is
best effort; the network's report is the authority for commission.

## Analytics

Self-hosted **Umami**, which works without cookies, so the site needs no
cookie-consent banner.

## Revenue

- **MVP:** affiliate commission on outgoing clicks.
- **Later:** per-click billing (CPC) for shops that upload their own feed, as
  hotline.ua does.
- **No ads in the MVP.** Ads would need a consent banner.

## Delivery

Docker Compose (decision 0004). It runs locally first. Once the first slices
work, the same Compose setup runs on a small EU VPS with a domain, so the
affiliate networks can review a live site. An autónomo registration (or an
existing company) is needed only when a network asks for a payee.

While the networks review the site it may show the demo catalogue. Demo
products are noindex and left out of the sitemap, and clicks on demo offers are
not counted. Pages that list only demo offers carry a short notice that they
are a demonstration, and the legal text says so in one line (owner ruling,
2026-10-18). The demo feeds are disabled when the first real feed is approved.
No visitor IP address or user agent appears in the proxy, app or container
logs.

## Legal pages

The site carries a legal notice (aviso legal), a privacy policy and an
affiliate disclosure, linked from the footer of every page (LSSI-CE). The owner
supplies the Spanish text. There is still no cookie banner.

## Out of MVP

- Shops uploading their own feeds, and per-click billing.
- Ads, and any cookie-consent banner.
- Public user accounts, alerts, reviews, shop ratings and favourites.
- Shipping costs.
- Vehicle fitment search and TecDoc.
- Tyres, building materials, and plumbing and electrical supplies.
- Amazon (its product API access is limited to affiliates with recent sales).
- Open Icecat enrichment.
- Scheduled imports.
- Any language other than Spanish.
