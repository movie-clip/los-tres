# 0002 — PostgreSQL with Drizzle ORM

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope.

## Decision

Data lives in **PostgreSQL**, accessed through **Drizzle ORM** with migrations
in the repo. Search uses PostgreSQL itself: full-text search for free text and
`pg_trgm` plus normalised columns for part numbers and EANs.

## Why

- The data is relational: networks, shops, feeds, imports, products, offers,
  categories, category mappings, price history and clicks.
- Drizzle is typed and stays close to SQL, so generated code is easy to review.
- PostgreSQL search is enough at MVP volume (tens of thousands of products),
  with no search engine to run.

## Consequences

- Money columns are integer cents (`integer` or `bigint`), never `numeric` read
  into floats, and never `real` or `double precision`.
- Part numbers and EANs are stored both as received and normalised (spaces,
  dashes and dots removed, upper case) for matching (0008).
- Price history is one row per product per day, so its size grows linearly and
  predictably.
