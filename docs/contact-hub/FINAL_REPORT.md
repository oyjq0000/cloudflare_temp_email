# Private Multi-domain Contact Mail Hub V1 — Release Candidate Report

## Status and revision

- RC hardening baseline: `origin/contact-hub` `a4902cdd190ea1752de01370a9593562e0a45d58`.
- Upstream baseline / merge-base: `origin/main` `70206c61efa723ef24143eca1d27449ce98a6e0c`.
- Working branch: `fix/contact-hub-rc-hardening`.
- Release marker: `v1-rc`; Contact schema target: 7.
- Production deployment, D1/R2/DNS mutation, real Provider configuration, merge, tag, and release are outside this RC task and have not been performed.

This report supersedes the pre-RC test counts and schema-5 statements that previously appeared in this file. The authoritative hardening evidence, including Docker and GitHub Actions status, is `RC_HARDENING_REPORT.md`.

## 1. RC architecture

`CONTACT_MAIL_MODE` still selects Contact vs Temp without deleting the upstream Temp path. Contact business code remains isolated under `worker/src/contact/`; Contact Provider adapters/registry live at `worker/src/contact/providers/`. Frontend Contact code remains under `frontend/src/views/contact/` and `frontend/src/components/contact/` with thin mode-aware integration.

Password-based Contact administration no longer stores the raw admin password in browser persistent storage. `POST /open_api/contact_admin_login` validates the existing admin login controls and returns a short-lived HS256 session JWT with `scope=contact:admin`, `iat`, and `exp`. `/admin/contact/*` accepts that scoped token or the existing verified `ADMIN_USER_ROLE` access token; it rejects legacy `x-admin-auth`, Address JWTs, wrong scopes, expired tokens, and production password bypass.

## 2. Inbound reliability

The Worker captures trusted `received_at` on ingress. MIME `Date` is stored separately as nullable `sender_date` for display only. Inbox ordering, tuple cursors, date filters, statistics, and future cleanup continue to use trusted `received_at`.

D1 persistence is the receive-success boundary. R2 status remains independently observable. After persistence, forward, AI extract, Telegram, webhook, another Worker, and auto reply run through `ExecutionContext.waitUntil` with one durable status row per effect. One effect failure cannot reverse receipt or block later effects. Spam and parse-failed messages mark those effects skipped; deduplicated redelivery does not rerun them.

## 3. Schema and invariants

Contact migrations remain independent of upstream `DB_VERSION` and are now versions 1–7. Migration 6 adds/backfills `sender_date` while moving legacy trusted `received_at` to `created_at`. Migration 7 adds `contact_message_side_effects`. Migration 1–5 contents are unchanged.

A default Mailbox must belong to its Domain, be enabled, have outbound enabled, agree with `contact_domains.default_mailbox_id`, and be the only `is_default=1` row for that Domain. Server-side create/update paths enforce the rule and switch defaults in one D1 batch; Health reports invalid, multiple, and dangling defaults.

## 4. Provider and outbound safety

Domain Provider selection remains explicit with no automatic fallback. Provider UI/API support create, edit, disable, and re-enable while never returning Secret Reference names or values. Resend/Brevo use explicit `AbortController` timeouts controlled by `CONTACT_PROVIDER_HTTP_TIMEOUT_MS` (default 15000 ms, valid 1000–60000). Timeout maps to Unknown / non-retryable `network_timeout` + `PROVIDER_TIMEOUT`; ordinary Unknown Retry remains forbidden and Force Resend still creates a new intent.

## 5. Operations and counts

Global Inbox counts are served by `GET /admin/contact/message-counts` and do not inherit Domain/Mailbox/search/date/cursor list filters. Filtered list counts are explicitly named `filteredCounts`.

Health exposes `codeReady`, `adminReady`, `migrationReady`, `storageReady`, `inboundReady`, `outboundReady`, and `productionReady`, retains warnings, reports R2 degraded fallback explicitly, and includes side-effect failure plus default-Mailbox consistency counts without exposing runtime Secrets.

## 6. Current executable evidence

From a clean dependency reinstall using the repository lockfiles:

- Worker: `pnpm install --frozen-lockfile`; 54/54 unit tests passed; `pnpm run lint` passed; `pnpm run build` passed as an explicit Wrangler dry-run using `worker/wrangler.ci.toml`.
- Frontend: `pnpm install --frozen-lockfile`; 69/69 unit tests passed; production build passed with only the pre-existing chunk-size advisory.
- E2E definition: `docker compose config --quiet` passes and Playwright discovers 206 tests in 53 files.
- Full Docker Compose execution on Windows: 206/206 Playwright tests passed after rebuilding the final code-validation HEAD; Compose exited 0 and was cleaned with volumes/orphans removed.
- GitHub Actions code-validation run: https://github.com/oyjq0000/cloudflare_temp_email/actions/runs/33642554309; Worker, Frontend, and Contact + Temp Docker E2E all passed, with Docker E2E reporting 206/206.

## 7. RC CI

`.github/workflows/contact-hub-rc.yml` runs on PRs to `contact-hub`/`main`, pushes to `contact-hub` and `fix/contact-hub-*`, and manual dispatch. It runs Worker test/lint/dry-run build, Frontend unit/build, strict Docker Compose Contact+Temp regression, and uploads Playwright artifacts. It does not use `continue-on-error`, both Worker and Frontend Docker dependency installs are strict `--frozen-lockfile` gates with no fallback install, and it does not read production Provider Secrets.

## 8. Security checks

The RC adds tests for scoped Contact sessions, expiry/wrong scope/Address-JWT rejection, Contact-token cross-API rejection, non-E2E password-bypass rejection, browser password-storage cleanup, trusted receive time, migration backfill/failure recording, per-effect fault injection, secret redaction, attachment/HTML/remote-image safety, CRLF defense, Provider timeout semantics, default-Mailbox corruption, Unknown Retry denial, and Legacy cleanup protection.

## 9. Rollback and production actions

Migrations 6–7 are additive. Roll back code before data: do not drop `sender_date`, `contact_message_side_effects`, Contact messages, raw mail, outbound attempts, or R2 objects. Temp Mode ignores the new Contact schema. Review `DEPLOYMENT.md` for backup, staging migration, readiness, smoke, and rollback steps.

No production deployment, production D1/R2 mutation, DNS change, real Provider call/configuration, branch merge, tag, or release has been performed by this RC hardening task.
