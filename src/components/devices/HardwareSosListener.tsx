import { useEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { getDeviceLocation } from "@/lib/deviceGeolocation";
import { getPatrolDeviceInfo } from "@/lib/deviceInfo";
import { updatePatrolDevicePresence } from "@/lib/devicePresence";
import { resolveDeviceCompany } from "@/lib/deviceCompany";

type HardwareKeyDetail = {
  schema?: string;
  action?: string;
  keyCode: number;
  keyName: string;
  durationMs: number;
  sosCandidate: boolean;
  key?: {
    code?: number;
    name?: string;
    scanCode?: number;
  };
  device?: {
    id?: number;
    source?: number;
  };
  timing?: {
    durationMs?: number;
    eventTimeMs?: number;
    downTimeMs?: number;
    emittedAtMs?: number;
  };
  repeatCount?: number;
  metaState?: number;
};

// Confirmed via on-device calibration (RG360, 2026-07-06).
// SOS: keyCode 1079 / scanCode 3
// Volume: keyCode 1078 / scanCode 2 (must NEVER trigger SOS)
const RG360_SOS_KEY_CODE = 1079;
const RG360_SOS_SCAN_CODE = 3;

const REQUIRED_HOLD_MS = 3000;
const ALERT_COOLDOWN_MS = 10_000;
const DIAGNOSTIC_VISIBLE_MS = 8_000;

type HardwareKeyDiagnostic = HardwareKeyDetail & {
  status: "detected" | "short_hold" | "sent" | "cooldown" | "ignored" | "unmapped";
  receivedAt: number;
};

function isConfirmedSosKey(detail: HardwareKeyDetail): boolean {
  const scanCode = detail.key?.scanCode;
  return detail.keyCode === RG360_SOS_KEY_CODE && scanCode === RG360_SOS_SCAN_CODE;
}

export default function HardwareSosListener() {
  const { user } = useAuth();
  const lastAlertAt = useRef(0);
  const sending = useRef(false);
  const diagnosticTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [diagnostic, setDiagnostic] = useState<HardwareKeyDiagnostic | null>(null);

  useEffect(() => {
    if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== "android") return;

    const showDiagnostic = (detail: HardwareKeyDetail, status: HardwareKeyDiagnostic["status"]) => {
      const next = { ...detail, status, receivedAt: Date.now() };
      setDiagnostic(next);
      if (diagnosticTimer.current) clearTimeout(diagnosticTimer.current);
      diagnosticTimer.current = setTimeout(() => setDiagnostic(null), DIAGNOSTIC_VISIBLE_MS);
    };

    const handleHardwareKey = (event: Event) => {
      const detail = parseHardwareKeyEvent(event);

      if (!detail) {
        console.warn("[HardwareKeyRaw] " + describeHardwareKeyEvent(event));
        toast.warning("RG360 key event was not readable");
        return;
      }

      console.info("[HardwareKey] captured " + JSON.stringify(detail));
      showDiagnostic(detail, "detected");

      if (detail.action === "down") {
        return;
      }

      const isSosKey = isConfirmedSosKey(detail);

      if (!isSosKey) {
        console.info("[HardwareKey] unmapped " + JSON.stringify(detail));
        showDiagnostic(detail, "unmapped");
        toast.info(formatDiagnosticToast(detail, "Not the SOS key"));
        return;
      }

      console.info("[HardwareKey] mapped SOS candidate " + JSON.stringify(detail));

      if (detail.durationMs < REQUIRED_HOLD_MS) {
        showDiagnostic(detail, "short_hold");
        toast.info(formatDiagnosticToast(detail, `Hold ${REQUIRED_HOLD_MS}ms for SOS`));
        return;
      }

      if (sending.current || Date.now() - lastAlertAt.current < ALERT_COOLDOWN_MS) {
        showDiagnostic(detail, "cooldown");
        toast.info(formatDiagnosticToast(detail, "SOS cooldown active"));
        return;
      }

      sending.current = true;
      window.dispatchEvent(new CustomEvent("mxpatrol:sos-feedback", {
        detail: { status: "sending", key: detail, deviceIdentifier: getPatrolDeviceInfo().deviceIdentifier },
      }));
      navigator.vibrate?.([160, 60, 160]);
      void createSosAlert(user?.id ?? null, detail)
        .then(() => {
          lastAlertAt.current = Date.now();
          showDiagnostic(detail, "sent");
          window.dispatchEvent(new CustomEvent("mxpatrol:sos-feedback", {
            detail: { status: "sent", key: detail, deviceIdentifier: getPatrolDeviceInfo().deviceIdentifier },
          }));
          navigator.vibrate?.([250, 100, 250]);
          toast.error("SOS alert sent to the control room", { duration: 8_000 });
        })
        .catch((error) => {
          console.error("[HardwareSos] Failed to send alert " + JSON.stringify(error));
          window.dispatchEvent(new CustomEvent("mxpatrol:sos-feedback", {
            detail: { status: "error", key: detail, deviceIdentifier: getPatrolDeviceInfo().deviceIdentifier },
          }));
          toast.error("SOS could not be sent. Call your supervisor now.", { duration: 10_000 });
        })
        .finally(() => {
          sending.current = false;
        });
    };

    window.addEventListener("mxpatrolHardwareKey", handleHardwareKey);
    return () => {
      window.removeEventListener("mxpatrolHardwareKey", handleHardwareKey);
      if (diagnosticTimer.current) clearTimeout(diagnosticTimer.current);
    };
  }, [user]);

  if (!diagnostic) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-background/95 px-3 py-2 text-xs text-foreground shadow-lg backdrop-blur">
      <div className="font-semibold">RG360 key {diagnostic.status.replace("_", " ")}</div>
      <div>
        {diagnostic.keyName} ({diagnostic.keyCode}) - hold {Math.round(diagnostic.durationMs)}ms
      </div>
      <div className="text-muted-foreground">
        scan {diagnostic.key?.scanCode ?? "n/a"} - device {diagnostic.device?.id ?? "n/a"} - source{" "}
        {diagnostic.device?.source ?? "n/a"}
      </div>
    </div>
  );
}

async function createSosAlert(userId: string | null, key: HardwareKeyDetail) {
  const deviceInfo = getPatrolDeviceInfo();
  let companyId: string | null = null;
  let siteId: string | null = null;

  if (userId) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("company_id")
      .eq("id", userId)
      .single();

    if (profileError || !profile?.company_id) throw profileError ?? new Error("No company assigned");
    companyId = profile.company_id;
  } else {
    const deviceCompany = await resolveDeviceCompany();
    if (!deviceCompany?.companyId) throw new Error("Device is not paired to a company");
    companyId = deviceCompany.companyId;
    siteId = deviceCompany.siteId ?? null;
  }

  let gps: { lat: number; lng: number; accuracy?: number | null } | null = null;
  try {
    const location = await withTimeout(getDeviceLocation({ maxAgeMs: 30000 }), 3_000);
    gps = { lat: location.lat, lng: location.lng, accuracy: location.accuracy };
  } catch {
    gps = null;
  }

  if (userId) {
    await updatePatrolDevicePresence({
      companyId,
      userId,
      gps,
      device: deviceInfo,
    });
  }

  if (!userId) {
    const { data, error } = await supabase.functions.invoke("device-sos", {
      body: {
        device_identifier: deviceInfo.deviceIdentifier,
        gps,
        key,
      },
    });
    if (error) throw error;
    if (!data?.ok) throw new Error(data?.error || "SOS alert failed");
    console.info("[SOS] Panic alert inserted", {
      alertId: data.alert?.id ?? null,
      companyId,
      deviceIdentifier: deviceInfo.deviceIdentifier,
      gps,
    });
    return;
  }

  const { data: device } = await supabase
    .from("devices")
    .select("id, device_name, site_location, device_identifier, site_id")
    .eq("company_id", companyId)
    .eq("device_identifier", deviceInfo.deviceIdentifier)
    .maybeSingle();

  const deviceLabel = device?.device_name ?? "Unregistered patrol device";
  const deviceIdentifier = device?.device_identifier ?? deviceInfo.deviceIdentifier;
  const locationSource = gps ? "device GPS" : device?.site_location ? "registered device site" : "unavailable";
  const location = gps
    ? `${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}${gps.accuracy ? ` (accuracy ${Math.round(gps.accuracy)}m)` : ""}`
    : device?.site_location ?? "GPS unavailable";

  const { data: alert, error } = await supabase.from("alerts").insert({
    company_id: companyId,
    site_id: device?.site_id ?? siteId,
    guard_id: null,
    type: "panic_button",
    severity: "critical",
    message: [
      "SOS ALERT",
      `Device: ${deviceLabel}`,
      `Device ID: ${deviceIdentifier}`,
      `Device registered: ${device?.id ? "yes" : "no"}`,
      `Location: ${location}`,
      `Location source: ${locationSource}`,
      `Hardware: ${key.keyName} (${key.keyCode})`,
      `Hold: ${Math.round(key.durationMs)}ms`,
      `Scan/device/source: ${key.key?.scanCode ?? "n/a"}/${key.device?.id ?? "n/a"}/${key.device?.source ?? "n/a"}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join(" | "),
  }).select("id").single();

  if (error) throw error;
  console.info("[SOS] Panic alert inserted", {
    alertId: alert?.id ?? null,
    companyId,
    deviceIdentifier,
    gps,
  });
}

function parseHardwareKeyEvent(event: Event): HardwareKeyDetail | null {
  const raw = (event as CustomEvent<HardwareKeyDetail | string>).detail;
  const parsed = typeof raw === "string" ? safeJsonParse(raw) : raw;

  if (!parsed || typeof parsed !== "object") return null;

  const keyCode = toNumber(parsed.keyCode ?? parsed.key?.code);
  const keyName = String(parsed.keyName ?? parsed.key?.name ?? "UNKNOWN");
  const durationMs = toNumber(parsed.durationMs ?? parsed.timing?.durationMs);
  const sosCandidate = Boolean(parsed.sosCandidate);

  if (keyCode === null || durationMs === null) return null;

  return {
    ...parsed,
    keyCode,
    keyName,
    durationMs,
    sosCandidate,
    key: {
      ...parsed.key,
      code: keyCode,
      name: keyName,
    },
  };
}

function safeJsonParse(value: string): Partial<HardwareKeyDetail> | null {
  try {
    return JSON.parse(value) as Partial<HardwareKeyDetail>;
  } catch {
    return null;
  }
}

function toNumber(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDiagnosticToast(detail: HardwareKeyDetail, suffix: string) {
  return `RG360 key: ${detail.keyName} (${detail.keyCode}) - ${Math.round(detail.durationMs)}ms - ${suffix}`;
}

function describeHardwareKeyEvent(event: Event) {
  const customEvent = event as CustomEvent<unknown>;
  try {
    return JSON.stringify({
      type: event.type,
      constructor: event.constructor?.name,
      detail: customEvent.detail,
      keys: Object.keys(event),
    });
  } catch {
    return `${event.type}: unreadable event`;
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error("GPS timed out")), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
