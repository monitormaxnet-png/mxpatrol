import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Body = {
  site_id?: string | null;
  recipient_mode?: "selected" | "site";
  device_identifiers?: string[];
  audio_base64?: string;
  content_type?: string;
  filename?: string;
  duration_ms?: number | null;
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function fail(error: string, status = 500, details?: unknown) {
  return json({ success: false, error, ...(details ? { details } : {}) }, status);
}

function safeName(value: string | null | undefined) {
  return String(value || "control-room-voice.m4a").replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 120) || "control-room-voice.m4a";
}

function decodeBase64Audio(value: string) {
  const normalized = value.includes(",") ? value.split(",").pop() || "" : value;
  const binary = atob(normalized.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return fail("Method not allowed", 405);

  try {
    const body = await req.json().catch(() => ({})) as Body;
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader) return fail("Authentication required", 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const service = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData, error: userError } = await authClient.auth.getUser();
    if (userError || !userData.user) return fail("Authentication required", 401);
    const userId = userData.user.id;

    const { data: profile, error: profileError } = await service
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileError || !profile?.company_id) return fail("Company profile required", 403);

    const { data: roleRows, error: roleError } = await service.from("user_roles").select("role").eq("user_id", userId);
    if (roleError) throw roleError;
    const roles = (roleRows ?? []).map((row: { role: string }) => String(row.role));
    const { data: platformRows, error: platformError } = await service.from("platform_admins").select("role").eq("user_id", userId).limit(1);
    if (platformError) throw platformError;
    const platformRole = platformRows?.[0]?.role ? String(platformRows[0].role) : null;
    const authorized = platformRole === "owner" || roles.includes("admin") || roles.includes("supervisor");
    if (!authorized) return fail("Operator is not authorized to send device voice messages", 403);

    if (!body.audio_base64) return fail("audio_base64 is required", 400);
    const durationMs = Math.max(0, Math.min(60_000, Number(body.duration_ms ?? 0) || 0));
    const contentType = String(body.content_type || "audio/webm").slice(0, 80);
    const filename = safeName(body.filename);
    const audioBytes = decodeBase64Audio(body.audio_base64);
    if (audioBytes.length < 128) return fail("Audio recording is empty", 400, { size: audioBytes.length });

    let query = service
      .from("devices")
      .select("id, company_id, site_id, device_identifier, device_name, status, pairing_status, secure_mode_status")
      .eq("company_id", profile.company_id)
      .eq("app_type", "guard_device")
      .eq("pairing_status", "paired");

    if (body.site_id) query = query.eq("site_id", body.site_id);
    const identifiers = Array.from(new Set((body.device_identifiers ?? []).map((value) => String(value).trim()).filter(Boolean)));
    if (body.recipient_mode !== "site" || identifiers.length) {
      if (!identifiers.length) return fail("Choose at least one device or use site broadcast", 400);
      query = query.in("device_identifier", identifiers);
    }

    const { data: devices, error: deviceError } = await query.limit(250);
    if (deviceError) throw deviceError;
    const recipients = (devices ?? []).filter((device: Record<string, unknown>) => !["revoked", "disabled"].includes(String(device.secure_mode_status ?? "")));
    if (!recipients.length) return fail("No eligible paired RG360 devices found", 404);

    const messageId = crypto.randomUUID();
    const storagePath = `${profile.company_id}/control-room/audio/${messageId}-${filename}`;
    const { error: uploadError } = await service.storage
      .from("incident-reports")
      .upload(storagePath, audioBytes, { contentType, upsert: false });
    if (uploadError) return fail("Failed to store voice message", 500, { message: uploadError.message });

    const now = new Date().toISOString();
    const commandRows = recipients.map((device: Record<string, unknown>) => ({
      company_id: profile.company_id,
      device_id: device.id,
      command_type: "voice_message",
      status: "pending",
      issued_by: userId,
      payload: {
        message_id: messageId,
        storage_path: storagePath,
        content_type: contentType,
        filename,
        duration_ms: durationMs,
        site_id: body.site_id ?? null,
        sender_id: userId,
        issued_at: now,
        device_identifier: device.device_identifier,
        requested_action: "play_voice_message",
        channel: "web",
      },
    }));

    const { data: commands, error: commandError } = await service
      .from("device_commands")
      .insert(commandRows)
      .select("id, device_id, command_type, status, issued_at");
    if (commandError) return fail("Failed to queue voice message commands", 500, { message: commandError.message });

    return json({
      success: true,
      message_id: messageId,
      storage_path: storagePath,
      recipient_count: recipients.length,
      commands: commands ?? [],
    });
  } catch (error) {
    console.error("[control-room-voice-message]", error);
    return fail((error as Error)?.message || "Voice message failed", 500);
  }
});
