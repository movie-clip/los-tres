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
| `brand` | no | The brand. |
| `part_number` | no | The part number. Stored and shown, but it does not make two files converge yet: matching by brand and part number is S7.1 (#40, not built). |
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

## 3. Register the shop and the file feed

In the admin, on `/admin/tiendas`, signed in at `127.0.0.1` (see CLAUDE.md for the admin sign-in):

1. Create the shop (name and slug) if it does not exist. A new shop starts **unapproved**.
2. Add a feed for that shop: in "Origen del feed" choose "Archivo de catálogo" and type the file name in "Nombre del archivo". A file feed needs no network. The form does not check that the file exists; the file is read at import. A shop cannot have two feeds with the same file name.
3. The new feed also starts **unapproved**, even when its shop is approved.

Changing the file name of an **approved** file feed returns that feed to unapproved in the same save, and its offers leave the public site at once; the form warns before you submit. Saving the same name again changes nothing.

## 4. Approve the shop, then the feed

Approval is two separate actions on `/admin/tiendas`: approve the shop, then approve the feed. Approving one does not approve the other, and neither shows any product by itself.

## 5. Run the import

Either form, from the repository root:

```
npm run import-feeds
docker compose run --rm app import-feeds
```

To import one feed only, add `--feed <id>` (after `--` for npm). An unapproved file feed is reported skipped and its file is not read. For an approved one you get the usual line `feed <id> "<shop name>": imported rows=... products_created=... offers_created=... offers_updated=... rejected=...`. Running it again on an unchanged file creates nothing new and changes only prices and dates.

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

## 7. Check the product

With the shop approved, the feed approved and the category mapped, open the product on its category page or by search. The page lists each shop's price in euros, cheapest first, with a link to the shop through `/go/<offer>`. If it is not there, check in order: the shop is approved, the feed is approved, the category is mapped, the row was not rejected in the import output.

## What S3.7 does not do

- **No removal of dropped rows.** An offer or product you delete from the file stays until S3.3 (#28); the importer only adds and updates.
- **No convergence without an EAN.** Brand and part number do not match two files (S7.1, #40).
- **No hide or unhide** of a single product or offer yet (S2.4, #25); the two approvals are the whole of your control over a file feed's products.
- **No upload, no preview, no "Import now" button, no row count and no file-exists check** in the admin; no images; no other column layouts (S3.5).
- **No revenue or disclosure wording** is written anywhere while everything is local.
