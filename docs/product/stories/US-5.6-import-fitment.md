# S5.6 Feeds can say which cars a product fits

Status: approved 2026-10-30 (board status Ready follows the human's own move)
Epic: E5 Browse and search (#13)
Issue: #265 · Tickets: #266-#268 (T5.6.1-T5.6.3)
Depends on: S5.5 (#261), merged: the vehicle list, the fitments table and the fit-state question. S5.7 to S5.9 depend on this story for any fitment data to show.
Source: `docs/product/vehicle-fitment.md` rule 2; decisions 0016 and 0013; `docs/product/stories/US-5.5-vehicle-fitment-model.md` (§ Scope > Out hands S5.6 its slice; OD-2 and OD-3 rulings carried forward); issue #265 acceptance outline; guardrails 1, 2 and 5.

## Open decisions

Ruled 2026-10-30. The ACs below follow the recommended answer in each, and the owner confirmed it: OD-6 "count plus codes", OD-2 "clear", OD-3 "yes" (a product dropped from a feed keeps that feed's fitments), AC 20 "yes" (a test enforces that only the import writes fitments), and OD-1, OD-4, OD-5, OD-7 and the exact-match rule not objected to. Rulings already made by the owner (decision 0016, `vehicle-fitment.md` rule 2, S5.5 OD-1 to OD-3) are not reopened here.

- **OD-1. The name of the field.** The spec says "a fitment field: a list of vehicle slugs separated by `|`" and names no column. Recommended: **`fitment`** as the CSV header and as the XML element name, matched like the other columns (trimmed, any case). Reason: it is the word the spec, the decision and the import output (`fitment: unknown vehicle <slug>`) already use, and the other optional columns are single plain words. Alternative: `vehicles` or `compatible_vehicles`. Cost of changing later: every feed file, including the demo feeds, and decision 0013's column list. Affects ACs 1 to 3 and 29.
- **OD-2. A row with no fitment value, or a feed with no fitment column.** The spec says the import "replaces the fitments a feed gives a product with that row's list" and does not say what an empty list does. Recommended: **an absent column and an empty cell are the same thing, an empty list, and an empty list clears what this feed gave that product.** Reason: it is one rule for CSV and XML (an XML record with no `fitment` element and one with an empty element cannot be told apart once read), and it is what "replace" means. The only case where the alternative differs is a feed that once carried fitment and later drops it: the recommended rule clears that feed's fitments for the products it still lists; the alternative would keep them forever as stale data. Alternative: an absent CSV column means "this feed says nothing", and leaves the feed's fitments alone, while an empty cell clears; XML would need a per-feed notion of "the element appeared anywhere". Affects ACs 6 and 10.
- **OD-3. A product that disappears from a feed.** The importer never removes offers, so a product no longer in a feed keeps its offers. Recommended: **it also keeps the fitments that feed gave it; this story removes nothing for products absent from the import.** Reason: the importer has no "missing from this import" step at all, and decision 0013 says any such step must not run for a feed that failed mid-stream; building it for fitments alone would create the first one. Fitments still stop counting if the admin unapproves the feed (S5.5). Alternative: remove the feed's fitments for products the import did not mention, which needs that step and its failure rule. Affects AC 14.
- **OD-4. Several rows of one feed for the same product.** Two external ids in one feed can resolve to one product (same EAN). Recommended: **the feed gives that product the union of the lists of all its rows in that import.** Reason: it does not depend on row order, so a re-import gives the same result; "last row wins" would let an empty second row silently erase a first row's list. Alternative: last row wins, or reject the second row. Affects AC 11.
- **OD-5. A slug that exists but belongs to a retired vehicle.** The spec covers unknown slugs only. Recommended: **it is stored as a fitment like any other and is not reported as unknown.** Reason: S5.5 (AC 14, AC 23) keeps a retired vehicle's fitments and does not count them, and they count again if the vehicle is put back; skipping them would lose that. The feed author cannot see the retirement, so a warning about it is noise to the operator. Alternative: treat a retired slug as unknown, so the operator sees that a feed points at a vehicle we dropped. Affects AC 15.
- **OD-6. What the import prints for unknown slugs.** The spec says an unknown slug is "counted in the import output as `fitment: unknown vehicle <slug>`"; issue #265 says "a count of unknown vehicle slugs per feed". Recommended: **both: the feed's `imported` line carries the number of skipped slugs (0 included), and under it one line per distinct unknown slug carrying the spec's text and how many rows held it; a skipped value that is not shaped like a slug is counted but its text is never printed, and the number of printed lines is bounded.** Reason: the operator needs the slug to fix the feed; but the value is feed-supplied text, `report.ts` promises never to print the content of a row, and guardrail 5 keeps feed data out of logs, so only slug-shaped values (lowercase ASCII letters, digits and hyphens, bounded length) are echoed. Alternative: print the count only, which is safe but leaves the operator guessing which slug is wrong. Affects ACs 22 to 25.
- **OD-7. Does a demo row carry an unknown slug, to show the output?** Recommended: **no.** Reason: the demo import is run by every developer and by the e2e setup; an always-present warning teaches people to ignore the line, and the unknown path is proven by test fixtures instead. Alternative: one demo row with a deliberately unknown slug. Affects AC 29.

Stated without asking (the human may object): a slug is matched **exactly as written, after trimming** (no case folding): vehicle slugs are lowercase ASCII by contract (S5.5 AC 5), and a capitalised slug is a feed error the operator should see as unknown. Affects AC 5.

## Story

As the owner, I can put the cars a product fits into a feed row, and the import turns that into the fitments the site already knows how to use, so that products from approved feeds fit, don't fit or have no data for a car, and the demo catalogue shows all three.

This is data entry only. A visitor sees nothing new from this story: the `?coche=` selection, the filtering of listings and the fit banner are S5.7 to S5.9. What this story delivers is the only way fitment gets into the database, and a demo catalogue those stories can be built and seen on.

## Scope

In:
- an optional fitment field on a feed row, in CSV and in XML, holding vehicle slugs separated by `|` (spec rule 2);
- on import, replacing the fitments **that feed** gives a product with the row's list, leaving other feeds' fitments alone;
- an unknown slug skipped, never rejecting the row, and counted per feed in the `import-feeds` output;
- the demo feeds carrying fitment, so that the three fit states can be shown on the demo catalogue;
- a guard that nothing but the import writes fitments (guardrail 2).

Out, for this story (listed so a lane does not do them here):
- any change to what the visitor sees: `?coche=`, the picker, filtering, grouping and the fit banner (S5.7 to S5.9);
- a real network's own fitment field and the field mapping screen (S3.5); until it exists real offers have no fitment and their products are `unknown` (spec rule 2);
- removing fitments for products a feed no longer lists (OD-3);
- an admin button to run the import, an admin screen for vehicles or fitments, and the matching queue (CLAUDE.md § Stack);
- a new vehicle, a change to the vehicle list or to how a fitment counts (S5.5 owns both);
- counts of fitments added or removed in the import output (issue #265 asks for the unknown count only);
- any scraping, crawling or HTML parsing to obtain fitment (guardrail 2).

## Acceptance criteria

The field in the feed (OD-1, OD-2)

1. A CSV feed may carry a column named `fitment`. Its header is matched as the other columns are: trimmed, in any letter case, the first of two columns with the same name wins, and other columns are still ignored.
2. An XML feed may carry an element named `fitment` inside a record. It is found by the existing XML record rules: the name is taken without its prefix and in lower case, the first of two such children wins, and other elements are still ignored.
3. In both formats the value is a list of vehicle slugs separated by `|`, and the same text gives the same list in CSV and in XML.
4. Spaces around a slug are ignored, empty items (a leading, trailing or doubled `|`) are ignored, and a slug written twice in one list counts once.
5. A slug is matched against the vehicle list exactly as written after trimming; a slug that differs only in letter case is an unknown slug.
6. (OD-2.) A row with no fitment value, whether the feed has no `fitment` column, the row has an empty cell, or the XML record has no such element or an empty one, has an empty list. No value in this field, whatever it holds, ever rejects a row.
7. A feed with no `fitment` column or element is a valid feed, and every feed file that imported before this story imports with the same products, offers and rejected rows.

Writing fitments (OD-2 to OD-5)

8. For every accepted row, the set of fitments that this row's feed gives the row's product becomes the vehicles in the row's list. This holds when the row creates a new product, when it attaches a new offer to an existing product, and when it updates an offer that already exists.
9. Fitments that other feeds gave the same product, and fitments this feed gave other products, are not changed by the row.
10. (OD-2.) A vehicle this feed gave the product on an earlier import and that is not in the row's list is no longer a fitment of that feed for that product; an empty list removes all of that feed's fitments for the product.
11. (OD-4.) When several rows of one import resolve to the same product, the feed gives that product the union of their lists, whatever the order of the rows.
12. A row that is rejected, for any reason, writes no fitment for any product and removes none.
13. A feed that is skipped (not approved, named with `--feed`) writes no fitment. A feed that fails, before or part-way through its rows (fetch, format, gzip, size or database), leaves the fitments of that feed exactly as they were before the run.
14. (OD-3.) A product that an import does not mention keeps the fitments that feed gave it earlier.
15. (OD-5.) A slug of a retired vehicle is stored as a fitment of the feed, is not reported as unknown, and, as S5.5 AC 23 says, does not count while the vehicle is retired.
16. A fitment is replaced the same way whether the product or its offers are hidden or in review: the import neither skips such a product nor treats it differently (spec rule 2; S5.5 OD-2).
17. After an import, asking the S5.5 fit-state question for an active vehicle gives `fits` for a product whose approved feed listed that vehicle, `no-fit` for a product with fitments that do not include it, and `unknown` for a product no feed gave a fitment. When the admin unapproves the feed, those answers change on the next call with no further step, as S5.5 AC 22 says; the import adds no approval rule of its own.
18. Importing the same feed again, unchanged, leaves every fitment as it was: the same set, the same rows (the same ids and creation times), and prints the same output.
19. Apart from fitments, the field changes nothing about how a row is imported: a feed file with a fitment column gives the same products, offers and rejected rows as the same file without it.
20. Nothing other than the import writes a fitment, in `src/`: no admin action, route, seed or script inserts, updates or deletes fitments, and a test fails if one is added (guardrail 2: fitment enters through feeds only).

Unknown slugs and the import output (OD-6)

21. A slug that is not in the vehicle list is skipped. The row is imported, its other slugs are applied, and the row is not counted in `rejected=`.
22. The `imported` line of each feed states the number of skipped unknown slugs, `0` included. Each unknown slug counts once for each row that held it.
23. Under that line, there is one line for each distinct unknown slug that is shaped like a slug, with the text `fitment: unknown vehicle <slug>` and the number of rows that held it.
24. A skipped value that is not shaped like a slug (anything but lowercase ASCII letters, digits and hyphens, or longer than a bounded length) is counted in AC 22 but its text is never printed, and the number of lines printed for one feed stays bounded however many unknown slugs it holds; the total in AC 22 is always the full count.
25. The order of the unknown-slug lines is the same on every run of the same data.
26. An unknown slug never changes the exit code of `import-feeds`: it is 1 only when a feed fails, as before.
27. The lines of a skipped or failed feed are unchanged and carry no count. The output still contains no URL and no content of a row other than what AC 23 allows.
28. The import writes nothing about slugs or fitments to the application log or the console other than the `import-feeds` report on its output (guardrail 5).

The demo feeds (OD-7)

29. The demo feeds carry the `fitment` field. Every slug in them is in the vehicle list, so the first demo import prints `0` unknown slugs for every feed.
30. The demo public filters (oil, air and cabin filters) mostly carry fitment, at least two demo oils carry it, and some public demo products carry none.
31. For at least one vehicle in the list, the public demo products include products that `fit` it, products whose fitments do not include it (`no-fit`), and products with no fitment (`unknown`), so that all three states can be shown.
32. At least one demo product, one that two demo feeds both sell, has fitments given by two different feeds, and the S5.5 question counts a vehicle both list once.
33. No fitment is given on the demo rows that are not car parts (the drill and the unmapped rows), and the demo counts do not change: 124 offers, 54 products of which 50 public, and the public products per category.
34. Running the demo import a second time changes no fitment. The seed still creates no vehicle and no fitment, the demo feeds stay CSV, and the first import steps in `CLAUDE.md` § Commands need no new step.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- how the parsed list travels from the row reader to the writer, and the type of that value; the floor is ACs 3 to 7, 21 and 22;
- whether the column joins the shared list of canonical columns (so XML picks it up) or is handled apart, and what that does to the XML cell order that `tests/unit/feed-formats.test.ts` derives from it;
- how slugs are resolved to vehicles inside the feed's transaction, **including retired vehicles** (AC 15), and whether the lookup is loaded once per feed, as the category mappings are;
- how a replacement is made so that ACs 11 and 18 hold: a diff of the old and new sets keeps ids and creation times, a blind delete-and-reinsert does not;
- the cost for a feed of many thousands of rows, and whether writes are batched; the feed stays one transaction (decision 0013), so ACs 13 and 28 hold;
- the new report values and their wording beyond what ACs 22 and 23 fix, the bound in AC 24, and the order in AC 25;
- how AC 20 is enforced: whether `tests/unit/seams.test.ts` gains a rule on who inserts into or deletes from the fitments table, as it has for the approval flags;
- which demo products get which vehicles (ACs 29 to 33): the story fixes the shape, the design names the data. Choose a vehicle a later story can use for its screens (a León or Golf in the list), and keep the data small and readable;
- where the column sits in the demo files, and what the pinned-header unit tests become.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required:

- **Parsing (unit):** the header in CSV (any case, trimmed, duplicate column, absent); the element in XML (prefixed, upper case, duplicated, empty, absent); the list rules (trim, empty items, repeated slug, case kept); no input rejects a row; the XML cell order test and the validation tests that pin the column list are updated, not loosened. Files in play: `tests/unit/import-validate.test.ts`, `tests/unit/feed-formats.test.ts`, `tests/unit/csv.test.ts` as needed.
- **Report text (unit):** the count on the feed line, the per-slug lines, a value not shaped like a slug counted and not printed, the bound, the order, skipped and failed feeds unchanged, no URL in the output; `tests/unit/import-report.test.ts` keeps its no-URL check.
- **Writing fitments (integration; new file next to the importer tests, fixtures under `tests/fixtures/feeds/`, the `csvOf` and `xmlOf` helpers in `tests/support/feeds.ts` extended to carry the field, vehicle helpers from `tests/support/catalogue.ts`):** a first import creating fitments on the new-product, attach and existing-offer paths; a changed list replacing the feed's set; an empty cell, an absent column and an absent XML element clearing the feed's set; a second feed's fitments for the same product surviving; union over two rows resolving to one product, in both orders; a rejected row writing and removing nothing; an unapproved feed, and failed feeds (bad format, mid-stream failure, database error), leaving fitments as they were; a product missing from a re-import keeping its fitments; a retired slug stored and not reported; hidden and in-review products replaced like any other; the same import twice leaving the same rows with the same ids and times; fit states end to end through the S5.5 question, including approval flipped off and on.
- **Unknown slugs (integration):** an unknown slug imports the row and rejects nothing; the printed count and lines for a feed with known, unknown and non-slug values; exit code 0; the existing logging test keeps passing and covers a feed with fitment values (`tests/integration/importer-logging.test.ts`).
- **Demo (unit and integration):** `tests/unit/demo-feeds.test.ts` and `tests/unit/feed-source.test.ts` updated for the new header; every demo slug in the vehicle list; the coverage of AC 30 to 33 computed from the files; `tests/integration/importer-demo.test.ts` updated for the new report lines, the demo counts unchanged, a second import changing no fitment, and the three fit states present for one vehicle through the S5.5 question.
- **Seams (unit):** the rule from AC 20, failing if a file other than the importer writes fitments.
- **Kept as they are:** the matching, category, preservation and isolation importer tests, the fit-state and visibility tests, and the e2e suite. This story adds no page or route; the e2e setup runs the demo import, so it must still exit 0 and the test lane confirms no e2e assertion reads the import report text.

## Tickets

Ordered, contracts before consumers. Each ticket has a test dispatch after it, as in S5.4 and S5.5 (one ticket, two dispatches). The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.6.1 (#266) backend. Read the fitment field in CSV and XML.** The optional field and its list rules, and the value handed on with each valid row. Test dispatch after it: the parsing tests. ACs 1 to 7.
2. **T5.6.2 (#267) backend. Write fitments during import and report unknown slugs.** The per-feed replacement inside the feed's transaction, the retired and unknown slug handling, the report values and wording, the guard that only the import writes fitments, and the fixtures and helpers the tests need. Test dispatch after it: the integration, report and seams tests. ACs 8 to 28.
3. **T5.6.3 (#268) backend, data. Demo feeds carry fitment for the three fit states.** The `fitment` field in the four demo CSV files, and the demo unit and integration tests that pin their header and report lines. Depends on T5.6.2 to be seen end to end. Test dispatch after it: the demo tests. ACs 29 to 34.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff:

- `docs/decisions/0013-xml-parser-and-feed-formats.md`: the list of canonical columns and the XML cell rule gain the fitment field;
- `docs/decisions/0016-vehicle-fitment.md`: the consequence "a fitment column in the demo feeds" is now true;
- `docs/product/vehicle-fitment.md` rule 2: the field name and the rulings of OD-2 to OD-6 once made;
- `CLAUDE.md` § Stack (vehicle fitment line) and § Commands (what `import-feeds` prints, and the demo data);
- the backend and testing packs, for the conventions this story sets (an optional feed column, the import report's new values, the feed helpers that carry the field).

## Notes for the human

- **Nothing visible ships.** A reviewer accepting this story sees an import and its output, and fitment rows in the database, not a page. The fit states become visible with S5.7 to S5.9.
- **Why no separate test ticket.** The issue fixed three tickets and S5.5 set the precedent of a test dispatch after each. If the human wants S5.4's shape (a test ticket of its own), add T5.6.4 for the test lane; no AC changes.
- **AC 18 is stricter than "the same set".** It asks for the same row ids and creation times, because #265 says a second import "changes nothing" and the fitment row's creation time is its only provenance. If the human prefers the simpler rule (the same set, with delete-and-reinsert allowed), AC 18 drops its parenthesis and § Left to the tech lead loses its diff note.
- **Only an operator sees the output.** The `fitment: unknown vehicle <slug>` lines are the only place a feed author learns of a typo in a slug. That is the reason OD-6 recommends echoing slug-shaped values rather than counting alone.
- **Size and iteration** are not set in this draft; the board holds them.
