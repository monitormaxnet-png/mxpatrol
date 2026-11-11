# Architecture rules
- Support Meta and legacy Twilio through the same WhatsApp assistant endpoint, with provider-specific transport helpers, so migration does not duplicate menu/business logic.
- Keep edge-deployable PDF/report branding code in `_shared`; parity tests compare it with the existing browser renderer to prevent report drift.
- Send WhatsApp PDFs by private Meta media IDs and delete uploaded media after the send attempt; never expose reports through public storage URLs.
- Reuse the existing tenant/message-ID unique index for inbound claims and persist processing state in message metadata, so duplicate deliveries cannot run concurrent operations.