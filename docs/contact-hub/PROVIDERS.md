# Contact Hub Provider Configuration

Contact outbound delivery is implemented under `worker/src/contact/providers/` and uses the Provider Config explicitly assigned to each Domain. It never discovers a Contact provider from global `RESEND_TOKEN`, `SMTP_CONFIG`, or `SEND_MAIL` settings, and it never falls back to a second provider after a failure.

## Secret references

D1 stores references only. A reference must match `^CONTACT_[A-Z0-9_]{1,96}$`; the referenced value is supplied as a Worker Secret at runtime.

Examples:

- Resend: `CONTACT_RESEND_MAIN_API_KEY`
- Brevo: `CONTACT_BREVO_MAIN_API_KEY`
- SMTP: `CONTACT_SMTP_MAIN_PASSWORD`

The Provider Config API returns only a `configured` boolean for each expected secret. It does not return the reference or its value. Add production values manually with the Cloudflare secret-management workflow; do not put them in Wrangler files or D1.

## Provider config shapes

Resend and Brevo have no non-secret V1 configuration. Their `secret_refs` object must contain `apiKey`.

SMTP stores `host`, `port`, `secure`, `starttls`, and an optional `username`. If a username is present, `secret_refs.password` is required. An SMTP server without authentication, such as the E2E Mailpit service, needs no secret reference.

## Delivery result contract

Adapters return `accepted`, `rejected`, or `unknown` certainty plus retry guidance, a provider message id when available, and a sanitized error class/code/message. HTTP 2xx and a completed SMTP DATA exchange are accepted; explicit HTTP/SMTP rejection is rejected; timeout or connection loss after submission may have begun is unknown.

The HTTP tests use injected local mocks and the SMTP E2E test targets Mailpit. No test uses a real Resend, Brevo, or SMTP credential.

## RC management and timeout behavior

The Provider UI supports create, edit, disable, and re-enable. SMTP name/host/port/secure/starttls/username can be edited without re-entering a Secret Reference; an empty Secret Reference on edit means “keep the existing reference.” API/UI surfaces expose only configured booleans plus Domain usage counts, never Secret Reference names or Secret values. A Provider assigned to a Domain cannot be disabled.

Resend and Brevo use `AbortController` with `CONTACT_PROVIDER_HTTP_TIMEOUT_MS` (default 15000 ms; valid 1000–60000 ms). A timeout is reported as `certainty=unknown`, `retryable=false`, `errorClass=network_timeout`, `errorCode=PROVIDER_TIMEOUT`. It is never automatically retried and never causes provider fallback.
