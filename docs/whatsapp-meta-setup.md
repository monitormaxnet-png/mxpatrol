# Direct Meta WhatsApp report delivery

Twilio remains configured until all Meta settings exist. No web release or registration migration is part of this change.

## Secure settings
- `WHATSAPP_PHONE_NUMBER_ID`: Meta App Dashboard → WhatsApp → API Setup → Phone number ID.
- `WHATSAPP_ACCESS_TOKEN`: long-lived system-user token for the registered business number, with `whatsapp_business_messaging` permission.
- `WHATSAPP_APP_SECRET`: Meta App Dashboard → App Settings → Basic → App Secret. Required to verify POST signatures.
- `WHATSAPP_WEBHOOK_VERIFY_TOKEN`: generate in the secure form and copy to the webhook Verify token field.

The callback is the existing `whatsapp-webhook` function URL. Subscribe the Meta app to the business account and the `messages` webhook field. The app handles verification GETs, signed text/button/list messages, and status callbacks.

## Flow
An active authorized number sends Reports, chooses a category, chooses Generate PDF, chooses an authorized site and Today / Yesterday / Last 7 Days. The service reads company/site-scoped records, generates a native PDF without AI, uploads it privately to Meta, and sends a document by media ID. Accepted uploads remain available during Meta's asynchronous delivery/retention; failed sends attempt immediate media cleanup.

PDF categories: checkpoint scans, device scans, canonical patrol-session reports, SOS, incidents and datalogs. Management can also request scan investigations. No public report storage bucket or signed URL is created. Requests over the safety threshold are rejected rather than silently truncated. Incident PDFs include operational incident rows; attached photos/audio are not bundled in this migration.

## Cutover and verification
Verify the token challenge, subscribe the business account, and send Reports from an existing authorized number. Confirm document delivery and its matching delivered/read callback. Test unauthorized senders and cross-site selections without creating production test records. Only then disconnect Twilio if no SMS/other workflows need it.

Free-form replies require the 24-hour customer-service window. The authenticated web sender enforces this window and refuses legacy Twilio templates after Meta activation. Business-initiated Meta templates and inbound media/evidence ingestion are not implemented here. PDF retrieval is user-initiated.

Inbound IDs are claimed using the existing tenant-scoped unique index. Duplicate callbacks do not re-run actions. Failures are marked in message metadata and require a new user message to retry; automatic replay of failed mutations is intentionally avoided. A successful send response means accepted, not delivered.