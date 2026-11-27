# Category attributes — feature spec

Owner ruling, 2026-11-27 (S15.2, #401, epic E15). This is the shared spec for
the stories that store, show and filter by category attributes (#402, #403 and
#404). It is the specification S15.2 was approved against. Where a later story
file disagrees with it, this file wins until the owner amends it. The scope
line is in `docs/product/mvp.md`, *Category attributes*.

Nothing here is built yet. Stored key names, the feed column or entry path, the
URL parameter names and the filter's screen and copy are not decided here: the
later stories' design passes decide them (#402 storage and feed format, #403
the collector, #404 filters).

## What the visitor gets

On an engine-oil category page, a visitor narrows the list by viscosity grade,
by container volume and by ACEA norm. On an engine-oil product page, the
visitor reads those three values and two more, oil type and manufacturer
approvals, so the filter's result can be checked against the page. The other
four categories keep the brand filter and sort and gain nothing.

## Terms

| Term | Meaning |
|---|---|
| **Attribute** | A named, typed fact about a product in one category, such as its viscosity grade. Fixed in code per category. |
| **Filter attribute** | An attribute that is also a category-page filter. |
| **Display attribute** | An attribute shown on the product page that is not a filter. |
| **Written form** | The one way a parsed value is stored and shown. |
| **Unparsed** | A raw feed value the rule for its attribute cannot read. The attribute is then absent for that product. |

## Rules that hold for every attribute

1. **The list is code.** Each category's attributes, with every closed set and
   unit, are fixed in code like the category tree (S4.0, decision 0015) and the
   vehicle list (decision 0016). Changing one is a code change and a story,
   never an admin edit. The admin has no screen for it.
2. **Feeds only.** Attributes come from feed entries. A title or a description
   is never mined, and nothing is read from a shop page (guardrail 2).
3. **Exact reading.** A rule reads what it can read and never guesses,
   completes or converts a value it does not recognise.
4. **Unparsed means absent.** The raw text is neither stored nor shown. The
   product stays in its category and in search, and is left out of an active
   filter on that attribute (see *Under an active filter*).
5. **First value stays.** When two feeds give a matched product different
   values, the first stays, as product text does (`mvp.md`, *Product and
   offers*). An absent attribute may be filled once by a later row that parses;
   a value once set is never changed or cleared.
6. **Collected values stay behind the wall.** A value from a collected feed
   lives only on collected products, which never merge with other products. It
   follows decision 0017 with no new rule.
7. **Options come from what is listed.** A filter's options and their counts
   are computed from the products the category page lists, after approval,
   hide, removal and the car filter. A value held only by an unapproved or
   hidden product appears nowhere, not even as an option.
8. **No filter selected, no change.** The page is exactly today's page. An
   attribute with fewer than two distinct values on listed products draws no
   filter group.
9. **The URL carries the selection**, as `marca` and `orden` do, so the
   existing canonical rule drops it. The parameter names and the parser belong
   to #404.
10. **The import counts what did not parse**, per attribute, with no row text,
    as `unknown_vehicles` does for fitment. The line's shape belongs to #402.

## Attributes by category

Role `filter` is a category-page filter. Role `display` is stored and shown on
the product page only. Attribute names are the Spanish labels of the owner's
local report (see *About the report counts*).

### aceite-de-motor

Five attributes. Viscosity grade, volume and ACEA norm are filters and are
also shown on the product page (owner ruling, 2026-11-27). Oil type and
manufacturer approvals are display only. So the product page shows five
attributes, three of them filters.

| Attribute (report label) | Role | Value shape | Unit or closed set |
|---|---|---|---|
| Viscosity grade (Viscosidad SAE) | filter, shown | one value | closed set of SAE multigrades |
| Volume (Volumen) | filter, shown | one value | litres, resolution one millilitre, 0,1 l to 220 l |
| ACEA norm (Norma ACEA) | filter, shown | one or more values | closed set of ACEA light-duty sequences |
| Oil type (Tipo de aceite) | display | one value | closed set: synthetic, semi-synthetic, mineral |
| Manufacturer approvals (Homologaciones del fabricante) | display | list of text items | none, free text |

Report attributes for this category that are not in the list and not stored:
Gama, Marca, Tipo de envase, FAP, Motorización and Norma API. Marca is the
product's existing brand field, already filtered by the brand chips. The other
five were not in the owner's pick; adding one is a code change to the list.

### filtros-de-aceite, filtros-de-aire, filtros-de-combustible, filtros-de-habitaculo

None of the four stores an attribute or has an attribute filter. The brand
chips and sort remain their only filters. What each would need is in
*Categories without filters*.

## Normalisation rules

Every example below is illustrative: a form made up for the rule, not a value
from any feed or from the report.

### Viscosity grade

- **Written form:** `<winter>W-<hot>`, upper-case W, one hyphen, no spaces, no
  SAE prefix. Illustrative: `10W-40`.
- **Closed set:** winter grade 0W, 5W, 10W, 15W, 20W or 25W, joined to hot
  grade 8, 12, 16, 20, 30, 40, 50 or 60. The filter lists only the grades
  present on listed products.
- **Accepted raw forms:** case-insensitive and trimmed; an optional leading
  SAE; the two halves joined by a hyphen, an en dash, a slash, a space or
  nothing. Illustrative: `10w40`, `SAE 15W 40`, `0W/20`.
- **Does not parse:** a winter half alone, a hot half alone, a pair outside the
  closed set, two grades in one cell, any other text, blank. A single-grade
  (monograde) oil therefore reads as unparsed; monograde grades can be added
  later as a closed-set change.
- **Why strict:** completing a half grade would be a guess.

### Volume

- **Written form:** litres in the es-ES way, a decimal comma, trailing zeros
  dropped, a space and a lower-case `l`. Illustrative: `4 l`, `1,5 l`,
  `0,5 l`. Exact to one millilitre, held as an exact quantity and never a
  binary float.
- **Accepted raw forms:** a number with an optional unit. Units read: `l`, `L`,
  `lt`, `lts`, `litro`, `litros`, `ml` and `cl`, in any case, with or without
  a space before the unit. `ml` and `cl` are converted to litres:
  illustratively, `500 ml` is `0,5 l`.
- **A bare number is litres.** The unit sits in the label on some shops and in
  the value on others, so the unit of the feed column is fixed by the contract
  (#402) and an explicit unit is also accepted.
- **Separators:** a dot or a comma followed by one to three digits is the
  decimal separator. Thousands separators are not accepted, because no volume
  in range needs one: illustratively, `2.000` and `2,000` both read as `2 l`. A
  value with both separators does not parse.
- **Range:** 0,1 l to 220 l. A value outside it does not parse. This also
  resolves a dot followed by exactly three digits, which could otherwise be
  read as thousands.
- **Does not parse:** a unit not in the list (a mass unit, a gallon, a ratio),
  a pack form such as a count times a size, a range or two values, any other
  text, blank.
- **Filter:** exact match on the written value, never a range; options in
  ascending order.

### ACEA norm

- **Written form:** the sequence as ACEA writes it, upper-case, one token per
  sequence. A product holds one or more tokens. Illustrative display:
  `A3/B4, C2`.
- **Closed set (light-duty sequences):** A1/B1, A3/B3, A3/B4, A5/B5, A7/B7, C1,
  C2, C3, C4, C5, C6. **This set is to confirm against the published ACEA
  sequences** before #402 builds it. The A and B halves are one token and are
  never split. The heavy-duty E sequences are not in the set.
- **Accepted raw forms:** an optional leading ACEA; one or more sequences
  separated by a comma, a semicolon, a plus, the word y, or a slash between two
  C sequences; any case; a year suffix after a sequence is ignored.
  Illustrative: `ACEA C5`, `A3/B4 + C2`, `C3-21`.
- **Partial cells:** unrecognised tokens are dropped and the recognised ones are
  kept. This differs from viscosity and volume only because ACEA is a set, and
  the product then states only what the rule could read.
- **Does not parse:** no token in the cell is recognised, or the cell is blank.
  The attribute is then absent.
- **Filter:** a product matches a chosen sequence when its set holds it; the
  options are the sequences present on listed products.

### Oil type (display only)

- **Written form:** one of synthetic, semi-synthetic or mineral, shown in
  Spanish on the product page, with copy from the message files.
- **Accepted raw forms:** read after folding case and accents. A value naming
  synthetic is synthetic, one naming semi-synthetic (with or without the hyphen
  or a space) is semi-synthetic, one naming mineral is mineral. Semi-synthetic
  is tested before synthetic. A leading `100%` or the word base is ignored.
- **Does not parse:** a value that names more than one family, names none, or is
  blank. The line is then absent, as every null detail on the product page is.

### Manufacturer approvals (display only)

- **Stored and shown form:** a list of short text items, as the feed wrote them,
  in order, as plain text and never as markup.
- **No canonical form:** the maker's prefix and the code are written differently
  from shop to shop, so no safe normalisation exists and no filter is proposed.
- **Cleaning only:** split on a comma or semicolon (a slash or a space stays
  inside an item, because codes use both), trim, collapse inner whitespace, drop
  blank items and case-insensitive duplicates, keep at most 20 items of at most
  60 characters each; an item longer than that is dropped.
- **Does not parse:** nothing fails beyond blank. A blank cell is absent and the
  line is not shown.

## Under an active filter

- A product with an absent or unparsed value is left out. It is not shown under
  a "not stated" group: a filter result is a claim, and a product that does not
  state the value could be any grade.
- The page says how many products the filter left out because they did not
  state the attribute. The wording and place belong to #404 and its ux pass.
- Removing the filter returns every product, so nothing becomes unreachable.

## Categories without filters

**The bar.** An attribute gets a filter in another category only when all of
these hold:

1. it is carried by at least half of that category's public products;
2. it is carried through at least two approved, non-collected feeds;
3. it has a written form (a unit or a closed set) and a rule for a value that
   does not parse, both written in this file first.

This is a rule, not a recommendation (owner ruling, 2026-11-27). Collected
data does not count towards the bar, because it may not reach a public site
(0017). For oil filters, the car in `?coche=` (decision 0016) is already the
main selector, so an attribute filter adds less there than it does for oil.

### filtros-de-aceite

The report found these attributes, none stored, none filtered:

| Attribute found | What a filter would need |
|---|---|
| Marca | Nothing new: it is the brand field and the brand chips. Brand aliases (S7.3) are deferred. |
| Rosca (thread) | A written form, a closed set built from real data, and a rule for inch-series threads. |
| Tipo de filtro | More data, to make a closed set. |
| Altura, Diámetro, Diámetro exterior de la junta, Diámetro interior de la junta | A millimetre rule, a decimal-comma rule, and a choice between exact values and ranges. |
| Presión de apertura de la válvula | A bar unit rule. |
| Dimensiones | Splitting into separate numeric attributes first, as one cell holds several dimensions and a weight. |
| Material | More data, to see the set of values. |

For every one the needs are the three of the bar, plus a feed entry path that
carries the attribute (#402).

### filtros-de-aire, filtros-de-combustible, filtros-de-habitaculo

The report read no page for any of the three, so no attribute was found and no
candidate list is proposed: one would be made up rather than found. Before a
filter can be added, the owner's local collector must be run for these
categories across several shops to produce a list, as it was for oil. After
that, the three needs of the bar apply, plus a feed entry path.

## About the report counts

The owner's local report (S15.1, #400) read 10 pages: 7 in the five categories
(5 engine oil, 2 oil filters and 0 for each of the other three) and 3 outside
them, from 5 shop folders. It
is collected data, kept local and not in this repository (decision 0017). Any
count taken from it is an anecdote about those pages. It is not a coverage
measure and says nothing about coverage in the feeds the site will import. This
file carries attribute names only, never a shop, product, price, URL or raw
value from it.

For the engine-oil attributes, the report counted pages carrying the attribute
in a structured field or a labelled list, out of 5: viscosity grade 4, volume 4,
ACEA norm 3, oil type 2, manufacturer approvals 2. For the oil-filter
attributes, out of 2: Marca 2, Rosca 2, and each of the others 1.

Whether any affiliate or hand-written feed carries these attributes is not
known. Public filter values can come only from approved affiliate or
hand-written feeds, never from collected data (guardrail 2).

## Out of scope

- Attribute filters for the four other categories (see the bar above).
- Price and shop filters (S5.3), which stay deferred (owner ruling,
  2026-11-27).
- Reading attributes from titles or descriptions.
- The six engine-oil report attributes not in the list.
- Filtering by manufacturer approval.
- An admin editor for the list.
- Stored key names, the feed column or entry path, URL parameter names and the
  filter's screen and copy: #402, #403 and #404.

The search fold of viscosity forms (migration 0005) is a search aid over titles,
not a stored attribute, and is unchanged. `docs/product/vehicle-fitment.md`
puts oil selection by viscosity or ACEA out of scope for fitment; these filters
are a separate mechanism, so both statements stay true.
