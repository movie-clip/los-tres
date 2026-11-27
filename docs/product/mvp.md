# Los Tres — MVP scope

Agreed with the owner on 2026-10-16 in a grilling session. It replaces the
earlier marketplace scope of 2026-10-12, which was deleted. Amended on
2026-10-18 after the backlog revision, and the owner approved the amendment.
Amended again on 2026-10-22: the goal is now a working **prototype** (owner
ruling, see *Prototype phase*).
Amended on 2026-11-19 (owner ruling, decision 0017): data sources, the
prototype's done line, feed offer links and outgoing clicks.
Amended on 2026-11-27 (owner ruling, S15.2, #401): category attributes and the engine-oil filters (see *Category attributes*).
This is the approved MVP scope: what is in, what is out, and the owner calls
already settled. A change to anything here is the owner's call.

## Goal

A **price-comparison site for Spain**, in the family of hotline.ua: a
catalogue of products, each with a list of shops that sell it and a link to
buy there. Los Tres never sells anything itself.

**Current target: a working prototype** that is quick to change. It runs
locally on Docker Compose with the proper stack and architecture, but without
production, legal or ops work. The prototype is done when the feed import,
matching, catalogue, search and admin core work end to end locally: real
shop data, hand-built or from a feed, imported on the local stack, its offers
in the five maintenance categories, matched, searchable by text, EAN or part number, and
sorted by price.

The full MVP (live site, at least 3 approved feeds, 10k products indexed by
Google, first clicks and commission) remains the later goal; the work it needs
is listed under *Deferred until after the prototype*.

The team is the owner (developer, steering AI agents) and two friends. There
is no deadline.

## Name

"Los Tres" is a code name. The public site name is configuration, not code, so
the owner can change it without a code change.

## Look and feel

Owner ruling, 2026-11-26 (S14.1, #397): the public site comes in a light and
a dark scheme, with a switch the visitor controls (the choice is kept in the
browser only), in Direction A, Taller. A first visit follows the visitor's
system setting. The approved system is `docs/design/system.md`; its build is
#398 and #399, so until those merge the site is light only.

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
  a code change, and there is no admin tree editor. Each feed category is
  mapped once by the admin to one of the five (S4.2). Products from an
  unmapped feed category are not public until the admin maps the category
  (owner ruling, 2026-10-17). Since S4.2 (shipped 2026-11-19) the admin does
  this at `/admin/categorias`: a save, change or removal re-applies to the
  existing products at once, with no import; the admin can mark a feed
  category outside scope so the list of categories still to review can reach
  empty; removing a mapping or marking a category outside scope takes its
  products off the public site at once. The importer is unchanged: it sets a
  product's category only while it has none and never overwrites or clears it.
  A mapping gives a category and nothing else; a product is public only while
  its feed and shop are approved and it is not hidden.
- **Vehicle fitment ("Mi coche")** (owner ruling, 2026-10-28, decision 0016):
  a visitor selects make, model and engine; listings and search show the
  parts that fit first, then parts with no fitment data, and the product page
  says whether the part fits. The vehicle list is our own, in code; fitment
  comes from feeds only; the choice is kept in the URL and the visitor's
  browser, never on the server. Spec: `docs/product/vehicle-fitment.md`.
  Parts are still also found by part number, EAN or text.

## Product and offers

- **One product, many offers.** A product page lists every shop that sells
  it, sorted by price from lowest to highest, like hotline.ua.
- **Price** is the product price only: integer cents in EUR, IVA included.
  **No shipping costs** anywhere.
- Each offer shows the shop, the price and "Actualizado el <date>", and links
  out through our redirect (see *Outgoing clicks*). The row at the lowest price
  carries a "Mejor precio" tag when at least two distinct prices exist.
- **Products with a single offer are shown.** The page says "1 shop".
- **Product text** (title, brand, part number, EAN, description and the attributes of *Category attributes*)
  comes from the feeds. When feeds disagree, the first feed's text stays (no
  shop ranking in the MVP). On the product page a blank or whitespace-only
  brand, part number, EAN or description counts as absent (read as null) and
  its line is not shown.
- **Deferred until after the prototype** (owner ruling, 2026-10-26): product
  images uploaded by the admin, the price history chart, keeping a product page
  when it loses all its offers, and feed attributes on the product page other than the engine-oil attributes of *Category attributes*.

## Category attributes

Owner ruling, 2026-11-27 (S15.2, #401). Each category has a fixed list of attributes, defined in code like the category tree (S4.0), with no admin editor; changing it is a code change. The list, with each attribute's unit or closed set and its rule for a value that does not parse, is `docs/product/category-attributes.md`.

- Attributes come from feeds only; nothing is read from a title, a description or a shop page.
- Engine oil stores five attributes, all shown on the product page. Viscosity grade, volume and ACEA norm are also category-page filters. Oil type and manufacturer approvals are shown only and are not filters.
- Oil filters, air filters, fuel filters and cabin filters store no attribute and have no attribute filter.
- A value that does not parse is stored as absent and shown nowhere. Its product stays in the category and is left out of an active filter on that attribute, and the page says how many were left out.

## Matching

Offers from different feeds are matched to one product by **EAN first**, then by
**brand + manufacturer part number** with spaces, dashes and dots removed and
upper-cased. If the EAN and the brand disagree, the offer is not merged and
stays its own product; an admin review queue for these is deferred until after
the prototype. There is no merge or split in the MVP (owner ruling, 2026-10-26).
Decision 0008 holds the detail.

## Search and browsing

- Free-text search in PostgreSQL that also matches EAN and part numbers.
- With a car selected, category pages and search results are filtered by fit
  (decision 0016).
- Category pages list products as a card grid with sort (price ascending, price descending, name) and a brand filter. The engine-oil category also has three attribute filters, viscosity grade, volume and ACEA norm (owner ruling, S15.2, #401); no other category has an attribute filter. Price and shop filters are deferred.
- Product pages are server-rendered with schema.org `Product` / `AggregateOffer`
  structured data, so Google can show prices in its results.

## Data sources

- **Registered feeds only** (decisions 0007 and 0017): affiliate network
  feeds, feed files written by hand, and feed files made by the owner's
  local-only collector, a separate tool in a separate private repository that
  runs by hand and is never deployed.
- **No scraping in this repository.** The app, its image, its scripts and its
  tests never crawl a shop, drive a browser against one or parse its HTML. This
  is a guardrail.
- **Collected data never appears on a public site.** Using it there needs a new
  owner decision (0017).
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
manages**, never code. Adding a shop means entering its name and a feed in the
admin area. Since S3.1 the admin creates and edits networks, shops and feeds on
the admin shops page, with no code change and no delete (disable is the only
removal). A new shop and a new feed start unapproved, and a feed's approval is
separate from its shop's. Replacing an approved feed's URL
returns that feed to unapproved in the same write. Since S3.7 a feed is either
an affiliate feed (network and https address) or a catalogue-file feed (a bare
file name in a fixed local folder, no network). Changing the file name of an
approved file feed returns it to unapproved in the same write, as replacing a
URL does. A file feed's file name is shown in the admin; the folder's location
is not. A shop or network is marked
demo only when it has at least one feed and every feed is a demo feed; the
marker is derived, and no form sets it. The admin sees a feed URL as its host
only: never prefilled in a form, never in a log. Registering and approving a
feed does not by itself make real offers appear on the site. S3.5 maps each network's feed columns in code, chosen
by the network, with no admin screen and no mapping editor; offers use the tracking URL the
feed carries, an affiliate tracking URL when it has one and otherwise the
shop's own URL (a per-shop link pattern is deferred). A hand-written or
collected feed is a registered shop and feed like any other, behind the same two
approvals (decision 0017). A product's offer list is built only from imported
data.

A feed URL may hold an API key. Feed URLs are encrypted at rest before the
site goes live (owner ruling, 2026-10-18; moved from "first real feed" to
"go-live" on 2026-10-22, since the prototype imports a real feed locally); until
then the admin area shows them masked and nothing logs them. The encryption key
and the backup passphrase are kept in a password manager plus an offline copy
(owner ruling O13, 2026-10-22).

## Feed import

- A **separate import command**, `import-feeds`, reads each approved feed: CSV
  or XML, plain or gzip, from the feed's https address, or, for a catalogue-file
  feed, from a file the owner placed in the fixed folder `catalogue-files/`
  (S3.7). It checks every row and prints counts and
  rejected rows.
- **It is not scheduled.** It runs when someone starts it from the command
  line (all feeds, or one with `--feed`). An "Import now" button with stored
  reports in the admin area is deferred.
- One broken feed never stops the others, and an import never takes the site
  down.
- An offer missing from a feed's latest successful import is removed (S3.3,
  decision 0018): it is flagged removed, not deleted, and leaves the public site.
  Removal does not run when the import has no accepted row, or when it would
  remove 10 offers or more and more than 50% of the feed's current offers; the
  import prints a `removal: skipped` line; a skip does not change the exit code
  (exit 1 still means a feed failed). `--feed <id>
  --allow-large-removal` lifts the second guard only. An offer that returns in
  a later import is restored; hide is never undone by an import.

## Admin area

- Accounts for the three team members only, created by a command. There is no
  sign-up.
- Login is email + password in the prototype. The authenticator-app code
  (TOTP) is deferred, and the admin area is not deployed anywhere before it
  lands (decision 0012). Every admin route and action checks the role on the
  server.
- The admin:
  - manages networks, shops and feeds (creates and edits them, S3.1), and
    approves or disables them;
  - maps feed categories onto the five fixed categories, or marks one outside
    scope, at `/admin/categorias` (S4.2); a save moves the existing products
    at once;
  - hides any product or offer, and unhides it, at `/admin/productos` (S2.4);
  - reads, on each product and offer row there that is not on the site, the one
    reason it is not (S2.5);
  - reads, on each feed and each shop at `/admin/tiendas`, how many offers it
    has now (not removed by an import) and how many of them are on the site now
    (S2.6).

  Imports run from the `import-feeds` command; an import button with reports
  in the admin area is deferred.

## Visibility (guardrail 1)

Only offers from an **admin-approved feed** are public. Products from an
approved feed publish automatically once their feed category is mapped (by the
admin at `/admin/categorias`, S4.2); until then, or once the admin removes the
mapping or marks the category outside scope, they are not public. The admin can hide any product or offer,
and a hidden item is never public.

## Outgoing clicks

Every "go to shop" link goes through our own `/go/<offer>` redirect. It logs the
click and sends the visitor to the offer's shop URL, an affiliate tracking URL
when the feed carries one. The log holds offer, shop,
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
real-data stories (S3.1, S3.3, S3.5, S4.2, S7.1, S9.4) come up; S2.4 (hide) is built.
Infrastructure, hardening and the items listed below as deferred are closed on
the board and will be recreated when needed.

Deferred until after the prototype (closed on the board as not planned, to be
recreated when needed):
going live on a VPS over HTTPS (S9.1), backups (S9.2),
performance at 10k products (S10.1), feed URL encryption (S10.3), the
TOTP second factor (S2.2), Search Console, payee registration and network
review requirements. Also deferred on 2026-10-26: the admin import button
and reports (S3.2), per-shop link patterns (S3.6), the matching review queue
(S7.2), brand aliases (S7.3), price and shop filters (S5.3; brand filter and sort shipped in S11.4), product images (S8.1),
price history (S8.3), the no-offers page (S8.4), feed attributes beyond engine oil (S8.6) and
click counts (S1.3).

## Before going live

A short checklist for the day the site goes on a server (owner ruling, review
2026-11-20, D-14). The deploy story (S9.1) is deferred and closed, so this
section is its home until one exists.

- **Vehicle list.** The owner reviews the list in `src/db/vehicle-catalogue.ts`
  before launch, or at the first real feed with fitment, whichever comes first.
- **Reverse proxy logs.** The proxy must not log the query string of `/buscar`
  or `/mi-coche` (a search term travels there, and `/mi-coche?volver=` can hold
  one). The privacy page promises the term is neither stored nor logged
  (`CLAUDE.md` § Search engines).
- **Database pool.** Check the application's connection pool size against the
  server's PostgreSQL `max_connections`.
- **`SITE_URL`.** It must be the public https origin, or canonical links, the
  sitemap and `robots.txt` point at `127.0.0.1` (`CLAUDE.md` § Search engines).
- **Admin second factor.** The admin area is not deployed before the TOTP
  second factor (S2.2) lands (see Admin area, decision 0012), and feed URLs are
  encrypted at rest before go-live (see Shops and feeds are data).
- **Runtime image: done.** The image no longer holds `drizzle-kit`, `esbuild`,
  `tsx`, `vitest` or `playwright` (D-2). The Dockerfile guard fails the build if
  any of them reappears, and the gate's e2e runs on that image.

Removed: Umami analytics (S1.2), an owner review of the copy, and on
2026-10-26 the category tree editor (S4.1, replaced by the fixed tree in
S4.0), merge and split (S7.4, S7.5), shop logos (S8.2) and shop ranking for
product text (S8.5).


## Out of MVP

- Shops uploading their own feeds, and per-click billing.
- Ads, and any cookie-consent banner.
- Public user accounts, alerts, reviews, shop ratings and favourites.
- Shipping costs.
- TecDoc or any licensed vehicle catalogue, and plate (matrícula) or VIN lookup.
- Tyres, building materials, and plumbing and electrical supplies.
- Amazon (its product API access is limited to affiliates with recent sales).
- Open Icecat enrichment.
- Scheduled imports.
- Any language other than Spanish.
