# 0016 — Vehicle fitment: own vehicle list, fitment from feeds, selection on the device

Status: accepted, 2026-10-28 (owner rulings on the E5 car-selection feature).
Amends `docs/product/mvp.md` § Catalogue scope ("No vehicle fitment") and
§ Out of MVP. Feature spec: `docs/product/vehicle-fitment.md`.

## Decision

- **Vehicle = make + model generation + engine.** Not make/model/year (too
  coarse for filters) and not a plate lookup (a paid API and personal data).
- **Our own vehicle list, in code**, upserted on every migrate like the
  category tree (0015), with stable slugs. No TecDoc or other licensed
  catalogue in the MVP; that stays an owner call for later.
- **Fitment links enter through feeds only**, as a field of a feed row (demo
  feeds now, a network's mapped field later). No scraping (guardrail 2). A
  fitment counts only while its feed and that feed's shop are approved
  (guardrail 1); there is no separate "enabled" flag, disabling a feed is
  unapproving it.
- **The selection lives in the URL (`?coche=<slug>`) and in the visitor's
  `localStorage`.** The server stores nothing about it: no cookie, session or
  log (guardrail 5). Pages render on the server from the URL.
- **Unknown fit is shown, not hidden.** With a car selected, listings show the
  parts that fit first, then the parts with no fitment data under a heading;
  parts whose fitment excludes the car are left out.

## Why

- Real feeds rarely carry clean fitment, and a licence is a cost decision; our
  own small list makes the feature real on the demo catalogue now and leaves
  room for feed or licensed data later without rework.
- The URL keeps pages server-rendered, shareable and working without
  JavaScript; `localStorage` remembers the choice without a cookie, so the "no
  cookie, no banner" position (0014) holds.
- Hiding unknown parts would empty most listings while fitment data is thin.

## Consequences

- New tables for vehicles and product–vehicle fitments, and a `fitment` column
  in the demo feeds (shipped in S5.6; the import is the only writer of
  fitments).
- Every internal link must carry `coche` while one is selected; a page with
  `coche` is `noindex`.
- The privacy page gains one sentence about the stored car choice.
