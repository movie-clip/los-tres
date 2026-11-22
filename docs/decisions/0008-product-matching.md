# 0008 — Matching offers to products

Status: accepted, 2026-10-16. Amended in place 2026-11-22 (S7.1, owner ruling D-10 of run 2026-11-22-s7-1-matching): the text below is the decision as built. The queue, the alias table, merge, split and stored admin decisions of the original text are not built and are not in the MVP (`mvp.md` § Matching, owner ruling 2026-10-26).

## Decision

Each imported offer that is new (not already stored for its feed and external id) is attached to one product, in this order:

1. **EAN.** If the offer has a valid EAN (GTIN-13 or GTIN-8 with a correct
   check digit; spaces and hyphens ignored) and exactly one product has that
   EAN, it attaches there, unless both the offer and that product have a brand
   and the normalised brands differ. A missing brand on either side is not a
   disagreement.
2. **Brand + part number.** Otherwise, when the offer has both a brand and a
   part number, it attaches to the one product with the same normalised brand
   and normalised manufacturer part number. The part number is normalised by
   removing spaces, dashes and dots and upper-casing it, so `0 986 494 123`
   equals `0986494123`. The brand is normalised by trimming, collapsing inner
   whitespace and upper-casing it. Brands are compared **by that normalisation
   only**: there is no alias table, so `Bosch` and `Robert Bosch` are two brands
   and `Mann-Filter` and `Mann Filter` are two brands. An alias table is S7.3,
   deferred.
3. **New product.** If neither matches, a new product is created from the
   offer.

An offer with no brand or no part number is never attached by step 2. A stored
product whose normalised brand or part number is empty is never found by step 2
and there is no backfill. A product hidden by the admin still matches: the
offer attaches and stays hidden with it.

**Conflicts keep the offer as its own product.** The offer is not rejected,
not merged and not held back: a new product is created for it, counted as a
created product and a created offer, and it is public under the usual rule and
not otherwise. There is no queue. The import prints
`  record <n>: own_product <reason>` for it, with one of four reasons and no row
text, and the run does not fail. The four cases:

- `ean_brand_conflict`: one product has the EAN and its brand is known and
  differs from the offer's. Step 2 is not consulted.
- `ambiguous_ean`: two or more products have the EAN. Step 2 is not consulted.
- `brand_part_number_ean_conflict`: no product has the EAN, and the one product
  with the brand and part number carries a different EAN.
- `ambiguous_brand_part_number`: two or more products have the brand and part
  number.

An offer with an EAN that no product holds attaches to a product with the same
brand and part number that has no EAN, and an offer with no EAN attaches to one
that has. Attaching never changes the product's text, so a product that
converged a row carrying an EAN still has no EAN: a later row with that EAN and
a different brand and part number does not reach the product by EAN.

Matching decides which product an offer belongs to and publishes nothing:
approvals, hiding and category mapping are unchanged (guardrail 1).

## Why

- EAN is the most reliable shared key across feeds. Brand + part number is how
  auto parts and tools are identified when the EAN is missing.
- A wrong merge cannot be undone in the MVP, because there is no merge or
  split. Where the data does not settle a match, the offer stays its own
  product: a duplicate page is safer than the wrong shop under the wrong
  product, and an offer is never dropped for a state our own rule created.

## Consequences

- A conflict can leave two products with one EAN or one brand and part number.
  Rows that meet them later become their own products (`ambiguous_*`); the
  duplicates are never healed. A duplicate is hidden by the admin.
- A stored offer is never re-matched, and products already stored are never
  merged, so a repeat import creates nothing and lists no own-product row again.
- The first feed's text wins: a product's title, brand, part number, EAN and
  description are written once, when it is created.
- The lookup in step 2 is served by the existing index on the normalised part
  number; no uniqueness is enforced on any of brand, part number or EAN.
- Two `import-feeds` processes run at once can each create a product for one
  new key; the command is manual and this is accepted.
- An offer from an approved feed that converges onto a product created by a feed
  since disabled makes that product public with the first feed's text; flagged
  to the owner, not addressed.
