# S7.6 A product that converged without an EAN takes the EAN of an eligible row of its own

Status: **approved 2026-11-26 (D-15 of run `2026-11-26-333-converged-ean`); OD-1 and OD-2 ruled as recommended (D-13, D-14).** Drafted from the approved delivery brief (`02-product.md`) and the owner's rulings D-1 to D-12 of run `2026-11-26-333-converged-ean` (D-1 to D-7 by "yes" in session, D-8 to D-12 by non-objection to the assumed list). The ACs are written under those rulings and add none. The two questions the rulings left open are in § Open decisions below, both resolved. Board status follows the human's own move.
Epic: E7 Matching (#15) · Iteration 4, a leftover (it finishes a limit S7.1 recorded) · Priority: P1 · Size: set on the board
Issue: #333 · Tickets: T7.6.1 (#390), T7.6.2 (#391), T7.6.3 (#392)
Depends on: S7.1 (#40, shipped), S12.2 (#306, shipped), S2.4 (hide, shipped), S3.7 (the catalogue file, shipped). No open dependency. Not a precondition of S9.4 (#53).
Source: issue #333 as copied into the run; the owner's notes in `run.md` § request; `02-product.md` (§ Behaviour, § Answers, § Screens and tests, § Docs in scope) and `01-recon.md` (§ Q1 to Q8), which read the code read-only and ran nothing; decisions D-1 to D-12 of the run's `decisions.md`; `docs/decisions/0008-product-matching.md`; `docs/product/stories/US-7.1-match-brand-part-number.md` (the shape, and the ACs this story supersedes in part); `docs/product/stories/US-12.2-collected-data-local-only.md` (ACs 28, 29, 31, 32); `CLAUDE.md` guardrails 1 to 5.

## Standing constraints

These bind this story and everything built from it.

- **The limit this story lifts is recorded on purpose.** 0008 says a product that converged a row carrying an EAN "still has no EAN", and US-7.1 AC 10 and AC 14 pin it; the owner accepted it in run `2026-11-23-board-next` and has now ruled to reverse it for the EAN field only (D-1 to D-7). The same pull request amends 0008 (D-11), so the decision record is never left contradicting the code.
- **A product's text stays the first feed's, except for an empty EAN.** Title, brand, part number, description and slug are never rewritten by a join. The one exception is an EAN that is empty, which may be filled once and is never changed or cleared afterwards (D-1, AC 15 and 16).
- **A fill is the importer's own write and nothing else.** It never re-matches an offer, merges two products, creates a product, approves, hides, unhides or maps anything. Approval, hide and category mapping decide what is public exactly as today (guardrail 1).
- **The S12.2 wall holds, on one side only (D-3).** A collected ("marked") row gives an EAN only to a marked product and an unmarked row only to an unmarked one. No collected row ever puts an EAN on a product that is public without the local flag (guardrail 2, US-12.2 AC 29 kept verbatim).
- **The feed file is the only source of an EAN.** Offers store none, so there is nothing to backfill from in the database. The next ordinary `import-feeds` re-reads the file and is the backfill (D-1, D-12).
- **Local-only until S2.2.** This story adds no admin screen, no command, no setting and no migration.
- **Browser tests stay at 75.** Proof is at unit and integration level. Decision 0006 and its wording are not touched here; they go in the #382 and #383 pull request (D-10, the owner's note).
- **No real shop, host or the collector's target is named** in this file, in a fixture, in a test or in a doc this story amends. Fixtures use invented shops and products.

## Open decisions

Both resolved on 2026-11-26: **OD-1 by D-13** (a fill never writes into a hidden product, as drafted; AC 6 stands) and **OD-2 by D-14** (approving this story is the owner's edit of the `CLAUDE.md` Stack "Matching" line, made by the docs lane at close-out; AC 28 stands). The text below is kept as drafted.

1. **OD-1. May a fill write into a product the admin has hidden?** D-2 gates the fill on the row's shop, feed and offer. It says nothing on the product's own hidden state. A hidden product still matches and still receives offers (0008), and still counts as a holder of its EAN (D-4), so the case is real: an EAN-less hidden product, and an eligible row that joins it or already sits on it. Recommendation: no fill; a hidden product keeps the EAN it has, which is none. Reason: D-2's own ground for the gate (no admin screen can clear an EAN, and an EAN steers later matching) applies equally to a product the admin took out of the site, and the admin's hide is the strongest signal the product is not wanted. Alternative: the product's hidden state does not gate, which is the literal reading of D-2 and a smaller rule. AC 6 is the only AC that moves.
2. **OD-2. Confirm that approving this story is the owner's edit of the `CLAUDE.md` Stack "Matching" line.** `CLAUDE.md` says a change to a § Stack line is the owner's call: propose it and stop. D-11 lists that line among the docs to amend, by non-objection. Recommendation: the owner's approval of this story, with that line named in AC 28, counts as the edit and the docs lane makes it at close-out. If the owner prefers to make that one line himself, AC 28 drops it and the rest stands.

## Story

As an admin loading real shop files, when a product was made by one shop's row with no EAN and another shop's row for the same part carries an EAN, I want the product to take that EAN, so that a later row with the same EAN lands on the same product page and the public page and search show the EAN, instead of a second product page for one part.

Today S7.1 attaches a row by brand and part number but never changes the product it joins, so the product keeps no EAN. A later row that carries that EAN with a different brand or part number finds no product by EAN and becomes a new product, silently, with no `own_product` line in the import output. The duplicate page is the cost the owner accepted for S7.1 and now wants gone. After this story, a product with no EAN takes the valid EAN of the first eligible row of its own, on a new join or, on the next ordinary import, from a row already stored; the S12.2 wall and the approval and hide rules keep it from publishing or leaking anything.

## Scope

In:

- The fill rule: who fills, when, which row wins, what is written (D-1, D-5).
- The row's eligibility: shop, feed and offer approvals, hide and review, and the collected wall (D-2, D-3).
- The refusals: another product already holds the EAN, an invalid or absent EAN, an EAN already on the product (D-4).
- The one-line import output `  ean: filled=<n>` (D-6).
- The amendments to 0008, the owner's guide, `CLAUDE.md` and the pointers in US-7.1 and US-12.2, in the same pull request (D-11).
- The proof at unit and integration level, including the tests that today assert the limit (D-10).

Out, nearest first (listed so a lane does not do them here):

- A backfill command, a migration, a re-match or merge of stored products and offers, and an admin screen to edit an EAN (D-12).
- A brand alias (S7.3) and an admin matching queue (S7.2), both deferred.
- Any new screen, route, copy, verb, argument or environment setting. The screens that already render an EAN are proven by integration read tests (D-9); there is no ux phase.
- A browser test, and any edit of decision 0006 (D-10).
- Printing a refusal, or listing a fill row by row (D-4, D-6).
- Writing any product field other than the EAN, or changing an EAN once set.
- The technical contract: where the fill is decided, the matcher's and importer's shapes, how the holder is looked up and what the same-run read costs, how the count is carried, SQL and file layout (the tech lead's).

## Acceptance criteria

"A row" is a row of a feed `import-feeds` imports; a feed that is not approved is never imported (`CLAUDE.md`). "An eligible row" is a row that passes ACs 4 to 7 and the wall of ACs 8 to 11. "Marked" is as in US-12.2: the row comes from a collected feed, the product was created from one. "Fill" means the product's empty EAN is set. "The EAN written" means the two values creation writes today: the row's cell trimmed and as written, and its digit-only form. "A holder" is a product, hidden ones included, that carries the row's EAN and that the row's matching lookup can see (an unmarked row sees unmarked products only; a marked row sees all). "Public now" is as in US-2.4. Each AC ends with how it is checked; "integration" means the database-backed suite and "unit" the database-free one. Copy in these ACs is intent only.

When the fill happens (D-1)

1. A new offer whose row carries a valid EAN and joins, by brand and part number, a product that has no EAN gives that product the EAN written, when the row is eligible and no other product holds that EAN. Checked by integration.
2. A known offer (already stored for its feed and external id) whose row carries a valid EAN, on a product that has no EAN, gives that product the EAN written on an ordinary `import-feeds`, when the row is eligible and no other product holds that EAN. This is the only backfill: products stored before this story fill the same way, with no command, no migration and no re-match. Checked by integration, with a product and an offer stored before the import runs.
3. When a row is not eligible on one import and becomes eligible on a later one, the later import fills (for example a shop approved between the two imports). Checked by integration: import with the shop unapproved, then approve, then import again.

First wins, and two EANs (D-5)

4. Two new rows of one import, or of two imports, for one EAN-less product with the same valid EAN: the first eligible row fills, and the second attaches to that product by EAN as any row with that EAN does. Checked by integration.
5. Two new rows for one EAN-less product with different valid EANs: the first eligible row in import order fills the product, and the second becomes its own product with its own offer and one `  record <n>: own_product brand_part_number_ean_conflict` line, as S7.1 AC 15 already ruled for a product that has an EAN. A known offer whose row carries a different EAN than the one the product now holds is not re-matched: it stays on its product, nothing changes and nothing is printed. Checked by integration, both orders of the two rows, plus the known-offer case.

The approval and hide gate (D-2)

6. A row fills nothing, on a new join and on a known offer, when any of these holds, and the offer is stored or updated exactly as today: its shop is not approved; its feed is not approved; its offer is hidden; its offer is in review; and (this AC moves on OD-1) the product it sits on is hidden. A hidden product keeps no new EAN, stays hidden, and an unhide publishes nothing by itself. Checked by integration, one case per condition and a repeat import after the shop is approved, where the row fills (AC 3).
7. A fill never sets, clears or moves an approval, a hide, a review flag or a category, and never changes whether the product or its offers are public now: before and after a fill, the product is public under the same rule and no other. Checked by integration.

The collected wall (D-3; US-12.2 ACs 28, 29, 31, 32 kept)

8. A marked row fills a marked product it joined or already sits on, when it is otherwise eligible. Checked by integration, two collected feeds whose rows share a brand and part number and no EAN, and a later row with an EAN.
9. A marked row that joins or sits on an unmarked product fills nothing, on the join and on every later import, and the offer joins as an offer only (US-12.2 AC 29). The public page of that product with the local flag off, and its public search results, are the same before and after the import: no EAN row, no `gtin`, and a search for the marked row's EAN does not find it. Checked by integration, the public product reader and public search read before and after.
10. An unmarked row never gives a marked product an EAN. An unmarked row cannot join a marked product (US-12.2 AC 28, unchanged), so this holds for a new row by becoming its own product, and for a known offer by there being no such offer. Checked by integration, in either import order.
11. With the local flag off, the EAN a marked row gave a marked product appears on no public surface and the product is not found by it in search (US-12.2 ACs 15 to 19 hold). The flag decides only what is shown; it never decides whether a fill happens. Checked by integration, the same fill with the flag on and off.

Another product holds the EAN (D-4)

12. When a holder exists, the row fills nothing: the offer stays on its product, no product is merged, moved or created, and nothing is printed. A hidden product counts as a holder. Checked by integration, for a known offer on an EAN-less product while another product holds the EAN, and for a holder that is hidden.
13. A holder is a product the row's own matching lookup can see: for an unmarked row a marked product does not exist and never blocks a fill; for a marked row an unmarked holder does block one. Checked by integration, both directions.

Invalid, absent and already set

14. A row with no EAN fills nothing. A row with a present but invalid EAN is rejected as `invalid_ean` before matching, as today, so it stores no offer and fills nothing, for a new row and for a known offer's row. Checked by integration.
15. A product that already holds an EAN never has it changed or cleared by any import, whatever EAN any row carries and whether or not a row carries one; a known offer whose row has no EAN or another EAN changes nothing but the offer's price and date. Checked by integration.
16. A fill changes nothing on the product except its EAN: not its title, brand, part number, either normalised value, description, slug, category, hidden flag, collected marker or creation date; no offer is re-matched or moved, and the row's own offer is written as it is today. Checked by integration: the stored product row before and after is identical in every column but the two EAN columns.

The import output (D-6)

17. For a feed whose import filled `n` products, with `n` above 0, the import output has one extra indented line `  ean: filled=<n>`, counting products filled in that feed's import, in addition to everything printed today. The line carries no row text, no EAN, no product and no record number. Checked by integration, on the formatted report.
18. For a feed whose import filled no product, the output is unchanged byte for byte, whether the row was refused, ineligible, already set or absent. Checked by integration, on the formatted report.
19. The line never changes the exit code: exit 1 still means a feed failed and nothing else. Checked by integration, a run that fills and a run that fills and also has a failed feed.

Repeat imports

20. Running `import-feeds` again over the same files changes nothing but prices and dates: nothing is filled again, no `  ean:` line is printed, no product or offer is created or moved, and every refusal of AC 6, 9, 12 and 15 prints nothing again. Checked by integration. (The first ordinary import after this story ships may fill, by AC 2; US-7.1 AC 21 holds from the second import on.)

What the visitor and the admin see

21. After a fill, the public product page of a product that is public now shows the EAN in its details, its structured data carries `gtin` when the EAN is a valid GTIN, and a public search by that EAN, written plainly or with spaces or hyphens, finds the product; the admin product list and detail show the EAN and the admin search by EAN finds it. Checked by integration, through the public product reader, the public search reader and the admin readers, not through the browser.
22. A filled product's offers, prices, shop order, lowest price and shop count are unchanged by the fill itself: every price is its own offer's integer cents in EUR, IVA included (guardrail 4). Checked by integration.

What stays as it was

23. `parseEan`, `normalizePartNumber` and `normalizeBrand` give the same results as before; the EAN step and the brand and part-number step decide where a new row goes exactly as today, and the four `own_product` reasons print as today, with AC 5 the only new case in which a row is listed. Checked by unit (`tests/unit/matching.test.ts` unchanged and passing) and by the existing integration matching suites, rewritten only where AC 24 names.
24. S7.1 ACs 10 (the EAN part), 14 (the "product keeps no EAN" part) and 22 (a known offer's product may gain an EAN) are superseded by this story and their tests are rewritten, not loosened (see § Test plan). Every other S7.1 AC and every S12.2 AC holds.
25. The demo data is unaffected: the demo product page still lists two shops cheapest first and a second `import-feeds` changes nothing but prices and dates. Checked by the existing demo-data test and the unchanged e2e run; the design pass re-checks the demo feed files for any brand and part number group that mixes rows with and without an EAN.
26. No command, argument, environment setting, admin screen, public route, copy or migration is added or changed. The only changes a user can see are the EAN on the existing product page, structured data, search and admin lists, and the output line of AC 17. Checked by review of the diff.

Done when, in the same pull request (D-11)

27. `docs/decisions/0008-product-matching.md`: the header amendment line records S7.6 with the owner's ruling and the run id; the sentence "Attaching never changes the product's text, so a product that converged a row carrying an EAN still has no EAN..." is replaced by the fill rule and its limits; the Consequences line "a product's title, brand, part number, EAN and description are written once" keeps the other four and states the EAN exception; the line on stored offers and re-matching keeps "never re-matched" and adds that a known offer may fill an empty EAN; the line on a conflict leaving two products with one EAN notes that a fill creates none; the note on an approved feed converging onto a product left by a disabled feed states that the fill is gated by the row's own approvals. Checked by review.
28. `docs/feeds/catalogue-file.md` (the `ean` column, the convergence limits and "never changes ... EAN" bullet, "never re-matched", the before-the-first-real-import notes, the summary line, and the import-output section for the `  ean:` line), and `CLAUDE.md` (the Stack "Matching" line, subject to OD-2; the "Not done" paragraph; the Collected file "What the flag does" paragraph, stating that a marked row never fills an unmarked product; the `import-feeds` row, stating the `  ean: filled=<n>` line and that it never changes the exit code) state the rule as built. Checked by review.
29. `docs/product/stories/US-7.1-match-brand-part-number.md` (ACs 10, 14, 22 and its note on products already in the local database) and `US-12.2-collected-data-local-only.md` (AC 29) each carry a pointer to this story. US-12.2 AC 29 is not reworded. Checked by review.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- where the fill is decided (the matcher, the importer's loop, or a helper), the shapes it takes and returns, and whether a pure decision is extracted for a unit test;
- how the holder lookup keeps the same visibility the matching lookup has, so AC 13 holds by construction, and whether the known-offer path adds a per-row read of the product's EAN or approvals and what that costs in the import's budget; the design lane may split the known-offer path (AC 2, 3, 20) into a second story, which then returns to the owner (D-8);
- how "an earlier row of the same import sees the fill" is kept true inside the import transaction (ACs 4 and 5);
- how the row's shop and offer state reach the importer, which already reads the feed;
- how the count of AC 17 is carried to the report and where its line sits relative to the others;
- whether any migration, index or constraint is needed; none is required by this story, and no uniqueness may be added, because stored databases may hold two products with one EAN (0008);
- whether the tickets stay as drafted below.

## Test plan

Unit and integration only. **No browser test is added and the e2e count stays 75**; the existing e2e run is expected to pass unchanged (AC 25). Names, counts and files are the test lane's after the design.

| ACs | Check |
|---|---|
| 1 to 5 | integration, extending `tests/integration/importer-brand-part-number.test.ts` and `importer-matching.test.ts`: a fill on a new join; a fill from a known offer on the next import, with a product and offer stored beforehand; a fill after a shop is approved; two rows with the same EAN and with two EANs, both orders; a known offer carrying a different EAN |
| 6, 7 | integration: one case each for unapproved shop, unapproved feed, hidden offer, offer in review, hidden product (OD-1); the product's public state compared before and after |
| 8 to 11 | integration, in the pattern of `tests/integration/collected-import.test.ts` (the AC 28, 29, 31 blocks): marked on marked, marked on unmarked with the public product reader and public search read before and after, unmarked never on marked, flag on and off |
| 12, 13 | integration: a holder that is visible, hidden, marked (for an unmarked row) and unmarked (for a marked row); the offer, product count and output after |
| 14 to 16 | integration: no EAN, invalid EAN (new and known), an EAN already set against another EAN and none, the stored row compared column by column |
| 17 to 20 | integration on the formatted report: the line present with `n` above 0, absent otherwise (byte comparison with a run that fills nothing), the exit code with and without a failed feed, a repeat import |
| 21, 22 | integration through the public product reader, the structured data builder, the public search reader and the admin readers; prices as integer cents |
| 23 | unit: `tests/unit/matching.test.ts` unchanged and passing; any pure fill decision the design extracts gets a unit test beside it |
| 25 | the existing demo-data test and the unchanged e2e run |

**Existing tests this story changes by design, not loosens** (they assert the limit this story lifts):

- `tests/integration/importer-brand-part-number.test.ts`, block "a convergence changes no product text (AC 10)": the stored row stays identical in every column except the EAN, and the second feed's EAN now fills; a control case keeps the other text columns identical.
- the same file, block "an EAN on one side only (AC 14)": the test where a valid EAN converges on the key holder that has none now asserts the fill; the test "a later row with that EAN and the same key reaches the same product, through the key" now reaches it by EAN; the first test (EAN on the product, none on the row) is the control and stays.
- the same file, block "a repeat import and what is already stored (AC 21, 22)": **not changed** (D-23). The S7.1 AC 22 test's rows carry no EAN, so it passes as it is and "an offer keeps the product it has" stays. The known-offer fill and AC 20's quiet repeat are new coverage in `tests/integration/importer-ean-fill.test.ts` (ACs 2, 3, 6, 15, 20).

The test lane also audits, and says which it changed and why, every other test that joins an EAN-bearing row to an EAN-less product and then asserts the EAN stays empty: `tests/integration/importer-matching.test.ts`, `tests/integration/catalogue-file-import.test.ts` (the S7.1 convergence tests around its `ROW_A` and `ROW_B`), `tests/integration/collected-import.test.ts` (the AC 28 and 29 blocks, which must keep passing as written for AC 9), and the fixtures with EAN-less rows (`no-ean.csv`, `empty-cells.csv`, `category-*.csv`, `price-edge.csv`, `xml-*.xml`).

Notes for the test lane:

- New fixtures are the test lane's. A product with a holder, or a hidden or marked product, is set up through the support helpers (`storedProduct`, `insertProduct`, `aFeedOf` with `sourceType: 'collected_file'`), not through an import, where the import cannot reach that state.
- The unit, integration and support test files do not read the clock (`CLAUDE.md` § Time in tests).
- No test touches a network, a feed URL or a real file outside the fixtures.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the owner approves this story and rules OD-1 and OD-2; a design pass (tech lead) fixes the contract, which fires because the matcher, the importer and the import output cross files; there is no ux pass (D-9). The design pass may merge, split or resize the tickets, and may split the known-offer path into a second story (D-8). The issue numbers are #390, #391 and #392, in that order. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T7.6.1 backend. The fill, its gates and the output line.** The fill on a new join and from a known offer, the eligibility gate (shop, feed, offer, product hidden per OD-1), the collected wall, the holder refusal, first wins, nothing but the EAN written, the `  ean: filled=<n>` line and the exit code, and the by-design rewrites named in § Test plan, so the suite is never red between the backend change and the tests it reverses (the precedent of D-12 of run `2026-11-22-s7-1-matching`). ACs 1 to 20, 23, 26. Size M.
2. **T7.6.2 test. The new coverage and the fixture audit.** The integration and unit coverage of § Test plan beyond the three rewritten blocks, the read tests of AC 21 and 22, the audit of the other tests and fixtures, and the demo-data check of AC 25. Needs T7.6.1. Every AC; coverage per the plan. Size M.
3. **T7.6.3 docs. The amendments in the same pull request.** 0008, the owner's guide, `CLAUDE.md` and the pointers in US-7.1 and US-12.2, reconciled from the actual diff at close-out. Needs T7.6.1 and T7.6.2. ACs 27 to 29. Size S.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- Everything named in ACs 27 to 29. Nothing else is expected to change: `docs/product/mvp.md` § Matching ("EAN first, then brand + part number" stays true), decision 0017 (a marked row writes nothing new to an unmarked product) and decision 0006 (out of scope; its 75-test wording goes in the #382 and #383 pull request).
- The backend and testing packs, for the conventions this story sets (where the fill is decided; how a known offer's product is read).
- Not read by the drafting lane, for the design lane to open: the elided lines 8, 30, 64 and 170 of US-7.1, which may state the limit; `messages/es-ES.json` for any EAN copy beyond the two labels; the migration SQL for a hand-added unique index on the EAN (the schema shows none).
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **A first import after this ships may change products.** By AC 2, a stored EAN-less product whose offer's row now carries an EAN fills on the next ordinary import, and the output says `  ean: filled=<n>`. That is the backfill the owner asked about; it needs no command. It also means the first import after approving a new shop is the one that fills from it (the usual first import runs with the shop unapproved, so it fills nothing).
- **The order of rows decides which EAN a product keeps.** It is import order and feed order, the same first-wins rule 0008 uses for text. A second, different EAN becomes its own product with a visible line (AC 5) only for a row new in that import; a known offer with a different EAN stays where it is and prints nothing.
- **A file edit now acts.** If the owner edits a file to add an EAN to a row whose product has none, that product fills on the next import, under the same rules.
- **Guardrail 1 is met by the gate, and one tension stays visible.** An EAN written from a row of a not-yet-approved shop would sit on a public product with no admin way to clear it; AC 6 prevents it. OD-1 asks the same question for a hidden product.
- **Duplicate EANs across the wall already exist today** (an unmarked row creates a product with an EAN a marked product holds), so the fill adds no new class of duplicate.
- **If an EAN is wrong, the fix is a hide.** No admin screen edits an EAN and none is added (D-12). A wrong fill is permanent until a later decision gives the admin a way to clear it.
- **Taken on trust, from the recon and the brief, not opened by the drafting lane:** the line numbers of 0008, the guide and `CLAUDE.md`; the exact current assertions in the three test blocks (opened: the AC 10, AC 14 and AC 21 and 22 blocks of the S7.1 test, and the importer's known-offer branch); that a new offer is never in review and that hiding a product marks its offers hidden (US-2.4, not re-read).
