import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import { verifySecureDeviceRequest } from "../_shared/secure-device.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  action?: "fetch" | "ack";
  device_identifier?: string;
  command_id?: string;
  playback_status?: "played" | "failed" | "skipped";
  error?: string | null;
  device_auth?: Record<string, unknown> | null;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(error: string, status = 500, details?: unknown) {
  return json({ success: false, error, ...(details ? { details } : {}) }, status);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const body = await req.json().catch(() => ({})) as Body;
    const deviceIdentifier = String(body.device_identifier || "").trim();
    if (!deviceIdentifier) return fail("device_identifier is required", 400);

    const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const { data: device, error: deviceError } = await service
      .from("devices")
      .select("id, company_id, site_id, device_identifier, pairing_status, status, secure_mode_enabled, secure_mode_status, public_key")
      .eq("device_identifier", deviceIdentifier)
      .maybeSingle();
    if (deviceError) throw deviceError;
    if (!device) return fail("Device not registered", 404);
    if (device.pairing_status !== "paired") return fail("Device not paired", 403);
    if (["blocked", "wiped", "retired"].includes(String(device.status))) return fail("Device is not active", 403);

    const action = body.action === "ack" ? "voice_command_ack" : "voice_command_fetch";
    const authCheck = await verifySecureDeviceRequest({ serviceClient: service, device, auth: body.device_auth, action });
    if (!authCheck.ok) return fail(authCheck.message, 403, { code: authCheck.code });

    const now = new Date().toISOString();
    if (body.action === "ack") {
      if (!body.command_id) return fail("command_id is required", 400);
      const playbackStatus = body.playback_status || "played";
      const commandStatus = playbackStatus === "played" ? "executed" : "failed";
      const { data: command, error: commandError } = await service
        .from("device_commands")
        .select("id, status, result")
        .eq("id", body.command_id)
        .eq("device_id", device.id)
        .eq("company_id", device.company_id)
        .eq("command_type", "voice_message")
        .maybeSingle();
      if (commandError) throw commandError;
      if (!command) return fail("Voice command not found for this device", 404);
      if (command.status === "executed") return json({ success: true, idempotent: true, status: command.status });

      const { error: updateError } = await service
        .from("device_commands")
        .update({
          status: commandStatus,
          executed_at: now,
          result: {
            ...(command.result ?? {}),
            playback_status: playbackStatus,
            error: body.error ?? null,
            acknowledged_at: now,
            acknowledged_by: deviceIdentifier,
          },
        })
        .eq("id", body.command_id)
        .eq("device_id", device.id)
        .eq("company_id", device.company_id);
      if (updateError) throw updateError;
      return json({ success: true, command_id: body.command_id, status: commandStatus });
    }

    const { data: commands, error: commandsError } = await service
      .from("device_commands")
      .select("id, payload, issued_at, sent_at, status")
      .eq("device_id", device.id)
      .eq("company_id", device.company_id)
      .eq("command_type", "voice_message")
      .in("status", ["pending", "sent"])
      .order("issued_at", { ascending: true })
      .limit(5);
    if (commandsError) throw commandsError;

    const rows = commands ?? [];
    const pendingIds = rows.filter((row: Record<string, unknown>) => row.status === "pending").map((row: Record<string, unknown>) => row.id);
    if (pendingIds.length) {
      await service.from("device_commands").update({ status: "sent", sent_at: now }).in("id", pendingIds).eq("device_id", device.id).eq("company_id", device.company_id);
    }

    const voiceCommands = [];
    for (const command of rows as Array<Record<string, any>>) {
      const payload = (command.payload ?? {}) as Record<string, any>;
      const storagePath = String(payload.storage_path ?? "");
      if (!storagePath) continue;
      const signed = await service.storage.from("incident-reports").createSignedUrl(storagePath, 15 * 60);
      if (signed.error || !signed.data?.signedUrl) {
        await service.from("device_commands").update({ status: "failed", executed_at: now, result: { error: signed.error?.message || "signed_url_failed" } }).eq("id", command.id).eq("device_id", device.id);
        continue;
      }
      voiceCommands.push({
        id: command.id,
        issued_at: command.issued_at,
        message_id: payload.message_id ?? command.id,
        audio_url: signed.data.signedUrl,
        storage_path: storagePath,
        content_type: payload.content_type ?? "audio/webm",
        filename: payload.filename ?? "control-room-voice.webm",
        duration_ms: payload.duration_ms ?? null,
        sender_id: payload.sender_id ?? null,
      });
    }

    return json({ success: true, commands: voiceCommands, server_time: now });
  } catch (error) {
    console.error("[device-voice-commands]", error);
    return fail((error as Error)?.message || "Device voice command request failed", 500);
  }
});
