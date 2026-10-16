# 0008 — Matching offers to products

Status: accepted, 2026-10-16

## Decision

Each imported offer is attached to one product, in this order:

1. **EAN.** If the offer has a valid EAN (GTIN-13 or GTIN-8 with a correct
   check digit) and a product has that EAN, it attaches there.
2. **Brand + part number.** Otherwise, it attaches to the product with the
   same normalised brand and normalised manufacturer part number. The part
   number is normalised by removing spaces, dashes and dots and upper-casing
   it, so `0 986 494 123` equals `0986494123`. Brand names map through an
   alias table the admin maintains (`BOSCH` = `Robert Bosch`).
3. **New product.** If neither matches, a new product is created from the
   offer.

**Conflicts go to review, not merge.** The offer goes to an admin **matching
queue**, and stays off the public site until resolved, in two cases:

- the EAN matches a product but the brand disagrees;
- the EAN points at one product and brand + part number at another.

The admin can **merge** two products into one: offers, history and image move
to the surviving product, and the old URL redirects permanently. The admin can
also **split** offers off a product into a new one.

## Why

- EAN is the most reliable shared key across feeds. Brand + part number is how
  auto parts and tools are identified when the EAN is missing.
- An automatic merge on conflicting data puts the wrong shop under the wrong
  product. That is worse than a short delay in review.

## Consequences

- Admin merge and split decisions are stored and re-applied on the next
  import, so a fix sticks.
- On a merged product, text from the shop the admin ranked highest wins.
