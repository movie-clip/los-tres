# Catalogue file: add real products by writing a file

Added by S3.7 (#303, run `2026-11-20-s3-7-catalogue-file`). This is the owner's guide to turning a spreadsheet you write into products and shop links on your local site. It uses only tools that already exist: the admin forms, the `import-feeds` command and the category screen.

A catalogue file is a **registered feed** like any other. Writing the file, registering the feed, importing it and mapping its categories each publish nothing by themselves. A product reaches the public pages only when its shop is approved, its feed is approved, the offer is not hidden and the product has a mapped category.

**Local only.** The admin area is password-only until S2.2. Do not deploy this setup or reach it from the internet before then.

## Rules that hold for every file

- **Never commit a real file.** The repository and the board are public. The folder's contents are git-ignored and kept out of the Docker image, but a real file of shop prices and links still names the shop: do not copy one into an issue, a test, a fixture or a doc. Use invented shops and products in anything that is committed.
- **No collected file before S12.2.** A file made by the owner's local-only collector (decision 0017) does not go in this folder until S12.2 (#306) ships. S12.2 adds the marker that keeps collected rows off public surfaces; S3.7 has no marker and cannot tell a hand-written file from a collected one.
- **The app never fetches anything for this source.** It reads the file you placed and nothing else.

## 1. Write the file

A CSV or XML file, plain or gzip, in the same layout `import-feeds` already reads for any feed (decision 0013).

| Column | Required | What it is |
|---|---|---|
| `id` | yes | Your own key for the row, unique inside this file. A row with no id is rejected. |
| `title` | yes | The product name shown on the site. |
| `price` | yes | The **final price with IVA included**, as decimal text with at most two decimals, dot or comma: `12.99` or `12,99`. The page shows `12,99 €`. A price with more than two decimals, a thousands separator, a sign, an exponent or zero is rejected, never rounded. |
| `url` | yes | The shop link. The visitor's "Ir a la tienda" button goes to exactly this address through `/go/<offer>`, with nothing appended. It must start with `http://` or `https://`. |
| `ean` | no, but write it | The product's EAN (8 or 13 digits with a correct check digit; spaces and hyphens are ignored). **It is what makes two shops converge**: two files that carry the same valid EAN land on one product page that lists both shops, cheapest first. An invalid EAN rejects the row. |
| `brand` | no | The brand. With `part_number` it makes two files converge when they carry no EAN, see "When two files land on one product" below. Compared after trimming, collapsing inner spaces and upper-casing only: `Bosch` and `Robert Bosch` stay two products, and `Mann-Filter` and `Mann Filter` stay two (the hyphen counts). |
| `part_number` | no | The part number. Spaces, dots and hyphens are ignored and case does not matter (`OC 12.34` equals `oc-1234`). With `brand` it makes two files converge, see "When two files land on one product" below. |
| `description` | no | Product description text. |
| `currency` | no | Empty or `EUR`. Any other currency rejects the row. |
| `category` | no | A category word of your own, for example `Filtros de aceite`. It is mapped to one of the five categories in step 6. A row with no category, or one you have not mapped, is stored but not public. |
| `fitment` | no | Vehicle slugs from the site's own vehicle list, separated by `|`. An unknown slug is reported by the import and never rejects the row. |

Header names are matched without regard to case or surrounding spaces, and extra columns are ignored. A missing required column fails the whole feed. CSV uses comma separators, double quotes for a field that holds a comma, and CRLF or LF line ends. A file over 50 MiB is refused.

A small invented example:

```
id,title,brand,part_number,ean,price,url,category
a-001,Filtro de aceite de ejemplo,Marca Ejemplo,OC-0001,4006381333931,12.99,https://tienda-ejemplo.test/p/a-001,Filtros de aceite
```

Rows are checked one by one. A rejected row is listed by record number and field while the other rows import; rejected rows alone do not make the command exit 1.

### When two files land on one product

A new offer is matched to a product in this order (decision 0008, S7.1):

1. **EAN.** If the row has a valid EAN and exactly one product holds it, the offer attaches there, unless both the row and the product name a brand and the brands differ.
2. **Brand and part number.** Only if no product holds the EAN (or the row has none), and the row has both a brand and a part number: the offer attaches to the one product with the same normalised brand and part number. Two rows of the same file with the same brand and part number also land on one product.

Limits:

- A row with no brand, or no part number, never converges by this step and becomes its own product.
- A row with an EAN does not join a product with the same brand and part number that carries a different EAN; it becomes its own product.
- A row with an EAN can join a product with the same brand and part number that has no EAN, and a row without an EAN can join one that has. The product keeps the text of the first file, so in the first case it still has no EAN, and a later row with that EAN and a different brand and part number does not reach it by EAN.
- Convergence never changes a product's title, brand, part number, EAN or description: the first file's text stays.
- A product hidden by the admin still receives the offer and stays hidden. Convergence publishes nothing: the usual approvals and a mapped category still decide what is public.
- Products and offers already stored are never re-matched or merged. A hand file imported before S7.1 keeps its separate products, and a product whose stored brand or part number is empty is never found by step 2. For a clean result, use a fresh local database or hide the duplicates.

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

**Check the local database.** Products and offers already stored are never re-matched, and the importer is the only writer of the normalised brand and part number that matching uses. Open `/admin/productos` and look for products you made with hand files before S7.1: the same part twice, or products with no brand or no part number. Those never converge with a new row and fail safe into a duplicate, never a wrong merge. The remedy is the one that exists: use a fresh local database, or hide the duplicates at `/admin/productos`.

**Demo products can absorb a real row.** The demo shops and products are ordinary rows in the database. A real row whose normalised brand and part number equal those of a demo product attaches to that demo product and the product keeps its demo title, brand and text (the first file's text stays). Hiding the demo product does not stop this: a hidden product still matches, so the real offer attaches to it and stays hidden, and unhiding the product later would publish that offer under the demo title, brand and text. Rows are never re-matched, so the only remedies are to avoid the collision (look through the demo products at `/admin/productos` and give your real rows a brand and part number that no demo product has) or to start from a fresh local database. The match by brand and part number happens only when the real row carries no valid EAN or the demo product has none; a demo product that carries a different EAN makes the row its own product (`brand_part_number_ean_conflict`), and every demo EAN starts with `200`.

**Disable the demo shops for the check.** On `/admin/tiendas`, press "Desactivar tienda" on each of the four demo shops and confirm. There is no bulk control. A product with only demo offers then leaves every public page, search and `/go`; it was never in the sitemap. The demo rows stay stored, and an all-feeds import still reads the demo feeds: disabling a shop does not touch its feeds, which stay approved and show "Aprobado, en pausa". Nothing from them is public. The setting survives a restart.

**Approve them again afterwards.** `npm run gate` fails while the demo shops are disabled: its e2e specs read demo products that are no longer public. (The gate's e2e setup expects the two demo feeds to import, and it shows the message "the import found no approved feed" when fewer than two feeds import. During this check that happens when the demo feeds themselves are disabled, even though your own feed is approved. The remedy is to approve them again on `/admin/tiendas`, not to change `SEED_DEMO_DATA`.) When the check is over, press "Aprobar tienda" on each demo shop you disabled; if you disabled a feed instead of its shop, approve that feed again too.

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

To import one feed only, add `--feed <id>` (after `--` for npm). An unapproved file feed is reported skipped and its file is not read. For an approved one you get the usual line `feed <id> "<shop name>": imported rows=... products_created=... offers_created=... offers_updated=... offers_removed=... rejected=... unknown_vehicles=...`, then an indented line for each rejected row and for each row that became its own product (`record <n>: own_product <reason>`). Running it again on an unchanged file creates nothing new and changes only prices and dates.

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

A feed that has never been imported shows a note that there are no categories to assign yet.

## 7. Approve the shop, then check the product

When the review is done, press "Aprobar tienda" on the shop. With the shop approved, the feed approved and the category mapped, open the product on its category page or by search. The page lists each shop's price in euros, cheapest first, with a link to the shop through `/go/<offer>`. If it is not there, check in order: the shop is approved, the feed is approved, the category is mapped, the row was not rejected in the import output, the product or the offer is not hidden at `/admin/productos`, and the offer was not removed by an import (it is absent from the file, see "Rows you drop from the file").

## What S3.7 does not do

- **No delete of dropped rows.** An offer you drop from the file is flagged removed, not deleted, and a product stays stored (S3.3, see section 5); the guard can skip removal.
- **No brand alias and no re-matching.** `Bosch` and `Robert Bosch` stay two products (S7.3, deferred), and products already stored are never merged (see "When two files land on one product").
- **Hide or unhide** a single product or offer at `/admin/productos` (S2.4, #25), after the import. A hidden item stays hidden through every later import; unhiding publishes nothing by itself, since the two approvals and a mapped category are still needed.
- **No upload, no preview, no "Import now" button, no row count and no file-exists check** in the admin; no images; no other column layouts (S3.5).
- **No revenue or disclosure wording** is written anywhere while everything is local.
