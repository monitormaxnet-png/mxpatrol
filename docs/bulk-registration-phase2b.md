# Bulk Registration Phase 2B: deployment gate

Status: local review only. No migration, Edge Function, or test records have been deployed.
Confirm the migration, audit, and import service are committed before release. The Edge
handler is in `supabase/functions/management-actions/index.ts`, which delegates
to `supabase/functions/_shared/bulk-registration.ts`; it is not in the shared
`runManagementAction` dispatcher.

## Read-only production preflight

Run `supabase/audits/20261104_bulk_registration_preflight.sql` with a database account
authorized to see all tenant rows. Save the six result sets in an access-controlled
location; they contain customer identifiers. The script does not modify data.

1. Confirm every required schema column is present in the first result set.
2. Review duplicate groups for global device serial and company code; company-scoped
   NFC UID, guard employee number, and site code. The script includes IDs, company
   and site context, stored value, and normalized value. It predicts the migration's
   code and unique-badge backfills when those columns do not yet exist. NFC UID
   normalization now removes whitespace, colons, dots, and hyphens and lowercases
   the result, matching scanner reads. Rerun this updated preflight even if the
   earlier uppercase/trim-only audit found no duplicates.
3. Review null, blank, and malformed identifiers. Historical blanks are retained;
   the new partial indexes exclude them. Decide whether malformed codes require
   manual correction before onboarding, without silently rewriting customer data.
4. Compare existing index definitions with the migration. An index with the same
   name but different definition must be investigated; `IF NOT EXISTS` will not
   replace it.
5. Check schema drift and earlier migration status before applying this migration.
   A zero-row duplicate result is necessary but not sufficient for deployment.
6. Review owner accounts lacking a profile and any existing guards assigned to a
   site in another company. The new job FK requires a profile; the bulk write path
   resolves sites inside the target company, but existing inconsistent assignments
   require separate review.

Do not apply the migration if any normalized duplicate group would violate a new
unique index. Resolve such cases only through an approved, separately reviewed plan.
The new job user FK points to `public.profiles(id)`, not directly to `auth.users`.
Service-role-only claim/complete RPCs require the stored user, company context,
owner flag, and claim token; the Edge handler resolves those values from the
authenticated user. Unique indexes prevent duplicate inserts after a worker lease
expires, but exact retry behavior still requires the staging test below.

## Staging end-to-end test

Use a disposable company in a development/staging Supabase project with the same
schema. Apply the migration and deploy `management-actions` there only after approval.

1. Owner previews and registers one company, then one site. Re-preview shows both
   as existing; confirm IDs are stable.
2. Register one device, one checkpoint, one guard, and one WhatsApp number. Confirm
   device is unpaired, guard inactive, WhatsApp number pending, and all foreign keys
   point to the intended company/site. Existing device pairing must remain unchanged.
3. Test identical and case/whitespace-varied identifiers. Preview must report an
   existing/conflicting row consistently with the unique index; repeat commit must
   not insert duplicates. For NFC, verify `04:A1:B2`, `04-a1.b2`, and `04a1b2`
   resolve to one company-scoped UID, and a physical scan of an imported checkpoint
   finds that checkpoint.
4. As Company A admin, preview and commit rows referencing Company B. Both must be
   denied, and Company B row counts must not change. A non-management user must be
   denied before a job is created.
5. Import 41+ rows and verify 40-row batch progression, result counts, and final
   status. Simulate an insert failure in one batch, then retry; earlier successful
   records must not be duplicated, dependent rows must not be orphaned, and failed
   rows must remain visible in the result/error report.
6. Verify management menu numbering and that User Assistant cannot create records.

Record test job IDs and remove only the disposable staging records after verification.
Do not create test data in production without explicit authorization.

## Release sequence (approval required)

1. Run read-only preflight against production and review all result sets.
2. Run the staging test above and obtain a production migration/deploy approval.
3. Back up production; apply `20261103120000_bulk_registration_phase2.sql` via the
   project's normal Supabase migration workflow (for a linked CLI project,
   `npx supabase db push`). Do not paste individual statements out of order.
   Schedule a maintenance window if the preflight shows large tables: the backfill
   and ordinary unique-index builds can hold locks while the migration runs.
4. Deploy `management-actions` (`npx supabase functions deploy management-actions`).
5. Deploy the web app through the existing GitHub/Netlify pipeline and smoke-test
   preview with a disposable, explicitly authorized test scope.

`npx supabase db push` may apply other pending migrations too: inspect the migration
plan before confirming. None of these commands should run during the Phase 2B audit.
