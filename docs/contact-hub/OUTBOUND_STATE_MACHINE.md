# Contact Hub Outbound State Machine

## States

```text
pending --atomic claim--> sending --accepted--------> sent
                               |--explicit rejection-> failed
                               `--uncertain outcome--> unknown

failed  --manual retry + atomic claim---------------> sending
unknown --force resend creates a new pending record-> pending (new id)
```

There is no automatic provider fallback and no automatic resend from `unknown`.

## Creation and idempotency

Every Send/Reply request requires `Idempotency-Key`. The API validates the request, inserts a `pending` outbound row under a unique constraint, and returns the existing row if the same key races or is submitted twice. A duplicate key never invokes a provider twice.

The local Message-ID is generated once at creation as `<uuid@normalized-domain>`. Reply requests derive:

- `To`: original `Reply-To`, otherwise original From.
- `From`: an enabled, outbound-enabled mailbox in the same Contact Domain.
- `Subject`: a single `Re:` prefix.
- `In-Reply-To`: original Message-ID.
- `References`: original References plus original Message-ID, deduplicated.

All address, subject, and header inputs reject CR/LF characters.

## Atomic claim

Only a Worker that changes the expected state to `sending` may call the provider. The claim is a compare-and-set update scoped to the outbound id and current state. The updated-row count/returned row is authoritative; losing workers return the current resource without sending.

Normal sends claim `pending`. Manual Retry claims `failed`. `unknown` is never claimable. A stale `sending` record is reconciled to `unknown` because provider acceptance may already have occurred.

## Attempts

After a successful claim and before network delivery, the Worker appends an attempt with a monotonically increasing `attempt_no`, chosen Provider Config, provider type, and a sanitized configuration snapshot. Secret values and authorization headers are prohibited.

The attempt and parent row record:

- Provider and Provider Config id.
- Accepted/rejected/unknown certainty.
- Provider Message ID when supplied.
- Retryability guidance.
- Classified error and sanitized message.
- Start/finish timestamps.

## Result mapping

| Observation | Certainty | Parent state | Retryable |
| --- | --- | --- | --- |
| HTTP explicit 2xx / SMTP DATA explicit 2xx | accepted | sent | false |
| Validation/configuration/auth failure before submission | rejected | failed | depends on correction |
| HTTP explicit 4xx | rejected | failed | 429 may be true |
| HTTP explicit 5xx response | rejected | failed | true |
| SMTP explicit 4xx/5xx | rejected | failed | 4xx usually true |
| Timeout/reset after request or DATA may have been submitted | unknown | unknown | false (no normal retry) |
| Malformed response without reliable acceptance evidence | unknown | unknown | false |

Required error classes: `validation`, `configuration`, `authentication`, `rate_limit`, `provider_rejected`, `provider_server_error`, `network`, `network_timeout`, `unknown_response`, `storage`.

## Retry rules

Failed Retry reuses the same outbound intent and appends another attempt. The administrator may explicitly choose another provider config; the selected attempt provider is recorded. It still requires an atomic `failed -> sending` claim.

Unknown has no Retry operation. Force Resend requires an explicit confirmation and new idempotency key. It creates a new outbound row with a new Message-ID and `force_resend_of_id` pointing to the unknown row. The original remains `unknown` permanently unless future delivery-status evidence is explicitly reconciled; V1 does not infer success.

## Failure during local persistence

If the initial outbound intent cannot be stored, no provider is called. If attempt creation or claim persistence cannot be made reliable, no provider is called. If storing a provider result fails after submission, the outcome is treated as operationally unknown and surfaced for manual reconciliation; the system must not silently send again.
