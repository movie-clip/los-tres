# 0013 — XML parser and feed formats

Status: accepted, 2026-10-23. Owner ruling in run 2026-10-23-xml-gzip-feeds
(issue #29). Supports decision 0007 (affiliate feeds only).

## Decision

`import-feeds` reads a feed as CSV or XML, plain or gzip, and streams it: no
step holds the whole feed in memory. The owner approved the parser and the
limits below. The rest of the format rules were put to the owner as assumptions
and not objected to.

- **Parser:** `sax` 1.6.1, pinned exact in `package.json`, in strict mode only.
  Licence BlueOak-1.0.0 (permissive). No runtime dependencies; types come from
  `@types/sax` 1.2.7, a dev dependency, also pinned exact. It is CommonJS, so it
  loads in the compiled CLI. Only `src/server/importer/xml.ts` imports it.
- **Why it is not a scraping library (guardrail 2, 0007).** `sax` is an XML
  tokenizer: it never fetches and parses no HTML. Loose (HTML-tolerant) mode is
  not used. It receives only bytes that came through `source.ts`, the one place
  that fetches or reads a feed. The lint ban on HTML-parsing and browser
  libraries is unchanged.
- **Candidates ruled out.** `saxes` 6.0.0 (streams, strict by construction, but
  last published 2022). `fast-xml-parser` 5.11.2 (parses a whole string, so it
  cannot meet the streaming need, and it is ESM-only).

## Format rules

- **Gzip is detected by magic bytes** `1f 8b` at the start of the byte stream,
  and nothing else: not `Content-Type`, not `Content-Encoding`, not the URL
  extension. Multi-member gzip is accepted. Bytes that start `1f 8b` but do not
  inflate fail as `invalid_gzip`. Zip is out of scope: zip bytes are not
  recognised and fail as `invalid_header`.
- **Format is sniffed from the decoded text.** After gzip and a UTF-8 BOM,
  ASCII whitespace is skipped; if the first character is `<` the feed is XML,
  otherwise CSV. The whitespace sniff gives up after 64 Ki characters and treats
  the feed as CSV. No `feeds` column records format or compression; no
  migration.
- **UTF-8 only,** as before. An XML declaration naming another encoding is not
  converted.
- **XML record rule.** The record element is the first element that has a
  direct child element whose local name (prefix stripped, lower-cased) is `id`.
  Every later element with the same qualified name at the same depth is a
  record. A record's cells are its direct leaf children's text (CDATA included,
  trimmed), keyed by lower-cased local name, so `g:price` is `price`. Only the
  canonical columns are kept: required `id`, `title`, `price`, `url`, then
  optional `brand`, `part_number`, `description`, `ean`, `currency`, `category`.
  The first of a duplicated child wins; unknown children and all attributes are
  ignored. No record element anywhere is `invalid_xml`. This rule is narrow on
  purpose: field mapping (S3.5) will replace the canonical-name assumption, and
  an Atom-style feed (a `feed` element with a direct `id` child) would pick
  `feed` as the record element.
- **A DOCTYPE is refused** (`invalid_xml`), so no DTD entities exist; only the
  five predefined and numeric references resolve. Malformed XML is `invalid_xml`.
- **Record numbers.** In CSV the header is record 1 and the first data row is
  record 2. In XML the n-th record element is record n+1, so the first row is
  record 2 in both. Rejected-row reports use these numbers.

## Limits

All overflows report `too_large`.

- **Wire:** 50 MiB of bytes read from the response (or the demo file). If the
  server itself applies `Content-Encoding: gzip`, the bytes counted are the
  already-inflated ones.
- **Inflated:** 512 MiB of gunzip output.
- **Per record, cell or text run:** 16 Mi characters for one CSV record, one XML
  cell, or one unbroken XML text run between tags (so a whitespace or zeros bomb
  cannot sit in memory under the 512 MiB cap).
- Reading stops and the streams are destroyed as soon as a cap trips. There is
  no row-count cap.

## Redirects

`fetch` runs with `redirect: 'manual'`. On 301, 302, 303, 307 or 308 the
`Location` is resolved against the current URL and followed only if it is
`https:` and has the same host (hostname and port) as the feed's own URL;
otherwise the import fails as `redirect_refused`. At most 5 redirects; a sixth
is `redirect_refused`. A missing `Location` is `fetch_failed`. The method stays
GET. No URL or `Location` value goes into an error or a log, since a feed URL
may hold an API key.

## Timeouts

Per feed read: 30 s from each request to its response headers, 60 s idle
between body chunks, 15 min from the first request to the last byte. Any of
them reports `fetch_failed`. The 15 minutes include time spent writing rows, so
a very slow database can also end a read.

## Failure codes

The report gains `invalid_xml`, `invalid_gzip`, `too_large` and
`redirect_refused`, printed as `failed <code>` like the existing ones. The wire
cap, which used to report `fetch_failed`, now reports `too_large`.

## Consequences

- A failure in the middle of a stream (bad gzip, bad XML, a cap) rolls back that
  feed's transaction: a partial import never lands. The transaction stays open
  while the body downloads, up to the 15-minute limit; acceptable for a manual
  command, to revisit with a staging table if feeds grow.
- The same-host redirect rule may refuse a real network that redirects to a CDN
  host. If the first real sample feeds show that, a per-feed allowed host is a
  later owner decision.
- Any future "remove offers missing from the latest import" step must not run
  for a feed that failed mid-stream.
- Demo feeds and the seed stay CSV. The demo file scheme accepts
  `.csv`, `.xml`, `.csv.gz` and `.xml.gz` names; the Compose path for XML is not
  covered by an end-to-end test.
- The per-timer limits (30 s, 60 s, 15 min) have no automated test.
