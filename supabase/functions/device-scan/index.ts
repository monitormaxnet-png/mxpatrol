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
    "client_scan_id",
    "actor_user_id",
    "actor_guard_id",
    "performed_by",
    "battery_level",
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


async function buildPatrolResult(client: any, sessionId: string | null) {
  if (!sessionId) return null;
  const { data, error } = await client
    .from("patrol_sessions")
    .select("id, schedule_id, status, checkpoint_completed, checkpoint_total, progress_percent, meta, patrol_routes(name), patrol_schedules(name)")
    .eq("id", sessionId)
    .maybeSingle();
  if (error || !data) return null;
  const schedule = Array.isArray((data as any).patrol_schedules) ? (data as any).patrol_schedules[0] : (data as any).patrol_schedules;
  const route = Array.isArray((data as any).patrol_routes) ? (data as any).patrol_routes[0] : (data as any).patrol_routes;
  return {
    session_id: data.id,
    schedule_id: data.schedule_id ?? null,
    name: schedule?.name ?? route?.name ?? null,
    status: data.status ?? null,
    completed: data.checkpoint_completed ?? 0,
    required: data.checkpoint_total ?? 0,
    progress_percent: Number(data.progress_percent ?? 0),
    selection_reason: (data as any).meta?.match_selection_reason ?? null,
  };
}

async function loadDataLogForm(client: any, checkpointId: string | null) {
  if (!checkpointId) return null;
  const { data: checkpoint } = await client
    .from("checkpoints")
    .select("data_log_form_id")
    .eq("id", checkpointId)
    .maybeSingle();
  const formId = stringOrNull(checkpoint?.data_log_form_id);
  if (!formId) return null;

  const { data: form } = await client
    .from("data_log_forms")
    .select("id, name, form_type, is_active")
    .eq("id", formId)
    .maybeSingle();
  if (!form || form.is_active === false) return null;

  const { data: fields } = await client
    .from("data_log_form_fields")
    .select("id, label, field_type, required, options_json, sequence_order, is_active")
    .eq("form_id", formId)
    .eq("is_active", true)
    .order("sequence_order", { ascending: true });

  const usable = (fields ?? []).map((field: any) => ({
    id: String(field.id),
    label: String(field.label ?? ""),
    field_type: String(field.field_type ?? "text"),
    required: field.required === true,
    options: Array.isArray(field.options_json) ? field.options_json.map((value: unknown) => String(value)) : [],
    sequence_order: Number(field.sequence_order ?? 0),
  }));
  if (!usable.length) return null;

  return { id: String(form.id), name: String(form.name ?? "Data Log"), form_type: String(form.form_type ?? "checklist"), fields: usable };
}

async function buildStructuredResult(
  client: any,
  scanLogId: string | null,
  checkpoint: { id: string; name: string | null } | null,
  patrolMatch: Record<string, unknown> | null,
  offlineReplay: boolean,
  pending: boolean,
) {
  const rpcCode = stringOrNull(patrolMatch?.code);
  const sessionId = stringOrNull(patrolMatch?.session_id);
  const patrol = await buildPatrolResult(client, sessionId);

  let code = rpcCode ?? (checkpoint ? "NO_ACTIVE_PATROL" : "UNREGISTERED_CHECKPOINT");
  if (!checkpoint) code = "UNREGISTERED_CHECKPOINT";

  const nextCheckpointId = stringOrNull(patrolMatch?.next_checkpoint_id);
  const nextCheckpointName = stringOrNull(patrolMatch?.next_checkpoint_name);

  const dataLogRequired = code === "CHECKPOINT_REQUIRES_DATA";
  const dataLogForm = dataLogRequired ? await loadDataLogForm(client, checkpoint?.id ?? null) : null;

  const message = (() => {
    switch (code) {
      case "CHECKPOINT_REQUIRES_DATA": return `${checkpoint?.name ?? "Checkpoint"} needs ${dataLogForm?.name ?? "a data log"} completed`;
      case "PATROL_COMPLETED": return `${patrol?.name ?? "Patrol"} completed`;
      case "PATROL_STARTED": return `${patrol?.name ?? "Patrol"} started`;
      case "CHECKPOINT_ACCEPTED": return `${checkpoint?.name ?? "Checkpoint"} accepted`;
      case "CHECKPOINT_ALREADY_SCANNED": return "Checkpoint already counted for this patrol";
      case "CHECKPOINT_OUT_OF_ORDER": return `Scanned ${checkpoint?.name ?? "checkpoint"} out of order`;
      case "CHECKPOINT_NOT_IN_ROUTE": return `${checkpoint?.name ?? "Checkpoint"} is not part of this route`;
      case "UNREGISTERED_CHECKPOINT": return pending ? "Tag submitted for supervisor review" : "Tag is not registered";
      default: return "Checkpoint recorded, no active patrol matched";
    }
  })();

  return {
    success: true,
    code,
    scan_id: scanLogId,
    checkpoint,
    patrol,
    next_checkpoint: nextCheckpointId ? { id: nextCheckpointId, name: nextCheckpointName } : null,
    duplicate: code === "CHECKPOINT_ALREADY_SCANNED",
    data_log_required: dataLogRequired,
    data_log_form: dataLogForm,
    offline_replay: offlineReplay,
    message,
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
    if (!device?.company_id) return respond(false, { code: "DEVICE_NOT_ENROLLED", error: "Device is not enrolled for patrol scanning" });
    if (device.company_id !== requestedCompanyId) return respond(false, { code: "COMPANY_MISMATCH", error: "Device company mismatch" });

    const clientScanId = stringOrNull(scan.client_scan_id ?? body.client_scan_id) ?? stringOrNull(scan.id);
    const offlineReplay = Boolean(scan.is_offline_sync);

    if (clientScanId) {
      const { data: existing, error: existingError } = await serviceClient
        .from("scan_logs")
        .select("id, checkpoint_id, tag_status, patrol_match_status, patrol_session_id, checkpoints(id, name, site_id)")
        .eq("company_id", device.company_id)
        .eq("client_scan_id", clientScanId)
        .maybeSingle();

      if (existingError && existingError.code !== "42703" && existingError.code !== "PGRST204") {
        console.warn("device-scan idempotency lookup failed", existingError);
      }

      if (existing?.id) {
        const existingCheckpoint = Array.isArray((existing as any).checkpoints)
          ? (existing as any).checkpoints[0]
          : (existing as any).checkpoints;
        const replayResult = await buildPatrolResult(serviceClient, existing.patrol_session_id ?? null);
        console.info("[Scan] Idempotent replay", { clientScanId, scanLogId: existing.id });
        return respond(true, {
          scan_log: { id: existing.id },
          checkpoint: existing.checkpoint_id
            ? { id: existing.checkpoint_id, name: existingCheckpoint?.name ?? null, site_id: existingCheckpoint?.site_id ?? null }
            : null,
          pending_tag: null,
          alert: null,
          tag_status: existing.tag_status ?? (existing.checkpoint_id ? "registered" : "unregistered"),
          patrol_match: null,
          result: {
            success: true,
            code: "CHECKPOINT_ALREADY_SCANNED",
            scan_id: existing.id,
            checkpoint: existing.checkpoint_id ? { id: existing.checkpoint_id, name: existingCheckpoint?.name ?? null } : null,
            patrol: replayResult,
            next_checkpoint: null,
            duplicate: true,
            offline_replay: offlineReplay,
            message: "This scan was already recorded",
          },
        });
      }
    }

    const now = new Date().toISOString();
    const scannedAt = stringOrNull(scan.scanned_at) ?? now;
    const tagUid = normalizeNfcUid(scan.tag_uid);
    const gpsLat = numberOrNull(scan.gps_lat);
    const gpsLng = numberOrNull(scan.gps_lng);
    const gpsAccuracy = numberOrNull(scan.gps_accuracy);
    const deviceMetadata = scan.device_metadata && typeof scan.device_metadata === "object" ? scan.device_metadata as Record<string, unknown> : {};
    const batteryLevel = numberOrNull(deviceMetadata.battery_level ?? scan.battery_level);

    const deviceUpdatePayload: Record<string, unknown> = {
      status: "online",
      last_seen_at: now,
      current_gps_lat: gpsLat,
      current_gps_lng: gpsLng,
      current_gps_accuracy: gpsAccuracy,
      current_gps_at: gpsLat != null && gpsLng != null ? now : null,
      battery_level: batteryLevel,
      metadata: deviceMetadata,
    };
    let deviceUpdate = await serviceClient.from("devices").update(deviceUpdatePayload).eq("id", device.id);
    if (isMissingColumn(deviceUpdate.error, "metadata")) {
      delete deviceUpdatePayload.metadata;
      deviceUpdate = await serviceClient.from("devices").update(deviceUpdatePayload).eq("id", device.id);
    }
    if (deviceUpdate.error) console.warn("device-scan device presence update failed", deviceUpdate.error);

    if (batteryLevel != null && batteryLevel <= 20) {
      const batteryMessage = [
        "Low Battery Alert",
        `Device: ${device.device_name ?? deviceIdentifier}`,
        `Device ID: ${deviceIdentifier}`,
        `Battery: ${batteryLevel}%`,
        device.site_id ? `Site ID: ${device.site_id}` : null,
        `Time: ${now}`,
      ].filter(Boolean).join(" | ");

      const { data: existingBatteryAlert, error: batteryAlertLookupError } = await serviceClient
        .from("alerts")
        .select("id")
        .eq("company_id", device.company_id)
        .eq("type", "anomaly")
        .eq("is_read", false)
        .ilike("message", `%Low Battery Alert%${deviceIdentifier}%`)
        .maybeSingle();

      if (batteryAlertLookupError) {
        console.warn("device-scan low battery alert lookup failed", batteryAlertLookupError);
      }

      if (!existingBatteryAlert) {
        const lowBatteryAlert = await insertSelectIdWithFallback(serviceClient, "alerts", {
          company_id: device.company_id,
          site_id: device.site_id ?? null,
          type: "anomaly",
          severity: batteryLevel <= 10 ? "critical" : "high",
          guard_id: null,
          message: batteryMessage,
          is_read: false,
        });

        if (lowBatteryAlert.error) {
          console.warn("device-scan low battery alert insert failed", lowBatteryAlert.error);
        } else {
          console.info("[Device] Low battery alert inserted", {
            alertId: lowBatteryAlert.data?.id ?? null,
            companyId: device.company_id,
            siteId: device.site_id ?? null,
            deviceIdentifier,
            batteryLevel,
          });
        }
      }
    }

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
      is_offline_sync: offlineReplay,
      client_scan_id: clientScanId,
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

    const { data: persistedScan, error: persistedScanError } = scanLog?.id
      ? await serviceClient
        .from("scan_logs")
        .select("id, checkpoint_id, site_id, tag_status, checkpoints(id, name, site_id)")
        .eq("id", scanLog.id)
        .maybeSingle()
      : { data: null, error: null };

    if (persistedScanError) {
      console.warn("device-scan persisted scan lookup failed", persistedScanError);
    } else if (persistedScan) {
      const persistedCheckpoint = Array.isArray((persistedScan as any).checkpoints)
        ? (persistedScan as any).checkpoints[0]
        : (persistedScan as any).checkpoints;

      checkpointId = stringOrNull((persistedScan as any).checkpoint_id) ?? checkpointId;
      siteId = stringOrNull((persistedScan as any).site_id) ?? siteId;
      tagStatus = stringOrNull((persistedScan as any).tag_status) ?? tagStatus;

      if (checkpointId) {
        tagStatus = "registered";
        checkpointName = stringOrNull(persistedCheckpoint?.name) ?? checkpointName ?? "Registered checkpoint";
        siteId = stringOrNull(persistedCheckpoint?.site_id) ?? siteId;
      }
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

    let patrolMatch: Record<string, unknown> | null = null;
    if (scanLog?.id) {
      const { data: patrolMatchData, error: patrolMatchError } = await serviceClient.rpc("match_scan_to_patrol_session", {
        p_scan_log_id: scanLog.id,
      });

      if (patrolMatchError) {
        console.warn("device-scan patrol matching skipped", patrolMatchError);
      } else {
        patrolMatch = Array.isArray(patrolMatchData)
          ? (patrolMatchData[0] as Record<string, unknown> | undefined) ?? null
          : (patrolMatchData as Record<string, unknown> | null);

        console.info("[Patrol] Scan matching result", {
          scanLogId: scanLog.id,
          companyId: device.company_id,
          deviceIdentifier,
          patrolMatch,
        });
      }
    }
    let pendingTag: { id: string; status: string } | null = null;
    let alert: { id: string } | null = null;
    let whatsappCaptured = false;

    // Fulfil a pending "Add Checkpoint" request started from WhatsApp.
    if (!checkpointId && tagUid) {
      const { data: captureRequests, error: captureError } = await serviceClient
        .from("whatsapp_nfc_capture_requests")
        .select("id, phone, checkpoint_name, site_id, company_id")
        .eq("company_id", device.company_id)
        .eq("status", "waiting")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: false })
        .limit(1);

      if (captureError) {
        console.warn("device-scan whatsapp capture lookup failed", captureError);
      } else if (captureRequests?.length) {
        const request = captureRequests[0] as any;
        const { error: updateError } = await serviceClient
          .from("whatsapp_nfc_capture_requests")
          .update({
            status: "captured",
            nfc_tag_id: tagUid,
            device_identifier: deviceIdentifier,
            gps_lat: gpsLat,
            gps_lng: gpsLng,
            captured_at: scannedAt,
          })
          .eq("id", request.id)
          .eq("status", "waiting");

        if (updateError) {
          console.warn("device-scan whatsapp capture update failed", updateError);
        } else {
          whatsappCaptured = true;
          const notice = [
            "*✅ NFC TAG DETECTED*",
            "",
            `Checkpoint: ${request.checkpoint_name}`,
            `Device used: ${device.device_name ?? deviceIdentifier}`,
            "",
            "1. Create Checkpoint",
            "2. Cancel",
            "",
            "Reply with a number.",
          ].join("\n");

          try {
            const notifyResponse = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              },
              body: JSON.stringify({
                to: request.phone,
                message: notice,
                message_type: "system",
                company_id: request.company_id,
              }),
            });
            if (!notifyResponse.ok) {
              console.warn("device-scan whatsapp notify failed", notifyResponse.status, await notifyResponse.text());
            }
          } catch (notifyError) {
            console.warn("device-scan whatsapp notify error", notifyError);
          }
        }
      }
    }

    if (!checkpointId && tagUid && !whatsappCaptured) {
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

    const structured = await buildStructuredResult(
      serviceClient,
      scanLog?.id ?? null,
      checkpointId ? { id: checkpointId, name: checkpointName } : null,
      patrolMatch,
      offlineReplay,
      Boolean(pendingTag),
    );

    console.info("[Scan] Structured result", {
      scanLogId: scanLog?.id ?? null,
      code: structured.code,
      sessionId: structured.patrol?.session_id ?? null,
      completed: structured.patrol?.completed ?? null,
      required: structured.patrol?.required ?? null,
      selectionReason: structured.patrol?.selection_reason ?? null,
      offlineReplay,
    });

    return respond(true, {
      result: structured,
      scan_log: scanLog,
      checkpoint: checkpointId ? { id: checkpointId, name: checkpointName, site_id: siteId } : null,
      pending_tag: pendingTag,
      alert,
      tag_status: tagStatus,
      patrol_match: patrolMatch,
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
