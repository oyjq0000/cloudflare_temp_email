# Contact Hub V1 Security Model

## Trust boundary

Contact Hub is an administrator-only application. `CONTACT_MAIL_MODE=true` does not merely hide the Temp UI: Worker middleware rejects public mailbox, address creation, registration, OAuth mailbox entry, user-portal mailbox access, and public-send routes before their handlers run. `/admin/contact/*` then requires the existing administrator credential or a verified account with `ADMIN_USER_ROLE`.

Production is unhealthy when neither administrator mechanism is configured. `DISABLE_ADMIN_PASSWORD_CHECK=true` is rejected in Contact Mode unless the process is explicitly running with `E2E_TEST_MODE=true`; that exception is only for disposable local tests.

## Browser and content safety

- Contact HTML is sanitized before every render. Script/style injection, event handlers, active URLs, forms, embedded objects, and other executable markup are removed.
- Remote images and tracking resources are removed by default. Per-message consent restores only sanitized remote image URLs; it never bypasses sanitization.
- Received and sent HTML share the hardened render path. Shadow DOM is an isolation mechanism, not a sanitizer.
- Contact CORS permits same-origin requests and exact origins from `CONTACT_ALLOWED_ORIGINS`; wildcard, credential-bearing, and path-bearing origins are rejected.
- The CORS preflight allowlist contains the exact authentication, idempotency, language, and fingerprint headers sent by the frontend. It does not echo arbitrary requested headers.

## Mail and object safety

- MIME is parsed once on ingress. List APIs query indexed metadata and never return raw EML, full bodies, attachment bytes, R2 keys, or idempotency keys.
- Raw EML and attachment objects use server-generated R2 keys. User filenames are metadata only.
- Raw/attachment downloads re-check administrator authentication and object ownership, set private/no-store caching and `X-Content-Type-Options: nosniff`, and force active MIME types to download as `application/octet-stream`.
- Both response headers and client-side save names reduce filenames to a bounded leaf name and remove control characters.
- A stable unique dedupe key protects against inbound redelivery. Contact-owned fixed addresses are excluded from Legacy deletion and scheduled cleanup.

## Provider and delivery safety

- D1 stores only `CONTACT_*` Secret References. Values are resolved from Worker Secrets at invocation time and never returned by APIs or stored in Attempt snapshots.
- A Domain's explicit Provider Config is authoritative. Legacy `RESEND_TOKEN`, `SMTP_CONFIG`, and `SEND_MAIL` settings cannot override it.
- Provider diagnostics are reduced to generic class/code/message fields. Raw provider bodies, exception strings, authorization headers, Secret References, and Secret values are not persisted.
- An outbound intent is committed before delivery and claimed with compare-and-set. A reused idempotency key cannot create a second attempt.
- Explicit acceptance becomes `sent`, explicit rejection becomes `failed`, and uncertain completion becomes `unknown`. Unknown is never automatically retried or sent through a fallback provider.
- Failed Retry is manual. Unknown Force Resend requires confirmation and creates a new linked intent and Message-ID, preserving the original audit record.

## Operational safety

DNS checks are read-only and use DNS-over-HTTPS. Resolver failures are `unknown`; multiple SPF records are `invalid`, and the UI never suggests adding a second SPF record. DKIM requires an explicit selector and is never guessed.

Stale `sending` reconciliation only changes the intent and open attempt to `unknown`; it never calls a provider. Database migrations are additive, numeric, independent of the upstream DB version, and do not drop Legacy tables.

## Verification coverage

Unit and E2E coverage includes capability gates, administrator configuration, origin rejection and preflight headers, HTML/script/remote-image behavior in a real browser, malicious SVG attachment download, path/control-character filenames, secret redaction, CRLF headers, provider timeout classification, idempotency races, Unknown retry denial, stale reconciliation, and Legacy cleanup preservation.

No real provider Secret, provider endpoint, production D1/R2 resource, DNS mutation API, deployment, or remote push was used during V1 implementation.
