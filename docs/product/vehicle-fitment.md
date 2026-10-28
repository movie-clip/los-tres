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
   fitment field: a list of vehicle slugs separated by `|`. The demo feeds
   carry it. A real network's field mapping (S3.5) may map its own fitment
   field later; until then real offers have no fitment, so their products are
   `unknown`.
   - The import replaces the fitments a feed gives a product with that row's
     list. Fitments from other feeds stay. A product's fitment set is the union
     over its offers' feeds.
   - An unknown slug does not reject the row: it is skipped and counted in the
     import output as `fitment: unknown vehicle <slug>`.
   - A fitment from a feed that is not approved or is disabled does not count
     (guardrail 1). Hidden products stay hidden whatever their fit.
3. **Filtering.** With a vehicle selected, a listing (category page, search
   results) shows:
   - first the `fits` products, under the heading "Compatibles con tu
     <coche>", then the `unknown` products under "Sin datos de
     compatibilidad", with a one-line explanation;
   - never the `no-fit` products. The result count says how many fit and how
     many are unknown, and how many were hidden as not compatible.
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
     short notice "No reconocemos ese coche", and the browser clears the
     stored value.
   - SEO: canonical already drops every parameter but `pagina` (S6.2), so
     `coche` is dropped. Pages with `coche` carry `noindex`. `coche` never
     appears in the sitemap.
5. **Remembered on the device.** When a visitor selects a vehicle, the browser
   stores its slug in `localStorage` under `lostres.coche` (no expiry). On a
   page opened without `coche`, a small script reads it and replaces the URL
   with the same URL plus `coche` (no new history entry). The server stores
   nothing about the visitor: no cookie, no session, no log of the selection
   (guardrail 5). It is a preference the visitor asked for, so no consent
   banner is needed; the privacy page gets one sentence saying so.
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
   - Options come from server-rendered lists, or a read-only JSON route
     `/api/vehiculos` (makes; `?marca=` models; `?modelo=` engines). The
     `/api/` prefix is already disallowed in robots.txt.
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
