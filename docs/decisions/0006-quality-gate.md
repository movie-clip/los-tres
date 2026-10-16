# 0006 — Quality gate: ESLint, tsc, Vitest, Playwright

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope.

## Decision

The gate every slice must pass:

- **ESLint** for lint
- **`tsc --noEmit`** for types
- **Vitest** for unit and integration tests, integration tests against a real
  PostgreSQL
- **Playwright** for the key flows end to end:
  - search → product page → offers sorted by price → the `/go/<offer>`
    redirect logs the click and lands on the affiliate URL;
  - an admin approves a feed, runs "Import now" and reads the import report;
  - an admin resolves a matching-queue item and uploads a product image.

The first slice that adds code puts the exact commands in `CLAUDE.md` §
Commands.

## Why

`CLAUDE.md` requires a lint and a test command as the gate. These are the
standard tools for TypeScript and Next.js, and agents know them well.

## Consequences

Each guardrail gets tests of its own:

- offers from an unapproved feed, and hidden products or offers, are never
  public;
- the importer refuses any source that is not a registered feed;
- admin routes reject anonymous requests on the server;
- money stays in integer cents;
- the click log holds no IP, user agent or cookie.

Tests import from local fixture feed files and never call a live network.
