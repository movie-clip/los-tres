# S4.2 Admin maps feed categories onto the five fixed categories

Status: approved by the owner 2026-11-19 (D-11, run `2026-11-19-s4-2-category-mapping`); Q-1 to Q-4 settled 2026-11-19 (D-10, D-12 to D-14); built and gated in that run. Board status follows the human's own move.
Epic: E4 (#12) · Priority and Size: per the board (the issue sizes its tickets backend M, frontend M, test S)
Issue: #33 · Tickets: #110-#112 (T4.2.1-T4.2.3)
Depends on: S4.0 (the fixed tree, decision 0015), S5.1 (a product is public only with a category) and S3.1 (the admin shell, guards and feed list), all shipped. No open dependency. S4.2 does not wait for S3.5 and S3.5 does not wait for it.
Source: the approved delivery brief and the human's rulings D-1 to D-9 of run `2026-11-19-s4-2-category-mapping` (`decisions.md`); issue #33 as relayed into that run; `docs/product/mvp.md` § Catalogue scope, § Visibility; `docs/product/stories/US-3.1-admin-feeds.md` (the shape of a shipped admin story); `docs/product/stories/US-5.1-category-browse.md` OD-F and AC 5 to 7 (the importer rules this story leaves in place); decisions 0015 and 0017; guardrails 1, 3 and 5.

## Standing constraints

These bind this story and everything built from it.

- **The importer's rule is unchanged (D-1).** The importer sets a product's category only while it has none, never overwrites and never clears (US-5.1 OD-F, AC 7). This story adds a second, explicit writer of a product's category, the admin's save. The importer is not touched except to treat an outside-scope category as unmapped (D-2).
- **Saving a mapping publishes nothing by itself (guardrail 1).** A product is public only while its feed and shop are approved, it is not hidden and it has a category. A mapping gives a category and nothing else. No text this story adds may promise otherwise (AC 47).
- **Local-only until S2.2.** The admin area is still password-only. Nothing built here is deployed or reachable from the internet before S2.2 (#23) is done (US-3.1 Standing constraints).
- **No phone width and no visual polish check for admin screens** (the brief's Sequence). Function, copy and the guardrails are checked.

## Open decisions

Rulings first, then the questions this draft could not settle. The numbering of rulings is the run's (`decisions.md`); D-4 approved the brief and is carried in Scope.

Ruled by the human, not reopened here. Each is stated in the ACs named:

1. **D-1. The admin's save re-applies to existing products in the same transaction; the importer's rule is unchanged; the admin's latest action wins (ACs 26 to 30, 34, 35).**
2. **D-2. "Not mapped" has an explicit outside-scope record, so the queue can reach empty (ACs 20, 36).** Its shape is the tech lead's.
3. **D-3. Removing a mapping or marking a category outside scope stops its products being public at once (ACs 22, 30, 31).**
4. **D-4. The brief is approved.** S4.2 is story #33 in E4 and reuses the existing tables, the visibility rule and the S3.1 admin parts; out of scope are a tree editor, an import button, case or accent folding, the collector, S12.2, S3.7 and S3.5 (Scope, Out).
5. **D-5. Demo seed mappings are editable like any other; a removed demo mapping returns at the next start while `SEED_DEMO_DATA=true` (AC 23).**
6. **D-6. Feed category strings match exactly after trim, case-sensitive (AC 14).**
7. **D-7. Every feed with imported offers is listed, approved or disabled; a never-imported feed shows an empty state (ACs 10, 16).**
8. **D-8. Products with an empty category cell are shown as a non-editable count per feed with a note that they stay hidden; a feed with no category column publishes nothing (AC 15).**
9. **D-9. The count is distinct products with an offer in that feed category, not offers (AC 12).**

D-5 to D-9 were put as an assumed list and not objected to; D-1 to D-4 were answered "yes" in session.

Settled 2026-11-19, all four as drafted, with no change to any AC. Q-2 was ruled by the human ("Q1 1", D-10); Q-1, Q-3 and Q-4 were put as an assumed list and not objected to (D-12, D-13, D-14); the product count of AC 12 including hidden products and disabled feeds was settled the same way (D-15). The text of each question is kept as drafted:

10. **Q-1 (settled, D-12). Which products does a new or changed mapping touch? (ACs 26 to 29.)** Drafted: a new mapping fills only products that have no category; a change moves only products whose category is the old target; a product that sits in some other category keeps it. This is the brief's option 1 as written. Alternative: any product with an offer in this feed category is set to the new target whatever it holds now. Recommendation: keep the draft. The old target is the evidence that this mapping placed the product there; the alternative would also pull a product out of a category an admin gave it through another feed's mapping, and nothing in the rulings asks for that. Tension to see: "the admin's latest action wins" (D-1) is read as applying to a product the change moves, not to one it leaves alone.
11. **Q-2 (settled, D-10). A removal while another mapping still places the product in the same target (AC 30).** Example: feed A's "Filtros" and feed B's "Aceites" both map to Filtros de aceite and one product has an offer in each. Removing A's mapping clears the product, though B's mapping still places it there. Drafted: the literal rule, the product is cleared, and the next `import-feeds` refills it from B because the importer fills from none. Alternative: clear only when no other of its offers' categories still maps to the old target. Recommendation: keep the draft. The alternative needs a per-product recomputation across every offer and mapping, which is the "derive the category" option the owner did not choose (brief D-1 option 2); and the case needs two feeds that both carry the same product.
12. **Q-3 (settled, D-13). A record with no offer behind it, and a feed never imported that the seed already mapped (ACs 16, 17).** The seed writes mappings before any import. Drafted: a feed's list is the categories its offers carry plus any category the feed already has a record for, so such a record shows with a count of zero and can be changed or removed; the empty state of D-7 shows only when a feed has neither. Alternative: list only what offers carry, so a stale record can never be seen or removed from the screen. Recommendation: keep the draft.
13. **Q-4 (settled, D-14). A crafted request naming a feed category the screen would not list (AC 8).** Drafted: refused, nothing written, so no junk record is created. Alternative: accepted for any non-blank string. Recommendation: keep the draft. The cost is that a request made just as an import removes the last offer carrying the string is refused, which is harmless.

## Story

As an admin, I map each category a real feed uses onto one of the five fixed categories, or mark it outside scope, once, and the products of that feed category follow: they take the category, change it, or leave the public site at once.

Today the two tables exist and the importer reads them, but only the demo seed writes a mapping, and a saved mapping would move no product until a command-line import ran. After this story an admin publishes an approved feed's products with no developer and corrects a wrong mapping on the screen. The queue of categories still to review can reach empty, because a category that does not belong on the site is recorded as outside scope and not left on the list for ever.

## Scope

In:

- A screen, reached from the admin navigation, that lists every feed with the feed categories its offers carry, each with the number of products and its state: mapped to one of the five (named), outside scope, or not reviewed; not reviewed first.
- Setting, changing and removing a mapping, and marking a feed category outside scope (D-2), each by an action with a server role check.
- The effect on existing products in the same transaction as the save, by the rules of ACs 26 to 34 (D-1, D-3).
- A server-side check that a target is one of the five children of Mantenimiento del coche (D-4).
- The importer treating an outside-scope category as unmapped (D-2).
- The count of products whose feed category cell is empty, shown per feed, not editable (D-8).
- The deliberate changes to the guard tests that bound who may write a product's category and a mapping (ACs 42 to 44).
- Empty, degraded and error states.

Out, nearest first (listed so a lane does not do them here):

- A category tree editor (mvp.md: the tree is fixed in code, decision 0015).
- An "Import now" button, and any change to the importer's rule of setting a category only from none (D-1).
- A target other than the five children, including the root; the server refuses it (AC 4).
- Case or accent folding of feed category strings, in the screen or the importer (D-6).
- Any change to hide or unhide, or to the approval of a feed or a shop. The screen offers none (AC 41).
- Setting a single product's category by hand, and any bulk action across feeds.
- The collector and the local-only gate (S12.2), file feed registration (S3.7), per-network column mapping (S3.5).
- Phone widths and visual review of the admin screen (the brief's Sequence).
- The technical contract, the schema, the file layout, route segments and any migration (the tech lead's); the Spanish copy and layout (the UX pass's).

## Acceptance criteria

"The admin" is a signed-in admin. A "feed category" is the string a feed gives a product, as stored trimmed on the offer. A "target" is one of the five children of Mantenimiento del coche. A feed category is **mapped** (to a target), **outside scope**, or **not reviewed** (neither). **Removing** a mapping returns a mapped or outside-scope category to not reviewed. A "refusal" is a message in Spanish, a row not written or changed, and an answer that is not a server error. A product "has an offer in" a feed category when one of its offers is in that feed and carries that string. Copy in these ACs is intent only; wording and layout are the UX pass's.

Access and safety (guardrail 3)

1. The screen is guarded on the server: an anonymous request is redirected to the sign-in page and receives none of its data; the guard runs in the page and in its metadata function; the screen carries the same `noindex` and no-store signals as the existing admin pages and sets no cookie.
2. Every action this story adds (set or change a target, mark outside scope, remove) refuses a request with no session, a forged cookie, an expired cookie or a signed-out cookie, has no effect, and checks the role before it reads or writes anything else, including when called directly with a crafted request and not from the page.
3. Every such action refuses a submission from another origin and has no effect.
4. A target is accepted only if it is one of the five children, checked on the server and not only by the choices the screen offers. The root Mantenimiento del coche, any other category, an id that does not exist and a value that is not a whole number are refused and write nothing (D-4).
5. A crafted submission cannot set anything the screen does not offer. Extra fields are ignored or refused; the only things written are the record for the one feed category named and the category of the products by the rules below. In particular it cannot set a product's category directly, a hidden flag, an approval or a review flag.
6. A submission naming a feed that does not exist is refused and writes nothing.
7. A submission whose feed category is empty or only blank space is refused and writes nothing.
8. A submission naming a feed category that the screen would not list for that feed (Q-4) is refused and writes nothing.

The list and its states

9. The admin navigation entry for categories, which has no link today, links to the screen, and no other navigation entry gains a link to a page that does not exist.
10. Every feed is listed, approved or disabled, demo or not (D-7), identified as the feed list identifies it (shop, network and host). The screen shows no more of a feed's URL than its host: no scheme, port, user name, password, path, query or key, in the HTML, in data sent to a client component, in a form field or in any action response (US-3.1 ACs 23 to 25 bind this screen).
11. Under each feed, the screen lists each distinct, non-empty feed category carried by that feed's offers, with its state: mapped (naming the target), outside scope, or not reviewed.
12. Each feed category shows the number of distinct products that have an offer in it (D-9), not the number of offers. A product with offers in two categories of one feed counts in each. The count includes such products whatever the feed's approval and whatever the product's hidden flag.
13. Within a feed, the categories not reviewed are listed before the mapped and the outside-scope ones.
14. Feed categories match exactly after trim and case-sensitively (D-6): "Filtros" and "filtros" are two rows, and surrounding white space never makes a second row.
15. For each feed whose offers include products with an empty category cell, the screen shows how many distinct products those are and says that they stay hidden, with no control to map them (D-8). A feed with no category column shows all its products there and publishes none.
16. A feed with no imported offers and no record shows an empty state in place of its categories (D-7); with no feed at all the screen renders without error and says so. Both answer 200.
17. A feed category that has a record but that no offer carries is listed with a count of zero, so it can be changed or removed (Q-3).

Saving a mapping

18. The admin can map a not-reviewed or outside-scope feed category to a target; the screen then shows it as mapped, naming the target, and tells the admin in words that it was saved.
19. The admin can change a mapped feed category to another target; the screen then names the new target and says it was saved.
20. The admin can mark a not-reviewed or mapped feed category outside scope (D-2); it then leaves the not-reviewed group. When every category of a feed is mapped or outside scope, the screen shows none of that feed's categories as not reviewed.
21. The admin can remove a mapped or outside-scope record, which returns the category to not reviewed.
22. Before the admin submits a removal or an outside-scope mark on a mapped category, the screen says that the products of the category will stop being public (D-3).
23. The seed's demo mappings are editable by the same actions with no special case (D-5). With `SEED_DEMO_DATA=true`, a restart returns a removed demo mapping as a mapping, and leaves a changed or outside-scope demo category as the admin set it, with no duplicate record. The return of a mapping at restart changes no product; the importer's rule fills those.
24. Saving the state a category already has changes nothing and is not an error.
25. Two submissions for the same feed and feed category arriving at the same moment leave at most one record, no server error, and a stored state equal to one of the two submitted.

The products follow the mapping (D-1, D-3)

26. When a not-reviewed or outside-scope feed category is mapped to a target, every product that has an offer in that feed category and has no category now takes the target, in the same transaction as the save and with no import run (D-1).
27. The same save leaves unchanged every product that has an offer in that feed category and already has a category (Q-1).
28. When a mapped feed category is changed from one target to another, every product that has an offer in that feed category and whose category is the old target takes the new target, in the same transaction (D-1). A product that has an offer in that feed category and whose category is neither keeps its category (Q-1).
29. The admin's latest action wins (D-1): a product with offers in two feeds mapped to different targets, which an admin change moves by AC 28, ends in the target of that change and not in the other feed's. A later `import-feeds` leaves it there, and a later admin action on the other feed's mapping applies by the same rules.
30. When a mapped feed category is removed or marked outside scope, every product that has an offer in that feed category and whose category is the old target has its category cleared, in the same transaction (D-1, D-3; Q-2).
31. A product cleared by AC 30 is absent at once, from the next request, with no import and no other step: from every category page, from the sitemap, from `/go` for its offers, and its product page answers 404 (D-3; US-5.1 AC 1).
32. A removal or outside-scope mark leaves unchanged every product that has an offer in that feed category and whose category is not the old target.
33. Moving a feed category between not reviewed and outside scope changes no product.
34. The record and the change to the products are one write: if the change to the products fails, the record is as it was before, and nothing is half-changed.

The importer (D-1, D-2)

35. The importer's rule for a mapped row is unchanged: it sets a category only while the product has none, never overwrites and never clears. A `import-feeds` run after an admin action leaves every category the admin action produced as it was, and the existing importer category tests keep passing in behaviour.
36. A feed row whose category is outside scope is treated as an unmapped one: the product and offer are stored, the product's category stays empty, the row is not rejected, the run does not fail and the exit code is 0 (D-2; US-5.1 AC 7).
37. A feed category first seen at an import appears as not reviewed the next time the screen loads, and the import writes no mapping or outside-scope record for it.

Guardrail 1: the admin decides what the public sees

38. For every action this story adds, no hidden flag on a product or an offer, no review flag on an offer and no approval of a feed or a shop is different afterwards, and no product column other than its category has changed.
39. A hidden product given a category by a save stays hidden and does not become public.
40. A mapping on a feed that is not approved, or whose shop is not approved, sets the categories of its products but makes no offer and no product of that feed public: every public page, the sitemap and `/go` answer as before.
41. The screen offers no control to approve or disable a feed or a shop, or to hide or unhide a product or an offer.

Guards in the test suite (deliberate changes, bounded)

42. `tests/unit/seams.test.ts` changes its rule that products are updated only in the importer and the seed to a closed, named list that also holds the admin mapping writer by name; any other file that updates products fails; the test finds that writer and fails if it is gone; and it shows that the writer sets no product column other than the category (D-18 of S3.1 is the precedent: the guard changes in the same ticket as the writer it bounds).
43. `tests/unit/seams.test.ts` also restricts writes to the feed category mapping records, and to the outside-scope record whatever shape the design gives it, to a closed list of files: those that write them today and the new writer. Any other file that writes them fails.
44. `tests/integration/admin-routes.test.ts` names the full set of the new actions file, and keeps asserting that every server action calls the role check first and acts on its refusal, and that every admin page, layout and metadata function is guarded. An action added later and not named fails it.

Failure and logging (guardrail 5)

45. If the database cannot be reached or a write fails, the admin sees the existing admin error screen or message, nothing is changed or half-changed, and the log line is a fixed line and an error code only, with no feed URL and no message text from the failure.

The page and its copy

46. All visible text this story adds comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing strings; the existing copy checks over admin text still pass.
47. No text this story adds or changes says or implies that mapping a category makes its products appear on the public site by itself, or that approving a feed does; the text that a product is public only when its feed and shop are approved and it is not hidden stays true wherever it is said.
48. Every form field has a visible label, each refusal message is tied to the control it concerns so assistive technology reads them together, and every control is reachable and operable from the keyboard alone.
49. A successful save, change, outside-scope mark or removal tells the admin in words what was done, and a refusal says why, in Spanish, without repeating a feed URL.

Public site unaffected

50. Opening the screen writes nothing and changes no public page, sitemap file or `/go` answer, and a public page still sets no cookie.
51. The behaviour of S2.3 (approve and disable) and S3.1 (networks, shops and feeds) is unchanged, and their tests keep passing without being loosened.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the shape of the outside-scope record of D-2: a nullable target on the existing mapping row, a flag, or something else, with its migration and how the existing "target is not null" constraint is dealt with; the observable result stays ACs 18 to 21 and 36;
- the transaction shape of D-1: how the record and the change to the products are one write (AC 34), and how the two-submissions race of AC 25 is settled;
- how the products to move are found (an offer's feed and stored feed category, ACs 26 to 32), and where the second writer of a product's category lives (AC 42);
- the contract between the read, the writer and the actions; the names of the actions and the route segment; the size of the screen's data (a real feed may carry hundreds of categories);
- how a removal reaches the public pages at once (AC 31), including any cache the public pages use;
- how the importer's loader sees the outside-scope record (AC 36), and how the seed's insert still never overwrites an admin's edit (AC 23);
- the named list of AC 43 and the action set of AC 44, which ticket carries them (T4.2.1, as S3.1 did).

Left to the UX pass (direction: new, since this is a new admin screen; `docs/design/system.md` may need rows): where the feeds and their categories sit on the page, how the three states read and how not reviewed stands out, the control for choosing a target among five, how outside scope and removal are offered and confirmed (AC 22), every label and message, the empty states and the count of products with no category cell.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 8 | integration (database), in the pattern of `tests/integration/admin-source-actions.test.ts` and the support in `tests/support/admin.ts`: every action refused for no, forged, expired and signed-out cookies and for a cross-origin submission, with no row written and no product changed; the target table of AC 4 (each of the five accepted; the root, a missing id, a non-number refused); crafted extra fields; a missing feed, a blank string, a string the feed does not carry |
| 9, 10, 16, 48 | integration of the page for the anonymous redirect and for no feed at all; e2e for the navigation link, the keyboard and the labels; the masked host (US-3.1's no-URL assertions applied to this page) |
| 11 to 15, 17 | integration of the read: a feed with several categories and products, a product with offers in two categories counted in each (not as offers), a hidden product and a disabled feed still counted, "Filtros" and "filtros" apart, surrounding space folded, not-reviewed first, empty-cell products counted and not listed as a category, a feed with no category column, a record with no offer listed at zero, a feed never imported |
| 18 to 21, 24, 25 | integration of the writer: set, change, outside scope, remove, the same state twice, two simultaneous submissions |
| 22, 49 | e2e: the notice before a removal or an outside-scope mark; success and refusal messages |
| 23 | integration extending `tests/integration/seed.test.ts`: a removed demo mapping returns and moves no product; a changed and an outside-scope demo category survive a second seed; no duplicate |
| 26 to 34 | integration, the heaviest part: fill from none; products with a category untouched on a new mapping; change moves only the old target's products; a product in an unrelated category stays; the two-feed case of AC 29 followed by an `import-feeds`; removal and outside scope clear only the old target's products; the public readers (category page, product page, sitemap, `/go`) before and after, with no import between; not reviewed to outside scope and back changes nothing; a failing product update leaves the record as it was |
| 35 to 37 | integration extending `tests/integration/importer-categories.test.ts`: the existing assertions unchanged; an outside-scope row imported (stored, category empty, not rejected, exit code 0); a new string appears as not reviewed with no record written |
| 38 to 41 | integration: for each action, the full rows of products, offers, feeds and shops compared before and after, apart from the category; a hidden product; an unapproved feed and an unapproved shop with their public answers unchanged; e2e or a component check that the screen has no approve, disable or hide control |
| 42 to 44 | `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` as changed by the story; each new rule is shown to fail on a deliberate offender fixture where the existing seam tests already do so |
| 45 | integration in the pattern of `tests/integration/admin-logs.test.ts`: a failing write leaves nothing half-changed, and the captured output holds a code only, with a planted key in a feed URL absent |
| 46, 47 | `tests/unit/admin-copy.test.ts` and `tests/unit/messages.test.ts` extended or changed by design for the new copy and any navigation key; a check that no new sentence promises publication |
| 50, 51 | integration or e2e: a public page, the sitemap and `/go` unchanged by opening the screen; the S2.3 and S3.1 tests unchanged and passing |

Notes for the test lane:

- The e2e leaves the development database's demo mappings and products as it found them, or works on a feed of its own, because other e2e specs depend on the demo mappings (D-5).
- Fixed category ids are not stable constants in tests: look up the five by slug (`tests/support/db.ts` re-creates the tree).

Existing tests this story reviews and changes by design, not loosens: `tests/unit/seams.test.ts` (ACs 42, 43), `tests/integration/admin-routes.test.ts` (AC 44), `tests/unit/messages.test.ts` if the admin navigation keys change, and the descriptions in `tests/integration/importer-categories.test.ts` that say a changed mapping leaves a product where it is, which now describe the importer only (AC 35).

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story and rules Q-1 to Q-4; a UX pass (direction: new) fixes the screen and the copy; a design pass (tech lead) fixes the contract, which fires because D-2 adds a schema change and the read, the writer and the actions cross frontend and backend. The design pass may merge, split or rename the tickets. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T4.2.1 (#110) backend. The outside-scope record, the writer with its re-apply, the read, the actions and the importer's treatment of outside scope.** The role and origin check on every action, the server-side target check, saving, changing, removing and marking outside scope with the effect on products in one transaction (D-1, D-3), the read of each feed's categories with counts, states and the empty-cell count, the importer's loader seeing outside scope as unmapped, logging that holds a code only, and the deliberate seams and admin-routes test changes that bound the new writer (the S3.1 D-18 precedent). ACs 1 to 8, 10 to 17 (the data), 18 to 21, 23 to 45, 50, 51.
2. **T4.2.2 (#111) frontend. The screen, the navigation link and the copy.** The list of feeds and their categories with states, counts and empty states, the controls to map, change, mark outside scope and remove, the notice of AC 22, success and refusal messages, labels tied to fields, the navigation entry linked, the new copy in the admin message section. Needs #110, the UX pass and the design pass. ACs 1, 9 to 17, 20, 22, 41, 46 to 49.
3. **T4.2.3 (#112) test. The coverage of the test plan above.** The tests not already carried by #110, in particular the re-apply cases of ACs 26 to 34, the two-feed case and the guardrail 1 checks of ACs 38 to 40, and the e2e from sign-in to a mapped product on the public site. Needs #110 and #111. Every AC; coverage per the test plan.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- The comments that say a product's category is written by the importer only and never cleared: `src/db/schema/catalogue.ts` (the products column) and the header of `src/server/importer/index.ts`. The importer stays bound; the admin writer is a second, explicit writer.
- `docs/product/stories/US-5.1-category-browse.md`: OD-F and ACs 5 to 7 describe the importer, not the admin writer; line 33 ("the mapping exists only through the demo seed until S4.2") describes the state before S4.2.
- `docs/product/stories/US-3.1-admin-feeds.md` lines 15 and 195, which say the same.
- `tests/unit/admin-copy.test.ts` lines 105 to 109, whose comment says categories are "mapped by the seed only, S4.2".
- `docs/product/mvp.md` § Catalogue scope and § Admin area, to record that the admin maps feed categories and marks one outside scope; decision 0015 ("mapping stays with S4.2"), only if the docs lane judges it the place.
- `CLAUDE.md`: a short sentence under the admin sign-in section only if the docs lane judges it the place for it; otherwise no change identified. The seed note ("the demo mappings") stays true.
- `docs/design/system.md`, rows for the screen's new parts, from the UX pass.
- The backend, frontend and testing packs, for the conventions this story sets (a second, bounded writer of a product's category; a closed writer list for the mapping records).
- `messages/es-ES.json` admin section: the new copy and the Nav entry, from the UX pass.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **Where the rulings land.** D-1: ACs 26 to 30, 34, 35, with the latest-wins rule in AC 29. D-2: ACs 20, 36. D-3: ACs 22, 30, 31. D-4: Scope, Out, AC 4. D-5: AC 23. D-6: AC 14. D-7: ACs 10, 16. D-8: AC 15. D-9: AC 12.
- **The one place the draft read the rulings closely.** D-1's text says both "a product categorised through another feed keeps that category unless it sits in the old target" and "the admin's latest action wins". The draft reads the second as applying to a product the change moves (AC 29), and the first as the limit of what a change moves (ACs 27, 28, 32). Q-1 puts the alternative to you.
- **D-3 hides products already live.** A removal or an outside-scope mark takes its products off the public site at the next request, with no import, which is why AC 22 asks the screen to say so before the admin submits.
- **Issue #33 and the tickets #110 to #112 were read as relayed into the run**, not from GitHub. The issue's outline is the source of the scope; the ACs that go beyond it are the guardrail 1 set (38 to 41), the guard-test set (42 to 44) and the demo-seed behaviour (23).
- **Real-feed scale is not measured.** That a real feed holds many categories of which few matter is an inference from the demo data, and it is the reason D-2 asked for an outside-scope record.
