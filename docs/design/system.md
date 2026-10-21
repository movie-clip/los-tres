# Design system

Approved by the human on 2026-10-21 (decision D-2, "approve"), with the S5.1 category browse UX spec. Direction: new.

This codifies the placeholder look that slices A and B shipped (system-ui, white page, one link blue) as a written system, and adds only what the category page needs. Nothing existing changes value. The tokens live in `src/app/globals.css` as CSS custom properties.

## Principles

1. **Scan, then click.** The visitor knows what they want. Every list reads in one fixed order, in the same place on every row: what it is, then what it costs, then where it goes.
2. **The price is the truth.** Prices are final, IVA included, and the page says so once, near the top. No shipping, no totals.
3. **Plain beats clever.** One typeface, one link colour, one border colour, no shadows, no motion. Trust comes from consistency.
4. **The one bold element is the brand, not the list.** It is reserved for the header and home (S5.2). Nothing on a list or an offer row competes for attention.

## Palette

| Token | Value | Role | Contrast on `--color-bg` |
|---|---|---|---|
| `--color-bg` | `#ffffff` | page and card background | n/a |
| `--color-text` | `#1a1a1a` | headings, titles, prices | 17.4:1 |
| `--color-muted` | `#555555` | secondary text: brand, counts, notes | 7.5:1 |
| `--color-border` | `#e2e2e2` | dividers, card outline | 1.3:1, decorative only (never the only cue) |
| `--color-link` | `#0b5cad` | links, filled buttons, focus ring, outlined control borders | 6.9:1 |

White text on `--color-link` is 6.9:1.

## Type

System-ui stack, `--font-sans`. Self-hosted fonts only if ever changed.

| Role | Size | Weight | Where |
|---|---|---|---|
| Page title | `--text-xl` 2rem, line-height 1.2 | 700 | the h1 |
| Price | `--text-lg` 1.25rem | 700 | card price, offer price |
| Body and card title | `--text-md` 1rem, line-height 1.4 on cards | 400; card title 600 | body text, card title, summary lines |
| Small | `--text-sm` 0.875rem | 400 | brand, "Desde", shop count, notes |

## Spacing, shape, layout

- Spacing: `--space-1` 0.5rem, `--space-2` 1rem, `--space-3` 1.5rem, `--space-4` 3rem.
- Shape: `--radius` 0.5rem on cards (matches the image placeholder). Buttons and pagination links stay square, like the "Ir a la tienda" button.
- Page shell: `.page`, max width `--content-width` (64rem), 3rem top and bottom, 1.5rem sides. Phone content is 342 px wide at 390.
- Card grid: CSS grid, `repeat(auto-fill, minmax(min(16rem, 100%), 1fr))`, gap `--space-2`. One column on a phone, three at 1280. No media queries. The 16rem minimum is a constant of the card grid component, not a global token.

## Components

| Component | Anatomy | States |
|---|---|---|
| Site header | site name link | default, focus-visible |
| Product card | outlined box, title link, brand, price, shop count | default, hover, focus-visible, visited (looks the same as default) |
| Pagination | previous link, page indicator, next link | link default, hover, focus-visible, slot absent |
| Empty state | heading, one sentence, one link home | single state |
| Offer row | shop, price, "Ir a la tienda" button, updated line | unchanged |
| Image placeholder | grey square | unchanged; not used on cards in S5.1 |

## Copy voice

Spanish (`es-ES`), sentence case, *tú* form, plain verbs. A control says where it goes or what it does. Counts use real plurals. Prices read `1.234,50 €` with a non-breaking space before the euro sign. The site name is `{siteName}`, never typed.

## Accessibility floor

Visible 3 px focus ring on every interactive element (`--focus-ring`). Text contrast at least 4.5:1, control borders and the ring at least 3:1. Tap targets at least 44 px (`--tap-target`). No motion, so reduced-motion needs no special case. No cookie banner and no consent UI (guardrail 5).

## Tokens

Existing, used as they are: `--color-bg`, `--color-text`, `--color-muted`, `--color-border`, `--color-link`, `--space-1`, `--space-2`, `--space-3`, `--space-4`, `--content-width`, `--font-sans`.

Additive in S5.1 (no existing value changes):

| Token | Value | Why no existing token serves |
|---|---|---|
| `--radius` | `0.5rem` | the image placeholder borrowed `--space-1` for its radius; a radius needs its own name so a spacing change cannot move corners |
| `--tap-target` | `2.75rem` | the "Ir a la tienda" button hard-coded `2.75rem`; the pagination links must match it |
| `--focus-ring` | `3px solid var(--color-link)` | no focus style was defined; the ring must be one value everywhere |
| `--text-sm` | `0.875rem` | already hard-coded on the offer "updated" line |
| `--text-md` | `1rem` | names the body size so cards can refer to it |
| `--text-lg` | `1.25rem` | already hard-coded on the offer price |
| `--text-xl` | `2rem` | the h1 (the browser default 2em, now explicit) |
