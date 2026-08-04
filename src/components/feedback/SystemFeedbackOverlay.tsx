/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, Loader2, MapPin, ShieldAlert, Volume2, VolumeX, X } from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { playError, playPhotoCapture, playPhotoReceived } from "@/lib/feedbackSound";
import {
  getSosSirenVolume,
  isSosSirenMuted,
  setSosSirenMuted,
  setSosSirenVolume,
  startSosSiren,
  stopSosSiren,
} from "@/lib/sosSirenManager";

type SosNotice = {
  id: string;
  message: string;
  device?: string | null;
  location?: string | null;
  timestamp: string;
  resolved?: boolean;
};

type PhotoNotice = {
  id: string;
  device?: string | null;
  timestamp: string;
  thumbnailUrl?: string | null;
  status?: "capturing" | "uploading" | "received" | "queued" | "error";
  message?: string;
};

const extractMessageField = (message: string | null | undefined, label: string) => {
  if (!message) return null;
  const parts = message.split("|").map((part) => part.trim());
  const lowerLabel = label.toLowerCase();
  const match = parts.find((part) => {
    const lower = part.toLowerCase();
    return lower.startsWith(`${lowerLabel}:`) || lower.startsWith(`${lowerLabel}=`);
  });
  if (!match) return null;
  const separatorIndex = match.includes("=") ? match.indexOf("=") : match.indexOf(":");
  return match.slice(separatorIndex + 1).trim();
};

const buildSosNotice = (alert: any): SosNotice => {
  const message = alert?.message || "SOS panic alert received";
  const timestamp = alert?.created_at || new Date().toISOString();
  const gps = extractMessageField(message, "GPS") || extractMessageField(message, "Location");
  return {
    id: alert?.id || `sos-${Date.now()}`,
    message,
    device: extractMessageField(message, "Device") || extractMessageField(message, "Device ID"),
    location: gps || extractMessageField(message, "Site"),
    timestamp,
    resolved: Boolean(alert?.is_read),
  };
};

export default function SystemFeedbackOverlay() {
  const { user } = useAuth();
  const [sosNotice, setSosNotice] = useState<SosNotice | null>(null);
  const [sosCount, setSosCount] = useState(0);
  const [sirenMuted, setSirenMuted] = useState(() => isSosSirenMuted());
  const [sirenVolume, setSirenVolumeState] = useState(() => getSosSirenVolume());
  const [now, setNow] = useState(() => Date.now());
  const [photoNotices, setPhotoNotices] = useState<PhotoNotice[]>([]);
  const seenEvents = useRef<Set<string>>(new Set());

  const remember = useCallback((id: string) => {
    if (seenEvents.current.has(id)) return false;
    seenEvents.current.add(id);
    if (seenEvents.current.size > 80) {
      const first = seenEvents.current.values().next().value;
      if (first) seenEvents.current.delete(first);
    }
    return true;
  }, []);

  const showSos = useCallback((notice: SosNotice) => {
    if (notice.resolved) return;
    const isNew = remember(`sos-${notice.id}`);
    setSosNotice({ ...notice, resolved: false });
    setSosCount((count) => (isNew ? Math.max(1, count + 1) : Math.max(1, count)));
    if (!isSosSirenMuted()) startSosSiren();
  }, [remember]);

  const showPhoto = useCallback((notice: PhotoNotice, playSound = true) => {
    if (notice.status === "received" && !remember(`photo-${notice.id}`)) return;
    if (playSound) {
      if (notice.status === "error") playError();
      else if (notice.status === "capturing" || notice.status === "uploading") playPhotoCapture();
      else playPhotoReceived();
    }
    setPhotoNotices((current) => {
      const withoutExisting = current.filter((item) => item.id !== notice.id);
      return [{ ...notice }, ...withoutExisting].slice(0, sosNotice ? 2 : 3);
    });
    window.setTimeout(() => {
      setPhotoNotices((current) => current.filter((item) => item.id !== notice.id));
    }, notice.status === "error" ? 7000 : 5500);
  }, [remember, sosNotice]);

  const resolveSos = useCallback(async () => {
    if (!sosNotice) return;
    stopSosSiren();
    setSosNotice((notice) => (notice ? { ...notice, resolved: true } : notice));
    if (!sosNotice.id.startsWith("local-")) {
      await (supabase as any).from("alerts").update({ is_read: true }).eq("id", sosNotice.id);
    }
    window.dispatchEvent(new CustomEvent("mxpatrol:sos-resolved", { detail: { id: sosNotice.id } }));
    window.setTimeout(() => setSosNotice(null), 400);
  }, [sosNotice]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!sosNotice || sosNotice.resolved) return;
      if (event.key.toLowerCase() === "r") void resolveSos();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resolveSos, sosNotice]);

  useEffect(() => () => stopSosSiren(), []);

  useEffect(() => {
    const onLocalSos = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      const status = detail.status || "sending";
      const key = detail.key || {};
      if (status === "sending") {
        showSos({
          id: `local-${Date.now()}`,
          message: "SOS panic is being sent to the control room",
          device: detail.deviceIdentifier || null,
          location: detail.gps?.lat != null && detail.gps?.lng != null ? `${detail.gps.lat}, ${detail.gps.lng}` : null,
          timestamp: new Date().toISOString(),
        });
        navigator.vibrate?.([220, 80, 220]);
      } else if (status === "sent") {
        navigator.vibrate?.([250, 100, 250]);
      } else if (status === "error") {
        playError();
      }
      console.info("[SOS] Local feedback", { status, keyCode: key.keyCode ?? key.code ?? null });
    };

    const onLocalPhoto = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      showPhoto({
        id: detail.id || `local-photo-${Date.now()}`,
        device: detail.deviceIdentifier || null,
        timestamp: detail.capturedAt || new Date().toISOString(),
        status: detail.status || "uploading",
        message: detail.message,
      }, true);
    };

    window.addEventListener("mxpatrol:sos-feedback", onLocalSos);
    window.addEventListener("mxpatrol:photo-feedback", onLocalPhoto);
    return () => {
      window.removeEventListener("mxpatrol:sos-feedback", onLocalSos);
      window.removeEventListener("mxpatrol:photo-feedback", onLocalPhoto);
    };
  }, [showPhoto, showSos]);

  useEffect(() => {
    const onResolved = (event: Event) => {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (!id || id !== sosNotice?.id) return;
      stopSosSiren();
      setSosNotice((notice) => (notice ? { ...notice, resolved: true } : notice));
      window.setTimeout(() => setSosNotice(null), 400);
    };
    window.addEventListener("mxpatrol:sos-resolved", onResolved);
    return () => window.removeEventListener("mxpatrol:sos-resolved", onResolved);
  }, [sosNotice?.id]);

  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("mxpatrol-system-feedback")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, (payload) => {
        const alert = payload.new as any;
        if (alert?.type === "panic_button") showSos(buildSosNotice(alert));
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "alerts" }, (payload) => {
        const alert = payload.new as any;
        if (alert?.type === "panic_button" && alert?.is_read && alert?.id === sosNotice?.id) {
          stopSosSiren();
          setSosNotice((notice) => (notice ? { ...notice, resolved: true } : notice));
          window.setTimeout(() => setSosNotice(null), 400);
        }
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "incident_report_photos" }, async (payload) => {
        const photo = payload.new as any;
        let thumbnailUrl: string | null = null;
        if (photo?.storage_path) {
          const { data } = await supabase.storage.from("incident-reports").createSignedUrl(photo.storage_path, 60 * 10);
          thumbnailUrl = data?.signedUrl ?? null;
        }
        showPhoto({
          id: photo?.id || `photo-${Date.now()}`,
          device: photo?.device_identifier,
          timestamp: photo?.captured_at || photo?.created_at || new Date().toISOString(),
          thumbnailUrl,
          status: "received",
        });
      })
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [showPhoto, showSos, sosNotice?.id, user]);

  const activeSos = sosNotice && !sosNotice.resolved;
  const elapsedSeconds = sosNotice ? Math.max(0, Math.floor((now - new Date(sosNotice.timestamp).getTime()) / 1000)) : 0;
  const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(2, "0")}:${String(elapsedSeconds % 60).padStart(2, "0")}`;

  const toggleSirenMuted = () => {
    const next = !sirenMuted;
    setSirenMuted(next);
    setSosSirenMuted(next);
    if (!next && activeSos) startSosSiren();
  };

  const updateSirenVolume = (volume: number) => {
    setSirenVolumeState(volume);
    setSosSirenVolume(volume);
  };

  return (
    <>
      {activeSos && <div className="pointer-events-none fixed inset-0 z-[80] sos-edge-pulse" />}
      {activeSos && sosNotice && (
        <div className="pointer-events-auto fixed left-1/2 top-3 z-[95] w-[min(96vw,1120px)] -translate-x-1/2 overflow-hidden rounded-xl border border-red-500/60 bg-red-950/95 shadow-[0_0_54px_rgba(239,68,68,.36)] backdrop-blur-xl sos-emergency-banner">
          <div className="relative flex flex-col gap-4 p-4 md:flex-row md:items-center">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-red-600 via-orange-400 to-red-600" />
            <div className="relative flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-100 glow-destructive">
              <span className="sos-warning-ring" />
              <span className="sos-warning-ring sos-warning-ring-delay" />
              <ShieldAlert className="relative h-8 w-8 sos-icon-pulse" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-black uppercase tracking-[0.2em] text-red-50">SOS ALERT ACTIVE</p>
                {sosCount > 1 && <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold text-white">{sosCount} alerts</span>}
                <span className="rounded-full bg-orange-400/15 px-2 py-0.5 text-xs font-bold uppercase text-orange-100">Awaiting resolve</span>
              </div>
              <div className="mt-2 grid gap-2 text-xs text-red-100/85 sm:grid-cols-4">
                <span>Device: <b className="text-white">{sosNotice.device || "Patrol device"}</b></span>
                <span>Location: <b className="text-white">{sosNotice.location || "Pending"}</b></span>
                <span>Time: <b className="text-white">{format(new Date(sosNotice.timestamp), "HH:mm:ss")}</b></span>
                <span>Live timer: <b className="text-white">{elapsedLabel}</b></span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end">
              <button type="button" onClick={toggleSirenMuted} className="inline-flex h-10 items-center gap-2 rounded-md border border-red-300/25 px-3 text-sm font-semibold text-red-50 transition hover:bg-red-400/15">
                {sirenMuted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
                {sirenMuted ? "Muted" : "Siren"}
              </button>
              <input
                aria-label="SOS siren volume"
                className="h-10 w-24 accent-red-400"
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={sirenVolume}
                onChange={(event) => updateSirenVolume(Number(event.target.value))}
              />
              <button type="button" onClick={resolveSos} className="inline-flex h-10 items-center rounded-md bg-red-500 px-4 text-sm font-black uppercase tracking-wide text-white transition hover:bg-red-400">
                Resolve
              </button>
              <button type="button" onClick={() => setSosNotice(null)} className="rounded-md p-2 text-red-100/70 hover:bg-red-400/15 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="pointer-events-none fixed right-4 top-28 z-[90] flex w-[min(92vw,390px)] flex-col gap-3">
        {sosNotice && (
          <div className={`pointer-events-auto overflow-hidden rounded-lg border border-destructive/50 bg-background/95 shadow-2xl backdrop-blur-xl md:hidden ${sosNotice.resolved ? "opacity-0 transition-opacity" : "sos-card-shake"}`}>
            <div className="relative p-4">
              <div className="absolute -right-12 -top-12 h-32 w-32 rounded-full bg-destructive/20 blur-2xl" />
              <div className="flex items-start gap-3">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-destructive/20 text-destructive glow-destructive">
                  <span className="sos-warning-ring" />
                  <span className="sos-warning-ring sos-warning-ring-delay" />
                  <ShieldAlert className="relative h-7 w-7 sos-icon-pulse" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.24em] text-destructive">SOS PANIC ALERT</p>
                  <p className="mt-1 text-sm font-semibold text-foreground">{sosNotice.device || "Patrol device"}</p>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1"><MapPin className="h-3 w-3 text-warning" /> {sosNotice.location || "Location pending"}</p>
                    <p>{format(new Date(sosNotice.timestamp), "yyyy-MM-dd HH:mm:ss")}</p>
                  </div>
                </div>
                <button type="button" onClick={() => setSosNotice(null)} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={resolveSos} className="flex-1 rounded-md bg-destructive px-3 py-2 text-sm font-semibold text-destructive-foreground transition hover:bg-destructive/90">
                  Resolve
                </button>
              </div>
            </div>
          </div>
        )}

        {photoNotices.map((photo) => (
          <div key={photo.id} className="pointer-events-auto overflow-hidden rounded-lg border border-primary/40 bg-background/92 shadow-xl backdrop-blur-xl photo-notice-glow">
            <div className="flex gap-3 p-3">
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-primary/10 text-primary">
                {photo.thumbnailUrl ? (
                  <img src={photo.thumbnailUrl} alt="RG360 evidence" className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center camera-flash">
                    {photo.status === "uploading" || photo.status === "capturing" ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">{photo.status === "queued" ? "PHOTO PENDING SYNC" : photo.status === "error" ? "PHOTO ERROR" : "PHOTO RECEIVED"}</p>
                <p className="mt-1 truncate text-sm font-medium text-foreground">{photo.device || "RG360 patrol device"}</p>
                <p className="mt-1 text-xs text-muted-foreground">{format(new Date(photo.timestamp), "yyyy-MM-dd HH:mm:ss")}</p>
                {photo.message && <p className="mt-1 text-xs text-muted-foreground">{photo.message}</p>}
              </div>
              {photo.status === "received" && <CheckCircle2 className="mt-1 h-4 w-4 text-success" />}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
