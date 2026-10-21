# S5.1 Visitor browses products in a category

Status: approved (shipped on branch 34-category-browse, PR #215)
Epic: E5 Browse and search · Slice: 2 · Priority: P0 · Size: L
Issue: #34 · Tickets: #113-#118
Depends on: none
Source: backlog revision run 2026-10-17-mvp-backlog-revision, entry S5.1; owner ruling D-1/OD3; `docs/product/mvp.md` § Catalogue scope, § Visibility, § Search and browsing.

## Open decisions

Ruled: decision D-1 (2026-10-20), "approve, defaults". Every decision OD-A to OD-J took the default stated in its entry below; the acceptance criteria stand as written. The guardrail-1 wording note stays the owner's and was not ruled.

- **OD-A. Subcategory depth.** Default assumed: a category page includes products from every descendant at any depth (the tree is about 30 categories, so it is shallow). Alternative: direct children only.
- **OD-B. Sort order.** Default assumed: lowest visible price first, ties broken stably so a page never reshuffles between requests. Alternatives: alphabetical by title, or most offers first.
- **OD-C. Page size.** Default assumed: 24 products per page. Needs a number.
- **OD-D. URL shape.** Default assumed: `/categoria/<slug>` with the page as a `?pagina=<n>` query parameter, mirroring the existing `/producto/<slug>`. The slug is the category's stable slug (S4.1 keeps it stable on rename).
- **OD-E. Out-of-range or invalid page number.** Default assumed: a page number below 1 or not a number shows page 1; a number beyond the last page answers 404.
- **OD-F. Product mapped through two feeds to different categories.** When the same matched product arrives from two feeds whose categories map to different categories of ours, which one wins? Default assumed: the category follows the same shop ranking that decides product text (mvp.md § Product and offers); until S3.x ships the ranking, the earliest-imported assignment is kept. Alternative: the product appears in both.
- **OD-G. Product with several feed categories where only some are mapped.** Default assumed: the product is public if at least one of its feed categories is mapped. Alternative: all must be mapped.
- **OD-H. Product with no visible offers on a category page.** The "when a product loses all offers" behaviour (OD4) is still open. Default assumed: such a product is not listed on the category page (a card needs a lowest price), while its own product page is unchanged by this story.
- **OD-I. Product without an image.** mvp.md says the product shows its category's placeholder, but admin image upload (S8.1) is a later story. Default assumed: the card shows no image in this story (an image area is the ux lane's call); the placeholder lands with S8.1.
- **OD-J. Existing demo data.** Products imported before this story have no category. Default assumed: they are not public until the next `import-feeds` run assigns categories (per OD3), and the documented demo steps (CLAUDE.md) already include that import. The docs lane updates nothing beyond what the ACs imply.
- **Note for the human, not a decision for this story:** project.md guardrail 1 says a product is public while "not waiting in the matching queue". OD3 adds the unmapped state as a further necessary condition; the wording stays true, but the owner may want the unmapped state named there. That is the owner's edit, not this lane's.

## Story

As a visitor, I open a category and see its products with the lowest price and the number of shops, and open one.

## Scope

In: the product-to-category link and the feed-category mapping as data; the importer recording each product's feed category and assigning our category through the mapping; the rule that a product without a mapped category is not public; a server-rendered, paginated category page including subcategories; a product card; demo seed and demo feeds carrying categories and mappings.

Out (later stories): home page and navigation (S5.2), filters (S5.3), search, the admin screens to edit the tree or the mapping (S4.1, S4.2; until then the mapping exists only through the demo seed), product images and placeholders (S8.1), the product page changes.

## Acceptance criteria

Visibility and mapping

1. A product whose feed category has no mapping to one of our categories does not appear on any public page (category page, product page, `/go`) until it is mapped. A direct request for its product page answers 404.
2. The rule in AC 1 is enforced in the one shared visibility scope the public pages already use, so a page added later cannot show an unmapped product by omitting a check.
3. A product whose feed row carries no category is treated as unmapped (AC 1).
4. A hidden product, a product with only offers from unapproved feeds, and a product waiting in the matching queue stay non-public as before; this story adds a condition and removes none (guardrail 1).
5. Once a feed category is mapped, the next import (and any re-assignment of existing products) makes its products appear in that category without further manual steps.
6. Re-running `import-feeds` with unchanged feeds leaves category assignments unchanged and creates no duplicates.
7. The importer stores each product's feed category as the feed gave it, and the report of a run that meets a feed category with no mapping does not fail the run; the rows import and the products simply stay non-public.

Category page

8. An existing category opens a server-rendered page at the URL shape fixed by OD-D, with the category name as its heading.
9. The page lists the public products of the category and of its subcategories (depth per OD-A), each product once even if it is reachable through more than one path.
10. The page lists only public products (AC 1, AC 4); a hidden product or a product with no visible offer (OD-H) is absent.
11. Products are ordered as fixed by OD-B and the order is the same on every request for the same data.
12. The list is paginated at the size fixed by OD-C; the page shows which page the visitor is on and links to the previous and next pages where they exist.
13. The page number behaves as fixed by OD-E; no page number produces a server error.
14. A category with no public products, including one whose products are all unmapped or hidden, renders an empty state in es-ES and answers 200.
15. A category slug that does not exist answers 404.

Product card

16. Each card shows the product title, the brand, the lowest visible offer price and the number of shops, and links to the product page.
17. The lowest price on a card equals the first price on that product's own page, and the price is shown in EUR with IVA included, formatted from integer cents (guardrail 4). Shipping is not shown.
18. The shop count on a card counts only visible offers from approved feeds; a product with one shop reads as one shop, not as zero or plural.
19. A product with no brand renders the card without a brand and without a placeholder string such as "null" or an empty gap.
20. A card whose title or text is long does not break the layout of the page (the ux lane fixes how).

Copy and rendering

21. All visible text on the new page and card comes from the es-ES message files, with no inline user-facing strings.
22. The page is rendered on the server: its product list is present in the HTML response without client-side script.

Demo data

23. After the documented demo steps (`stack:up`, then `import-feeds`), the demo categories show demo products on their category pages, and at least one demo category contains products only through a subcategory, so AC 9 is demonstrable.
24. The demo data includes at least one feed category that is deliberately unmapped, with a product that therefore does not appear anywhere, so AC 1 is demonstrable.

## Test plan

Test files and exact names are the test lane's to choose after the tech lead's design. Coverage required:

- **Visibility (integration, database):** an unmapped product is excluded from the shared visibility scope; becoming mapped makes it appear; a product with no feed category is excluded; hidden, unapproved-feed and matching-queue products stay excluded; an unmapped product's page and `/go` answer 404. Include a regression that proves the rule sits in the shared scope rather than only on the category page.
- **Importer (integration):** category captured per product; assignment through the mapping; unmapped category leaves the run successful; second run is idempotent; a matched product from two feeds follows OD-F.
- **Listing read function (integration):** subtree inclusion at the decided depth, no duplicates, lowest price and shop count correct including a single-offer product, ordering and ties, page boundaries (first, last, beyond last), empty category, product with no visible offers.
- **Rendering (unit or component):** card with and without brand, one shop versus several, price formatting from cents, empty state, pagination links at first and last page.
- **e2e (Playwright, against the Compose stack):** open a demo category, see cards with price and shop count, open a product from a card and land on its page, see a subcategory product in the parent, never see the unmapped demo product, unknown slug gives the 404 page, empty category shows the empty state. Check at phone and desktop widths only where the ux lane's spec asks.
- **Guardrail 5 spot check:** the category page sets no cookie.

## Tickets

Ordered, contracts before consumers. Each traces to the ACs. The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.1.1 (#113) backend, M. Product-category link and feed-category mapping tables; importer captures and assigns.** ACs 3, 5, 6, 7.
2. **T5.1.2 (#114) backend, S. Visibility rule: products without a mapped category are not public.** ACs 1, 2, 3, 4.
3. **T5.1.3 (#115) backend, M. Category listing read function: lowest price, shop count, subtree, pagination.** ACs 9, 10, 11, 12, 13, 17, 18.
4. **T5.1.4 (#116) backend, S. Demo seed and demo feeds carry categories.** ACs 23, 24.
5. **T5.1.5 (#117) frontend, M. Category page and product card with es-ES copy.** ACs 8, 14, 15, 16, 19, 20, 21, 22.
6. **T5.1.6 (#118) test, M. Visibility, listing and e2e tests.** Every AC; coverage per the test plan.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff: `docs/decisions/` if the tech lead records the category-assignment choice; CLAUDE.md demo steps if the demo flow changes (OD-J); the mvp.md wording already matches OD3.
