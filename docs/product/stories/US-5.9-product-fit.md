# S5.9 With a car selected, the product page tells me whether the part fits it, and any visitor can see which cars it fits

Status: approved 2026-11-17 (the human, D-8) and built on branch `278-product-fit`; the review gate passed with every AC met or met with a note. Rulings that shaped the text below: D-1 (a failed fit read degrades the page), D-2 (the demo extension), D-6 and D-7 (the list for every visitor; an unavailable car renders as without a car), now written into `docs/product/vehicle-fitment.md` rule 8, marked for the owner to review. Board status follows the human's own move
Epic: E5 Browse and search (#13) · Priority: P0 · Size: set on the board
Issue: #278 · Tickets: #279-#280 (T5.9.1-T5.9.2)
Depends on: S5.5 (#261), S5.6 (#265), S5.7 (#269) and S5.8 (#274), all merged: the fit state, the fitment data, the selected car in the URL, and the listings that use it. S5.9 is the last story of the car feature.
Source: `docs/product/vehicle-fitment.md` rule 8 (and rules 2, 3, 4 and 9); decision 0016; `docs/product/stories/US-5.5-vehicle-fitment-model.md` and `US-5.7-select-car.md` (both hand S5.9 its slice); `docs/product/stories/US-5.8-filter-by-car.md` (shape precedent); the approved delivery brief and the human's rulings D-1 to D-4, D-6 and D-7 of the run that built it (D-5 is superseded by D-6 and D-7); issue #278 acceptance outline (not read by the drafting lane: see Notes for the human); guardrails 1 and 5.

## Open decisions

No ruling is open: the human has ruled every question the framing raised (D-1, D-2, D-4, D-6, D-7). Nothing blocks the dispatch of the UX or design passes. What follows are assumptions this draft had to make, confirmed by approving the story, and two choices of ticket shape. Each is stated in the AC named; a different answer changes only those ACs.

1. **A-1. The link on a list row carries the row's own vehicle, not the selected car.** Each row links to the product's own category filtered for the vehicle of that row (AC 18), so a visitor can see what else fits that vehicle. This is the one link on the page whose `coche` is not the selected car; the rest keep the selected car (AC 22). The brief and the issue outline say "filtered for that vehicle" and the spec says nothing; the alternative is a row that is plain text with no link. Recommendation: keep the link as drafted.
2. **A-2. A "row" is one distinct vehicle.** The rule "collapsed beyond 10 rows" (spec rule 8) counts vehicles, not group headings, so a list with 10 vehicles in any number of make or model groups is not collapsed and 11 is (AC 19). The spec does not define "row". Recommendation: as drafted.
3. **A-3. The two reads fail independently.** The read that decides the banner and the read that lists the vehicles may both be one read or two; the design pass decides. Whichever it is, the visitor-visible result is as the ACs say: a banner read that fails shows the could-not-check line (AC 10) and a list read that fails omits the list (AC 21), each without changing the other. The could-not-check line appears only for a selected car; a visitor with no car whose list read fails sees no message, only the missing list.
4. **A-4. The demo extension is at least 11 vehicles, recommended 12.** D-2 says the collapse must be reachable in the demo and in Playwright; AC 29 fixes the floor at 11, one past the boundary, and the test plan asks the integration fixture for 12 or more as D-2 says. Which non-demo vehicles are added is the test lane's pick from the vehicle list.
5. **Ticket shape follows S5.8 and the approved framing, not a new ruling.** Tests are a dispatch after each ticket, not a separate ticket (S5.8 D-5), and the UX pass is a phase with no issue (S5.8 D-6). The framing brief proposed both and the human approved the framing (D-3). Confirmed by approving this story; if the human wants a T5.9.3 for tests or an issue for the UX pass, say so.

**Ruled, applied here, not open.**
- D-1: a known car whose fit read fails does not fail the page. The page renders with its offers, one line in the banner's place says compatibility could not be checked, the list is omitted if its read fails, and one fixed log line names neither car nor product (ACs 10, 21, 27). This differs deliberately from the listings (S5.8 D-4), where a failed read fails the page; the product page carries the offers and the shop links, and the list read now runs for every visitor.
- D-2: the demo product `demo-filtro-de-aceite-bosch-of-3306` gains extra non-demo vehicles in its fitment so the collapse is reachable in the demo and in a browser, plus a unit test at 10 and 11 rows and an integration test with 12 or more fitments (AC 29, test plan).
- D-4: the no-fit link goes to the product's own category with `coche`; only counted fitments from approved feeds and shops count, one row per distinct vehicle; the page is never hidden, only marked; JSON-LD, `noindex`, canonical and the sitemap are unchanged; whether the list links carry `rel="nofollow"` is left to the design pass.
- D-6: the "Vehículos compatibles" list shows for every visitor and is omitted only when the product has no counted fitment; the fit label shows only with a selected car; every product stays visible and searchable whatever the car (ACs 7 to 9, 12, 13).
- D-7: a selected car that cannot be read renders the page as without a car (AC 9).

## Story

As a visitor who has picked a car, I see on the product page, above the offers, whether the part fits my car, and if it does not, a way to see what does. Whether or not I have picked a car, I can see which cars the part fits, grouped by make and model.

S5.5 built the fit state, S5.6 the fitment data, S5.7 the selected car in the URL and S5.8 the listings. Today a visitor with a car must go back to a listing to learn whether a part is compatible, though the product page is where they decide to click out to a shop. After this story the page answers it. With no car selected, or one the site does not recognise, the page shows no fit label, only the list of the cars the part fits (when there are any), and every offer, as before.

## Scope

In:
- the fit banner above the offers, with a selected car, in three states (fits, no-fit, no data), and its absence for no, unrecognised or unavailable car (ACs 1 to 11);
- the could-not-check line when the car is known and the fit read fails (AC 10);
- the "Vehículos compatibles" list for every visitor: counted scope, distinct vehicles, grouped by make and model, ordered as the vehicle list, collapsed beyond 10 rows without JavaScript, each row linking to the product's own category filtered for its vehicle, and omitted when there is nothing to list or its read fails (ACs 12 to 21);
- `coche` on the new links, none on `/go` links (ACs 22 and 23);
- what stays unchanged: JSON-LD, `noindex`, canonical, sitemap, hidden and no-public-offer products, cookies, storage and logs (ACs 24 to 28);
- the demo extension that makes the collapse reachable (AC 29, D-2);
- the words-not-colour, heading, keyboard and reflow reading of the new elements (ACs 30 to 32);
- updating existing tests that pin the product page or the demo fitment.

Out, for this story (listed so a lane does not do them here):
- any change to the picker, the header car control, `localStorage`, `/mi-coche`, the unrecognised-car notice, the category page or search (S5.7 and S5.8 own them);
- any change to how a fitment counts or to what a fit state is (spec rule 2, S5.5);
- any fitment write outside the import, any admin screen, any real feed's fitment mapping (S3.5);
- a "compatible products" cross-sell, a fit mark on the product's offers, or fit data in the structured data;
- the exact es-ES copy of the banner, the could-not-check line, the list heading and the collapse control, and the look and placement of all of them, which belong to the UX pass (spec rule 9) and reach the page through the message file;
- the server read, the loader shape, component names, the ticket split between lanes and `rel` attributes on the list links, which belong to the tech lead;
- the privacy page sentence (S5.8 already carried it).

## Acceptance criteria

Copy in these ACs is intent only; the exact wording is the UX pass's (spec rule 9). The fit label intents are the spec's rule 8 strings: "Compatible con tu <coche>", "No es compatible con tu <coche>" and "Sin datos de compatibilidad para tu coche". "Selected car" means a `coche` value that names an active vehicle (S5.7); "unrecognised" and "unavailable" are the states of `src/server/car/state.ts`. The three fit states are the spec's: `fits`, `no-fit` and `unknown`. "Counted fitment" is spec rule 2's: a fitment whose feed and shop are approved and whose vehicle is not retired. "The product's category" is the product's own category, the one it is listed in. A "row" of the list is one distinct vehicle (A-2).

The banner with a selected car

1. With a selected car, the product page shows exactly one fit banner, before the offers in reading order, in one of the states of ACs 2 to 4 or the line of AC 10.
2. If the product has a counted fitment to the selected car, the banner says the part is compatible and names the car (intent: "Compatible con tu Seat León III 1.6 TDI").
3. If the product has counted fitments and none is to the selected car, the banner says the part is not compatible and names the car (intent: "No es compatible con tu …"), and carries a link to the product's category filtered for the selected car, whose target is that category's path with `coche` set to the selected car and no other query parameter (D-4).
4. If the product has no counted fitment, the banner says there is no compatibility data for the car (intent: "Sin datos de compatibilidad para tu coche") and does not say the part fits or does not fit.
5. Only counted fitments decide the state: a product whose only fitments come from an unapproved feed, an unapproved shop or a retired vehicle shows the no-data banner of AC 4, not the no-fit banner of AC 3 and not the fits banner of AC 2 (D-4; spec rule 2).
6. A product page is never hidden or changed by the fit state, only marked (rule 8): in all three states the page answers with the same status, and shows the same title, the same offers in the same order with the same prices and shop links, and the same description and breadcrumb, as it does without a car.

No car, an unrecognised car, an unavailable car, a failed read

7. With no `coche`, the page shows no banner and no could-not-check line.
8. With an unrecognised `coche`, the page shows no banner and no could-not-check line, and the unrecognised-car notice of S5.7 is unchanged.
9. (D-7.) With the car unavailable (the vehicle read failed), the page renders as without a car: every offer, no banner, no unrecognised-car notice and no could-not-check line, the status it would have without a car, and still `noindex` under `coche`.
10. (D-1.) With a selected car and a failure of the read that decides the fit state, the page still answers with the status it has without a car and still shows every offer; in the banner's place one line says compatibility could not be checked, and it states neither that the part fits nor that it does not.
11. The banner follows the URL, not the browser's storage: a page opened without `coche` shows no banner even if the browser holds a car, and shows the banner once the S5.7 script has added that car's `coche` to the URL, as the listings do.

The list of compatible vehicles

12. (D-6.) A product with at least one counted fitment shows the list of the vehicles it fits to every visitor: with no car, with an unrecognised car, with an unavailable car and with a selected car, whatever the fit state of that car. The list has a heading (intent: "Vehículos compatibles").
13. (D-6.) A product with no counted fitment shows no list: no heading, no empty-state text.
14. The list contains each vehicle of the product's counted fitments once, however many feeds give it (the demo product of AC 29 gets León from two feeds and shows it once). A vehicle that is retired, and a vehicle whose only fitments come from an unapproved feed or shop, is not in the list.
15. With a selected car and a working list read, the banner of AC 2 appears exactly when the list contains the selected car's vehicle, and the banner of AC 3 exactly when the list is non-empty and does not.
16. The list is grouped by make, then by model within the make, each group labelled with the make and model; groups and the vehicles inside them follow the order of the site's vehicle list, the order the picker uses.
17. No two rows of the list read the same: each row tells a vehicle apart from the other vehicles of its model (intent: generation, engine, power or fuel, and years on sale; the UX pass chooses which).
18. (A-1.) Each row links to the product's category filtered for the row's vehicle: the category's path with `coche` set to that vehicle's slug and no other query parameter, whether or not a car is selected.
19. (A-2.) A list of 10 vehicles or fewer is shown in full with no collapse control, and exactly 10 is not collapsed. A list of 11 or more shows its first 10 vehicles in list order, and the rest sit behind a control that says how many more there are; the heading of a group none of whose vehicles is visible is not visible while collapsed.
20. The collapse works with JavaScript disabled, and the vehicles beyond the first 10 are in the page's HTML as first served, not fetched or built by a script.
21. (D-1.) If the read that lists the vehicles fails, the list is omitted and nothing else about the page changes: the same status, the same offers and the same banner as when the read works.

Links

22. The links the page already carries keep `coche` as S5.7 requires (S5.7 ACs 43 to 47), with a selected car and with an unrecognised one: the breadcrumb links, the link of AC 3 and the header. The only link whose `coche` is not the selected car is a list row (AC 18). A page with no `coche` and no selected car carries no `coche` on any link except the list rows.
23. A link to a shop, `/go/<offer>`, carries no `coche` and no other fit information, with or without a car (spec rule 5), and following a list row or the link of AC 3 does not write the browser's stored car (spec rule 4).

Unchanged by this story

24. The structured data of the page (JSON-LD) has the same keys and values with and without a car, in every fit state and for every list, and carries no fit or vehicle information (D-4; `docs/product/mvp.md`).
25. A page opened with `coche`, valid or not, stays `noindex` with no canonical; a page opened without it keeps the `noindex` and canonical it has today, whether or not it has a list; the sitemap files and `robots.txt` are unchanged, and the sitemap lists no URL with `coche` (D-4; S5.7, S6.2).
26. A hidden product and a product with no public offer still answer 404 whatever the car, and the fit state, the banner and the list never make a hidden product reachable (guardrail 1).
27. The selected car appears in no cookie, in no data stored on the server and in no application log output; a failure of the fit read (AC 10) or of the list read (AC 21) writes one fixed line that names neither the car nor the product (guardrail 5; D-1).
28. The banner and the list work with JavaScript disabled: the whole state is in the URL.

The demo data (D-2)

29. After the import of the demo feeds, the demo product `demo-filtro-de-aceite-bosch-of-3306` fits at least 11 distinct vehicles from at least three makes, and still fits the Seat León III 1.6 TDI, the Volkswagen Golf VII 1.6 TDI and the Renault Clio IV 1.5 dCi it fits today; its fit state for each of the six demo cars is the same as before the extension, and no other demo product's fitments change. The import still reports no unknown vehicle for the demo feeds, and importing again changes no fitment row (spec rule 2).

Layout, words and keyboard

30. The banner states its state in words, not in colour or a glyph alone, and the three states and the could-not-check line read differently from one another for a screen reader.
31. The list heading is a real heading in the page's outline below the product title. The collapse control can be reached and operated from the keyboard alone and tells assistive technology whether the rest of the list is shown.
32. The banner, in each of its four states, and the list, collapsed and open, show no sideways scroll and no cut-off text at 390 and 1280 px, with the longest car label in the vehicle list selected and with the 11-or-more demo list; the existing reflow checks at 360 and 195 px still pass.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the server read that lists a product's vehicles and how the page gets the product's identity to the fit read (the loader shape is the tech lead's, per recon § Q1 it returns no id today), and whether one read serves the banner and the list or two serve them (A-3);
- how the product page reads the car state for the unavailable and read-failure behaviours, and how the cache of the loader stays correct with a car;
- the cost of one extra read for every product page request, which today has none (D-6), and whether it needs measuring;
- whether the list links carry `rel="nofollow"` (D-4), given about 50 links to `noindex` URLs from an indexable page;
- which ticket carries the loader change, so the product identity is added once (the banner and the list both need it);
- the components, the message keys and the loading of the `Fit` and `Car` namespaces on the page.

Left to the UX pass (direction: new, no S5.7 spec covers this surface): the wording and look of the banner in its four states, the placement of the list, the row content (AC 17), the collapse control and its copy, and whether the selected car's row is marked in the list.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 6, 10 | integration in `tests/integration/product-page.test.ts` or beside it, for a product page opened with a selected car: the three states from the demo products (`demo-filtro-de-aceite-bosch-of-3306` fits and `demo-filtro-de-aceite-mahle-of-1124` is no-fit for the Seat León III; `demo-filtro-de-aceite-oc-1234` is unknown), fitments from an unapproved feed or shop and from a retired vehicle making the product unknown, the page unchanged otherwise, and a failing fit read leaving the page up with the could-not-check line |
| 7 to 9, 11 | integration or e2e for no, unrecognised and unavailable car, and storage without `coche`; the existing no-car assertions must pass unchanged |
| 12 to 17, 21 | integration with `insertFitment` fixtures (`tests/support/catalogue.ts`) for 12 or more vehicles: grouping by make and model, order of the vehicle list, one row per vehicle across feeds, counted scope, retired vehicles, a product with none, a list read that fails |
| 15 | the banner and the list agree for a car in and a car out of the list |
| 19, 20 | a unit test of the list component in `tests/unit/product-components.test.ts` with synthetic rows at 10 and 11 (and 0, 1 and a single group), proving the boundary and the control; e2e on the extended demo product with JavaScript disabled: 11 or more vehicles in the first HTML, the first 10 shown, the rest behind the control |
| 18, 22, 23 | e2e crawl of the product page's anchors in the pattern of `tests/e2e/car-links.spec.ts`: banner link, breadcrumbs, header, row links with the row's slug, `/go` with none; the stored car unchanged after following a row |
| 24, 25 | `tests/unit/product-jsonld.test.ts` and `tests/integration/product-jsonld.test.ts` unchanged and passing; e2e in `tests/e2e/seo.spec.ts` for `noindex` and canonical with and without `coche`, and the sitemap |
| 26, 27 | integration for a hidden and a no-offer product with a car; log check in the pattern of `tests/e2e/search-privacy.spec.ts` for the car and for the failure lines; `set-cookie` absence under a car |
| 28 | e2e with JavaScript disabled for each banner state |
| 29 | the importer integration tests (`tests/integration/importer-demo.test.ts` and the S5.6 fitment tests) for the extended product: distinct vehicle count, the six demo cars' states unchanged, no unknown vehicle, no change on re-import; `tests/fixtures/demo.ts` if it pins the product |
| 30 to 32 | e2e at 390, 1280, 360 and 195 px in `tests/e2e/reflow.spec.ts` or `tests/e2e/product.spec.ts`; heading outline, banner text per state and the control by keyboard; screenshots by `ux-review` at phone and desktop |

Existing tests this story must review and update, not loosen: `tests/e2e/product.spec.ts` and `tests/unit/product-components.test.ts` (they may assert the page has no fit wording; unverified, see Notes), the product page cases of `tests/e2e/car-links.spec.ts`, and every test that pins the number of fitments or vehicles of a demo product, which the extension of AC 29 changes by design. `tests/unit/seams.test.ts` keeps passing: the fit rules stay in `visibility.ts` and `fit-state.ts` only, and the importer stays the only writer of fitments.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story; a UX pass (direction: new) fixes the banner's four states, the list, the collapse and the copy; a design pass (tech lead) fixes the read and the loader. The design pass may merge, split or rename the tickets. Each ticket has a test dispatch after it. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.9.1 (#279) backend and frontend, then test. The fit banner.** The product's identity reaching the fit read, the banner above the offers in its three states and the could-not-check line, the no-fit link, the behaviour for no, unrecognised and unavailable car, new message keys. Needs the UX pass and the design. ACs 1 to 11, 22 and 23 (banner link and breadcrumbs), 24 to 28 for the banner, 30 and 32 for the banner. Test dispatch after it: the integration tests for the states and degraded cases, the e2e per state with and without JavaScript, the link crawl.
2. **T5.9.2 (#280) backend and frontend, then test. The list of compatible vehicles.** The new read of a product's counted vehicles, the list grouped by make and model, ordered as the vehicle list, collapsed beyond 10 rows without JavaScript, the row links, the omission when empty or failed, and the demo extension of `demo-filtro-de-aceite-bosch-of-3306` (D-2). Needs #279 (the page and the loader it changes) and the UX pass. ACs 12 to 21, 22 and 23 (row links), 24 to 28 for the list, 29, 30 to 32 for the list. Test dispatch after it: the integration test with 12 or more fitments, the unit test at 10 and 11 rows, the extended-demo e2e with JavaScript disabled and the reflow checks, and the update of the importer pins.

If the demo extension stalls on the importer pins, T5.9.2 ships its integration and unit proof first and the demo edit follows in the same pull request on this story, not as a second story.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/product/vehicle-fitment.md` rule 8: required. One clarifying sentence (the drafting brief's contract note, ruled by D-6): the list shows for every visitor, with or without a selected car, and is omitted when the product has no counted fitment; and one for the product page with an unavailable car (D-7) and a failed fit read (D-1). The docs lane drafts and the owner reviews, as for S5.8 D-1.
- `docs/design/system.md`: rows for the fit banner (four states), the compatible-vehicles list and its collapse control, from the UX pass; its counts or inventory row if it has one for the product page.
- `docs/product/stories/US-5.5-vehicle-fitment-model.md` (line 35) and `US-5.7-select-car.md` (line 46): the pointers that defer the banner and the list to S5.9, if the docs lane records built state in them.
- the frontend, backend and testing packs, for the conventions this story sets (a supplementary read that degrades instead of failing the page; a synthetic-row unit test for a boundary demo data cannot reach).
- the demo-data description wherever it states what a demo product fits, if any, for the extension of D-2.
- `CLAUDE.md`: no change identified; `docs/product/mvp.md`: no change identified (its line on the product page cites decision 0016); decision 0016: no change identified.

## Notes for the human

- **Issue #278 and tickets #279 and #280 were not readable by the lane that drafted this.** The ACs are built from the approved brief, the rulings, the spec and the code, not from the issues' own acceptance text. Compare the issue's outline with the ACs when approving, in particular the row link of AC 18, the "10 rows" boundary of AC 19 and the 390 px check. The orchestrator removes the sentence "copy and look from the S5.7 UX spec" from #279 and #280 (D-4): no such spec exists for this surface.
- **Real products show only the no-data banner and no list until a real feed maps a fitment field (S3.5, spec rule 2).** Only the demo feeds carry fitment today, so the value of this story rests on demo data, as S5.8's did.
- **The collapse is the one behaviour demo data could not reach**, which is why D-2 edits the demo product. Without D-2 no browser would ever see a collapsed list.
- **The product page now makes a fitment read for every visitor**, where today it makes none, so a regression in that read affects every product page. That is why a failure degrades the page (D-1) rather than failing it.
- **Unverified:** that `tests/e2e/product.spec.ts` and `tests/unit/product-components.test.ts` do not assert the absence of fit wording, and what the S5.6 importer tests pin. The test lane checks both before the page changes.
