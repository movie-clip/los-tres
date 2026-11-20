# S3.1 Admin manages networks, shops and feeds

Status: approved 2026-11-18 (the human, D-11; board status Ready follows the human's own move)
Amended 2026-11-20 by S3.7 (`US-3.7-catalogue-file.md`, run `2026-11-20-s3-7-catalogue-file`): the feed form now also offers a catalogue-file source with no network. AC 14 ("the form offers no other source type") and AC 16 (https only) hold for the https source only; the https source still requires a network (AC 15). The prerequisite that a feed needs a network no longer blocks the form: only a missing shop does, and a missing network is shown inline for the https source (AC 38 amended). The ACs below are left as approved.
Epic: E3 (#11) · Iteration 3 · Priority: P0 · Size: M
Issue: #26 · Tickets: #85-#87 (T3.1.1-T3.1.3)
Depends on: S2.1 and S2.3, both shipped (the admin shell, the server-side guard, and `/admin/tiendas` with its approve and disable toggles). No open dependency. S3.1 does not wait for S3.5 or S4.2.
Source: the approved delivery brief and the human's rulings D-1 to D-18 of run `2026-11-18-s3-1-admin-feeds`; issue #26 and tickets #85-#87 as pasted into that run; `docs/product/mvp.md` § Shops and feeds are data, § Admin area, § Prototype phase; decisions 0007 and 0013; `docs/product/stories/US-2.1-admin-sign-in.md` (admin story shape and the local-only rule); guardrails 1, 3 and 5.

## Standing constraints

These bind this story and everything built from it.

- **Local-only until S2.2.** The admin area is still password-only (US-2.1 D-4). Nothing built here is deployed to the VPS or reachable from the internet before S2.2 (#23) is done.
- **Feed URLs are stored in plain text until S10.3.** A feed URL may hold a network API key. S3.1 does not encrypt it (mvp.md § Prototype phase, issue #26); it is masked on display and never logged (guardrail 5). This is acceptable only because of the local-only rule above.
- **Registering a feed here does not put a real shop on the site (D-6).** Two other stories stand between an approved real feed and visible offers: S3.5 (the importer reads only canonical column names today) and S4.2 (a feed's categories are mapped only by the seed today, and a product from an unmapped category is not public; **updated 2026-11-19, S4.2 shipped in run `2026-11-19-s4-2-category-mapping`: the admin now maps each feed category at `/admin/categorias`, so only S3.5 and the admin's approvals still stand between a real feed and visible offers**). The owner accepted this order. No text this story adds may promise otherwise (AC 40).

## Open decisions

None. D-1 to D-10 are ruled or accepted by the human and are not reopened here. D-11 approved this story, and D-12 to D-18 settled what the draft had to assume or had left uncovered. Each is stated in the AC named; a different answer changes only those ACs.

1. **D-12. The demo slugs are reserved (AC 46).** The forms refuse a network slug `demo` and a shop slug beginning `tienda-demo-`, so an admin row can never collide with the seed's rows whether or not the seed is on.
2. **D-13 (was A-1). A demo feed's network stays editable (AC 22).** D-9 makes a demo feed's URL read-only; D-10 makes a feed's network editable; D-10 applies to demo feeds too.
3. **D-14 (was A-2). A refused submission never refills the URL field (AC 27).** D-3 says the edit form never prefills the URL; this extends it to the create form and to any form re-shown after a refusal, so a key typed by the admin is not echoed into the page.
4. **D-15 (was A-3). Any non-empty URL in the edit form counts as replacing the URL, even if identical to the stored one (ACs 19, 20).** The admin cannot see the stored value, so the form cannot tell that the same one was re-entered.
5. **D-16 (was A-4). The marker of a demo shop or network disappears once a non-demo feed is added to it (AC 35).** This follows from D-8's derivation (demo when every feed is demo). The form does not forbid adding a real feed to a demo shop.
6. **D-17 (was A-5). Shop and network names need not be unique; slugs must be (ACs 8, 12).**
7. **D-18 (was A-6). The guard tests that must change (ACs 30 to 33) change in the same ticket as the writer and actions they bound, T3.1.1 (#85),** because the gate fails otherwise.

The labels A-1 to A-6 are kept in the ACs below, as references to D-13 to D-18 in that order.

## Story

As an admin, I add a network, a shop and a feed from the admin area without a code change, and edit them later. A new shop and a new feed start unapproved, a feed's URL is never shown to me beyond its host, and nothing I register reaches the public site until I approve it.

Today a network, a shop or a feed exists only if the seed or a SQL statement put it there, and `/admin/tiendas` can only approve or disable what already exists. After this story an admin registers a real affiliate source and fixes a typo or rotates a feed key by editing, with no developer. Because there is no delete (D-7), editing and the existing disable are the whole of correcting a mistake.

## Scope

In:

- Create, edit and list for networks (name, slug), shops (name, slug) and feeds (shop, network, URL), on the existing `/admin/tiendas` page.
- Validation: a https URL without credentials, a network required for the affiliate feed the form creates, unique slugs, the existing unique shop-and-URL pair.
- A new shop and a new feed start unapproved; replacing the URL of an approved feed returns it to unapproved (D-4, D-5).
- The feed URL shown as its host only, never prefilled in a form, never in a log, an error or a client payload (D-3).
- Seeded demo rows kept and visibly marked demo, the marker derived (D-8); a demo feed's URL read-only (D-9).
- The demo slugs reserved, so no admin-made row can collide with a seeded one (D-12).
- A server role check on every new action; the deliberate changes to `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` that bound where a feed URL may be read.

Out, nearest first (listed so a lane does not do them here):

- Delete of any shop, feed or network (D-7). Disable, from S2.3, is the only removal.
- A field-mapping choice, column or editor on a feed or a network (D-2; S3.5 owns it, keyed by the network). S3.1 records the link to the network and nothing more.
- The "Import now" button and import reports (S3.2); category mapping (S4.2); per-shop link patterns (S3.6); shop logos (S8.2); feed URL encryption (S10.3); shop-submitted feeds (out of the MVP).
- A feed name or label field, and any change to the approve and disable toggles, the confirm panel or the visibility rules of S2.3.
- Any form for a feed of source type `shop_upload`, and any way to set the demo flag.
- The technical contract, the file layout, columns and any migration (the tech lead's); the Spanish copy and layout (the UX pass's).

## Acceptance criteria

"The admin" is a signed-in admin. A "refusal" is a message in Spanish next to the field at fault, a row not written or changed, and an answer that is not a server error. Copy in these ACs is intent only; the wording and layout are the UX pass's. A feed's "host" is its host name alone.

Access and safety (guardrail 3)

1. Every action this story adds (create and edit of a network, a shop and a feed) refuses a request with no session, a forged cookie, an expired cookie or a signed-out cookie, has no effect, and checks the role before it reads or writes anything else, including when called directly with a crafted request and not from the page.
2. Every such action refuses a submission from another origin and has no effect.
3. Any new admin page or route this story adds (for a form, if the design gives one its own page) carries the same server-side check, `noindex` and no-store signals as the existing admin pages, and sets no cookie.
4. A crafted submission cannot set what the forms do not offer: the approval state of a new row, the demo flag, a source type other than the affiliate network one, a different slug on an existing network or shop, or a different shop on an existing feed. Such extra fields are ignored or refused, the row is created or changed only as the form allows, and a created feed and shop are unapproved.
5. A submission naming a shop or a network that does not exist is refused and writes nothing.

Networks

6. The page lists every network with its name, its slug and a demo marker where AC 35 gives one. With no network it says so, and still offers the create control (AC 38).
7. The admin can create a network by giving a name and a slug; it then appears in the list and in the network choice of the feed form. A network has no approval state, and creating one changes nothing the public sees (AC 44).
8. A network is refused when its name is empty or only blank space or too long, or when its slug is empty, is not of the shape of the existing slugs (lowercase letters, digits and hyphens), or is already used by another network, including when two submissions with the same slug arrive at the same moment (exactly one is created).
9. The admin can change a network's name. A network's slug is not editable: the form offers no control for it, and a crafted request that carries another slug leaves it unchanged.

Shops

10. The page lists each shop with its name, its slug and a demo marker where AC 35 gives one, with the S2.3 approve and disable controls and states exactly as they are today.
11. The admin can create a shop by giving a name and a slug. The new shop starts unapproved and has no feed, and the page shows it as unapproved (D-5). Approving it is the separate, existing S2.3 action; a new shop's feeds therefore need two approvals, the shop's and the feed's.
12. A shop is refused on the same name and slug conditions as AC 8, its slug being compared with the other shops' slugs, including when two submissions with the same slug arrive at the same moment.
13. The admin can change a shop's name. A shop's slug is not editable (same terms as AC 9), and editing the name does not change the shop's approval state.

Feeds

14. The admin can create a feed by choosing an existing shop and an existing network and giving a URL. The new feed has the affiliate-network source type, is unapproved even when its shop is approved, and is not a demo feed (D-5). The form offers no other source type.
15. A feed submitted without a network is refused with a message about the network, before any database constraint answers (the constraint stays as the backstop).
16. A feed URL is accepted only when it is a well-formed address that starts with `https` and has a host and carries no user name or password (D-9). A URL that is empty, malformed, relative, `http`, `demo-feed:`, any other scheme, or that carries credentials, or that is too long, is refused. The refusal message does not repeat the value.
17. A second feed with the same shop and the same URL as an existing one is refused, including when two such submissions arrive at the same moment (exactly one is created), and the message does not repeat the URL.
18. The admin can change an existing feed's network (a network is still required) and replace its URL. A feed's shop is not editable: the form offers no control for it and a crafted request carrying another shop leaves it unchanged. No form, list or field on the page offers choosing, naming or showing a field mapping for a feed or a network (D-2).
19. Submitting the edit form with the URL field empty leaves the stored URL and the feed's approval state unchanged and applies the other fields. Submitting a valid URL replaces the stored one, even when it is identical to the old one (A-3).
20. When the URL of an approved feed is replaced, the feed becomes unapproved in the same write as the new URL: no moment exists in which the new URL is approved. Its offers leave every public page, the sitemap and `/go` at once, as for any disabled feed, until an admin approves it again (D-4; guardrail 1). The URL of an unapproved feed stays unapproved when replaced, and changing only the network of an approved feed leaves it approved.
21. When the feed being edited is approved, the edit form says, before it is submitted, that replacing the URL returns the feed to unapproved.
22. A demo feed's URL is read-only: the form offers no control to replace it and a crafted request that carries one leaves it unchanged (D-9). The rest of a demo feed's edit follows ACs 18 to 20 (A-1).

The feed URL stays masked (guardrail 5; D-3)

23. In every list, each non-demo feed shows its host and nothing else of its URL: no scheme, port, user name, password, path or query, and no part of a key.
24. A feed whose stored URL cannot be read as an address with a host (the `demo-feed:` ones, or any other value) shows no host, and the raw stored value is never shown in its place.
25. No admin page's HTML, no data sent to the browser for a client component, no form field, hidden or visible, no action response, redirect target, notice or error message ever contains a feed URL beyond the host of AC 23, whether the action succeeded, was refused or failed.
26. The edit form's URL field is empty when the form opens and says that leaving it empty keeps the current URL (D-3).
27. After a refused submission, the form comes back with the URL field empty, so a typed value is not echoed into the page (A-2).
28. No page render, action success, refusal or failure writes a feed URL, any part of one, or an API key to any log or console output; an action writes only a fixed line and an error code. A test plants a recognisable key in a feed URL and finds it nowhere in the captured output.
29. If the database cannot be reached or a write fails, the admin sees the existing admin error screen or message, nothing is changed or half-changed, and the log line carries a code only.

Guards in the test suite (deliberate changes, bounded)

30. `tests/unit/seams.test.ts` is changed so that insert and update of the shops, feeds and networks tables are allowed only in a closed, named list of files: the admin writer module that holds today's approval writers, and the places the seed and the importer already write; any other file, new or old, that writes them fails the test. The test still finds the writer module and fails if the module no longer writes all three tables (it is not vacuous).
31. `tests/unit/seams.test.ts` replaces its current rule that no file under `src/server/admin` or `src/app/admin/(shell)/tiendas` may name a feed URL with a bounded one: a feed URL may be read only in the admin writer module and in one masking function that returns the host and nothing else; no other file under those folders names it; and no client component file names it or receives it as a value. The test finds both files and fails if either is gone.
32. `tests/unit/seams.test.ts` fails if any file under `src` deletes from the shops, feeds or networks table (D-7), so a later change cannot add a delete without a deliberate edit of the test.
33. `tests/integration/admin-routes.test.ts` replaces its assertion that the sources actions file exports exactly two actions with one that names the full set this story's design settles, and keeps asserting that every server action calls the role check first and acts on its refusal, and that every admin page, layout and metadata function is guarded. An action added later and not named fails it.
34. No control, link, route or action in the admin area deletes a shop, a feed or a network; the only removal is the S2.3 disable (D-7).

Demo rows

35. The seeded demo network, shops and feeds remain after the seed and the import, and the lists mark them as demo. A feed is marked demo as today. A shop or a network is marked demo when it has at least one feed and every one of its feeds is a demo feed; a row the admin creates through the forms is never marked demo, and no form sets the demo flag (D-8). A demo shop given a non-demo feed therefore loses its marker (A-4).
36. Starting the app with `SEED_DEMO_DATA=true` after an admin renamed a demo shop or network does not rename it back and does not add a second row for it; an admin's disable of a demo row still survives a restart, as today.

The page and its copy

37. Every list and form of this story is reached from `/admin/tiendas`, and the admin navigation gains no link to a page that does not exist.
38. With no shop, no network or no feed, the page renders without error and shows an empty message for each list that has none, with the create control for it. When no shop or no network exists, the feed form says which one is missing instead of offering an empty choice.
39. All visible text this story adds comes from the es-ES message files, in the admin section kept apart from the public sections, with no inline user-facing strings.
40. No text this story adds or changes on the page says or implies that approving a registered feed makes its offers appear (D-6); the existing sentence that a new feed starts unapproved stays true and in place.
41. Every form field has a visible label, each refusal message is tied to its field so assistive technology reads it with that field, and every control is reachable and operable from the keyboard alone.
42. The lists and forms show no sideways scroll and no cut-off text at 390 and 1280 px, with the longest host and the longest name the validation accepts, and the existing admin reflow checks still pass.
43. A successful create or edit tells the admin in words that the row was created or saved, and the row then appears or reads as changed in its list.

Public site unaffected (guardrail 1)

44. Creating a network, a shop or a feed changes no public page, no sitemap file and no `/go` answer, and a public page still sets no cookie. Editing a name changes only that name wherever it is shown; the only edit that removes anything from the public site is the URL replacement of AC 20.
45. The S2.3 behaviour is unchanged: the approve and disable actions, the confirm panel on disable, the paused state and the visibility reach proven in `tests/integration/admin-sources.test.ts` and `tests/e2e/admin-sources.spec.ts`. Those tests keep passing without being loosened, except the one e2e assertion that the page carries no feed URL, which becomes "no feed URL beyond the host and no secret-looking value" (AC 23, 25).

Reserved demo slugs (D-12)

46. The network form refuses the slug `demo`, and the shop form refuses any slug that begins `tienda-demo-`, with a refusal naming the slug field, whether or not a row with that slug exists and whether or not `SEED_DEMO_DATA` is on. A crafted request is refused the same way, and no row is written. The seeded demo rows are not affected.

## Left to the tech lead

Decided in the design pass, within the ACs above, and recorded there:

- the contract: whether the forms live on the sources page or on their own routes, the actions and their names, the data writer, the schema if the derived demo marker proves costly (migration `0007` is the fallback; the observable result stays AC 35), the shape of the host-only masking function, and where the URL is read for the importer and the seed;
- how the un-approval of AC 20 and the write of the new URL are made one write, and how the unique slug and unique shop-and-URL races of ACs 8, 12 and 17 are settled;
- the exact slug rule (it must accept every existing slug, and the reserved values of AC 46 are exempt from that) and the length limits of names and URLs;
- the shape of the closed writer list of AC 30 and the named action set of AC 33, and which ticket carries them (A-6);
- how the page keeps a feed URL out of the data sent to client components (AC 25, 31).

Left to the UX pass (direction: changed, since the existing page gains forms; `docs/design/system.md` has no row for a multi-field form, a select or a masked-value display, and the pass adds them): where the forms and lists sit on the page and how the three entities are grouped, the wording of every label, message and the AC 21 warning, how the demo marker reads, and the empty states.

## Test plan

Test files and names are the test lane's after the tech lead's design. Coverage required, by behaviour:

| ACs | Check |
|---|---|
| 1 to 5 | integration (database), in the pattern of the actions as a signed-in admin in `tests/integration/admin-sources.test.ts` and the support in `tests/support/admin.ts`: every new action refused for no, forged, expired and signed-out cookies and for a cross-origin submission, with no row written; the crafted-field cases of AC 4 and a missing shop or network of AC 5 |
| 6 to 13 | integration for networks and shops: create, the refusal cases (blank, too long, bad shape, duplicate slug, two simultaneous submissions), name edit, slug unchanged by a crafted edit, a new shop unapproved, an edit leaving approval unchanged |
| 46 | integration for networks and shops: the slug `demo` and `tienda-demo-` values refused with the seed on and off and by a crafted request, with nothing written; an ordinary slug that merely contains `demo` elsewhere (not as the reserved prefix or value) accepted; the seeded rows untouched |
| 14 to 22 | integration for feeds: create unapproved under an approved shop, network missing, every URL case of AC 16 (a table of accepted and refused values, including a `demo-feed:` value and credentials), duplicate and simultaneous duplicate, edit with the URL empty, URL replaced on an approved feed making it unapproved in one write and dropping its offers from a public reader, a demo feed's URL unchanged by a crafted request, the shop unchanged by a crafted request |
| 23, 24, 26, 27 | a unit test of the masking function over a table: a key in the query, user and password, a port, a path, upper-case host, an unreadable value, a `demo-feed:` value, an empty string; and an integration or e2e check of the edit form and of a refused submission |
| 25, 28, 29 | integration in the pattern of `tests/integration/admin-logs.test.ts`: a planted key in a feed URL is absent from captured output for success, refusal and write failure, and from the rendered page, the data sent to client components and every action response; a failing write leaves nothing half-changed |
| 30 to 33 | `tests/unit/seams.test.ts` and `tests/integration/admin-routes.test.ts` as changed by the story; each new rule is shown to fail on a deliberate offender fixture where the existing seam tests already do so |
| 34 | the delete seam of AC 32, and the e2e below finding no delete control |
| 35, 36 | the existing `tests/integration/seed.test.ts` extended: derived marker for the demo shop and network, never for a created row, lost after a non-demo feed is added; a rename and a disable surviving a second seed with no duplicate |
| 37 to 43 | e2e in `tests/e2e/admin-sources.spec.ts` against the Compose stack: create a network, a shop and a feed through the forms; the new feed and shop shown unapproved; the host shown and no more of the URL in the HTML; approve the shop and the feed; replace the URL and see the feed unapproved; the edit form's empty URL field; empty states; keyboard and field labels; reflow at 390 and 1280 px with the longest values; no copy promising offers (with `tests/unit/admin-copy.test.ts` for AC 39, 40) |
| 44, 45 | e2e or integration: a public page, the sitemap and `/go` unchanged after a create; the S2.3 tests unchanged and passing |

Existing tests this story reviews and changes by design, not loosens: `tests/unit/seams.test.ts` (ACs 30 to 32), `tests/integration/admin-routes.test.ts` (AC 33), the one assertion of `tests/e2e/admin-sources.spec.ts` that no feed URL is on the page (AC 45), and any seed or demo test that pins the number of networks, shops or feeds.

## Tickets

Ordered, contracts before consumers. Phases before the first ticket, dispatched by the orchestrator and not tickets: the human approves this story; a UX pass (direction: changed) fixes the forms, the lists, the marker and the copy; a design pass (tech lead) fixes the contract. The design pass may merge, split or rename the tickets, and the build order inside T3.1.1 is networks, then shops, then feeds (a feed needs a shop and a network). No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates.

1. **T3.1.1 (#85) backend. Create and edit actions, writer, validation and the masking read for networks, shops and feeds.** The role and origin check on every action, creation and edit of the three entities, the validation of ACs 8, 12, 15 to 17, the un-approval write of AC 20, the host-only masking, the derived demo marker in the list read, logging that holds no URL, and the deliberate seams and admin-routes test changes that bound them (A-6). ACs 1 to 5, 7 to 9, 11 to 20, 22, 25, 28 to 36, 44 to 46.
2. **T3.1.2 (#86) frontend. Forms and lists with the masked feed URL.** The create and edit forms and lists for the three entities on `/admin/tiendas`, the host display, the empty URL field and its note, the AC 21 warning, the demo marker, empty states, labels and errors tied to fields, the success feedback, the new copy in the admin message section. Needs #85 and the UX pass. ACs 6, 10, 21, 23 to 27, 37 to 43.
3. **T3.1.3 (#87) test. Role checks, validation, URL never in logs, and the sign-in-to-feed e2e.** The coverage of the test plan above, for the tests not already carried by #85. Needs #85 and #86. Every AC; coverage per the test plan.

## Docs to reconcile at close-out

Listed for the docs lane, which reconciles from the actual diff. None is made by this story's drafting.

- `docs/design/system.md`: rows for a multi-field admin form, a select and the masked-value display, from the UX pass.
- `docs/product/mvp.md` § Shops and feeds are data and § Admin area: record that networks, shops and feeds are now created and edited in the admin area, that a demo marker is derived, and that a feed URL is masked at display. Its field-mapping line, `US-5.6-import-fitment.md` and `US-5.9-product-fit.md` agree (s3-1-follow-ups D-2): S3.5 maps columns in code, chosen by the network, with no admin screen.
- `docs/product/mvp.md` line 146 (an offer missing from the latest import is removed) disagrees with the importer, which deletes only fitments; noticed by the framing lane, outside S3.1, to be routed to the owner.
- Issue #26's outline line "A feed names its network's field mapping (S3.5)" is dropped by D-2; the orchestrator updates the issue and the board.
- `CLAUDE.md`: a short sentence under the admin sign-in section that the admin can register networks, shops and feeds and that registering one publishes nothing, only if the docs lane judges the section the place for it; otherwise no change identified.
- the backend, frontend and testing packs, for the conventions this story sets (a closed writer list and a host-only masking function in the seams test; a form whose secret field never prefills or refills).
- `messages/es-ES.json` admin section: the new copy, from the UX pass.
- This story file is not an index and is not edited by the docs lane except for its status.

## Notes for the human

- **Where the rulings land.** D-1 (approve scope): the Scope list, ACs 6 to 22. D-2 (no field mapping): Out, AC 18. D-3 (masked URL, no prefill): ACs 23 to 28. D-4 (URL edit unapproves): ACs 20, 21. D-5 (new shop unapproved): ACs 4, 11, 14. D-6 (no promise of publication): Standing constraints, AC 40. D-7 (no delete): Out, ACs 32, 34. D-8 (derived demo marker): ACs 35, 36. D-9 (https only, demo URL read-only): ACs 16, 22, 24. D-10 (what is editable): ACs 4, 9, 13, 14, 18, 22. D-11 approved the draft; D-12 (reserved demo slugs): AC 46; D-13 to D-18 confirm the assumptions A-1 to A-6 (ACs 22, 27, 19 and 20, 35, 8 and 12, and 30 to 33).
- **Issue #26 and the tickets #85 to #87 were read as pasted into the run.** The issue's own acceptance outline is the source of the scope; the ACs that go beyond it are AC 20 (the un-approval), AC 36 (seed restart) and AC 46 (reserved demo slugs).
- **After S3.1 a real feed is registrable and approvable but not importable or visible.** The S3.5 and S4.2 order is the owner's to schedule; see Standing constraints. Updated 2026-11-19: S4.2 shipped (run `2026-11-19-s4-2-category-mapping`); the admin maps categories at `/admin/categorias`, saving re-applies to existing products at once, and the S3.5 half of this note still stands.
