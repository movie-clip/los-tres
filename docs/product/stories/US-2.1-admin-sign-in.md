# S2.1 Admin signs in with email and password

Status: approved (D-14; board status Ready still follows the human's own move)
Epic: E2 Admin access (#10) · Slice: 11 of 39 · Priority: P0 · Size: L
Issue: #22 · Tickets: #68-#74 (T2.1.1-T2.1.7)
Depends on: none
Source: delivery brief and rulings of run 2026-10-22-admin-sign-in (decisions D-1 and D-4 to D-14); `docs/product/mvp.md` § Admin area; issue #22.

## Standing constraints

These bind this story and everything built from it.

- **Local-only until S2.2 (D-4).** S2.1 ships a password-only login. It has no authenticator-app code (TOTP) and no failed-attempt lockout, so guessing is unlimited. No admin route from this story is deployed to the VPS, or reachable from the internet, before S2.2 (#23) is done. Every lane treats S2.1 as a development-and-test build.
- **Recovery is re-running the command (D-5).** There is no password reset by email, no "forgot password" page and no outgoing mail. An admin who lost their password gets a new one when someone with shell access to the deployment runs the create-admin command again for that email.
- **The admin interface is in Spanish (D-8).** All admin copy is es-ES, in its own admin section of the message files, kept apart from the public copy. D-2 (English) is superseded.
- **Dependencies need a decision record (D-6).** An auth framework or library may be added if the design needs it, and each new dependency gets a decision record in `docs/decisions/`.
- **The tech lead picks the auth framework, and the pick is independently checked (D-7).** D-1 rules that an off-the-shelf auth framework is to be used. This story names none. The design pass proposes the pick against the five guardrails, and a second, independent check of that pick passes before the build go.

## Open decisions

D-1 and D-4 to D-8 are ruled by the human and are not reopened here. Items 1 to 4 and 6 below were settled by the human in D-9 to D-13 and are recorded as settled. Item 5 is still open and is for the design pass.

1. **Session lifetime: settled (D-9).** A session ends 8 hours after sign-in, with no idle timeout, no extension on activity and no "remember me". After that the admin signs in again. Affects AC 14.
2. **What an anonymous request to an admin URL sees: settled (D-10).** A page request is sent to the sign-in page; an action or data request is refused with a non-success answer and has no effect; in both cases nothing from the admin area is revealed and no cookie is set. Affects ACs 17 and 18.
3. **Password rules the command enforces: settled (D-11).** A minimum length of 6 characters, no composition rule. Affects AC 5.
4. **Ending sessions on re-run: settled (D-12).** Re-running the command for an existing admin ends that admin's open sessions. Affects AC 4.
5. **Which auth framework (D-7).** Open until the design pass proposes it and the independent check clears it. It is not a question for this story file.
6. **A cookie before sign-in is not allowed: settled (D-13).** The public privacy text promises that only admins receive the session cookie, so AC 12 stands even though it narrows the framework choice. A framework that sets a cookie on the sign-in page or on a failed attempt (for example for request-forgery protection) would break that. The design pass must find a way that keeps AC 12 true. If it cannot, that is an escalation to the human, not a quiet exception.

## Story

As one of the three team members, I sign in at the admin area with my email and password, reach an admin shell and sign out again, and I know that no one who is not signed in can reach any admin page or action.

## Scope

In:

- Admin accounts created only by a command; no sign-up of any kind.
- Sign-in and sign-out in Spanish.
- A session carried in a cookie that only admins ever receive, ending at sign-out or at its lifetime.
- A server-side check on every admin route and action that refuses an anonymous request.
- An admin shell with navigation, in Spanish, as the place later admin stories add their screens.
- Passwords stored hashed; email, password and token kept out of logs.
- Admin pages not indexed.
- The guardrail 3 test suite promised in decision 0006, and a guardrail 5 check on the new cookie and the new logging.
- The decision record for the auth approach, and the command documented.

Out (later stories or not in the MVP):

- Authenticator-app code (TOTP), its secret storage and enrolment, and failed-attempt lockout: S2.2 (#23).
- Any admin feature beyond the shell: S2.3, S2.4, the S3.x stories and S9.4.
- Password reset by email, public accounts, "remember me", account disabling or deleting, and any screen for managing admins. Public accounts are excluded by `mvp.md` § Out of MVP.
- Any deployment of the admin area (see Standing constraints).
- Whether the admin shell keeps the public site header and footer: a ux-lane call, with the requirement in AC 27 only.

## Acceptance criteria

Accounts and the command

1. No page, link, route or action on the public site or in the admin area lets anyone create an account, request an invitation or reset a password. A request to a path that looks like a sign-up or reset path gets the ordinary 404 page.
2. Running the create-admin command with an email address and a password creates an admin account, and that email and password then sign in successfully (AC 9). The command runs through the documented npm form and through `docker compose run --rm app create-admin`, and exits 0 on success.
3. The command never takes the password as a command-line argument, so the password is not left in shell history or a process listing. It does not print, echo or log the password or the email, on success or failure (guardrail 5).
4. Running the command again for an email that already has an account sets the new password on that account, creates no second account, and ends every open session of that account. The old password no longer signs in. This is the recovery path (D-5; D-12).
5. The command refuses, with a non-zero exit, a usage line and no account created or changed, in each of these cases: no email, no password, an email that is not a valid address, a password shorter than 6 characters (D-11; a password of 6 characters is accepted, and there is no composition rule). The refusal text does not contain the password or the email.
6. Passwords are stored only as a salted hash made by an algorithm designed for passwords. Inspecting the stored account shows no plaintext or reversibly encoded password, and two accounts given the same password have different stored values.
7. Email addresses that differ only in letter case are the same account: the command does not create two, and sign-in accepts the address in any letter case.

Sign-in and sign-out

8. An admin-area sign-in page exists with an email field, a password field and a submit control, all labelled in es-ES. The password field does not display what is typed.
9. Submitting a correct email and password starts a session and lands the admin in the admin shell (AC 25).
10. Submitting a wrong password for an existing email, and submitting an email that has no account, show the same Spanish error message and the same kind of response, so the visitor cannot tell which was wrong. Neither starts a session.
11. Submitting with the email or the password empty shows a Spanish message for the empty field and starts no session. No answer to any of these cases is a server error.
12. The only cookie this story ever sets is the session cookie, and it is set only by a successful sign-in. The sign-in page itself, a failed sign-in, a refused anonymous admin request, the public pages and the `/go/<offer>` redirect all set no cookie (guardrail 5; decision 0009; the privacy text; D-13).
13. The session cookie is HttpOnly, is not sent on cross-site requests, is marked Secure whenever the site is served over HTTPS, and holds nothing readable: no email, role or password, only an opaque value that means nothing without the server's record.
14. A session stops being accepted 8 hours after sign-in, an absolute limit with no idle timeout (D-9): a request made after that is treated as anonymous (ACs 17 and 18), and the admin has to sign in again. There is no way to extend a session or to ask for a longer one.
15. A signed-in admin can sign out from the admin shell. Signing out ends the session on the server and clears the cookie in the browser, and the admin lands on the sign-in page. Replaying the old cookie value afterwards is treated as anonymous.
16. Signing in or out submitted from another origin is refused, so another website cannot sign an admin in or out.

The server-side guard (guardrail 3)

17. A request for any admin page without a valid session shows nothing from the admin area, and ends at the sign-in page (D-10). This holds for the shell and for every admin page added later.
18. A request to any admin action or data endpoint without a valid session is refused and has no effect, including when it is made directly with a crafted request and not from the admin UI (D-10). Hiding a control in the UI is not the protection.
19. A cookie that is forged, malformed, expired, from a session that was signed out, or from a session ended by AC 4 is treated exactly as no cookie at all.
20. The session is checked on the server on every admin request. Signing out in one browser makes the same session unusable in another browser holding the same cookie value.
21. The check fails closed: if the session store cannot be reached, an admin request is refused and never let through.
22. A test enumerates every route and action under the admin area, as classified by `tests/support/routes.ts`, and fails if any of them answers an anonymous request with admin content or a success. A new admin route that forgets the check therefore fails the suite without anyone adding a test for it.

The admin shell

23. The sign-in page and every admin page carry a signal telling search engines not to index them, and no sitemap lists an admin URL.
24. Admin responses, including the sign-in page, are marked not to be stored by caches or kept for the browser's back button, so a signed-out browser does not redisplay an admin page from cache.
25. After sign-in the admin sees a shell with a heading, navigation and a sign-out control. The navigation has no link that leads to a page that does not exist yet (no dead links to later stories); at the end of this story its destinations are the shell's own home and sign-out.
26. No public page links to the sign-in page or the admin area (visitors never log in), and the public pages are otherwise unchanged by this story.
27. All visible text of the sign-in page and the shell comes from es-ES message files, in an admin section separate from the public sections, with no inline user-facing strings (D-8). The page language is declared as Spanish.

Logs and secrets

28. No sign-in success, sign-in failure, sign-out, guard refusal or command run writes an email, a password, a session value or a cookie to any log or console output. A test plants recognisable sentinel values and finds none of them in the captured output.
29. On a fresh clone, `npm run env:init`, `npm run stack:up` and one run of the create-admin command are enough to sign in locally. Any new secret setting is generated by `env:init` and listed in `.env.example`, and no real value is committed.

Docs

30. `docs/decisions/` has a decision record for the authentication approach that names the framework or library chosen, the session lifetime, and that TOTP is added in S2.2, so S2.2 inherits it. Each new dependency has its own record or is named in it (D-6).
31. `CLAUDE.md` § Commands lists the create-admin verb with its npm and Compose forms and no longer says that every verb besides migrate, seed and import-feeds exits 64. It states that S2.1's login is local-only until S2.2.

## Test plan

Test files and names are the test lane's to choose after the tech lead's design. Coverage required:

- **Guard (integration, database; the first thing to settle, ticket #73 with #71):** anonymous, forged, malformed, expired, signed-out and re-run-ended cookies all refused on a page and on an action; a valid session accepted; the enumerate-every-admin-route check of AC 22, including a deliberately unguarded fixture route that must make it fail; the session store unreachable gives a refusal.
- **Command (integration):** creates an account that signs in; second run replaces the password, creates no duplicate and ends sessions; case-insensitive email; every refusal case of AC 5 creates nothing (a 5-character password is refused, a 6-character one accepted); output holds neither the password nor the email; no password-as-argument path exists.
- **Storage (integration):** the stored password is neither the plaintext nor equal for two accounts with the same password.
- **Sign-in and sign-out (integration or component):** the same message and response for wrong password and unknown email; empty fields; a cross-origin submission refused; session ended on the server at sign-out and at 8 hours after sign-in with no idle timeout (D-9), with time controlled by the test.
- **Cookie and caching (e2e and integration):** one HttpOnly, non-cross-site cookie only after a successful sign-in; none on the sign-in page, a failed attempt, a refused anonymous request, the public pages and `/go`. The existing public-page "no cookie" assertions stay scoped to public routes and keep passing.
- **Shell (e2e, Playwright, against the Compose stack):** create an admin through the command, sign in, see the Spanish shell and navigation without dead links, sign out, and be unable to open the shell again with the old cookie. An anonymous visit to the shell ends at sign-in. Check noindex and no-store headers on admin pages.
- **Logs (integration):** sentinel email, password and session value never appear in captured output for success, failure, sign-out, refusal and the command.
- **Copy (unit):** admin messages sit in their own section, and the admin pages use no inline strings.

## Tickets

Ordered, contracts before consumers. Each traces to the ACs. The tech lead's design may merge, split or rename them. No ticket instructs anyone to commit or to run a gate on its own work; the human runs the suite and commits, and the orchestrator dispatches the gates. The guard (#71) and the guardrail 3 suite (#73) are the first things for the design to settle, before the sign-in screen.

1. **T2.1.1 (#68) backend. Storage for admin accounts and sessions.** ACs 6, 7, 13.
2. **T2.1.2 (#69) backend. Password hashing and verification.** ACs 6, 10.
3. **T2.1.3 (#70) backend. The create-admin command.** ACs 1, 2, 3, 4, 5, 7, 28, 29.
4. **T2.1.4 (#71) backend. Session lifecycle and the server-side guard.** ACs 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 28.
5. **T2.1.5 (#72) frontend. Sign-in page and admin shell in Spanish.** ACs 8, 9, 10, 11, 23, 24, 25, 26, 27.
6. **T2.1.6 (#73) test. The guardrail 3 and guardrail 5 suites, and the sign-in e2e.** Every AC; coverage per the test plan.
7. **T2.1.7 (#74) docs. Decision record for the auth approach, and the command documented.** ACs 30, 31.

The ticket titles above follow the delivery brief's ordering of #68 to #74; the issue text on GitHub was not available to this draft and wins if it differs.

## Docs to reconcile at close-out

The docs lane reconciles from the actual diff: the `docs/decisions/` record and any dependency records (D-6); `CLAUDE.md` § Commands (the create-admin verb, the entrypoint's unknown-verb sentence, the local-only note); `.env.example` and the first-run steps if a new setting appears; the Privacy text (`adminsBody`) checked against what was built. This story file is not an index and is not edited by the docs lane except for its status.
