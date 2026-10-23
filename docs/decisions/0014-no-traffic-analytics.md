# 0014 — No traffic analytics for now

Status: accepted, 2026-10-23. Supersedes the analytics line of 0009.

## Decision

- Drop the self-hosted **Umami** service from Compose, with its database,
  secrets, port and tests.
- The site has no traffic analytics. The `/go/<offer>` click log (0009) stays
  and is the only usage record.
- The privacy policy no longer mentions visit statistics.

## Why

- The site never loaded Umami's tracking script, so Umami collected nothing.
- One less service to run, secure and update before there is traffic to
  measure.

## Consequences

- No page-view numbers until analytics are chosen again in a new decision.
  Any choice must stay cookieless, or the site needs a consent banner.
- An existing local database keeps an empty `umami` database; it is harmless
  and can be dropped by hand.
