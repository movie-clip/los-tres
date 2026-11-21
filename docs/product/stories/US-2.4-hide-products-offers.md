# S2.4 Admin finds a product and hides or unhides it and its offers

Status: **draft for the owner's approval** (run `2026-11-21-s2-4-hide`, story order 02). OD-1 to OD-9 are open and block ticketing; the ACs are drafted on each recommendation and say which ones move if the owner rules otherwise. Board status follows the human's own move.
Epic: E2 (#10) · Iteration 3 · Priority: P0 · Size: M (the issue sizes its tickets backend M, frontend M, test S)
Issue: #25 · Tickets: #82-#84 (T2.4.1-T2.4.3)
Depends on: S2.1 (admin sign-in, the shell and its guards), S3.1 (the admin source screens) and S4.2 (the admin writer and guard-test precedents), all shipped. No open dependency.
Blocks: S9.4 (#53) hard and S12.2 (#306) hard (hide must exist before any collected row enters the database, `agentic/runs/2026-11-19-product-sources/02-product.md` § Sequence); S3.8 (#304) soft (it extends this story's admin product list).
Source: issue #25 as relayed into the run (`00-issue-25.md`: the acceptance outline and tickets); recon `agentic/runs/2026-11-21-s2-4-hide/01-recon.md` (cited below as "recon" with its section); `docs/product/mvp.md` § Admin area and § Visibility; `agentic/runs/2026-11-19-product-sources/02-product.md` (board row for #25, what S3.8 and S12.2 need from it); `docs/product/stories/US-4.2-category-mapping.md` and `US-3.7-catalogue-file.md` (the shape, and the guard-test precedent); guardrails 1, 3 and 5. The recon read the code read-only on 2026-11-21 and ran nothing; every "today" claim below rests on its reading of the code and tests, not on a passing run.

## Standing constraints

These bind this story and everything built from it.

- **Hide already has a store and a reader; it has no writer.** `products` and `offers` each carry a hidden flag, default not hidden, and the one shared visibility rule already honours both on every public read (recon § Schema and the visibility rule, § Public surfaces). Nothing but test code writes either flag today (recon § Prior art for hide and S2.4). This story adds a writer, two admin screens, the guards that keep the writer the only one, and the tests. It is expected to need no schema change; if the design pass finds one is needed it says so and why.
- **Hide takes things off; it never puts anything on (guardrail 1).** An unhide changes the hidden flag and nothing else. An item whose feed or shop is not approved, a product with no category, or an offer in review stays non-public after an unhide (ACs 43, 44).
- **Only an admin sets a hidden flag.** No import, seed, mapping save, approval change or API writes one (guardrail 1; ACs 46 to 51, 52 to 54).
- **Roles are enforced on the server (guardrail 3).** Every new page and action checks the role on the server; the checks in the pages and actions are not the UI's job (ACs 1 to 6).
- **Local-only until S2.2.** The admin area is still password-only and is not deployed or reachable from the internet before S2.2 (#23) is done (US-3.1 Standing constraints).
- **No phone width and no visual polish check for admin screens.** Function, copy and the guardrails are checked (the owner's standing rule for admin screens, as in S4.2).

## Open decisions

All blocking ticketing. Each is drafted below on its recommendation; the ACs that move if the owner rules the other way are named.

1. **OD-1. A product whose only non-demo offer is hidden but which keeps a visible demo offer (recon § Public surfaces).** Today the sitemap and the indexable flag ask whether the product has any offer, hidden or not, from a non-demo feed (`hasNonDemoOfferWhere`, `src/server/catalogue/demo.ts:14-18`: "Deliberately not filtered by offer visibility, so a product that keeps a hidden real offer stays indexable"). Two tests record it as a decision (`tests/integration/sitemap.test.ts`, "lists a product with a visible demo offer and a hidden real offer"; `tests/integration/indexable.test.ts`, "decision 2"). I read both. So after an admin hides that real offer, the product page still shows its demo offer, stays in the sitemap and stays indexable. Options: (a) keep it, and state that "a hidden item never appears on any public surface" is read as: no hidden product and no hidden offer appears; the sitemap lists product pages, never offers; (b) change the non-demo test to count only visible offers, so such a product becomes demo-only: out of the sitemap and `noindex`, which reverses the recorded decision and edits S6.2 code and two tests outside the admin area. Recommendation: (a). The case needs a demo feed and a real feed in one database, which a deployed server does not have (`SEED_DEMO_DATA` defaults to false), and the sitemap lists no offer, so no hidden item is listed. I did not find the reason decision 2 was taken in any repo doc, only the code comment and the tests; the owner may know it. AC 45 states (a); under (b) it becomes "the product leaves the sitemap and is `noindex`" and S6.2's two tests change by design.
2. **OD-2. Guardrail 1 says a product "waiting in the matching queue" is not public; only offers carry a review flag (recon § Schema and the visibility rule).** `offers.in_review` exists and the visibility rule excludes such offers; there is no product-level flag, and nothing writes the offer flag until the matching-queue slice (`src/db/schema/catalogue.ts:97-98`, which I read). A product whose offers are all in review has no visible offer and is therefore not public, so the guardrail's effect holds without a product flag. Options: (a) read the guardrail through the offer flag, add nothing, and let S2.4 neither add a review flag nor a review writer; (b) add a product-level review flag now. Recommendation: (a). (b) is a schema change and a second queue concept for a queue that does not exist yet, and S2.4's outline does not mention it. Neither option changes an AC except by adding a flag, which the story forbids under (a) (Scope, Out). Editing the wording of guardrail 1 in `agentic/project.md` is the owner's call and is not proposed here.
3. **OD-3. What the admin product list holds, and how a hidden product is found again.** Recommendation: every product in the database, hidden or not, with or without a category, with or without a visible offer, demo included (AC 8), plus one filter, "hidden only", that works with a search term (AC 19). Reason: a hidden product is by definition not public, so a list of public products could never show the product that needs unhiding; and hide must work before a feed is approved, which is the S12.2 case. Alternative: no filter, finding a hidden product only by search. The filter is a read parameter on the same list and costs little; AC 19 is the only AC that drops if the owner declines it.
4. **OD-4. Paging and order.** Recommendation: a paged list with a fixed page size, a total count, newest products first with a stable tie-break, and the public lists' `?pagina` rule for a bad or out-of-range page (AC 20). Reason: `/admin/tiendas` and `/admin/categorias` list everything with no paging (recon § Admin area), which suits five demo products and not a real feed; the sitemap's 5,000 products per file shows the scale the owner expects. Newest first because the first use is checking what an import just added (S12.2's "loading the file is a check"). Alternatives: an unpaged list; or title order. Page size is the tech lead's.
5. **OD-5. What a search term finds.** The outline says "title, EAN, part number or slug". Recommendation, public-search parity where one exists: title and brand by the same word match the public search uses; EAN by equality after stripping spaces, dots and hyphens when it is 8 or 13 digits; part number by equality after the importer's normalisation; slug by equality, ignoring case (ACs 12 to 15). Reason: the admin finds what a visitor would find, and the exact routes use the existing indexes (recon § Search). The public search cannot be reused whole, because it never returns a hidden, unmapped or offerless product; only its pieces can (recon § Search). Alternative: substring matching on all four fields, friendlier for half a part number or half a slug, but a new matching rule that differs from the visitors', and no index serves it without a migration. A pasted full public URL is not a search term under either option.
6. **OD-6. What the admin sees about "public now", and what an offer row shows.** Recommendation: every product row and every offer row shows two facts, hidden by the admin or not, and public on the site now or not (ACs 9, 10, 23); an offer row names its shop and feed; no offer URL is shown or sent (AC 24, which also keeps the existing seam on `offers.url` true). The screen does not explain why something is not public. Alternative: spell out the reasons (feed not approved, shop not approved, offer in review, no category). That is more help to an admin who finds "not hidden, not public" puzzling, and a second place where the visibility rule's logic could be restated; if the owner wants it, it is a later story and not a copy of the rule.
7. **OD-7. Does hiding record who did it and when?** Recommendation: no. The outline asks for neither; it would need new columns on both tables, and no guardrail or rule asks for an audit trail; the admin area has three accounts by design. An audit log is its own story if the owner wants one, and it has an RGPD angle (a stored admin identity). What would change the recommendation: two admins disagreeing about who hid what.
8. **OD-8. Is a confirmation asked before a hide?** Recommendation: no. A hide is one item, reversible in one click by an unhide, and an admin who has just searched for the item knows what it is. The S2.3 disable of a feed asks first because it takes a whole feed off at once (recon § Admin area, `SourceRow`'s inline confirmation); the same does not apply to one product or one offer. Alternative: the same inline confirmation as S2.3.
9. **OD-9. Are the product's hidden flag and its offers' hidden flags independent?** Recommendation: yes (AC 30). Hiding a product does not mark its offers hidden, and unhiding it does not unhide an offer the admin hid separately; a hidden offer stays hidden when its product is hidden and shown again. Alternative: a hide of the product also hides every offer it has. That would also have to decide what an offer attached later by an import does, and hiding a product already removes all its offers from the public site through the shared rule; the cascade would only make an unhide forget what the admin chose offer by offer.

## Story

As an admin, I find a product by its title, EAN, part number or slug, and I hide it or one of its offers, or unhide them, and a hidden item stays off every public page, the sitemap and the `/go/` redirect, including after the next import.

Today the guardrail promises that the admin can hide anything and that a hidden item is never public, and the public site already behaves that way for a flag set by hand in the database; but no admin screen or action sets the flag, so the promise cannot be kept from the admin area. After this story the admin can take down a wrong or unwanted product or a single bad offer without a developer, and put it back, before and after a feed is approved. It is the safety valve the owner asked for before any real or collected data is loaded.

## Scope

In:

- A product list in the admin area, reached from the navigation entry that has no link today, with search by title, EAN, part number or slug, the hidden-only filter (OD-3) and paging (OD-4), listing products whatever their state.
- A product page in the admin area: the product, its state, and every one of its offers with its own state and its own hide and unhide control.
- Hide and unhide of a product and of an offer, each by an action with a server role and origin check, each naming the state it wants.
- The guard-test changes that keep these actions the only writer of a hidden flag (ACs 52 to 56), in the same ticket as the writer, as S3.1 and S4.2 did.
- The tests that prove a hidden item is absent from every public surface and that no import, seed, approval or mapping changes a flag.
- Empty, degraded and error states.

Out, nearest first (listed so a lane does not do them here):

- Editing a product or an offer: title, brand, price, category by hand, or any other field (S3.8, #304, which extends this list later).
- Bulk hide, or hide by feed, shop or category. A feed is taken off by disabling it (S2.3).
- A matching-queue writer, a review screen, a product-level review flag, and any write of the offer review flag (OD-2; "Cola de revisión" stays an unlinked placeholder).
- An audit log, or who and when on a hide (OD-7).
- A confirmation step before a hide (OD-8).
- Reasons a product or offer is not public, spelled out (OD-6).
- Deleting a product or an offer, and the removal of offers dropped from a feed (S3.3, #28; recon § Import and matching: offers are never deleted on a re-import, so a hidden offer persists).
- Any change to the sitemap or indexing rules (OD-1), to the importer's rules, to matching, to approvals of feeds and shops, or to the category mapping screen.
- The collector's local-only flag and provenance marker and the public gating of collected rows (S12.2, #306); this story only has to exist before they do.
- Phone widths and visual review of the admin screens.
- The technical contract: the writer's shape, action and function signatures, query shapes, route segments, file layout, any migration, and how the seam tests are edited (the tech lead's); the screen layout, the controls and the Spanish copy (the UX pass's).

## Acceptance criteria

"The admin" is a signed-in admin. A product or an offer is **hidden** when its hidden flag is set, and **public now** when the public site would show it at this moment: for a product, the public product page for its slug answers with the product; for an offer, the public product page lists it. "The next request" means the next request to the public site after the admin's action, with no import and no other step. A "refusal" is a message in Spanish, nothing written or changed, and an answer that is not a server error. Copy in these ACs is intent only; wording and layout are the UX pass's.

Access and safety (guardrail 3)

1. Both new screens (the list and the product page) are guarded on the server: an anonymous request is redirected to the sign-in page and receives no product or offer data; the guard runs in the page and in its metadata function; the screens carry the same `noindex` and no-store signals as the existing admin pages and set no cookie (recon § Admin area).
2. Every action this story adds (hide a product, unhide a product, hide an offer, unhide an offer) refuses a request with no session, a forged cookie, an expired cookie or a signed-out cookie, has no effect, and checks the role before it reads or writes anything else, including when called directly with a crafted request and not from a page.
3. Every such action refuses a submission from another origin and has no effect.
4. Each action names the state it wants and does not flip: submitting "hide" for an item already hidden, or "unhide" for one not hidden, leaves it as it is and is not an error, so a stale page, a repeated submission or a second admin cannot reverse the other's action.
5. An id that does not exist or is not a well-formed id is refused and writes nothing, in the actions; and the product page for such an id answers the admin area's not-found, not a server error.
6. A crafted submission cannot set anything but the one hidden state of the one item it names. Extra fields are ignored or refused; it cannot set a category, an approval, a review flag, a price, a title, or the state of any other item.

Navigation

7. The admin navigation entry for products, which has no link today, links to the list; "Cola de revisión" stays an unlinked placeholder; no other entry gains a link to a page that does not exist (recon § Admin area).

The list and its search

8. The list holds every product whatever its state (OD-3): hidden or not, with or without a category, with or without a visible offer, from an approved or an unapproved feed, demo or not.
9. Each row shows, where the product has them, its title, brand, part number, EAN and slug, and shows whether it is hidden and whether it is public now (OD-6).
10. A row says "public now" exactly when the public product page for that slug answers with the product at that moment, and says it is not otherwise; the two never disagree, whichever of a hidden flag, an unapproved feed or shop, a missing category or an offer in review makes the product non-public.
11. Each row leads to that product's admin page.
12. A search term finds the products whose title or brand matches it as the public search matches words, case and accents ignored, hidden or not (OD-5).
13. A term that is an EAN, 8 or 13 digits once spaces, dots and hyphens are removed, finds the product whose EAN equals it.
14. A term equal to a product's part number after the importer's normalisation finds it: "OC 1234" and "oc-1234" find the same product.
15. A term equal to a product's slug, case ignored, finds it.
16. The search also finds a product with no category and a product with no visible offer; the rule that hides those from the public search does not apply here (recon § Search).
17. A term is cleaned and cut by the same rule as the public search (control characters, 100 code points); an empty term lists every product; a term with no match shows an empty state and answers 200.
18. The search term is never written to a log or stored, and the admin page logs no more than a fixed line and a code (guardrail 5; the public search's precedent, recon § Search).
19. (OD-3.) The admin can list only hidden products, alone or together with a search term; the filter can be switched off again.
20. (OD-4.) The list is paged with a total count shown, in an order that does not change between requests, so that every matching product appears on exactly one page; a page number that is not a whole number above zero is page 1; a page past the last does not cause a server error and offers a way back.
21. With no products at all, the list renders an empty state and answers 200.

The product page

22. The product's admin page shows its title, brand, part number, EAN and slug, whether it is hidden and whether it is public now, and the control to hide or unhide it.
23. The page lists every offer of the product whatever its state, each with its shop, its feed, its price as the public page formats it (final, EUR, from integer cents; no shipping), whether it is hidden and whether it is public now, and its own control to hide or unhide it (OD-6).
24. No admin screen and no admin action response shows or sends an offer's URL, or a feed's URL beyond what S3.1 already allows (the host only), in the HTML, in data sent to a client component, in a form field or in a response (US-3.1 ACs 23 to 25).
25. A product with no offers shows an empty state in place of the offers, and offers no control for an offer that does not exist.

Hide and unhide

26. The admin can hide a product from its page; the screen then shows it as hidden and says in words that it was saved.
27. The admin can unhide a hidden product from its page; the screen then shows it as not hidden and says in words that it was saved.
28. The admin can hide an offer from the product's page; the screen then shows it as hidden and says in words that it was saved.
29. The admin can unhide a hidden offer from the product's page; the screen then shows it as not hidden and says in words that it was saved.
30. (OD-9.) Hiding or unhiding a product changes no hidden flag on any of its offers, and hiding or unhiding an offer changes no flag on its product or on its other offers.
31. After any hide or unhide, the admin still has the search term, the hidden-only filter and the page they were on, wherever the control sits.

A hidden product is on no public surface (guardrail 1)

Each of ACs 32 to 38 holds from the next request, with no import and no other step. Recon § Caches finds every public page and route dynamic and uncached by the code in the repository; it did not verify the response headers on public HTML or any proxy.

32. The product's public page answers 404 and shows none of its data, including the answer the 404 rewrite gives before the page renders (recon § Public surfaces).
33. No category page lists it as a card, counts it, or counts it in a brand group.
34. The home page's category counts do not include it.
35. The public search does not return it, does not count it, and a term that only it matches gives the ordinary no-results answer.
36. No product sitemap file lists it, and a category whose only product with a non-demo offer it was no longer appears in the category sitemap file.
37. `/go/<offer>` for each of its offers answers not found and writes no click.
38. The car filter lists no hidden product.

A hidden offer is on no public surface (guardrail 1)

Each of ACs 39 to 42 holds from the next request, as above.

39. The product's public page does not list a hidden offer, and the number of shops and the lowest price it shows, and the structured data in the page, are computed without it.
40. A category card and a search card compute their price and their number of shops without a hidden offer.
41. `/go/<offer>` for a hidden offer answers not found and writes no click, while the product's other offers still redirect.
42. When the hidden offer was the product's last visible one, the product is on none of the surfaces of ACs 32 to 38 as a product with no visible offer; when it has another visible offer, the product stays public and is priced from the remaining offers.

Unhide and what else changes

43. An unhide returns the item to every surface where it would be had it never been hidden, from the next request, and no further: an item whose feed or shop is not approved, a product with no category, and an offer in review is not public after the unhide (guardrail 1).
44. Neither a hide nor an unhide changes any other column of any row: approvals of feeds and shops, review flags, categories, titles, prices and dates, fitments, or the click log. The full rows are the same before and after, apart from the one flag.

The demo edge (OD-1)

45. (OD-1 (a).) A product that has a visible demo offer and whose only non-demo offer is hidden stays in the sitemap and indexable, as today; this story changes no sitemap or indexing rule. Under OD-1 (b) this AC becomes: the product leaves the sitemap and is `noindex`.

A re-import and the other writers never change a flag (guardrail 1)

46. After the admin hides a product, `import-feeds` leaves it hidden, whether it imports every approved feed or one feed, and whatever it changes: offers' prices, links and dates, a category assigned from none, new offers (recon § Import and matching).
47. After the admin hides an offer, an `import-feeds` that changes its price and date leaves it hidden and updates the price and date: the feed's data stays fresh and the offer stays off the site.
48. A new offer from another feed that attaches to a hidden product by EAN is stored and the product stays hidden and non-public; the new offer is not hidden by itself, and attaching it makes nothing public (recon § Import and matching: `matching.ts` states this is intended).
49. An import never hides: an item the admin has not hidden is not hidden after any `import-feeds`.
50. The demo seed, at start-up and by `seed`, never changes a hidden flag: a hidden demo product or offer is still hidden after the next start.
51. Disabling and re-approving a feed or a shop, and saving a category mapping, leave every hidden flag as it was.

Guards in the test suite (deliberate changes, bounded)

52. `tests/unit/seams.test.ts` changes its rule on where the hidden flags may be named so that the hide writer and the admin read are added by name; any other file that names a hidden flag fails, including every public-side file and every screen file; the test finds the writer and fails if it is gone (recon § Test seams a hide writer will trip; the S2.3 and S4.2 exceptions are the precedent).
53. `tests/unit/seams.test.ts` changes its closed list of files that update products to include the hide writer by name, and shows that the writer sets the hidden flag and no other product column; its existing rule that the category mapping writer sets the category and nothing else stays as it is.
54. `tests/unit/seams.test.ts` gains a closed list of files that write offers (the importer, the seed and the hide writer) and shows that the hide writer sets the hidden flag and no other offer column.
55. `tests/integration/admin-routes.test.ts` names the full set of exports of the new actions file, and keeps asserting that every server action calls the role check first and acts on its refusal, and that every admin page and metadata function is guarded; an action added later and not named fails it.
56. The existing seam that keeps offer and feed URLs out of the admin files stays and is not loosened (recon § Test seams a hide writer will trip).

Failure and logging (guardrail 5)

57. If the database cannot be reached or a write fails, the admin sees the existing admin error screen or message, nothing is changed or half-changed, and the log line is a fixed line and an error code only: no product or offer id, slug, search term, shop or feed URL, or email.

The page and its copy

58. All visible text this story adds comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing strings; the existing copy checks over admin text still pass (recon § Admin area).
59. No text this story adds or changes says or implies that an unhide, or "not hidden", makes an item appear on the public site by itself; the text that a product is public only when its feed and shop are approved and it is not hidden stays true wherever it is said; the word for hidden is used for the admin's hide only.
60. Every form field has a visible label, each refusal is tied to the control it concerns so assistive technology reads them together, and every control is reachable and operable from the keyboard alone.
61. A successful hide or unhide tells the admin in words what was done, and a refusal says why, in Spanish, without an id.

Public site and the other admin screens unaffected

62. Opening either screen writes nothing and changes no public page, sitemap file or `/go` answer, and a public page still sets no cookie.
63. The behaviour of S2.3 (approve and disable), S3.1 (networks, shops and feeds) and S4.2 (category mapping) is unchanged and their tests keep passing without being loosened, apart from the guard-test changes of ACs 52 to 55; `/admin/categorias` still offers no control named to hide or show a product (S4.2 AC 41).

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the writer's shape for both flags, the contract between the read, the writers and the actions, the names of the actions and the route segments, and the state each action names (AC 4);
- the admin read: how the list, the search (ACs 12 to 17), the filter and the paging are queried, which pieces of the public search are reused, and how "public now" is derived from the shared visibility rule rather than restated (AC 10); the admin read must name no offer URL (AC 24);
- how the seams change (ACs 52 to 56): which files the closed lists name, and the three seams recon found a writer trips; and whether the first two are one closed list;
- how a hide reaches the public pages at the next request (ACs 32 to 42), given recon's finding that no cache is used by the code, and its unverified point, the headers public HTML is served with;
- whether the three tickets stay as drafted below, and where the e2e starts;
- whether `readFitStates` (`src/server/catalogue/fit-state.ts`), which takes product ids, applies no visibility scope and has no caller today (recon § Public surfaces), needs a guard now or is left alone; this story claims nothing about it;
- whether any change to the schema is needed (expected: none).

Left to the UX pass (direction: new, since these are new admin screens; `docs/design/system.md` may need rows): where the controls sit on the list and the product page, how hidden and public now read side by side and are told apart, the search box and the hidden-only filter, the paging, the offer rows, the empty states, the words for hide and unhide against the public side's "ocultos" for the car filter (recon § Admin area, vocabulary clash), and every label and message.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 6 | integration (database), in the pattern of `tests/integration/category-mapping-actions.test.ts` and the support in `tests/support/admin.ts`: every action refused for no, forged, expired and signed-out cookies and for a cross-origin submission, with no row changed; a hide repeated, an unhide of a not-hidden item; a missing and a malformed id; crafted extra fields; the anonymous redirect of both screens and of their metadata |
| 7, 21, 60 | e2e for the navigation link and the placeholder; the keyboard and the labels; the empty state with no product |
| 8 to 11, 22 to 25 | integration of the read and the pages: a product in each state of AC 8, the row's "public now" compared with the public product page for the same slug after each cause of non-publication (AC 10), an offer list with a hidden offer, an offer in review and an offer of an unapproved feed, no offer URL anywhere in the output |
| 12 to 20 | integration of the read: title and brand words, an EAN with spaces and hyphens, a part number in two spellings, a slug in other case, a hidden product, an unmapped product and an offerless one found, control characters and a 100-code-point cut, an empty term, no match, the hidden-only filter alone and with a term, paging with ties in the order, a bad and an out-of-range page; the captured log holds no term (AC 18) |
| 26 to 31 | integration of the writers and the actions (the two flags set and cleared, the other flags untouched, the independence of AC 30); e2e from sign-in to a hide and an unhide of a product and of an offer, with the search and page kept (AC 31) |
| 32 to 44 | integration of the public readers through the writer: for a hidden product and for a hidden offer, the product page, the 404 rewrite's answer, a category page and its counts and brand groups, the home counts, the search, the product and category sitemap files, `/go` and the click table, the car filter, the card price and shop count, the structured data, the last-visible-offer and the another-offer cases, an unhide that leaves an unapproved-feed, an uncategorised and an in-review item non-public, the full rows compared before and after. The existing public-side tests already set a flag by hand (recon § Public surfaces); these use the real writer and assert the whole set once |
| 45 | integration extending `tests/integration/sitemap.test.ts` and `tests/integration/indexable.test.ts`: the demo-and-hidden-real-offer case as OD-1 is ruled |
| 46 to 51 | integration extending `tests/integration/importer-preservation.test.ts` (which sets the flags by hand today, recon § Import and matching) with a hide made through the admin action: product and offer hidden then `import-feeds` for all feeds and for one feed; price and date refreshed on a hidden offer; a second feed attaching by EAN to a hidden product; an import that hides nothing; the seed run twice; a feed disabled and re-approved and a mapping saved |
| 52 to 56 | `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` as changed by the story; each new rule shown to fail on a deliberate offender fixture where the existing seam tests already do so; the offer-URL seam run unchanged |
| 57 | integration in the pattern of `tests/integration/admin-logs.test.ts`: a failing write leaves nothing changed and the captured output holds a code only, with a planted slug, id and search term absent |
| 58, 59, 61 | `tests/unit/admin-copy.test.ts` and `tests/unit/messages.test.ts` extended or changed by design for the new copy and the navigation key; a check that no new sentence promises publication |
| 62, 63 | integration or e2e: a public page, the sitemap and `/go` unchanged by opening either screen; the S2.3, S3.1 and S4.2 tests unchanged and passing |

Notes for the test lane:

- The e2e leaves the development database's demo products and offers as it found them (unhide what it hid), because other e2e specs depend on the demo data and on the two offers of the demo product page (CLAUDE.md § Commands).
- A product's and an offer's ids are not stable constants in tests; look the demo product up by slug.
- A hidden flag set by hand in the database is a fixture for the public-reader tests that exist; for this story's ACs the flag is set by the real action, since the action is what is being tested.

Existing tests this story reviews and changes by design, not loosens: `tests/unit/seams.test.ts` (ACs 52 to 54), `tests/integration/admin-routes.test.ts` (AC 55), `tests/unit/messages.test.ts` if the admin navigation keys change, and, only if OD-1 is ruled (b), `tests/integration/sitemap.test.ts` and `tests/integration/indexable.test.ts`.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story and rules OD-1 to OD-9; a UX pass (direction: new) fixes the screens and the copy; a design pass (tech lead) fixes the contract, which fires because the read, the writer and the actions cross frontend and backend. The design pass may merge, split or rename the tickets. The three tickets of the issue are kept as drafted, because each is one lane's work and the issue's sizes fit it. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T2.4.1 (#82) backend. The hide and unhide writers, the admin read, the actions, and the guard-test changes that bound them.** The role and origin check on every action, the explicit target state, the writers for the product flag and the offer flag, the read of the list with search, filter and paging, the read of a product with its offers and their "public now", logging that holds a code only, and the deliberate seams and admin-routes test changes that bound the new writer (the S3.1 and S4.2 precedent: the guard changes in the same ticket as the writer it bounds). ACs 2 to 6, 8 to 10 and 12 to 21 (the data), 22 to 25 (the data), 26 to 30 (the writes), 43, 44, 46 to 57, 62, 63. ACs 32 to 42 are met by the existing shared visibility rule; this ticket must not change it, and proves it in its own integration tests where the writer is new.
2. **T2.4.2 (#83) frontend. The two screens, the navigation link and the copy.** The product list with its search box, the hidden-only filter, paging and empty states; the product page with its offers and the hide and unhide controls; success and refusal messages; labels tied to fields; the navigation entry linked; the new copy in the admin message section. Needs #82, the UX pass and the design pass. ACs 1, 7 to 11, 19 to 25, 26 to 29 and 31 (the controls and messages), 58 to 61.
3. **T2.4.3 (#84) test. Hidden stays hidden across re-import; actions role-checked; the public sweep.** The tests not already carried by #82: the re-import cases of ACs 46 to 51 through the real action, the role and origin matrix of ACs 1 to 6, the whole public-surface sweep of ACs 32 to 44, and the e2e from sign-in to a hide and its effect on the public site and back. Needs #82 and #83. Every AC; coverage per the test plan.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `CLAUDE.md` § Commands, Catalogue file (S3.7): the "Not done" bullet "no hide (S2.4)" (recon § Prior art for hide and S2.4).
- `docs/feeds/catalogue-file.md` (line 114, "No hide or unhide of a single product or offer yet (S2.4, #25)") and `docs/product/stories/US-3.7-catalogue-file.md` (lines 6, 78 and 242, which say hide does not exist), the same.
- `docs/product/stories/US-4.2-category-mapping.md` lines 68, 84, 132 to 135: they say the category screen offers no hide; that stays true, and only the wording "does not exist yet", if any, changes.
- `docs/product/mvp.md` § Admin area ("hides any product or offer" already stands; the docs lane judges whether anything changes), and the later real-data stories list (recon cites mvp.md line 260) if it names S2.4 as not built.
- `src/db/schema/catalogue.ts`: the comments "Set by an admin only (guardrail 1)" stay true; the offer review comment ("nothing writes it until that slice") stays true.
- `docs/design/system.md`, rows for the screens' new parts, from the UX pass.
- The backend, frontend and testing packs, for the conventions this story sets (a closed writer list for the hidden flags; an admin product read; the admin pages' search).
- `messages/es-ES.json` admin section: the new copy and the navigation entry, from the UX pass.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **Where the recon's two edges land.** The demo-and-hidden-offer sitemap edge is OD-1 and AC 45; the matching-queue wording of guardrail 1 is OD-2 and Scope, Out.
- **The outline's "never appears on any public surface (category, product, search, sitemap, `/go/`)" is read as no hidden product and no hidden offer.** The sitemap lists products and categories, never offers, so for an offer it holds by construction; for a product it is AC 36. AC 45 is the one place the reading matters.
- **Most of "hidden stays off the site" already holds in the code.** The shared visibility rule applies both flags on every public read, the importer's offer upsert and product writes do not include either flag, and tests for the public readers and for the importer's preservation exist with the flag set by hand (recon § Public surfaces, § Import and matching). The new work is the writer and the screens; the new tests re-prove the whole by using the writer. That is why #84 is sized S, and why ACs 32 to 42 are mostly an acceptance sweep rather than build work.
- **A new offer can attach to a hidden product.** Matching still attaches a new offer to a hidden product by EAN, by design (AC 48). The product stays hidden, so the new offer is invisible with it; an admin who unhides the product later also shows that offer, if its feed and shop are approved.
- **`readFitStates` has no visibility scope and no caller.** It is a latent gap for any later caller, not a live one (recon § Public surfaces). It is noted for the design pass and not an AC.
- **Public HTML response headers were not verified, and no proxy exists in this repository.** The "next request" ACs are checked at the application, and the S9.1 deploy is where a cache in front of it would matter (recon § Caches).
- **Issue #25 and the tickets #82 to #84 were read as relayed into the run**, not from GitHub. The ACs that go beyond the outline's four bullets are the access set (1 to 6), the guardrail 1 effects set (43, 44, 46 to 51), the guard-test set (52 to 56), logging and copy (57 to 61) and the demo-edge reading (45).
- **Real-catalogue scale is not measured.** That a real feed holds thousands of products and justifies paging (OD-4) is an inference from the sitemap's 5,000-per-file chunking and the demo data, not from a measured catalogue.
