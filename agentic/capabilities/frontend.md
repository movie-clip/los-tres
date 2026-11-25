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

Listing components: `ProductCard`, `ProductGrid`, `Pagination`, `CategoryEmpty` (`homeLabel` optional: no link when omitted; optional action `{href,label}`: a secondary-button anchor for a way out other than home; optional `secondAction` for the two-action all-left-out card, and `testId` on an action), `FitMark` (`kind`, `label`, `id`; `fitMarkKind` maps a fit group to a mark), `ListingGroup` (section named by its h2, optional help; `groupRuns` splits a card list into runs of one group), `ListingNote` (`role=note`, composes the `DemoNotice` look), all in `src/components`; `ProductCard` takes optional `fit` and `headingLevel` (3 inside a group), `BrandChips` (links in a `ul` named by its label, two lists (narrow 2 chips, wide 8, `NARROW_BRAND_CHIPS` and `VISIBLE_BRAND_CHIPS`), each its own `ul` and native `details` open when the selected chip is inside, testids `brand-chips-narrow` / `brand-chips-wide`, `display: none` swapped at 40rem; e2e must scope to the visible list), `CategorySort` (GET form, native select plus submit, option values are the public URL values), `CategoryResultsPanel` (slots: brands, count, sort; S11.4), `CategoryTiles`, `SearchForm` (variants hero, page, header; replaces `HomeSearch`; ids and test ids per variant; button and field share a row with grow 1 against 1000 so a wrapped button takes the full line), `SiteHeader` (styles in `SiteHeader.module.css`; it puts the car control in row 1 (`.carInline`, last item) when no car is selected and in row 2 (`.carRow`) when one is; the no-car control is a 44 x 44 CSS-drawn glyph button from 22rem to below 40rem, glyph plus words from 40rem and below 22rem), `SiteFooter`, `DemoNotice` (`p role=note`, first child of main), `LegalText` (42rem column plus `LegalTitle`/`LegalHeading`/`LegalParagraph`/`LegalList`/`LegalItem` and `legalRichTags`) in `src/components` (display strings only); legal page bodies live in a sibling `content.tsx` taking `{ t, siteName, owner }`; page-level styles in a `page.module.css` beside the `page.tsx`.

Product page fit (S5.9): the page loads the `Fit`, `ProductFit` and `CarPicker` namespaces and builds every finished string and href. `FitBanner` (props `kind`, `text`, `help`, `link`; server component; `role=note` on a `div`, `data-testid` `fit-banner` with `data-fit` fits, no-fit, unknown or unchecked, and `fit-banner-link`) sits between `ProductHero` and `OfferList` when `ProductFit.banner` is not null. The page passes `help` only for unknown and `link` only for no-fit (`withCar(categoryPath(product.categorySlug), car.vehicle.slug)`); the link composes `home` from `CategoryEmpty.module.css`, and a two-class selector `.banner .link` overrides the composed padding. `VehicleList` (props `heading`, `help`, `rows: VehicleListRow[]`, `yourCarLabel`, `moreLabel` (string or null), `fewerLabel`; server component, no script; testids `vehicle-list`, `vehicle-list-row`, `vehicle-list-your-car`, `vehicle-list-more`, `vehicle-list-toggle`) sits between `OfferList` and `ProductDescription` when the row list is not empty. The page builds each row (`groupName` from `ProductFit.groupName` trimmed, `detail` from `CarPicker.engineDetail`, `years`, `yearsOngoing`, `href` `withCar(categoryPath(product.categorySlug), vehicle.slug)`, `isSelectedCar` by slug) and passes `moreLabel` only when rows exceed `VEHICLE_LIST_VISIBLE`; `splitVehicleRows` in `vehicle-list-groups.ts` (pure; `VehicleListRow` is defined there and re-exported by `VehicleList.tsx`) splits by vehicle count, a straddling group in both halves. Tile links carry `rel="nofollow"` and are the one internal link whose `coche` is not the selected car. A visually hidden span is position absolute, 1px, margin -1px, overflow hidden, `clip-path: inset(50%)`, nowrap (`CarControl.module.css .words`, `VehicleList.module.css .hidden`); a native `details` whose two labels swap by `.x[open] .a, .x:not([open]) .b { display: none }` needs no script.

Listings with a car (S5.8): a component that needs a unique id for `aria-labelledby` or `aria-describedby` (`ListingGroup`, `ProductCard`) uses React `useId`, which works in a server component; the page never invents ids. With a selected car the category page renders only chips with a listed count above zero, and the change-car action is `carLinks(car).change` (the no-script header "Cambiar" href, `volver` set), a plain anchor. The search page's car view mirrors the category page: `groupRuns` over `result.products`, one `ListingGroup` per run, `ListingNote` when `fitsCount` is 0, the exact-hit help count is `fit.exactNoFitCount` (the group total across pages, not the cards of the page), and the counts line is `carCountsLine(term, parts, pageIndicator)`, which returns a `CountsLine` element (prefix `Search.summaryCarPrefix`) inside the paragraph keeping `data-testid` `search-summary`. `CountsLine` (`src/components/CountsLine.tsx`; `prefix` optional, `parts: string[]`) renders no element of its own: each part is an inline-block span, every part but the last ends with a nested `nowrap` span holding " ·" (D-21), and a plain space sits between parts, so the text content is the parts joined by " · " and no wrapped line starts with the dot. Group heading and help copy for both pages come from `groupCopy(tFit, group, carName, exactCount | null)` in `src/components/listing-group-copy.ts`; never copy it into a page.

The root layout is `html` and `body` only. The public header and footer come from `src/app/PublicChrome.tsx`, used by `src/app/(public)/layout.tsx` and by `src/app/not-found.tsx` (which sits outside that layout). `SiteHeader` takes `search: SearchFormProps | null` from `PublicChrome`; `div.search` in `SiteHeader.module.css` owns the flex sizing and the `:global(body:has([data-search-page])) .search` hide rule, so `SearchForm`'s own `.header` flex rules are inert. Admin screens draw their own `AdminHeader` and never show them.

`NotFoundContent` (`src/components`) is the one 404 body; it takes an optional `homeHref` (finished, `withCar('/', selectedSlug(car))`) and both not-found files read the car and pass it; `src/app/not-found.tsx` wraps it in `PublicChrome` for unmatched top-level URLs, `src/app/(public)/not-found.tsx` renders it bare for `notFound()` raised inside `(public)`.

Admin UI is `src/components/admin/` (`AdminHeader`, `AdminNav`, `TextField`, `PendingButton`, `AdminNotice`, `ErrorBlock`, `AdminMessage`, `ActionButton`, `StatusTag`, `ConfirmPanel`, `SourceRow`, `ShopGroup`, `SourcesList`, `SourcesPage`), presentational. S3.1 adds `FormScreen`, `FormActions`, `SelectField`, `FieldHint`, `ValueLine`, `DemoMark`, `TextLink`, `LinkButton`, `CreateToolbar`, `InfoBlock`, `EmptyList`, `NetworkList`, `NetworksSection`, and the clients `NameSlugForm` and `FeedForm`; `FeedForm` takes a create variant (source Select, then Red and URL or Nombre del archivo, one block rendered) and two edit variants keyed on `source`: affiliate_network, and a file variant whose `source` is catalogue_file or collected_file (S12.2). A collected file is a file source wherever `FeedForm` tests the file kind; only its label, hint, warning body and the static `collected-info` Info block differ, from `labels.collected` (S12.2); the source and the network choice live in client state because the server echoes neither (S3.7). A client form binds its action with `useSourceForm` (`components/admin`), receives finished strings from `source-form-labels.ts`, and never names the feed URL: it posts an uncontrolled input named `url` with no `defaultValue` and reads it nowhere but at submit. A server action reaches a component as a prop (`AdminHeader.signOut.action`). A stateful form that calls an action lives beside its page (`src/app/admin/acceso/SignInForm.tsx`). Client rows that call a server action (`SourceRow`) receive it as a prop from the page and may `import type` from `src/server/admin/sources` and from the route's `actions.ts` under `src/app` (a server action's state type); a component never imports a runtime value from `src/server`.

Admin categories (S4.2): `CategoriesPage`, `CategoryFeedSection` (server); `CategoryFeedRows`, `CategoryRow`, `CategoryButton`, `CategorySelect`, `CategoryResultLine` (client); `CategoryStateTag`, `category-result.ts`, `useCountText`. One `useActionState` per feed, one form per row, buttons send `name=intent` (assign, outside, remove) and `CategoryFeedRows` picks the action.

Admin products (S2.4): `ProductsPage`, `ProductSearchForm` (GET form, `role=search`, hint joined by `describedBy`, Check field inside), `ProductRow`, `ProductState`, `ProductIdentifiers` (server); `ProductHideToggle` (client, one form per item); `ProductDetailPage`, `ProductBox`, `ProductOffersSection`, `ProductOfferRow` (server). `ProductHideToggle` receives its action as a prop and may `import type` `HideActionState` from `productos/actions`. US-2.5: `ProductState` takes `reasonLabel` and `reason` (finished text or null; testid `<prefix>-reason`, a full-width third flex child); codes map to keys only in `product-reason-labels.ts` (`REASON_KEY`, total over `NotPublicReason`); the toggle's shown-state choice is `hide-toggle-state.ts`.

Reusing a button look in a non-submit button: `composes: button outlined from './PendingButton.module.css'` in the new module, no copied rules (`ActionButton.module.css`).

`src/app/admin/error.tsx` is a client component and cannot read configuration or messages: `src/app/admin/layout.tsx` fills `AdminFallbackProvider` with finished strings and `error.tsx` reads them with `useAdminFallback()`.

`(public)/error.tsx` reads `usePublicFallback()`, filled by `PublicChrome`; no client file imports messages/es-ES.json. Its home link is a plain `<a href={fallback.homeHref}>` (no `next/link`); `homeHref` is `withCar('/', selectedSlug(car))` computed in `PublicChrome`, so the error page carries the selected car (T5.7.5).

Car control (S5.7): `CarControl` (client) is mounted by `SiteHeader` (`car` prop, optional, null draws none) from `PublicChrome`, which builds finished strings and the picker tree (`getPickerOptions`, `getPickerLabels`, exported for `/mi-coche`). `CarPickerStep` has no hooks and serves the dialog and the `/mi-coche` page; `CarNotice` is the first child of `main` on each public page; `car-storage.ts` owns the one key `mi-coche`. A public page builds every internal href with `withCar(path, selectedSlug(car))` from `src/server/catalogue/paths`; a component never imports it, it receives finished `href` strings (`homeHref` on `SiteHeader`, `CategoryEmpty`, `NotFoundContent`; the `car` slug on `SearchForm`; the `hidden` list on `CategorySort`). `goPath` is never wrapped.

A native `<dialog>` module sets `display` only on `.dialog[open]`, and from 40rem uses the fixed `height: min(44rem, calc(100% - 2 * var(--space-4)))` with `margin: auto` (`fit-content` resizes per step): an auto height on a modal dialog stretches between the insets. A CSS module cannot hold a selector with no local class, so a `body:has(dialog[open])` scroll lock cannot live in a module; the dialog sets `document.body.style.overflow` while mounted instead.

A `clip-path: path()` glyph on an empty aria-hidden span is the icon technique (`CarControl.module.css .glyph`); a media query cannot use a token, so the 22rem and 40rem breakpoints are written as 21.99rem and 39.99rem ranges.

`.page p { color: var(--color-muted) }` (specificity 0,1,1) beats a single-class module rule on any `<p>` inside `.page`: text that must not be muted is a `span` or `h2`, and `p` is for muted prose; where it must stay a `p` (the home tagline), override with a two-class selector under the container (`.panel .tagline`), never `!important`. A count that must not be muted inside `.page` is a `p` under a two-class selector (`.panel .count`), the home tagline precedent; `CategoryResultsPanel` does this (S11.4).

English in code, Spanish only in URLs and messages (owner ruling D-8): the rule and its URL-value table are in `backend.md` § Layout.

`body` is a flex column with `body > main { flex: 1 0 auto; width: 100% }` in `globals.css` so the footer sits at the bottom of short pages; `.page` centres with auto margins, which stops a flex item stretching, so any new full-width flex child of body needs an explicit width.

Tokens live only in `src/app/globals.css` `:root`. No `*.module.css` writes a raw colour (hex, `rgb()`, `hsl()`), `box-shadow`, `transition`, `transform` or `animation`, and a comment in a module must not contain those words either, because the static guard reads comments: avoid the banned property words in module comments (S11.1, #242; the owner ruled out shadows and motion). A chevron is a `clip-path` polygon on an empty `::after`, not a rotated border. A chevron that must flip when a `details` element opens is two `clip-path` polygons (down, and up under `[open]`); `transform` is banned, so never rotate it. The check mark on a selected chip is a `clip-path` polygon too (S11.4).

The home `main` has no `.page`: the masthead section is full width and its inner div carries `max-width: var(--content-width)` and `padding-inline: var(--gutter)`; the rest of the page sits in a `div.page` (S11.1, #242); with an unrecognised car, the notice is the first element of `panelInner`, in `.notice` capped at 36rem, above the h1. Never use `100vw` for a full-bleed band.

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
- `next.config.ts` is wrapped with `createNextIntlPlugin('./src/i18n/request.ts')`; server components use `getTranslations(namespace)` and `getLocale()` from `next-intl/server`. A client component gets finished strings as props; the one exception is a client part whose strings depend on an action result, which its page wraps in `NextIntlClientProvider` (the S4.2 bullet below).
- `getRequestConfig` sets `timeZone: 'Europe/Madrid'`; dates are ICU placeholders in messages, for example `{date, date, medium}`. Counts use ICU plurals. Public product pages live at `src/app/(public)/producto/[slug]/page.tsx`, call one `cache()`-wrapped read function, and call `notFound()` on `null`.
- Messages with rich tags (`<b>`, `<email>`, `<aepd>`) are rendered with `t.rich` and tag functions from `legalRichTags`; owner values enter as ICU values and are escaped. The owner's identity is read only in the `page.tsx` of `aviso-legal` and `privacidad` via `getOwnerIdentity()`.
- Admin copy is the nested `Admin` namespace (`Admin.Chrome`, `Admin.SignIn`, ...), read with `getTranslations('Admin.SignIn')`. A client form receives its strings as a `labels` prop from the page, with no `NextIntlClientProvider` except the S4.2 case below.
- A `useActionState` form resets uncontrolled fields after the action. Return the typed value in the state and set `defaultValue` from it: the email survives, the password clears.
- A client row cannot call next-intl: the page precomputes every string for both states of the row (tag, button names, confirm, done, error) and passes them as `labels`. A count that can reach four digits is formatted in the page with `Intl.NumberFormat(LOCALE, { useGrouping: 'always' })` and passed as an ICU value, because es-ES drops the separator on four digits.
- A client row whose server read is revalidated after its action renders the action's stored answer only while the page's read is the one it arrived with: keep `{state, readKey}`, the key built by `hideReadKey` from hidden, publicNow and reason, so a read that changed only the reason supersedes the answer (US-2.5), in `useState` and replace it during render when the action state changes (`ProductHideToggle`); a refreshed read takes over.
- The admin list pager reuses the public `Pagination` component (display strings only); a GET search form needs no script and its state is the address; `adminProductListHref` and `adminProductHref` build every list and product link.
- A row that opens an inline panel keeps `openedFor` (the action state it was opened in) and derives `confirming = openedFor === state`, so any new result closes it without setState in an effect.
- A form with an inline confirm (`FeedForm`) keeps `openedFor` = the action state it was opened in, so any result closes it; an `onSubmit` that calls `preventDefault` stops React's form action, which is how the confirm intercepts the first submit. A native select has no `readOnly`: `SelectField` sets `aria-readonly` and ignores the pointer while pending, and never disables, because a disabled select drops out of `FormData`.
- React does not move a select's default when `defaultValue` changes, so a form reset after an action reverts a select to its first default; set the select again in an effect keyed on the action state (it runs after the reset). A `key` on the select was tried first and failed the e2e with three `#source-shop` selects in the DOM.
- `tests/unit/messages.test.ts` allow-lists ICU placeholder names for `Admin` (since S2.4 it also holds `term`, `page`, `pages` and `title`; a new placeholder needs the allow-list edited in the same pass; the order must name that test in its fence, as S3.7 did for `kinds`) and scans every Admin namespace except Sources and Form for `olvid|registr|recuérd|recuerd|restablec` (`signInWordingOffenders`); new Admin copy may not say registr..., or the test needs Categories exempted by the test lane (`Categories.feedsEmpty` is exempted in `FEED_REGISTRATION_KEYS`, see `testing.md`); `Admin.Sources` and `Admin.Form` copy may say "registrar".
- Where only one form needs a limit the others do not give (`FormLimits.fileName`, `fileKinds`), the field is optional and the other forms' message strings for it are empty, never a made-up limit; `fileKindsText` in `source-form-labels.ts` formats the endings with `Intl.ListFormat`.
- Two uncontrolled inputs of the same component in the same slot of a conditional (FeedForm's file name and feed address) need distinct keys, or React reuses the DOM input and a typed value crosses the switch. The file-name input is keyed per file kind (`file-catalogue`, `file-collected`), so a name typed under one never survives a switch to the other (S12.2).
- A client part whose strings depend on an action result (a count, a target name) cannot be precomputed: the page wraps it in `NextIntlClientProvider` with only the messages it reads (`getMessages()`, a subset) and the part reads `useTranslations`; it is the exception to the `labels` rule above and the first such use (S4.2).
- Several submit buttons in one form: each carries `name=intent` and `value`; `useFormStatus().data.get('intent')` says which was pressed, so only that one reads its pending label. React puts the submitter name and value into the `FormData` of a form action.
- `export type { ... } from` inside a `'use server'` file builds (confirmed by `npm run build` in S4.2): a client part may import action state types from the route's `actions.ts`.
- A list of selects with the same visible label: `SelectField` takes `labelledBy` (the id of the row's name element) and is named by its label plus that element.
- A client component that calls a server action through `useActionState` wraps it in try/catch: a transport failure rejects the promise and would reach `error.tsx`. Return a failed state, and rethrow an error whose digest starts with `NEXT_REDIRECT` so the sign-in redirect still navigates.
- A Next route built from `robots.ts` with `force-dynamic` shows as dynamic in the build and reads `SITE_URL` per request; confirmed by running one build against two env values.
- A missing product, missing category, or page or brand past the last is served as a full server-rendered 404 (header, main, footer, `lang`, stylesheets): `src/proxy.ts` rewrites it to the root not-found, so that page needs no client rendering. The root `not-found.tsx` needs `generateMetadata` only (a title element there loses to the layout title).
- Next dev and the production build differ on a thrown notFound(): dev uses the not-found boundary's metadata, production keeps the page's. Set the 404 title in both the page's generateMetadata (after requireAdminPage and the id/row check) and the boundary's.
- A search page past the last is served as a 404 through `src/proxy.ts` (matcher in `backend.md` § Layout) and `isMissingPublicPage`, like a missing category; a bare notFound() gives an empty-body 404.
- A server error on a public page renders `(public)/error.tsx` only after hydration: the response is a 500 with an empty-body error shell (`html#__next_error__`), so an HTTP-only check cannot see the error page.
- Listing pages read `?pagina` through `parsePageParam`, call `notFound()` on a null read, link page 1 as the clean path with no `?pagina=1`, and use plain `<a>` (not `next/link`) for every internal link in the public site; a soft navigation would keep a stale car header (D8). A public navigation that can change the selected car is a full document load (plain `<a>`, `location.replace`, `location.reload`): the `(public)` layout is not re-rendered on a soft navigation.
- A server component may pass `t.rich(...)` output (a ReactNode) as a prop to a client component; `CarControl` receives `Car.selected` that way, so the client needs no message provider.
- Dev checks of a client component through Playwright must open the dev server as `localhost`, not `127.0.0.1`: Next blocks the HMR resources for the other origin and the page never hydrates.

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
- [ ] `npm run check` run and passing (0006 rule 8); the full `npm run gate` runs at the integration review
- [ ] Any convention you established written as a `pack_corrections` entry for
      this file
