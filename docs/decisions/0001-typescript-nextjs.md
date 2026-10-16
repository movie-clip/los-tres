# 0001 — TypeScript and Next.js, one app

Status: accepted, 2026-10-12. Revised 2026-10-16 for the price-comparison
scope.

## Decision

The whole product is one **Next.js** app written in **TypeScript**: the public
catalogue, the `/go/<offer>` redirect and the admin area. Pages that Google
must index (products, categories, search) are server-rendered. User-facing
text goes through **next-intl** message files, in Spanish (`es-ES`) from
launch. The public site name is configuration, not code.

The feed importer (`import-feeds`) is a command in the same codebase. It
shares the schema and the matching code with the app.

## Why

- Organic Google traffic is the product's main channel, so pages are rendered
  on the server.
- One language front and back is easier for the owner to review, and agents
  write it reliably.
- A single app keeps the MVP to one thing to build, run and test.
- Message files keep copy out of markup, so another language can be added
  later.

## Considered

**Python + Django.** Its built-in admin would give the admin area quickly.
Rejected because one language across the stack is easier to review, and the
admin tasks here (matching queue, merge and split, image upload) are custom
screens anyway.

## Consequences

- There are two roles: anonymous public visitors and admins. The admin role
  check runs in server code: route handlers, server actions and data access.
  Never in components alone.
