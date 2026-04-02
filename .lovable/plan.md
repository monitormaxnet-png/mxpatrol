

## Add Twilio Secrets for WhatsApp Integration

The project already has the edge functions (`whatsapp-send` and `whatsapp-webhook`) built and deployed. Two secrets are needed to activate the integration:

### Secrets to Add

1. **TWILIO_API_KEY** — This is provided when you connect Twilio via a connector. Since the connector approach was declined, you'll need to provide your Twilio credentials manually.

2. **TWILIO_WHATSAPP_NUMBER** — Your Twilio WhatsApp-enabled phone number (e.g., `+14155238886` for the sandbox).

### How to Get These Values

**TWILIO_API_KEY:**
- Go to [Twilio Console](https://console.twilio.com/)
- Your Account SID and Auth Token are on the dashboard
- The value should be your Auth Token (used for API authentication through the gateway)

**TWILIO_WHATSAPP_NUMBER:**
- Go to Twilio Console → Messaging → Try it out → Send a WhatsApp message
- For sandbox testing, Twilio provides a number like `+14155238886`
- For production, use your purchased Twilio WhatsApp-enabled number

### Implementation Steps

1. Switch to default mode and use the `add_secret` tool to prompt you for `TWILIO_API_KEY`
2. Use the `add_secret` tool to prompt you for `TWILIO_WHATSAPP_NUMBER`
3. Deploy both edge functions to pick up the new secrets
4. Test the integration by calling the `whatsapp-send` function

### After Secrets Are Added

You'll also need to configure your Twilio WhatsApp webhook URL in the Twilio console:
```
https://ksbfgwawfqamtofapdty.supabase.co/functions/v1/whatsapp-webhook
```

This URL receives incoming WhatsApp messages and triggers the AI assistant responses.

