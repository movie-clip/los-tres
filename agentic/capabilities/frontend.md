# Capability pack: frontend — project `los-tres`

For the `frontend-engineer` lane. The public catalogue (search, category and
product pages) and the admin area.

Slice A set the layout and i18n conventions below. Conventions for later
screens are written here by the slice that adds them, through
`pack_corrections`.

---

## Index

Read this block first. You are not expected to read this file end to end — read
what your order touches. Reading one extra section is cheap; acting on a
convention you never read is not.

**Always read:** **Before the stack is recorded** · **Layout** · **Next.js and i18n** · **Guardrails, in code terms** · **Definition of done for this lane**

| Section | Read it when |
|---|---|
| Spanish market conventions | your order adds user-facing copy, prices or dates |

---

## Before the stack is recorded

The stack is recorded in `CLAUDE.md` § Stack. Report `BLOCKED` if the tech-lead plan names no directory or file for what you are asked to build, or if it needs a framework or package-manager choice no recorded decision covers (`project.md` § Building before the stack exists).

## Layout

UI under `src/app` (pages), `src/components`, `src/i18n` (`locale.ts`, `request.ts`), `messages/es-ES.json`, `src/app/globals.css` (CSS Modules, owner ruling 2026-10-17, `docs/decisions/0011`: co-located `*.module.css`; `globals.css` keeps the reset and the CSS custom properties; add no new global classes). Public pages under `src/app/(public)/`, admin under `src/app/admin/`. A component never imports `src/db`, `src/server` or `src/config`, with one named exception that takes precedence over the `src/server` ban for that file only: `JsonLd.tsx` imports `serializeJsonLd` and `type ProductJsonLd` from `src/server/catalogue/product-jsonld.ts` (a pure module, no `server-only`; ruled in the S6.1 run, decision D-2). Every other component receives finished strings: the layout or page reads configuration and passes it down as a prop. A page (`page.tsx`) is a server component and may import `src/server` read functions, `formatEuroCents` and `goPath` (`src/server/clicks/go-path.ts`); it never imports `src/db`.

Listing components: `ProductCard`, `ProductGrid`, `Pagination`, `CategoryEmpty` (`homeLabel` optional: no link when omitted), `CategoryTree` (home groups), `SiteHeader` (styles in `SiteHeader.module.css`) in `src/components` (display strings only); page-level styles in a `page.module.css` beside the `page.tsx`.

`.page p { color: var(--color-muted) }` (specificity 0,1,1) beats a single-class module rule on any `<p>` inside `.page`: text that must not be muted is a `span` or `h2`, and `p` is for muted prose; where it must stay a `p` (the home tagline), override with a two-class selector under the container (`.panel .tagline`), never `!important`.

A CSS Module file next to a component is imported as `styles` and typed by Next's `*.module.css` declaration. Class names are hashed in the HTML, so tests select by `data-testid` or role, never by class.

Working-copy files are CRLF on Windows (autocrlf): edit existing files with the Edit tool and write new ones with Write. A long Bash heredoc containing an apostrophe failed to parse in Git Bash.

## Spanish market conventions

- User-facing copy is Spanish (`es-ES`). Put strings where the plan says
  translations live, not inline, so a second language is possible later.
- Format prices with `formatEuroCents` from `src/server/money.ts`, which forces
  `useGrouping: 'always'` so the output is `1.234,50 €`. The space before `€`
  is U+00A0. Plain `Intl.NumberFormat('es-ES')` drops the thousands separator
  on four digits. Never use string arithmetic.
- The public site name comes from configuration, never a literal in markup.
- Offers are sorted by price from lowest to highest. No shipping cost is shown
  anywhere.

## Next.js and i18n

- next-intl runs without middleware and without i18n routing: locale is the constant `es-ES` in `src/i18n/request.ts`, because next-intl's middleware sets a locale cookie (guardrail 5). Messages are namespaced in one file; the site name enters a message only as the `{siteName}` placeholder filled from `getSiteName()`. No literal site name anywhere in `src/` or `messages/`.
- Pages and the root layout that show configuration or data export `dynamic = 'force-dynamic'`; never read `SITE_NAME` or any env at module load. A changed `SITE_NAME` takes a container restart (`docker compose up -d`), not a rebuild.
- `next.config.ts` is wrapped with `createNextIntlPlugin('./src/i18n/request.ts')`; server components use `getTranslations(namespace)` and `getLocale()` from `next-intl/server`. Add `NextIntlClientProvider` only when the first client component needs messages.
- `getRequestConfig` sets `timeZone: 'Europe/Madrid'`; dates are ICU placeholders in messages, for example `{date, date, medium}`. Counts use ICU plurals. Public product pages live at `src/app/(public)/producto/[slug]/page.tsx`, call one `cache()`-wrapped read function, and call `notFound()` on `null`.
- Listing pages read `?pagina` through `parsePageParam`, call `notFound()` on a null read, link page 1 as the clean path with no `?pagina=1`, and use plain `<a>` (not `next/link`) for card and pagination links.

## Guardrails, in code terms

- **(1)** Public pages show only what the server's visibility scope returned.
  The client never filters by approval or hidden state to compensate.
- **(2)** Shop links always point at `/go/<offer>`, never straight at a shop or
  affiliate URL, and the client never fetches shop pages.
  - Each offer row has one plain `<a rel="sponsored nofollow">` to `goPath(offerId)`; the page maps `goPath` and passes the finished href to the component.
  - Never `next/link` (it prefetches).
  - Never `target`, `noreferrer` or `referrerpolicy` (the source page comes from the Referer).
  - A product card has one link, to `/producto/<slug>`, stretched over the card with a `::after` pseudo-element on the title anchor; it never carries a `/go` link.
- **(3)** Admin screens rely on the server's role check. Hiding a button is a
  UX choice, not access control.
- **(4)** Show the final product price with IVA included. Never do money
  arithmetic in floats on the client.
- **(5)** Set no cookie for public visitors. Only cookieless Umami analytics,
  with no PII in client logs or analytics events.

## Definition of done for this lane

- [ ] Every guardrail above checked against your diff
- [ ] Types mirror the backend contract notes exactly
- [ ] Lint and test commands from `CLAUDE.md` § Commands run and passing, or
      their absence reported
- [ ] Any convention you established written as a `pack_corrections` entry for
      this file
