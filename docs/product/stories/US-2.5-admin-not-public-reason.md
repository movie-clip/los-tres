# S2.5 Admin sees why a product or offer is not on the site

Status: **approved 2026-11-25 by the owner, shipped in #344's pull request.** The owner's rulings on OD-1 to OD-3 and on the 18 exact-shape assertions are in § Owner rulings; OD-4 to OD-6 stood as drafted. Board status follows the human's own move.
Epic: E2 (#10) · Iteration: not read · Priority: P1 (raised by the owner at the start of run `2026-11-25-344-not-public-reason`; the owner needs it to review real shop data on the local stack) · Size: M proposed (backend M, frontend S, test M; the board's size is the human's)
Issue: #344 · Tickets: #369 T-2.5.1, #370 T-2.5.2, #371 T-2.5.3 (described below)
Depends on: S2.4 (#25, the admin product screens, the hide writers and the "En el sitio ahora" line; shipped), S3.3 (#28, offer removal, decision 0018; shipped) and S12.2 (#306, collected rows and the local flag, decision 0017; its flag is in the code today). No open dependency.
Blocks: nothing.
Source: issue #344 as named by the run; the recon of run `2026-11-25-344-not-public-reason` (pruned; each claim it supported is stated below or cites the repo file it is about); `US-2.4-hide-products-offers.md` (OD-6 and Scope Out: reasons were left to "a later story and not a copy of the rule"); `docs/decisions/0018-offer-removal.md` Consequences (a removed offer "shows no reason", tracked in #344); `docs/decisions/0017-hand-built-and-collected-feeds.md`; `docs/decisions/0006-quality-gate.md` rules 9 to 12; `docs/product/mvp.md` § Admin area and § Visibility; guardrails 1, 2, 3 and 5. I opened `src/server/visibility.ts`, `src/server/admin/products.ts`, `src/server/admin/sources.ts` (lines 140 to 205), `src/components/admin/ProductState.tsx`, `ProductHideToggle.tsx`, the `Admin.Products` block of `messages/es-ES.json`, the pins of `tests/unit/admin-copy.test.ts` and the seam rules of `tests/unit/seams.test.ts` myself; the other test files named below were not opened by me.

## Standing constraints

These bind this story and everything built from it.

- **The reason is computed where the public rule lives.** The public rule is `src/server/visibility.ts` (two SQL conditions, one for an offer and one for a product); it returned no reason when this story was drafted. The reason is computed by that same module, so the admin screen and the public page cannot disagree (US-2.4 OD-6 and AC 10). `tests/unit/seams.test.ts` keeps every approval, hidden, review and removed flag name out of the admin files and is not loosened for this. "Computed in that module" is the requirement; how is the tech lead's.
- **A reason explains; it never changes the rule.** The story adds no condition to the public rule and removes none. Every public page, the sitemap and `/go/<offer>` answer exactly as before (guardrail 1; AC 34).
- **Demo is not a cause.** `src/server/visibility.ts` has no demo condition; a demo feed that is approved is public like any other (confirmed in the file). No reason is named for demo.
- **Review is an offer cause only.** Only offers carry a review flag and nothing writes it today (`src/db/schema/catalogue.ts:101`; a grep of `src` finds it read only in `visibility.ts`; US-2.4 OD-2). A product whose offers are all in review is non-public as a product with no offer on the site (OD-2). The reason exists and is tested with a fixture, but no real row can reach it until the matching-queue story.
- **Roles and logging as shipped.** No new page, route or action is added; the guards, role checks and the fixed log line of US-2.4 (its ACs 1 to 6 and 57) stand untouched (guardrails 3 and 5).
- **No offer or feed address anywhere in a reason.** A reason is a fixed line and shows no URL, id, file name or search term (US-2.4 AC 24).
- **Admin screens are judged on function and copy only.** No phone width and no visual polish check (the owner's standing rule for admin screens).
- **Tests follow decision 0006 rules 9 to 12.** Each behaviour is proved once, at the lowest level that can observe it, and the story adds at most one browser test and only if a journey needs it. It needs none (§ Test plan).

## Open decisions

All blocked ticketing until the owner answered. The owner took the recommendation on each (§ Owner rulings), and each is written below on it.

1. **OD-1. One reason, or every reason, when several causes hold; and in what order.** Several causes can hold at once on an offer (a shop and a feed both unapproved; a hidden offer of an unapproved feed) and on a product (no category and hidden). Recommendation: **one reason per row**, the first that holds in a fixed order, broadest scope first and an item's own flags after. Offer, in order: shop not approved; feed not approved; collected feed with the local setting off; removed by import; hidden by an admin; in review; and only when none of these holds and the product is not on the site, the product's reason. Product, in order: feed category not mapped; collected product with the local setting off; hidden by an admin; none of its offers on the site (OD-2). Reason: it is what the owner asked for ("the one reason"); the admin fixes one thing and the next one shows on the next read; the item's own hidden flag is still shown on its own line ("Oculto" or "No oculto", `Admin.Products`), so a hidden offer under a "feed not approved" reason is not lost; and it keeps the copy and the tests to a short list instead of every combination. Weakness: an admin with a new shop and a new feed, both unapproved, sees two screens' worth of reasons one at a time. The order follows the one precedence the admin code already has (the notes of `src/app/admin/(shell)/tiendas/page.tsx` put "shop not approved" first), and the order in which the code happens to list the conditions is not a precedence. Alternative: list every cause that holds. More to read, one visit is enough, and the copy and the tests grow with the combinations. ACs 22 to 25 move if the owner rules for "every reason" or changes the order.
2. **OD-2. A product with offers, none of them on the site: does the product's reason name why its offers are not?** Today that product is non-public only because of its offers (the product's own flags are fine). Recommendation: yes. The product row says that none of its offers is on the site and then names the reason that ranks first, by the order of OD-1, among its offers; a product with no offer at all says it has none. Reason: the owner's goal is to read the cause on the product row "without opening other screens" and the list has no offers on it; a bare "no offer is on the site" sends the admin to the product page for every row. Worked example: a product with an offer of an unapproved shop and a hidden offer reads "none of its offers is on the site: the shop is not approved". Alternative: the product row says only that none of its offers is on the site and the per-offer reasons are read on the product page. Simpler, and the list stays a list. ACs 20 and 21 change under the alternative.
3. **OD-3. The `/admin/tiendas` offer count, and the two "paused" notes there, are out of this story.** `/admin/tiendas` counts every offer of a feed, hidden, in review and removed ones included (`src/server/admin/sources.ts:163`, a left join with no filter; read by me), and says "N ofertas" with no qualifier; `src/server/admin/category-mappings.ts` also reads the count as "has offers". A real review will show a count there that no product row matches. Recommendation: leave it, and the page's two hand-written notes on paused shops and feeds. Reason: it is a different question (what the number counts, not why a row is hidden); `sources.ts` may not name the removed flag, so changing it is a seam change and a change to tests that pin the count (`admin-sources.test.ts`, `admin-source-writers.test.ts`); and the issue's outline does not ask for it. If the owner wants it, it is its own Backlog story, "the tiendas count says what it counts", and it would also replace the notes by the shared reasons. Under "in", a new AC and ticket are added and the story grows by one lane's work. Reconciled: the owner filed it as S2.6 (#373), shipped in #379; the count became two numbers through `visibility.ts` with the removed flag still fenced, and the two notes stayed hand-written.
4. **OD-4. The `Admin.Products` copy pins stand.** The reason copy must pass the existing pins in `tests/unit/admin-copy.test.ts`: the scan of every `Admin.Products` key finds no sentence that says something appears or is shown unless it is negated or conditional; no "visible", "público" or "publicado"; none of the words "mostrar", "publicar", "aprobar", "eliminar", "borrar"; `publicNowLabel`, the four hidden tags and the button names keep their exact text. This is feasible ("No se muestra: la tienda no está aprobada" passes; "Aprobar la tienda lo publica" does not and is false anyway). Recommendation: no pin changes. If the UX pass finds a cause it cannot say within the pins, that is a stop for the owner, not an edit to the pin by a lane. AC 31 holds under the recommendation.
5. **OD-5. Is the "in review" reason built although no real row can reach it?** Recommendation: yes. The public rule has the condition, guardrail 1 names the matching queue, and the cost is one fixture test and one copy line; leaving it out would make the first matching-queue story reopen this one, and an admin row would read "No" with no reason, which AC 5 forbids. Alternative: leave the offer review cause to the matching-queue story and let AC 5 carry a general reason until then. ACs 15 and 8 are the ones that change.
6. **OD-6. Does a reason only say what the cause is, or also where the admin can change it?** Recommendation: both, where an admin screen can change it: "the shop is not approved" with the place the shop is approved (Tiendas y feeds); "the feed category is not mapped" with Categorías; "hidden" with this row's own control; "removed by the last import" with that the offer comes back if a later import has it; "collected data" with the local setting. Reason: the owner reviews real shop data on the local stack and the next step is the point of the screen. It must not promise: a line that says approving makes the offer appear fails the pins and is false (a mapping or an approval alone publishes nothing, `CLAUDE.md` § Catalogue file). The wording is the UX pass's. Alternative: the cause only.

## Owner rulings

Recorded 2026-11-25, in the owner's words ("yes" to each question, taking the recommended answer):

- **OD-1 (one reason per row, in the recommended order).** "yes": one reason per row, the first that holds, in the order of OD-1 and ACs 23 and 24.
- **OD-2 (a product whose offers are all off names the first offer reason).** "yes": the product row names its offers' first reason by the order of OD-1.
- **OD-3 (the `/admin/tiendas` count and its two paused notes stay out).** "yes": out of this story; filed later as its own Backlog story.
- **Approval.** "yes": the story approved as drafted under OD-1 to OD-3, with 37 ACs and three tickets (T-2.5.1 backend, T-2.5.2 frontend, T-2.5.3 test) and no browser test.
- **The exact-shape admin assertions (build go).** "yes": AC 36 allows the 18 existing exact-shape assertions of the admin product tests to gain a `reason` key; none is loosened or removed, and the test report lists every edit.

OD-4 to OD-6 were not objected to and stand as drafted.

## Story

As an admin, on each product row and each offer row of the admin, I read the one reason it is not on the public site, for every cause the public visibility rule has, so that I can review real shop data without opening other screens or reading the code.

Today the product list, the product page and every offer row say only "En el sitio ahora: No" (`src/components/admin/ProductState.tsx`). An admin who has imported a real shop's file sees a column of "No" and has to work out, from the shop screen, the category screen and the hide flag, which one of up to seven conditions applies; and a removed offer reads as "not hidden, not on the site" with nothing to say why (decision 0018, Consequences). After this story every row that is not on the site says why, in one line, from the same rule the public site uses.

## Scope

In:

- The reason on each row of `/admin/productos` (the product list) that is not on the site now.
- The reason on the product block, and on each offer row, of `/admin/productos/[id]`, when not on the site now.
- Every cause the public rule has: for an offer, shop not approved, feed not approved, collected feed with the local setting off, removed by import, hidden by an admin and in review; for a product, feed category not mapped (no category), collected product with the local setting off, hidden by an admin, and none of its offers on the site (including having no offer).
- The reason shown after a hide or unhide is the one that applies after it, including in the action's answer that the row shows until the page re-reads.
- The copy for each reason, in the admin message section, inside the existing pins.
- A guard so that a condition added to the public rule cannot leave an admin row reading "No" with no reason.

Out, nearest first (listed so a lane does not do them here):

- A filter or a search by reason, a count of rows per reason, or a review screen for them (#344's nearest out). The list, its search, its hidden-only filter and its paging are unchanged.
- Any editing, bulk action, or control that fixes a cause from the row. A reason may name the screen where the cause is changed; it adds no link-and-fix control beyond what exists.
- The `/admin/tiendas` offer count and its two paused notes (OD-3).
- Any change to the public visibility rule, the sitemap, indexing, `/go`, the importer, the matching rule, approvals, the category mapping screen or the hide writers.
- A product-level review flag, a matching-queue writer or a review screen (US-2.4 OD-2; nothing writes the offer review flag).
- An audit trail of who changed what, or when a row became non-public.
- Reasons on any other admin screen (`/admin/categorias`, `/admin/tiendas`).
- Phone widths and visual review of the admin screens.
- The technical contract: how a reason is represented, how it is read, query shapes, types, function names, file layout and how the seam tests are edited (the tech lead's); the screen layout and the Spanish wording (the UX pass's).
- The correction of the stale e2e names in `agentic/capabilities/testing.md`: a docs follow-up of run `2026-11-24-339-e2e-reduction` carried in the same pull request by the close lane (run `plan`), not an acceptance criterion of this story.

## Acceptance criteria

"The admin" is a signed-in admin. A row is **on the site now** when the public site would show it at this moment: for a product, the public product page for its slug answers with the product; for an offer, the public product page lists it. A row **reads No** when its "En el sitio ahora" line says No. A **reason** is one line of words on the row that names why it reads No. "Copy" in these ACs is intent only; the wording is the UX pass's.

Where a reason shows

1. Each product row of `/admin/productos` that reads No shows one reason.
2. On `/admin/productos/[id]`, the product block shows one reason when the product reads No.
3. On `/admin/productos/[id]`, each offer row that reads No shows one reason.
4. A row that reads Yes shows no reason, and its text is what it was before this story.
5. No row reads No without a reason, whichever cause makes it so.
6. A reason is words in the page's own first response for that row, not behind a link to another screen, and not carried by colour, an icon or position alone.
7. For every state of a product and its offers that the tests build, a product row shows a reason exactly when the public product page for its slug does not answer with the product, and an offer row shows one exactly when the public product page does not list the offer.
8. A row that reads No for a cause none of the others here names still shows a general reason, never a blank line.
9. The reason is computed by the module that holds the public visibility rule, and no admin file names an approval, hidden, review or removed flag (the seam rule of `tests/unit/seams.test.ts` holds as it is today).

Offer causes (each alone; the order when several hold is ACs 22 to 25)

10. An offer of a shop that is not approved shows a reason that says the shop is not approved.
11. An offer of a feed that is not approved shows a reason that says the feed is not approved.
12. An offer of a collected feed, while collected rows are not shown, shows a reason that says collected data is shown only on the local site with the local setting.
13. An offer removed by an import shows a reason that says the last import of its feed no longer had it.
14. An offer hidden by an admin shows a reason that says an admin hid it.
15. An offer in review shows a reason that says it is waiting in the matching queue (OD-5).
16. An offer that is itself fine but belongs to a product that is not on the site shows that product's reason.

Product causes (each alone)

17. A product with no category shows a reason that says its feed category is not mapped.
18. A product created from a collected row, while collected rows are not shown, shows a reason that says collected data is shown only on the local site with the local setting.
19. A product hidden by an admin shows a reason that says an admin hid it.
20. (OD-2.) A product with offers, none of them on the site, shows a reason that says no offer of it is on the site and names the reason of the offer that ranks first among its offers by the order of AC 23.
21. A product with no offer at all shows a reason that says it has no offers, and the product page shows the existing empty state for its offers as today.

Several causes at once (OD-1)

22. A row shows exactly one reason, however many causes hold.
23. For an offer, the reason is the first that holds in this order: shop not approved, feed not approved, collected feed with the local setting off, removed by import, hidden by an admin, in review; and only when none holds, the product's reason (AC 16).
24. For a product, the reason is the first that holds in this order: feed category not mapped, collected product with the local setting off, hidden by an admin, none of its offers on the site (ACs 20 and 21).
25. The line that says whether an item itself is hidden (the "Oculto" or "No oculto" tag, and the feminine pair for an offer) keeps showing that flag whatever the reason is: a hidden offer of an unapproved feed shows the feed reason and still reads "Oculta".

The local setting

26. A collected row's reason follows the same reading of the local setting as the public rule, including its backstop: with the setting on and `SITE_URL` not a loopback origin, a collected row still shows the collected-data reason (the modes of `tests/support/local-flag.ts`).
27. With the local setting on and `SITE_URL` loopback, a collected row whose shop, feed, category and flags are all fine reads Yes and shows no reason.

After a hide or unhide

28. After the admin hides or unhides a product or an offer, the row shows the reason that applies after the change, or none if it now reads Yes, without a reload, and an unhide of an item that has another cause still shows that cause (an unhide publishes nothing by itself, US-2.4 AC 43).
29. After the page re-reads, every reason on the page, the product's and each offer's, is the one that applies, including an offer's reason that depends on its product's hide.

The page and its copy

30. Each reason's text comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing string, and each cause has its own line.
31. The reason copy passes the existing `Admin.Products` pins unchanged (OD-4): no sentence says something appears or is shown unless it is negated or conditional, none uses "visible", "público" or "publicado" or the words "mostrar", "publicar", "aprobar", "eliminar" or "borrar", and the exact texts the pins fix are unchanged.
32. No reason says or implies that a step of the admin, approving, mapping or unhiding, makes the item appear on the site (guardrail 1; US-2.4 AC 59).
33. A reason holds no id, URL, file name, search term or shop address, and names no table or column.

Nothing else changes

34. Opening either screen, and a hide or unhide, change no public page, sitemap file or `/go` answer from what the shared rule gave before this story: the existing public-side tests pass unedited.
35. `/admin/tiendas` shows what it showed, including its offer count and its two paused notes (OD-3). Reconciled: S2.6 (#373, shipped in #379) later changed the count to two numbers, "ofertas" (current, not removed) and "en el sitio ahora" (on the site now), and kept the two notes with their conditions and words, proved against the shared rule.
36. The product list's search, hidden-only filter and paging, and the guards and actions of the product screens, behave as before; the existing admin product tests pass unedited except where an AC above states a new line.
37. If the read of a row fails, the admin sees the existing error screen and the log line is the fixed line and code of today.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- how a reason is represented and read, and that reason and "En el sitio ahora" of one row come from one read (AC 7); how the list's reads stay bounded for a page of rows, including a product that has many offers (AC 20);
- how the writers' answers carry the reason (AC 28), and what `ProductState` and `ProductHideToggle` are given;
- how the guard of ACs 8 and 9 is built so that a condition added to the public rule fails a test until it has a reason: the seam changes, if any, are the tech lead's, and a loosening of the admin-file flag fence is not an option;
- whether the two public conditions stay two functions or share a derived reason; whether the product's reason names a single offer's cause (OD-2) by a rank the visibility module owns;
- whether the three tickets stay as drafted.

Left to the UX pass (direction: change to an existing admin screen; `docs/design/system.md` may need a row): where the reason sits on a row beside the two existing facts, how it reads next to the hidden tag, the wording of every reason inside the pins (OD-4, OD-6), the general reason of AC 8, and how a product row reads when it names an offer's reason (OD-2).

## Test plan

Test files and names are the test lane's after the design pass. Coverage required, by behaviour, each proved once at the lowest level 0006 rule 9 allows (rule 10). Nothing here needs a browser.

| ACs | Level | Check |
|---|---|---|
| 5, 7, 8, 9, 10 to 21 | integration (database), in the pattern of `tests/integration/admin-product-read.test.ts` | the read of the list and of one product with its offers: each cause alone, an offer in review by fixture, an offer with no product cause, a product with no category, with no offer and with only non-public offers; the reason compared with `getPublicProductBySlug` and the public offer list for the same state (AC 7, as `admin-product-read.test.ts` already does for the Yes/No); a row with an unknown cause; the seam test unchanged |
| 22 to 25 | integration | one fixture with every offer cause true, peeled one at a time in the order of AC 23 until the row reads Yes; the same for a product (AC 24); the hidden tag unchanged by the reason (AC 25) |
| 26, 27 | integration | the local-flag modes of `tests/support/local-flag.ts`: off, on at a loopback origin, and each backstop mode, for a collected offer and a collected product (as `collected-public-sweep.test.ts` does for the public side) |
| 28, 29 | integration | the hide and unhide actions in the pattern of `tests/integration/admin-product-actions.test.ts` and `admin-product-writer.test.ts`: the answer's reason for a hide, an unhide that leaves another cause, an offer's hide that changes the product's line; the page read afterwards agrees (AC 29, as `admin-product-pages.test.ts` renders the real pages in-process) |
| 1 to 4, 6 | integration | the real list page and the real product page rendered in-process (`tests/integration/admin-product-pages.test.ts`): a reason in the text of a row that reads No, none in a row that reads Yes, one per row kind (list row, product block, offer row). The per-cause text is proved at unit level (below), not again here |
| 4, 6, 25 | unit | `ProductState` static render: a reason beside the two facts, none when Yes, the hidden tag unchanged; the reason is text, not an attribute |
| 30 to 33 | unit | `tests/unit/admin-copy.test.ts` and `tests/unit/messages.test.ts` as changed by design: every cause maps to its own line, the existing pins pass unchanged on the new keys, no promise sentence, no id or URL pattern in a reason, the scan of `Admin.Products` is still not vacuous |
| 34, 35, 36, 37 | integration | the existing tests run unedited: `visibility.test.ts`, `hide-public-sweep.test.ts`, `sitemap.test.ts`, `admin-sources.test.ts`, `admin-source-pages.test.ts`, `admin-product-*` and `admin-logs.test.ts`; no new test is written for what already holds |

Whether a browser test is needed: **no.** Every behaviour here is observable by calling the pages, loaders and actions in-process (rule 9, integration) or by rendering a component (unit). The existing journey J11 (`admin-products.spec.ts`, hide and unhide with the public page following) and the products smoke of `admin-smoke.spec.ts` stay as they are; AC 4 keeps a Yes row's text unchanged so the smoke snapshot, which matches the demo row's text, is not edited. A reason line in the journey would be a second proof of AC 28 at a higher level, which rule 10 allows only with a reason written in the story's test report. The e2e count added is expected to be zero and the budget of one is not used.

Notes for the test lane:

- The existing integration test already compares the Yes/No with the public page for the same slug; the new reason assertions sit beside it and reuse its fixtures (`tests/support/catalogue.ts`, `setOfferRemoved`, `tests/support/hide.ts`).
- A fixture cannot be made for review by any real writer; set `in_review` directly, as `visibility.test.ts` does.
- `Admin.Sources.intro` (`messages/es-ES.json`) lists the public conditions without `in_review` because nothing writes it; the story that adds a writer of `in_review` must add that clause to the intro.
- The integration review states the measured `check`, integration, e2e and full-gate times against the budgets and the tests added and removed per level (rule 14 and 15); this story is expected to add unit and integration tests only.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story and rules OD-1 to OD-6; a UX pass fixes the copy and the placement; a design pass (tech lead) fixes the contract, which fires because the read, the writers' answers and the screens cross frontend and backend. The design pass may merge, split or rename the tickets. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T-2.5.1 backend.** The reason computed in the visibility module for an offer and a product, in the order of ACs 23 and 24, read with the admin list, the product page's product and offers and the hide writers' answers, with the guard that a new public condition cannot leave a No without a reason, and the seam changes the design pass finds it needs without loosening the admin-file flag fence. ACs 1 to 3 (the data), 5, 7 to 29, 34, 36, 37.
2. **T-2.5.2 frontend.** The reason on the list row, the product block and each offer row, through `ProductState` and `ProductHideToggle`; the copy keys in the admin message section from the UX pass; nothing shown on a row that reads Yes. Needs T-2.5.1, the UX pass and the design pass. ACs 1 to 4, 6, 25, 28, 29 (the screens), 30 to 33, 35, 36.
3. **T-2.5.3 test.** The integration and unit tests of the plan, on the design pass's contract, and a run of the existing tests named in ACs 34 to 37 unedited. Needs T-2.5.1 and T-2.5.2. Every AC; coverage per the test plan.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/decisions/0018-offer-removal.md` Consequences (lines 73 to 74): "shows a removed offer as not on the site with no reason" no longer holds; point at S2.5.
- `docs/product/stories/US-2.4-hide-products-offers.md` OD-6 (line 30) and Scope Out (line 59): a reconcile line that S2.5 is the "later story" and that it names the reason from the rule rather than copying it.
- `docs/product/mvp.md` § Admin area: the docs lane judges whether the admin's list of what it can see gains a line.
- `docs/design/system.md`: rows for the reason line, from the UX pass.
- `messages/es-ES.json` admin section: the new copy, from the UX pass.
- `agentic/capabilities/testing.md`: the stale e2e spec and helper names are a docs follow-up of run `2026-11-24-339-e2e-reduction`, applied by the close lane in this run; they are not part of this story's acceptance. The testing, frontend and backend packs also learn the conventions this story sets.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **What you will see on real data.** A new shop's offers read "shop not approved" or "feed not approved" until both are approved; after that a product with an unmapped feed category reads "category not mapped" until `/admin/categorias` maps it. That is the review loop on the local stack, one reason per row, and the hidden tag stays beside it.
- **The review reason is built for a queue that does not exist.** No code writes the offer review flag; the reason is tested by fixture only (OD-5).
- **The tiendas count will still not match the product rows.** It counts hidden, in-review and removed offers (OD-3).
- **The tiendas page's two paused notes restate two causes by hand** (`src/app/admin/(shell)/tiendas/page.tsx`), apart from the visibility module. After this story the same two causes are also stated, from the module, on the product screens; they agree today and a later change to one would not change the other. That is a reason to take the notes into the story the owner may file under OD-3.
- **Counts and times.** No test counts or timings are promised here: the integration review reports them against the 0006 budgets.
