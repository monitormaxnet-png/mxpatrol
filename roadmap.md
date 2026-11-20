# WhatsApp Meta migration
- [x] Implement signed Meta webhook and interactive replies while preserving Twilio until configuration.
- [x] Generate tenant-scoped PDFs and deliver private media attachments.
- [x] Test verification, menus, permissions, PDF delivery and failure handling: 75 tests passed; both services checked.
- [x] Deploy WhatsApp functions; live checks reject invalid verification and unauthenticated sends without writing records.
- [ ] Collect Meta configuration securely: user declined the secret form; four settings remain missing.
- [ ] Verify real-number PDF retrieval and delivered/read callbacks: blocked by missing Meta settings. No production test records or web publishing.

# WhatsApp Stage 2 release verification
- [x] Review supplied security audit and current local authorization paths without changing application code.
- [x] Check Cloud readiness and documented provenance, rollback and draft limitations; prepare an approval-gated correction plan.
- [ ] Establish healthy authorized Cloud access: lifecycle status reports paused; requires explicit resume authorization and credit resolution.
- [ ] Prove deployed artifact equivalence and independent restoration: deployed bundle/version evidence unavailable.
- [ ] Prepare atomic authorization corrections in verified isolation: requires approval of the plan and an isolated environment with provider egress suppressed.
- [ ] Run isolated transactional authorization/concurrency tests and validate exact resource scope: blocked by the preceding isolation and correction gates.
- [ ] Production release: requires all gates passing and separate explicit release-owner approval; no release approved.