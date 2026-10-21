REPORT 2026-10-21-legal-pages/03
status:      DONE
verdict:     NONE

changed:
  - none

verification:
  command:   NONE
  result:    NOT_RUN
  detail:    read-only design order, order verification NONE

contract_notes:
  - PublicProductPage and PublicCategoryPage each gain `demoOnly: boolean` (never optional); PublicOffer and CategoryProductCard gain nothing. See § Contract: demo flag.
  - New server reader src/config/owner.ts `getOwnerIdentity(): OwnerIdentity`; four required fields throw when blank, `registry: string | null`. See § Contract: owner identity.
  - compose.yaml app.environment gains the five names in `${NAME:-}` form, never `:?`; .env.example gains the five as empty keys. See § Contract: owner identity.
  - messages/es-ES.json gains namespaces Footer, DemoNotice, LegalNotice, Privacy, Funding with rich tags <b>, <email>, <aepd>. See § Contract: messages.
  - tests/support/page-checks.ts expectLocalScriptsAndLinks gains an exact-href allow list for the two legal outbound links. See § Test plan.
  - Close-out docs: CLAUDE.md § Commands must say the four required OWNER_* values must be filled in .env or /aviso-legal and /privacidad return 500. See § Risks detail.

pack_corrections:
  - architecture.md — § The seams the product forces lacks owner config; add: "Owner identity (`src/config/owner.ts`): the only reader of OWNER_* and CONTACT_EMAIL; only the legal pages call it."
  - architecture.md — § The seams: add "Demo flag: `demoOnly` is computed only in src/server/catalogue from feeds.is_demo after visibleOfferWhere(); no file under src/app or src/components names isDemo."

handoff:
  - Lane order: backend 04, then frontend 05, then test 06; each order's fence and command are in § Lanes.
  - Routes: /aviso-legal, /privacidad, /como-nos-financiamos as src/app/(public)/<route>/page.tsx, force-dynamic. See § Routes.
  - Footer and notice: SiteFooter in root layout after children; DemoNotice first in main on product and category pages when demoOnly. See § Components.
  - Message keys and the exact rich-tag rendering are fixed in § Contract: messages; the frontend copies the words from legal-es.md, not from this report.
  - Test lane: fake identity values and the five test groups are in § Test plan.

skill_calls:
  - mattpocock-skills:codebase-design — not called, the seams are already named by the pack; the plan follows existing modules (env.ts, catalogue reads)
  - engineering:testing-strategy — not called, the test plan follows the repo's existing patterns named by recon § Test patterns

risks:
  - Budget: the ledger plans 2 build lanes; src/server and src/config changes belong to the backend lane, so build needs 3 (backend, frontend, test). See § Lanes.
  - A fresh clone's env:init writes empty OWNER_* keys, so /aviso-legal and /privacidad return 500 until filled; the e2e branches on host .env to stay green. See § Risks detail.
  - next-intl t.rich typing of the content builders against createTranslator in unit tests is unverified; frontend may need a minimal local translator type. See § Risks detail.
  - Category demoOnly is scoped to the displayed page's cards (UX default), via bool_and in the existing grouped query; a mixed category may flag page 2 but not page 1.
  - Privacy copy says Umami runs; no Umami script is wired yet (02-ux risk). Producer/owner finding, not a build change.

## Orchestrator brief
- Decision: owner identity via new src/config/owner.ts getOwnerIdentity(); OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL required (throw on blank → 500 on the two pages that use them), OWNER_REGISTRY optional (null → no "Datos registrales" item).
- Decision: compose.yaml forwards all five as `${NAME:-}` (never `:?`, so migrate/import-feeds/e2e setup never break); .env.example adds five empty keys; env:init untouched.
- Decision: `demoOnly: boolean` on PublicProductPage and PublicCategoryPage, computed in src/server/catalogue from feeds.is_demo over visible offers only; category scope = displayed cards; false when nothing listed.
- Decision: routes /aviso-legal, /privacidad, /como-nos-financiamos under src/app/(public)/.
- Decision: namespaces Footer, DemoNotice, LegalNotice, Privacy, Funding; flat keys; bold as <b>…</b>, email as <email>{contactEmail}</email>, AEPD as <aepd>www.aepd.es</aepd>, rendered with t.rich.
- Lane split: 04 backend (config, compose, .env.example, catalogue reads) → 05 frontend (messages, pages, footer, notice) → 06 test. Needs 3 build lanes, not the 2 budgeted.
- § Contract: owner identity · § Contract: demo flag · § Contract: messages (full key table) · § Routes · § Components · § Lanes (fences, commands) · § Test plan · § Identity hygiene · § Risks detail.
- Nothing blocks dispatch beyond the budget replan (+1 build lane).

## Contract: owner identity

New file `src/config/owner.ts` (relative import `./env`, `import 'server-only'`, read per call, never at module load — the `site.ts` pattern):

```ts
export type OwnerIdentity = {
  /** OWNER_NAME, trimmed. Required. */
  name: string;
  /** OWNER_NIF, trimmed. Required. */
  nif: string;
  /** OWNER_ADDRESS, trimmed, one line. Required. */
  address: string;
  /** CONTACT_EMAIL, trimmed; also the mailto: target. Required. */
  contactEmail: string;
  /** OWNER_REGISTRY, trimmed; null when unset, empty or whitespace. */
  registry: string | null;
};
export function getOwnerIdentity(): OwnerIdentity;
```

- Required four via `readRequiredEnv` → `Error("<NAME> is not set")`, naming the variable only, never a value (TD-13). Order of checks: OWNER_NAME, OWNER_NIF, OWNER_ADDRESS, CONTACT_EMAIL (the first blank one is what throws).
- `registry` via `readOptionalEnv(...) ?? null`. `null`, not `undefined`, to match the catalogue contracts' nullable convention.
- Blank required value: the page that called it throws, Next renders its error page with status 500. Never a brace, never an empty label (UX § States "error"). Only `/aviso-legal` and `/privacidad` call it; the root layout, footer, `/como-nos-financiamos` and all catalogue pages never do, so a missing owner value never takes the catalogue down.
- No email format validation; the value is the owner's. The page builds `href={\`mailto:${owner.contactEmail}\`}`.
- Values are plain text: passed as ICU values into `t.rich`, which inserts them as React text nodes (escaped, never parsed as tags).
- `compose.yaml` `app.environment`, after SEED_DEMO_DATA:
  ```yaml
  # Owner identity for the legal pages; blank keeps every other page working.
  OWNER_NAME: ${OWNER_NAME:-}
  OWNER_NIF: ${OWNER_NIF:-}
  OWNER_ADDRESS: ${OWNER_ADDRESS:-}
  OWNER_REGISTRY: ${OWNER_REGISTRY:-}
  CONTACT_EMAIL: ${CONTACT_EMAIL:-}
  ```
  `:?` is forbidden here: it fails every `docker compose run app …`, including the e2e global setup's import-feeds.
- `.env.example`: append the five as `NAME=` with one comment line above ("Owner identity for the legal pages. Fill in .env; never commit real values."). `scripts/init-env.mjs` is not changed (it copies blank lines verbatim; `init-env.test.ts` checks named keys only).
- A changed value takes `docker compose up -d`, not a rebuild (same as SITE_NAME).

## Contract: demo flag

Field name `demoOnly` (deliberately not `isDemo*`, so a scan can forbid `isDemo`/`is_demo` outside src/server and src/db).

```ts
export type PublicProductPage = { /* existing fields */
  /** True when every listed (visible) offer is from a demo feed. offers.length >= 1, so never vacuous. */
  demoOnly: boolean;
};
export type PublicCategoryPage = { /* existing fields */
  /** True when products.length >= 1 and every visible offer behind the listed cards is from a demo feed. False for an empty category. */
  demoOnly: boolean;
};
```

- Product (`src/server/catalogue/product-page.ts`): add `isDemo: feeds.isDemo` to the existing select (the feeds join exists); `demoOnly: rows.every((r) => r.isDemo)`. The per-row `isDemo` is not copied into `PublicOffer`.
- Category (`src/server/catalogue/category-page.ts`): add `allDemo: sql<boolean>\`bool_and(${feeds.isDemo})\`` to the grouped select; `demoOnly: rows.length > 0 && rows.every((r) => r.allDemo)`; strip `allDemo` when mapping to `CategoryProductCard` (explicit map, not `products: rows`).
- Both computed after `visibleOfferWhere()` in the same query, so hidden, in-review and unapproved-feed offers never count (guardrail 1). No new visibility filter, no new query.
- Scope: the displayed page of cards (UX default; same query, zero cost).
- `getPublicCategoryTree` (home) is not touched; home shows no notice.

## Contract: messages

All under `messages/es-ES.json`, flat string keys below the namespace (existing convention). Words copied verbatim from legal-es.md; a source line break inside a paragraph or list item becomes one space. The only non-owner text is the three `metaTitle` values (UX § Copy map).

Rich tags (markup, not copy; rendered with `t.rich`):
- `<b>…</b>` → `<strong>`; wraps the bold lead-in including its full stop, e.g. `"<b>No pagas más.</b> El precio es …"`. `**` never appears in a message.
- `<email>{contactEmail}</email>` → `<a href="mailto:…">`; only the address is inside the tag.
- `<aepd>www.aepd.es</aepd>` → `<a href="https://www.aepd.es">`; parentheses and full stop stay outside: `"…Protección de Datos (<aepd>www.aepd.es</aepd>)."`.

| Namespace | Keys (in page order) |
|---|---|
| Footer | `legalNotice` ("Aviso legal"), `privacy` ("Privacidad"), `funding` ("Cómo nos financiamos") |
| DemoNotice | `body` |
| LegalNotice | `metaTitle` ("Aviso legal \| {siteName}"), `heading`, `intro`, `holder` ("Titular: {ownerName}"), `nif`, `address`, `email` ("Correo electrónico: <email>{contactEmail}</email>"), `registry` ("Datos registrales: {ownerRegistry}"), `objectHeading`, `objectBody`, `pricesHeading`, `pricesBody`, `demoHeading`, `demoBody`, `ipHeading`, `ipBody`, `linksHeading`, `linksBody`, `lawHeading`, `lawBody` |
| Privacy | `metaTitle` ("Privacidad \| {siteName}"), `heading`, `controllerHeading`, `controllerBody` (with `<email>`), `cookiesHeading`, `cookiesBody`, `dataHeading`, `dataClicks`, `dataStats`, `dataLogs` (each with `<b>`), `dataBasis`, `leavingHeading`, `leavingBody`, `writingHeading`, `writingBody`, `adminsHeading`, `adminsBody`, `recipientsHeading`, `recipientsBody`, `rightsHeading`, `rightsBody` (with `<email>` and `<aepd>`), `changesHeading`, `changesBody` |
| Funding | `metaTitle` ("Cómo nos financiamos \| {siteName}"), `heading` ("Cómo se financia {siteName}"), `intro`, `noExtraCost`, `noSales`, `noPaidRanking` (each with `<b>`) |

- `Datos registrales` omission: the page renders the `registry` `<li>` only when `owner.registry !== null`; it never calls `t('registry')` otherwise. No ICU `select` trick.
- Every message carrying a tag is rendered with `t.rich`; plain ones with `t`. A tagged message through `t()` is an INVALID_MESSAGE fallback (recon § i18n), which the e2e "no raw key text" check would catch.
- The legal-es.md English line "Shown on pages that list only demo offers." is not copy.
- ICU safety: the owner text has no apostrophe, `#` or brace outside placeholders (checked).

## Routes

- `src/app/(public)/aviso-legal/page.tsx` → `/aviso-legal`
- `src/app/(public)/privacidad/page.tsx` → `/privacidad`
- `src/app/(public)/como-nos-financiamos/page.tsx` → `/como-nos-financiamos`
- Each: `export const dynamic = 'force-dynamic'`; `generateMetadata` returns `{ title: t('metaTitle', { siteName: getSiteName() }) }` only (root description applies); `<main className="page">`.
- Page body assembly lives in a sibling `content.tsx` per route exporting a component that takes `{ t, siteName, owner }` (Funding: no `owner`), so the test lane can render it with `createTranslator` and fake values. `page.tsx` only reads config, gets `t`, and renders it. `route-classification` only constrains `page.tsx`, which stays under `(public)`.
- Footer hrefs are these three literal paths, in this order.

## Components

- `src/components/SiteFooter.tsx` + `.module.css`: props `{ links: { href: string; label: string }[] }`; `<footer><ul>…<a href>` plain `<a>` (no next/link, no prefetch), no `<p>`, no heading. Root layout renders it after `{children}` with labels from `getTranslations('Footer')`. Body becomes a min-height column so the footer sits at the viewport bottom (UX § Footer); that CSS goes in the layout's module or `globals.css` reset only if it is a reset — frontend picks, inside decision 0011.
- `src/components/DemoNotice.tsx` + `.module.css`: props `{ text: string }`; `<p role="note">` styled to beat `.page p`. Product and category pages render it as the first child of `<main>` when `demoOnly`.
- `src/components/LegalText.tsx` + `.module.css`: the 42rem reading column wrapper (h1/h2/p/ul/strong/link styles per UX § Legal page layout). Content components render inside it.
- Components take finished strings, hrefs or ReactNodes; none reads config or env.

## Lanes

**04 backend** — fence: `src/config/owner.ts` (new), `src/server/catalogue/product-page.ts`, `src/server/catalogue/category-page.ts`, `compose.yaml`, `.env.example`. Builds § Contract: owner identity and § Contract: demo flag exactly. Must also update the category/product integration tests only if existing assertions use `toEqual` on the whole contract and break — otherwise leave tests to 06. Verification: `npm run lint && npm run typecheck && npm test`.

**05 frontend** — fence: `messages/es-ES.json`, `src/app/layout.tsx`, `src/app/(public)/aviso-legal/**`, `src/app/(public)/privacidad/**`, `src/app/(public)/como-nos-financiamos/**`, `src/app/(public)/producto/[slug]/page.tsx`, `src/app/(public)/categoria/[slug]/page.tsx`, `src/components/SiteFooter.*`, `src/components/DemoNotice.*`, `src/components/LegalText.*`, `src/app/globals.css` (reset/body only). Inputs: this report, 02-ux.md, legal-es.md (read-only). Verification: `npm run lint && npm run typecheck && npm run test:unit`.

**06 test** — fence: `tests/**`. Builds § Test plan. Verification: `npm run gate`.

## Test plan

Fake identity values, used everywhere a value is asserted outside e2e: `OWNER_NAME="Titular de Prueba S.L."`, `OWNER_NIF="B00000000"`, `OWNER_ADDRESS="Calle Falsa 123, 28000 Madrid"`, `OWNER_REGISTRY="Registro de prueba, tomo 1, folio 1"`, `CONTACT_EMAIL="contacto@example.test"`.

1. **Unit, config** (`tests/unit/owner-config.test.ts`, site-config pattern): trims; each required blank/whitespace throws exactly `"<NAME> is not set"`; error text contains no other env value; registry blank → `null`, set → trimmed; read per call.
2. **Unit, messages** (`messages.test.ts`): key lists for the five namespaces; placeholders present (`{ownerName}` in holder and controllerBody, `{contactEmail}` inside `<email>` in email, controllerBody, rightsBody; `{ownerRegistry}` only in `LegalNotice.registry`; `{siteName}` where the owner text has it); no message anywhere contains `**`; the code-name check extends automatically.
3. **Unit, render** (`renderToStaticMarkup`, `createTranslator` with the real messages): content components with fake values — registry null → four `<li>`, no "Datos registrales"; registry set → fifth item; mailto href equals fake email; aepd href `https://www.aepd.es` with parentheses outside the `<a>`; `<strong>` lead-ins, no `**`, no `{`/`}` in output. SiteFooter: three links, exact hrefs and labels, no `<p>`. DemoNotice: role="note", text.
4. **Integration** (`product-page.test.ts`, `category-page.test.ts`, existing helpers' `isDemo` option): all-demo → true; one real visible offer → false; demo visible + real hidden/unapproved → true (hidden never counts); real visible + demo hidden → false; empty category → false.
5. **Unit, seams**: no file under `src/app` or `src/components` matches `/isDemo|is_demo/`; only `src/config/owner.ts` names `OWNER_`/`CONTACT_EMAIL` in `src/`.
6. **E2E**: footer with the three exact hrefs/labels on home, product, category and 404 (and on each legal page); `/como-nos-financiamos` 200, h1 from messages with SITE_NAME; demo notice present on the demo product and `/categoria/filtros`, absent on home, empty category, 404 and legal pages; no set-cookie. `/aviso-legal` and `/privacidad`: when the host `.env` has all four required values, 200, values from `process.env` (never literals) appear, registry item present iff `OWNER_REGISTRY` non-blank; when any is blank, status 500 and the body contains no `{`. 
7. **page-checks.ts**: `expectLocalScriptsAndLinks(page, { allowHrefs?: string[] })` — an extra href passes only if it is exactly in the list; legal specs pass `['mailto:' + CONTACT_EMAIL, 'https://www.aepd.es']`. Existing callers unchanged.

## Identity hygiene

- `messages/` holds placeholders only; `src/` reads values only through `src/config/owner.ts`; `compose.yaml` and `.env.example` carry names, never values.
- Unit and integration tests use only the fake values above (`.test` TLD, NIF of zeros).
- E2E reads real values from `.env` at runtime and asserts them without writing them into code, snapshots or test titles; failures print messages keys, not values — test lane must not put `process.env.OWNER_*` into a test name.
- legal-es.md is never copied; frontend transcribes from it; docs at close-out describe keys, not contents.

## Risks detail

- **Fresh clone friction.** env:init leaves the four required keys empty → two legal pages 500 locally. Chosen over a silent fallback because an Aviso legal without a holder is a legal defect (UX § Data needs). The e2e's two-branch assertion keeps `npm run gate` green either way; CLAUDE.md must tell developers to fill them. Production must have them set before an affiliate reviewer visits.
- **Translator typing.** `getTranslations('LegalNotice')` and `createTranslator({ namespace: 'LegalNotice' })` come from next-intl/use-intl and should share the translator shape; if not, frontend declares a minimal `{ (key, values?): string; rich(key, values?): ReactNode }` prop type in the content file and states it in its `risks`.
- **500 on error.** Next's production error page for a thrown page error is generic and does not leak the message; the thrown text names only the variable either way.
