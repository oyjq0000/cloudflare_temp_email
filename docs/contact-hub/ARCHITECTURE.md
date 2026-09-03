# Private Multi-domain Contact Mail Hub V1 Architecture

## Scope

Contact Hub is a private administrative mail application layered onto the existing temporary-mail project. `CONTACT_MAIL_MODE=false` preserves the upstream product. `CONTACT_MAIL_MODE=true` selects the private Contact Hub, rejects public mailbox capabilities in the Worker, and exposes Contact features only below the existing authenticated `/admin/*` boundary.

The V1 boundary is deliberately narrow: fixed mailboxes, unified inbox/search, safe message display, replies, explicit per-domain outbound providers, auditable delivery state, and read-only DNS checks. It does not add a ticketing system, multi-user collaboration, AI workflows, outbound attachments, automatic provider fallback, or DNS mutation.

## Baseline and integration seams

The deployment-readiness baseline is `origin/contact-hub` `3ed8d828a8e157ef354a3c6e0d7019ec7a18b5d1` with `origin/main` `70206c61efa723ef24143eca1d27449ce98a6e0c`. The RC hardening history remains documented in `RC_HARDENING_REPORT.md`; product code remains on the Contact branch and `main` remains the upstream mirror.

Existing capabilities retained as compatibility seams:

- `worker/src/worker.ts`: Hono middleware and route mounting.
- `worker/src/email/index.ts`: Email Worker entry point.
- `worker/src/commom_api.ts`: public settings response (filename intentionally unchanged).
- `worker/src/mails_api/send_mail_api.ts`: legacy outbound selection and balance behavior.
- `worker/src/admin_api/index.ts`: authenticated Contact API mount.
- `frontend/src/router/index.js` and `frontend/src/App.vue`: thin mode-aware routing/layout mounts.
- `raw_mails`, `address`, and `sendbox`: legacy compatibility/fallback data.

New Contact business logic is isolated under `worker/src/contact/` (including Provider adapters in `worker/src/contact/providers/`), `frontend/src/views/contact/`, `frontend/src/components/contact/`, `frontend/src/api/contact.js`, and `frontend/src/store/contact.js`. Legacy provider compatibility code remains outside this Contact-owned directory only where upstream Temp Mode already owns it.

## Runtime topology

```text
Browser
  |
  v
Contact Hub Worker
  |- ASSETS -> Vue frontend
  |- HTTP APIs -> D1 / CONTACT_R2
  `- Email Worker entry <- Cloudflare Email Routing
                          |
                    resolveAppMode
                      /       \
                     v         v
              Temp pipeline  ContactInboundService
                                  |
                           parse MIME exactly once
                                  |
                           +------+------+
                           |             |
                           v             v
                           D1        CONTACT_R2
                     indexes/state   raw/attachments
                           |
                           v
                    ContactOutboundRouter
                       /       |       \
                   Resend    Brevo     SMTP
```

Contact Hub V1 deployment uses the Worker Static Assets binding rather than a Pages-to-Worker service binding. The upstream Pages implementation remains in the repository for compatibility, but it is not the Contact Hub staging topology. No Contact secret or private entity is returned by `/open_api/settings`; that endpoint exposes only mode and public capability booleans.

## Trust boundaries

1. Public requests are untrusted. In Contact Mode, public creation, registration, OAuth user entry, public mailbox access, and public sending are rejected in Worker middleware even if a stale frontend renders them.
2. Password-based Contact login is exchanged at `POST /open_api/contact_admin_login` for a short-lived HS256 JWT with `scope=contact:admin`, `iat`, and `exp`. `/admin/contact/*` accepts that Bearer token or the existing verified `ADMIN_USER_ROLE` access token; it rejects legacy `x-admin-auth`, Address JWTs, wrong scopes, expired tokens, and password-bypass configuration outside `E2E_TEST_MODE`. The browser keeps the Contact token in session storage only and removes historic `adminAuth` localStorage data.
3. D1 stores business state and secret references only. Secret values are resolved from Worker bindings at send time and are never serialized into API responses, snapshots, attempts, or logs.
4. Email HTML and attachments are hostile input. Sanitization is mandatory before every received or sent HTML render; remote content is blocked by default; attachments are served through authenticated Worker endpoints with download-only headers.
5. Provider acceptance is an external side effect. A network outcome that could have accepted the message is `unknown`, never an automatic retry or fallback trigger.

## Mode behavior

`resolveAppMode(env)` is the only parser for `CONTACT_MAIL_MODE`. It returns `temp` unless the value is explicitly enabled. A shared capabilities object drives the public settings response and frontend navigation, while backend gates remain authoritative.

Temp Mode does not read `contact_domains` as public domains and keeps legacy send-provider precedence. Contact Mode only accepts inbound recipients represented by enabled Contact Domain and Mailbox records, and only sends through the Provider Config explicitly bound to that domain/message.

## Inbound transaction boundary

The Contact path captures `received_at` from the Worker clock before parsing. The MIME `Date` header is stored separately as nullable `sender_date` and never drives Inbox ordering, cursors, date filters, statistics, or future cleanup. The path normalizes the recipient, loads the Domain/Mailbox, parses MIME once, computes a stable dedupe key, and persists the Legacy fallback plus Contact index.

The D1 business record is the reliable base. R2 failures retain the D1/Legacy fallback and surface `storage_status=fallback` or `degraded` for repair. After persistence, `forward`, `ai_extract`, `telegram`, `webhook`, `another_worker`, and `auto_reply` run behind `ExecutionContext.waitUntil`; each effect has an independent `contact_message_side_effects` state and failure boundary, so one failure cannot reverse receipt or stop later effects. Spam and parse-failed messages mark those effects `skipped`; deduplicated redelivery does not rerun them. No V1 automatic side-effect retry is performed.

## Outbound transaction boundary

The Send API creates or returns an outbound record by unique `Idempotency-Key`. A compare-and-set transition is the only way to claim `pending` or `failed` work for sending. Each claim creates an immutable attempt snapshot without secrets. Explicit acceptance becomes `sent`, explicit rejection becomes `failed`, and uncertain transport completion becomes `unknown`.

Failed messages may be manually retried. Unknown messages cannot be retried in place; Force Resend creates a new outbound row, Message-ID, and idempotency key linked by `force_resend_of_id`.

## Upstream synchronization

`main` follows `origin/main`/`upstream/main`. Upstream changes are reviewed into `contact-hub`, never automatically merged into production. Hotspots are kept thin: Worker route mounting, Email entry dispatch, environment types, scheduled cleanup, legacy send adapter, App/router/store/header/admin mounts. General security fixes remain separate commits where practical so they can be proposed upstream independently.

## Phase decisions

- The Contact migration track is independent of `CONSTANTS.DB_VERSION`.
- All Contact tables use a `contact_` prefix and numeric migration versions; the current Contact schema target is 7.
- Contact APIs use structured errors without changing legacy response formats.
- DNS checks are read-only and cached; DNS failure maps to `unknown`.
- No production deployment, remote push, real provider call, or Cloudflare resource mutation is part of implementation.

## V1 scale evidence

The E2E-only, mode-guarded seed path creates 50 Domains and 1,000 indexed messages without invoking MIME parsing or an external service. A 100-row metadata page measured 50,422 UTF-8 bytes and 202 ms on the local Wrangler/D1 runtime, with a next cursor and no body fields. A list containing otherwise equivalent 32-byte and 512-KiB attachments measured 1,076 bytes and contained no attachment payload. The seed route returns 404 unless `E2E_TEST_MODE=true`.

Operational, security, deployment, recovery, and upstream procedures are maintained in `DNS_AND_OPERATIONS.md`, `SECURITY.md`, `DEPLOYMENT.md`, and `UPSTREAM_SYNC.md`; the final evidence matrix is in `FINAL_REPORT.md`.
