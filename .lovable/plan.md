# MX PATROL WhatsApp Stage 2: authorization and release gate

## Current result: BLOCKED

This plan authorizes preparation only if approved. It does not authorize production commits, deployment, migrations, resuming Cloud, changing secrets or Meta settings, sending messages, or accepting/publishing a draft. No application or function code has been changed during this review.

| Requirement | Evidence from this review | Result |
| --- | --- | --- |
| Cloud readiness | Two `cloud_status` checks report paused, including the final check; generic `project_info` disagrees with `Paused: false`. The repeated lifecycle result is the readiness signal; do not run live writes. | BLOCKED |
| Exact deployed revision | Project metadata returned no worker version, bundle hash or dependency manifest. Official documentation describes View code and last-updated time, not a proven deployed-bundle export. | BLOCKED |
| Production rollback | Repository equivalence does not establish deployed-worker equivalence. The archived 16-file source set remains an unverified production rollback. No new archive comparison was performed in this review. | BLOCKED |
| Current assignments | Local `index.ts:188–190,225–229` trusts cached site selections; `identity.ts:71–73` grants management from metadata when role rows are missing; `identity.ts:187–189` treats empty site scope as unrestricted. | BLOCKED |
| Commit-time authorization | Shared `management-actions.ts:119–133` checks an actor snapshot in a separate read before writes. SOS acknowledgement and patrol completion also write directly. | BLOCKED |
| Isolated validation | No isolated backend or outbound-network suppression was established. Historical 237 passing tests are not current transactional evidence and were not repeated. | BLOCKED |
| Release scope | Chosen-function deployment is documented, but the required atomic correction includes database changes. An all-function history revert is not an acceptable function-only rollback. | BLOCKED |

## 1. Establish readiness and preserve the actual live worker

- Resume Cloud only after separate explicit authorization and resolution of the credit restriction; confirm healthy readiness before live inspection.
- Read the deployed worker's source/version evidence through Cloud's Edge Functions view or an authorized artifact interface. Record the provenance and limitations of every returned identifier.
- Capture every local/imported dependency and deployment configuration; compare exact bytes and hashes with the archived 16-file set. Record added, missing and changed dependencies, including resolved external versions.
- Require an independently restorable worker artifact and a demonstrated chosen-function restoration procedure in isolation. A screenshot of a timestamp or repository commit alone does not prove equivalence.
- If deployed artifact evidence cannot be obtained, keep rollback and release BLOCKED; do not relabel repository source as a production backup.

## 2. Define a fail-closed authorization boundary

- Confirm current schema and assignment semantics read-only when Cloud is ready. Repository migrations are historical evidence, not proof of live schema.
- Use current active number records, linked user/company records and protected role assignments. Remove metadata-derived management privileges; database errors or missing authority deny sensitive operations.
- Preserve company-admin authority within their current company. Supervisors and guards require current site assignments; empty or invalid scope never means unrestricted access for them. Verify whether phone scope restricts admins before implementation.
- Revalidate cached site selections and all-sites mode against current authority for reads, alerts and mutations. Clear stale selections; do not silently broaden scope.
- Inventory every write: management actions, SOS acknowledgements, NFC requests, device commands, incident/evidence writes, patrol transitions, link-code consumption, session changes and inbound claims. Classify internal bookkeeping separately, without assuming it is harmless.

## 3. Prepare atomic mutations in isolation

- Validate caller, number status, company, role, site and target ownership within the transaction that performs each sensitive write.
- Replace direct sensitive writes with narrowly typed database operations. Preserve the existing shared web/WhatsApp business rules and provider transports rather than duplicating them.
- Prevent WhatsApp from declaring a patrol complete solely from a menu tap. Reuse established patrol evidence validation if available; otherwise deny completion until the evidence policy is confirmed. Do not invent scan or duration thresholds.
- Make changes additive and backward-compatible with the currently running worker. Identify every changed shared resource and affected caller before proposing release.

## 4. Validate in a genuinely isolated environment

- Confirm an independent database identity and production-compatible schema/migration history. A draft name alone is not evidence; a draft created while Cloud is paused can share production.
- Block real Meta/Twilio delivery before running any candidate code. Use a non-sending transport and prove no real provider request from webhook, background jobs, retries, media uploads or connected services. Do not rely on invalid credentials.
- Use synthetic records only. Drive two independent database connections with explicit barriers to test revocation during a pending mutation, in both lock orderings.
- Cover number deactivation, last-role removal despite legacy metadata, company change, site revocation/deletion, stale single/all-sites selection, cross-tenant targets, platform-owner revocation and missing/erroring authority reads.
- Verify duplicate delivery produces one claim and one sensitive mutation; test retry after failure, committed result replay, rollback and deadlock/retry behavior.
- Verify all bypass paths, including completion without evidence, are denied without changing targets. Read successful results back through the candidate flow without sending real messages.

## 5. Return an evidence-based release decision

- Report PASS/BLOCKED per gate with artifact fingerprints, current test evidence and the exact changed-resource list.
- Separate the database migration/rollback review from the chosen-function deployment request. Confirm unrelated functions remain unchanged with before/after hashes in isolation.
- Do not use project History revert as proof of function-only rollback: official documentation says it redeploys changed functions and does not restore database data.
- Request production approval only after provenance, rollback, atomic authorization, staging isolation and scope gates pass. Approval of this plan is not release approval.

## Technical design constraints

- Candidate RPCs live in `public`, accept validated operation-specific parameters and a server-authenticated actor reference, not client-supplied `canManage`, role or company authority. WhatsApp privileged RPC execution must not be exposed to `anon` or ordinary authenticated callers.
- SECURITY DEFINER functions need a fixed search path, schema-qualified objects and explicit EXECUTE revocations/grants. Any new public tables require grants, RLS and policies in the prescribed order. Apply no migrations in this production-bound workspace during preparation.
- Row locks on existing role rows alone are insufficient: absent roles, additions and assignment changes can escape that protocol. Define a stable actor/tenant synchronization anchor and make **every relevant authorization-changing path** participate, including direct database changes through appropriate app-table enforcement. Lock targets and authorization anchors in deterministic order and reread current authority after obtaining them.
- Test a precise ordering guarantee: if revocation commits first, mutation is denied; if the authorized mutation holds the common lock first, revocation waits and commits afterward. Do not promise cancellation of a mutation that already committed before revocation.
- Store claim/idempotency results with the mutation when needed so a crash cannot turn a retry into a duplicate write. Preserve the existing company/message unique key and distinguish transport delivery state from mutation success.
- Editing function code here can trigger automatic Cloud deployment. Prepare executable changes only in a verified isolated checkout/backend after explicit authorization, not in this production-bound workspace.

## Official references

- [Edge Functions](https://docs.lovable.dev/features/edge-functions)
- [Database pause and resume](https://docs.lovable.dev/features/database-pause-remove)
- [Drafts and live connected services](https://docs.lovable.dev/features/drafts)
- [Version history](https://docs.lovable.dev/features/projects/history)