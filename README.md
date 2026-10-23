# Los Tres

A price-comparison site for Spain (auto parts and tools). The public site and
the admin area are one Next.js app, run with Docker Compose together with
PostgreSQL.

## Requirements

- Node 22 and npm (see `.nvmrc`)
- Docker Desktop, running
- Free host ports: 3010 (app) and 5433 (database). To change one, set
  `APP_PORT` or `DB_HOST_PORT` in `.env`; if you change `APP_PORT`, set
  `SITE_URL=http://127.0.0.1:<APP_PORT>` too, then run `docker compose up -d`.

## 1. First-time setup

```sh
npm ci
npm run env:init          # creates .env with generated secrets
```

Open `.env` and fill in:

- `OWNER_NAME`, `OWNER_NIF`, `OWNER_ADDRESS`, `CONTACT_EMAIL`: needed only for
  the legal pages (`/aviso-legal`, `/privacidad`); any test values work locally.
- Check `SEED_DEMO_DATA=true` (loads demo shops, feeds and categories).
- Check `AUTH_SECRET` and `SITE_URL=http://127.0.0.1:3010` are present (needed
  for the admin area).

Never commit `.env`.

## 2. Start the stack

```sh
npm run stack:up
```

Builds and starts `app` and `db`, and waits until they are healthy.
The app migrates the database and seeds the demo data on start.

## 3. Load demo products

Seeding creates no products; the first feed import does:

```sh
docker compose run --rm app import-feeds
```

## 4. Public site (client)

- Home: http://127.0.0.1:3010/
- Demo product: http://127.0.0.1:3010/producto/demo-filtro-de-aceite-oc-1234
  (two shops, cheapest first)
- Other pages: `/categoria/<slug>`, `/como-nos-financiamos`, `/aviso-legal`,
  `/privacidad`, `/sitemap.xml`, `/api/health`

## 5. Admin area

There is no sign-up. Create an admin from the command line (line 1 email,
line 2 password, 6–128 characters):

```sh
printf 'admin@example.test\nchangeme\n' | docker compose run --rm -T --no-deps app create-admin
```

Or run `docker compose run --rm app create-admin` and answer the prompts.
Running it again with the same email resets the password.

Then sign in at **http://127.0.0.1:3010/admin/acceso**.

- Use `127.0.0.1`, not `localhost`: the origin must match `SITE_URL`, or
  sign-in reports "unavailable".
- **Admin → Tiendas** (`/admin/tiendas`): approve or disable shops and feeds.
  Only offers from approved feeds appear on the public site.
- Re-import after changing feeds: `docker compose run --rm app import-feeds`
  (or `--feed <id>` for one feed).

The admin area is password-only for now; do not deploy it publicly.

## Stop

```sh
npm run stack:down        # keeps the database volume
```

## Development without Docker for the app

```sh
npm run db:up             # only the database
npm run db:migrate
npm run db:seed
npm run import-feeds
npm run dev               # Next.js dev server on http://localhost:3000 (Next default)
```

With `npm run dev`, set `SITE_URL` to the dev server's origin for admin
sign-in, and run it with `npm run dev -- -p <port>` if 3000 is taken.

## Checks

`npm run gate` runs lint, types, unit/integration tests and Playwright e2e. See
`CLAUDE.md` for the full command reference.
