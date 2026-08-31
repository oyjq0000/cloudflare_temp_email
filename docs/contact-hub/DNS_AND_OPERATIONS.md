# Contact DNS and Operations

Contact Hub performs read-only DNS checks through DNS-over-HTTPS. It never calls a DNS mutation API and never deploys Cloudflare resources.

## DNS status

`POST /admin/contact/domains/:id/dns/refresh` requires an explicit `dkim_selector` and accepts optional expected record fragments for MX, SPF, DKIM, and DMARC. Results are stored in `contact_dns_checks`; `GET /admin/contact/domains/:id/dns` returns the latest cached value for each purpose.

- `valid`: a record exists and satisfies its configured requirement.
- `missing`: the query succeeded but the required record does not exist.
- `invalid`: records exist but conflict with the requirement. Multiple `v=spf1` records are always invalid and must be merged; Contact Hub does not propose a second SPF record.
- `unknown`: transport, resolver, or response parsing failed. Unknown is never reported as Invalid.

DKIM checks query the explicit `<selector>._domainkey.<domain>` name as TXT and CNAME. No selector guessing is implemented. `CONTACT_DNS_CACHE_TTL_SECONDS` controls the stale marker and defaults to one hour.

## Operational safety

`GET /admin/contact/health` reports migration, D1, private storage, administrator security, message/outbound counts, stale sending count, and latest DNS status totals. It contains neither Secret References nor Secret values.

`POST /admin/contact/operations/reconcile-stale` changes an outbound record that has remained `sending` past the chosen 5–1440 minute window to `unknown`. Its open attempt is also closed as `unknown`. This action never invokes a Provider and never automatically retries the message.

Browser requests to `/admin/contact/*` are same-origin unless their exact origin is listed in `CONTACT_ALLOWED_ORIGINS`. Wildcards and origins containing paths or credentials are rejected. Preflight allows only the authentication, idempotency, language, content-type, and fingerprint headers actually sent by the frontend; it does not reflect arbitrary requested headers. Legacy API CORS behavior is unchanged.

Provider diagnostics stored in D1 are classified and generic. Arbitrary provider bodies, exception messages, Secret References, authorization headers, and Secret values are not logged or persisted.
