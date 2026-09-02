# Contact Hub Upstream Synchronization Guide

## Branch model

```text
dreamhunter2333/main (upstream)
             |
             v reviewed fast-forward
oyjq0000/main (upstream mirror, no Contact product commits)
             |
             v reviewed merge/rebase decision
oyjq0000/contact-hub (long-lived product branch)
```

V1 originally started from `f92b059...`. The RC hardening session re-fetched the remote and used `origin/main=70206c61efa723ef24143eca1d27449ce98a6e0c`, `origin/contact-hub=a4902cdd190ea1752de01370a9593562e0a45d58`, and merge-base `70206c61efa723ef24143eca1d27449ce98a6e0c` as the real baseline. RC work is isolated on `fix/contact-hub-rc-hardening`; it does not rewrite `contact-hub` or `main` history.

## Completed synchronization: mail read status

The `f92b059..70206c6` upstream range added single-mail read status, a migration, API/browser coverage, and frontend state/rendering changes. Conflict resolution preserved these mode boundaries:

- Temp Mode exposes and uses upstream `enableMailReadStatus` normally.
- Contact Mode returns `enableMailReadStatus=false` because public mailbox surfaces are disabled and Contact read state remains under authenticated `/admin/contact/*` APIs.
- The Email Worker dispatches Contact ingestion before Legacy `storeRawMail`; Temp Mode uses the upstream raw-mail storage helper unchanged.
- Contact changelog entries and upstream read-status entries are both retained.
- Historical pre-RC evidence: the earlier fresh-volume suite passed 196/196 with Worker 41/41 and Frontend 67/67. Those counts are superseded for RC acceptance by `RC_HARDENING_REPORT.md`.

During the full-topology run, LF shell enforcement, a Contact-specific frontend proxy/exact local Origin, and latest-request-wins Inbox loading were added. These are integration hardening changes, not production Cloudflare configuration.

## Human-reviewed sync procedure

1. Ensure the working tree is clean and record the current `contact-hub` HEAD.
2. Fetch `upstream` and inspect its signed/reviewed history. Do not execute fetched code before review.
3. Fast-forward the local mirror `main` only when it contains no product-only commits.
4. Review the upstream range for schema, configuration, MIME, auth, cleanup, CORS, provider, and frontend changes.
5. Create a temporary integration branch from `contact-hub` and merge the updated `main` there. Resolve conflicts by preserving both Temp compatibility and Contact privacy invariants.
6. Run all Worker/frontend/Temp/Contact/browser/Mailpit gates before advancing `contact-hub`.
7. Push or deploy only as a separate human-authorized action. Never make upstream sync an automatic production merge.

Example commands are intentionally non-destructive and must be run only after review:

```text
git status --short
git fetch upstream
git log --oneline --left-right main...upstream/main
git switch main
git merge --ff-only upstream/main
git switch -c codex/contact-hub-upstream-integration contact-hub
git merge --no-ff main
```

Do not use `reset --hard`, `clean`, force-push, or automatic conflict resolution.

## Conflict hotspots

| File/area | Why it is hot | Contact invariant to preserve |
| --- | --- | --- |
| `worker/src/worker.ts` | middleware and route ordering | Contact public gates run before Legacy handlers; Contact CORS remains scoped |
| `worker/src/email/index.ts` | Email Worker entry pipeline | mode dispatch; Contact fixed-recipient lookup; stop side effects after D1 failure |
| `worker/src/commom_api.ts` | public settings | capability booleans only; never expose Contact Domains/Mailboxes/Providers |
| `worker/src/types.d.ts` | bindings and variables | `CONTACT_R2`, mode/origin/DNS variables, Contact Admin Session TTL, Provider HTTP timeout, dynamic Secret resolution |
| `worker/src/common.ts` | address cleanup and helpers | Contact-owned fixed addresses are never deleted |
| `worker/src/scheduled.ts` | scheduled cleanup | Contact Mailboxes/messages/outbound history remain outside Legacy retention |
| `worker/src/admin_api/address.ts` and admin cleanup APIs | direct deletion/custom SQL | ownership protection and Contact custom-SQL denial remain authoritative |
| `worker/src/mails_api/send_mail_api.ts` | Legacy provider order | Temp selection/order is unchanged; Contact never enters this implicit router |
| `worker/src/mail_providers/` | Legacy/shared upstream adapters only | Temp provider behavior remains upstream-owned; Contact adapters live in `worker/src/contact/providers/` |
| `worker/src/admin_api/index.ts` | route mount/test helpers | Contact routes stay authenticated by scoped Contact session or `ADMIN_USER_ROLE`; E2E helpers remain `E2E_TEST_MODE`-guarded |
| `frontend/src/App.vue` | mode-aware shell | Contact has no Temp marketing/public mailbox/footer surfaces |
| `frontend/src/router/index.js` | redirect and access routing | Contact `/` and public user routes cannot expose Temp UI |
| `frontend/src/store/index.js` | persisted auth/mode state | mode transitions do not leak stale public state |
| `frontend/src/views/Header.vue` | navigation | Contact hides public/Temp navigation |
| `frontend/src/views/Admin.vue` | Advanced Admin compatibility | existing Admin remains reachable after verified Contact login |
| `frontend/src/api/index.js` | request/auth headers | Contact preflight exact header list stays synchronized |

Upstream may add new public endpoints. Every sync must enumerate `/api/*`, `/external/*`, `/telegram/*`, `/user_api/*`, and `/open_api/*` changes and decide whether each capability is permitted in Contact Mode. Frontend hiding is never sufficient evidence.

## Low-conflict ownership boundaries

Prefer implementing Contact business behavior under:

- `worker/src/contact/`
- `worker/src/contact/providers/` (Contact provider contracts/adapters/registry/Secret Resolver)
- `worker/src/mail_providers/` only where shared Legacy Temp adapters remain upstream-owned
- `frontend/src/views/contact/`
- `frontend/src/components/contact/`
- `frontend/src/api/contact.js`
- `frontend/src/store/contact.js`
- `docs/contact-hub/`

Keep upstream files as thin mounts, gates, and adapters. Do not rename legacy `commom_api.ts` or reorganize upstream directories solely for style.

## Sync validation checklist

- [ ] `CONTACT_MAIL_MODE=false` Temp core API/UI tests pass
- [ ] Contact public capability matrix still returns 403
- [ ] Contact Admin Session scope/expiry/storage isolation and administrator security health pass
- [ ] Contact schema target 7 remains independent from upstream DB version; v5→v7 backfill and repeated migration are idempotent
- [ ] MIME is parsed once and list endpoints remain metadata-only
- [ ] R2 objects/keys and attachment downloads remain private
- [ ] explicit per-Domain Provider selection cannot be overridden by Legacy globals
- [ ] idempotency/CAS tests and Unknown no-retry tests pass
- [ ] HTML/remote-image/CORS/filename browser tests pass
- [ ] Legacy cleanup cannot remove Contact fixed addresses/data
- [ ] no new Secret serialization/logging path exists

General-purpose sanitizer, safe attachment, provider adapter, reliable insert-id, and stop-side-effects fixes may be proposed upstream as small independent commits. Contact product policy and schema should remain on `contact-hub`.
