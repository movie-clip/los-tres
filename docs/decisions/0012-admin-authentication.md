# 0012 — Admin authentication: Better Auth as a library

Status: accepted, 2026-10-22. Built in S2.1 (admin sign-in).

## Decision

The owner's calls: use an off-the-shelf auth framework rather than a
purpose-built module; the tech lead picks it and the pick is independently
checked before the build; any needed library or framework may be added, each
with its own decision record. This is that record for the one new runtime
dependency.

- **Package:** `better-auth` 1.7.12, pinned exact in `package.json`. Its
  transitive packages (including `zod`, `kysely`, `jose`, `@noble/hashes` and the
  `@better-auth/*` adapter and telemetry packages) arrive with it and are
  accepted. `@better-auth/cli` is not added: the schema is written by hand in
  `src/db/schema/auth.ts`.
- **Used as a library only.** Server actions call `auth.api.*`. No HTTP handler
  is mounted (no `toNextJsHandler`, no `/api/auth/[...all]` route), so no
  sign-up, reset or other framework endpoint is reachable. The `nextCookies`
  plugin is not installed: it would write the `Set-Cookie` headers of every call,
  including session reads. `src/server/auth/actions.ts` forwards the cookies
  itself and is the only code that writes one.
- **Sessions are stored on the server**, in `admin_sessions`, and revoked by
  deleting rows. The absolute lifetime is 8 hours with no idle timeout and no
  refresh (`session.expiresIn` 28800 with `disableSessionRefresh`). The value is
  `SESSION_LIFETIME_HOURS` in `src/server/auth/config.ts`.
- **Passwords:** email and password, scrypt hash from `better-auth/crypto`,
  minimum 6 characters, no composition rule, maximum 128. No sign-up: admins are
  created by the `create-admin` command only. Recovery is re-running that
  command, which replaces the hash and deletes all of that admin's sessions.
- **Tables:** `admin_users`, `admin_accounts`, `admin_sessions`,
  `admin_verifications` (migration `0003_admin_auth`). They follow the framework's
  core schema, so they use text ids and cascade foreign keys, unlike the repo's
  identity ids and restrict keys. `admin_users.name` is always the constant
  `admin`.
- **The guard** (`src/server/auth/guard.ts`) is the only reader of the session
  cookie. Every admin page and every admin server action checks the role on the
  server first. A store failure fails closed (the Unavailable screen), never open.
  There is no middleware.

## No cookie before sign-in (guardrail 5)

The only cookie the app ever sets is `admin.session_token`
(`__Secure-admin.session_token` when `SITE_URL` is https): HttpOnly,
SameSite=Strict, Path=/, Max-Age 28800, value a signed opaque token. Nothing
sets a cookie before a successful sign-in.

- Better Auth sets no CSRF cookie. A wrong password and an unknown email give the
  same error and set nothing.
- On an expired or signed-out cookie, `getSession` emits `Max-Age=0` deletions.
  The guard asks for the headers and drops them, so no admin response carries a
  `Set-Cookie` header unless sign-in succeeded.
- Sign-out forwards the three framework deletions (`session_token`,
  `session_data`, `dont_remember`), which are deletions, not new cookies.

## CSRF

Better Auth's own origin check does not run on `auth.api` calls made without a
request, and Next.js lets a server action through when the request has no
`Origin` header. So `signInAction` and `signOutAction` refuse a missing or
mismatched `Origin` themselves (`src/server/auth/origin.ts`), and the cookie is
SameSite=Strict. `trustedOrigins` and the base URL are `SITE_URL`.

## Personal data (guardrail 5)

- `admin_sessions.ip_address` and `user_agent` are always null: a
  `databaseHooks` entry nulls them and a check constraint refuses anything else.
  Without that, the framework stores the request user agent and an empty-string
  IP.
- Logger and telemetry are switched off, so nothing, the email included, is
  logged by the framework. Rate limiting is off: it would need an IP-keyed store.
  Lockout belongs to S2.2.

## Considered

- **Auth.js (next-auth 5.0.0-beta).** Rejected. It is still beta. Its
  double-submit `authjs.csrf-token` cookie is set on the sign-in page, which
  breaks "no cookie before sign-in". Credentials login requires JWT sessions, so
  there are no server-stored sessions and a user's sessions cannot be ended.
- **Lucia 3.** Rejected: deprecated on npm.
- **A purpose-built module.** Not chosen: the owner preferred a framework, and the
  framework has an official TOTP plugin for S2.2.

## Consequences

- **The raw session token is stored in `admin_sessions.token`.** Whoever can read
  the database can use live sessions. For a local-only S2.1 that needs database
  access, which already gives everything; hashing the token is a later hardening.
- **S2.1 is password-only and local only. The admin area must not be deployed
  before S2.2** adds a second factor.
- **TOTP is chosen at S2.2**, not here; the framework's `twoFactor` plugin is the
  expected path. It sets a pending-second-factor cookie between password and code,
  which S2.2's design must check against "no cookie before sign-in".
- `better-auth` is ESM-only and the CLI is compiled CommonJS, so `create-admin`
  loads `better-auth/crypto` with a dynamic `import()`; Node 22 loads it. The CLI
  does not import the framework instance, only the hash function and Drizzle.
- `SITE_URL` must be exactly the origin the browser uses. Opening the app as
  `localhost` when `SITE_URL` says `127.0.0.1` makes sign-in answer Unavailable.
- Two new settings, `AUTH_SECRET` (at least 32 characters) and `SITE_URL`.
  Missing either makes the admin pages show Unavailable; public pages are
  unaffected.
- SameSite=Strict means a link to `/admin` from another site arrives anonymous
  and lands on sign-in. Accepted for a handful of admins.
