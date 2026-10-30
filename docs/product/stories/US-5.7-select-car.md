# S5.7 The visitor picks their car once, the site remembers it on this device, and they can change or remove it

Status: draft 2026-10-30, awaiting human approval (board status Ready follows the human's own move)
Epic: E5 Browse and search (#13) · Priority: P0 · Size: L
Issue: #269 · Tickets: #270-#273 (T5.7.1-T5.7.4) and one new ticket (T5.7.5, issue to be created; ruling D-2)
Depends on: S5.5 (#261), merged: the vehicle list and `findActiveVehicle`. S5.6 (#265), merged, gives the demo feeds their fitment, but this story reads no fitment. S5.8 (#274) and S5.9 (#278) depend on this story.
Source: `docs/product/vehicle-fitment.md` rules 4 to 7 and 9; decision 0016; `docs/product/stories/US-5.5-vehicle-fitment-model.md` (§ Scope > Out hands S5.7 its slice); issue #269 acceptance outline; the delivery brief and the human's rulings D-1 to D-7 of 2026-10-30 (`agentic/runs/2026-10-30-s5-7-select-car/decisions.md`); guardrail 5.

## Open decisions

Nothing here blocks ticketing except the creation of the new ticket's issue (D-2), which is the human's. Items 2 to 4 have a recommended answer, and the ACs below follow it; a different ruling changes the ACs named.

1. **Question for design, not settled here (D-2): is `coche` on every internal link the best mechanism?** The human approved the ticket "carry `coche` on every internal link and the two GET forms" and doubts the mechanism. The mechanism is the owner's (spec rule 4, decision 0016, `CLAUDE.md` § Stack), so this story does not change it and ACs 43 to 47 are written against it. Recommended: the tech lead's design pass compares it with alternatives and proposes, against these constraints from the spec: filtering must work without JavaScript, a link must be shareable, pages are server-rendered from the URL, and no cookie or server-side storage is allowed (guardrail 5, decisions 0014 and 0016). The human reads the comparison before the new ticket (T5.7.5) is built. If the owner changes the mechanism, ACs 43 to 47 and T5.7.5 are re-cut; no other ticket depends on how links are built.
2. **OD-S1. Does the return from the picker keep the origin page's other query parameters?** The spec says `volver` is "a site-internal path only" and says nothing of its query. Recommended: **yes**; a visitor on `?marca=bosch&orden=precio` who changes car comes back to that listing, with `coche` replaced. Alternative: the bare path only, which loses the visitor's brand and sort. Affects AC 20, and what `volver` may contain in AC 18.
3. **OD-S2. Does merely opening a URL change the stored car?** The spec says the browser "clears the stored value" for an unknown slug and stores on selection. It does not say what a shared link with another car does. Recommended: **no.** Only the picker writes the stored car; "Quitar" clears it; an unrecognised `coche` clears the stored value only when the stored value is that same unrecognised one. A visitor with car A saved who opens a shared link with car B (or a retired car) keeps A. Alternative: the URL always writes (spec rule 4 read literally), which lets a shared link overwrite a visitor's choice. This narrows the wording of spec rule 4 ("the browser clears the stored value"); the owner confirms with approval, and `docs/product/vehicle-fitment.md` is amended at close-out. Affects ACs 37 and 42.
4. **OD-S3. Where does a missing or invalid `volver` land?** Stated as an assumption: **the home page**, with the car set. A different fallback (the last category, a "car saved" page) is a UX call and changes AC 19 only.

### Carried open item (D-1): the privacy page

Ruling D-1, 2026-10-30: "ignore privacy page for now". **This story does not change the privacy page.** `Privacy.cookiesBody` still says the site installs no cookies "ni tecnologías similares" in the visitor's browser, which stops being true once `lostres.coche` is written to `localStorage`. Spec rule 5 and decision 0016 both say "the privacy page gets one sentence", and that is **not** done by this story: reconcile must not mark it as shipped. The wording needs more than one sentence (the "similar technologies" denial and the heading `Privacy.cookiesHeading` need review) and the owner decides it. Recommended: the owner rules on it, and it ships before any public deploy; until then it is a known false statement on a page that is only live on the demo. The human may add a Backlog item or a line in the S9.1 deploy checklist; this story creates neither.

## Story

As a visitor, I can tell the site which car I have, by make, model and engine, and see my choice in the header of every page. The site keeps it on this device for my next visit, and I can change or remove it at any time. Nothing about my car is stored on the server.

This delivers the choice and the URL that carries it. It does not yet change what any listing shows: filtering, grouping, ordering and counting by fit state are S5.8, and the fit banner on the product page is S5.9. After this story alone a visitor can pick, see, change, remove and keep a car, and see the notice for an unrecognised one; the listings look as they do today.

## Scope

In:
- the car control in the header of every public page, in both states (spec rule 6), and on the 404 and error pages (D-5);
- the picker, make then model then engine: as a dialog with JavaScript, and as GET steps on `/mi-coche` without it, returning to the origin page through `volver` (spec rule 7);
- the read-only options the picker needs, from server-rendered lists or a read-only JSON route (the tech lead chooses); only makes and models with at least one active vehicle are listed;
- `coche` carried on every internal link and on the search and sort forms while a car is selected, except `/go/<offer>` (spec rule 4; D-2, D-3);
- the browser keeping the choice under `localStorage` key `lostres.coche`: written on selection, restored on a page opened without `coche`, cleared on "Quitar" (spec rules 5 and 6; OD-S2);
- the notice for an unknown or retired car, the page rendered as without a car (spec rule 4);
- `noindex` on pages opened with `coche`, canonical without it, `coche` never in the sitemap (spec rule 4);
- `/mi-coche` `noindex` and disallowed in `robots.txt`, like `/buscar` (D-6);
- keyboard and screen-reader access, focus returning to the trigger, and the header and dialog working at 390 and 1280 px in addition to the existing 360 and 195 px reflow checks (D-7);
- no cookie, no server-side storage and no log of the choice (guardrail 5);
- updating the pinned tests this changes: the header tab order, the reflow checks, the SEO and robots pins.

Out, for this story (listed so a lane does not do them here):
- **the privacy page change, including the "one sentence" of spec rule 5 and decision 0016: out of scope, ruling D-1.** The "ni tecnologías similares" text stays as it is, carried as an open item above;
- filtering, grouping, ordering and counting listings by fit state, brand-chip counts, and search results filtering (S5.8, #274 and #277);
- the fit banner and the "vehicles it fits" list on the product page (S5.9, #278);
- any change to the vehicle list, to how a fitment counts, or any fitment write (S5.5 owns the list and the rule; the import is the only writer);
- changing the `coche`-in-URL mechanism or reopening decision 0016: D-2 sends the doubt to design as a proposal only;
- more than one saved car, a garage, accounts, plate or VIN lookup, TecDoc, admin screens for vehicles, analytics of selections (spec out-of-scope list);
- remembering the car across visits for a visitor without JavaScript: the URL carries it, `localStorage` needs script (spec rule 5);
- the exact copy, the component tree and the shape of the options data, which belong to the UX spec and the tech lead's design.

## Acceptance criteria

Copy in these ACs is intent only; the exact wording is the UX spec's (spec rule 9) and reaches the page through the message file. "Active vehicle" means a vehicle in the vehicle list that is not retired. "Selected car" means a `coche` value that names an active vehicle.

The control in the header

1. Every public page shows the car control in the site header: the home page, a category page, a product page, the search results page, the three legal pages, the 404 page and the error page.
2. With no car selected, the control is one action that opens the picker (intent: "Selecciona tu coche").
3. With a car selected, the control states the car in words, with make, model, generation and engine (intent: "Mi coche: Seat León III 1.6 TDI"), and offers a change action and a remove action.
4. On the search results page, where the header search is hidden, the car control is still shown.
5. (D-5.) On the 404 page and the error page, which cannot see the URL's `coche`, the control is present and shows the no-car state, or, once script has restored the stored car, that car; it does not raise an error. Links there may lack `coche`.
6. The admin area shows no car control.

The picker's options

7. The picker has three dependent steps in this order: make, model, engine.
8. The make step lists every make that has at least one active vehicle, whether or not any product has a fitment to it.
9. The model step lists, for the chosen make only, each model generation that has at least one active vehicle, with its generation and years.
10. The engine step lists, for the chosen model generation only, each active vehicle with its engine label, fuel and power in CV.
11. A retired vehicle is never offered at any step, and a make or a model generation whose vehicles are all retired is not listed.
12. At every step the options follow the order of the vehicle list, the same on every request.
13. Choosing an engine selects exactly that vehicle.

The picker without JavaScript (`/mi-coche`)

14. Without JavaScript, the no-car action leads to the make step on `/mi-coche`.
15. Without JavaScript, the change action leads to `/mi-coche` with the current make and model already chosen and the engine step shown.
16. Each step is a GET form that completes without script; the chosen make and model travel in the URL.
17. Completing the engine step returns the visitor to the page they came from, with the chosen car selected and shown in the header.
18. `volver` never takes the visitor off the site: a value naming another origin, a protocol-relative address (`//host`), a backslash form, a non-path scheme (`javascript:`), or one with control characters or over a bounded length is not followed.
19. (OD-S3.) A missing, empty or rejected `volver` returns the visitor to the home page with the chosen car selected.
20. (OD-S1.) The return keeps the origin page's other query parameters, and an existing `coche` there is replaced, not added to.
21. A step input that is unknown or out of sequence (an unknown make, a model of another make, an engine that is not of the chosen model, a retired vehicle) renders the earliest step that can still be answered, with no error page and no car set.
22. (D-6.) `/mi-coche` answers `noindex`, and `robots.txt` disallows it.

The picker with JavaScript (dialog)

23. With JavaScript, the no-car and change actions open the picker as a dialog on the current page, without leaving it.
24. The dialog is exposed to assistive technology as a dialog with an accessible name.
25. Opening the dialog moves keyboard focus into it.
26. A keyboard alone can complete all three steps and close the dialog.
27. The Escape key closes the dialog and leaves the selection unchanged.
28. After the dialog closes without a selection, focus is on the action that opened it; after a selection, focus is on the car control.
29. Opened through the change action, the dialog has the current make and model already chosen and the engine step shown.
30. Completing the engine step closes the dialog, shows the selected state in the header, and leaves the visitor on the same page with `coche` in its URL and its other parameters kept.

The choice on the device (`localStorage`)

31. Selecting a car stores its slug, and only the slug, under `lostres.coche`.
32. A page opened without `coche`, with a stored car, ends at the same URL plus `coche`, without adding a history entry; its other query parameters and fragment are kept.
33. After that restore the page shows the car selected, in the header and in its links.
34. "Quitar" clears `lostres.coche`, removes `coche` from the URL keeping its other parameters, and the header returns to the no-car state.
35. A stored value that is not shaped like a slug is cleared and never added to the URL.
36. When the browser's storage is unavailable or throws, the page still works, no uncaught error is raised, and the picker still selects a car through the URL.
37. (OD-S2.) Opening a URL that carries `coche` does not write or change the stored car.
38. Without JavaScript nothing is stored; the car lives in the URL, and the remove action leads to the same page without `coche`.

An unknown or retired car

39. A page opened with a `coche` that names an unknown or retired vehicle, or that is not shaped like a slug, renders as it does without `coche`, apart from the notice, with the status it would otherwise have.
40. That page shows the notice (intent: "No reconocemos ese coche"), and the control shows the no-car state.
41. The links on that page do not carry the unrecognised value.
42. (OD-S2.) With JavaScript, when the stored value is the unrecognised one, it is cleared; a different, valid stored car is left alone.

`coche` on links and forms (T5.7.5; subject to the design comparison in Open decisions item 1)

43. While a car is selected, every internal link on a public page carries `coche=<slug>`: the header, breadcrumb, category tiles, cards, pagination, brand chips, sort, the empty-state and not-found links, the home page's links and the footer. The one exception is the link to `/go/<offer>`.
44. While a car is selected, submitting the search form lands on `/buscar` with the term and `coche`.
45. While a car is selected, submitting the sort form lands on the category with the new order, `coche`, and the brand that was already chosen.
46. With no car selected, or an unrecognised one, no internal link carries `coche`, and a submitted form does not add one, not even an empty one.
47. No link or form result carries `coche` twice.
48. (D-3.) The link to `/go/<offer>` carries no `coche`, and the redirect it answers carries none in its `Location`.
49. (D-3.) A click through `/go/<offer>` from a page opened with `coche` records the same source page as from the same page without it.
50. (D-3.) The shop's server receives no `coche` from a click out; the tech lead's design confirms the redirect cannot pass it in a `Referer`.

Search engines

51. Every public page opened with a `coche` value, valid or not, answers `noindex`.
52. The canonical link of such a page, when it has one, does not contain `coche`.
53. No sitemap file contains `coche`.
54. A page opened without `coche` keeps the indexing and canonical it has today.

Privacy of the choice (guardrail 5)

55. No response from a public page, `/mi-coche` or the options source sets a cookie, and after selecting a car and browsing the visitor's cookie jar is empty.
56. After selecting a car and browsing, the selected slug appears in no application log output.
57. If the options come from a route, it answers only read requests, refuses any other method, and sets no cookie.

Layout

58. The header, in the no-car state and with the longest car label in the list selected, shows no sideways scroll and no cut-off text at 390 and 1280 px.
59. The dialog, at each of its three steps, shows no sideways scroll and no cut-off text at 390 and 1280 px, and every control in it is reachable.
60. The existing reflow checks at 360 and 195 px still pass with the control in both states (D-7: the new widths are added beside them).
61. The header's keyboard order follows its visual order, and the updated tab-order test pins it.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- **the D-2 comparison**: carrying `coche` on every link against the alternatives, with the constraints in Open decisions item 1; a proposal the human reads, not a change;
- how the shared header (also used by the 404 and error pages, and with no `searchParams` access) learns the selected car, and what the 404 and error pages can do (AC 5);
- whether the options come from server-rendered lists or a read-only JSON route, and the data each step needs (ACs 7 to 13);
- the helper that turns `coche` into an active vehicle or an unrecognised result, built on `findActiveVehicle`, and how a non-slug-shaped value is rejected before any query;
- the `volver` rule and its helper (the Referer parser in `source-page.ts` is for another purpose and drops queries);
- whether `coche` is carried by one shared helper or per link, and how the sort form's single hidden field and the search form are extended (AC 43 to 47);
- how pages learn they are `noindex` because of `coche`, given that today `indexable` comes from data (AC 51);
- whether the stored car is restored by an inline script or a client component, as no public script exists today;
- how the two copies of the chrome (the public layout and the root not-found) stay in step;
- whether `/mi-coche` and the options source need a header or a `Referrer-Policy` entry in `next.config.ts`;
- how AC 50 is checked, including whether the `/go` redirect can leak `coche` through a `Referer`.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, with the kind of check for each group of ACs:

| ACs | Check |
|---|---|
| 1 to 6 | e2e per page (control present, both states, no error); screenshot by `ux-review` at phone and desktop widths |
| 7 to 13 | integration for the options reader against the database (retired vehicles, all-retired make and model, order, a make with no fitment); e2e for the steps |
| 14 to 21 | e2e with JavaScript disabled, as in `header-search.spec.ts`; unit for the `volver` rule with a table of hostile and malformed values |
| 22 | unit on `robots.ts`; e2e for the `noindex` signal |
| 23 to 30 | e2e with JavaScript: dialog role and name, focus in, keyboard only, Escape, focus return; screenshot of the dialog at each step |
| 31 to 38 | e2e with `page.evaluate` for the key, the value, a corrupt value, a throwing `localStorage`, `history.length` before and after, and a JavaScript-disabled context |
| 39 to 42 | e2e (unknown, retired, malformed, stored-unknown, stored-different); unit for the helper |
| 43 to 47 | e2e crawl of the anchors on each page type with a car selected and without; unit on the path builders; form submissions for search and sort |
| 48 to 50 | integration on `/go` (`Location`, the logged source page); e2e that intercepts the shop request and reads its `Referer` |
| 51 to 54 | unit (`seo.test.ts`, `robots.test.ts`); e2e (`seo.spec.ts`); integration (`indexable.test.ts` pattern) for the sitemap |
| 55 to 57 | e2e: `set-cookie` absent and `context.cookies()` empty, in the pattern of `header-search.spec.ts`; log check in the pattern of `search-privacy.spec.ts` |
| 58 to 61 | e2e at 390, 1280, 360 and 195 px, in `reflow.spec.ts`; screenshot at phone and desktop |

Existing tests this story changes, updated and not loosened: the tab-order and presence tests in `tests/e2e/header-search.spec.ts`, the page list and widths in `tests/e2e/reflow.spec.ts`, `tests/unit/seo.test.ts`, `tests/unit/robots.test.ts`. `tests/unit/styles.test.ts` must keep passing: the dialog and the control use no shadow, transition, transform, animation or `100vw`, and use the colour and tap-target tokens. `tests/unit/legal-pages.test.ts` is not touched: the privacy page is unchanged (D-1). `tests/unit/vehicle-catalogue-constant.test.ts` is untouched: this story adds no vehicle. `tests/unit/seams.test.ts` keeps passing: S5.7 writes no fitment.

## Tickets

Ordered, contracts before consumers. Each ticket has a test dispatch after it, as in S5.5 and S5.6 (one ticket, two dispatches). The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.7.1 (#270) ux. Spec for the car control, the picker and the notice.** The header anatomy with the control in both states, the dialog within the design system's limits (no shadow, transition, transform, animation), the three steps and the no-JavaScript flow, the 404 and error behaviour, the notice and its place, and every string (spec rule 9). Runs first, edits no repo file; the docs lane writes `docs/design/system.md` at close-out. ACs 1 to 6, 23 to 30, 40, 58 to 61.
2. **T5.7.2 (#271) backend. `/mi-coche` steps, the options and the `coche` helper.** The read of makes, models and engines, the GET steps and `volver` rule, the helper that turns `coche` into an active vehicle or an unrecognised result, and `/mi-coche` `noindex` and the `robots.txt` line. Test dispatch after it: the options integration tests, the `volver` and helper unit tests, the no-JavaScript e2e. ACs 7 to 22, 55, 57.
3. **T5.7.5 (issue to be created, D-2) frontend, with the path builders. Carry `coche` on every internal link and form.** The path builders, the link sinks and the search and sort forms. It starts only after the human has read the design comparison in Open decisions item 1; if the mechanism changes, this ticket is re-cut. Needs the helper from T5.7.2. Test dispatch after it: the link crawl and form tests. ACs 43 to 47.
4. **T5.7.3 (#272) frontend. Header control, dialog, saved choice and notice.** The control, the dialog, the script that writes, restores and clears `lostres.coche`, the notice for an unrecognised car, and `/go` carrying no `coche`. Needs T5.7.1, T5.7.2 and T5.7.5. Test dispatch after it: the dialog, focus, storage and notice e2e. ACs 1 to 6, 23 to 42, 48 to 50.
5. **T5.7.4 (#273) backend, then test. `noindex` for pages with `coche`, and the story's end-to-end checks.** Narrowed by D-1: it carries no privacy line. Two dispatches: first the code, `noindex` for pages opened with `coche`, canonical without it, and the sitemap check (the page metadata of the home, category, product, search and legal routes); then the cross-cutting tests, the 390 and 1280 px layout checks, the updated tab-order and reflow pins, and the no-cookie and no-log checks. The tech lead may move the `noindex` code into T5.7.2. ACs 51 to 54, 56, 58 to 61.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff:

- `docs/design/system.md`: the Site header row and measured heights, and rows for the car control, the picker and the dialog, from the UX spec;
- `CLAUDE.md` § Search engines: `/mi-coche` in the `robots.txt` disallow list, and `coche` among the parameters dropped from canonical, with `noindex` on pages that carry it;
- `docs/product/vehicle-fitment.md`: rule 7's route shape once chosen; rule 4's wording on clearing the stored value, if OD-S2 is approved;
- **not** rule 5's "privacy page gets one sentence" and **not** the consequence in decision 0016: both stay pending (D-1);
- the frontend, testing and backend packs, for the conventions this story sets (a public client script, the dialog, link carrying, the 390 and 1280 px checks).

## Notes for the human

- **The listings do not change yet.** After this story the visitor can pick, see, keep, change and remove a car, but filtering is S5.8 and the fit banner is S5.9. Deployed alone, the control looks inert; no public deploy is scheduled.
- **The privacy page is knowingly left false for now (D-1).** The page says no similar technologies are used in the browser while `localStorage` holds the car. The owner decides the wording; see the carried open item.
- **The link mechanism is on trial, not settled (D-2).** T5.7.5 is the only ticket that depends on it. Ask for the comparison before that ticket is built, not after.
- **Without JavaScript the car is not remembered across visits.** The URL carries it on every link, and the remove action leaves the stored value alone, because storage needs script. A visitor who turns script on later and has an old stored car gets it restored.
- **Size and iteration** are not set in this draft; the board holds them.
