# 0002 — PostgreSQL with Drizzle ORM

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope.

## Decision

Data lives in **PostgreSQL**, accessed through **Drizzle ORM** with migrations
in the repo. Search uses PostgreSQL itself: full-text search for free text and
`pg_trgm` plus normalised columns for part numbers and EANs.

> **Amended 2026-10-29 (S5.4, owner ruling D-10).** The sentence above is
> superseded as built: search uses the `unaccent` extension, two text-search
> configurations (Spanish stemming for the title, unstemmed for the brand) over
> a generated `tsvector` column with a GIN index for free text, and equality on
> the normalised part-number and EAN columns for codes. `pg_trgm` is not used:
> a part number matches whole, never by fragment. `unaccent` is a contrib
> extension, so a managed PostgreSQL at deploy (S9.1) must allow
> `CREATE EXTENSION unaccent`. The stack and the engine are unchanged.

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
