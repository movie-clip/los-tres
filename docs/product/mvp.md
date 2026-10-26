# Los Tres — MVP scope

Agreed with the owner on 2026-10-16 in a grilling session. It replaces the
earlier marketplace scope of 2026-10-12, which was deleted. Amended on
2026-10-18 after the backlog revision, and the owner approved the amendment.
Amended again on 2026-10-22: the goal is now a working **prototype** (owner
ruling, see *Prototype phase*).
This is the approved MVP scope: what is in, what is out, and the owner calls
already settled. A change to anything here is the owner's call.

## Goal

A **price-comparison site for Spain**, in the family of hotline.ua: a
catalogue of products, each with a list of shops that sell it and a link to
buy there. Los Tres never sells anything itself.

**Current target: a working prototype** that is quick to change. It runs
locally on Docker Compose with the proper stack and architecture, but without
production, legal or ops work. The prototype is done when the feed import,
matching, catalogue, search and admin core work end to end locally: at least
one real affiliate feed imported on the local stack, its offers in the five
maintenance categories, matched, searchable by text, EAN or part number, and
sorted by price.

The full MVP (live site, at least 3 approved feeds, 10k products indexed by
Google, first clicks and commission) remains the later goal; the work it needs
is listed under *Deferred until after the prototype*.

The team is the owner (developer, steering AI agents) and two friends. There
is no deadline.

## Name

"Los Tres" is a code name. The public site name is configuration, not code, so
the owner can change it without a code change.

## Audience and language

- Consumers and talleres (workshops): anyone who wants to buy.
- All of Spain.
- The site is in **Spanish (`es-ES`)** from launch. All user-facing copy lives
  in message files, so another language can be added later. The agent network
  reviews and corrects the es-ES copy itself; the owner does not review it
  (owner ruling, 2026-10-22).
- No public accounts. Visitors never log in.

## Catalogue scope

- **Car maintenance basics only** (owner ruling, 2026-10-26): one top
  category, **Mantenimiento del coche**, with five children: Aceite de motor,
  Filtros de aceite, Filtros de aire, Filtros de combustible and Filtros de
  habitáculo. Other spare parts, tyres and the power and hand tools vertical
  are out of the MVP.
- **Categories:** this tree is fixed and seeded in code (S4.0); changing it is
  a code change, and there is no admin tree editor. Each feed category is mapped once by the admin to one of ours. Products from
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
  comes from the feeds. When feeds disagree, the first feed's text stays (no
  shop ranking in the MVP).
- **Deferred until after the prototype** (owner ruling, 2026-10-26): product
  images uploaded by the admin, the price history chart, keeping a product page
  when it loses all its offers, and feed attributes on the product page.

## Matching

Offers from different feeds are matched to one product by **EAN first**, then by
**brand + manufacturer part number** with spaces, dashes and dots removed and
upper-cased. If the EAN and the brand disagree, the offer goes to a review queue
instead of merging; the review queue itself is deferred until after the
prototype. There is no merge or split in the MVP (owner ruling, 2026-10-26).
Decision 0008 holds the detail.

## Search and browsing

- Free-text search in PostgreSQL that also matches EAN and part numbers.
- Category pages list products; filters (brand, price, shop) are deferred.
- Product pages are server-rendered with schema.org `Product` / `AggregateOffer`
  structured data, so Google can show prices in its results.

## Data sources

- **Affiliate network feeds only** in the MVP (decision 0007).
- **No scraping, ever**, of any site, for any purpose. This is a guardrail.
- First shops to apply to:

  | Area | Shop | Network |
  |---|---|---|
  | Auto | Oscaro | Kwanko |
  | Auto | Norauto | Effinity |

  Autodoc is the **design and UX reference**. It becomes a data source only if
  its affiliate programme provides a feed.
- **Later (out of MVP):** shops upload their own feed directly, as on
  hotline.ua. The data model must allow it without rework.

## Shops and feeds are data

Networks, shops, feeds and affiliate link patterns are **rows the admin
manages**, never code. Adding a shop means entering its name, network and feed
URL in the admin area. Each network's feed field mapping lives in code or
config in the prototype, with no mapping editor; offers use the tracking URL the
feed carries (a per-shop link pattern is deferred). A product's offer list is built
only from imported data.

A feed URL may hold an API key. Feed URLs are encrypted at rest before the
site goes live (owner ruling, 2026-10-18; moved from "first real feed" to
"go-live" on 2026-10-22, since the prototype imports a real feed locally); until
then the admin area shows them masked and nothing logs them. The encryption key
and the backup passphrase are kept in a password manager plus an offline copy
(owner ruling O13, 2026-10-22).

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
- Login is email + password in the prototype. The authenticator-app code
  (TOTP) is deferred, and the admin area is not deployed anywhere before it
  lands (decision 0012). Every admin route and action checks the role on the
  server.
- The admin:
  - manages networks, shops and feeds, and approves or disables them;
  - maps feed categories onto the five fixed categories;
  - hides any product or offer.

  Imports run from the `import-feeds` command; an import button with reports
  in the admin area is deferred.

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

None for now (decision 0014). The `/go/<offer>` click log is the only usage
record, and the site sets no cookie, so it needs no cookie-consent banner.

## Revenue

- **MVP:** affiliate commission on outgoing clicks.
- **Later:** per-click billing (CPC) for shops that upload their own feed, as
  hotline.ua does.
- **No ads in the MVP.** Ads would need a consent banner.

## Delivery

Docker Compose (decision 0004), **local only** in the prototype. Hosting, the
VPS, the domain and the payee entity are the owner's later decision.

The demo catalogue may be shown alongside real data. Demo
products are noindex and left out of the sitemap, and clicks on demo offers are
not counted. Pages that list only demo offers carry a short notice that they
are a demonstration, and the legal text says so in one line (owner ruling,
2026-10-18). No visitor IP address or user agent appears in the app or
container logs.

## Legal pages

The site carries a legal notice (aviso legal), a privacy policy and an
affiliate disclosure, linked from the footer of every page (LSSI-CE). They are
built and stay as they are; no further legal work is planned for the prototype,
and the final legal text and payee are the owner's later call. There is still
no cookie banner.

## Prototype phase

**Product first** (owner ruling, 2026-10-26): the prototype is judged by how
the product looks and works for a visitor, on a realistic demo catalogue, before
any real feed. The design reference for the catalogue is the **Sixt car-rental
results page** (layout, hierarchy, big cards, the price as the boldest
element); Autodoc stays the reference for auto-parts content. The work is epic
E11 (S11.1–S11.6) plus search (S5.4). The admin area stays as it is until the
real-data stories (S3.1, S3.3, S3.5, S4.2, S7.1, S2.4, S9.4) come up.
Infrastructure, hardening and the items listed below as deferred are closed on
the board and will be recreated when needed.

Deferred until after the prototype (kept on the board, labelled `deferred`):
going live on a VPS over HTTPS (S9.1), backups (S9.2),
performance at 10k products (S10.1), feed URL encryption (S10.3), the
TOTP second factor (S2.2), Search Console, payee registration and network
review requirements. Also deferred on 2026-10-26: the admin import button
and reports (S3.2), per-shop link patterns (S3.6), the matching review queue
(S7.2), brand aliases (S7.3), category filters (S5.3), product images (S8.1),
price history (S8.3), the no-offers page (S8.4), feed attributes (S8.6) and
click counts (S1.3).

Removed: Umami analytics (S1.2), an owner review of the copy, and on
2026-10-26 the category tree editor (S4.1, replaced by the fixed tree in
S4.0), merge and split (S7.4, S7.5), shop logos (S8.2) and shop ranking for
product text (S8.5).


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
