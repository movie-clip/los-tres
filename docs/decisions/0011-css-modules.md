# 0011 — Styling: CSS Modules

Status: accepted, 2026-10-17.

## Decision

The owner's answer to the styling question (O-4) that 0010 left open before
slice B: "CSS Modules (Recommended)".

- **Styling:** components are styled with co-located `*.module.css` files,
  which Next.js supports without a new dependency.
- `src/app/globals.css` keeps the CSS custom properties and the reset from
  slice A. No new global classes are added to it.

This replaces the styling line of 0010 ("plain `globals.css` with CSS
variables for slice A ... until the owner chooses").
