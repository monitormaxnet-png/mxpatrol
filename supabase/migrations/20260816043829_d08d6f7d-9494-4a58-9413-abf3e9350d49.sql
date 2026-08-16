-- Harden WhatsApp inbound delivery against Twilio retries.
-- Twilio may resend the same MessageSid when a webhook times out or returns a transient error.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_inbound_twilio_sid_key
  ON public.whatsapp_messages (company_id, twilio_sid)
  WHERE direction = 'inbound' AND twilio_sid IS NOT NULL;