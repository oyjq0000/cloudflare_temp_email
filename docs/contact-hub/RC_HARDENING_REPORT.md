# Final RC Hardening Report

## 1. Revision

- `origin/main`: `70206c61efa723ef24143eca1d27449ce98a6e0c`
- `origin/contact-hub`: `a4902cdd190ea1752de01370a9593562e0a45d58`
- merge-base: `70206c61efa723ef24143eca1d27449ce98a6e0c`
- working branch: `fix/contact-hub-rc-hardening`
- implementation HEAD before final documentation evidence: `28f18d2`
- final branch HEAD: pending final evidence update
- PR URL: pending
- CI URL: pending

## 2. Fixed Findings

1. Contact admin plaintext persistence: implemented scoped Contact Admin Session and browser cleanup; Docker browser evidence pending.
2. Trusted receive time: implemented server `received_at` + nullable sender `sender_date`; unit/backfill evidence passed; Docker ingress evidence pending.
3. Post-persist side effects: implemented `waitUntil`, six independent boundaries, durable status and dedupe/no-retry behavior; Docker fault-injection evidence pending.
4. Default Mailbox invariant: enforced server-side and in UI; corruption/concurrency E2E is defined and pending Docker execution.
5. Real RC CI: workflow added; GitHub run pending.
6. Health readiness: explicit code/admin/migration/storage/inbound/outbound/production readiness plus warnings and consistency counts implemented.
7. Provider UI: edit/re-enable/in-use disable protection and Secret redaction implemented; browser/API Docker evidence pending.
8. Global Inbox counts: independent endpoint implemented; filter/search/cursor isolation E2E pending Docker execution.
9. Resend/Brevo timeout: explicit bounded AbortController timeout implemented; unit timeout evidence passed.
10. Documentation drift: schema/provider path/security/deployment/state docs updated; this report will be finalized after Docker/CI evidence.

## 3. Authentication Design

Password login uses `POST /open_api/contact_admin_login`. The server reuses admin password and global Turnstile validation and, when site access passwords are configured, requires the existing site-access header. Success signs HS256 with `JWT_SECRET`, `scope=contact:admin`, `iat`, and `exp`. `CONTACT_ADMIN_SESSION_TTL_SECONDS` defaults to 14400 seconds and accepts 900–28800.

The frontend stores `contactAdminToken` in `sessionStorage`, never localStorage, clears the password input on success, and removes historic `adminAuth` localStorage on Contact Mode entry. `/admin/contact/*` sends the Bearer Contact token and not `x-admin-auth`. Existing `ADMIN_USER_ROLE` access-token administration remains supported. Contact tokens cannot authorize ordinary Admin APIs.

## 4. Database Migrations

- Schema target: 7; migrations 1–5 were not edited.
- Migration 6: add `contact_messages.sender_date`; backfill `sender_date=old received_at`; set legacy trusted `received_at=COALESCE(created_at, received_at)`.
- Migration 7: add `contact_message_side_effects` with six effects, status/attempt/error/timestamp fields, unique message/effect constraint, and indexes.
- Unit SQLite evidence passes for a v5 Contact row: sender-declared future date is preserved in `sender_date`, trusted receive time becomes legacy `created_at`, raw mail/message content remains present, and the side-effect table exists.
- Migration-runner failure injection passes: a failed migration 6 is not recorded as applied after versions 1–5.
- Repeated migration Docker evidence: pending.

## 5. Inbound Reliability

The Worker captures `receivedAt = new Date().toISOString()` before MIME parsing. Parsed MIME Date becomes `senderDate` only. D1 persistence remains the receive-success boundary; R2 write status is separately observable and repairable. After persistence, six effects are scheduled under `ctx.waitUntil` and update independent durable states. Spam/parse-failed effects are skipped and deduplicated redelivery returns before effect execution.

## 6. Mailbox Invariants

A Domain default Mailbox must be same-Domain, enabled, outbound-enabled, referenced by `contact_domains.default_mailbox_id`, and unique by `is_default`. Create/update reject unusable defaults. Current defaults cannot be disabled or have outbound disabled. Switching clears the old default, sets the new default, and updates the Domain pointer in one D1 batch. Health exposes invalid/multiple/dangling counts.

## 7. Provider and Outbound Safety

Resend/Brevo timeout defaults to 15000 ms (`CONTACT_PROVIDER_HTTP_TIMEOUT_MS`, 1000–60000). Timeout maps to `certainty=unknown`, `retryable=false`, `errorClass=network_timeout`, `errorCode=PROVIDER_TIMEOUT`. Unit tests prove one hanging HTTP call becomes Unknown without a second call. Explicit Failed may be manually retried; Unknown normal Retry remains forbidden; Force Resend creates a new intent. Automatic Provider fallback remains disabled.

## 8. Test Evidence

- Worker clean install/test/lint/build: passed; 54/54 unit tests.
- Frontend clean install/test/build: passed; 69/69 unit tests; production build passed with existing chunk-size warning.
- `docker compose config --quiet`: passed on the Mac execution clone.
- Playwright discovery: passed; 206 tests in 53 files.
- Contact API: pending real Docker execution.
- Contact Browser: pending real Docker execution.
- Temp Mode: pending real Docker execution.
- Full Docker Compose: pending real Docker execution.
- CI: pending GitHub Actions run.

## 9. Security Checks

Scoped token, expiry/scope/cross-API/bypass tests exist; browser storage/header assertions exist; HTML sanitization/remote-image/attachment protections remain in the full suite; Provider/API Secret References are redacted; HTTP error logging avoids auth/API-key values; Contact post-persist logging is class/code only; outbound header CRLF tests remain. Final Docker evidence is pending.

## 10. Files and Commits

Implementation commits before final documentation:

- `75067bc` `fix(contact-auth): replace stored admin password with scoped session`
- `7e11609` `fix(contact-inbound): trust server receive time and isolate side effects`
- `1038c9d` `fix(contact-mailbox): enforce default mailbox invariants`
- `890922c` `fix(contact-ops): harden readiness counts providers and timeouts`
- `60edf69` `test(contact-hub): add adversarial rc regression coverage`
- `28f18d2` `ci(contact-hub): add full rc regression workflow`

Primary files are under `worker/src/contact/`, `frontend/src/components/contact/`, `frontend/src/views/contact/`, `e2e/tests/`, `.github/workflows/contact-hub-rc.yml`, and the Contact documentation set.

## 11. Remaining Limitations

At this report revision, full Docker Compose and GitHub Actions have not yet run, so RC completion cannot yet be declared. No P1/P2 implementation blocker is currently known from unit/build/static E2E evidence; integration results remain the gate.

## 12. Production Actions

- Not deployed.
- Production D1/R2 not modified.
- DNS/Email Routing not modified.
- No real Provider configured or called.
- PR not merged.
- No tag or release created.
