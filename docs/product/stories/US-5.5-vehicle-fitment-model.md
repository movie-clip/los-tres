# S5.5 The site knows which cars exist and which products fit them

Status: draft, awaiting human approval (board status Ready follows the human's own move)
Epic: E5 Browse and search (#13)
Issue: #261 · Tickets: #262-#264 (T5.5.1-T5.5.3)
Depends on: none (S5.4 search is merged; S5.6 to S5.9 depend on this story)
Source: delivery brief and rulings of run `2026-10-29-s5-5-vehicle-fitment-model`; recon `01-recon.md` of the same run; `docs/product/vehicle-fitment.md` (rules 1, 2 and the fit-state terms); decisions 0015 and 0016; issue #261 acceptance outline; guardrails 1, 2 and 5.

## Open decisions

None of these is answered here. Each one has the default the ACs below assume. If the owner rules otherwise, the named AC changes or goes. All four block ticketing.

- **OD-1. What "approved, enabled feed" means.** Decision 0016, `vehicle-fitment.md` rule 2 and #261 all say "approved, enabled feeds", but `feeds` has no enabled or disabled column: the only flag is `feeds.isApproved` (`src/db/schema/sources.ts`), and the admin's "disable" action simply sets it to false (`src/app/admin/(shell)/tiendas/actions.ts`, `parseTarget`). Default assumed: **"enabled" means "approved"; a disabled feed is an unapproved one; no column is added.** Reason: the existing admin action already works this way and it is the same rule the offer scope uses, so fitments follow the offers' feed state with nothing new to maintain. Alternative: add a separate enabled flag on feeds, which is a schema and admin change outside this story. Affects ACs 17 to 19.
- **OD-2. Does the shop's approval and the offer's state count for a fitment?** A fitment links a product, a vehicle and a feed, not an offer. Offers are public only if the feed and the shop are approved and the offer is neither hidden nor in review; the spec names only the feed. Default assumed: **a fitment counts when its feed is approved and that feed's shop is approved; whether the product's offers are hidden or in review does not change it** (a hidden or unmapped product is kept out of listings by the product scope, not by the fitment). Reason: the shop's approval is the same guardrail 1 gate as the feed's, so a fitment from an unapproved shop's feed must not count either; an offer being hidden says nothing about whether the shop's fitment data is trustworthy for the car. Alternative: count a fitment only while the same feed has a visible offer for that product, which is stricter and makes the fit state change when one offer is hidden. Affects ACs 18 to 20.
- **OD-3. Fitments to a retired vehicle, and a retired vehicle as the selected car.** `vehicle-fitment.md` rule 4 says a retired slug is ignored by the page, but does not say how the fit state treats retired data. Default assumed: **(a) fitments that point at a retired vehicle do not count, so a product whose only fitments are to retired vehicles is `unknown`, not `no-fit`; (b) asked about a retired or unknown vehicle, the query says there is no such active vehicle, and does not return a fit state for the products.** Reason: (a) the safe failure is to show a part with a thin data note rather than hide it for a car list we ourselves dropped; (b) the page needs to tell "no such car" (show the notice, unfiltered) apart from "no product fits" (S5.7). Alternative for (a): retired fitments still count, so such a product is `no-fit` for every other car and disappears from filtered listings. Affects ACs 7, 21 and 22.
- **OD-4. Years on a vehicle that is still on sale.** The spec lists "years from/to". Default assumed: **the start year is required and the end year may be absent for a generation still sold.** Reason: the spec's own example is a finished generation (2012-2020), but the common current models in the list have no end year. Alternative: require both, which forces an invented end year. Affects AC 9.

## Story

As the owner, I get a fixed list of the cars common in Spain and a place to record which products fit which car, with a question the site can ask ("for this car, does each of these products fit, not fit, or is it unknown?") that only trusts fitment from feeds an admin has approved, so that the visitor-facing car filter (S5.6 to S5.9) can be built on it.

This is the foundation of the E5 car-selection feature. A visitor sees nothing new from this story. The visitor-visible outcome arrives with S5.7 to S5.9; what this story delivers is the data and the query those stories read, and a promise that the guardrail 1 rule for fitment is enforced in one place.

## Scope

In:
- a vehicle list defined in code (about 30 to 60 cars common in Spain), stored in the database and refreshed on every migrate, whatever `SEED_DEMO_DATA` says, never deleting, with retired vehicles flagged;
- storage for fitments: which product fits which vehicle, and which feed said so;
- one question, "fit state of many products for one vehicle", that counts only fitments from approved feeds (OD-1, OD-2) and answers `fits`, `no-fit` or `unknown` for each product asked about.

Out, for this story (listed so a lane does not do them here):
- reading the fitment field from feed rows, replacing a feed's fitments on import, the `fitment: unknown vehicle <slug>` import output and the demo feeds' fitment column (S5.6);
- the `?coche=` parameter, the `localStorage` choice, links carrying `coche`, the selection control, the picker and the `/mi-coche` and `/api/vehiculos` routes (S5.7);
- filtering, grouping and ordering the category page and search results by fit state, and their counts (S5.8);
- the fit banner and the vehicles-it-fits list on the product page (S5.9);
- any admin screen to edit vehicles or fitments, TecDoc or any licensed catalogue, plate or VIN lookup, and any scraping of a vehicle database (spec § Out of scope; guardrail 2);
- the `/privacidad` sentence about the stored car choice (it belongs with the story that stores the choice).

## Acceptance criteria

Vehicle list

1. A fixed list of vehicles is defined once, in `src/db/vehicle-catalogue.ts`, and holds between 30 and 60 vehicles.
2. Every one of the makes Seat, Volkswagen, Renault, Peugeot, Citroën, Toyota, Dacia, Ford, Opel, Kia and Hyundai has at least one vehicle in the list.
3. Every vehicle has a make, a make slug, a model, a generation label, a start year, an engine label, a fuel, a power in kW, a power in CV and a position for ordering. Engine code is optional (OD-4 for the end year).
4. The fuel of a vehicle is one of exactly five values: gasolina, diésel, híbrido, eléctrico, GLP. The database refuses any other value.
5. Every vehicle has a slug in lowercase ASCII with hyphens (for example `seat-leon-iii-2012-2020-1-6-tdi-115cv`). No two vehicles share a slug, and every vehicle of one make carries the same make slug.
6. Vehicle positions in the list are unique and increase in list order, so the order is the same on every read.
7. A vehicle that has left the list is flagged as retired, not deleted (see AC 14), and an active vehicle can be told apart from a retired one by reading the database.
8. A test pins the full set of vehicle slugs in the list, so that removing or renaming a slug breaks the test and has to be done on purpose.
9. (OD-4.) A vehicle whose end year is absent is accepted. When both years are present, the end year is not earlier than the start year. The start year is always present.

Applying the list on migrate

10. After the normal migrate on an empty database, every vehicle in the list is in the database, active, with the values the list gives.
11. This happens on every migrate path with `SEED_DEMO_DATA` unset, blank or `false`: the container start, the `migrate` verb, `npm run db:migrate` and the integration test setup. The seed creates no vehicle.
12. Running migrate again leaves every vehicle's identity (its id) and its fitments unchanged; running it any number of times gives the same result.
13. A vehicle row edited by hand in the database (name, engine, power, position, retired flag) goes back to the value in the list on the next migrate, keeping its id, as for the category tree (decision 0015).
14. A vehicle row that is in the database and no longer in the list is not deleted and keeps its fitments; on the next migrate it is flagged as retired. A vehicle that is put back in the list under the same slug becomes active again with the same id.
15. Migrate never deletes a vehicle, and never touches any other table's rows, including fitments.
16. The integration tests start each test from the migrated state, with the vehicle list present after the per-test reset, the same way the six fixed categories are.

Fitments

17. A fitment ties one product to one vehicle and records the feed it came from. A fitment cannot point at a product, a vehicle or a feed that does not exist.
18. The same product and vehicle can be recorded from two different feeds; the same product, vehicle and feed cannot be recorded twice. The database refuses the duplicate.
19. A product's fitment set is the union over the feeds that gave one: a vehicle that two feeds both list for the product is one fitment of the product, not two, in the fit-state answer.

Fit-state query

20. For one vehicle and a set of products, the query answers one fit state for each product asked about, and only for those: `fits` when a counted fitment of that product to that vehicle exists; `no-fit` when the product has counted fitments and none to that vehicle; `unknown` when the product has no counted fitment at all.
21. (OD-1, OD-2.) A fitment counts only if its feed is approved and its feed's shop is approved. A fitment from an unapproved feed, or from a feed whose shop is unapproved, is treated as if it did not exist. A product whose only fitments come from such a feed is `unknown`, not `no-fit`; a product that has a fitment to the asked vehicle only from such a feed is not `fits`.
22. When an admin disables a feed (or its shop) the fit states change on the next call, with no rebuild step; when the feed is approved again they change back. A product that is hidden, or has an offer that is hidden or in review, gets the same fit state as if it were not (OD-2).
23. (OD-3.) Fitments that point at a retired vehicle do not count: a product whose fitments are only to retired vehicles is `unknown`; a product with a fitment to a retired vehicle and one to an active vehicle is judged on the active one.
24. (OD-3.) Asked about a vehicle slug that does not exist or is retired, the query reports that there is no such active vehicle and returns no fit state for the products; it does not answer `unknown` for all of them.
25. A product that is asked about and does not exist, and an empty set of products, give no error: an empty set gives an empty answer, and a missing product has no entry.
26. The query returns no product that was not asked about, and a fitment never makes a non-public product public: the visibility of a product is decided by the existing product scope, not by this query.
27. The approval condition for fitments lives in the shared visibility module (`src/server/visibility.ts`) with the existing offer and product conditions. No other file outside the files `tests/unit/seams.test.ts` already allows names the approval flags, and that test still passes and also covers the fitment path.
28. The query writes nothing and logs nothing about the vehicle or the products it was asked about (guardrail 5).

Database

29. The new tables and their columns are created by one new migration that applies on a database holding legacy data, changes no existing table's rows, and is a no-op when run again. The existing migration tests (every schema table and column exists, re-running is a no-op, applied count equals the journal) pass without being loosened.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- table and column names and types, the retired flag's form (boolean or date), indexes, and the exact constraints behind ACs 4, 9, 17 and 18;
- how a vehicle leaves the list (entry removed from the constant, or kept with a marker) and how the upsert finds rows to retire; the floor is ACs 7, 8, 14 and 15, and a slug is never reused for a different car;
- the shape of the query's input and answer, and where the module lives. **S5.8 must order and filter a whole listing by fit state and then paginate** (spec rule 3: pagination runs over the combined list), so the design should say whether the query is a per-page lookup of ids or can sit inside the listing's own query, and what it costs for a category of a few thousand products;
- how the visibility module exposes the fitment condition, so AC 27 holds and the seams test is extended rather than loosened;
- whether `src/db/vehicle-catalogue.ts` is compiled into the CLI build (`tsconfig.cli.json`) and the container image, as `category-tree.ts` is; AC 11 depends on it;
- which data the vehicle list needs so that S5.7's picker can later read makes, models and engines (make and model grouping and the generation label); the story fixes the fields (AC 3), not how they are read.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required:

- **Vehicle constant (unit):** count between 30 and 60; the eleven makes present; required fields present and optional ones accepted; slug format, uniqueness and per-make slug consistency; positions unique and increasing; year rule; the full slug set pinned with `toEqual`, as `tests/unit/category-tree-constant.test.ts` does for categories.
- **Migrate and the upsert (integration; extends the pattern of `tests/integration/fixed-category-tree.test.ts`):** vehicles exist after reset and after `runMigrations` with `SEED_DEMO_DATA` blank; running twice keeps ids and fitments; a hand-edited row is restored with its id; a vehicle removed from the list is retired, not deleted, with its fitments kept, and is active again when put back; no other table's rows are touched; the per-test reset restores the list.
- **Schema (integration):** the fuel value outside the five is refused; a fitment to a missing product, vehicle or feed is refused; a second fitment with the same product, vehicle and feed is refused while the same pair from a different feed is accepted; `tests/integration/migrations.test.ts` passes with the new tables and column nullability.
- **Fit-state query (integration; new file under `tests/integration/`; fixtures in `tests/support/catalogue.ts` gain vehicle and fitment helpers, with approved defaults and one flag changed per test):** `fits`, `no-fit` and `unknown` in one call over a mixed set; the union over two feeds, counted once; the unapproved-feed case giving `unknown` and not `no-fit`; the unapproved-shop case; approval flipped off and on changing the answer on the next call; hidden product and hidden or in-review offer not changing the state; fitments to a retired vehicle not counting; an unknown or retired vehicle slug reported as such; an empty set; a missing product; only the products asked about returned.
- **Visibility and seams (unit and integration):** `tests/unit/seams.test.ts` still passes and fails if a file outside the allowed ones names the approval flag in a fitment path; `tests/integration/visibility.test.ts` gains a case showing a fitment never makes a non-public product public.
- **Kept as they are:** the category tree tests, the click, robots and sitemap tests. The e2e suite needs no change: this story adds no page, route or visible copy.

## Tickets

Ordered, contracts before consumers. The recon found the order's three tickets are all backend; each has a test dispatch after it, following the S5.4 precedent (one ticket, two dispatches). Each traces to the ACs. The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.5.1 (#262) backend, M. Schema and migration.** Tables for vehicles and for fitments, the new migration, the schema export, and the constraints behind the ACs. Test dispatch after it: the schema and migration tests. ACs 4, 7, 17, 18, 29.
2. **T5.5.2 (#263) backend, M. Vehicle list, upserted on migrate.** The vehicle constant, the upsert called from the shared migrate function, retirement, and the per-test reset restoring the list. Test dispatch after it: the constant and upsert tests. ACs 1 to 16.
3. **T5.5.3 (#264) backend, M. Fit-state query.** The query, the fitment approval condition inside the shared visibility module, the seams-test extension, and the fixtures the tests need. Test dispatch after it: the fit-state, visibility and seams tests. ACs 19 to 28.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff:

- `docs/product/vehicle-fitment.md` rule 2 and decision 0016 say "approved, enabled feeds"; the wording changes once OD-1 is ruled;
- CLAUDE.md § Stack (vehicle fitment line) and § Commands, where the migrate row says what runs on every migrate path (the vehicle list joins the category tree);
- `docs/decisions/0015-fixed-category-tree-from-migrate.md` is the precedent for the vehicle list; whether it needs a pointer to 0016 is the docs lane's call;
- the architecture and backend packs, for the retired-flag pattern and the migrate-time upsert convention that this story sets.

## Notes for the human

- **Nothing visible ships.** A reviewer accepting this story sees data and a query, not a page. That is why the story is a foundation for S5.6 to S5.9 and why its ACs are about the database and the query.
- **The recon's other gaps are covered:** the "unknown vehicle" import output and the fitment column in the demo feeds are S5.6 (out of scope above); the test reset is AC 16; the per-row retire rule is ACs 7, 14 and 15; the seams constraint is AC 27; "retired is new behaviour with no precedent in code" is why OD-3 and the tech lead's retirement choice are explicit.
- **Tests have no ticket of their own** here, because the order fixed three tickets. If the human wants S5.4's shape (a separate test ticket), add T5.5.4 for the test lane; no AC changes.
- **Size and iteration** are not set in this draft; the board holds them.
