# 0009 — Click log and analytics without personal data

Status: accepted, 2026-10-16

## Decision

- Every outgoing link goes through `/go/<offer>`, which writes one click row
  and redirects (HTTP 302) to the offer's affiliate URL.
- A click row holds **offer, shop, product, timestamp and source page** only.
  It holds **no IP address, no user agent and no cookie**. Los Tres sets no
  cookie on public visitors.
- Traffic analytics use self-hosted **Umami** in Compose, which works without
  cookies.
- **No ads in the MVP.**

## Why

- Clicks are needed to measure commission now and to bill shops per click
  later.
- Without cookies or personal data on public visitors, the site needs no
  cookie-consent banner (RGPD and LSSI). That keeps the MVP simple and makes
  the personal-data guardrail easy to keep.

## Considered

**Ads (for example AdSense).** Postponed: they set cookies and would need a
consent-management tool.

## Consequences

- Click fraud cannot be filtered by IP. That is acceptable while revenue is
  affiliate commission, because networks pay on sales. Per-click billing will
  need its own fraud decision first.
- The admin login uses a session cookie for admins only. It is strictly
  necessary, so it needs no consent.
- The source page is a same-origin site path taken in memory from the Referer
  header; a query, a fragment or a foreign origin is never stored. Prefetch and
  HEAD requests, known crawlers (the user agent is read in memory against a
  short list and never stored or logged) and demo offers are redirected but not
  counted.
