# Contact Hub Progress

## Baseline

- Branch at start: `main`; implementation branch: `contact-hub`.
- HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`f92b059 feat: add Admin random address name generation (#1127)`).
- Origin HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`origin/main`, locally recorded).
- Upstream HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`upstream/main`, locally recorded).
- Audit baseline difference: none; starting HEAD exactly matches the documented audit SHA.
- Working tree at start: not clean; untracked `docs/contact-hub/contact-mail-hub-codex-goal.md` supplied by the user. It was preserved and copied byte-for-byte to the required `docs/contact-hub/CODEX_GOAL.md` path.
- Runtime: Node `v24.15.0`, pnpm `10.20.0` (project declares 10.10.0), npm `11.6.2`, Docker CLI `29.6.2`, Compose `v5.3.1`.
- Dependency note: both Worker and Frontend have committed pnpm lockfiles. Windows dependency linking stalled after packages were fetched; a local hoisted/npm repair completed the ignored `node_modules` tree without changing tracked manifests or lockfiles.
- Existing tests:
  - Worker lint: passed (`pnpm lint`).
  - Worker build script: environment-blocked because the ignored local `worker/wrangler.toml` is absent and Wrangler 4.124 framework auto-detection cannot configure Hono.
  - Worker equivalent dry-run build: passed with explicit `src/worker.ts`, compatibility date `2025-04-01`, and `nodejs_compat`; upload 1766.77 KiB / gzip 513.90 KiB, no deployment.
  - Frontend test: passed, 3 files and 60 tests (`pnpm test`).
  - Frontend build: passed (`pnpm build`), with only existing large-chunk warnings.
  - E2E: command executed but did not start containers because Docker Desktop's Linux daemon was unavailable at `npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop/backend and its WSL distribution were started locally, but daemon status calls continued to hang. No test assertion ran and no production resource was touched.

## Phase 0

- Status: completed with host E2E environment limitation recorded.
- Commit: `f787a53` (`docs(contact-hub): add architecture and execution baseline`).
- Files: `CODEX_GOAL.md`, `contact-mail-hub-codex-goal.md`, `ARCHITECTURE.md`, `SCHEMA.md`, `OUTBOUND_STATE_MACHINE.md`, `PROGRESS.md`.
- Tests: Worker lint pass; explicit Worker dry-run build pass; Frontend 60/60 pass; Frontend build pass; E2E infrastructure-blocked before test execution.
- Decisions: isolate Contact code, keep Temp Mode/provider order intact, use independent numeric migrations, reject unknown automatic retry/fallback, retain D1 fallback on R2 failure, and keep all production operations manual.
- Remaining risks: Docker daemon must be healthy for executable Temp/Contact E2E evidence; a local `worker/wrangler.toml` or explicit template-derived config is required for the default Worker build script.

## Phase 1

- Status: completed.
- Commit: `6191ca2` (`feat(contact-mode): add private mode capability gates`).
- Files: centralized Worker app-mode policy and tests, authenticated Contact status route, settings/health/admin middleware integration, Contact Hub/Login frontend shell, mode-aware router/layout/store/API, Contact E2E fixture/API spec, Worker variable template/docs, and bilingual changelogs.
- Tests: Worker 15/15; Worker lint pass; explicit Worker dry-run build pass; Frontend 63/63; Frontend production build pass; Compose configuration pass; Playwright discovery pass (162 tests). The Contact API suite ran against local `wrangler dev` with the committed mock config and passed 3/3, proving settings redaction, all public 403 gates, unauthenticated 401, and authenticated status 200. Full Docker E2E remains blocked by the host daemon issue recorded in Baseline.
- Decisions: all `/api/*` mailbox APIs, `/external/*`, `/telegram/*`, address credential login, and non-admin user-portal APIs are rejected before business handlers in Contact Mode. User password login/settings and passkey authentication remain available only to support `ADMIN_USER_ROLE`; registration, OAuth, verification, mailbox management, and sending remain blocked. Contact public settings return empty legacy domain arrays.
- Remaining risks: browser/E2E execution still requires a healthy Docker daemon; Domain/Inbox APIs are intentionally absent until later phases.

## Phase 2

- Status: completed.
- Commit: `85e3e74` (`feat(contact-db): add domain and mailbox management`).
- Files: independent numeric Contact migration runner/version API; `contact_domains`, `contact_mailboxes`, and `contact_provider_configs`; normalized Domain/Mailbox CRUD; atomic upstream `address` synchronization; soft disable and default-mailbox invariants; Legacy delete/cleanup protection; Contact Domain/Mailbox management UI; and dedicated E2E coverage.
- Tests: Worker 18/18; Worker lint pass; explicit Worker dry-run build pass; Frontend 63/63; Frontend production build pass; Playwright discovery pass (166 tests). Local Contact Wrangler API suites passed 7/7, including migration idempotency and upstream-version isolation, normalized Domain creation, fixed-address synchronization, cross-Domain rejection, 50 private Domains, public-settings redaction, and Legacy delete/cleanup preservation. Full Docker E2E remains blocked by the host daemon issue recorded in Baseline.
- Decisions: Contact migration versions are numeric and independent of upstream `db_version`; Domain names and Mailbox address ownership are immutable; deletion is a soft disable; the first Mailbox is always the Domain default; default Mailboxes cannot be disabled until another default is selected; Contact-owned upstream addresses are excluded from old deletion and scheduled cleanup paths. Contact Mode also rejects custom SQL cleanup because arbitrary DELETE statements cannot be safely scoped.
- Remaining risks: migration execution remains an explicit authenticated administrator action; production D1 must be backed up and migrated manually. Provider secret references and provider binding validation arrive in Phase 5.

## Phase 3

- Status: completed.
- Commit: `1f2d652` (`feat(contact-inbound): add indexed inbound ingestion and R2 storage`).
- Files: Contact migrations 2-3 for message/attachment indexes and truncation visibility; fixed-recipient Contact ingress; single-pass PostalMime parsing; Message-ID and raw-SHA256 dedupe; atomic D1 business/Legacy fallback persistence; private R2 object store with server-generated keys and checksums; storage status/repair API and Hub status; local R2 binding fixture; bilingual binding docs; and Contact inbound E2E coverage.
- Tests: Worker 20/20; Worker lint pass; explicit Worker dry-run build pass; Frontend 63/63; Frontend production build pass; Compose configuration pass. Local Contact Wrangler suites passed 13/13. The six inbound cases prove Plain/HTML/Multipart/CID/Attachment parsing, D1 metadata without attachment bytes, raw/attachment R2 writes, Message-ID and no-Message-ID dedupe, R2 failure fallback plus repair, D1 failure with no forward/reply side effects, Spam persistence, unknown-recipient rejection, and authenticated storage health.
- Decisions: Contact ingress validates enabled Domain and Mailbox rows instead of `DOMAINS`; hard blacklist remains a pre-ingest rejection; junk classification maps to the Spam folder. D1 is committed before any external side effect. Raw EML and attachments use private, server-generated R2 keys; user filenames are metadata only. Raw D1 fallback is bounded at 1.5 MB, parsed bodies at 512k characters each, and truncation is explicit. Missing R2 uses `fallback`; partial/missing object writes use `degraded`; complete object persistence uses `stored`.
- Remaining risks: production requires a manually created private R2 bucket/binding and a reviewed migration. The current repair path needs the bounded D1 raw fallback; messages larger than that require the original R2 object or external recovery if the initial R2 write failed.

## Phase 4

- Status: completed.
- Commit: `feat(contact-inbox): add unified inbox and safe mail rendering` (hash recorded in the Phase 5 update after commit creation).
- Files: metadata-only Contact message list service with tuple cursor pagination and server filters; on-demand detail/read/unread/Spam APIs; authenticated private R2/D1-fallback Raw and attachment downloads; safe filename/MIME response headers; Contact sidebar, filters, desktop split view and mobile drawer; unified HTML sanitizer for Contact, Legacy, Sent, Shadow DOM, iframe, and Telegram paths; remote-content consent; and dedicated API/security tests.
- Tests: Worker 24/24; Worker lint pass; explicit Worker dry-run build pass; Frontend 65/65; Frontend production build pass; Compose configuration pass; Playwright discovery pass. Local Contact Wrangler suites passed 17/17. The four new message cases prove metadata-only list payloads, stable cross-page cursor results, Domain/Mailbox/From/To/Subject/Date filters, detail-only bodies, storage-key/byte redaction, unread and Spam counts/state, authenticated Raw/attachment access, R2 download behavior, path-safe filenames, `nosniff`, private no-store caching, and active MIME coercion.
- Decisions: list queries never read or parse `raw_mails`; detail loads indexed bodies and attachment metadata only. Remote resources are blocked per message until explicit consent and all HTML remains sanitized after consent. Raw objects and attachment keys never enter JSON responses; downloads are same-origin Admin endpoints. Attachment filenames are metadata only and are reduced to a leaf name for response headers; executable MIME types are served as `application/octet-stream`.
- Remaining risks: a real browser session against the Contact Hub still depends on the unavailable Docker daemon for the complete containerized UI suite. Local unit tests prove sanitizer behavior and the production frontend build succeeds; full Docker/browser confirmation remains a Phase 8 gate.

## Phase 5

- Status: pending.

## Phase 6

- Status: pending.

## Phase 7

- Status: pending.

## Phase 8

- Status: pending.

## Manual production actions

- [ ] Create the production R2 bucket.
- [ ] Add the `CONTACT_R2` binding.
- [ ] Configure Worker Secret references.
- [ ] Configure Cloudflare Email Routing.
- [ ] Add/merge provider and policy DNS records.
- [ ] Back up production D1.
- [ ] Run the Contact migration in staging, then production after review.
- [ ] Complete production smoke and rollback drills.
