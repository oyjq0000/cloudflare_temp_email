# Contact Hub V1 Deployment, Migration, Backup, and Rollback Runbook

This runbook is intentionally manual. V1 implementation did not deploy a Worker or Pages project, mutate Email Routing/DNS, create production D1/R2 resources, set a real Secret, or push a branch.

## 1. Preflight

1. Review the complete `contact-hub` branch and the Phase commits in `PROGRESS.md`.
2. Run the Worker, frontend, Temp, Contact, browser-security, and Mailpit suites from `FINAL_REPORT.md` in a clean staging environment.
3. Confirm the frontend and Worker origins. Prefer same-origin Pages/Worker routing. If they differ, enumerate each exact HTTPS frontend origin.
4. Inventory existing Email Routing rules, MX/SPF/DKIM/DMARC records, D1 database name/id, Worker routes, Pages project, and Legacy Temp settings.
5. Choose a maintenance window that permits an inbound routing smoke test and immediate code rollback.

## 2. Required configuration

Keep ordinary variables in the reviewed Wrangler environment and values with credential material in Worker Secrets.

```toml
[vars]
CONTACT_MAIL_MODE = true
CONTACT_ALLOWED_ORIGINS = ["https://mail.example.com"]
CONTACT_DNS_CACHE_TTL_SECONDS = 3600
CONTACT_ADMIN_SESSION_TTL_SECONDS = 14400 # 900-28800
CONTACT_PROVIDER_HTTP_TIMEOUT_MS = 15000 # 1000-60000
# Use this only when administrator accounts/roles are the chosen login mechanism.
ADMIN_USER_ROLE = "admin"
DISABLE_ADMIN_PASSWORD_CHECK = false

[[d1_databases]]
binding = "DB"
database_name = "reviewed-production-database"
database_id = "reviewed-production-id"

[[r2_buckets]]
binding = "CONTACT_R2"
bucket_name = "private-contact-mail"
```

Requirements:

- Set exactly one Contact-mode switch: `CONTACT_MAIL_MODE=true`.
- Configure `ADMIN_PASSWORDS` as a Worker Secret or use a verified `ADMIN_USER_ROLE`. Password-based Contact login exchanges the password for a scoped Contact Admin Session; the browser must not persist the raw password. Never enable `DISABLE_ADMIN_PASSWORD_CHECK` in production.
- Set `JWT_SECRET` as credential material using the deployment system's secret facility even if an existing template shows it as a variable.
- Keep `E2E_TEST_MODE` absent/false in production. It exposes only test helpers when true.
- `CONTACT_ALLOWED_ORIGINS` accepts exact origins only. Do not use `*`, a path, query, credentials, or a trailing application route.
- `CONTACT_ADMIN_SESSION_TTL_SECONDS` defaults to 14400 seconds and is constrained to 900–28800. `CONTACT_PROVIDER_HTTP_TIMEOUT_MS` defaults to 15000 ms and is constrained to 1000–60000; HTTP timeout remains an Unknown delivery outcome.
- `CONTACT_DNS_CACHE_TTL_SECONDS` accepts 60–86400 seconds and defaults to 3600.
- `DOMAINS`/`DEFAULT_DOMAINS` remain Legacy Temp settings; they do not create Contact Domains or Mailboxes.
- `CONTACT_R2` must point to a private bucket. Do not expose the bucket through a public custom domain.

## 3. Worker Secret References

Choose references per Provider Config and set their values manually. D1 receives only these names:

```text
CONTACT_RESEND_MAIN_API_KEY
CONTACT_BREVO_MAIN_API_KEY
CONTACT_SMTP_MAIN_PASSWORD
```

For each selected production Wrangler environment, run the interactive equivalent of:

```text
npx wrangler secret put CONTACT_RESEND_MAIN_API_KEY
npx wrangler secret put CONTACT_BREVO_MAIN_API_KEY
npx wrangler secret put CONTACT_SMTP_MAIN_PASSWORD
npx wrangler secret put JWT_SECRET
# When password login is selected, enter a reviewed JSON string array at this prompt:
npx wrangler secret put ADMIN_PASSWORDS
```

Enter values only at the Secret prompt. Never add values to `wrangler.toml`, D1, issue text, logs, screenshots, test snapshots, or this repository.

Provider Config examples submitted to `POST /admin/contact/providers` after authentication:

```json
{
  "name": "Main Resend",
  "provider_type": "resend",
  "config": {},
  "secret_refs": { "apiKey": "CONTACT_RESEND_MAIN_API_KEY" }
}
```

```json
{
  "name": "Main Brevo",
  "provider_type": "brevo",
  "config": {},
  "secret_refs": { "apiKey": "CONTACT_BREVO_MAIN_API_KEY" }
}
```

```json
{
  "name": "Main SMTP",
  "provider_type": "smtp",
  "config": {
    "host": "smtp.example.net",
    "port": 587,
    "secure": false,
    "starttls": true,
    "username": "reviewed-account"
  },
  "secret_refs": { "password": "CONTACT_SMTP_MAIN_PASSWORD" }
}
```

Resend/Brevo endpoints are fixed in code. SMTP host/port/TLS fields are non-secret; a password reference is mandatory when a username is present. Assign exactly one enabled Provider Config to each Domain. A failure never falls back to another Provider.

## 4. Backup before migration

1. Record the currently deployed Worker/Pages revisions and export their reviewed configuration without Secret values.
2. Export the remote D1 database to a timestamped, access-controlled location using the installed Wrangler version, for example:

   ```text
   npx wrangler d1 export <database-name> --remote --output <timestamp>-before-contact.sql
   ```

3. Validate that the export exists, is non-empty, and can be parsed/imported into a disposable recovery database.
4. Record the target R2 bucket and retention policy. Contact migration does not delete R2 objects; keep the bucket intact through rollback.
5. Do not proceed if the backup or disposable restore validation fails.

## 5. Staging migration and setup

1. Create a private staging R2 bucket and bind it as `CONTACT_R2`.
2. Deploy reviewed code/config to staging only after human authorization; leave production untouched.
3. Authenticate as an administrator and call `GET /admin/contact/db/version`.
4. Call `POST /admin/contact/db/migrate`. Repeat it once and confirm the second call is a no-op with target version 7.
5. Confirm upstream tables/data and the upstream DB version remain unchanged.
6. Check `GET /admin/contact/storage/status` and `GET /admin/contact/health`; require `adminReady`, `migrationReady`, `storageReady`, `inboundReady`, and `productionReady` to match the intended staging topology. `outboundReady` is reported separately and requires an enabled Provider, a Domain bound to a Provider with its runtime Secret present, and an enabled outbound Mailbox.
7. Create Provider Configs, then Domains and their fixed Mailboxes. Assign one explicit Provider Config to each Domain.
8. Run an inbound Email Routing smoke message, metadata-only list/detail check, safe HTML/remote-image check, attachment download, and outbound Mailpit/sandbox-provider test.
9. Exercise Failed Retry, an injected Unknown outcome, Force Resend warning, and stale-Sending reconciliation without using a real customer recipient.

## 6. Cloudflare Email Routing and DNS (manual)

For every Contact Domain:

1. Add/verify the domain in Cloudflare and enable Email Routing. Use the MX targets currently shown by the Cloudflare dashboard; do not copy stale values from documentation.
2. Route each fixed address (`contact@`, `support@`, `privacy@`, `security@`, `hello@`, etc.) to the reviewed Email Worker. Create the same address first in Contact Hub so the D1 Mailbox is enabled when mail arrives.
3. Preserve exactly one SPF TXT record. Merge Cloudflare/provider mechanisms into the existing `v=spf1` policy; never publish a second SPF record.
4. Verify each outbound Domain with its selected provider. Publish the provider-supplied DKIM record at the exact selector. Enter that selector explicitly in Contact Hub; V1 does not guess selectors.
5. Publish one `_dmarc.<domain>` record using the organization's reviewed policy and reporting addresses. Start with the organization's rollout policy; do not silently change enforcement.
6. In Operations, enter any reviewed expected MX/SPF/DKIM/DMARC fragments and run Refresh. Resolver failures must remain Unknown and require external verification, not automatic record changes.
7. Send one inbound and one outbound smoke message per Domain and confirm the expected From, Reply-To, Message-ID, thread headers, and provider acceptance.

Contact Hub performs read-only DNS checks and never mutates Cloudflare DNS.

## 7. Production migration sequence

Only after staging and review:

1. Freeze configuration changes and take a new D1 export.
2. Create/bind the private production `CONTACT_R2` bucket.
3. Add the approved Worker Secrets and exact frontend origins.
4. Deploy the reviewed Worker/frontend revision under human authorization.
5. Authenticate and run the Contact migration once; verify version 7 and re-run to prove idempotency.
6. Verify health/storage before enabling Email Routing rules.
7. Create Provider Configs, Domains, and Mailboxes, then bind Email Routing one Domain at a time.
8. Execute the staging smoke checklist against non-sensitive test recipients.
9. Monitor `failed`, `unknown`, stale `sending`, storage degradation, and DNS Unknown/Missing/Invalid counts. Never auto-retry Unknown.

## 8. Rollback

Code rollback is preferred because Contact migrations 6–7 are additive and Temp Mode ignores the new Contact columns/table. Do not downgrade or delete `sender_date` or `contact_message_side_effects`; preserve D1/R2 and roll code forward after diagnosis if an older Contact build cannot understand schema 7.

1. Stop adding Domains/routing rules and capture health/outbound state. Do not resend Unknown messages.
2. Roll back Worker/frontend code to the previously recorded revision under normal deployment review.
3. Revert or pause the new Email Routing rules if the previous Worker cannot handle Contact addresses. Confirm the intended destination before changing routing.
4. Do not downgrade, drop, or hand-edit Contact tables. Leaving additive Contact tables and private R2 objects in place preserves audit/recovery data.
5. If disabling Contact Mode is necessary, first ensure incoming Contact routes no longer point to a Temp pipeline that could expose or clean long-lived addresses.
6. Restore D1 only for confirmed data corruption, in a coordinated maintenance window. Validate the export in a new recovery database and rebind/swap after review; do not blindly import over a populated database.
7. Keep the matching R2 bucket. D1 restoration and R2 object timestamps/keys must refer to the same recovery point; orphan cleanup is a separate, reviewed operation.
8. Re-run Temp Mode core tests, administrator security checks, and inbound routing smoke tests after rollback.

## 9. Production checklist

- [ ] `contact-hub` branch reviewed
- [ ] Temp Mode regression passed
- [ ] Contact API/browser/Mailpit E2E passed
- [ ] D1 export and disposable restore validated
- [ ] Private R2 bucket created and `CONTACT_R2` bound
- [ ] `ADMIN_PASSWORDS` or verified `ADMIN_USER_ROLE` configured
- [ ] `DISABLE_ADMIN_PASSWORD_CHECK` false
- [ ] `E2E_TEST_MODE` absent/false
- [ ] Exact `CONTACT_ALLOWED_ORIGINS` configured
- [ ] Provider values set only as Worker Secrets
- [ ] Provider Domains verified
- [ ] Email Routing points only reviewed fixed addresses to the Worker
- [ ] MX/SPF/DKIM/DMARC manually verified
- [ ] Contact migration version 7 applied and idempotency verified in staging
- [ ] Inbound/outbound/security smoke tests passed
- [ ] Unknown/rollback procedure rehearsed
