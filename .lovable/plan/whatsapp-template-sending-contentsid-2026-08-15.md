# WhatsApp template sending (ContentSid)

## Part 1 — Test the send now

Run the equivalent of your curl through the Twilio connector gateway (no raw Account SID / Auth Token needed — the gateway injects auth):

- To: `whatsapp:+26774187390`
- From: sandbox sender `whatsapp:+14155238886`
- ContentSid: `HXb5b62575e6e4ff6129ad7c8efe1f983e` (Twilio's sample appointment-reminder template)
- ContentVariables: `{"1":"12/1","2":"3pm"}`

Report back the message SID, or the exact Twilio error code/body if it fails (common ones: 63016 if the number hasn't joined the sandbox, 63007 for a bad From).

## Part 2 — Template support in the app

Extend `supabase/functions/whatsapp-send/index.ts` so it can send approved templates in addition to free-form text:

- Accept optional `content_sid` and `content_variables` (object of string keys to strings) alongside the existing `to` / `message` / `company_id`.
- When `content_sid` is present, post `ContentSid` + `ContentVariables` to Twilio instead of `Body`; otherwise keep today's plain-text path unchanged.
- Validate input: require either `message` or `content_sid`; reject unknown shapes with 400.
- Keep logging into `whatsapp_conversations` / `whatsapp_messages`, storing the rendered/template reference as the message body plus `template_sid` in the message metadata so the WhatsApp page shows what was sent.
- Surface Twilio's real status and error body on failure (no generic 500).
- Redeploy the function.

## Technical notes

- The existing `sendWhatsApp` helper in `whatsapp-webhook/lib/render.ts` already handles quick-reply/list templates via `TWILIO_WA_BUTTONS_CONTENT_SID` / `TWILIO_WA_LIST_CONTENT_SID`; this change only adds explicit template sends on the outbound `whatsapp-send` path and does not alter webhook behaviour.
- No new secrets required.
- Twilio's 24-hour session rule still applies: outside an open session only approved templates deliver, which is exactly what this path enables.

## Out of scope

- No UI for composing templates yet (can follow once the send path is proven).
- No changes to intent classification or Ask MX.
