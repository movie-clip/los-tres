# Catalogue file: add real products by writing a file

Added by S3.7 (#303, run `2026-11-20-s3-7-catalogue-file`). This is the owner's guide to turning a spreadsheet you write into products and shop links on your local site. It uses only tools that already exist: the admin forms, the `import-feeds` command and the category screen.

A catalogue file is a **registered feed** like any other. Writing the file, registering the feed, importing it and mapping its categories each publish nothing by themselves. A product reaches the public pages only when its shop is approved, its feed is approved, the offer is not hidden and the product has a mapped category.

**Local only.** The admin area is password-only until S2.2. Do not deploy this setup or reach it from the internet before then.

## Rules that hold for every file

- **Never commit a real file.** The repository and the board are public. The folder's contents are git-ignored and kept out of the Docker image, but a real file of shop prices and links still names the shop: do not copy one into an issue, a test, a fixture or a doc. Use invented shops and products in anything that is committed.
- **No collected file in this folder.** A file made by the owner's local-only collector (decision 0017) goes in `collected-files/`, never here: see "Collected files (S12.2)" at the end. The app marks rows by the folder and the source a feed was registered with, so a collected file placed here imports unmarked, with no way to detect it, and with both approvals it would be public.
- **The app never fetches anything for this source.** It reads the file you placed and nothing else.

## 1. Write the file

A CSV or XML file, plain or gzip, in the same layout `import-feeds` already reads for any feed (decision 0013).

| Column | Required | What it is |
|---|---|---|
| `id` | yes | Your own key for the row, unique inside this file. A row with no id is rejected. |
| `title` | yes | The product name shown on the site. |
| `price` | yes | The **final price with IVA included**, as decimal text with at most two decimals, dot or comma: `12.99` or `12,99`. The page shows `12,99 €`. A price with more than two decimals, a thousands separator, a sign, an exponent or zero is rejected, never rounded. |
| `url` | yes | The shop link. The visitor's "Ir a la tienda" button goes to exactly this address through `/go/<offer>`, with nothing appended. It must start with `http://` or `https://`. |
| `ean` | no, but write it | The product's EAN (8 or 13 digits with a correct check digit; spaces and hyphens are ignored). **It is what makes two shops converge**: two files that carry the same valid EAN land on one product page that lists both shops, cheapest first. An invalid EAN rejects the row. A valid EAN can also be given to a product that has none (S7.6), see "When two files land on one product". |
| `brand` | no | The brand. With `part_number` it makes two files converge when they carry no EAN, see "When two files land on one product" below. Compared after trimming, collapsing inner spaces and upper-casing only: `Bosch` and `Robert Bosch` stay two products, and `Mann-Filter` and `Mann Filter` stay two (the hyphen counts). |
| `part_number` | no | The part number. Spaces, dots and hyphens are ignored and case does not matter (`OC 12.34` equals `oc-1234`). With `brand` it makes two files converge, see "When two files land on one product" below. |
| `description` | no | Product description text. |
| `currency` | no | Empty or `EUR`. Any other currency rejects the row. |
| `category` | no | A category word of your own, for example `Filtros de aceite`. It is mapped to one of the five categories in step 6. A row with no category, or one you have not mapped, is stored but not public. |
| `fitment` | no | Vehicle slugs from the site's own vehicle list, separated by `|`. An unknown slug is reported by the import and never rejects the row. |
| `viscosity` | no | Engine oil only: the SAE viscosity grade, for example `5W-30`, `10w40` or `SAE 15W 40`. Stored as `<winter>W-<hot>`. See "Engine-oil attributes" below. |
| `volume_l` | no | Engine oil only: the container volume **in litres**. A bare number is litres (`4`, `1,5`); an explicit unit is also read (`500 ml`, `75 cl`, `4 L`). |
| `acea` | no | Engine oil only: one or more ACEA sequences, for example `A3/B4`, `C2` or `A3/B4 + C2`. |
| `oil_type` | no | Engine oil only: the family of the oil, `Sintético`, `Semisintético` or `Mineral` (English words also read). |
| `approvals` | no | Engine oil only: manufacturer approvals as short text items separated by `;` (a comma also splits). |

That is sixteen columns: four required, seven optional product columns and the five optional engine-oil attribute columns, which an XML file carries as one element each (`<viscosity>`, `<volume_l>`, `<acea>`, `<oil_type>`, `<approvals>`). Header names are matched without regard to case or surrounding spaces, and extra columns are ignored. A missing required column fails the whole feed. CSV uses comma separators, double quotes for a field that holds a comma, and CRLF or LF line ends. A file over 50 MiB is refused.

A small invented example, one filter and one engine oil (the filter leaves the attribute columns empty):

```
id,title,brand,part_number,ean,price,url,category,viscosity,volume_l,acea,oil_type,approvals
a-001,Filtro de aceite de ejemplo,Marca Ejemplo,OC-0001,4006381333931,12.99,https://tienda-ejemplo.test/p/a-001,Filtros de aceite,,,,,
a-002,Aceite de motor de ejemplo 5W-30 4 l,Marca Ejemplo,AM-0530,,24.90,https://tienda-ejemplo.test/p/a-002,Aceite de motor,5W-30,4,C3,Sintético,Homologación demo 501; Homologación demo 502
```

### Engine-oil attributes (S15.3)

The five attribute columns are read from the cell and from nothing else: a title or description that names a grade, volume or norm is never read. Each value is read strictly, stored in one written form and shown on the product page; a value the rule cannot read is never stored, shown or printed, and the product keeps its category and its place in search. No cell, whatever it holds, rejects the row. A file with none of the five columns imports exactly as before. The reading rules are in `docs/product/category-attributes.md`; in short:

- **`viscosity`:** one of the 44 SAE pairings of 0W, 5W, 10W, 15W, 20W or 25W with 8, 12, 16, 20, 30, 40, 50 or 60 (not 25W-8, 25W-12, 25W-16 or 25W-20), with an optional `SAE` and a hyphen, dash, slash, space or nothing between the halves. A monograde grade, one half alone or two grades in one cell is not read.
- **`volume_l`:** litres, `0,1` to `220`, a dot or a comma with one to three decimals and no thousands separator (`2.000` and `2,000` are both 2 litres). Units read: `l`, `lt`, `lts`, `litro`, `litros`, `ml` and `cl`, in any case. A pack such as `4 x 1 l`, a range, a mass unit or a value out of range is not read. It is shown as `1,5 l`.
- **`acea`:** the twelve light-duty sequences A1/B1, A3/B3, A3/B4, A5/B5, A7/B7 and C1 to C7 (A1/B1, A3/B3 and C1 are withdrawn by ACEA but still read). Separate several with a comma, a semicolon, a plus, `y`, or a slash between two C sequences; an optional `ACEA` before each; a two-digit year suffix such as `-21` is ignored. A cell keeps the sequences it recognises and drops the rest; one with none is not read. The sequences are held in the order above, whatever order you wrote them.
- **`oil_type`:** the whole value, after case and accents are ignored and a leading `100%` and the word `base` are dropped, must be one of: `sintético`, `sintética` or `synthetic` (synthetic); `semisintético`, `semisintética`, `semi sintético`, `semi sintética`, `semi-synthetic` or `semi synthetic` (semi-synthetic); `mineral`. `aceite sintético`, two families or any other word is not read.
- **`approvals`:** a list of short text items, kept as you wrote them and in order. Separate with `;` (recommended) or a comma; a CSV cell with a comma must be quoted. Each item is trimmed, a repeat ignoring case and a blank item are dropped, an item over 60 characters is dropped (not cut) and at most 20 items are kept.
- **A blank is not an error.** An empty cell is simply absent and is not counted. The import counts only a non-blank cell that did not read (see "Unparsed attributes" in section 5).
- **A held value stays.** The first value that reads stays on the product. A later row, or a later import of an edited file, only fills an attribute the product does not hold yet, and never changes or clears one; a set (ACEA, approvals) is kept whole, so a second file with more items never adds one. A wrong value that was read correctly from your file cannot be edited in the admin: hide the product.
- **The creating row writes.** The row that creates a product writes its attributes at once, even while its shop is still unapproved, as it writes the title and the EAN. A later row fills only under the rule in "An empty EAN is filled" below: shop and feed approved, offer and product not hidden, offer not in review.

Rows are checked one by one. A rejected row is listed by record number and field while the other rows import; rejected rows alone do not make the command exit 1.

### When two files land on one product

A new offer is matched to a product in this order (decision 0008, S7.1):

1. **EAN.** If the row has a valid EAN and exactly one product holds it, the offer attaches there, unless both the row and the product name a brand and the brands differ.
2. **Brand and part number.** Only if no product holds the EAN (or the row has none), and the row has both a brand and a part number: the offer attaches to the one product with the same normalised brand and part number. Two rows of the same file with the same brand and part number also land on one product.

Limits:

- A row with no brand, or no part number, never converges by this step and becomes its own product.
- A row with an EAN does not join a product with the same brand and part number that carries a different EAN; it becomes its own product.
- A row with an EAN can join a product with the same brand and part number that has no EAN, and a row without an EAN can join one that has. The product keeps the text of the first file, except for an empty EAN (next bullets).
- **An empty EAN is filled (S7.6).** A product with no EAN takes the valid EAN of an eligible row of its own, either a new row that joins it or a row already stored, on the next ordinary `import-feeds`. A later row with that EAN and a different brand and part number then reaches the product by EAN. The row is eligible when its shop and its feed are approved, its offer is not hidden or in review, and the product is not hidden. A collected row fills only a product made from a collected row and a hand-written row only one made from a hand-written row, never across. Nothing fills while another product, hidden ones included, holds that EAN (the row's offer stays where it is, nothing is merged, nothing is printed). The first eligible row wins, and an EAN once set is never changed or cleared. A new row with a different EAN than the product now holds becomes its own product (`brand_part_number_ean_conflict`); a stored row with a different EAN stays where it is and prints nothing.
- **An absent engine-oil attribute is filled the same way (S15.3).** A product that holds no viscosity grade, volume, ACEA norm, oil type or approvals takes the value of an eligible row of its own that reads, on the next ordinary `import-feeds`, with no new command and no second import after mapping categories. The eligibility, the first-row-wins rule and the collected wall are those of the EAN fill above (a collected row fills only a collected product, never an unmarked one). Attributes fill one by one and never play any part in matching. A product that holds an attribute never changes it.
- Convergence never changes a product's title, brand, part number or description: the first file's text stays. It never changes an EAN or an engine-oil attribute that is set. A fill never approves, hides, unhides or maps anything, so it publishes nothing by itself.
- A product hidden by the admin still receives the offer and stays hidden. Convergence publishes nothing: the usual approvals and a mapped category still decide what is public.
- Matching ignores whether a product's own feed or shop is still approved (an EAN fill, by contrast, needs the approvals of the row's own shop and feed). A real row can attach to a product left by any disabled feed or shop, not only a demo one. The real row's offer is then the one that publishes the leftover product, under the first feed's title, brand and text: it goes public once the shop and feed of that real row are approved, the product has a mapped category and it is not hidden. The leftover's own feed and shop can stay disabled (decision 0008 records this as flagged, not addressed). Before the first import, look through `/admin/productos` for products left by feeds or shops you disabled. A different brand and part number is not enough to keep a row off them: step 1 runs first, so a row whose valid EAN one such product holds attaches to it whatever its brand and part number, unless both brands are known and differ. Only a row with no EAN, or with an EAN no product holds, is kept off by a brand and part number that none of them has. To be sure, use a fresh local database.
- Products and offers already stored are never re-matched or merged; the one exception is that a stored row may fill its product's empty EAN or an absent attribute (see above), which moves nothing. A hand file imported before S7.1 keeps its separate products, and a product whose stored brand or part number is empty is never found by step 2. For a clean result, use a fresh local database or hide the duplicates.

**A conflict is not a rejection.** When the EAN and the brand disagree, when two or more products hold the EAN, when two or more products hold the brand and part number, or when two different EANs sit on one brand and part number, the row is stored as its own product and its offer is counted in `products_created` and `offers_created`, not in `rejected`. The import prints one line per such row, with the record number and a fixed reason and nothing else from the file:

```
  record 2: own_product ean_brand_conflict
```

| Reason | What happened |
|---|---|
| `ean_brand_conflict` | One product holds the EAN and its brand differs from the row's. |
| `ambiguous_ean` | Two or more products hold the EAN. |
| `brand_part_number_ean_conflict` | No product holds the EAN, and the one product with this brand and part number carries a different EAN. |
| `ambiguous_brand_part_number` | Two or more products hold this brand and part number. |

Such a row does not fail the run (exit 0). It is an ordinary product, public only under the usual approvals and category mapping. A second import does not list it again. There is no review queue and no merge or split, so a duplicate product page is fixed by hiding the product at `/admin/productos`.

## 2. Name the file and place it in the folder

The folder is `catalogue-files/` at the repository root. It is the only folder catalogue files are read from. There is no setting, field or argument to name another.

**The file-name rule, in words.** Give the bare file name only, with no folder part. The name:

- is at most 100 characters;
- uses only letters without accents, digits, dots, hyphens and underscores (no spaces, no accents, no other character);
- ends in `.csv`, `.xml`, `.csv.gz` or `.xml.gz`, in upper or lower case, with at least one character before the ending;
- does not start with a dot and does not contain two dots in a row;
- has no `/`, `\` or `:` (so no path, no drive letter, no `https:` or `file:`);
- is not a reserved Windows device name such as `CON`, `NUL`, `COM1` or `LPT1` before the first dot.

`mi-catalogo.csv` is a good name. The file is found by its exact name, upper and lower case included, so type the name in the admin exactly as the file is called. A link or shortcut inside the folder that points elsewhere is not read.

`npm run import-feeds` and `docker compose run --rm app import-feeds` read the same file. The Compose service mounts the folder read-only, so there is no step beyond placing the file. The file is never copied into the Docker image or the build context.

**Once after pulling this change**, run `docker compose up -d` so the `app` service is recreated with the mount. Without it the Compose form cannot see the folder and reports `file_not_found`. A clone has the folder already (it holds only `.gitkeep`); the rest of its contents are ignored by git.

## Before the first real import: check the demo and local data

Do this once, on your local stack, before the first import of a real file (US-7.1 OD-3). Nothing here is a deploy step.

**Check the local database.** Products and offers already stored are never re-matched (the first import after S7.6 may fill an empty EAN of a stored product, and prints `  ean: filled=<n>` when it does), and the importer is the only writer of the normalised brand and part number that matching uses. Open `/admin/productos` and look for products you made with hand files before S7.1: the same part twice, or products with no brand or no part number. Those never converge with a new row and fail safe into a duplicate, never a wrong merge. The remedy is the one that exists: use a fresh local database, or hide the duplicates at `/admin/productos`.

**Demo products can absorb a real row.** The demo shops and products are ordinary rows in the database. A real row whose normalised brand and part number equal those of a demo product attaches to that demo product and the product keeps its demo title, brand and text (the first file's text stays). Hiding the demo product does not stop this: a hidden product still matches, so the real offer attaches to it and stays hidden, and unhiding the product later would publish that offer under the demo title, brand and text. Rows are never re-matched, so the only remedies are to avoid the collision (look through the demo products at `/admin/productos` and give your real rows a brand and part number that no demo product has) or to start from a fresh local database. The match by brand and part number happens only when the real row carries no valid EAN or the demo product has none; a demo product that carries a different EAN makes the row its own product (`brand_part_number_ean_conflict`), and every demo EAN starts with `200`. A demo product that has no EAN can also take the EAN of an eligible real row that attaches to it (S7.6), once your shop and feed are approved and the product is not hidden.

**Disable the demo shops for the check.** On `/admin/tiendas`, press "Desactivar tienda" on each of the four demo shops and confirm. There is no bulk control. A product with only demo offers then leaves every public page, search and `/go`; it was never in the sitemap. The demo rows stay stored, and an all-feeds import still reads the demo feeds: disabling a shop does not touch its feeds, which stay approved and show "Aprobado, en pausa". Nothing from them is public. The setting survives a restart.

**Approve them again afterwards.** When the check is over, press "Aprobar tienda" on each demo shop you disabled; if you disabled a feed instead of its shop, approve that feed again too. The local site shows no demo product until you do. `npm run gate` is not affected either way: its e2e run starts a stack of its own with a fresh database and never reads this one.

**The gate does not import your feed.** `npm run gate` imports feeds only into the database of its own e2e stack, which holds the demo feeds and nothing you registered, so your feed, approved or not, and a missing or broken file of yours cannot fail the gate. (`catalogue-files/` is still mounted read-only into that stack, and its catalogue-file spec writes and removes one file of its own there, `e2e-catalogo-fixed.csv`; do not use that name.)

## 3. Register the shop and the file feed

In the admin, on `/admin/tiendas`, signed in at `127.0.0.1` (see CLAUDE.md for the admin sign-in):

1. Create the shop (name and slug) if it does not exist. A new shop starts **unapproved**.
2. Add a feed for that shop: in "Origen del feed" choose "Archivo de catálogo" and type the file name in "Nombre del archivo". A file feed needs no network. The form does not check that the file exists; the file is read at import. A shop cannot have two feeds with the same file name.
3. The new feed also starts **unapproved**, even when its shop is approved.

Changing the file name of an **approved** file feed returns that feed to unapproved in the same save, and its offers leave the public site at once; the form warns before you submit. Saving the same name again changes nothing.

## 4. Approve the feed, not the shop yet

Approval is two separate actions on `/admin/tiendas`, and approving one does not approve the other. Do them in this order:

1. Press "Aprobar feed" on the new feed. **Leave the shop unapproved.** The import reads only approved feeds, so an unapproved feed cannot be imported and there would be no output to review. It checks the feed's approval only, never the shop's.
2. The feed now reads "Aprobado, en pausa" and the form says "Feed aprobado, pero en pausa: la tienda no está aprobada." That is the review window: the import runs and stores rows, but nothing is public, because a product is public only when both the shop and the feed are approved.
3. Approve the shop later, after the review (step 7).

## 5. Run the import

Either form, from the repository root:

```
npm run import-feeds
docker compose run --rm app import-feeds
```

To import one feed only, add `--feed <id>` (after `--` for npm). An unapproved file feed is reported skipped and its file is not read. For an approved one you get the usual line `feed <id> "<shop name>": imported rows=... products_created=... offers_created=... offers_updated=... offers_removed=... rejected=... unknown_vehicles=...`, then an indented line for each rejected row and for each row that became its own product (`record <n>: own_product <reason>`; the record number counts the header as record 1, so the first data row is record 2). Running it again on an unchanged file creates nothing new and changes only prices and dates.

**Filled EANs (S7.6).** When the import gave an EAN to products that had none, the feed prints one more indented line, `  ean: filled=<n>`, where `<n>` counts the products filled in that feed's import. It comes after the `own_product` lines and before the unknown-vehicle lines, and the `removal: skipped` line stays last. It is printed only when `<n>` is above 0, carries no row text, no EAN and no record number, and never changes the exit code. A refused fill (shop or feed not approved, offer or product hidden, another product holding the EAN, a different EAN already set) prints nothing, and a repeat import over the same file prints no `ean:` line again. The first import after you approve a shop is the one that fills from it, since the usual first import runs with the shop unapproved.

**Unparsed attributes (S15.3).** When accepted rows carried a value in one of the five attribute columns that the rules could not read, the feed prints one more indented line, for example:

```
  attributes: unparsed viscosity=2 volume_l=1
```

Each number is how many accepted rows carried an unreadable value in that column. Only the columns above 0 are listed, in the order `viscosity`, `volume_l`, `acea`, `oil_type`, `approvals`. The line comes after the unknown-vehicle (`fitment:`) lines and before the `removal: skipped` line, which stays last. It carries no row text, no value, no product and no record number, never changes the exit code, and is not printed when every value read, when the columns are blank or absent, or for a rejected row. A blank cell is not counted. An ACEA cell that held at least one recognised sequence is not counted, and an approvals cell is counted only when every item was dropped. A repeat import over the same file prints the same line. Look at which column is named and correct that column in the file; the stored product keeps the value it already holds.

**Rows you drop from the file.** An approved feed's offers that are not among the file's accepted rows are flagged removed and leave the site; `offers_removed` counts them. The row is not deleted, and a row rejected by validation counts as absent. If a later import has the row again, the offer is restored, with its clicks. An import never un-hides an offer you hid.

**The removal guard.** Removal is skipped, and everything else in the import still applies, when the file has no accepted row (`empty_import`), or when it would remove 10 offers or more and more than 50% of the feed's current offers (`small_import`). Then the last indented line is `  removal: skipped <reason> missing=<n> current=<n>` and a skip does not change the exit code (exit 1 still means a feed failed). If you really did shrink the file that much, run `npm run import-feeds -- --feed <id> --allow-large-removal` (or `docker compose run --rm app import-feeds --feed <id> --allow-large-removal`); it lifts `small_import` only, never `empty_import`. To take a whole feed off the site, unapprove it. A feed that failed removes nothing.

**Review while nothing is public.** With the feed approved and the shop still unapproved, read the import output (counts, rejected rows by record and field, `own_product` lines, any `removal: skipped` line, unknown-vehicle lines), then open `/admin/productos`, which lists these products although nothing is public, and `/admin/categorias` (step 6). Check the prices against the shop's own page by hand: the importer cannot tell whether a price includes IVA. Disable the feed again, or hide a product or offer, if something is wrong; approving after an import reads nothing again.

### When a feed fails

A failed feed prints `feed <id> "<shop name>": failed <code>`, the run goes on with the other feeds and the exit code is 1. No path is ever printed. The three codes this source adds:

| Code | What it means | What to do |
|---|---|---|
| `file_name_refused` | The stored file name is not a bare name by the rule above. The admin form cannot produce one, so the stored value was changed some other way. | Open the feed in `/admin/tiendas`, edit the file name to a valid bare name and approve the feed again. |
| `file_not_found` | The folder or a file with exactly that name is not there. Also shown when the folder cannot be read. | Check the file is in `catalogue-files/` and the name matches exactly, upper and lower case included. If you use the Compose form, run `docker compose up -d` once so the mount exists. |
| `file_refused` | The folder or the file is a link, the name is not a regular file, or the file changed while it was being opened. | Replace it with a real file placed directly in the folder, then run the import again. |

The importer's existing codes still apply to a catalogue file: `invalid_header` for a missing required column, `invalid_xml`, `invalid_gzip`, `too_large`, and `fetch_failed` for a read error.

## 6. Map the categories

After the first import, open `/admin/categorias`. Each distinct `category` string in the file appears under the file feed as **not reviewed**, with its product count. Map each to one of the five categories there. Saving applies at once to the products already imported; no second import is needed.

**Engine-oil attributes need no extra import either (S15.3).** The import reads and stores the attribute columns whatever a product's category, so the order is the one above: import (feed approved, shop not), map the categories, review, approve the shop. The attributes appear on the product page once the product is in "Aceite de motor" and public; mapping before or after the first import gives the same result. A product outside "Aceite de motor" never shows them, even when the file carries the columns.

A feed that has never been imported shows a note that there are no categories to assign yet.

## 7. Approve the shop, then check the product

When the review is done, press "Aprobar tienda" on the shop. With the shop approved, the feed approved and the category mapped, open the product on its category page or by search. The page lists each shop's price in euros, cheapest first, with a link to the shop through `/go/<offer>`. If it is not there, check in order: the shop is approved, the feed is approved, the category is mapped, the row was not rejected in the import output, the product or the offer is not hidden at `/admin/productos`, and the offer was not removed by an import (it is absent from the file, see "Rows you drop from the file").

## What S3.7 does not do

- **No delete of dropped rows.** An offer you drop from the file is flagged removed, not deleted, and a product stays stored (S3.3, see section 5); the guard can skip removal.
- **No brand alias and no re-matching.** `Bosch` and `Robert Bosch` stay two products (S7.3, deferred), and products already stored are never merged or re-matched (see "When two files land on one product"). What a join writes to a product is an empty EAN, filled once by an eligible row (S7.6, US-7.6), and an absent engine-oil attribute, filled once by the same rule (S15.3); there is no way in the admin to edit or clear an EAN or an attribute, so a wrong one is fixed by hiding the product.
- **Hide or unhide** a single product or offer at `/admin/productos` (S2.4, #25), after the import. A hidden item stays hidden through every later import; unhiding publishes nothing by itself, since the two approvals and a mapped category are still needed.
- **No upload, no preview, no "Import now" button, no row count and no file-exists check** in the admin; no images; no other column layouts (S3.5).
- **No revenue or disclosure wording** is written anywhere while everything is local.

## Collected files (S12.2)

Added by S12.2 (#306, run `2026-11-23-s12-2-local-only`, decision 0017). This is how to load a file made by your local-only collector into your local stack, and what keeps it off any public page. The collector itself is a separate tool in a separate private repository; nothing here fetches anything.

A collected file goes through the same steps as a catalogue file above (columns, file-name rule, import, categories), with these differences.

1. **The folder.** Put the file in `collected-files/` at the repository root, never in `catalogue-files/`. Like the catalogue folder it holds only `.gitkeep` as a tracked file, its other contents are git-ignored and kept out of the Docker build context and image, and `compose.yaml` mounts it read-only into `app` at `/app/collected-files`. A collected feed reads only this folder and a catalogue feed only the other. **Never commit a collected file** (the repository and the board are public).
2. **The source.** On `/admin/tiendas`, add the feed with "Origen del feed" set to "Archivo recopilado (solo local)" and type the bare file name. The name rule, the file never being checked at save, the two separate approvals (feed first, shop after the review) and the rename-returns-to-unapproved rule are the same as for a catalogue file. A feed's source cannot be changed after it is created. The importer marks every row of a collected feed as collected; the folder and the source decide that, so a collected file registered as "Archivo de catálogo" imports unmarked and nothing can detect it. The form's hint under that option says so.
3. **The local flag ("el ajuste local").** Put `LOCAL_COLLECTED_DATA=true` in your local `.env`, and only there. It is on only for the value `true`, in any case, with spaces trimmed; anything else, or no line, is off. `.env.example` and `npm run env:init` do not write it and Compose defaults it to `false`. A changed value takes `docker compose up -d`, not a rebuild.
4. **Once after pulling this change**, run `docker compose up -d` so `app` is recreated with the `collected-files/` mount and the flag pass-through. Without it the Compose form of `import-feeds` reports `file_not_found` for a collected feed. `npm run import-feeds` reads the folder on the host and needs no such step.
5. **What the flag does.** It lifts the exclusion of collected rows on your local site, and nothing else. The feed and the shop still need their approval, hide, review, removal and the category mapping still apply, exactly as for any feed. Without the flag a collected row is on no public page, search, `/go` link or count, and the import and the admin screens still show it. The admin does not show whether the flag is on: a collected feed that is approved and mapped but shows nothing locally usually means the flag is off, or `SITE_URL` is not a loopback origin (next point).
6. **The refusal.** With the flag on and `SITE_URL` not a loopback origin (`localhost`, an address in `127.0.0.0/8`, or `[::1]`, with `http` or `https`; unset, blank or unparsable counts as not loopback), the app does not start. The container `server` verb, `npm run dev`, `next start` and `node server.js` exit 78 and print this one line, which names the two settings and never a value:

   ```
   start refused: LOCAL_COLLECTED_DATA is on and SITE_URL is not a loopback origin
   ```

   In the container the check runs before the migration. `migrate`, `seed`, `import-feeds` and `create-admin` do not refuse. As a second layer, whenever `SITE_URL` is not loopback the flag counts as off on every request, whatever `.env` says. The fix is to set `SITE_URL` back to `http://127.0.0.1:<APP_PORT>` or to remove the flag. Never set both on a deployed site.
7. **Never indexed, never counted.** Collected rows are `noindex`, out of the sitemap and never a counted click, whether the flag is on or off. Their `fitment` never counts toward a car match. A collected row's engine-oil attributes go only on collected products and never fill a hand-written product, and no hand-written row's attributes fill a collected one; the flag only decides what is shown, never whether a fill happens. A hand-written row never attaches to a collected product (a collected row can attach to a hand-written product as an offer); a collected row never sets or moves a hand-written product's category.
8. **The flag covers collected files only.** A hand-written real catalogue on a careless deploy is still your care and the Before-going-live list in `docs/product/mvp.md`.
9. **Public use needs a new owner decision.** Showing collected data on a public site is forbidden by decision 0017 until the owner records a new decision; nothing in S12.2 allows it.

The refusal, exit 78 and the one fixed line are covered by `tests/e2e/collected-start.spec.ts`.
