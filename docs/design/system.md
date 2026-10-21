# Design system

Approved by the human on 2026-10-21 (decision D-1 of the S5.2 run, "approved as is"), with the S5.2 home category tree UX spec. The S5.1 system (decision D-2) is the base. The tokens live in `src/app/globals.css` as CSS custom properties.

## Principles

1. **Scan, then click.** The visitor knows what they want. Every list reads in one fixed order, in the same place on every row: what it is, then what it costs (or how much is there), then where it goes.
2. **The price is the truth.** Prices are final, IVA included, and a page that shows prices says so once, near the top. No shipping, no totals.
3. **Plain beats clever.** One typeface, one link colour, one border colour, no shadows, no motion. Trust comes from consistency.
4. **The one bold element is the brand, not the list.** It is spent once, on the brand panel on the home page. Nothing on a list, a category group or an offer row competes for attention, and no other page gets a filled panel.

## Palette

| Token | Value | Role | Contrast on `--color-bg` |
|---|---|---|---|
| `--color-bg` | `#ffffff` | page and card background; also the text on the brand panel | n/a |
| `--color-text` | `#1a1a1a` | headings, titles, prices | 17.4:1 |
| `--color-muted` | `#555555` | secondary text: brand, counts, notes | 7.5:1 |
| `--color-border` | `#e2e2e2` | dividers, card and group outline | 1.3:1, decorative only (never the only cue) |
| `--color-link` | `#0b5cad` | links, filled buttons, focus ring, outlined control borders; also the fill of the brand panel | 6.9:1 |

White text on `--color-link` is 6.9:1.

## Type

System-ui stack, `--font-sans`. Self-hosted fonts only if ever changed.

| Role | Size | Weight | Where |
|---|---|---|---|
| Page title | `--text-xl` 2rem, line-height 1.2 | 700 | the h1 (home: inside the brand panel) |
| Section title | `--text-lg` 1.25rem | 700 | the home "Categorías" h2 (same token as price) |
| Price | `--text-lg` 1.25rem | 700 | card price, offer price |
| Body, card title, group heading, row | `--text-md` 1rem, line-height 1.4 on cards and rows | 400; card title and group heading 600 or 700 as stated per component | body text, card title, summary lines |
| Small | `--text-sm` 0.875rem | 400 | brand, "Desde", shop count, product count, notes |

## Spacing, shape, layout

- Spacing: `--space-1` 0.5rem, `--space-2` 1rem, `--space-3` 1.5rem, `--space-4` 3rem.
- Shape: `--radius` 0.5rem on cards, category groups and the brand panel. Buttons and pagination links stay square.
- Page shell: `.page`, max width `--content-width` (64rem), 3rem top and bottom, 1.5rem sides. Phone content is 342 px wide at 390.
- Header: the header's border runs edge to edge, but its content sits in a column of the same `--content-width` and the same 1.5rem sides as `.page`, so the site name lines up with the page content at every width.
- Card grid: `repeat(auto-fill, minmax(min(16rem, 100%), 1fr))`, gap `--space-2`.
- Group grid: `repeat(auto-fill, minmax(min(18rem, 100%), 1fr))`, gap `--space-2`, `align-items: start`. One column on a phone, three at 1280. No media queries. The 18rem minimum is a constant of the group list component, not a global token.

## Components

| Component | Anatomy | States |
|---|---|---|
| Site header | border-bottom edge to edge; inner column at `--content-width`; site name link at least 44 px tall | default, hover (underline), focus-visible (3 px ring) |
| Brand panel | filled `--color-link` panel, `--radius`, h1 site name, one tagline line; home only | single state, no interaction |
| Category group | outlined box, heading link (top-level category and its count), then rows (child links, each with a count) | row default, hover (underline), focus-visible (inset ring), group without children |
| Product card | outlined box, title link, brand, price, shop count | default, hover, focus-visible, visited (looks the same as default) |
| Pagination | previous link, page indicator, next link | link default, hover, focus-visible, slot absent |
| Empty state | heading, one sentence, one link home on a category page; on the home page the same without the link | single state per page |
| Offer row | shop, price, "Ir a la tienda" button, updated line | unchanged |
| Image placeholder | grey square | unchanged; not used on cards |

## Copy voice

Spanish (`es-ES`), sentence case, *tú* form, plain verbs. A control says where it goes or what it does. Counts use real plurals. Prices read `1.234,50 €` with a non-breaking space before the euro sign. The site name is `{siteName}`, never typed.

## Accessibility floor

Visible 3 px focus ring on every interactive element (`--focus-ring`), including the header link. Text contrast at least 4.5:1, control borders and the ring at least 3:1. Tap targets at least 44 px (`--tap-target`), including the header link and every category row. No motion, so reduced-motion needs no special case. No cookie banner and no consent UI (guardrail 5).

## Tokens

Used as they are: `--color-bg`, `--color-text`, `--color-muted`, `--color-border`, `--color-link`, `--space-1` to `--space-4`, `--content-width`, `--font-sans`, `--radius`, `--tap-target`, `--focus-ring`, `--text-sm`, `--text-md`, `--text-lg`, `--text-xl`.

`--radius`, `--tap-target`, `--focus-ring` and the four `--text-*` sizes were added in S5.1 (no existing value changed): `--radius` `0.5rem`, `--tap-target` `2.75rem`, `--focus-ring` `3px solid var(--color-link)`, `--text-sm` `0.875rem`, `--text-md` `1rem`, `--text-lg` `1.25rem`, `--text-xl` `2rem`. S5.2 adds none.
