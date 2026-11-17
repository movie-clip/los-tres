# Vehicle fitment ("Mi coche") — feature spec

Owner rulings, 2026-10-28 (decision 0016). This is the shared spec for epic E5
stories S5.5–S5.9. Each story file refines its own slice; where they disagree,
this file and decision 0016 win until the owner amends them.

## What the visitor gets

A visitor picks their car once (make, model, engine). From then on, every
category page and the search results show the parts that fit that car first,
the product page says whether the part fits, and the choice is remembered on
that device until they change or remove it.

## Terms

| Term | Meaning |
|---|---|
| **Vehicle** | One make + model generation + engine, e.g. *Seat › León III (2012–2020) › 1.6 TDI 115 CV (diésel)*. The unit a visitor selects and a fitment points at. |
| **Fitment** | A link "product P fits vehicle V", with its source (the feed it came from). |
| **Fit state** of a product for the selected vehicle | `fits` — a fitment to that vehicle exists; `no-fit` — the product has fitments, none to that vehicle; `unknown` — the product has no fitment at all. |
| **Selected vehicle** | The vehicle in the `coche` URL parameter, which the browser also keeps in `localStorage`. |

## Rules

1. **Vehicle list.** Our own table, defined in code
   (`src/db/vehicle-catalogue.ts`) and upserted on every migrate, as the
   category tree is (decision 0015). Each vehicle has a stable slug, e.g.
   `seat-leon-iii-2012-2020-1-6-tdi-115cv`. A slug is never reused or renamed;
   a retired vehicle is marked retired, not deleted. No TecDoc, no plate
   lookup, no scraping of any vehicle database.
   - Fields: make, make slug, model, generation label, years from/to, engine
     label, fuel (gasolina, diésel, híbrido, eléctrico, GLP), power kW and CV,
     engine code (optional), position for ordering.
   - Prototype size: about 30–60 vehicles that are common in Spain (Seat,
     Volkswagen, Renault, Peugeot, Citroën, Toyota, Dacia, Ford, Opel, Kia,
     Hyundai), enough to show the feature.
2. **Fitment enters through feeds only** (guardrail 2). A feed row may carry a
   fitment field: a list of vehicle slugs separated by `|`. The field is named
   `fitment`, as the CSV header and as the XML element, matched like the other
   columns (trimmed, any case). Spaces around a slug and empty items are
   ignored, a repeated slug counts once, and a slug is matched exactly as
   written (a slug differing only in letter case is unknown). The demo feeds
   carry it. A real network's field mapping (S3.5) may map its own fitment
   field later; until then real offers have no fitment, so their products are
   `unknown`.
   - The import replaces the fitments a feed gives a product with that row's
     list. Fitments from other feeds stay. A product's fitment set is the union
     over its offers' feeds.
   - An absent column, an empty cell and an absent or empty XML element are the
     same thing, an empty list, and an empty list clears what that feed gave
     the product. Several rows of one import that resolve to one product give
     it the union of their lists. A product the import does not mention keeps
     the fitments that feed gave it; nothing is removed for absent products. A
     slug of a retired vehicle is stored and not reported as unknown. Importing
     the same feed again changes no fitment row (same ids and creation times).
   - An unknown slug does not reject the row: it is skipped and counted in the
     import output. The feed's `imported` line ends `unknown_vehicles=<n>` (0
     included; one per row per distinct unknown slug). Under its rejected-row
     lines come `  fitment: unknown vehicle <slug> rows=<n>`, one per distinct
     slug-shaped unknown slug (lowercase letters, digits and hyphens, at most 80
     characters), in first-seen order and at most 20 per feed, then, only when
     some occurrences were not listed, `  fitment: unknown vehicle values not
     shown rows=<n>` (other values and slugs past the 20th are counted, never
     printed). An unknown slug does not change the exit code. Only the import
     writes fitments (`src/server/importer/fitments.ts`; a seams test fails
     on any other writer).
   - A fitment counts only while its feed and that feed's shop are both
     approved (guardrail 1); a feed an admin disables is an unapproved one, and
     there is no separate enabled flag. Whether the product's offers are hidden
     or in review does not change it, and fitments to a retired vehicle do not
     count. Hidden products stay hidden whatever their fit.
3. **Filtering.** With a vehicle selected, a listing (category page, search
   results) shows:
   - first the `fits` products, under the heading "Compatibles con tu
     <coche>", then the `unknown` products under "Sin datos de
     compatibilidad", with a one-line explanation;
   - never the `no-fit` products, with one exception on search (below). The
     result count says how many fit and how many are unknown, and how many were
     hidden as not compatible.
   - **Exact-code exception (amended by S5.8, D-1; for the owner to review).**
     On the search page only, a `no-fit` product reached by an exact EAN (8 or
     13 digits) or an exact normalised part number is shown, marked "No
     compatible", after the unknown group, under its own heading. It is never
     counted as hidden: the counts line gives it its own "coincidencia exacta"
     part. A hit that fits the car or has no data stays in its own group. A
     category page never lists a `no-fit` product. Text-only matches that are
     `no-fit` stay hidden.
   - **Unavailable car (S5.8, D-4).** If the selected car cannot be read (the
     vehicle read failed), the listing renders as without a car: unfiltered, no
     headings, marks or fit counts, with the status the page would have had
     without a car. If the car is known and the read of fit fails, the listing
     fails as it does when its data cannot be read; it is never shown
     unfiltered under a selected car.
   - Sort and brand chips apply inside each group. Brand chip counts reflect
     the filtered set. Pagination runs over the combined list (`fits` first).
   - With no vehicle selected, listings behave exactly as today.
4. **Selection in the URL.** The selected vehicle is the `coche` query
   parameter: `?coche=<vehicle-slug>`. Pages are server-rendered from it, so
   filtering works without JavaScript and a link can be shared.
   - Every internal link the site renders (header, category tiles, cards,
     breadcrumb, pagination, sort, chips, search form) carries `coche` while
     one is selected.
   - An unknown or retired slug is ignored: the page renders unfiltered with a
     short notice "No reconocemos ese coche". The browser clears the stored
     value only when it is that very slug; a different stored car stays.
   - A `coche` in the URL never writes the stored car: only the picker writes
     it, and "Quitar" clears it. A shared link with `coche` therefore shows
     that car for that visit and leaves the visitor's own saved car alone.
   - SEO: canonical already drops every parameter but `pagina` (S6.2), so
     `coche` is dropped. Every page opened with `coche`, valid or not, carries
     `noindex`. `coche` never appears in the sitemap.
5. **Remembered on the device.** When a visitor selects a vehicle, the browser
   stores its slug, and only the slug, in `localStorage` under `mi-coche` (no
   expiry; the key names no site, because a visitor can read it in devtools).
   On a page opened without `coche`, a small script reads it and replaces the
   URL with the same URL plus `coche` (no new history entry). The server stores
   nothing about the visitor: no cookie, no session, no log of the selection
   (guardrail 5). It is a preference the visitor asked for, so no consent
   banner is needed.
   - Open: the privacy page was not changed in S5.7 (owner ruling D-1 of that
     run, "ignore privacy page for now"). Its "ni tecnologías similares" line
     still contradicts the `mi-coche` write, and the sentence this rule asked
     for is not written. The owner decides the wording; do it before any
     public deploy.
   - `/go/<offer>` does not log the vehicle.
6. **Change and remove.** The header always shows the selection control:
   - none selected: a button "Selecciona tu coche";
   - selected: "Mi coche: Seat León III 1.6 TDI" with "Cambiar" and "Quitar".
     "Quitar" clears storage and removes `coche` from the URL; "Cambiar" opens
     the picker pre-filled with the current make and model.
7. **Picker.** Three dependent steps: make → model (generation and years) →
   engine (label, fuel, CV). It works without JavaScript as a short sequence
   of GET forms on `/mi-coche` that ends by returning to the page the visitor
   came from (`volver` parameter, a site-internal path only) with `coche` set.
   With JavaScript it opens as a dialog on the current page with the same
   three steps, keyboard accessible, and focus returns to the trigger.
   - `/mi-coche` takes `marca` (make slug), `modelo` (model slug), `coche`
     (the engine's vehicle slug) and `volver`. The step shown is the first one
     not yet chosen: no valid `marca` is the make step, a `marca` without a
     valid `modelo` of it is the model step, a `modelo` without a valid `coche`
     of it is the engine step, and all three valid redirects (replace) to
     `volver` with `coche` last. `volver` is a single `/` path of at most 512
     characters, with no backslash or control character, never `//`, `/go/`,
     `/api/`, `/admin` or `/mi-coche` itself; anything else lands on `/`. Its
     other query parameters are kept, and `coche` is set once, last. The page
     is `noindex`, has no canonical, is disallowed in robots.txt and sends
     `Referrer-Policy: same-origin`, because `volver` can hold a search term.
   - Options are server-rendered into the page (the dialog's tree is embedded
     in the header, the page renders its steps from the same tree). There is
     no options route and no `/api/vehiculos`: the path answers 404.
   - Only makes and models that have at least one vehicle are listed. A make
     with no fitment at all is still listed: "unknown" products still show.
8. **Product page.** With a vehicle selected, the product page shows a fit
   banner above the offers: "Compatible con tu <coche>" (`fits`), "No es
   compatible con tu <coche>" plus a link to the category filtered for that
   car (`no-fit`), or "Sin datos de compatibilidad para tu coche"
   (`unknown`). The page always lists the vehicles the product fits, grouped by
   make and model, collapsed beyond 10 rows. A product page is never hidden
   by the filter, only marked.
9. **Copy.** All new copy is es-ES in the message files. The designer's UX spec
   (S5.7) fixes the exact wording; the strings above are the intent.

## Out of scope (this feature)

- Plate (matrícula) or VIN lookup, TecDoc or any licensed catalogue.
- Oil selection by viscosity or ACEA/OEM approval: oils fit through fitment
  links like any part.
- More than one saved car, a garage, or any account.
- Admin screens to edit vehicles or fitments (the vehicle list is code;
  fitments come from feeds).
- Server-side storage of the selection, cookies, and analytics of selections.
