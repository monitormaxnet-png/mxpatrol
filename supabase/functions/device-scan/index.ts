import { createClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type DbError = { code?: string; message?: string; details?: string; hint?: string };

function respond(ok: boolean, payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify({ ok, ...payload }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const normalizeNfcUid = (uid: unknown) =>
  String(uid ?? "").trim().replace(/[\s:.-]/g, "").toLowerCase();

const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
const stringOrNull = (value: unknown) => typeof value === "string" && value.trim() ? value.trim() : null;

const isMissingColumn = (error: unknown, column: string) => {
  const dbError = error as DbError | null;
  return dbError?.code === "PGRST204" && (dbError.message ?? "").includes(`'${column}'`);
};

const removeMissingColumns = (payload: Record<string, unknown>, error: unknown) => {
  const next = { ...payload };
  const possibleColumns = [
    "site_id",
    "device_metadata",
    "gps_accuracy",
    "device_identifier",
    "device_id",
    "user_id",
    "scanned_by",
    "tag_uid",
    "tag_status",
    "face_verified",
    "face_confidence",
    "is_offline_sync",
    "nfc_tag_id",
    "actor_user_id",
    "actor_guard_id",
    "performed_by",
  ];

  for (const column of possibleColumns) {
    if (isMissingColumn(error, column) && column in next) {
      delete next[column];
      return { changed: true, payload: next, removed: column };
    }
  }

  return { changed: false, payload: next, removed: null };
};

async function safeMaybeSingle(client: any, table: string, selectWithSite: string, selectWithoutSite: string, build: (query: any) => any) {
  let query = build(client.from(table).select(selectWithSite));
  let result = await query.maybeSingle();

  if (isMissingColumn(result.error, "site_id")) {
    query = build(client.from(table).select(selectWithoutSite));
    result = await query.maybeSingle();
  }

  return result;
}

async function safeSelectArray(client: any, table: string, selectWithSite: string, selectWithoutSite: string, build: (query: any) => any) {
  let query = build(client.from(table).select(selectWithSite));
  let result = await query;

  if (isMissingColumn(result.error, "site_id")) {
    query = build(client.from(table).select(selectWithoutSite));
    result = await query;
  }

  return result;
}

async function insertSelectIdWithFallback(client: any, table: string, payload: Record<string, unknown>) {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    Object.keys(nextPayload).forEach((key) => nextPayload[key] === undefined && delete nextPayload[key]);
    const result = await client.from(table).insert(nextPayload).select("id").single();
    if (!result.error) return { ...result, payload: nextPayload };

    const fallback = removeMissingColumns(nextPayload, result.error);
    if (!fallback.changed) return { ...result, payload: nextPayload };

    console.warn(`device-scan ${table}.${fallback.removed} missing; retrying without column`);
    nextPayload = fallback.payload;
  }

  return {
    data: null,
    error: { code: "DEVICE_SCAN_FALLBACK_EXHAUSTED", message: `Could not insert ${table} after schema fallbacks` },
    payload: nextPayload,
  };
}

async function upsertSelectWithFallback(client: any, table: string, payload: Record<string, unknown>, onConflict: string, selectColumns: string) {
  let nextPayload = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    Object.keys(nextPayload).forEach((key) => nextPayload[key] === undefined && delete nextPayload[key]);
    const result = await client.from(table).upsert(nextPayload, { onConflict }).select(selectColumns).single();
    if (!result.error) return { ...result, payload: nextPayload };

    const fallback = removeMissingColumns(nextPayload, result.error);
    if (!fallback.changed) return { ...result, payload: nextPayload };

    console.warn(`device-scan ${table}.${fallback.removed} missing; retrying without column`);
    nextPayload = fallback.payload;
  }

  return {
    data: null,
    error: { code: "DEVICE_SCAN_FALLBACK_EXHAUSTED", message: `Could not upsert ${table} after schema fallbacks` },
    payload: nextPayload,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return respond(false, { code: "METHOD_NOT_ALLOWED", error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const scan = body.scan && typeof body.scan === "object" ? body.scan as Record<string, unknown> : body;
    const deviceIdentifier = stringOrNull(scan.device_identifier ?? body.device_identifier);
    const requestedCompanyId = stringOrNull(scan.company_id ?? body.company_id);

    if (!deviceIdentifier) return respond(false, { code: "BAD_REQUEST", error: "device_identifier is required" });
    if (!requestedCompanyId) return respond(false, { code: "BAD_REQUEST", error: "company_id is required" });

    const serviceClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );

    const { data: device, error: deviceError } = await safeMaybeSingle(
      serviceClient,
      "devices",
      "id, company_id, site_id, device_identifier, device_name, pairing_status",
      "id, company_id, device_identifier, device_name, pairing_status",
      (query) => query.eq("device_identifier", deviceIdentifier).eq("pairing_status", "paired"),
    );

    if (deviceError) throw deviceError;
    if (!device?.company_id) return respond(false, { code: "DEVICE_NOT_PAIRED", error: "Device is not paired" });
    if (device.company_id !== requestedCompanyId) return respond(false, { code: "COMPANY_MISMATCH", error: "Device company mismatch" });

    const now = new Date().toISOString();
    const scannedAt = stringOrNull(scan.scanned_at) ?? now;
    const tagUid = normalizeNfcUid(scan.tag_uid);
    const gpsLat = numberOrNull(scan.gps_lat);
    const gpsLng = numberOrNull(scan.gps_lng);
    const gpsAccuracy = numberOrNull(scan.gps_accuracy);
    const deviceMetadata = scan.device_metadata && typeof scan.device_metadata === "object" ? scan.device_metadata : {};

    const deviceUpdatePayload: Record<string, unknown> = {
      status: "online",
      last_seen_at: now,
      current_gps_lat: gpsLat,
      current_gps_lng: gpsLng,
      current_gps_accuracy: gpsAccuracy,
      current_gps_at: gpsLat != null && gpsLng != null ? now : null,
      metadata: deviceMetadata,
    };
    let deviceUpdate = await serviceClient.from("devices").update(deviceUpdatePayload).eq("id", device.id);
    if (isMissingColumn(deviceUpdate.error, "metadata")) {
      delete deviceUpdatePayload.metadata;
      deviceUpdate = await serviceClient.from("devices").update(deviceUpdatePayload).eq("id", device.id);
    }
    if (deviceUpdate.error) console.warn("device-scan device presence update failed", deviceUpdate.error);

    let checkpointId = stringOrNull(scan.checkpoint_id);
    let siteId = stringOrNull(scan.site_id) ?? device.site_id ?? null;
    let tagStatus = stringOrNull(scan.tag_status) ?? "unregistered";
    let checkpointName: string | null = null;

    if (!checkpointId && tagUid) {
      const { data: exactCheckpoint, error: exactCheckpointError } = await safeMaybeSingle(
        serviceClient,
        "checkpoints",
        "id, name, nfc_tag_id, site_id",
        "id, name, nfc_tag_id",
        (query) => query.eq("company_id", device.company_id).eq("nfc_tag_id", tagUid),
      );
      if (exactCheckpointError) throw exactCheckpointError;

      let checkpoint = exactCheckpoint;
      if (!checkpoint) {
        const { data: checkpoints, error: checkpointsError } = await safeSelectArray(
          serviceClient,
          "checkpoints",
          "id, name, nfc_tag_id, site_id",
          "id, name, nfc_tag_id",
          (query) => query.eq("company_id", device.company_id),
        );
        if (checkpointsError) throw checkpointsError;
        checkpoint = checkpoints?.find((item: any) => normalizeNfcUid(item.nfc_tag_id) === tagUid) ?? null;
      }

      if (checkpoint) {
        checkpointId = checkpoint.id;
        siteId = checkpoint.site_id ?? siteId;
        checkpointName = checkpoint.name ?? null;
        tagStatus = "registered";
      }
    }

    if (checkpointId && !checkpointName) {
      const { data: checkpoint, error: checkpointError } = await safeMaybeSingle(
        serviceClient,
        "checkpoints",
        "id, name, site_id",
        "id, name",
        (query) => query.eq("id", checkpointId).eq("company_id", device.company_id),
      );
      if (checkpointError) throw checkpointError;
      if (!checkpoint) return respond(false, { code: "CHECKPOINT_COMPANY_MISMATCH", error: "Checkpoint does not belong to device company" });
      checkpointName = checkpoint.name ?? null;
      siteId = checkpoint.site_id ?? siteId;
      tagStatus = "registered";
    }

    const scanLogPayload: Record<string, unknown> = {
      id: stringOrNull(scan.id) ?? undefined,
      guard_id: stringOrNull(scan.guard_id),
      checkpoint_id: checkpointId,
      company_id: device.company_id,
      site_id: siteId,
      scanned_at: scannedAt,
      tag_uid: tagUid || null,
      tag_status: tagStatus,
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      gps_accuracy: gpsAccuracy,
      scanned_by: stringOrNull(scan.scanned_by),
      user_id: stringOrNull(scan.user_id),
      device_id: stringOrNull(scan.device_id) ?? deviceIdentifier,
      device_identifier: deviceIdentifier,
      device_metadata: deviceMetadata,
      face_verified: typeof scan.face_verified === "boolean" ? scan.face_verified : null,
      face_confidence: numberOrNull(scan.face_confidence),
      is_offline_sync: Boolean(scan.is_offline_sync),
    };

    let scanLog: { id: string } | null = null;
    const scanInsert = await insertSelectIdWithFallback(serviceClient, "scan_logs", scanLogPayload);

    if (scanInsert.error?.code === "23505" && scanLogPayload.id) {
      const { data: existingScanLog, error: existingError } = await serviceClient
        .from("scan_logs")
        .select("id")
        .eq("id", scanLogPayload.id)
        .maybeSingle();
      if (existingError) throw existingError;
      scanLog = existingScanLog;
    } else if (scanInsert.error) {
      throw scanInsert.error;
    } else {
      scanLog = scanInsert.data;
    }

    if (checkpointId && gpsLat != null && gpsLng != null) {
      const checkpointGpsUpdate = await serviceClient
        .from("checkpoints")
        .update({ location_lat: gpsLat, location_lng: gpsLng })
        .eq("id", checkpointId)
        .eq("company_id", device.company_id)
        .or("location_lat.is.null,location_lng.is.null");
      if (checkpointGpsUpdate.error) console.warn("device-scan checkpoint GPS update failed", checkpointGpsUpdate.error);
    }

    let pendingTag: { id: string; status: string } | null = null;
    let alert: { id: string } | null = null;

    if (!checkpointId && tagUid) {
      const message = [
        "New NFC Tag Detected",
        "",
        `Tag UID: ${tagUid}`,
        `Device: ${device.device_name ?? deviceIdentifier}`,
        `Date/Time: ${new Date(scannedAt).toLocaleString()}`,
        `GPS: ${gpsLat != null && gpsLng != null ? `${gpsLat},${gpsLng}` : "Pending"}`,
        "",
        "Would you like to register this tag as a checkpoint?",
      ].join("\n");

      const alertInsert = await insertSelectIdWithFallback(serviceClient, "alerts", {
        company_id: device.company_id,
        site_id: siteId,
        type: "anomaly",
        severity: "medium",
        guard_id: stringOrNull(scan.guard_id),
        message,
      });
      if (alertInsert.error) console.warn("device-scan alert insert failed", alertInsert.error);
      alert = alertInsert.data ?? null;

      const pendingInsert = await upsertSelectWithFallback(
        serviceClient,
        "pending_nfc_tags",
        {
          company_id: device.company_id,
          site_id: siteId,
          tag_uid: tagUid,
          nfc_tag_id: tagUid,
          status: "pending",
          last_seen_at: scannedAt,
          gps_lat: gpsLat,
          gps_lng: gpsLng,
          gps_accuracy: gpsAccuracy,
          device_id: stringOrNull(scan.device_id) ?? deviceIdentifier,
          device_identifier: deviceIdentifier,
          device_metadata: deviceMetadata,
          scan_log_id: scanLog?.id ?? null,
          alert_id: alert?.id ?? null,
          metadata: body.metadata && typeof body.metadata === "object" ? body.metadata : {},
        },
        "company_id,tag_uid",
        "id, status",
      );
      if (pendingInsert.error) throw pendingInsert.error;
      pendingTag = pendingInsert.data;

      const auditInsert = await insertSelectIdWithFallback(serviceClient, "nfc_tag_audit_logs", {
        company_id: device.company_id,
        pending_tag_id: pendingTag?.id ?? null,
        scan_log_id: scanLog?.id ?? null,
        tag_uid: tagUid,
        nfc_tag_id: tagUid,
        action: "pending_created",
        performed_by: stringOrNull(scan.scanned_by),
        actor_user_id: stringOrNull(scan.scanned_by),
        actor_guard_id: stringOrNull(scan.guard_id),
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        device_id: stringOrNull(scan.device_id) ?? deviceIdentifier,
        device_identifier: deviceIdentifier,
        metadata: { alert_id: alert?.id ?? null },
      });
      if (auditInsert.error) console.warn("device-scan audit insert failed", auditInsert.error);
    }

    console.info("[Scan] Inserted into scan_logs", {
      scanLogId: scanLog?.id ?? null,
      companyId: device.company_id,
      siteId,
      tagUid,
      checkpointId,
      checkpointName,
      deviceIdentifier,
      scannedAt,
    });

    return respond(true, {
      scan_log: scanLog,
      checkpoint: checkpointId ? { id: checkpointId, name: checkpointName, site_id: siteId } : null,
      pending_tag: pendingTag,
      alert,
      tag_status: tagStatus,
    });
  } catch (err) {
    const dbError = err as DbError;
    console.error("device-scan error:", err);
    return respond(false, {
      code: dbError?.code ?? "DEVICE_SCAN_ERROR",
      error: dbError?.message ?? (err instanceof Error ? err.message : "Internal server error"),
      details: dbError?.details ?? null,
      hint: dbError?.hint ?? null,
    });
  }
});
