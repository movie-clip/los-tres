# 0004 — Delivered as Docker Compose

Status: accepted, 2026-10-12. Revised 2026-10-16: hosting on an EU VPS once
the first slices work.

## Decision

The MVP ships as a **Docker Compose** project that runs with
`docker compose up`. It runs locally first. Once the first slices work, the
same Compose setup runs on a small **EU VPS** with a domain, because the
affiliate networks only approve a site they can visit.

Services:

| Service | Role |
|---|---|
| `app` | the Next.js app; also runs `import-feeds` (`docker compose run app import-feeds`) |
| `db` | PostgreSQL, data on a named volume |

There is no scheduler. Imports run when someone starts them, from the command
line or from the admin area's "Import now" button.

Product images that the admin uploads are stored on a Docker volume behind a
small storage interface.

## Why

- The owner finds Compose easy to use, and the same files run on a laptop and
  on a server.
- No external accounts are needed to run it locally.

## Consequences

- `.env.example` documents every variable, including the public site name.
- Seeded demo data (categories, a demo shop and a small demo feed file) loads
  on first start, so the site works locally before any network approves us.
- The VPS provider and domain are chosen by the owner when the server is set
  up, and recorded then.
