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

V1 started from `f92b059aac0d89e2c106601b6857dce9dcae07d3`; local `main`, `origin/main`, and `upstream/main` all pointed to that commit when implementation began. The first reviewed post-V1 synchronization advanced all three locally recorded mirror refs to `70206c61efa723ef24143eca1d27449ce98a6e0c` (`feat: add single-mail read status (#1125)`) and merged that history through `codex/contact-hub-upstream-integration`. No push, force-push, deployment, production mutation, or production Secret access was performed.

## Completed synchronization: mail read status

The `f92b059..70206c6` upstream range added single-mail read status, a migration, API/browser coverage, and frontend state/rendering changes. Conflict resolution preserved these mode boundaries:

- Temp Mode exposes and uses upstream `enableMailReadStatus` normally.
- Contact Mode returns `enableMailReadStatus=false` because public mailbox surfaces are disabled and Contact read state remains under authenticated `/admin/contact/*` APIs.
- The Email Worker dispatches Contact ingestion before Legacy `storeRawMail`; Temp Mode uses the upstream raw-mail storage helper unchanged.
- Contact changelog entries and upstream read-status entries are both retained.
- The complete fresh-volume Compose suite passed 196/196, followed by Worker 41/41/lint/build, Frontend 67/67/build, Compose config, LF, and whitespace gates.

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
| `worker/src/types.d.ts` | bindings and variables | `CONTACT_R2`, mode/origin/DNS variables, dynamic Secret resolution |
| `worker/src/common.ts` | address cleanup and helpers | Contact-owned fixed addresses are never deleted |
| `worker/src/scheduled.ts` | scheduled cleanup | Contact Mailboxes/messages/outbound history remain outside Legacy retention |
| `worker/src/admin_api/address.ts` and admin cleanup APIs | direct deletion/custom SQL | ownership protection and Contact custom-SQL denial remain authoritative |
| `worker/src/mails_api/send_mail_api.ts` | Legacy provider order | Temp selection/order is unchanged; Contact never enters this implicit router |
| `worker/src/mail_providers/` | extracted shared adapters | provider result classification remains accepted/rejected/unknown |
| `worker/src/admin_api/index.ts` | route mount/test helpers | Contact routes stay authenticated; E2E seed remains `E2E_TEST_MODE`-guarded |
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
- `worker/src/mail_providers/`
- `frontend/src/views/contact/`
- `frontend/src/components/contact/`
- `frontend/src/api/contact.js`
- `frontend/src/store/contact.js`
- `docs/contact-hub/`

Keep upstream files as thin mounts, gates, and adapters. Do not rename legacy `commom_api.ts` or reorganize upstream directories solely for style.

## Sync validation checklist

- [ ] `CONTACT_MAIL_MODE=false` Temp core API/UI tests pass
- [ ] Contact public capability matrix still returns 403
- [ ] Contact administrator auth/security health passes
- [ ] Contact migrations remain independent from upstream DB version and idempotent
- [ ] MIME is parsed once and list endpoints remain metadata-only
- [ ] R2 objects/keys and attachment downloads remain private
- [ ] explicit per-Domain Provider selection cannot be overridden by Legacy globals
- [ ] idempotency/CAS tests and Unknown no-retry tests pass
- [ ] HTML/remote-image/CORS/filename browser tests pass
- [ ] Legacy cleanup cannot remove Contact fixed addresses/data
- [ ] no new Secret serialization/logging path exists

General-purpose sanitizer, safe attachment, provider adapter, reliable insert-id, and stop-side-effects fixes may be proposed upstream as small independent commits. Contact product policy and schema should remain on `contact-hub`.
