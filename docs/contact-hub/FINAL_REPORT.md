# Private Multi-domain Contact Mail Hub V1 — Final Report

## Status and revision

- Goal status: implementation completed; final all-in-one Docker orchestration validation is partially blocked by the host Docker Desktop Linux daemon.
- Branch: `contact-hub`.
- Audit/base SHA: `f92b059aac0d89e2c106601b6857dce9dcae07d3`.
- Final implementation/test HEAD: `9b469e0` (`test(contact-hub): complete full regression and browser coverage`).
- Final branch HEAD: the documentation closure commit containing this report, immediately after `9b469e0`; use `git rev-parse HEAD` for the immutable value in the reviewed checkout.
- Production actions: none. No push, deployment, production resource mutation, real provider call, or real Secret occurred.

## 1. Architecture summary

`CONTACT_MAIL_MODE` selects one of two paths without deleting Legacy behavior. Temp Mode keeps the upstream APIs/UI and implicit Legacy provider order. Contact Mode closes public mailbox/send/registration/user-portal capabilities in Worker middleware, requires verified administrator identity, and routes Email Worker ingress through fixed D1 Domain/Mailbox records.

Contact ingress validates the recipient, parses MIME once, computes a stable dedupe key, commits indexed D1 state, then stores raw EML/attachments under server-generated keys in private `CONTACT_R2`. The authenticated Hub lists metadata only and loads bodies/attachment metadata on demand. All HTML is sanitized, remote resources are blocked until per-message consent, and object downloads are authorized and download-only.

Contact outbound commits an idempotent intent, atomically claims it, records an append-only Attempt, and calls exactly the Provider Config assigned to the Domain. Accepted/rejected/uncertain outcomes map to Sent/Failed/Unknown. Unknown never retries or falls back automatically; Force Resend creates a new linked intent.

## 2. Phase commits

| Phase | Commit | Subject |
| --- | --- | --- |
| 0 | `f787a53` | `docs(contact-hub): add architecture and execution baseline` |
| 1 | `6191ca2` | `feat(contact-mode): add private mode capability gates` |
| 2 | `85e3e74` | `feat(contact-db): add domain and mailbox management` |
| 3 | `1f2d652` | `feat(contact-inbound): add indexed inbound ingestion and R2 storage` |
| 4 | `70c15b8` | `feat(contact-inbox): add unified inbox and safe mail rendering` |
| 5 | `c2f10ab` | `feat(contact-providers): add explicit provider configuration` |
| 6 | `b6aea90` | `feat(contact-outbound): add idempotent delivery state machine` |
| 7 | `fa2ea94` | `feat(contact-ops): add dns health and safety controls` |
| 8 | `9b469e0` | `test(contact-hub): complete full regression and browser coverage` |
| 8 docs | report commit | `docs(contact-hub): add deployment rollback and final report` |

## 3. Key files and ownership

- Mode/policy seam: `worker/src/app_mode.ts`, thin mounts in `worker/src/worker.ts`, `worker/src/email/index.ts`, and `worker/src/commom_api.ts`.
- Contact backend: `worker/src/contact/` (DB, Domain/Mailbox, ingress, storage, message APIs, outbound, providers, DNS, operations, CORS).
- Provider adapters: `worker/src/mail_providers/` plus the Contact registry/secret resolver.
- Private frontend: `frontend/src/views/contact/`, `frontend/src/components/contact/`, `frontend/src/api/contact.js`, `frontend/src/store/contact.js`.
- Security utilities: unified HTML sanitizer/remote policy, safe MIME/filename helpers, and client filename sanitizer.
- E2E: `e2e/tests/api/contact-*.spec.ts`, `e2e/tests/browser/contact-hub.spec.ts`, local provider injection, R2/D1 fault injection, and Mailpit helpers.
- Documents: `ARCHITECTURE.md`, `SCHEMA.md`, `OUTBOUND_STATE_MACHINE.md`, `PROVIDERS.md`, `DNS_AND_OPERATIONS.md`, `SECURITY.md`, `DEPLOYMENT.md`, `UPSTREAM_SYNC.md`, and this report.

## 4. Database and migrations

Contact owns `contact_schema_migrations`, independent of upstream `DB_VERSION`:

| Version | Name | Main additions |
| --- | --- | --- |
| 1 | `contact_domain_mailbox_provider_core` | `contact_domains`, `contact_mailboxes`, `contact_provider_configs` |
| 2 | `contact_inbound_message_storage` | `contact_messages`, `contact_attachments`, inbox/dedupe/storage indexes |
| 3 | `contact_inbound_truncation_signal` | explicit bounded-body truncation signal |
| 4 | `contact_outbound_state_machine` | `contact_outbound_messages`, `contact_outbound_attempts` |
| 5 | `contact_dns_check_cache` | `contact_dns_checks` and cache indexes |

The runner applies numeric versions in order, records only successful versions, and is idempotent. Tests cover empty/current upstream databases, repeated migration, upstream version isolation, and retained Legacy data. There is no automatic downgrade or table drop.

## 5. API inventory

All business APIs are administrator-authenticated under `/admin/contact/*`:

- Runtime/schema/storage: `GET status`, `GET db/version`, `POST db/migrate`, `GET storage/status`, `POST storage/repair/:id`.
- Domains: list/create/get/update/soft-delete; `GET domains/:id/dns`; `POST domains/:id/dns/refresh`.
- Mailboxes: list/create/get/update/soft-delete.
- Providers: list/create/get/update/disable, with Secret values/references redacted.
- Messages: list/detail, read/unread, Spam/not-Spam, Reply, raw download, attachment download.
- Outbound: list/create/detail, Failed Retry, confirmed Unknown Force Resend.
- Operations: `GET health`, `POST operations/reconcile-stale`.

`/open_api/settings` exposes only mode/capabilities, never Contact entities. `/admin/test/contact_performance_seed` is administrator protected, bounded to 100 Mailboxes/2,000 messages, and returns 404 unless `E2E_TEST_MODE=true`.

## 6. Environment, bindings, and Secret References

Required production choices:

- `CONTACT_MAIL_MODE=true`.
- `CONTACT_ALLOWED_ORIGINS` containing exact HTTPS frontend origins when not same-origin.
- optional `CONTACT_DNS_CACHE_TTL_SECONDS` (60–86400; default 3600).
- secure `JWT_SECRET`.
- `ADMIN_PASSWORDS` or verified `ADMIN_USER_ROLE`.
- `DISABLE_ADMIN_PASSWORD_CHECK=false` and `E2E_TEST_MODE` absent/false.
- D1 binding `DB` and private R2 binding `CONTACT_R2`.

Example Secret References: `CONTACT_RESEND_MAIN_API_KEY`, `CONTACT_BREVO_MAIN_API_KEY`, `CONTACT_SMTP_MAIN_PASSWORD`. D1 stores only these names. Values must be installed as Worker Secrets and never placed in Wrangler vars or D1. Full examples are in `DEPLOYMENT.md` and `PROVIDERS.md`.

## 7. Email Routing and DNS manual steps

For each Domain, a human must create/verify Cloudflare Email Routing, route only the fixed Contact addresses to the Worker, and ensure the same enabled Mailboxes exist in D1. Use the current Cloudflare dashboard MX targets rather than copied values. Merge outbound mechanisms into one SPF record, publish the selected provider's exact DKIM selector/record, and publish one reviewed DMARC policy. Enter the DKIM selector explicitly in Operations and run read-only checks. Contact Hub never mutates DNS. Detailed sequencing is in `DEPLOYMENT.md`.

## 8. Test commands and results

### Worker

```text
cd worker
npm test
npm run lint
npm run build
```

Result: 41/41 unit tests passed; lint passed; Wrangler 4.124 dry-run build passed (1,265.65 KiB / gzip 347.89 KiB). `npm run build` used `wrangler deploy --dry-run`; it did not deploy.

### Frontend

```text
cd frontend
npm test -- --run
npm run build
```

Result: 5 files, 67/67 tests passed; production build passed. The only warning is the existing large-chunk advisory.

### Contact API, browser, performance, and SMTP

```text
cd e2e
npx playwright test tests/api/contact-*.spec.ts --project=api
npx playwright test tests/browser/contact-hub.spec.ts --project=browser
```

Result: Contact API 32/32 passed on isolated local Wrangler/D1/R2 with injected HTTP providers and local Mailpit. Browser Chromium 2/2 passed. Both SMTP wire cases passed: explicit Domain SMTP wins despite a fake Legacy Resend token, and Reply carries Message-ID/In-Reply-To/References through Mailpit.

Performance result: 50 Domains and 1,000 indexed messages; a 100-row page measured 50,422 UTF-8 bytes and 202 ms, had a next cursor, and had no `text_body`/`html_body`. A list containing 32-byte and 512-KiB attachments measured 1,076 bytes and contained no payload bytes.

### Temp Mode

The host-executable complete Temp API set contains 111 unique tests. A broad local run passed 106; two state-sensitive Cleanup cases then passed 2/2 on a fresh isolated D1; a dedicated local `SEND_MAIL` binding topology passed 18/18, including the three binding tests absent from the broad topology. Therefore every one of the 111 unique Temp API cases has passing evidence. SMTP cases used local Mailpit and fake configuration only.

### Docker Compose limitation

`docker compose config --quiet` passed. `docker version` and `npm test` failed before any container/test assertion because the Docker Desktop Linux pipe is absent:

```text
failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine
open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified.
```

The missing daemon prevents the single-command Compose topology, gzip Worker project, SMTP/IMAP proxy containers, and Legacy browser suite from being validated together. Local Wrangler instances, a private isolated D1/R2 state, Chromium, provider mocks, a dedicated local `SEND_MAIL` binding, and official portable Mailpit covered all Contact V1 and all Temp API assertions, but cannot faithfully emulate the proxy/container networking projects.

Manual unblock command after Docker Desktop reports a healthy Linux engine:

```text
cd e2e
npm test
```

If it passes, no code change is expected; record the report alongside this file. If it fails an assertion, resume Phase 8 at “full Docker Compose regression,” fix without weakening tests, rerun all affected gates, update this report, and create a new local commit.

## 9. Security fixes and evidence

- Worker-enforced Contact capability gate and administrator security health.
- Public settings Domain/Provider/Secret redaction.
- Exact-origin Contact CORS with synchronized, exact frontend preflight headers.
- Single-pass MIME, stable dedupe, D1-before-side-effects, private server-generated R2 keys.
- Metadata-only list APIs and authorized detail/object endpoints.
- Sanitized received/Sent HTML; default remote blocking; consent cannot bypass sanitization.
- Safe response/client filenames, `nosniff`, private/no-store, active MIME coercion.
- `CONTACT_*` reference validation and runtime-only values; classified provider diagnostics.
- Header/address CRLF rejection, idempotent atomic delivery, no fallback, Unknown no-retry.
- Contact address cleanup protection and stale Sending reconciliation without provider invocation.

See `SECURITY.md` for the threat model and `OUTBOUND_STATE_MACHINE.md` for delivery invariants.

## 10. V1 Definition of Done evidence

| # | Evidence |
| --- | --- |
| 1 | Temp Mode 111 unique API tests plus frontend build/unit evidence; full Docker wrapper remains the recorded host limitation. |
| 2 | capability unit tests and Contact API 403 matrix; Contact router/layout hides public UI. |
| 3 | admin configuration unit/API/health tests; production bypass rejected. |
| 4–5 | D1 Domain/Mailbox CRUD, normalization, fixed-address sync, default invariants, 50-Domain tests. |
| 6 | unified Inbox plus Domain/Mailbox/unread/Spam/date/From/To/Subject server filters. |
| 7–9 | metadata-only list, detail-only body, single MIME parse, D1 indexes, private R2 raw/attachments. |
| 10 | Message-ID and raw-hash dedupe with unique constraint and concurrent-safe behavior. |
| 11 | Reply-To/Message-ID/In-Reply-To/References unit, API, and Mailpit wire evidence. |
| 12–14 | Resend/Brevo/SMTP interface, explicit Domain binding, fake-global override test, reference/value redaction. |
| 15–18 | five-state model, Unknown no retry/fallback, confirmed Force Resend, append-only attempts/diagnostics. |
| 19 | Sent/Failed/Unknown list, counts, filters, and UI. |
| 20 | cached read-only MX/SPF/DKIM/DMARC Operations API/UI and pure evaluator tests. |
| 21–23 | sanitizer/remote policy unit tests plus Chromium malicious HTML/tracking test; no raw `v-html` path. |
| 24 | authenticated Raw/attachment API, safe headers/MIME/name tests and Chromium malicious SVG case. |
| 25 | Legacy direct-delete, bounded cleanup, scheduled cleanup, and operations cleanup preservation tests. |
| 26 | numeric Contact migration versions 1–5 independent of upstream version; repeated migration evidence. |
| 27 | business code isolated in Contact/provider/frontend Contact namespaces; hotspots remain thin. |
| 28 | Worker 41/41/lint/build, frontend 67/67/build, Contact 32/32 + browser 2/2, Temp 111 unique; all-in-one Docker wrapper infrastructure-blocked before assertions. |
| 29 | architecture/schema/state/security/provider/DNS/deployment/backup/recovery/rollback/upstream documents present. |
| 30 | local Phase commits only; no production deployment or remote push. |

## 11. Known limitations and non-V1 scope

- Final Compose/gzip/proxy/Legacy-browser orchestration awaits a healthy Docker daemon as described above.
- V1 DNS is read-only and cannot prove provider-domain ownership without the provider's staging/production control plane.
- R2 repair requires the bounded D1 raw fallback; an oversized message with an initial object-write failure needs the original source for full recovery.
- Provider acceptance is not a delivery/read receipt. Unknown remains an explicit human risk decision.
- V1 has no outbound attachments, full conversation UI, archive/star/snooze/tags, ticketing, multi-member collaboration, AI summary/reply/classification, automatic fallback, DNS mutation, IMAP server, or self-hosted internet SMTP server.

## 12. Production checklist, migration, restore, and rollback

The authoritative checklist and commands are in `DEPLOYMENT.md`. Mandatory gates include branch review, complete regression, tested D1 export/restore, private R2 binding, secure administrator auth, exact origins, Secret-only provider values, provider/domain verification, Email Routing/DNS review, staging migration version 5/idempotency, smoke tests, and rehearsed rollback.

Rollback prefers the previously recorded Worker/frontend revision while retaining additive Contact tables and private R2 objects. Never downgrade/drop Contact tables, blindly import over populated D1, route fixed Contact addresses into a public Temp pipeline, or resend Unknown during rollback.

## 13. Upstream sync

`main` remains the upstream mirror; reviewed upstream changes integrate into a temporary branch from `contact-hub`. Conflict hotspots are Worker route/middleware, Email entry, public settings, bindings/types, cleanup/scheduler, Legacy send, Admin mount, App/router/store/header/Admin, and shared API headers. Every sync must re-audit newly added public endpoints and rerun mode/security/provider/cleanup tests. See `UPSTREAM_SYNC.md`.

## 14. Manual actions not executed

- Create/bind production D1/R2 resources.
- Set production JWT/admin/provider Secrets.
- Verify provider Domains or call Resend/Brevo/real SMTP.
- Configure Cloudflare Email Routing or MX/SPF/DKIM/DMARC.
- Run staging/production migration, backup/restore, smoke, deployment, rollback, or DNS mutation.
- Fetch/merge/push remote branches.

## 15. V2 suggestions (not implemented)

After V1 production evidence is stable: add provider webhook reconciliation for Unknown, a deliberate D1/R2 retention/orphan workflow, and richer operational metrics/export. Conversation/thread UX or outbound attachments should be separate designs with new security/storage/idempotency reviews. AI/ticketing/multi-user features remain outside this recommendation until the private mail core has operational history.
