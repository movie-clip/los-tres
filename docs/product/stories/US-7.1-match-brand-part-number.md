# S7.1 Offers converge on one product by brand and part number when the EAN does not decide

Status: **approved 2026-11-22 (D-5 of run 2026-11-22-s7-1-matching); OD-1 to OD-4 ruled as recommended (D-1 to D-4).** D-1 (S7.1 first), D-2 (story file yes) and D-5 (a conflict keeps the offer as its own product, no queue; ruled by non-objection) of run `2026-11-22-board-next` (that run's numbering, not this run's D-1 to D-5 above) are carried as given. Board status follows the human's own move.
Epic: E7 (#15) · Iteration 3, carried to Iteration 4 by D-3 if open · Priority: P0 · Size: M (the issue sizes its tickets backend M, test S)
Issue: #40 · Tickets: #134 (T7.1.1 backend), #135 (T7.1.2 test)
Depends on: S3.7 (the catalogue file, soft, shipped) and S2.4 (hide, shipped). No open dependency.
Blocks: S3.3 (#28) softly (removal of dropped offers is better tested once two shops converge on one product, `agentic/runs/2026-11-22-board-next/01-product.md` § Sequence) and S9.4 (#53) hard (the done line's word "matched").
Source: issue #40 as relayed by the orchestrator (the acceptance outline: same normalised brand and part number attaches, both present; EAN-first order unchanged; the lookup is indexed; rows without EAN from two shops converge; brands compare after normalisation only, no alias table; no review queue, an offer whose EAN and brand disagree is not merged and stays its own product, recorded in 0008 with its stale text brought in line; today's rejection of a conflicting row is checked and reconciled); recon `agentic/runs/2026-11-22-s7-1-matching/01-recon.md` (cited below as "recon" with its section); `agentic/runs/2026-11-22-board-next/decisions.md` D-1, D-2, D-5; `agentic/runs/2026-11-22-board-next/01-product.md` § Sequence and § Open decisions; `docs/decisions/0008-product-matching.md`; `docs/product/mvp.md` § Matching and § Product and offers; `docs/product/stories/US-2.4-hide-products-offers.md` (the shape). I read `src/server/matching.ts` and `src/server/importer/index.ts` lines 180 to 310 and the two tests named below myself; everything else "today" rests on the recon's reading of the code and tests, which ran nothing.

## Standing constraints

These bind this story and everything built from it.

- **Step 2 of 0008 has no code path today.** `matchProduct` returns "no match" as its first line for a row with no EAN, and its signature carries no part number (`src/server/matching.ts` lines 8 to 10 and 64 to 68; recon § What happens today). Both normalisers exist and are unit-tested; both normalised columns exist on products and are filled by the importer at insert, and only there (recon § Normalisation and storage).
- **EAN first, unchanged.** A row whose valid EAN is held by exactly one product with a compatible brand attaches there, as today; step 2 runs only when step 1 did not attach (issue #40 outline; 0008 step order).
- **No alias table, no review queue, no merge, no split.** `mvp.md` § Matching defers the queue and removes merge and split (owner ruling 2026-10-26); the alias table is S7.3 and deferred. Brands compare after the existing normalisation only (issue #40 outline).
- **A wrong match is permanent in the MVP**, because there is no merge or split (`mvp.md` § Matching). Where the data does not settle a match, the rule below is to keep the offer as its own product, which is the safe side (D-5).
- **A known offer is never re-matched.** An offer already stored for the same feed and external id is updated in place and keeps its product (`src/server/importer/index.ts` lines 194 to 201). So this story changes only the first sight of an offer, and it merges nothing that is already stored.
- **Product text is written once.** Attaching an offer never rewrites a product's title, brand, part number, EAN or description; the first feed's text stays (`mvp.md` § Product and offers; TD-23 in `src/server/importer/index.ts`).
- **Guardrail 1.** Matching decides which product an offer belongs to and publishes nothing. A converged offer, and an offer that became its own product, is public only under the usual rule: its feed and shop approved, its offer and its product not hidden, the product mapped to a category. No import, seed or matching outcome unhides, approves or maps anything.
- **Guardrail 4.** Matching reads and writes no price. Every price on a converged page is its own offer's integer cents in EUR, IVA included.
- **Local-only until S2.2.** The admin area is not deployed before S2.2; this story adds no admin screen.

## Open decisions

All blocking ticketing. Each is drafted below on its recommendation; the ACs that move if the owner rules the other way are named.

1. **OD-1. How step 2 behaves when an EAN is on one side or on both (recon § risks 2).** The code has no such path today. Three cases need an answer: (i) one side has a valid EAN and the other has none (shop A gives an EAN, shop B does not); (ii) both sides have a valid EAN, no product holds the incoming one, and the product found by brand and part number carries a different one; (iii) the EAN matches product X with a compatible brand and brand and part number point at a different product Y (0008's second conflict). Recommendation: (i) attach, since an absent EAN is not a disagreement, the same reading the matcher already takes of an absent brand in step 1 (TD-27, `matching.ts` line 61) and it is the case the story exists for; (ii) not merged, the offer stays its own product, since two different EANs are two different retail items and a wrong merge cannot be undone; (iii) EAN wins and the offer attaches to X, step 2 is not consulted, since the issue's outline fixes "EAN-first order unchanged" and the queue 0008 would send it to is out. Reason it is the owner's: 0008 (accepted) calls (iii) a conflict for review, and the issue says nothing on (i) and (ii). ACs 12, 14, 15 move. **Ruled as recommended, D-1, 2026-11-22.**
2. **OD-2. Ambiguity: more than one product holds the key (recon § risks 2 and 3, and § Open questions).** Two cases. (a) After D-5 an EAN conflict creates a second product that carries the same EAN as the first (decision 0002 sets no unique index; recon § Normalisation and storage), so a later row with that EAN meets two holders and today's rule rejects it as `ambiguous_ean` and drops it. (b) Step 2 finds two or more products with the same normalised brand and part number (the old EAN-less fixture creates exactly that; recon § Normalisation and storage). Recommendation: in both cases do not guess and do not drop: the offer stays its own product and the import output says so with a fixed reason (ACs 19, 20, 17). Reason: dropping a shop's offer for a state our own rule created is worse than a duplicate product page, and a guess is permanent. The cost is that duplicates are never healed (no merge). Alternatives: keep rejecting on (a) as today (D-5 speaks only of an EAN and brand disagreement; this is my reading that it also covers ambiguity), and for (b) attach to the oldest product. ACs 19 and 20 move. **Ruled as recommended, D-2, 2026-11-22.**
3. **OD-3. Rows already in the owner's local database whose normalised columns were not made by the importer (recon § risks 1).** The importer is the only writer of the normalised columns and no backfill exists, so a product made by hand or by an older importer may hold empty or stale normalised values; only a query of the live database settles whether any do. Recommendation: no backfill in this story; a product with an empty normalised brand or part number is simply never found by step 2 (AC 9), which fails safe into a duplicate, never a wrong merge; the owner checks his local data before the S9.4 import, and the catalogue-file guide says so. Alternative: a one-off recompute of the normalised columns as part of this story, which adds a data migration and a second writer of those columns. AC 9 is the only AC that changes. **Ruled as recommended, D-3, 2026-11-22.**
4. **OD-4. Do two rows of the same feed converge?** `tests/fixtures/feeds/no-ean.csv` holds two EAN-less rows with the same brand and part number in one feed (recon § Tests and fixtures). Today two rows of one feed with the same EAN already land on one product, so parity says they converge on brand and part number too, and the product page then lists that shop twice. Recommendation: converge, for parity with the EAN rule and because a shop listing one part under two ids is rare and not decided by this story. Alternative: step 2 considers only products that have an offer from another feed. That is a different rule from EAN's and costs a second lookup condition. AC 11 moves, and so does the replacement of the existing test at `importer-matching.test.ts` lines 150 to 159. **Ruled as recommended, D-4, 2026-11-22.**

## Story

As an admin loading real shop files, when two shops sell the same part and give the same brand and part number but no EAN, I want their offers to land on one product page, cheapest first, and when an offer's EAN and brand disagree with the product that holds the EAN, I want it kept as its own product rather than dropped or merged.

Today a row without an EAN always becomes its own product, and a row whose EAN matches a product with a different brand is rejected and not stored at all, which contradicts `mvp.md` ("stays its own product") and D-5 (recon § Disagreements). Real hand-written files rarely agree on an EAN, so without this story the owner's two files give two product pages for one part and the prototype's "matched" is unproven on the data S9.4 will load. After this story the comparison the site exists for works on files with part numbers and no EAN, and no offer is silently lost to a conflict.

## Scope

In:

- The brand and part-number step of 0008, between the EAN step and "new product", with the existing normalisation.
- The conflict outcome ruled by D-5: an offer whose EAN and brand disagree is not rejected and not merged, and becomes its own product.
- The cases the issue leaves open, on the recommendations of OD-1 to OD-4.
- An import output that lets the owner find the rows that became their own product because of a conflict or an ambiguity (no queue exists to show them).
- An index so the lookup does not scan the products table.
- The tests that prove all of it, including the tests that today assert the opposite.

Out, nearest first (listed so a lane does not do them here):

- A brand alias table or any brand mapping, so "Bosch" and "Robert Bosch" stay two products (S7.3, deferred; issue #40 outline).
- An admin matching queue or review screen, merge, split, or re-applied admin decisions (S7.2, deferred; `mvp.md` § Matching). 0008's text on them is brought in line at close-out, not built.
- Re-matching offers already stored, or merging products already separate (no merge in the MVP).
- Removing offers or products dropped from a file (S3.3, #28).
- The deploy and the first real import checklist (S9.4, #53).
- A change to either normaliser, to EAN parsing, to feed validation, or to the rule that a product's text is written once.
- A change to the collector's local-only rows and their gating (S12.2, #306); matching has no knowledge of them here.
- Any admin or public screen, route, copy or environment setting.
- The technical contract: the index definition, whether a migration is needed, the matcher's signature and result shape, how the report line is carried, SQL, and file layout (the tech lead's).

## Acceptance criteria

"A feed row" is a row of an approved, imported feed. "Normalised" means the two existing normalisations: the part number with spaces, dashes and dots removed and upper-cased; the brand trimmed, inner whitespace collapsed and upper-cased. "The key" is a normalised brand and a normalised part number both present. "Converge" means the offer attaches to an existing product, so that product has both offers. "Own product" means the importer creates a new product for the offer, exactly as it creates one for any row that matches nothing. "Public now" is as in US-2.4: the public product page for the slug answers with the product. "The import output" is what `import-feeds` prints. Copy in these ACs is intent only.

Convergence on brand and part number

1. Two feeds from two shops, each with a row that has no EAN and the same key, imported in one run, give one product with two offers; the product's public page lists both shops, each with its own price and its own link, cheapest first, once the feeds and shops are approved and the product is mapped to a category (guardrails 1 and 4).
2. Importing the same two feeds in the other order gives the same result: one product with two offers.
3. Rows whose brand or part number differ only in the ways the existing normalisation removes converge: `OC 12.34` and `oc-1234`, `Marca Uno` and `MARCA  UNO`.
4. Brands compare after that normalisation only: `Bosch` and `Robert Bosch` do not converge, and `Mann-Filter` and `Mann Filter` do not converge (the brand normalisation keeps hyphens); each stays its own product.
5. A row with the same part number and a different normalised brand does not converge; it is its own product.
6. A row with the same normalised brand and a different part number does not converge; it is its own product.
7. A row with no brand, or a blank brand, is its own product and is never attached by this step, whatever products hold its part number (the issue's "both must be present"; recon § risks 3).
8. A row with no part number, or a blank one, is its own product and is never attached by this step.
9. A stored product whose normalised brand or normalised part number is empty is never found by this step; the row is its own product and nothing fails (OD-3).
10. When a row converges, nothing about the product's text changes: not its title, brand, part number, EAN or description. The first feed's text stays.
11. (OD-4 (a).) Two rows of one feed with the same key and no EAN converge, the second onto the product the first created in the same import.

EAN first, and the cases with an EAN

12. (OD-1 (iii).) A row with a valid EAN held by exactly one product with a compatible brand attaches to that product whatever its brand and part number say; a different product holding that brand and part number gets nothing.
13. The EAN rules that exist today hold unchanged: a present but invalid EAN is rejected as `invalid_ean` before matching; a missing brand on either side does not stop an EAN attach; the EAN with spaces or hyphens still matches its stored digit string.
14. (OD-1 (i).) A row without an EAN converges on a product that has one when the key matches; a row with a valid EAN that no product holds converges on a product with the same key that has no EAN.
15. (OD-1 (ii).) A row with a valid EAN that no product holds does not converge on a product with the same key that carries a different valid EAN; it is its own product.

A conflict keeps the offer as its own product (D-5)

16. A row with a valid EAN held by exactly one product whose brand is known and differs is not rejected: it becomes its own product with its own offer, and no existing product or offer changes. The import output counts it as a created product and a created offer and lists no rejection for it.
17. Each row that became its own product by AC 15, 16, 19 or 20 is named in the import output with its record number and a fixed reason that tells the four apart; the line carries no brand, part number, title, URL or other text from the file; the run still exits 0 for it, as a rejected row never fails the exit code today.
18. A product made by AC 15, 16, 19 or 20 is an ordinary product: it carries no flag, waits in no queue, and is public now under the usual rule and not otherwise. The conflict never keeps it off the public site (D-5; 0008's "stays off the public site until resolved" is not adopted) and never puts it on (guardrail 1).
19. (OD-2 (a).) A row with a valid EAN held by two or more products is not rejected: it becomes its own product, and this step is not consulted for it.
20. (OD-2 (b).) A row with the key held by two or more products converges on none of them: it becomes its own product.

Repeat imports and what is already stored

21. Running `import-feeds` again changes nothing except prices and dates: no product is created, no offer moves, and a row that became its own product by AC 15, 16, 19 or 20 stays attached to that product and is no longer listed as created.
22. Offers and products that were stored before this change are not re-matched and not merged: two products that exist separately stay separate after any import, and an offer keeps the product it has.

Visibility and approvals (guardrail 1)

23. A row whose key matches a hidden product attaches to it, the offer is stored, the product stays hidden and not public, and no import unhides it or hides anything the admin did not hide.
24. A converged page lists only offers that are public under the usual rule: when the feed or shop of one converged offer is not approved, or the offer is hidden, the page lists only the other, and its lowest price and shop count are computed without the excluded one; when none is public the page is not found. Matching sets no approval, no hidden flag and no category beyond the existing rule that the first mapped category wins.

The lookup is indexed

25. The brand and part-number lookup is served by an index and not by reading the whole products table, checked against the database's own query plan (issue #40 outline).
26. A database that already holds two products with the same key still migrates and still imports without error, and a fresh database migrates from empty; the migrate path stays safe to run twice.

What stays as it was

27. `parseEan`, `normalizePartNumber` and `normalizeBrand` give the same results as before; `tests/unit/matching.test.ts` passes unchanged.
28. The demo data is unaffected: every demo row carries an EAN, the demo product page still lists two shops cheapest first, and a second `import-feeds` changes nothing but prices and dates.
29. No command, argument, environment setting, admin screen, public route or copy is added or changed; the only change a user can see outside the product pages is the import output of AC 17.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the matcher's input and result shapes, how step 2 and the conflict outcomes are expressed, and how the import loop uses them (the reject branch at `src/server/importer/index.ts` lines 205 to 208 changes for AC 16 and 19, and the row-code union in `src/server/importer/types.ts` lines 11 to 12 may change with it);
- whether the existing `products_part_number_normalised_idx` (migration `0005_search`) already serves the lookup or a composite index is needed, and if so its migration and the schema edit at `src/db/schema/catalogue.ts` (AC 25); that no uniqueness may be added, because existing databases and AC 20 allow duplicates (AC 26);
- how "the same run sees what an earlier row created" is kept true inside the import transaction (ACs 11 and 21);
- how the import output carries AC 17: a new reason code per case, or a new line, and how `src/server/importer/report.ts` prints it;
- whether the several ways a row ends as an own product (no match, ACs 7 to 9, 15, 16, 19, 20) share one path;
- whether the tickets stay as drafted below.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1, 2, 3, 11, 21 | integration (database), extending `tests/integration/importer-matching.test.ts`: two feeds without EAN converging in both orders, with the spelling variants of AC 3, two rows of one feed, a second import that changes only price and date |
| 4 to 9 | integration: the near-misses (different brand, different part number, alias pair, hyphenated brand, blank brand, blank part number, a stored product with empty normalised values inserted by hand through `insertProduct` in `tests/support/catalogue.ts`), each ending as its own product with no error |
| 10, 22 | integration: the product's stored row before and after a convergence is identical in every text column; two products made separately before the importer runs stay separate |
| 12 to 15 | integration: the three EAN cases of OD-1 each way (EAN on one side only, both sides different, EAN holder and key holder differing), and the existing EAN cases of AC 13 re-run, with the fixtures `ean-first.csv`, `ean-second.csv`, `ean-null-brand.csv` and `rejects.csv` as they are |
| 16 to 20 | integration: the conflict row stored as its own product and the import output line for it, the third row meeting two EAN holders, the key held by two products; the output line checked for the fixed reason and for the absence of the planted brand, part number and title; the exit code; the product's public page against the usual approvals, so a conflict product is public only when it would be anyway |
| 23, 24 | integration extending the hidden-product test of `importer-matching.test.ts` (recon cites lines 241 to 255) with a key match, and a converged page with one offer from an unapproved feed, one hidden offer, and one public offer, read through the public product reader |
| 25, 26 | integration: the query plan of the lookup reads an index with sequential scans discouraged for the test (a small table otherwise plans a scan whatever is indexed); a database holding two products with one key migrated and imported; the migrate path run twice |
| 27 | `tests/unit/matching.test.ts` unchanged and passing |
| 28, 29 | the existing demo-data tests (`tests/unit/demo-feeds.test.ts`) and the e2e run unchanged; no new e2e |

**Existing tests this story changes by design, not loosens:**

- `tests/integration/importer-matching.test.ts` lines 150 to 159 ("gives each row without an EAN its own product, with numbered slugs on a title clash") asserts the opposite of AC 11 for `tests/fixtures/feeds/no-ean.csv` (two rows, same brand and part number, expects two products). It is rewritten to assert convergence, and the numbered-slug rule it also covers needs a new fixture whose EAN-less rows share a title but not a key (recon § Tests and fixtures).
- `tests/integration/catalogue-file-import.test.ts` lines 457 to 466 ("does not converge two files that share only a brand and part number (S7.1 is not built)", expects two products) asserts the opposite of AC 1. It is rewritten to expect one product, with the two shops listed cheapest first, in the pattern of the AC 30 test just above it (lines 441 to 455); its title loses "S7.1 is not built".
- `tests/integration/importer-matching.test.ts` lines 84 to 102 ("rejects the same EAN with a different brand as ean_brand_conflict and creates nothing") asserts rejection, which D-5 reverses (AC 16). It is rewritten to assert an own product and the output line of AC 17. The recon counts two tests that contradict convergence; this one and the next contradict D-5 and OD-2 instead, and the recon did not count them.
- `tests/integration/importer-matching.test.ts` lines 139 to 148 ("rejects ambiguous_ean when two products already share the EAN, and creates nothing") changes only if OD-2 (a) is ruled as recommended (AC 19); under the alternative it stays.
- The header comment of `importer-matching.test.ts` (line 33, "conflicts rejected into the report") is brought in line.

Notes for the test lane:

- Audit the fixtures the recon did not open for EAN-less rows that now share a key: `tests/fixtures/feeds/empty-cells.csv`, `category-*.csv`, `rejects.csv`, `price-edge.csv` and `xml-*.xml`, and the rows `ROW_A` and `ROW_B` (`ean: ''`, line 53) of `tests/integration/catalogue-file-import.test.ts`. A test written against two products there may now see one. Fix a test only by design, and say which in the report.
- New fixtures are the test lane's: the pairs of AC 3 to 9, 14, 15 and 19 to 20. A product with two holders of one EAN or one key is set up through `insertProduct`, not through an import, as the ambiguous-EAN test does today.
- Money and prices in these tests are integer cents, as everywhere.
- The suite touches no network and no feed URL; matching has none.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story and rules OD-1 to OD-4; a design pass (tech lead) fixes the contract, which fires because the matcher, the importer's reject branch, a possible migration and the import output cross files; there is no UX pass because no screen changes. The design pass may merge, split or resize the tickets. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T7.1.1 (#134) backend. Step 2, the conflict outcomes, the lookup index and the import output.** The brand and part-number lookup with the key rule, the EAN-and-key cases of OD-1, the own-product outcomes for a conflict and for ambiguity (OD-2), the same-run behaviour (OD-4), the index and any migration with the schema edit, and the import output line, and the four by-design test rewrites named under "Existing tests this story changes by design" (moved here from T7.1.2 by D-12 of run 2026-11-22-s7-1-matching, so the backend change and the tests it reverses land together). ACs 1 to 11, 12 to 20, 21 to 26, 29. Size M.
2. **T7.1.2 (#135) test. The matching suite, the rewritten tests and the fixtures.** The new integration tests and fixtures of the plan above, the fixture audit (the four by-design rewrites are T7.1.1's, D-12), and the index and migration checks. Needs #134. Every AC; coverage per the test plan. Size S on the board: it was likely heavier than S because the fixtures are new (the four existing-test rewrites moved to #134 by D-12); if the design pass agrees, it says so and the human resizes, which is not mine to do.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/decisions/0008-product-matching.md` (D-5: updated at S7.1 close-out): the queue, the alias table and the admin "alias" sentence of step 2, merge and split, stored admin decisions and "text from the shop the admin ranked highest wins" are stale against `mvp.md` § Matching; it states the conflict as the offer staying its own product with no queue, the null-brand rule and the ambiguity rules as ruled in OD-1 and OD-2, and records the brand rule as normalisation only. Recon § Disagreements lists the gaps. Whether 0008's status needs a new line, or a superseding decision, is the owner's and the docs lane's call.
- `docs/feeds/catalogue-file.md`: the `part_number` row of the column table (line 27) and the bullet "No convergence without an EAN" (line 113) say S7.1 is not built; the `brand` and `part_number` rows now say what makes two files converge, with the known limits (no alias, so `Bosch` and `Robert Bosch` stay two; hyphens in a brand are significant; a row with no brand or no part number never converges; a conflicting row stays its own product) and that products already stored are not re-matched, so a hand file imported before this change keeps its separate products (OD-3, AC 22).
- `agentic/capabilities/testing.md` lines 106 to 109 (the "Matching (0008), slice B cut" bullet): "Brand + part-number matching and the queue are tested when they ship" is replaced by what this story's tests cover; the queue stays as not built. Recon's contract note names the same line.
- `docs/product/mvp.md` § Matching: already says "stays its own product"; its last line, "Decision 0008 holds the detail", is true again after 0008's update. The docs lane judges whether anything else changes.
- `CLAUDE.md` § Stack, "Matching" line ("EAN, then brand + normalised part number; on a conflict the offer stays its own product, the admin queue is deferred (0008)"): becomes true as written after this story. A change to a § Stack line is the owner's call, so none is proposed.
- `CLAUDE.md` § Commands, the `import-feeds` row, if the output line of AC 17 is visible there.
- The backend and testing packs, for the conventions this story sets (where step 2 lives and how a row ends as its own product).
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **The reject of today is a decision of slice B, not an accident.** The row rejection is an owner-reviewed rule ("D-1 Q5", `src/server/matching.ts` line 59), and `mvp.md`, `CLAUDE.md` § Stack and D-5 all say the offer stays its own product. This story reverses the code to match them. 0008's older text (a queue, off the site until resolved) is the third version and is not adopted; D-5 ruled it by non-objection.
- **The two existing tests the recon counted, plus two more.** AC 16 and, if OD-2 is ruled as recommended, AC 19 also reverse a test each; the plan names all four so the test lane does not find them by failing.
- **A conflict now leaves two products with one EAN.** That is a consequence of D-5, not a defect: it is why OD-2 (a) exists. The recommendation avoids dropping the third offer.
- **Products already in the owner's local database.** Offers stored before this story keep their separate products (AC 22). If the owner imported hand files with EAN-less rows before S7.1, those products do not converge when the files are imported again; they need a fresh local database or an admin hide. This matters for S9.4 and is the thing to say in the guide.
- **Same-shop duplicates.** Under OD-4 (a) a shop that lists one part under two ids shows twice on the product page. Whether the page should show one row per shop is not decided here.
- **The step does not look at the shop or the feed.** It is blind to whether a product came from an approved feed; as with EAN today, an offer from an approved feed that converges onto a product created by a feed since disabled makes that product public with the first feed's text. Guardrail 1 is met on the offer side and unchanged on the product side; I did not find this recorded as a decision and flag it for the owner, not as a change to make here.
- **Collected rows (S12.2).** When the collector's rows exist, convergence between a collected row and a public-feed row is that story's to gate. This story neither enables nor prevents it. *Update (S12.2, shipped on branch `306-collected-data-local-only`, pending merge): an unmarked row never attaches to a marked product, and a marked row may attach to an unmarked product as an offer only.*
- **Issue #40 and the tickets #134 and #135 were read as relayed into the run**, not from GitHub. The ACs beyond the outline's bullets are the near-miss set (5 to 9), the EAN-and-key cases (12 to 15, OD-1), the ambiguity cases (19, 20, OD-2), the repeat-import set (21, 22), the visibility set (23, 24) and the unchanged set (27 to 29).
