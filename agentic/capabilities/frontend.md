# Capability pack: frontend — project `los-tres`

For the `frontend` lane (`engineer`). The public catalogue (search, category and
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

`src/components/CategoryIllustration.tsx` owns the five inline SVGs, painted by classes of its module (tokens only); `toIllustrationKey(slug)` is the only slug-to-drawing mapping. `ProductCard` always renders the `aria-hidden` `card-tile`; the product-page label comes from `Product.imageByCategory.<slug>` or `Product.imagePlaceholder`.

`robots.ts` sits at `src/app/` root with `force-dynamic` and never names the user-agent identifier (omit the rules `userAgent` key; Next writes the wildcard group). Pages build metadata with `pageSeo(getPublicOrigin(), productPath|categoryPath(...), indexable)` from `src/server/catalogue`, never inline `/producto/` or `/categoria/` templates.

Listing components: `ProductCard`, `ProductGrid`, `Pagination`, `CategoryEmpty` (`homeLabel` optional: no link when omitted), `CategoryTree` (home groups), `SiteHeader` (styles in `SiteHeader.module.css`), `SiteFooter`, `DemoNotice` (`p role=note`, first child of main), `LegalText` (42rem column plus `LegalTitle`/`LegalHeading`/`LegalParagraph`/`LegalList`/`LegalItem` and `legalRichTags`) in `src/components` (display strings only); legal page bodies live in a sibling `content.tsx` taking `{ t, siteName, owner }`; page-level styles in a `page.module.css` beside the `page.tsx`.

The root layout is `html` and `body` only. The public header and footer come from `src/app/PublicChrome.tsx`, used by `src/app/(public)/layout.tsx` and by `src/app/not-found.tsx` (which sits outside that layout). Admin screens draw their own `AdminHeader` and never show them.

Admin UI is `src/components/admin/` (`AdminHeader`, `AdminNav`, `TextField`, `PendingButton`, `AdminNotice`, `ErrorBlock`, `AdminMessage`, `ActionButton`, `StatusTag`, `ConfirmPanel`, `SourceRow`, `ShopGroup`, `SourcesList`, `SourcesPage`), presentational. A server action reaches a component as a prop (`AdminHeader.signOut.action`). A stateful form that calls an action lives beside its page (`src/app/admin/acceso/SignInForm.tsx`). Client rows that call a server action (`SourceRow`) receive it as a prop from the page and may `import type` from `src/server/admin/sources` and from the route's `actions.ts` under `src/app` (a server action's state type); a component never imports a runtime value from `src/server`.

Reusing a button look in a non-submit button: `composes: button outlined from './PendingButton.module.css'` in the new module, no copied rules (`ActionButton.module.css`).

`src/app/admin/error.tsx` is a client component and cannot read configuration or messages: `src/app/admin/layout.tsx` fills `AdminFallbackProvider` with finished strings and `error.tsx` reads them with `useAdminFallback()`.

`.page p { color: var(--color-muted) }` (specificity 0,1,1) beats a single-class module rule on any `<p>` inside `.page`: text that must not be muted is a `span` or `h2`, and `p` is for muted prose; where it must stay a `p` (the home tagline), override with a two-class selector under the container (`.panel .tagline`), never `!important`.

`body` is a flex column with `body > main { flex: 1 0 auto; width: 100% }` in `globals.css` so the footer sits at the bottom of short pages; `.page` centres with auto margins, which stops a flex item stretching, so any new full-width flex child of body needs an explicit width.

Tokens live only in `src/app/globals.css` `:root`. No `*.module.css` writes a raw colour (hex, `rgb()`, `hsl()`), `box-shadow`, `transition`, `transform` or `animation`, and a comment in a module must not contain those words either, because the static guard reads comments: avoid the banned property words in module comments (S11.1, #242; the owner ruled out shadows and motion). A chevron is a `clip-path` polygon on an empty `::after`, not a rotated border.

The home `main` has no `.page`: the masthead section is full width and its inner div carries `max-width: var(--content-width)` and `padding-inline: var(--gutter)`; the rest of the page sits in a `div.page` (S11.1, #242). Never use `100vw` for a full-bleed band.

A CSS Module file next to a component is imported as `styles` and typed by Next's `*.module.css` declaration. Class names are hashed in the HTML, so tests select by `data-testid` or role, never by class.

Working-copy files are CRLF on Windows (autocrlf): edit existing files with the Edit tool and write new ones with Write. A heredoc containing an apostrophe in a comment fails the whole Bash command and writes nothing; use Write for files with prose comments.

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
- Messages with rich tags (`<b>`, `<email>`, `<aepd>`) are rendered with `t.rich` and tag functions from `legalRichTags`; owner values enter as ICU values and are escaped. The owner's identity is read only in the `page.tsx` of `aviso-legal` and `privacidad` via `getOwnerIdentity()`.
- Admin copy is the nested `Admin` namespace (`Admin.Chrome`, `Admin.SignIn`, ...), read with `getTranslations('Admin.SignIn')`. A client form receives its strings as a `labels` prop from the page; no `NextIntlClientProvider`.
- A `useActionState` form resets uncontrolled fields after the action. Return the typed value in the state and set `defaultValue` from it: the email survives, the password clears.
- A client row cannot call next-intl: the page precomputes every string for both states of the row (tag, button names, confirm, done, error) and passes them as `labels`. A count that can reach four digits is formatted in the page with `Intl.NumberFormat(LOCALE, { useGrouping: 'always' })` and passed as an ICU value, because es-ES drops the separator on four digits.
- A row that opens an inline panel keeps `openedFor` (the action state it was opened in) and derives `confirming = openedFor === state`, so any new result closes it without setState in an effect.
- A client component that calls a server action through `useActionState` wraps it in try/catch: a transport failure rejects the promise and would reach `error.tsx`. Return a failed state, and rethrow an error whose digest starts with `NEXT_REDIRECT` so the sign-in redirect still navigates.
- A Next route built from `robots.ts` with `force-dynamic` shows as dynamic in the build and reads `SITE_URL` per request; confirmed by running one build against two env values.
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
- **(5)** Set no cookie for public visitors. No analytics script (0014), and
  no PII in client logs.

## Definition of done for this lane

- [ ] Every guardrail above checked against your diff
- [ ] Types mirror the backend contract notes exactly
- [ ] Lint and test commands from `CLAUDE.md` § Commands run and passing, or
      their absence reported
- [ ] Any convention you established written as a `pack_corrections` entry for
      this file
