# Contact Hub V1 Deployment, Migration, Backup, and Rollback Runbook

Reviewed deployment baseline: `contact-hub` at `3ed8d828a8e157ef354a3c6e0d7019ec7a18b5d1`.

This document covers deployment readiness only. It does not authorize a production deployment.

## 1. V1 deployment architecture

Contact Hub V1 uses **one Cloudflare Worker with Static Assets**:

```text
Browser
  -> Contact Hub Worker
       |- Vue frontend static assets (ASSETS)
       |- Contact/Admin/Open APIs
       |- Email Worker handler
       |- D1
       `- R2
```

The frontend stays same-origin with `VITE_API_BASE=`. `worker/src/worker.ts` already serves non-API requests through the `ASSETS` binding, so no Pages `BACKEND` service binding is required for Contact Hub V1.

The repository keeps the upstream Pages implementation for compatibility, but `pages/wrangler.toml` points `BACKEND` at the production Worker environment and **must not be used for Contact Hub staging**.

## 2. Wrangler Named Environments

Copy `worker/wrangler.toml.template` to the gitignored `worker/wrangler.toml`. The tracked template contains `<STAGING_D1_ID>` and `<PRODUCTION_D1_ID>` markers intentionally; do not pass the template itself to Wrangler.

Use only explicit environment commands for Contact Hub operations:

```text
pnpm run dev:staging
pnpm run dry-run:staging
pnpm run deploy:staging
pnpm run dry-run:production
pnpm run deploy:production
```

Do not rely on a long-lived `CLOUDFLARE_ENV` export for manual deployment. `--env staging` / `--env production` is the reviewed release boundary. The existing generic `pnpm run deploy` script is retained only for upstream compatibility and must not be used for Contact Hub staging or production.

The RC-tested compatibility date remains `2025-04-01`; changing it is a separate runtime-compatibility change and requires a new regression pass.

Wrangler bindings and `vars` are non-inheritable, so staging and production define their own D1, R2, and vars blocks. Static Assets is shared from the top level.

## 3. Resource isolation

Staging defaults:

```text
Worker: contact-mail-hub-staging
D1:     contact-mail-hub-staging
R2:     contact-mail-hub-staging (private)
Web:    workers.dev first; custom hostname later
Mail:   mail-staging.<approved-domain>
```

Production uses separate Worker, D1, R2, secrets, domains, and provider credentials. Never bind a staging environment to a production D1/R2 resource.

R2 must remain private: do not enable `r2.dev` and do not attach a public custom domain.

## 4. Secrets and local development

Never store these in Wrangler vars, Git, D1, logs, screenshots, or documentation:

- `JWT_SECRET`
- `ADMIN_PASSWORDS`
- `CONTACT_RESEND_*_API_KEY`
- `CONTACT_BREVO_*_API_KEY`
- `CONTACT_SMTP_*_PASSWORD`
- Cloudflare API tokens

Cloud secrets are set independently:

```text
wrangler secret put JWT_SECRET --env staging
wrangler secret put ADMIN_PASSWORDS --env staging
# Later, when Resend is selected:
wrangler secret put CONTACT_RESEND_MAIN_API_KEY --env staging
```

Production secrets are configured separately with `--env production` and different values.

For local development use `worker/.dev.vars.staging` or `worker/.dev.vars.production`. Environment-specific `.dev.vars.*` and `.env*` files are gitignored. Do not upload local-only values as Cloudflare secrets.

## 5. Build and pre-deployment validation

Worker:

```text
cd worker
pnpm install --frozen-lockfile
pnpm test
pnpm run lint
pnpm run build
```

Frontend:

```text
cd frontend
pnpm install --frozen-lockfile
pnpm test -- --run
pnpm run build:pages
```

Then run `git diff --check`. After copying the template to `worker/wrangler.toml` and inserting the real staging D1 ID, run `pnpm run dry-run:staging` and review Worker name, D1, R2, Static Assets, vars, and absence of production resources or secret values.

## 6. Staging deployment order

Do not enable Email Routing until Worker, D1, R2, migrations, administrator authentication, Contact Domain, and Mailbox are ready.

1. `wrangler whoami` and confirm the intended Cloudflare account.
2. Create `contact-mail-hub-staging` D1 and record its real `database_id`.
3. Create private `contact-mail-hub-staging` R2.
4. Put the D1 ID into local gitignored `worker/wrangler.toml`.
5. Configure only `JWT_SECRET` and `ADMIN_PASSWORDS` first; do not configure Provider secrets yet.
6. Build the frontend and run `pnpm run dry-run:staging`.
7. Deploy with `pnpm run deploy:staging`.
8. Verify `/health_check` and `/open_api/settings`; Contact mode must disable public mailbox, address creation, registration, public sending, and the user portal.
9. Initialize/migrate the upstream database as required until `/admin/db_version` reports the code version (`v0.0.8` at this reviewed baseline).
10. Run `/admin/contact/db/migrate` until Contact schema is version 7 and a repeated migration reports `pending=[]`.
11. Verify `/admin/contact/storage/status` and `/admin/contact/health`. Before domain/provider setup require `adminReady=true`, `migrationReady=true`, and `storageReady=true`.
12. Create the staging Contact Domain and fixed Mailbox before enabling Email Routing.

The detailed interactive sequence is in `STAGING_RUNBOOK.md`.

## 7. Email Routing and provider order

Use a mail hostname distinct from the web hostname, for example `mail-staging.<approved-domain>`. Create the Domain and `contact@...` Mailbox in Contact Hub before adding Cloudflare routing.

Use Cloudflare Dashboard's current Email Routing MX values; never copy historic MX targets. Do not create a catch-all for the first staging test.

Provider order for first staging verification:

1. Resend.
2. Brevo only after Resend smoke passes.
3. Generic SMTP last.

DNS rules:

- exactly one SPF record per hostname; merge mechanisms instead of publishing a second `v=spf1`;
- use the provider-supplied DKIM selector exactly;
- publish one `_dmarc` record; staging may use an approved observation policy, but this runbook does not choose production DMARC policy;
- Contact Hub DNS checks are read-only; resolver failures remain `unknown`.

## 8. Smoke tests

Before declaring staging ready, verify inbound Gmail/Outlook delivery, trusted `received_at`, HTML sanitization, blocked remote images, attachment metadata/R2/download, reply threading headers, provider acceptance, Failed Retry, Unknown Retry rejection, and explicit Force Resend behavior.

`outboundReady` is not required before the first provider is configured. After Domain/Mailbox/routing are complete, require `inboundReady=true` and `productionReady=true` for the intended staging topology; after the outbound provider is configured, verify `outboundReady=true` separately.

## 9. Backup and rollback

Before any migration of a non-empty staging/production D1, export it with the installed Wrangler version and verify the export can be parsed/restored into a disposable recovery database.

Contact migrations 6-7 are additive. Roll back code before data: do not drop `sender_date`, `contact_message_side_effects`, Contact messages, outbound attempts, or R2 objects. Preserve the matching D1/R2 recovery point and revert Email Routing if an older Worker cannot safely accept Contact addresses.

## 10. Production stop

A successful staging run is a stop point. **Production is NOT DEPLOYED by this runbook.** Production requires a separate explicit approval, fresh backup, production-specific secrets/resources, and a reviewed production dry-run.
