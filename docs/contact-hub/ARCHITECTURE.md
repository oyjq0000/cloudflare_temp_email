# Private Multi-domain Contact Mail Hub V1 Architecture

## Scope

Contact Hub is a private administrative mail application layered onto the existing temporary-mail project. `CONTACT_MAIL_MODE=false` preserves the upstream product. `CONTACT_MAIL_MODE=true` selects the private Contact Hub, rejects public mailbox capabilities in the Worker, and exposes Contact features only below the existing authenticated `/admin/*` boundary.

The V1 boundary is deliberately narrow: fixed mailboxes, unified inbox/search, safe message display, replies, explicit per-domain outbound providers, auditable delivery state, and read-only DNS checks. It does not add a ticketing system, multi-user collaboration, AI workflows, outbound attachments, automatic provider fallback, or DNS mutation.

## Baseline and integration seams

The implementation starts at `f92b059aac0d89e2c106601b6857dce9dcae07d3` (application 1.12.0, upstream DB v0.0.7). Product code lives on `contact-hub`; `main` remains an upstream mirror.

Existing capabilities retained as compatibility seams:

- `worker/src/worker.ts`: Hono middleware and route mounting.
- `worker/src/email/index.ts`: Email Worker entry point.
- `worker/src/commom_api.ts`: public settings response (filename intentionally unchanged).
- `worker/src/mails_api/send_mail_api.ts`: legacy outbound selection and balance behavior.
- `worker/src/admin_api/index.ts`: authenticated Contact API mount.
- `frontend/src/router/index.js` and `frontend/src/App.vue`: thin mode-aware routing/layout mounts.
- `raw_mails`, `address`, and `sendbox`: legacy compatibility/fallback data.

New business logic is isolated under `worker/src/contact/`, `worker/src/mail_providers/`, `frontend/src/views/contact/`, `frontend/src/components/contact/`, `frontend/src/api/contact.js`, and `frontend/src/store/contact.js`.

## Runtime topology

```text
Cloudflare Email Routing
          |
          v
  Email Worker entry
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
 authenticated /admin/contact/* API
            |
            v
       Private Hub UI
            |
            v
 ContactOutboundRouter
      /       |       \
  Resend    Brevo     SMTP
```

Pages middleware continues to proxy API traffic to the Worker. No Contact secret or private entity is returned by `/open_api/settings`; that endpoint exposes only mode and public capability booleans.

## Trust boundaries

1. Public requests are untrusted. In Contact Mode, public creation, registration, OAuth user entry, public mailbox access, and public sending are rejected in Worker middleware even if a stale frontend renders them.
2. `/admin/contact/*` inherits the existing admin authentication boundary. Contact Mode additionally reports an unsafe configuration if neither admin passwords nor a verified admin role is available, or if password checks are disabled outside `E2E_TEST_MODE`.
3. D1 stores business state and secret references only. Secret values are resolved from Worker bindings at send time and are never serialized into API responses, snapshots, attempts, or logs.
4. Email HTML and attachments are hostile input. Sanitization is mandatory before every received or sent HTML render; remote content is blocked by default; attachments are served through authenticated Worker endpoints with download-only headers.
5. Provider acceptance is an external side effect. A network outcome that could have accepted the message is `unknown`, never an automatic retry or fallback trigger.

## Mode behavior

`resolveAppMode(env)` is the only parser for `CONTACT_MAIL_MODE`. It returns `temp` unless the value is explicitly enabled. A shared capabilities object drives the public settings response and frontend navigation, while backend gates remain authoritative.

Temp Mode does not read `contact_domains` as public domains and keeps legacy send-provider precedence. Contact Mode only accepts inbound recipients represented by enabled Contact Domain and Mailbox records, and only sends through the Provider Config explicitly bound to that domain/message.

## Inbound transaction boundary

The Contact path normalizes the envelope recipient, loads the Domain/Mailbox, rejects disabled or unknown recipients, reads the raw message, parses MIME once, computes a stable dedupe key, and persists the legacy fallback plus Contact index before optional side effects.

The D1 business record is the reliable base. R2 failures retain the D1/legacy fallback and surface `storage_status=fallback` (no binding, full D1 raw available) or `degraded` (an object write failed or the bounded raw fallback is incomplete) for repair. `stored` means the raw EML and every attachment were written to R2. Reliable D1 persistence failure prevents forwarding, Telegram, webhook, and auto-reply side effects. Spam-classified messages are stored in the Spam folder rather than discarded; hard blacklist rejection remains possible.

## Outbound transaction boundary

The Send API creates or returns an outbound record by unique `Idempotency-Key`. A compare-and-set transition is the only way to claim `pending` or `failed` work for sending. Each claim creates an immutable attempt snapshot without secrets. Explicit acceptance becomes `sent`, explicit rejection becomes `failed`, and uncertain transport completion becomes `unknown`.

Failed messages may be manually retried. Unknown messages cannot be retried in place; Force Resend creates a new outbound row, Message-ID, and idempotency key linked by `force_resend_of_id`.

## Upstream synchronization

`main` follows `origin/main`/`upstream/main`. Upstream changes are reviewed into `contact-hub`, never automatically merged into production. Hotspots are kept thin: Worker route mounting, Email entry dispatch, environment types, scheduled cleanup, legacy send adapter, App/router/store/header/admin mounts. General security fixes remain separate commits where practical so they can be proposed upstream independently.

## Phase decisions

- The Contact migration track is independent of `CONSTANTS.DB_VERSION`.
- All Contact tables use a `contact_` prefix and numeric migration versions.
- Contact APIs use structured errors without changing legacy response formats.
- DNS checks are read-only and cached; DNS failure maps to `unknown`.
- No production deployment, remote push, real provider call, or Cloudflare resource mutation is part of implementation.
