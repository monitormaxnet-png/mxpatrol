# WhatsApp Meta migration
- [x] Implement signed Meta webhook and interactive replies while preserving Twilio until configuration.
- [x] Generate tenant-scoped PDFs and deliver private media attachments.
- [x] Test verification, menus, permissions, PDF delivery and failure handling: 75 tests passed; both services checked.
- [x] Deploy WhatsApp functions; live checks reject invalid verification and unauthenticated sends without writing records.
- [ ] Collect Meta configuration securely: user declined the secret form; four settings remain missing.
- [ ] Verify real-number PDF retrieval and delivered/read callbacks: blocked by missing Meta settings. No production test records or web publishing.