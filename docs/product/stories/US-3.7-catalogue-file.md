# S3.7 Add real products by writing a catalogue file

Status: **DRAFT, awaiting the owner's approval** (drafted 2026-11-20 in run `2026-11-20-s3-7-catalogue-file`). Nothing here is approved or ticketed on the board; the open decisions below block ticketing. Board status follows the human's own move.
Epic: E3 (#11) · Iteration 3 · Priority: P0 · Size: unset on the board (the draft proposes tickets backend M, backend M, frontend S, test M, docs S)
Issue: #303 · Tickets: none yet (proposed below as T3.7.1 to T3.7.5, to be created by the orchestrator after approval)
Depends on: S3.1 (#26, the admin shell, shops, feeds and their approvals) and S4.2 (#33, a feed's categories are mapped at `/admin/categorias`), both shipped. Not waited for, and so not covered here: S7.1 (#40, brand and part-number matching, not built) and S2.4 (#25, hide and unhide, not built).
Source: issue #303 as relayed into this run (`00-issue-303.md`); the approved brief and the owner's rulings D-2, D-3, D-7 and D-8 of run `2026-11-19-product-sources` (`02-product.md` § S3.7, § A, § Sequence; `decisions.md`); `docs/product/mvp.md` § Data sources, § Shops and feeds are data, § Feed import; decisions 0007, 0008, 0009 and 0017; `docs/product/stories/US-3.1-admin-feeds.md` and `US-4.2-category-mapping.md` (the shape, and the two steps this story reuses); guardrails 1 to 5. The code was read read-only on 2026-11-20 (see Notes for the human), because the 2026-11-19 recon predates S4.2.

## Standing constraints

These bind this story and everything built from it.

- **Two approvals, as for any feed (D-3, decision 0017).** A catalogue file belongs to a registered shop and a registered feed. The admin approves the shop and the feed separately, and each of them starts unapproved. Writing a file, registering a feed for it, importing it and mapping its categories each publish nothing by themselves (guardrail 1). No text this story adds may promise otherwise (AC 39).
- **The app reads a file; it never fetches anything for this source (guardrail 2).** The only new way data enters is a file the owner wrote and placed in one fixed folder on his own machine. No crawler, no browser, no HTML parser and no network call is added. The reading stays in the one module the seams test already confines file reads to.
- **Not for collected data yet.** Rows made by the owner's local-only collector (0017, S12.1) must be visible only where a local flag is set, and that marker is S12.2 (#306), which depends on this story. S3.7 adds no marker and no flag, so it cannot tell a hand-written file from a collected one. Until S12.2 ships, a collected file does not go in this folder (Open decision OD-3).
- **Local-only until S2.2.** The admin area is still password-only. Nothing built here is deployed or reachable from the internet before S2.2 (#23) is done (US-3.1 Standing constraints).
- **The public site is not changed.** No public page, message or `rel` attribute changes. The owner ruled that revenue wording is not written anywhere while everything is local (D-7); a plain shop link earns no commission and that stays unsaid.
- **No real shop is named in this repository.** The repo and the board are public. Every file, fixture and test this story adds uses invented shops and products.
- **No phone width and no visual polish check for admin screens.** Function, copy and the guardrails are checked.

## Open decisions

Ruled by the owner in run `2026-11-19-product-sources`, restated and **not reopened**. Each is stated in the ACs named:

1. **D-2. The manual path is shape iii: this story first, a catalogue file through the importer; the admin product form (S3.8, #304) stays Backlog until the owner has used this and confirms the need (Scope, Out).**
2. **D-3. A hand-made catalogue stays behind the same two approvals as any feed, shop then feed, separate from entering the data (ACs 14 to 17).**
3. **D-7. No revenue or disclosure wording and no public copy change now (Standing constraints, AC 39).**
4. **D-8. The folder is one fixed folder, read by file name only, the tech lead picks it (A1); the file is in the canonical layout the importer already reads, so per-network layouts (S3.5) are not needed (A2); out of scope are images, shop descriptions beyond what the importer reads, fitment from collected data, scheduled runs, an admin import button, price history and publication (A4). The assumed list was not objected to (ACs 18 to 25, Scope Out).**

Not settled by the rulings, with options, a recommendation and what each blocks. **All four block ticketing.**

5. **OD-1. How does the owner register a feed whose source is a local file?** Today the admin feed form accepts only an https address and a network, creates only the affiliate kind, and cannot edit any other kind (`src/server/admin/sources.ts`, `createFeed`, `updateFeed`); the demo `demo-feed:` value is possible only for seeded demo feeds. A file feed is therefore not registrable by any screen. Options:
   - **(a) Extend the S3.1 feed form on `/admin/tiendas`:** a feed is either an https address or a catalogue file named by its file name, a file feed needs no network, and the lists show it. **Recommended.** It is the only option that keeps every registration visible and role-checked in the admin, in the pattern of S3.1, and it lets the owner correct a mistaken file name without a developer. Cost: it changes a shipped admin screen (below), so a UX pass runs.
   - (b) A command-line verb that registers a file feed. Not recommended: CLAUDE.md fixes the verb list (any other verb exits 64), so a verb is a Stack-adjacent change, and the owner would still need the admin to see and approve it.
   - (c) Register by SQL or by the seed only, no new form. Not recommended: it leaves the owner needing a developer for the one step he must repeat for every shop, and a feed created outside the admin writer skips the checks of S3.1.

   Blocks: ACs 1 to 13, T3.7.2, T3.7.3, whether the UX lane runs. If the owner picks (b) or (c), ACs 1 to 13 are rewritten, the frontend ticket shrinks to showing such a feed correctly in the lists, and the UX pass shrinks to copy.
6. **OD-2. Are catalogue files kept out of git and out of the Docker image as a product requirement?** The repo is public. A file of real shop prices and links would publish them, and name the shop. Options: **(a) the folder's contents are git-ignored and excluded from the Docker build context and image, and a clean clone holds no catalogue file (recommended);** (b) leave it to the owner file by file. Guardrail 2 binds this only for collected rows; for hand-written files it is a product call, and the issue leaves it to the story to say whether it is a product requirement. Blocks: ACs 31 to 34.
7. **OD-3. Collected files before S12.2.** S12.2 (#306) will add the marker that keeps collected rows off public surfaces unless the local flag is on, and it needs this story's file source. Options: **(a) hold: no collected file goes in this folder until S12.2 ships; the owner's guide says so (recommended; the collector writes into its own repository and the owner copies a file only after S12.2);** (b) pull the provenance marker into this story (widens it into S12.2 and the guardrail 1 visibility scope, needs an integration gate on the scope). Blocks: the wording of the owner's guide (ACs 40 and 41) and whether the story's scope grows.
8. **OD-4. Does changing the file name of an approved file feed send it back to unapproved?** S3.1 D-4 does this for replacing an https address, because new content must be approved. Options: **(a) yes, in the same write, with a warning before submit, as AC 20 and 21 of S3.1 (recommended: the rule stays one rule);** (b) no, the file name is only a label. A file's contents change between imports without a new approval under either option, as for any feed. Blocks: ACs 11 and 12, only if OD-1 is (a).

## Does this story change an admin screen, a flow or user-facing copy?

**Yes, under the recommended OD-1 (a):** the feed form on `/admin/tiendas` and its edit page gain a source choice and a file-name field and lose the network requirement for a file feed, and the feed lists on `/admin/tiendas` and `/admin/categorias` show a file feed. That is a shipped admin screen changed, so **the UX lane runs (direction: changed, admin only)**. The new copy is Spanish admin copy in the message files; no public page, public message or public flow changes.

**If OD-1 is (b) or (c):** no form changes, but both lists must still show a file feed correctly, and today they would label a feed with no network "Subido por la tienda" (`messages/es-ES.json` `feedMetaUpload`; `categorias/page.tsx` line 83), which is false. A copy-only UX pass then runs, and the frontend ticket is that fix alone.

In neither case does a public screen, a public flow or public copy change.

## Story

As the owner, I write a catalogue file for a shop, register that shop and its feed, approve them, run the import and map the file's categories, and the products appear on the local site with links that go to the shop.

Today the importer reads a feed only from an https address, or from a demo folder for the seeded demo feeds, so no real product or shop link can enter the stack without a network. After this story the owner turns a spreadsheet into real products and real links with the tools he already has: the S3.1 forms, the existing import command and the S4.2 category screen. A second shop's file with the same EAN lands on the same product page, and the page lists both shops by price.

## Scope

In:

- A local-file source for a registered, non-demo feed: the file is named by its file name, read from one fixed folder only, in the canonical layout and the formats the importer already reads (CSV or XML, plain or gzip).
- Registering and editing such a feed in the admin (OD-1), with no network, unapproved at the start.
- A file feed shown correctly in the feed lists, including the category screen, with its file name in place of a host.
- Refusal of any name that is not a bare file name, at registration and again at import, and a clear failure for a missing or unreadable file.
- Plain shop links through `/go/<offer>`, unchanged.
- Integer-cent prices with IVA included, from decimal text in the file.
- Two shops' files with the same EAN converging on one product through the existing matching.
- Catalogue files kept out of git and out of the image (OD-2).
- The deliberate changes to the guard tests that bound who may read the folder and who may write a feed (ACs 36 and 37).
- A written guide for the owner (ACs 40 and 41).

Out, nearest first (listed so a lane does not do them here):

- An admin form for products and offers (S3.8, #304), and any other way to type a product into the app.
- Upload of a file from the browser, and an admin "Import now" button or import report (S3.2). The import stays the manual command.
- Other file layouts or per-network column mapping (S3.5), and any new column. The importer reads `id, title, price, url` and optionally `brand, part_number, description, ean, currency, category, fitment` today and that is all; images and descriptions beyond that column, and fitment beyond the existing `fitment` column, are out.
- Removal of an offer that is no longer in the file (S3.3, #28). A product or offer dropped from the file stays until that story; the importer today only adds and updates (`mvp.md` § Feed import, noted there as not built).
- Brand and part-number matching (S7.1, #40). Two files with no EAN do not converge in this story (Notes for the human).
- Hiding and unhiding a product or offer (S2.4, #25). It does not exist yet, so no AC here depends on it.
- The collector's local-only flag, provenance marker and public-surface gating (S12.2, #306), and any collector feature (S12.1).
- A change to decision 0007, 0009 or 0017, to `docs/product/mvp.md` or to any guardrail. Where one lags, the docs lane records it at close-out.
- Showing in the admin whether the file exists, a preview, or a count of its rows.
- The technical contract: the folder's location, the file-name rule, the stored shape of a file feed, the schema, any migration, the compose wiring and the module layout (the tech lead's); the Spanish copy and the layout of the form (the UX pass's).
- Phone widths and visual review of the admin screens.

## Acceptance criteria

"The owner" is the person who runs the commands and, signed in, the admin. A **catalogue file** is a CSV or XML file, plain or gzip, in the layout `import-feeds` reads today, written by the owner. A **file feed** is a registered feed whose source is a catalogue file. **The folder** is the one fixed folder catalogue files are read from. A **bare file name** is a name with no directory part. A "refusal" is a message in Spanish next to the field at fault, a row not written or changed, and an answer that is not a server error. Copy in these ACs is intent only; wording and layout are the UX pass's. Criteria marked **[OD-1]** or **[OD-4]** change with that ruling.

Registering a file feed [OD-1]

1. On `/admin/tiendas` the admin can create a feed for an existing shop by choosing the catalogue-file source and giving a file name. The new feed is unapproved even when its shop is approved, is not a demo feed, and appears in the list as such.
2. A file feed needs no network: the form does not require one for it, and a file feed is created without one. The affiliate feed form is unchanged: a feed submitted for the https source without a network is still refused (US-3.1 AC 15).
3. A file name is accepted only as a bare file name of a supported kind. The form refuses, naming the field and without repeating the value: an empty or blank name; a name too long; a name with a directory separator of either kind, a drive letter, a leading dot-dot or any other parent reference; an absolute path; a name with a URL scheme (including `https:` and `file:` in the file-name field); a name with blank space or a control character; and a name whose kind is not CSV or XML, plain or gzip. The exact rule is the tech lead's; it must accept the names the owner will write.
4. A second file feed with the same shop and the same file name is refused, including when two such submissions arrive at the same moment (exactly one is created), and the message does not repeat the name.
5. Every action this story adds or changes refuses a request with no session, a forged cookie, an expired cookie or a signed-out cookie, has no effect, and checks the role before it reads or writes anything else, including when called directly with a crafted request and not from the page (guardrail 3).
6. Every such action refuses a submission from another origin and has no effect.
7. A crafted submission cannot set what the form does not offer: the approval state of a feed, the demo flag, a shop on an existing feed, or a source other than the two the form offers. Extra fields are ignored or refused, and a created feed is unapproved.
8. A feed whose address is a `demo-feed:` value or an https address is still accepted or refused exactly as today: a `demo-feed:` value is still refused in the form (US-3.1 AC 16), and a non-demo feed can never read the demo folder.
9. Registering a file feed does not read the folder. A name whose file is not there yet is accepted, and the admin shows no file status.

What the admin shows

10. In the feed list on `/admin/tiendas` and on the category screen `/admin/categorias`, a file feed is identified as a local catalogue file by its file name, in place of a host. It is not described as a shop upload and not as a network feed, and it shows the same approval and paused states as any feed. After an import its categories appear on the category screen (AC 29).
11. [OD-1, OD-4] The admin can change a file feed's file name, under the same rules as AC 3. When the feed being edited is approved, the form says before it is submitted that changing the file name returns the feed to unapproved. The shop of a feed is not editable, as today.
12. [OD-4] Changing the file name of an approved file feed makes it unapproved in the same write as the new name, so no moment exists in which the new name is approved; its offers leave every public page, the sitemap and `/go` at once, as for any disabled feed, until it is approved again (S3.1 AC 20). Saving the same name again changes nothing and is not an error.
13. No page, action response, redirect target, notice, error message, log line or import report shows the folder's location or any path. A file feed shows its file name at most, and every log line and error from the registration and import is a fixed line and an error code only (guardrail 5).

The two approvals (D-3, guardrail 1)

14. A new shop and a new file feed each start unapproved, and approving each is the existing, separate S2.3 action with the same controls and confirm panel. Approving the feed does not approve its shop, and the other way round.
15. `import-feeds` on a file feed that is not approved reports it skipped, reads no file and fails no run, whether the file exists or not; the same holds for `import-feeds --feed <id>` on it.
16. Until both the feed and its shop are approved, no offer and no product of a file feed appears on any public page, in search, in the sitemap or through `/go`, whether or not the file was imported.
17. The import of a file feed writes no approval, hidden or review flag on any product, offer, feed or shop, as for any feed.

Reading the file from the fixed folder

18. For an approved file feed, `import-feeds` reads the named file from the folder and imports it by the importer's existing rules, CSV or XML, plain or gzip, and prints the usual line `feed <id> "<shop name>": imported rows=... products_created=... offers_created=... offers_updated=... rejected=...`.
19. The same file, placed in the same place on the owner's machine, is read by `npm run import-feeds` and by `docker compose run --rm app import-feeds`, with no step beyond placing the file. How the compose run sees the file is the tech lead's; today the image holds no folder of the owner's (the Dockerfile copies only `demo/`).
20. There is one folder. No form field, stored feed value, command argument or request can name another, and the importer reads no file whose name has a directory part.
21. A stored file-feed value that is not a bare file name, such as a path with a parent reference, an absolute path or a drive letter written into the database by other means than the form, is refused at import: the feed is reported failed with a fixed code, nothing outside the folder is read and the run goes on with the other feeds.
22. A file in the folder that is a link to a place outside the folder is not read: the feed is reported failed with a fixed code and nothing is imported from it.
23. When the named file is missing, the feed is reported failed with a fixed code and no path in the report, the run goes on with the other feeds, and the exit code is 1, as for any failed feed. When the folder itself does not exist the result is the same for a file feed, and a run with no file feed does not mention the folder at all.
24. The importer's validation is unchanged for a catalogue file: a row with no id or title, a price that is not valid decimal text, a currency other than EUR, an invalid EAN or a link that is not http or https is rejected and listed by record number and field while the other rows import, and a missing required column fails the feed. Rejected rows alone do not make the exit code 1.
25. Running the import again on an unchanged file creates no new product and no new offer and changes nothing but prices and dates, as for the demo feeds.

Prices and links

26. A price in a catalogue file is read as the final price with IVA included, as decimal text with at most two decimals, dot or comma, and stored as integer cents; the product page shows it in euros with that amount, for example `12,99` in the file shows `12,99 €`. A price with more than two decimals, a thousands separator, a sign, an exponent, zero, or a currency other than EUR is rejected and never rounded.
27. A product's offer from a file feed links to the shop through `/go/<offer>`, which answers with a redirect to exactly the address written in the file's `url` column, with nothing appended, and logs one click with the existing fields only. The click is counted, because the feed is not a demo feed.

Categories (S4.2)

28. A product from a file feed row whose category cell is empty, or whose category is not mapped, is stored but not public, as today.
29. After the first import, each distinct category string in the file appears under the file feed on `/admin/categorias` as not reviewed, with its product count. Once the admin maps it to one of the five categories, and the feed and its shop are approved, the products of that category appear on the public category page at the next request, with no new import.

Two shops, one product

30. Two file feeds of two shops whose files carry the same valid EAN for a product make one product page that lists both offers, cheapest first, each with its own link through `/go/<offer>` and each naming its shop. The page has one product, not two.

Real data stays out of git and the image [OD-2]

31. A catalogue file placed in the folder does not appear in `git status`, and is not in the Docker build context or in the built image. The ignore rules for the folder exist in `.gitignore` and `.dockerignore`, and a test fails if either is removed.
32. A clean clone holds no catalogue file, and `npm run gate` exits 0 there, with the folder absent or empty.
33. No tracked file in the repository, no fixture and no test uses a real shop's name, address or product; tests write invented catalogue files into the folder and remove them.
34. The diff of this story contains no catalogue file with real shop data (a reviewer check).

Demo and existing behaviour unchanged

35. The seeded demo network, shops and feeds, the `demo-feed:` reading from `demo/feeds` for demo feeds only, the seed and `import-feeds` on the demo feeds behave exactly as today. The demo files are not readable through the catalogue-file source, and the catalogue folder is not readable through a `demo-feed:` value. The existing e2e passes with the demo data and no catalogue file.

Guards in the test suite (deliberate changes, bounded)

36. `tests/unit/seams.test.ts` still confines reading any file to one named module, and now fails if any other file reads the catalogue folder; it finds the reading module and fails if it is gone; no `fetch` or HTTP client is added anywhere, and the existing scraping-library and `fetch` rules still pass untouched.
37. `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` are changed, in the same ticket as the writer they bound, so that insert and update of the feeds table stay confined to the closed list of files, the file name is read only where the design names it, and the admin-routes test names the full action set this story settles, keeps asserting that every server action calls the role check first and acts on its refusal, and that every admin page, layout and metadata function is guarded (S3.1 ACs 30 to 33 are the precedent).

Copy and the page

38. All visible text this story adds or changes comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing string; the existing copy checks over admin text still pass; every form field has a visible label, each refusal message is tied to its field, and every control is reachable and operable from the keyboard alone. A successful save says in words that it was saved.
39. No text this story adds or changes says or implies that registering, approving or importing a file feed makes its products appear by itself; the text that a new feed starts unapproved, and that a product is public only when its feed and shop are approved, it is not hidden and it has a category, stays true wherever it is said.

Owner's guide

40. The owner can follow, from written steps in `CLAUDE.md` and a layout reference in `docs/`, in this order: where the folder is on his machine, the file's columns and what each means, that `price` is the final price with IVA included as decimal text, that `url` is the shop link, that `ean` is what makes two shops converge, how to register and approve the shop and the feed, how to run the import (both forms), how to map the categories, and which things this story does not do (no removal of dropped offers, no convergence without an EAN).
41. The guide states that a file made by the collector does not go in the folder before S12.2 ships (OD-3), and that nothing about a real shop is committed.

Public site and the rest unaffected

42. Creating or editing a file feed, and importing its file, change no public page, sitemap file or `/go` answer until the two approvals and the category mapping are done, and a public page still sets no cookie. The behaviour of S2.3, S3.1 and S4.2 is unchanged, and their tests keep passing without being loosened, except the deliberate changes named in ACs 36 and 37.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the folder's location, how it is made to exist and how `npm run import-feeds` and `docker compose run --rm app import-feeds` both see it (AC 19), including whether the compose service gains a read-only mount, with the guarantee that nothing is baked into the image (AC 31);
- how a file feed is stored: a new feed kind, the existing unused `shop_upload` kind (whose "shop upload" name is misleading), or a value form in the address column, the migration if any, and how the "network is required for the affiliate kind" constraint and the shop-and-address uniqueness stay true (ACs 2, 4);
- the file-name rule (AC 3) and the stored-value check at import (AC 21), and how the symlink refusal of AC 22 is made on the owner's platform;
- how a file name is shown on the lists without the stored value being a fallback (S3.1 ACs 24, 25 are the precedent), and the host-only masking function's place beside it;
- the importer's reading of a file feed inside the one module that may read files, and the report's fixed failure codes (AC 23), which may extend the current set;
- the shape of the actions, the writer, and the closed lists of ACs 36 and 37, and which ticket carries them;
- the transaction shape of AC 12 (the name replaced and the feed unapproved in one write).

Left to the UX pass (direction: changed, admin only, under OD-1 (a)): how the source choice and the file-name field sit in the feed form, how a file feed reads in the lists and on the category screen, the warning of AC 11, every label and message, and the empty states. `docs/design/system.md` may need rows.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 9 | integration (database), in the pattern of `tests/integration/admin-sources.test.ts` and the support in `tests/support/admin.ts`: every action refused for no, forged, expired and signed-out cookies and for a cross-origin submission, with no row written; a table of accepted and refused file names (AC 3's classes, including separators of both kinds, a drive letter, a scheme, a control character, a wrong kind, a name too long); a duplicate and two simultaneous duplicates; crafted extra fields; a `demo-feed:` value refused; the form creating a file feed with no network and an https feed with none still refused; the folder not read at registration |
| 10, 13 | integration of the read and the page: a file feed listed on both screens by its file name with no path or stored value, not labelled as an upload; a planted path-like value and a planted name absent from captured logs, the report, the rendered page, data sent to client components and every action response, in the pattern of `tests/integration/admin-logs.test.ts` and `admin-source-privacy.test.ts` |
| 11, 12 | integration: name changed on an approved feed makes it unapproved in one write and drops its offers from a public reader; the same name saved again changes nothing; the warning shown before submit (e2e) |
| 14 to 17 | integration, extending the existing import and visibility tests: unapproved feed skipped with and without the file, with `--feed`; feed approved but shop not, and the reverse, public readers (category page, product page, search, sitemap, `/go`) unchanged; no flag written by the import |
| 18 to 25 | integration of the importer with a temporary invented file written into the folder and removed afterwards: CSV and XML, plain and gzip; a missing file; a missing folder; a stored traversal path, an absolute path and a drive letter written to the row directly; a link out of the folder where the platform allows creating one (skip with a stated reason where it does not); a rejected-row mix with exit code 0; a header with a required column missing; a second run changing nothing but price and date; the report line and the fixed failure codes with no path. The Compose form is covered by the e2e setup path |
| 26, 27 | integration: decimal-comma and dot prices, more than two decimals, a thousands separator, zero and a currency other than EUR; the product page text; `/go/<offer>` redirect location equal to the file's link with nothing appended and one click row with the existing fields only |
| 28, 29 | integration and e2e: unmapped and empty-category rows stored and not public; categories listed as not reviewed after the first import; after mapping, with both approvals, the product on the category page with no second import |
| 30 | integration with two invented shops and two files that share an EAN: one product, two offers cheapest first, each with its link; and two files that share only a brand and part number are not claimed to converge |
| 31 to 34 | unit: `.gitignore` and `.dockerignore` hold the folder rule, a check that the build context excludes it; the clean-clone gate with the folder absent; a check that no test or fixture file names a real shop is the reviewer's, as nothing mechanical can know a real name |
| 35 | the existing demo integration and e2e tests unchanged and passing; a test that a demo feed cannot read the catalogue folder and a file feed cannot read `demo/feeds` |
| 36, 37 | `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` as changed by the story; each new rule shown to fail on a deliberate offender fixture where the existing seam tests already do so |
| 38, 39 | `tests/unit/admin-copy.test.ts` and `tests/unit/messages.test.ts` for the new copy; a check that no new sentence promises publication; e2e for labels, keyboard and the success message |
| 40, 41 | reviewer reads the guide against the steps; no test |
| 42 | e2e and integration: the public pages, the sitemap and `/go` unchanged after each step until both approvals and the mapping; the S2.3, S3.1 and S4.2 tests unchanged and passing |

Notes for the test lane:

- The e2e from sign-in through to a product on the public site is one flow: register a shop and a feed for a temporary invented file, approve both, run the import (the same compose command the e2e setup already runs), map the categories, see the product on its category page, follow `/go`. It cleans up the file, the feed and the shop it made, or works on rows of its own, because other e2e specs depend on the demo rows.
- The folder is git-ignored, so a test writes its own files into it and deletes them; a leftover file in a developer's folder must not break the suite, and a test must not read the owner's real files.
- Fixed category ids are not stable constants in tests: look up the five by slug (`tests/support/db.ts` re-creates the tree).

Existing tests this story reviews and changes by design, not loosens: `tests/unit/seams.test.ts` (ACs 36, 37), `tests/integration/admin-routes.test.ts` (AC 37), the S3.1 assertions that the feed form offers only an https address (`tests/e2e/admin-sources.spec.ts`, `tests/integration/admin-source-writers.test.ts`) where OD-1 (a) changes them, and any test that pins the list of feed sources.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the owner approves this story and rules OD-1 to OD-4; a UX pass (direction: changed, admin only, under OD-1 (a)) fixes the form, the lists and the copy; a design pass (tech lead) fixes the contract, which fires because the story adds a feed kind or value form, may add a migration, widens the one file-reading module and the compose wiring, and crosses backend and frontend. The design pass may merge, split or rename the tickets. If OD-1 is (b) or (c), T3.7.2 and T3.7.3 are rewritten as described there. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T3.7.1 backend (size M). The local-file source in the importer, the folder and the ignore rules.** Reading a file feed's named file from the one folder inside the existing reading module; the name check at import, the traversal, absolute-path and link refusals and the fixed failure codes; the folder reaching both import commands; the `.gitignore` and `.dockerignore` rules and the guarantee that nothing is in the image; the seams test change that confines the folder read (AC 36). ACs 15 to 25, 31, 35, 36.
2. **T3.7.2 backend (size M). Registering and editing a file feed.** The feed kind or value form and its migration if any; the create and edit actions and their validation (file name, no network, duplicates, the crafted-field cases), the un-approval write of OD-4, the list read showing a file feed by its file name with no stored value shown, logging that holds a code only, and the seams and admin-routes test changes that bound the writer (AC 37). ACs 1 to 9, 11 to 14, 37. Needs T3.7.1 for a feed that can be imported; may be built beside it.
3. **T3.7.3 frontend (size S). The form, the lists and the copy.** The source choice and file-name field in the feed form and its edit page, the AC 11 warning, a file feed shown correctly on `/admin/tiendas` and `/admin/categorias`, labels and errors tied to fields, the new copy in the admin message section. Needs T3.7.2 and the UX pass. ACs 1, 2, 10, 11, 38, 39.
4. **T3.7.4 test (size M). The coverage of the test plan above.** The tests not already carried by T3.7.1 and T3.7.2, in particular the import cases of ACs 18 to 25, the two-shop convergence of AC 30, the ignore-rule check of AC 31, the demo isolation of AC 35 and the sign-in-to-public-product e2e. Needs T3.7.1 to T3.7.3. Every AC; coverage per the test plan.
5. **T3.7.5 docs (size S). The owner's guide and the lagging records.** The written steps and the layout reference of ACs 40 and 41, and the reconciliation listed below. Needs T3.7.1 to T3.7.3 so it describes what was built.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `CLAUDE.md` § Commands: the catalogue-file steps and the folder (AC 40); § Stack line "Data source" only if the owner's call allows, since it is a Stack line.
- A layout reference for the owner under `docs/` (the canonical columns, `price` as IVA-included decimal text, `url` as the shop link, `ean` for convergence); the layout is today stated only in decision 0013 and the code.
- `docs/product/mvp.md` § Feed import ("reads each approved feed, CSV or XML from the network's URL") and § Shops and feeds are data (the feed form now takes a file source); both are the owner's to approve under mvp.md's own header.
- Decision 0017: its Consequences may note the folder; decision 0007's status line already says amended by 0017.
- `docs/product/stories/US-3.1-admin-feeds.md` (ACs 14, 16 and the Notes say the form takes an https address only), where OD-1 (a) changes them.
- `docs/design/system.md`, rows for the new form parts, from the UX pass.
- The backend, frontend and testing packs, for the conventions this story sets (a second feed source behind the one reading module, a git-ignored data folder with tests writing their own files).
- `messages/es-ES.json` admin section: the new copy, from the UX pass.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **Where the rulings land.** D-2: Scope Out (S3.8 stays Backlog). D-3: Standing constraints, ACs 14 to 17. D-7: Standing constraints, AC 39. D-8 A1: ACs 18 to 20. D-8 A2: ACs 18, 24. D-8 A4: Scope Out.
- **"Existing matching" means EAN only.** The issue says two shops' files converge "through existing matching". Matching step 2, brand and part number, has no code path today (`src/server/matching.ts` lines 9 to 10; the importer calls the matcher with an EAN and a brand only), and S7.1 (#40) is the open story that adds it. So AC 30 promises convergence only for a valid shared EAN. The 2026-11-19 recon said the importer matches "EAN, then brand + part number"; that was wrong, and the brief's Sequence (S7.1 after S3.7 so files without EANs converge) is the accurate statement. The guide (AC 40) tells the owner to put an EAN in the file.
- **Hide does not exist yet.** The board says an admin can hide any product or offer, but no writer exists (S2.4, #25); only the schema and the visibility scope know the flag. No AC here depends on it, and the two approvals are the whole of the admin's control over a file feed's products until S2.4 ships.
- **A file feed can't be registered by any screen today.** Read 2026-11-20: the feed form creates only the affiliate kind with an https address and a required network, and its edit action refuses any other kind. That is why OD-1 exists and why the story changes an admin screen under the recommended option.
- **The compose stack has no mount for an owner's folder.** `compose.yaml` mounts only the database volume and the Dockerfile copies only `demo/` into the image, so the Compose import (the form CLAUDE.md and the e2e setup use) cannot see a host folder today. AC 19 asks that it can, without the file entering the image.
- **A hand-written file of real prices can still be published by a careless deploy.** S12.2's flag covers collected rows only. Keeping the files out of git and the image (OD-2) and the Before going live list in `mvp.md` are what stand between a hand-written real catalogue and a public site; this story adds nothing that checks it.
- **Issue #303 was read as relayed into the run**, not from GitHub. The ACs that go beyond its outline are the refusal and traversal set (ACs 3, 20 to 23), the guard-test set (ACs 36, 37) and the owner's guide (ACs 40, 41).
