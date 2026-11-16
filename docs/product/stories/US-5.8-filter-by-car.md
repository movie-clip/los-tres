# S5.8 With a car selected, category pages and search show what fits it first, then what is unknown, and say what was left out

Status: draft 2026-11-16, awaiting the human's approval (board status Ready follows the human's own move)
Epic: E5 Browse and search (#13) · Priority: P0 · Size: set on the board
Issue: #274 · Tickets: #275-#277 (T5.8.1-T5.8.3)
Depends on: S5.5 (#261), S5.6 (#265), S5.7 (#269), S5.4 (#37) and S11.4 (#245), all merged: the fit state, the fitment data, the selected car in the URL, search, and the category brand chips and sort. S5.9 (#278) is independent of this story.
Source: `docs/product/vehicle-fitment.md` rule 3 (and rules 2, 4 and 8); decision 0016; `docs/product/stories/US-5.5-vehicle-fitment-model.md` and `US-5.7-select-car.md` (both hand S5.8 its slice); the approved delivery brief `agentic/runs/2026-11-16-s5-8-filter-by-car/02-product.md` and rulings D-1 to D-3 in the same run's `decisions.md`; recon `01-recon.md`; issue #274 acceptance outline (not read by the drafting lane: see Notes for the human); guardrails 1 and 5.

## Open decisions

None blocks the dispatch of the UX or design passes. The first item is the human's to confirm when approving this story; the ACs named follow the proposal, and a different answer changes only those ACs. The rest are choices about ticket shape, and assumptions this draft had to make.

1. **OD-1. What does a listing do when the selected car cannot be read (state `unavailable`)? Proposal, for the human to confirm.** No document states it today; `unavailable` means the vehicle read failed (`src/server/car/state.ts`), and neither listing page branches on it. Proposal: the listing renders as without a car, that is unfiltered and with no headings, marks or fit counts, so the page never claims to be filtered when it was not; the response status is the one the page would have without a car. A separate case: when the car is known but the fit read for the listing fails, the listing fails as it does today when its data cannot be read, and is not silently shown unfiltered under a selected car. Affects ACs 25 and 26. If the owner prefers a visible "could not check compatibility" line on the unfiltered listing, that is added to AC 25 and its wording goes to the UX pass.
2. **OD-2. Tests inside each ticket, or a separate test ticket?** As filed, #275 to #277 carry their tests, and S5.5 to S5.7 ran one ticket as two dispatches (build, then test). This network's convention is also a ticket of its own for tests. This draft keeps the filed shape and does not decide. Option A: keep three tickets, each followed by a test dispatch. Option B: add T5.8.4 (issue to be created) holding the integration, e2e and layout tests, run after #277. The cost of B is that #275 and #276 are reviewed without their proof.
3. **OD-3. Does the UX pass get an issue?** S5.7 gave its UX spec a ticket (#270). The brief puts a UX pass before #276 and #277 but files no issue for it. Option A: a UX pass dispatched by the orchestrator with no issue. Option B: an issue, T5.8.0, so the board shows the dependency. This draft lists it as a phase and numbers nothing.
4. **Assumptions this draft made, confirmed by approving it.** Each is stated in the AC named; the brief and the spec are silent.
   - **A-1.** With a brand selected on a category page, the three counts describe the same set the page lists, that is the brand's products (AC 12); the brand chips' counts keep not moving when a brand is selected (AC 15).
   - **A-2.** A no-fit product the search shows through the exact-code exception is in none of the three counts (AC 30). Whether the page also states how many such products it shows is the UX pass's call.
   - **A-3.** When every product of a category or search is left out, the page says so and offers a way to change the car; it does not offer a way to see the unfiltered list, because the browser re-adds the stored car to a page opened without `coche` (spec rule 5), so such a link could not work (ACs 21, 23, 35).
   - **A-4.** Whether a brand chip with a count of zero is shown is a UX call; the AC only fixes the number a chip carries.

**Ruled, applied here, not open.** D-1 (2026-11-16): the narrow exact-code exception is accepted. A product reached by an exact EAN or an exact normalised part number is shown even when it is `no-fit`, marked, after the unknown group, and never counted as left out. This contradicts spec rule 3's "never the `no-fit` products" and decision 0016's "left out" wording in letter, so both are amended at close-out (see Docs to reconcile); until then this story is the written statement of the exception, and the ACs below follow it. D-3: no new rule beyond D-1 for the left-out count and the no-fit mark; the "Compatible" mark on cards of the fits group stays; home category tile counts stay unfiltered; the out-of-scope list below stands; one design pass covers both loaders.

## Story

As a visitor who has picked a car, I see on a category page and in search results the parts that fit it first, then the parts with no compatibility data, and a line that says how many of each there are and how many were left out as not compatible. An exact part number or EAN I type is never silently lost: if it is a part that does not fit my car, I still see it, marked.

S5.7 delivered the choice and the URL that carries it and left the listings as they were. This story makes the listings use it. After it, with no car selected, or one the site does not recognise, nothing about the listings changes.

## Scope

In:
- the category page with a selected car: two groups, group headings, the "Compatible" mark on cards of the fits group, a counts line (fit, no data, left out), the no-fit products left out, sort and brand filter applied inside each group, brand chip counts over the filtered set, pagination over the combined list, and the empty and degraded states (ACs 1 to 26);
- the search results page with a selected car: the same grouping and counts, and the exact EAN and exact part-number exception of D-1 (ACs 27 to 36);
- what a missing page is when the page count depends on the car: the 404 decision of a page past the end follows the combined list (AC 18, AC 34);
- the unavailable-car behaviour, as a proposal (OD-1);
- keeping `coche` on every link and form the new views add, and every S5.7 guarantee about indexing, cookies and logs (ACs 37 to 39);
- the layout and keyboard or screen-reader reading of the new elements (ACs 41 and 42);
- a measurement of the cost of the filtered category listing on a large category (AC 43);
- updating the existing tests that open a listing with `coche` and assert it is unfiltered.

Out, for this story (listed so a lane does not do them here):
- the fit banner and "vehicles it fits" list on the product page (S5.9, #278);
- the home page category tile counts and the "all products" count, which stay unfiltered with a car selected (D-3; AC 40);
- any change to the picker, the header car control, `localStorage`, `/mi-coche` or the unrecognised-car notice;
- price and shop filters (S5.3, deferred), new sort options, and brand chips or a sort on search (neither exists today; adding them is a new feature);
- sitemap, canonical, robots and `noindex` behaviour (S5.7 and S6.2 shipped; AC 37 keeps them);
- the privacy page sentence about the stored car (S5.7 carried it; the human deferred it);
- any new fitment data, feed field, admin screen or vehicle (S5.5 and S5.6 own them);
- any scraping or external vehicle database (guardrail 2);
- the exact es-ES copy, the group-heading layout and the mark's design, which belong to the UX spec (spec rule 9), and the query shape, the loader signatures and the card type, which belong to the tech lead.

## Acceptance criteria

Copy in these ACs is intent only; the exact wording is the UX spec's (spec rule 9) and reaches the page through the message file. "Selected car" means a `coche` value that names an active vehicle (S5.7). The three fit states are the spec's: `fits`, `no-fit` and `unknown`. "Left out" means a public product in the page's scope whose fit state is `no-fit` and which the page does not list. "The page lists" means the products the page shows across all its pages, not only the current one. Where an AC says "category page" it applies at any depth of the category tree, as the listing does today.

What a category page lists

1. With a selected car, the category page lists its products in two groups, in this order: the products that fit the car, then the products with no compatibility data.
2. With a selected car, a product whose fit state is `no-fit` is not listed on a category page.
3. A product's fit state counts only fitments whose feed and shop are approved and whose vehicle is not retired (spec rule 2); a product whose only fitments do not count is listed in the no-data group, not left out.
4. A hidden product, and a product with no public offer, appears in no group and in no count on either page, whatever its fit.

Groups, headings and cards

5. Each group that has products on the page has a heading. The fits heading names the selected car (intent: "Compatibles con tu Seat León III 1.6 TDI"). The no-data heading is followed by a one-line explanation that these products have no compatibility data (intent: "Sin datos de compatibilidad").
6. A group that has no product on the current page has no heading.
7. On every page of the listing, a visitor can tell which group each card belongs to. Where a group continues from the previous page, the page says so by a repeated heading or by the mark in AC 8; the UX spec chooses which.
8. Each card of the fits group carries a mark that the product is compatible (intent: "Compatible"). A card of the no-data group carries no such mark.

Counts

9. With a selected car, the category page's count line states how many products fit, how many have no data and how many were left out (intent: "12 compatibles, 5 sin datos, 3 dejados fuera"), in place of the single product count shown without a car.
10. Each of the three numbers counts a product once, however many offers, shops, feeds or fitments it has.
11. The three numbers add up to the number of public products the same category page lists without a car (with the same brand selected, if any).
12. (A-1.) With a brand selected, the three numbers count that brand's products only.

Sort, brand filter and pagination

13. The chosen sort applies inside each group: every product of the fits group comes before every product of the no-data group, whatever the sort, and within a group the order is the chosen sort with the tie-break it has today.
14. The brand filter applies to both groups. A brand with products in one group only shows that group; a brand with products in neither shows the existing no-match state.
15. (A-1.) Each brand chip carries the number of that brand's products the page lists for the car (fits plus no data, not the left out), and that number does not change when a brand is selected or the sort changes, as chip counts do not today.
16. Pagination runs over the combined list, the fits group first, at the page size it has today. A page can hold the end of one group and the start of the next. The number of pages, and the "page n of m" text, are computed from the products the page lists and do not include left-out products.
17. Every link and form on the grouped category page, including any that this story adds, keeps `coche` as S5.7 requires (S5.7 ACs 43 to 47): pagination, brand chips, the sort form and the change-car action.
18. With a selected car, `?pagina=n` past the last page of the combined list answers 404, as a page past the end does today, and page 1 of a category that exists never answers 404, including when every product in it is left out. The decision is the same whether made by the page or by the check that runs before it.

Empty and degraded category states

19. With no product fitting the car and some with no data, the page says that no listed product fits the car and still lists the no-data group, with no fits heading.
20. With some products fitting and none with no data, the page lists the fits group only, with no no-data heading.
21. (A-3.) With products in the category but all left out, the page lists nothing, says that none of the category's products is compatible with the car, states how many were left out, and offers an action to change the car. It is not the empty-category state and it is not the brand no-match state.
22. A category with no public products shows the empty-category state it shows today, with no fit wording.
23. The change-car action of AC 21 works without JavaScript and returns the visitor to the same listing with the newly chosen car (S5.7's picker and return path).

No car, an unrecognised car, an unavailable car

24. With no `coche`, or an unrecognised one, the category page and the search page show the same products, order, counts, brand chips and pagination as before this story, with no group heading, no mark and no fit count; the unrecognised-car notice of S5.7 is unchanged.
25. (OD-1.) With the car unavailable, both pages render as AC 24 describes and answer with the status they would have without a car; no heading, mark or fit count claims the listing is filtered.
26. (OD-1.) With a selected car, a failure of the read that decides fit makes the listing fail as it does today when its data cannot be read; it is not shown unfiltered.

Search results

27. With a selected car, the search results page lists its results in the same two groups, with the same headings, mark and counts line as the category page (ACs 5 to 11), in place of the single result count; the products of AC 29 are listed after them.
28. A `no-fit` product matched by the search term as text only is not listed and is counted as left out.
29. (D-1.) A `no-fit` product matched by an exact EAN (8 or 13 digits) or by an exact normalised part number is listed, marked as not compatible with the car (intent: "No es compatible con tu Seat León III 1.6 TDI"), after the no-data group.
30. (D-1, A-2.) A product listed under AC 29 is not counted as left out and is in neither the fit nor the no-data number, so that the fit, no-data, left-out and AC 29 products together equal the number of results the same search gives without a car.
31. An exact-code match that fits the car or has no data is listed in its own group, not after the no-data group.
32. The exception of AC 29 applies on the search page only: a category page never lists a `no-fit` product.
33. Inside each group the order is the one search has today (exact EAN or part-number matches first, then lowest price, then a stable tie-break); the group order wins over it.
34. Pagination of search runs over fits, then no-data, then the AC 29 products, at the page size it has today; the page count does not include left-out products; a page past the end answers 404 as today, whether decided by the page or by the check that runs before it.
35. (A-3.) A search whose matches all exist but are all left out, with no exact-code hit, shows that matches exist and none is compatible with the car, states how many were left out, and offers an action to change the car that works without JavaScript. A search with no match at all shows the same message as without a car.
36. The search form and its links keep `coche` as S5.7 requires (S5.7 ACs 43 to 47).

Across both pages

37. A page opened with `coche`, valid or not, stays `noindex` with no canonical; canonical, the sitemap files, `robots.txt` and the `Referrer-Policy` of `/buscar` are unchanged by this story.
38. The selected car appears in no cookie, no stored data on the server and no application log output, including the fixed-code failure line of a loader, which still names neither the car nor the search term (guardrail 5).
39. The grouped views, the counts and the exact-code exception work with JavaScript disabled: the whole state is in the URL.
40. With a car selected, the home page category tile counts are the same as without one.
41. The new elements (headings, counts line, marks, empty states, the exact-code hits) show no sideways scroll and no cut-off text at 390 and 1280 px on the category page and the search page, with the longest car label in the vehicle list selected; the existing reflow checks at 360 and 195 px still pass.
42. Each group heading is a real heading in the page's outline below its title; the marks of ACs 8 and 29 are text, not colour alone, and are read by a screen reader as part of their card.

Cost

43. The cost of the car-filtered category listing is measured on a category of several thousand public products and compared with the same listing without a car; the numbers are recorded in the run's artifacts, and the human reads them before the category UI ticket (#276) is built. The threshold is for the design pass to propose and the human to accept, as none is set here.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- how the two loaders take the car, how the grouping and the counts are computed, and how the card carries its fit state: one design for both, so the search ticket reuses the category one;
- how the combined fits-first order, the counts and the page count are read, and whether the filtered listing needs a different read plan on a large category (AC 43);
- how the exact-code exception is recognised and placed after the no-data group inside the search query's existing code-match handling;
- how `missing-page.ts`, which asks both loaders whether a page exists, stays in step with the pages (ACs 18 and 34), and which ticket carries its search half if the search loader changes in #277;
- how the page cache key and the pages' use of the car stay correct;
- what the unavailable-car and fit-read-failure behaviour (OD-1) needs in the pages and loaders.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 4, 10 to 16 | integration against the database in `tests/integration/category-page.test.ts` or beside it: order of the two groups under each sort, counts once per product with several offers and fitments, the sum of the three numbers against the unfiltered total, brand filter and chip counts, pagination across the group boundary, hidden products, products from an unapproved feed, a retired vehicle, uncounted fitments making a product no-data |
| 5 to 9, 19 to 23 | e2e on the demo car (`CAR` in `tests/support/car.ts`), which has all three fit states over the public demo products; zero-fits, zero-no-data and all-left-out cases need a category or brand that produces them, or a fixture |
| 17, 36 | e2e crawl of the anchors and form results on the grouped pages, in the pattern of `tests/e2e/car-links.spec.ts` |
| 18, 34 | integration on the 404 decision, in `tests/integration/missing-page.test.ts`, for a page past the end of the combined list, page 1 with all products left out, and a retired or unrecognised car |
| 24 to 26 | integration or e2e for no, unrecognised and unavailable car; the existing no-car assertions must pass unchanged; failure of the fit read |
| 27 to 35 | integration in `tests/integration/search-page.test.ts` for text, EAN and part-number queries with a car: left out versus exception, no-fit hit after the no-data group, the sum of the numbers, a fitting or no-data code match in its own group, order within groups, pagination, hidden products and unapproved feeds never reaching the exception; e2e for one text, one EAN and one part-number search on the demo car |
| 37 to 39 | e2e for `noindex`, canonical and `set-cookie` absence under a car; log check in the pattern of `tests/e2e/search-privacy.spec.ts`; e2e with JavaScript disabled |
| 40 | e2e: home tile counts with and without a car |
| 41, 42 | e2e at 390, 1280, 360 and 195 px in `reflow.spec.ts`; heading outline and mark text; screenshots by `ux-review` at phone and desktop |
| 43 | the measurement, in the pattern of the existing sitemap-performance test if the design pass chooses a test, or a recorded run |

Existing tests this story must review and update, not loosen: every test that opens a category or search page with `coche` and asserts it is unfiltered, among them `tests/e2e/car-links.spec.ts` and the `coche` cases in `tests/integration/category-page.test.ts`; the positional calls of the category loader in `tests/integration/category-page.test.ts` and of the search loader in `tests/integration/search-page.test.ts` change with the loader signatures. `tests/unit/seams.test.ts` keeps passing: the fit rules stay in `visibility.ts` and `fit-state.ts` only.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets unless OD-3 says so: the human approves this story; a UX pass (direction: new) fixes the group headings, counts line, marks, empty states, whether a heading repeats across pages, and phone and desktop layout, because the S5.7 UX spec fixed no listing copy; a design pass (tech lead) covers both loaders in one order. The design pass may merge, split or rename the tickets. Each ticket has a test dispatch after it unless OD-2 chooses a separate test ticket. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.8.1 (#275) backend, then test. The category listing with a selected car.** Grouping, no-fit left out, counts, chip counts, sort and brand filter inside groups, pagination over the combined list, the unavailable-car and read-failure behaviour for the category page, the 404 decision in `missing-page.ts` (the design pass says whether the search half lands here or in #277), and the cost measurement. The shared card gains whatever it needs to carry fit. ACs 1 to 4, 10 to 16, 18, 24 to 26, 38 and 43. Test dispatch after it: the integration tests of the table, and the update of the existing category tests.
2. **T5.8.2 (#276) frontend, then test. The category page UI.** Group headings, the counts line, the mark on fits cards, the empty states with the change-car action, new message keys. Needs the UX pass and #275, and the human's reading of AC 43's numbers. ACs 5 to 9, 17, 19 to 23, 39 to 42. Test dispatch after it: the category e2e on the demo car and the layout checks.
3. **T5.8.3 (#277) backend and frontend, then test. Search with a selected car.** The same grouping and counts on `/buscar`, the exact-code exception of D-1 (shown, marked, after the no-data group, not counted as left out), the search empty states, the 404 decision for search if not in #275, and the search form keeping `coche` as a regression check (it already does since S5.7). Needs the UX pass, the same design as #275, and #275 and #276 built. ACs 27 to 36, 37 to 39 and 41 to 42 for search. Test dispatch after it: the search integration tests and the text, EAN and part-number e2e.

If OD-2 chooses a separate test ticket, T5.8.4 (issue to be created) takes the test dispatches above and runs after #277; if the exception of D-1 stalls, #275 and #276 ship first and #277 follows as its own pull request on this story, not as a second story.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/product/vehicle-fitment.md` rule 3: required (D-1). One bullet for the exception: an exact EAN or exact normalised part number hit that is `no-fit` is shown on search, marked, after the no-data group, and never counted as left out; "never the `no-fit` products" is qualified by it. Rule 8 gets at most a cross-reference. The docs lane drafts and the owner reviews (D-1 note).
- `docs/product/vehicle-fitment.md` rule 4 or 3: one sentence for the unavailable-car behaviour, once OD-1 is confirmed.
- `docs/decisions/0016-vehicle-fitment.md`, the "Unknown fit is shown, not hidden" bullet: one clause saying parts whose fitment excludes the car are left out, except an exact EAN or part-number search hit, which is shown and marked. It is an accepted owner decision, so the owner reviews the drafted clause.
- `docs/design/system.md`: rows for the group heading, the counts line, the "Compatible" mark and the no-fit mark, and the empty-state action, from the UX spec.
- the frontend, backend and testing packs, for the conventions this story sets (the grouped listing, the exact-code exception, the filtered-listing cost check).
- `CLAUDE.md`: no change identified; `docs/product/mvp.md`: no change identified (its lines on fitment cite decision 0016).

## Notes for the human

- **Spec and decision 0016 are amended at close-out, not before.** The exception is ruled (D-1) but both documents still say "never the no-fit products" until the docs lane drafts the clause and the owner reviews it. This story is the written statement in the meantime.
- **Issue #274 and tickets #275 to #277 were not readable by the lane that drafted this.** The ACs are built from the delivery brief, the spec and the code, not from the issues' own acceptance text. Compare the issue's outline with the ACs above when approving, in particular the "left out" and "No es compatible con tu coche" wording and the "Compatible" mark.
- **The cost of the filtered category listing is unmeasured.** The S5.5 design reasoned it, never measured it, and a category of a few thousand products is the unverified case. AC 43 puts the measurement first in #275 so that the plan can still change.
- **The no-fit exception appears only on search.** A category page never lists a product that does not fit the car; there is no code to type there.
- **Three tickets is the upper edge of one slice.** The category and search halves share one query design, which is why they stay one story; if the exception stalls, the category tickets ship first.
