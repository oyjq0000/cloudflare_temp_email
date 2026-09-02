# Contact Hub V1 Schema

## Migration track

Contact Hub owns `contact_schema_migrations` and never changes the upstream `DB_VERSION` value or migration semantics.

```sql
CREATE TABLE contact_schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at DATETIME NOT NULL
);
```

Migrations execute in numeric order, skip recorded versions, and record a version only after all statements for it succeed. They are safe on both an empty database and the current upstream v0.0.7 schema. Implemented V1 groups are:

1. Domain, Mailbox, and Provider Config.
2. Inbound Message and Attachment indexes.
3. Explicit inbound body-truncation signal.
4. Outbound Message and Attempt state.
5. DNS check cache.
6. Trusted receive time (`sender_date` backfill while `received_at` becomes server/created time for legacy rows).
7. Durable persisted-message side-effect observability.

The runner is idempotent and must not drop or rewrite `raw_mails`, `address`, `sendbox`, `settings`, or upstream version data.

Implemented migration versions:

| Version | Name | Tables/indexes |
| --- | --- | --- |
| 1 | `contact_domain_mailbox_provider_core` | `contact_domains`, `contact_mailboxes`, `contact_provider_configs`, their lookup indexes, and the one-default-Mailbox partial unique index |
| 2 | `contact_inbound_message_storage` | `contact_messages`, `contact_attachments`, dedupe/Legacy links, inbox indexes, and per-object storage state |
| 3 | `contact_inbound_truncation_signal` | Explicit `contact_messages.content_truncated` signal for bounded D1 body indexing |
| 4 | `contact_outbound_state_machine` | `contact_outbound_messages`, append-only `contact_outbound_attempts`, status/idempotency constraints, and lookup indexes |
| 5 | `contact_dns_check_cache` | `contact_dns_checks` plus Domain/purpose/cache lookup indexes |
| 6 | `contact_trusted_receive_time` | Adds nullable `contact_messages.sender_date`; backfills it from the old `received_at`, then backfills trusted `received_at` from `created_at` without deleting old sender-declared time |
| 7 | `contact_message_side_effect_tracking` | Adds `contact_message_side_effects`, unique `(message_id,effect)`, status/attempt/error metadata, and status/message indexes |

Provider Config CRUD and Domain assignment are implemented on the version 1 tables. API serialization exposes non-secret configuration and per-secret configured booleans, never `secret_refs_json` or resolved values.

The authenticated endpoints are `GET /admin/contact/db/version` and `POST /admin/contact/db/migrate`. Running the latter repeatedly is a no-op after the current target has been recorded.

## Core entities

### `contact_domains`

Stores normalized lower-case domains without a trailing dot, display metadata, inbound enablement, and explicit defaults. `domain` is unique. `default_mailbox_id` and `default_provider_config_id` are nullable references established after the referenced rows exist. Domains with business history are soft-disabled rather than physically deleted.

Required columns: `id`, `domain`, `name`, `enabled`, `inbound_enabled`, `importance`, `default_from_name`, `default_mailbox_id`, `default_provider_config_id`, `created_at`, `updated_at`.

### `contact_mailboxes`

Represents a fixed address belonging to exactly one Contact Domain. `address` is unique and derived from normalized `local_part` plus the parent domain. Creating a mailbox ensures a compatible row exists in upstream `address`; the upstream row id is stored as `address_id`.

Required columns: `id`, `domain_id`, `address_id`, `local_part`, `address`, `display_name`, `enabled`, `inbound_enabled`, `outbound_enabled`, `is_default`, `created_at`, `updated_at`.

Invariants:

- A mailbox address cannot cross its parent domain.
- A domain has at most one default mailbox.
- Contact-owned upstream addresses are protected from legacy delete and cleanup.
- A default Mailbox must belong to the Domain, be `enabled=1`, have `outbound_enabled=1`, agree with `contact_domains.default_mailbox_id`, and be the only `is_default=1` Mailbox for that Domain. A current default cannot be disabled or have outbound delivery disabled until another usable Mailbox is selected. Default switching updates both Mailbox flags and Domain pointer in one D1 batch.
- Disabling does not delete messages or outbound history.

### `contact_provider_configs`

Stores provider type, non-sensitive configuration JSON, and secret-reference JSON. V1 provider types are `resend`, `brevo`, and `smtp`. Secret reference values must match `^CONTACT_[A-Z0-9_]{1,96}$`; secret values are never stored.

Required columns: `id`, `name`, `provider_type`, `enabled`, `config_json`, `secret_refs_json`, `created_at`, `updated_at`.

## Inbound entities

### `contact_messages`

One indexed Contact record maps to one legacy raw row via unique `raw_mail_id`. `dedupe_key` is independently unique for concurrent redelivery protection. Body fields are returned only by detail APIs.

Required columns: `id`, `raw_mail_id`, `domain_id`, `mailbox_id`, `envelope_from`, `from_name`, `from_address`, `reply_to_address`, `to_address`, `cc_json`, `headers_json`, `subject`, `preview`, `text_body`, `html_body`, `message_id_header`, `in_reply_to_header`, `references_json`, `dedupe_key`, `folder`, `is_read`, `spam_reason`, `has_attachments`, `raw_storage_key`, `storage_status`, `parse_status`, `parse_error`, `content_truncated`, `sender_date`, `received_at`, `created_at`, `updated_at`.

Allowed folders are `inbox` and `spam`. Suggested indexes:

- `(domain_id, folder, received_at DESC, id DESC)`
- `(mailbox_id, folder, received_at DESC, id DESC)`
- `(folder, is_read, received_at DESC, id DESC)`
- `from_address`, `to_address`, `subject`
- unique `dedupe_key`, unique `raw_mail_id`

`received_at` is trusted Worker receive time and drives Inbox sort/cursor/date filtering/statistics. `sender_date` is only the parsed sender-declared MIME Date and may be null. `storage_status` is `pending`, `stored`, `fallback`, or `degraded`. `fallback` means the private R2 binding is absent but the bounded D1 raw MIME is available; `degraded` means at least one object write failed or that raw fallback is incomplete. `parse_status=failed` retains raw/fallback data without running mail side effects. `content_truncated=1` makes the 512k-character D1 body indexing cap visible.


### `contact_message_side_effects`

Tracks the six post-persist effects for each newly stored message: `forward`, `ai_extract`, `telegram`, `webhook`, `another_worker`, and `auto_reply`. Status is `pending`, `running`, `succeeded`, `failed`, or `skipped`. No message/effect pair is created twice, and V1 does not automatically retry failed effects.

Required columns: `id`, `message_id`, `effect`, `status`, `attempt_count`, `last_error_code`, `last_error_class`, `last_attempt_at`, `created_at`, `updated_at`. Error fields contain classified metadata only, never message content or credentials.

Spam and parse-failed messages create `skipped` rows. Normal persisted mail starts with `pending` rows and each effect updates independently around its invocation. Duplicate inbound deliveries return before side effects are rerun.

### `contact_attachments`

Stores metadata and server-generated R2 keys, never user-controlled paths or bytes in D1.

Required columns: `id`, `message_id`, `filename`, `mime_type`, `disposition`, `content_id`, `size`, `sha256`, `storage_key`, `storage_status`, `created_at`.

Object keys follow `contact/messages/<server-id>/attachments/<server-id>`. Raw messages use `contact/messages/<server-id>/raw.eml`.

## Outbound entities

### `contact_outbound_messages` (implemented)

Stores the user intent and current delivery state. `idempotency_key` is unique. Status is one of `pending`, `sending`, `sent`, `failed`, or `unknown`; delivery certainty is `accepted`, `rejected`, or `unknown` when available.

Required columns: `id`, `domain_id`, `mailbox_id`, `reply_to_message_id`, `force_resend_of_id`, `from_name`, `from_address`, `to_name`, `to_address`, `subject`, `text_body`, `html_body`, `message_id_header`, `in_reply_to_header`, `references_json`, `provider_config_id`, `provider_message_id`, `status`, `delivery_certainty`, `idempotency_key`, `last_error_class`, `last_error_code`, `last_error_message`, `created_at`, `sending_at`, `sent_at`, `updated_at`.

### `contact_outbound_attempts` (implemented)

Append-only audit records for each provider invocation. The config snapshot contains provider type and non-secret configuration only.

Required columns: `id`, `outbound_message_id`, `attempt_no`, `provider_config_id`, `provider_type`, `config_snapshot_json`, `status`, `certainty`, `provider_message_id`, `retryable`, `error_class`, `error_code`, `error_message`, `started_at`, `finished_at`.

`(outbound_message_id, attempt_no)` is unique.

## DNS cache

### `contact_dns_checks` (implemented)

Stores read-only observed/expected records by purpose (`mx`, `spf`, `dkim`, `dmarc`). Status is `valid`, `missing`, `invalid`, or `unknown`. Network/parse failures are `unknown`, not `invalid`.

Required columns: `id`, `domain_id`, `provider_config_id`, `record_purpose`, `record_type`, `record_name`, `expected_json`, `observed_json`, `status`, `checked_at`.

## Deletion and retention

V1 uses disablement for Domain/Mailbox removal once referenced. Messages, attempts, and DNS history do not cascade from an administrative disable. Attachment objects are accessed only through authenticated ownership checks. Any future hard-delete/retention feature is outside V1 and must be designed with D1/R2 consistency guarantees.
