# S5.4 Visitor searches by text, EAN or part number

Status: approved (owner, 2026-10-29; board status Ready follows the human's own move)
Epic: E5 Browse and search (#13) · Priority: P0 · Size: L · Iteration 2
Issue: #37 · Tickets: #125-#128 and #282 (T5.4.1-T5.4.5)
Depends on: none (S11.4, the card grid, is closed in #245)
Source: delivery brief `agentic/runs/2026-10-28-s5-4-search/02-product.md` and rulings D-1 to D-5 and D-A1 to D-A5 in the same run's `decisions.md`; recon `01-recon.md`; `docs/product/mvp.md` § Search and browsing; CLAUDE.md § Search engines (S6.2); issue #37 and the open item of #255.

## Open decisions

Rulings that stand and are not reopened here (run 2026-10-28-s5-4-search, 2026-10-29):

- **D-1.** `Disallow: /buscar` stays in `robots.txt`, and the results pages also send a `noindex` robots meta and no canonical as a second signal. Affects ACs 28 and 29.
- **D-2.** The header search box is in, as its own ticket T5.4.5 (#282) after the results page, so it can be dropped without blocking the results page. Affects ACs 38 to 41.
- **D-3.** The search form is `GET` with the term in the URL. The app never logs or stores the term, and a test proves it against the running container. The later deploy story must make any reverse proxy leave the `/buscar` query string out of its logs. Affects ACs 30 to 33.
- **D-4.** Search covers title, brand, EAN and part number only. Demo products appear as they do on category pages. Affects ACs 1, 2 and 17.
- **D-5, D-A1.** The framing brief is approved. S5.4 stays one story (#37) in E5.
- **D-A2.** The #255 home-form item ships in the same pull request as `/buscar`; #255 closes with S5.4. Affects ACs 34 to 37.
- **D-A3.** Ticket order: #125, #126, the relevance tests, #127, the e2e and no-logging tests, then #282.
- **D-A4.** Out of this story: typo tolerance, autocomplete, filters and sort, vehicle fitment, search inside a category, query analytics, a search sitemap entry.
- **D-A5.** Accents, stemming, prefix match, minimum length and page size are left to this story and the tech lead. The story fixes the visitor-visible part of each in the ACs and hands the mechanism over in § Left to the tech lead.

Open, blocking ticketing. The default below is what the ACs assume; if the owner rules otherwise, the named AC changes or goes.

- **OD-A. Viscosity grades and similar alphanumeric codes in titles.** Oil titles carry codes such as "5W-30", and a visitor may type "5w30", "5w-30" or "5W 30". Default assumed: all three find a product whose title says "5W-30" (AC 4). Reason: the oil category is one of five, and the viscosity grade is the most common thing a buyer types after the brand. Cost: the title-side normalisation is a tech lead decision that touches the migration (#125). Alternative: leave such codes to ordinary word matching, so "5w30" does not find "5W-30"; AC 4 is then dropped.

## Story

As a visitor, I type a product name, an EAN or a part number, in any case or spacing, into a search box and see the public products that match, with the lowest price and the number of shops, and open one.

## Scope

In:
- the `/buscar` results page, server-rendered, with a paginated list of public products as the same cards as the category page;
- text search over title and brand with Spanish handling, exact EAN, and part number with spaces, dashes and dots ignored;
- a designed state for an empty query, for no results and for a page past the last;
- results marked `noindex`, with `robots.txt` still disallowing `/buscar`;
- search terms never logged or stored;
- the home search form pointed at `/buscar`, with the #255 clean-up (D-A2);
- a search box in the site header on every public page, as its own last ticket (D-2).

Out (D-A4, unchanged): typo tolerance, autocomplete and suggestions; filters or sort on the results page (relevance order only; price and shop filters stay deferred, S5.3); searching description, offer text, shop names or category names (D-4); search inside one category; query analytics, popular or recent searches; a search sitemap entry.

Out, for a reason that changed: **vehicle fitment.** The brief listed it as out of MVP. Since 2026-10-28 it is in the MVP (decision 0016, `docs/product/vehicle-fitment.md`), and that spec says search results show fitting parts first. That work is a separate story that extends this page; S5.4 does not carry it. See § Notes for the human.

## Known limits (accepted, stated so a lane does not "fix" them)

- A part number is searchable by the form the **first** feed gave. The importer keeps the first feed's text when a later feed's offer attaches to an existing product (`docs/product/mvp.md` § Product and offers), so a part number written differently by a later feed is not searchable by that form.
- A part number matches whole, not by prefix or fragment.
- No typo tolerance: a misspelled word that is not a Spanish word form of the product's words finds nothing.

## Acceptance criteria

Matching

1. A text term finds a public product when every word of the term is found in the product's title or brand (a word may be found in either; all words are required; order does not matter). A term "aceite castrol" finds a product titled "Aceite sintético 5W-30" with brand "Castrol".
2. Matching ignores case and accents in both directions: "SINTETICO", "sintético" and "sintetico" all find a product titled "Aceite sintético", and an unaccented title is found by an accented term.
3. Ordinary Spanish singular and plural forms match each other: "filtros" finds a product titled "Filtro de aceite", and "filtro" finds one titled "Filtros de aire". Brand names and part numbers are not altered by this.
4. (OD-A.) A product whose title contains a code such as "5W-30" is found by "5W-30", "5w30" and "5W 30", and a product titled "5W30" is found by the same three terms.
5. A term that, once spaces, hyphens and dots are removed, is a product's EAN (digits only, 8 or 13) finds that product. "8 410076 472540", "8410076-472540" and "8410076472540" give the same result. A different number gives no match.
6. A term that, once spaces, hyphens and dots are removed and case is ignored, equals a product's part number after the same clean-up finds that product. "oc-12.34", "OC 1234" and "oc1234" find the product whose part number is "OC1234". A part number that merely starts with the term does not match.
7. A term is looked up as text, as EAN and as part number together, and a product matched by more than one route appears once.
8. Products matched by exact EAN or exact part number are listed before products matched by text only.
9. The order is the same on every request for the same data. Among products of equal relevance the lowest visible price comes first, and ties after that are broken stably, so a page never reshuffles between requests.
10. Leading and trailing whitespace is ignored and runs of whitespace inside the term count as one space. When the `q` parameter is given more than once, the first value is used. A term longer than 100 characters is cut to 100 characters; it is not an error.
11. No term produces a server error. Terms made only of punctuation, a lone `%` or `_`, quotes, a backslash, the operator characters of the search mechanism (for example `&`, `|`, `!`, `:`, `(`), an emoji and an encoded NUL character (`%00`) answer 200 with the no-result state, and `%` or `_` never match "everything".
12. A product created by `import-feeds` is findable after the import with no further step by anyone (no manual re-index), and a migrated database needs nothing beyond the normal migrate on start.

Visibility (guardrail 1)

13. Search uses the one shared visibility scope that the category page and the product page use, so a page that omits a check cannot show a non-public product. Search adds no visibility condition of its own and removes none.
14. A hidden product, a product with no category, a product with no visible offer, and a product whose offers all come from an unapproved feed, an unapproved shop, or are hidden or in review never appear in results, even when the term is exactly its title, EAN or part number.
15. A search that can match only a non-public product shows the ordinary no-result state, the same as for a term that matches nothing at all. Nothing on the page, in the count or in the status code tells the visitor that a hidden product exists.
16. The result count, the page count, each card's lowest price and each card's shop count take into account only visible offers from approved feeds. The lowest price on a card equals the first price on that product's own page, and a product with one shop reads as one shop.
17. Hiding a product or an offer, or disabling a feed or a shop, removes the affected item from search results on the next request, with no re-index step. Demo products appear in results as they do on category pages, and the demo notice shows when every card on the page is demo-only.

Results page

18. `GET /buscar?q=<term>` answers 200 and the list of results is in the HTML response, without client-side script.
19. The page shows the number of matching products and the term the visitor typed. The term is shown as plain text: markup typed into the field (for example `<b>x</b>`) is shown as typed, never interpreted.
20. Each result is the same card as on the category page: title, brand, lowest visible price in EUR with IVA from integer cents, the number of shops, and a link to the product page. A product with no brand renders without a brand and without a placeholder string.
21. Results are paged 24 per page. The page shows which page the visitor is on and links to the previous and next pages where they exist, and those links keep the term. A single page of results shows no pagination.
22. The page number is read from `?pagina=<n>`. A value below 1 or not a number shows page 1. A page number beyond the last page of a search that has results answers 404 with the site's not-found page. A page number above 1 for a search with no results also answers 404.
23. An empty query (`/buscar`, `?q=`, or a term of only whitespace) answers 200 and shows the search field with a prompt for what to type (name, reference or EAN). It shows no result list and no "no results" message.
24. A search with no results answers 200 with an empty state that names the term, suggests what to try (a shorter term, the reference or EAN), and links back to browse by category. The search field still holds the term.
25. The page has a search field containing the current term, which the visitor can edit and submit again, in a form that works without script.
26. All visible text on the new page comes from a new `Search` section of `messages/es-ES.json` (es-ES), with no inline user-facing strings.
27. The results page, its empty-query state and its no-result state show no horizontal scroll and keep the field, its button and the cards usable at 195 px and at 360 px width.

Search engines (D-1)

28. Every `/buscar` response (empty query, results, no results, any page number) carries a robots meta with `noindex` and carries no canonical link, whatever the query.
29. `robots.txt` still disallows `/buscar`, and `/buscar` is not listed in any sitemap.

Privacy (guardrail 5, D-3)

30. The search form uses `GET` and puts the term in the `q` parameter of `/buscar`. A visitor can search, page and go back without script.
31. The application writes no log line that contains the term, whether the search succeeds, finds nothing or fails. A search that fails on the server shows the site's generic error page and logs only a fixed code. This is checked against the output of the running container with a distinctive marker term.
32. The application stores the term nowhere: no database row holds it, including the click log after the visitor opens a product from the results and clicks through to a shop. A click that arrives from a `/buscar?q=...` page records source page `/buscar` without the query, as today.
33. A `/buscar` response sets no cookie, writes nothing to browser storage and causes no request to another origin.

Home form (D-A2, the open item of #255)

34. Submitting the home page search form goes to `/buscar` with the term in `q` (for example `/buscar?q=filtro`) and shows the results for it.
35. The home page shows the existing hint text (`Home.searchHint`, "Por nombre, referencia o EAN") with the form.
36. The "search is coming" note is gone: it is not shown for any `?q=` value, its message key is removed, and the home page no longer reads `q`. `/?q=anything` renders the plain home page, does not repeat the term, and keeps the plain-home canonical.
37. The form's field keeps its 100-character limit and its accessible label.

Header box (D-2, ticket T5.4.5)

38. Every public page that shows the site header, including the not-found page and the legal pages, shows a search box that submits `GET` to `/buscar` with the term in `q`, without script.
39. The header box does not remove or hide the site-name link or any other header item at any width.
40. At 195 px and at 360 px width the header, with the box, shows no horizontal scroll and the box and its button stay usable.
41. The admin area does not get the box. Where the results page also has its own form, the visitor still sees one place to edit the term, not two competing fields (the ux lane decides the arrangement).

## Left to the tech lead

These are decided in the design pass, within the ACs above, and recorded there:

- extensions, indexes, the text-search configuration and where the searchable text is kept (the migration is #125);
- how the term is told apart as text, EAN or part number, and the exact relevance rule among text matches. The floor is ACs 7, 8 and 9. The test lane pins the chosen rule in fixtures after #126 (D-A3);
- whether a partly typed word matches (for example "cast" for "Castrol"). The ACs neither require nor forbid it, but exact words must rank no lower than partial ones;
- the minimum length for a text term, and how stop words are handled. The floor is AC 11;
- a query made of a brand and a part number ("Bosch 0986494123"). Not required by the ACs; the design records whether it is supported;
- how page links are built. The vehicle-fitment story will add a parameter to the same links, so one builder should carry any extra parameter, not only `q` and `pagina`;
- whether the results page sets a referrer policy, given AC 33.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required:

- **Migration (integration, database):** the migration applies on a database with legacy rows and makes them searchable; the existing pattern for reading and executing a migration file applies (`tests/integration/fixed-category-tree.test.ts`). The test database is rebuilt and migrated on every run.
- **Search query (integration, database; new file under `tests/integration/`):** text with several words across title and brand; case and accents both ways; singular and plural; the viscosity-code spellings (if OD-A holds); EAN with spaces, hyphens, dots and a non-matching number; part number with spaces, dashes, dots and case, and a prefix that must not match; EAN-and-text overlap returns the product once; ranking (exact EAN or part number first, stable tie-break, same order on repeated calls); page boundaries (first, last, beyond last, page above 1 with no results); the hostile terms of AC 11; the 100-character cut. The relevance fixtures are written right after #126 so ranking is fixed before the page is built on it.
- **Visibility (integration):** hidden, unmapped, no-visible-offer, unapproved-feed, unapproved-shop, offer-hidden and in-review products are absent even when searched by exact title, EAN and part number; the count and shop count ignore invisible offers; a hidden-only match equals the no-match result; hiding or disabling takes effect on the next call; a regression that proves the rule is the shared scope and not a copy. Extend `tests/integration/visibility.test.ts` where that is the natural place.
- **Importer (integration):** a product created by an import is findable straight after, with no further step.
- **Query-term parsing (unit):** trimming, collapsing, first of several `q`, the cut at 100 characters, page parsing, empty-query detection.
- **Rendering (unit or component):** results page states (results, empty query, no results), term shown escaped, pagination links keep the term and are absent for a single page, noindex metadata with no canonical, `Search` message keys present, home form markup (action, name, hint, no note), header box markup. `tests/unit/messages.test.ts` loses `Home.searchNotice` and gains the `Search` keys; `tests/unit/home-components.test.ts` loses the notice markup case; `tests/unit/robots.test.ts` stays as it is.
- **e2e (Playwright, Compose stack; new `tests/e2e/search.spec.ts` plus edits):** from the home form and from the header box, search a demo product's title word, its EAN and its part number in two spellings, and land on the product page from a card; no-result and empty-query states; a page past the last answers the 404 page; `noindex` and no canonical on the page while `robots.txt` still disallows `/buscar` (`seo.spec.ts`); no Set-Cookie, empty `context.cookies()` and no request leaving the origin; 195 px and 360 px reflow for the results page and the header (`reflow.spec.ts`); a demo-only result list shows the demo notice. `tests/e2e/home.spec.ts` drops the notice cases and the `/?q=filtro` landing, and gains the `/buscar` landing and the plain-home `/?q=` case.
- **Search terms never logged or stored (against the running container):** search with a marker term that is unlikely to occur elsewhere, then fail a search on purpose where the stack allows it; read the application container's output and assert the marker is absent; assert no database row holds it, after opening a product and clicking through to a shop. If the container's output does print request URLs (not verified: the framing found no logging configuration, which is an inference), that is an escalation to the human, not a quiet exception.
- **Existing tests that must change:** `tests/integration/missing-page.test.ts:178` drops `/buscar` from the paths that must 404; the home e2e and unit cases above.
- **Kept as they are:** the click source-page tests that drop the query (`click-source-page`, `go-counting`, `go-privacy`), and the robots, sitemap and no-cookie tests.

## Tickets

Ordered per D-A3, contracts before consumers. Each traces to the ACs. The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T5.4.1 (#125) backend, M. Search migration.** Indexes and any extension the design picks, so title and brand text, EAN and part number are searchable and stay current as products are created. ACs 4 (if OD-A holds), 12.
2. **T5.4.2 (#126) backend, M. Search query and loader.** Classifies and normalises the term, reads through the one shared visibility scope, returns count, cards, relevance order and "none" past the last page, and cannot be made to fail by the term. ACs 1 to 11, 13 to 17, 20 to 22.
3. **T5.4.4 (#128), part 1, test, M. Relevance fixtures and integration tests** (runs here, right after #126). Matching, visibility, ranking and the hostile terms. ACs 1 to 17.
4. **T5.4.3 (#127) frontend, M. Search box, results page and the #255 home-form clean-up.** The `/buscar` route and its states, the results-page form, the `Search` messages, noindex metadata, the home form pointed at `/buscar` with the hint shown and the note and the `q` read removed. It leaves the tests that pin the removed behaviour to #128. It merges only with the route, never before, or the home form points at a 404. ACs 18 to 27, 28, 30, 31, 33 to 37.
5. **T5.4.4 (#128), part 2, test, M. e2e, noindex, reflow and no-logging tests** (runs after #127). Both parts are one ticket's scope in two dispatches. ACs 18 to 37, with the container-output check for AC 31 and 32.
6. **T5.4.5 (#282) frontend, S. Header search box.** One form component shared with the results page, mounted in the site header on every public page. ACs 38 to 41. Its tests extend the e2e and reflow specs.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff:

- `docs/design/system.md`: the "Search form (home)" and "Interim search note" rows change or go, and rows for the header box, the results page and its empty states are new;
- `docs/product/mvp.md` and `agentic/capabilities/ux.md:114` name the interim search state;
- the stale comment at `src/app/robots.ts:9` ("no search page exists yet"); CLAUDE.md § Search engines (S6.2) now describes a search page (noindex, canonical-free) and not only a reserved path. If the owner ever drops the Disallow, `robots.ts:12`, `tests/unit/robots.test.ts:18-23`, `tests/e2e/seo.spec.ts:27` and CLAUDE.md change together;
- a note where the deploy story (S9.1) will find it: any reverse proxy must not log the query string of `/buscar` (D-3);
- `/privacidad` copy: check whether it should say that search terms are neither stored nor logged by the application. The text is the owner's.

## Notes for the human

- **Vehicle fitment arrives later on the same page.** Decision 0016 says search results show fitting parts first and carry `coche` in the form and page links. D-A4 put vehicle out of S5.4 because it is out of this story, not because it is out of the MVP. That story will edit this page, so the tech lead is asked to build the page links once (see § Left to the tech lead).
- **AC 22 follows S5.1 (OD-E)** for a page beyond the last: a 404. It adds that page 2 of a search with no results is also a 404.
- **The 195 px and 360 px checks** in ACs 27 and 40 are the widths the existing reflow spec uses for the header and cards.
