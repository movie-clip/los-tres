# Design system

Direction approved by the human on 2026-10-27 (S11.1, #242: "Q1 - Yes" on the direction, amber chosen by the designer, "ignore shadows and too complex effects for now"). The S5.1 and S5.2 system is the base. The tokens live in `src/app/globals.css` as CSS custom properties; where this document and that file differ, the file is the truth.

## Principles

1. **Scan, then click.** The visitor knows what they want. Every list reads in one fixed order, in the same place on every row: what it is, then what it costs (or how much is there), then where it goes.
2. **The price is the truth.** Prices are final, IVA included, and a page that shows prices says so once, near the top. No shipping, no totals. The price is the boldest type in its card or row and carries no colour of its own: a coloured price reads as a discount, and the site shows none.
3. **Plain beats clever.** One typeface, one accent, one ink, no shadows, no motion. Trust comes from consistency.
4. **The brand is the frame; the list is calm.** The bold elements are the ink frame (header, home masthead, footer) and the amber shop button. Nothing inside a list competes with the price.

## Palette

Light only: `color-scheme: light`. Every colour is a semantic token in one `:root`, so a later dark scheme redefines values and touches no component, provided no module writes a raw colour.

| Token | Value | Role | Contrast |
|---|---|---|---|
| `--color-bg` | `#ffffff` | surface: card, panel, input | n/a |
| `--color-canvas` | `#f4f5f7` | page background behind the cards (the `body`) | n/a |
| `--color-ink` | `#15181d` | header, masthead, footer, links, focus ring, card hover border | 17.8:1 on `--color-bg`, 16.3:1 on `--color-canvas` |
| `--color-chip-bg` | `#e9ebef` | chip fill, tile hover, image placeholder fill | n/a |
| `--color-chip-text` | `#3b414a` | chip label | 8.6:1 on `--color-chip-bg` |
| `--color-tile-bg` | `#f4f5f7` | category tile fill (same value as the canvas) | n/a |
| `--color-text` | `#1a1a1a` | headings, titles, body | 17.4:1 on `--color-bg`, 15.95:1 on `--color-canvas` |
| `--color-muted` | `#555555` | secondary text: brand, counts, notes, dates | 7.5:1 on `--color-bg`, 6.8:1 on `--color-canvas` |
| `--color-on-ink` | `#ffffff` | text on ink | 17.8:1 |
| `--color-on-ink-muted` | `#c5cad3` | masthead tagline | 10.8:1 on `--color-ink` |
| `--color-price` | `#15181d` | every price; its own token so it can change in one place | 17.8:1 on `--color-bg` |
| `--color-border` | `#dcdfe4` | card outline, dividers | 1.3:1, decorative only (never the only cue) |
| `--color-border-strong` | `#7d838e` | control edges and interactive chips | 3.8:1 on `--color-bg` |
| `--color-on-ink-line` | `#2d323a` | hairline between header and masthead | decorative |
| `--color-accent` | `#ffb800` | shop button fill, header rule, masthead bar, notice rule, focus ring on ink | 10.3:1 on `--color-ink` as a non-text mark |
| `--color-accent-hover` | `#f0a800` | shop button hover fill | label 8.7:1 |
| `--color-accent-active` | `#d99a00` | shop button pressed fill | label 7.3:1 |
| `--color-accent-edge` | `#a06e00` | 1px edge on the shop button | 4.4:1 on `--color-bg` |
| `--color-on-accent` | `#15181d` | label on amber | 10.3:1 on `--color-accent` |
| `--color-link` | `var(--color-ink)` | links, admin filled-button fill, outlined control border and text, admin notice rule | as ink |
| `--color-focus` | `var(--color-ink)` | focus ring on light surfaces | 17.8:1 on `--color-bg` |
| `--color-success` / `--color-success-bg` | `#17603a` / `#e6f4ea` | state text on its tint | 6.7:1 |
| `--color-warning` / `--color-warning-bg` | `#7a4a00` / `#fff3d1` | state text on its tint; the demo notice uses the tint | 6.8:1 |
| `--color-danger` / `--color-danger-bg` | `#a8201a` / `#fdeceb` | state text on its tint | 6.4:1 |
| `--color-info` / `--color-info-bg` | `#0b5cad` / `#e7f0fa` | state text on its tint | 5.8:1 |
| `--color-disabled-bg` / `--color-disabled-text` | `#e4e6ea` / `#6b717b` | disabled control | 3.9:1, exempt while disabled |

Amber is never text on a light surface (1.7:1 on white): it is a fill, a rule, or a ring on ink. The success, danger and info tokens are defined for later stories; only warning is consumed today (the demo notice), and `--color-info` is the only place `#0b5cad` survives. There is no second link colour: links are ink, told apart by underline and weight. Admin keeps its rule that no colour alone says an error.

## Type

System-ui stack, `--font-sans`, the one swap point if a font is ever added (self-hosted only). No size below `--text-sm`. Weights are `--weight-regular` 400, `--weight-medium` 600 and `--weight-bold` 700 only.

| Role | Token | Size | Weight | Where |
|---|---|---|---|---|
| Display | `--text-display` | 2rem at 390 up to 2.75rem at 1280 | 700, `--leading-tight`, `--tracking-tight` | home masthead h1 |
| Page title | `--text-xl` | 2rem | 700, tight | category h1, legal h1, admin h1 |
| Product title | `--text-title` | 1.5rem at 390 up to 2rem at 1280 | 700, tight | product h1 |
| Price | `--text-price` | 1.5rem | 700, tabular figures, tight | card price, offer price |
| Section title | `--text-lg` | 1.25rem | 700, `--leading-snug` | home "Categorías", offers h2, category group heading, empty-state heading, wordmark |
| Body, card title, tile name | `--text-md` | 1rem | 400; card title and tile name 600 | body 1.5 (`--leading-body`); cards and rows `--leading-snug` 1.4 |
| Small | `--text-sm` | 0.875rem | 400; chip 600 | brand, "Desde", counts, notes, dates, footer, chip |

## Spacing, shape, layout

- Spacing: `--space-0` 0.25rem, `--space-1` 0.5rem, `--space-2` 1rem, `--space-3` 1.5rem, `--space-4` 3rem. Fluid values are tokens: `--gutter` (page side padding, 1rem up to 1.5rem), `--page-pad-block` (`.page` top and bottom, 1.5rem up to 2.5rem), `--card-padding` (1rem up to 1.5rem), `--grid-gap` (1rem up to 1.5rem). They are `clamp()` values, so layout needs no media query for them.
- Radius: `--radius-lg` (0.75rem) on cards, panels and sheets; `--radius-md` (0.5rem) on buttons, tiles, fields and the placeholder; `--radius-pill` on chips; `--radius-sm` (0.25rem) is defined and unused by public components. `--radius` is an alias of `--radius-md` so admin files compile unchanged. Admin buttons and text fields stay square (their files set `border-radius: 0`).
- Page shell: `.page`, max width `--content-width` (64rem), `--page-pad-block` top and bottom, `--gutter` on the sides. Phone content is 358 px wide at 390; desktop content is 976 px wide at 1280.
- Header, masthead and footer share the column: their inner element uses the same max width and `--gutter`, so the site name lines up with the page content at every width (x = 16 at 390, x = 152 at 1280).
- Canvas and cards: the `body` is `--color-canvas`; cards, panels and sheets are `--color-bg` with a 1px `--color-border`. Cards stand off the canvas by fill and border only.
- Card grid: `repeat(auto-fill, minmax(min(16rem, 100%), 1fr))`, gap `--grid-gap`: one column at 390, three at 1280.
- Group list (home): `repeat(auto-fit, minmax(min(22rem, 100%), 1fr))`, gap `--grid-gap`, `align-items: start`; `auto-fit` lets a single group fill the row. Tiles inside a group: `repeat(auto-fill, minmax(min(13rem, 100%), 1fr))`, gap `--space-1`. The 22rem and 13rem minimums are constants of the category tree component, not global tokens.
- Product page: details and offers sit in one column below 52rem and in two columns from 52rem (`minmax(0, 1fr)` and `minmax(0, 26rem)`, `align-items: start`).
- Media queries: public layout uses two. Pagination has one at `max-width: 24rem` (its grid fallback) and the product page has one at `min-width: 52rem`. The admin components have two more at `max-width: 40rem`. Everything else is fluid `clamp()` and `flex-wrap`.
- No shadow: `box-shadow` is not used and no token exists for it. No motion: no `transition`, `transform` or `animation`; states change instantly and nothing moves or changes size on hover. Hover and pressed are told apart by fill colour, border colour and underline only. Chevrons are `clip-path` shapes on an empty `::after`, not rotated borders. A masthead is a normal full-width block, never `100vw`.

## Components

| Component | Anatomy | States |
|---|---|---|
| Site header | ink bar with a 0.25rem `--color-accent` rule on its top edge; inner flex row at `--content-width` and `--gutter`; site-name link, `--text-lg` 700 in `--color-on-ink`, at least `--tap-target` tall, `overflow-wrap: anywhere`; on the home page only, a 1px `--color-on-ink-line` hairline separates it from the masthead; 64 px high | default, hover (underline), focus-visible (3 px `--focus-ring-on-ink`, offset `--focus-offset`) |
| Masthead (home only) | full-width ink band directly under the header, no gap; inner column as the header; h1 in `--text-display`, a 3rem by 0.25rem `--color-accent` bar under it, the tagline in `--color-on-ink-muted` (the only `<p>` on the page); keeps `data-testid="home-panel"` | single state, not interactive |
| Category group | white card (`--radius-lg`, 1px `--color-border`); heading row is one link: group name (`--text-lg` 700), count (`--text-sm` muted) and a chevron, padding `--card-padding`, at least 44 px; below it a tile grid. A group with no children shows the heading row only | heading hover (underline), tile hover, focus-visible (inset ring) |
| Category tile | one link, `--color-tile-bg` fill, `--radius-md`, padding `--space-2`, at least 3.5rem tall; name (`--text-md` 600, `overflow-wrap: anywhere`), count (`--text-sm` muted, nowrap), decorative chevron | default, hover (fill `--color-chip-bg`, 1px `--color-ink` border, name underlined), focus-visible (3 px ring, `outline-offset: -3px`) |
| Product card | white card (`--radius-lg`, 1px `--color-border`, `--card-padding`); a head row of a leading category tile and the text column: the tile is 3.5rem square (a constant of the card, not a token), `--color-chip-bg` fill, 1px `--color-border`, `--radius-md`, `aria-hidden`, not a link and not focusable, top-aligned with the first title line, `--space-2` from the text, and holds the product's own category illustration (an inline SVG, see Image placeholder), or stays an empty square when the category has no drawing; the text column is the title link (600, clamped to 3 lines) and the brand line (`--text-sm` muted, left out when null); then a footer pinned to the bottom: left the price group ("Desde" in `--text-sm` muted when several shops, then the price in `--text-price` 700 `--color-price`), right the shop-count chip. One link covers the whole card | default, hover (border `--color-ink`, title underlined), focus-visible (3 px ring around the whole card), visited (same as default) |
| Chip | pill with one fact, `--text-sm` 600, `--color-chip-text` on `--color-chip-bg`, `--radius-pill`; static (the shop count), not focusable. An interactive chip (later filters) is specified in the S11.1 UX spec and not built | default only |
| Primary button (shop link, public) | plain anchor to `/go/<offer>`, never a new tab; fill `--color-accent`, 1px `--color-accent-edge`, text `--color-on-accent` 700, `--radius-md`, at least `--tap-target` tall, wraps to two lines on a long shop name | default, hover (fill `--color-accent-hover`, no underline), pressed (fill `--color-accent-active`, edge `--color-ink`), focus-visible (3 px `--focus-ring`, offset 2px) |
| Secondary button (pagination, empty-state link) | white fill, 1px `--color-ink` border, text `--color-ink` 600, `--radius-md`, at least 44 px tall | default, hover (fill `--color-ink`, text `--color-on-ink`), pressed (fill `--color-accent`, text `--color-on-accent`, border ink), focus-visible (ring, offset 2px) |
| Pagination | previous link, page indicator, next link, as the secondary button; a missing neighbour is omitted, not disabled | link default, hover, pressed, focus-visible, slot absent |
| Empty state | white card (`--radius-lg`, 1px `--color-border`, `--card-padding`); h2 `--text-lg` 700, one sentence in `--color-muted`, the home link as a secondary button on a category page; on the home page the same without the link | single state per page |
| Offer panel and row | white card as the product card; h2 "Dónde comprarlo", the shop-count line and the VAT line in muted, then an ordered list. Each row has a top border, then: shop name (600, `overflow-wrap: anywhere`), price (`--text-price` 700, nowrap), the primary button (fills the row width on a phone), the "updated" line (`--text-sm` muted). Same order in every row, no row emphasised | row default; only the button reacts to hover and focus |
| Product details | white card; the image placeholder beside the h1 (`--text-title`), then the details list and the description across the card | single state |
| Image placeholder | square `clamp(5rem, 22vw, 11rem)`, fill `--color-chip-bg`, 1px `--color-border`, `--radius-md`; holds the product's category illustration centred with the square showing all round; keeps `role="img"` and a per-category label (`Product.imageByCategory.<slug>`, falling back to `Product.imagePlaceholder`). The illustrations are five inline SVG components, one per leaf category (aceite-de-motor, filtros-de-aceite, filtros-de-aire, filtros-de-combustible, filtros-de-habitaculo), drawn in `--color-ink` and `--color-bg` only through classes of the component's module: no hex, gradient, opacity, transform, amber or image request. A category with no drawing leaves the square plain. The same drawing fills the product card tile | single state; on the product page at full size and, `aria-hidden`, in the product card tile |
| Footer | ink bar, no top border; inner column as the header; one row of three text links (Aviso legal, Privacidad, Cómo nos financiamos) at `--text-sm` in `--color-on-ink`, each at least 44 px tall, wrapping on a phone | default, hover (underline), focus-visible (3 px `--focus-ring-on-ink`), visited (same as default) |
| Demo notice | `role="note"`, first child of `main`; `--color-warning-bg` fill, 1px `--color-border`, 0.25rem `--color-accent` left rule, `--radius-md`, one sentence in `--color-text`; shown only when every offer listed is demo | single state |
| Legal text | reading column 42rem on a white sheet (`--radius-lg`, 1px `--color-border`, `--card-padding`); h1 `--text-xl`, h2 `--text-lg`, body `--text-md` in `--color-text` at `--leading-body`; bullets; bold lead-ins; links ink and underlined | link default, hover, focus-visible |
| Admin header (`src/components/admin/`) | 0.25rem `--color-text` top rule and edge-to-edge bottom border; inner column at `--content-width`; rows at least `--tap-target`, wrapping; brand (site name, 700), divider, "Administración" label in `--color-muted`; when signed in, an identity block ("Sesión iniciada como", the email) and the sign-out button | signed out (brand only), signed in |
| Admin nav | own row under the header, edge-to-edge bottom border; items at least `--tap-target` tall with a 3 px bottom rule; live link in `--color-link`, underlined; current item 700 in `--color-text` with a `--color-text` rule and `aria-current`; later sections as non-focusable `aria-disabled` placeholders in `--color-muted` | live, current, placeholder, hover (thicker underline), focus-visible (3 px ring) |
| Text field | label above (600), control at least `--tap-target` tall, 1rem text, 1px `--color-muted` border, square; no placeholder; message below at `--text-sm` 600 linked by `aria-describedby`; full width of the form column (max 24rem) | default, focus-visible (ring, `--color-link` border), invalid (2px `--color-text` border), read-only while submitting |
| Button, filled and outlined (admin) | filled: `--color-link` fill (ink), `--color-bg` text, 600; outlined: transparent, 1px `--color-link` border and text; both at least `--tap-target` tall, square | default, hover (underline), focus-visible (ring, offset 2px), pending (`--color-muted`, `aria-disabled`, second press ignored) |
| Admin notice | outline, 0.25rem `--color-link` left rule, `--radius`, `role="status"` | single state |
| Error block | 2px `--color-text` border, `--radius`, bold title then message, `role="alert"`; no colour says "error" | single state |
| Admin message | `.page` main with an h1, one muted sentence and an optional link; the Unavailable and not-found screens | single state |
| Shop group (S2.3) | outlined box (1px `--color-border`, `--radius`), h2 shop name (`--text-lg`, 700, `overflow-wrap: anywhere`), meta line (`--text-sm`, `--color-muted`), optional note (`--text-sm`, `--color-text`), control group; then a nested list of feed rows separated by 1px `--color-border` rules | shop approved, shop not approved |
| Status tag (S2.3) | inline text, `--text-sm` 700, padding 0.125rem `--space-1`, `--radius`; not interactive, not focusable. Approved: `--color-text` fill, `--color-bg` text. Not approved: 1px `--color-muted` border, `--color-muted` text. Approved but paused (feed only): 1px dashed `--color-text` border, `--color-text` text. Never the only cue: the words carry the meaning | approved, not approved, paused |
| Confirm panel (S2.3) | the Admin notice look, `role="group"` named by its title (600), one sentence in `--color-text`, then two buttons: "Cancelar" (outlined) then the confirm (filled); asked for disabling only, never for approving | closed, open, pending |
| Row feedback (S2.3) | one line under the control group: a status line (`role="status"`, `--text-sm`, `--color-text`) or the Error block (`role="alert"`) | none, done, failed |
| Action button (S2.3) | the outlined Button look for a button that does not submit a form (it opens or closes a panel); the styles are composed from the outlined PendingButton, no copied rules | default, hover (underline), focus-visible (ring, offset 2px) |

Admin components were not restyled in S11.1. They keep their look, and read the new token values: `--color-link` is ink, so live nav links, filled buttons, outlined controls and notice rules are ink rather than blue, and admin pages sit on the grey canvas with white boxes.

Known issue: a 404 raised inside the public group (`/categoria/<unknown>`, `/producto/<unknown>`) draws the public header and footer twice, because the root `not-found.tsx` wraps the chrome that the public layout already draws. Pre-existing, not yet fixed. An unknown top-level URL shows one header and one footer.

## Copy voice

Spanish (`es-ES`), sentence case, *tú* form, plain verbs. A control says where it goes or what it does. Counts use real plurals. Prices read `1.234,50 €` with a non-breaking space before the euro sign. The site name is `{siteName}`, never typed.

## Accessibility floor

Visible 3 px focus ring with a 2 px offset on every interactive element: ink (`--focus-ring`) on light surfaces, amber (`--focus-ring-on-ink`) on the header and footer; the card ring surrounds the whole card, tile and category-heading rings are inset. Text contrast at least 4.5:1, control borders and the ring at least 3:1. Tap targets at least 44 px (`--tap-target`), including the header link, footer links, pagination links, tiles and every category row. Focus order is reading order, with no positive `tabindex`. No motion, so reduced-motion needs no special case. Amber is never the only cue and never text on a light surface. No cookie banner and no consent UI (guardrail 5).

## Tokens

All tokens live in `src/app/globals.css` `:root`, and nothing else may define a colour: no `*.module.css` writes a hex, `rgb()` or `hsl()` value, a `box-shadow`, a `transition`, a `transform` or an `animation` (a static test in `tests/unit` enforces it, comments included).

- Colour: the palette above, including the state colours, `--color-chip-text` and `--color-price`.
- Spacing: `--space-0` to `--space-4`, `--gutter`, `--page-pad-block`, `--card-padding`, `--grid-gap`, `--content-width`, `--tap-target`.
- Radius: `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-pill`, and the alias `--radius`.
- Focus: `--focus-ring` (`3px solid var(--color-focus)`), `--focus-ring-on-ink` (`3px solid var(--color-accent)`), `--focus-offset` (2px).
- Type: `--font-sans`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl`, `--text-price`, `--text-title`, `--text-display`, `--leading-tight`, `--leading-snug`, `--leading-body`, `--weight-regular`, `--weight-medium`, `--weight-bold`, `--tracking-tight`.

S11.1 kept every name that existed before and changed the value of `--color-border`, `--color-link` and the target of `--focus-ring`; `--radius` became an alias. Component sizes that are not shared stay constants of their component (the 24rem admin form column, the 48rem admin list column, the 22rem group and 13rem tile minimums).
