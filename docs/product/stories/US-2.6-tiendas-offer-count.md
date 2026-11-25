# S2.6 The /admin/tiendas offer count says what it counts

Status: **draft, 2026-11-25, for the owner's approval.** Nothing below is ruled yet. OD-1 to OD-6 block ticketing; OD-7 blocks the build go only. The ACs are written on the recommended answers and each OD names the ACs that move if the owner rules otherwise. Board status follows the human's own move.
Epic: E2 (#10) · Iteration: not read · Priority: P1 (set by the owner) · Size: S proposed by the owner; this draft is the upper end of S (backend S, frontend S, test M), see § Notes for the human for what to cut
Issue: #373 · Tickets: T-2.6.1 to T-2.6.3 (described below; the orchestrator files the issues)
Depends on: S2.5 (#344, shipped in #372: the visibility module's rule tables and the "on the site now" meaning of an offer row), S3.3 (#28, offer removal, decision 0018; shipped), S12.2 (#306, collected rows and the local flag; shipped) and S2.4 (hide; shipped). No open dependency.
Blocks: nothing.
Source: issue #373 (the owner's sketch; the issue body itself was not readable when this was drafted, so its claims are taken from the S2.5 story's OD-3 and from the code, below); `US-2.5-admin-not-public-reason.md` (OD-3 split this story out; its "on the site now" meaning and ACs 7, 16 and 26); `docs/decisions/0018-offer-removal.md`; `docs/decisions/0017-hand-built-and-collected-feeds.md`; `docs/decisions/0006-quality-gate.md` rules 9 to 15; `docs/product/mvp.md` § Admin area and § Visibility; guardrails 1, 2 and 3. Run `2026-11-25-373-tiendas-offer-count` (its read-only recon found all five claims of the issue true against the code; pruned). I opened these myself and what I state about them is first hand: `src/server/admin/sources.ts` (types and the read, lines 40 to 215), `src/server/visibility.ts` (the rule tables and the reason SQL), `src/app/admin/(shell)/tiendas/page.tsx` (the feed and shop views, lines 40 to 175), the `Admin.Sources`, `Admin.Categories` and reason lines of `messages/es-ES.json`, `src/server/admin/category-mappings.ts` (line 201) and `src/app/admin/(shell)/categorias/page.tsx` (lines 84 to 96), `tests/unit/seams.test.ts` (lines 118 to 150), `tests/unit/admin-copy.test.ts` (lines 100 to 190), `tests/e2e/admin-smoke.spec.ts` (lines 40 to 75) and `tests/integration/admin-sources.test.ts` (lines 240 to 296). The other test files named below were taken from the recon and not opened by me. There is no story file for S2.3, the story that first put the count there; its intent survives only in the type comment of `sources.ts` and in S2.5 OD-3.

## Standing constraints

These bind this story and everything built from it.

- **What the count says today.** `/admin/tiendas` shows "N ofertas" on each feed and each shop. N is every stored offer row of the feed, with no filter (`src/server/admin/sources.ts`, a left join of feeds to offers with no condition; a shop's N is the sum of its feeds'). It therefore includes offers removed by an import, hidden offers, offers in review, collected offers and offers of an unapproved shop or feed, and nothing on the page says so. After S2.5 the product screens say one reason per row, and the count there matches no list of rows.
- **A count explains; it never changes the rule.** The story adds no condition to the public visibility rule and removes none. Every public page, the sitemap and `/go/<offer>` answer exactly as before (guardrail 1).
- **The "on the site now" meaning is S2.5's, not a new one.** An offer is on the site now when the public product page for its product lists it. The story reuses that meaning for a count rather than defining a second one.
- **The removed flag stays fenced.** Only the visibility module, the schema, the seed and the importer may name it (`tests/unit/seams.test.ts`; decision 0018: the importer is its only writer). `src/server/admin/sources.ts` is in the seam test's own list of files that must be reported if they name it. The story does not loosen that fence (OD-5). "Computed in the visibility module" is the requirement; how is the tech lead's.
- **A count is a number, not data.** It shows no id, file name, address or token (guardrails 3 and 5). Collected rows are counted for the admin on the admin page as they are today; the page is admin-only and no collected row or its content reaches a public page (guardrail 2).
- **Admin screens are judged on function and copy only.** No phone width and no visual polish check (the owner's standing rule for admin screens).
- **Tests follow decision 0006 rules 9 to 12.** Each behaviour is proved once, at the lowest level that can observe it. The story adds no browser test (§ Test plan).

## Open decisions

OD-1 to OD-6 block ticketing until the owner answers; OD-7 blocks the build go. Each carries a recommendation and the ACs that move.

1. **OD-1. One number or two, and what each says.** Today there is one number and it matches nothing the admin can see. Recommendation: **two numbers on every feed and shop line.** The first, "ofertas", is the offers the feed currently has (OD-2 settles which states). The second, "en el sitio", is the offers of it that are on the site now, by the S2.5 meaning. Reason: the admin has two real questions and they have different answers. After the catalogue-file steps in `CLAUDE.md` (import first, review `/admin/productos` and `/admin/categorias` while nothing is public) the first number is what tells the admin that the import worked, and it is not zero; the second is what the admin cares about before approving the shop, and it is zero until both approvals, a mapped category and no hide. A single "on the site" number would read 0 on every feed in review, and the admin could not tell an empty import from an unapproved one. A single "current offers" number would stay unequal to the site, which is the issue's complaint. Weakness: two numbers on a line; the UX pass decides how they read. Alternatives: (a) one number, on the site now: ACs 7 to 11 and 17 go. (b) One number, current offers, with a clear label: ACs 12 to 18 and 22 go. Either is smaller; each leaves one of the two questions unanswered.
2. **OD-2. Which states count in each number.** Recommendation. First number: counts every offer the feed has that an import has not removed; counts hidden offers, offers in review and offers of a collected feed; ignores shop and feed approval. An offer removed by an import is not counted (decision 0018: it is a row the last import's file no longer had), and is counted again if a later import has it. Second number: the offers that read Yes on `/admin/productos/[id]`, so a removed, hidden, in-review or collected-while-hidden offer, an offer of an unapproved shop or feed, and an offer of a product that is not on the site (no category, hidden product) are not counted; a demo feed's offers are counted (demo is not a cause, `src/server/visibility.ts`). Reason: the first number then says "what this feed holds now" and the second "what the site shows"; the gap between them is what S2.5's reasons explain row by row; and neither number needs a rule of its own, because the second is the existing public rule and the first differs from the old count in one state only, removed. Alternatives: (a) the first number also counts removed offers (the old meaning with a label): the admin sees a count the file no longer supports, and a feed that lost its whole file still shows a large number; (b) the first number leaves out hidden offers: the admin who hid 50 rows sees the feed shrink, and a hide is reversible and not the feed's doing. The collected offers are counted in the first number with the local setting on or off, because the number says what the feed holds and not what the site shows; the alternative, hiding collected counts while the setting is off, makes a collected feed look empty to the admin who just imported it.
3. **OD-3. The meaning of "has offers" on `/admin/categorias`.** That screen reads the same count as a yes or no, to choose between "this feed has no offers imported yet" and "this feed brings no category" (`src/server/admin/category-mappings.ts` line 201; `categorias/page.tsx` lines 88 to 95). Recommendation: **it keeps its meaning, "the feed has at least one offer row, whatever its state", and is not tied to either new number.** Reason: "never imported" is true only when no offer row was ever stored; a feed whose offers were all removed by an import was imported, and reading it as "never imported" would be false and would send the admin to run an import that already ran. This also keeps `/admin/categorias` out of the change. Alternative: it follows the first number, so a feed with only removed offers reads "never imported"; AC 23 changes.
4. **OD-4. The two "paused" notes on `/admin/tiendas`.** The page states two causes by hand, apart from the visibility module: a feed approved in an unapproved shop ("En pausa: la tienda no está aprobada...", also reused on `/admin/categorias`), and on a shop either "unapproved shop, some feed approved" or "approved shop, feeds, none approved" (`tiendas/page.tsx` lines 55, 82 and 118 to 126). They agree with the rule today. Recommendation: **keep their conditions and their words, and prove they agree with the shared rule and with the new second count.** The reason lines S2.5 wrote are sentence fragments for an offer or a product row ("la tienda no está aprobada. Se aprueba en Tiendas y feeds."), and do not fit as the note of a shop or a feed; and the shared rule has no feed-level or shop-level reason to switch to, only offer and product ones. What the notes need is not to drift from the rule, and a test that compares each note with the offer reason of S2.5 does that for the cost of a test. Alternatives: (a) leave the notes alone and untested, as S2.5 left them: two hand-written copies of a rule stay, and the next change to the rule is not caught; (b) replace the notes by the shared reasons: needs a new feed-level and shop-level reason in the visibility module and its copy, which is its own story. ACs 20 to 22 move under (a) and (b).
5. **OD-5. The seam fence on `sources.ts`.** `tests/unit/seams.test.ts` lets `sources.ts` name the approval, hidden and review flags (its two writers) but not the removed flag, and lists `sources.ts` among the files a planted removed-flag name must be reported in. Recommendation: **the fence stays exactly as it is; the filtered counts come through the visibility module, which already holds the removed flag and the offer rule table.** Reason: the rule is that one module decides what is public; a second file that names the flag is a second place where "removed" could be forgotten, and decision 0018 makes the importer the flag's only writer. Alternative: allow `sources.ts` to name the flag, with the seam test edited. That is cheaper to write and weakens the rule the public site relies on; it needs the owner's explicit call. AC 27 changes.
6. **OD-6. The copy pins stand.** The new lines must pass the pins of `tests/unit/admin-copy.test.ts` unchanged: the scan of the whole `Admin.Sources` block finds no sentence that says offers appear or are shown unless it is negated or conditional ("ya están en el sitio", "visibles", "publicadas" and "se muestran" are the phrases it looks for). "N en el sitio" is a statement of state and passes. Recommendation: no pin changes; a label the UX pass cannot word inside them is a stop for the owner, not an edit to the pin by a lane. AC 24 holds under it. This repeats S2.5 OD-4 for the same reason.
7. **OD-7. The exact-shape assertions of the sources tests (blocks the build go, not ticketing).** `tests/integration/admin-sources.test.ts` (lines 262 to 294) pins the shop and feed shapes by sorted key list and by value, and `admin-source-writers.test.ts` and `collected-feed-admin.test.ts` pin `offerCount: 0` on new rows. If the design adds a second count to those shapes the assertions gain a key; the three-offer fixture (one visible, one hidden, one in review) also gets new expected values. Recommendation: allow it, as the owner allowed the same for S2.5 (its D-10): no assertion is loosened or removed, and the test report lists every edit. It is asked after the design pass, once it is known whether a key is added or the meaning of the existing one changes.

## Story

As an admin, on `/admin/tiendas`, I read for each feed and each shop how many offers it currently has and how many of them are on the site now, each labelled in words, so that the number I see matches what I find on the product screens and I can tell an empty import from one that is waiting for an approval, a category or a hide.

Today the line says "3 ofertas" for a feed whose file has 3 rows, one of them hidden and one removed by the last import, on a shop that is not approved. The admin who then opens `/admin/productos` finds no 3 anywhere, and the page that sets the number cannot say what it counted. After this story the line says what each number counts.

## Scope

In:

- The count on each feed row and each shop group of `/admin/tiendas`: what it counts (OD-1, OD-2) and the words that label it.
- The two paused notes on the same page, kept as they are and proved to agree with the shared rule and with the new count (OD-4).
- What `/admin/categorias` reads from the count: its meaning kept as it is (OD-3).
- The copy for the new labels, in the admin message section, inside the existing pins (OD-6).

Out, nearest first (listed so a lane does not do them here):

- A count of removed offers, a count per cause, a breakdown of the gap between the two numbers, or a link from a count to the offers behind it. The reasons per row are S2.5's.
- A count on `/admin/productos`, `/admin/categorias` or any page other than `/admin/tiendas`.
- A reason at feed or shop level, or replacing the notes by the S2.5 reasons (OD-4, alternative b).
- Any change to the public visibility rule, the sitemap, indexing, `/go`, the importer, the matching rule, approvals, the category mapping screen, the hide writers, or the seam test (OD-5).
- A new admin page, a button, a filter, or any editing control.
- Phone widths and visual review of the admin screens.
- The technical contract: names, types, query shapes, where the counting lives beyond what an AC observes, whether a second field is added or the existing one changes meaning, and how the seam test is edited if at all (the tech lead's); the screen layout and the Spanish wording (the UX pass's).

## Acceptance criteria

"The admin" is a signed-in admin. An offer is **on the site now** when the public product page for its product lists it; it is the same test as an offer row that reads "Sí" under "En el sitio ahora" on `/admin/productos/[id]` (S2.5). An offer is **removed** when the last import of its feed no longer had it (decision 0018). The **first count** is the offers the feed currently has; the **second count** is its offers on the site now (OD-1). "Copy" in these ACs is intent only; the wording is the UX pass's. ACs are written on the recommended answers; each OD names the ACs that move.

Where the counts show

1. Each feed row of `/admin/tiendas` shows the first count and the second count, each with a label in words.
2. Each shop group shows the first count and the second count, each the sum of the same count over its feeds, and a shop with no feeds shows 0 for both.
3. A count of zero is shown as the number 0 with its label, never blank, a dash or left out, for either count.
4. A count of 1,000 or more is shown with its thousands separator on either count, as the first count is today (`1.234`).
5. Each label says in words what the number counts, in the page's own first response, and not only by colour, icon, tooltip or position.
6. No label and no note says or implies that approving, mapping or unhiding makes offers appear (guardrail 1; the second count states what is on the site now as a fact and promises nothing).

The first count: the offers the feed currently has (OD-1, OD-2)

7. The first count of a feed is the number of its offers that an import has not removed.
8. The first count does not depend on approval: a feed or shop that is not approved, with offers imported, shows its imported number and not 0.
9. Hidden offers and offers in review are counted in the first count.
10. An offer removed by an import is not counted in the first count, and is counted again once a later import has it.
11. Offers of a collected feed are counted in the first count whether the local setting is on or off.

The second count: the offers on the site now (OD-1, OD-2)

12. The second count of a feed is the number of its offers that are on the site now.
13. An offer is not counted in the second count while its shop is not approved, its feed is not approved, an import removed it, an admin hid it, or it is in review.
14. An offer is not counted in the second count while its product is not on the site: the product has no category, is hidden by an admin, or was created from a collected row while collected rows are not shown.
15. The offers of a collected feed follow the same reading of the local setting as the public rule, including its backstop: they are not counted while collected rows are not shown, and with the setting on at a loopback `SITE_URL` they are counted when nothing else excludes them (the modes of `tests/support/local-flag.ts`; S2.5 AC 26).
16. The offers of a demo feed are counted in the second count like any other: demo is not a cause.
17. The second count of a feed is never greater than its first count.
18. For every state the tests build, a feed's second count equals the number of its offers that the public product pages list.

After a change

19. After an admin approves or disables a shop or a feed, hides or unhides a product or an offer, saves a category mapping, or an import runs, the next read of `/admin/tiendas` shows the counts that apply to the new state, with nothing kept from before.

The notes (OD-4)

20. A feed row shows its paused note exactly when the feed is approved and its shop is not, and a shop group shows its note exactly when it did before this story: the shop is not approved and at least one feed is, or the shop is approved, has feeds, and none is approved.
21. Wherever a note says the shop is not approved, an offer of that feed with no flag of its own reads "shop not approved" on `/admin/productos/[id]`; wherever a note says no feed is approved, such an offer reads "feed not approved".
22. A row whose note says its offers are not shown shows 0 as its second count.

`/admin/categorias` (OD-3)

23. On `/admin/categorias` a feed with no offer row at all reads "never imported", and a feed that has offer rows but brings no category reads "no categories", including when every one of its offers is removed, hidden or in review, exactly as before this story.

The page and its copy (OD-6)

24. Each new label comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing string, and passes the existing `Admin.Sources` pins of `tests/unit/admin-copy.test.ts` unchanged.

Nothing else changes

25. Opening the page changes no public page, sitemap file or `/go` answer: the existing public-side tests pass unedited.
26. The approval toggles, the confirmations, the create and edit links, the networks list and the empty state of `/admin/tiendas` behave as before, and their guards and logging are untouched.
27. No file outside the visibility module, the schema, the seed and the importer names the removed flag: the seam test of `tests/unit/seams.test.ts` passes unedited (OD-5).
28. The e2e snapshot of `/admin/tiendas` in `tests/e2e/admin-smoke.spec.ts` still matches unedited: the shop line keeps its feeds count first and the first count after it, in the order and words "N feeds · N ofertas" that its pattern matches.
29. If the read of the page fails, the admin sees the existing error screen and the log line is the fixed line and code of today.
30. The number of reads the page makes does not grow with the number of shops or feeds.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- whether a second count is a new field on the feed and shop or the existing field changes meaning, the field's name, type and where the counting lives; that the first count and the second come from reads that agree with the S2.5 meaning (AC 18) and keep the removed flag in the visibility module (AC 27);
- how `/admin/categorias` keeps its meaning (AC 23): which of the stored counts it reads, and whether the type comment of `sources.ts` says so;
- how the read stays bounded (AC 30), including a feed with many thousands of offers;
- whether the notes' agreement with the rule (ACs 21, 22) is a test only or also a shared condition;
- whether the three tickets stay as drafted.

Left to the UX pass (direction: change to an existing admin screen; `docs/design/system.md` may need a row): how the two counts read on the feed line and the shop line, the words of each label (OD-6), whether the second count is worded differently where it is zero for an approval or a hide, and what stays of the notes' wording.

## Test plan

Test files and names are the test lane's after the design pass. Coverage required, by behaviour, each proved once at the lowest level 0006 rule 9 allows (rule 10). Nothing here needs a browser.

| ACs | Level | Check |
|---|---|---|
| 2, 3, 7 to 18 | integration (database), in the pattern of `tests/integration/admin-sources.test.ts` | the read of shops and feeds: each state alone (shop not approved, feed not approved, removed, hidden, in review, no category, hidden product, collected, demo), a feed with no offers, a shop with no feeds, a restored removed offer; the first count over unapproved feeds; the second compared with `getPublicProductBySlug` and the public offer list for the same state (AC 18, as `admin-product-read.test.ts` already does for the Yes/No); the invariant that the second never exceeds the first; the shop sums |
| 15 | integration | the local-flag modes of `tests/support/local-flag.ts`: off, on at a loopback origin, and each backstop mode, for a collected feed |
| 19 | integration | the writers of S3.1, S2.4, S4.2 and the importer in the pattern of the existing writer tests: the next read after an approval, a hide, a mapping and an import shows the new counts |
| 20 to 22 | integration | every combination of shop and feed approval: the note present or absent as before, the note compared with the S2.5 offer reason for a flag-free offer of that feed, and the second count 0 where a note says offers are not shown |
| 23 | integration | `tests/integration/category-mapping-read.test.ts` and `category-mapping-page.test.ts`: a feed with no offer, a feed with only removed offers and no category, a feed with only hidden offers, each reads as before; the existing `hasOffers` assertions run unedited |
| 1 to 5 | integration | the real `/admin/tiendas` page rendered in-process (`tests/integration/admin-source-pages.test.ts`): both counts and their labels on a feed line and a shop line, a zero, a number of 1,000 or more, the labels as text |
| 6, 24 | unit | `tests/unit/admin-copy.test.ts` and `tests/unit/messages.test.ts` as changed by design: the new keys pass the pins unchanged, no promise sentence, the scan of `Admin.Sources` is still not vacuous |
| 27 | unit | `tests/unit/seams.test.ts` runs unedited |
| 25, 26, 28, 29 | integration, existing | the existing tests run unedited: `visibility.test.ts`, `hide-public-sweep.test.ts`, `sitemap.test.ts`, `admin-source-pages.test.ts` for the rest of the page, `admin-logs.test.ts`, and the e2e smoke of `tests/e2e/admin-smoke.spec.ts`; no new test is written for what already holds |
| 30 | integration | a read-count ceiling in the pattern of the existing cost tests (`category-fit-cost`, `sitemap-performance`): the same number of reads for one shop and for many |

Whether a browser test is needed: **no.** Every behaviour is observable by calling the loaders and the page in-process (rule 9, integration) or by scanning the copy (unit). The existing smoke of `/admin/tiendas` stays as it is and AC 28 keeps it passing; a count assertion in a journey would be a second proof of the same behaviour, which rule 10 allows only with a reason written in the story's test report. The e2e count added is expected to be zero.

Notes for the test lane:

- The existing fixtures to reuse are in `tests/support/catalogue.ts`, `setOfferRemoved` and `tests/support/hide.ts`; an offer in review has no real writer and is set directly, as `visibility.test.ts` does.
- The three-offer fixture of `admin-sources.test.ts` (one visible, one hidden, one in review on one feed) changes its expected counts under OD-1; the edit and the three `offerCount: 0` assertions of OD-7 are listed in the test report.
- The recon did not read `admin-source-actions.test.ts`, `admin-source-privacy.test.ts`, `seed.test.ts`, `catalogue-file-admin.test.ts` or `collected-feed-admin.test.ts` line by line for count assertions; the test lane greps them for the count before editing, and reports any it finds.
- The integration review states the measured `check`, integration, e2e and full-gate times against the budgets and the tests added and removed per level (0006 rules 14 and 15). No test counts or timings are promised here.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the owner approves this story and rules OD-1 to OD-6; a UX pass fixes the wording and the layout of the lines; a design pass (tech lead) fixes the contract, which fires because the read crosses the backend and the page and a second reader depends on it. The design pass may merge, split or rename the tickets. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T-2.6.1 backend.** The first and the second count for each feed and each shop, read with the S2.5 meaning from the visibility module (the removed flag stays in it), the read of `/admin/categorias` kept to its own meaning, a read count that does not grow with the shops and feeds, the type comments corrected to say what each count counts. ACs 2 (the data), 7 to 19, 22 (the data), 23, 25, 27, 29, 30.
2. **T-2.6.2 frontend.** The feed line and the shop line of `/admin/tiendas` with the two labelled counts, the two notes kept and agreeing with the rule, the copy keys from the UX pass. Needs T-2.6.1, the UX pass and the design pass. ACs 1 to 6, 20, 24, 26, 28.
3. **T-2.6.3 test.** The integration and unit tests of the plan, on the design pass's contract, the edits of OD-7, and a run of the existing tests named in ACs 25 to 29 unedited. Needs T-2.6.1 and T-2.6.2. Every AC; coverage per the test plan.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/product/stories/US-2.5-admin-not-public-reason.md` AC 35 and OD-3: a reconcile line that S2.6 changed the count and kept the two notes.
- `docs/product/mvp.md` § Admin area: the docs lane judges whether the admin's list of what it can see gains a line.
- `docs/design/system.md`: a row for the two-count line, from the UX pass.
- `messages/es-ES.json` admin section: the new copy, from the UX pass; `shopMeta` and `feedMetaOffers` are the lines that change.
- `agentic/capabilities/architecture.md` § The seams the product forces: whether the sentence on who may name the removed flag needs an example of a count read through the visibility module.
- `docs/decisions/0018-offer-removal.md` Consequences: judged by the docs lane; the importer stays the flag's only writer.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **What you will see.** A worked example on the recommendation: a catalogue file of 10 rows, imported, with the shop and feed approved; two rows have since gone from the file and were removed, one is hidden, and three belong to a product whose feed category is not mapped yet. The first count reads 8, the second 4. Before either approval, the same feed reads 8 and 0, with the note on a paused shop.
- **The first count changes for removed offers only.** A feed with no removed offers reads the same first number as today.
- **The categorias screen does not move.** It keeps telling a feed that was never imported from a feed that brings no category (OD-3).
- **The notes stay hand-written.** The two paused notes are proved to agree with the rule by a test, not generated from it (OD-4). A reason at shop or feed level is its own story.
- **Size.** The owner set S. This draft is the upper end of S. What to cut if it is too much: ACs 20 to 22 and the tests for them (OD-4 alternative a), which leaves the notes as S2.5 left them, or the choice of one number (OD-1 alternative a), which removes the first count and its states.
- **Counts and times.** No test counts or timings are promised: the integration review reports them against the 0006 budgets.
