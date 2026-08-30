# Contact Hub Progress

## Baseline

- Branch at start: `main`; implementation branch: `contact-hub`.
- HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`f92b059 feat: add Admin random address name generation (#1127)`).
- Origin HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`origin/main`, locally recorded).
- Upstream HEAD: `f92b059aac0d89e2c106601b6857dce9dcae07d3` (`upstream/main`, locally recorded).
- Audit baseline difference: none; starting HEAD exactly matches the documented audit SHA.
- Working tree at start: not clean; untracked `docs/contact-hub/contact-mail-hub-codex-goal.md` supplied by the user. It was preserved and copied byte-for-byte to the required `docs/contact-hub/CODEX_GOAL.md` path.
- Runtime: Node `v24.15.0`, pnpm `10.20.0` (project declares 10.10.0), npm `11.6.2`, Docker CLI `29.6.2`, Compose `v5.3.1`.
- Dependency note: the repository has no committed pnpm lockfile. Installs therefore used `--no-frozen-lockfile`. Windows dependency linking stalled after packages were fetched; a local hoisted/npm repair completed the ignored `node_modules` tree without changing tracked manifests or adding a package lock.
- Existing tests:
  - Worker lint: passed (`pnpm lint`).
  - Worker build script: environment-blocked because the ignored local `worker/wrangler.toml` is absent and Wrangler 4.124 framework auto-detection cannot configure Hono.
  - Worker equivalent dry-run build: passed with explicit `src/worker.ts`, compatibility date `2025-04-01`, and `nodejs_compat`; upload 1766.77 KiB / gzip 513.90 KiB, no deployment.
  - Frontend test: passed, 3 files and 60 tests (`pnpm test`).
  - Frontend build: passed (`pnpm build`), with only existing large-chunk warnings.
  - E2E: command executed but did not start containers because Docker Desktop's Linux daemon was unavailable at `npipe:////./pipe/dockerDesktopLinuxEngine`. Docker Desktop/backend and its WSL distribution were started locally, but daemon status calls continued to hang. No test assertion ran and no production resource was touched.

## Phase 0

- Status: completed with host E2E environment limitation recorded.
- Commit: `docs(contact-hub): add architecture and execution baseline` (hash recorded in the next phase update after commit creation).
- Files: `CODEX_GOAL.md`, `contact-mail-hub-codex-goal.md`, `ARCHITECTURE.md`, `SCHEMA.md`, `OUTBOUND_STATE_MACHINE.md`, `PROGRESS.md`.
- Tests: Worker lint pass; explicit Worker dry-run build pass; Frontend 60/60 pass; Frontend build pass; E2E infrastructure-blocked before test execution.
- Decisions: isolate Contact code, keep Temp Mode/provider order intact, use independent numeric migrations, reject unknown automatic retry/fallback, retain D1 fallback on R2 failure, and keep all production operations manual.
- Remaining risks: Docker daemon must be healthy for executable Temp/Contact E2E evidence; a local `worker/wrangler.toml` or explicit template-derived config is required for the default Worker build script.

## Phase 1

- Status: pending.
- Commit: pending.
- Files: pending.
- Tests: pending.
- Decisions: pending.
- Remaining risks: pending.

## Phase 2

- Status: pending.

## Phase 3

- Status: pending.

## Phase 4

- Status: pending.

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
