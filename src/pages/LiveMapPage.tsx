/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, Suspense, useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Battery,
  Bell,
  CalendarClock,
  CheckCircle2,
  Crosshair,
  Eye,
  Layers,
  LocateFixed,
  Map as MapIcon,
  MapPin,
  Maximize2,
  MessageSquare,
  Navigation,
  Radio,
  Route,
  ShieldAlert,
  Smartphone,
  Target,
  Wifi,
  XCircle,
} from "lucide-react";
import SiteSelector from "@/components/sites/SiteSelector";
import { LoadingState } from "@/components/feedback/FeedbackPrimitives";
import { SocKpiCard, SocPageShell, SocPanel, SocProgressBar, SocStatusPill } from "@/components/dashboard/SocComponents";
import { useAlerts, useCheckpoints, useDevices, useRealtimeSubscriptions, useScanLogs } from "@/hooks/useDashboardData";
import { useDevicePositions, useScanMapEvents } from "@/hooks/useDeviceMapData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { patrolSessionLabel, patrolSessionProgress, usePatrolSessions } from "@/hooks/useScheduledPatrols";

const LiveMap = lazy(() => import("@/components/dashboard/LiveMap"));

type Tone = "green" | "blue" | "amber" | "red" | "neutral";
type LayerKey = "activePatrols" | "routes" | "checkpoints" | "devices" | "sos" | "geofences";

const today = () => new Date().toISOString().slice(0, 10);
const activeStatuses = new Set(["active", "in_progress", "started", "patrolling", "running"]);
const delayedStatuses = new Set(["late", "delayed", "completed_late"]);
const missedStatuses = new Set(["missed", "incomplete", "failed"]);
const completedStatuses = new Set(["completed", "completed_late"]);

const defaultLayers: Record<LayerKey, boolean> = {
  activePatrols: true,
  routes: true,
  checkpoints: true,
  devices: true,
  sos: true,
  geofences: false,
};

export default function LiveMapPage() {
  useRealtimeSubscriptions();

  const realtime = useRealtimeConnectionStatus("live-map-operations");
  const [siteId, setSiteId] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [layers, setLayers] = useState(defaultLayers);

  const { data: sessions = [], isLoading: sessionsLoading } = usePatrolSessions(120, siteId);
  const { data: devices = [] } = useDevices(siteId);
  const { data: checkpoints = [] } = useCheckpoints(siteId);
  const { data: scans = [] } = useScanLogs(siteId);
  const { data: alerts = [] } = useAlerts();
  const { data: positions = [] } = useDevicePositions();
  const { data: mapScans = [] } = useScanMapEvents({ siteId, date: today(), timeFrom: "00:00", timeTo: "23:59" });

  const filteredPositions = useMemo(
    () => positions.filter((device: any) => siteId === "all" || device.site_id === siteId),
    [positions, siteId]
  );
  const activeSessions = useMemo(() => sessions.filter((session: any) => activeStatuses.has(String(session.status ?? "").toLowerCase())), [sessions]);
  const activeSosAlerts = useMemo(() => alerts.filter((alert: any) => alert.type === "panic_button" && !alert.is_read), [alerts]);
  const selectedSession = useMemo(
    () => sessions.find((session: any) => session.id === selectedId) ?? activeSessions[0] ?? sessions[0] ?? null,
    [activeSessions, selectedId, sessions]
  );
  const selectedDevice = useMemo(() => {
    if (!selectedSession) return filteredPositions[0] ?? devices[0] ?? null;
    return (
      filteredPositions.find((device: any) => device.device_identifier === selectedSession.device_identifier) ??
      devices.find((device: any) => device.device_identifier === selectedSession.device_identifier) ??
      null
    );
  }, [devices, filteredPositions, selectedSession]);

  const completedRequired = sessions.reduce((sum: number, session: any) => sum + patrolSessionProgress(session).completed, 0);
  const totalRequired = sessions.reduce((sum: number, session: any) => sum + patrolSessionProgress(session).total, 0);
  const averageBattery = averageNumber(
    devices
      .map((device: any) => device.battery_level ?? device.metadata?.battery_level)
      .filter((value: unknown): value is number => typeof value === "number")
  );
  const averageGps = averageNumber(
    filteredPositions
      .map((device: any) => device.accuracy)
      .filter((value: unknown): value is number => typeof value === "number")
  );
  const attentionItems = useMemo(() => buildAttentionItems(sessions, devices, activeSosAlerts), [activeSosAlerts, devices, sessions]);
  const timeline = useMemo(() => buildTimeline(scans, mapScans, alerts, sessions), [alerts, mapScans, scans, sessions]);

  return (
    <SocPageShell title="Live Map" subtitle="Real-time tracking of active patrols and devices" realtime={realtime}>
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[260px_180px_180px]">
          <SiteSelector value={siteId} onChange={setSiteId} className="rounded-xl border border-white/10 bg-slate-950/80 px-3 py-2" />
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-slate-200 hover:border-blue-400/30 hover:text-blue-300">
            <Layers className="h-4 w-4" /> Map Options
          </button>
          <button type="button" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-slate-200 hover:border-emerald-400/30 hover:text-emerald-300">
            <Maximize2 className="h-4 w-4" /> Fullscreen
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2">
            <span className="h-2 w-2 rounded-full bg-emerald-400" /> Last updated: {realtime.lastUpdatedAt ? timeLabel(realtime.lastUpdatedAt) : "Waiting"}
          </span>
          <SocStatusPill icon={Wifi} label={realtimeStatusLabel(realtime.status)} tone={realtime.status === "live" ? "green" : "amber"} />
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SocKpiCard title="Active Patrols" value={activeSessions.length} caption="View all" icon={Navigation} tone="green" loading={sessionsLoading} />
        <SocKpiCard title="Devices Online" value={onlineDevices(devices)} caption="Live device positions" icon={Smartphone} tone="blue" />
        <SocKpiCard title="SOS Alerts" value={activeSosAlerts.length} caption={activeSosAlerts.length ? "Requires response" : "All clear"} icon={ShieldAlert} tone={activeSosAlerts.length ? "red" : "neutral"} />
        <SocKpiCard title="Checkpoints" value={`${completedRequired} / ${totalRequired || checkpoints.length}`} caption="Scanned" icon={MapPin} tone="blue" />
        <SocKpiCard title="Battery Health" value={averageBattery == null ? "--" : `${averageBattery}%`} caption="Average" icon={Battery} tone={batteryTone(averageBattery)} />
        <SocKpiCard title="GPS Accuracy" value={averageGps == null ? "Pending" : gpsLabel(averageGps)} caption="All devices" icon={Crosshair} tone={averageGps == null ? "neutral" : averageGps <= 15 ? "green" : "amber"} />
      </div>

      <div className="grid gap-3 xl:grid-cols-[200px_minmax(0,1fr)_300px]">
        <SocPanel title="Map Layers" className="xl:min-h-[560px]">
          <div className="space-y-5">
            <div className="space-y-2">
              {([
                ["activePatrols", "Active Patrols"],
                ["routes", "Patrol Routes"],
                ["checkpoints", "Checkpoints"],
                ["devices", "Device Locations"],
                ["sos", "SOS Alerts"],
                ["geofences", "Geofences"],
              ] as Array<[LayerKey, string]>).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                  <input
                    type="checkbox"
                    checked={layers[key]}
                    onChange={(event) => setLayers((current) => ({ ...current, [key]: event.target.checked }))}
                    className="h-4 w-4 rounded border-white/20 bg-slate-950 accent-emerald-400"
                  />
                  {label}
                </label>
              ))}
            </div>
            <Legend />
          </div>
        </SocPanel>

        <SocPanel
          title="Live Emergency Map"
          action={<span className="inline-flex items-center gap-2 text-xs font-bold text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Live</span>}
          className="min-h-[560px]"
        >
          <div className="h-[520px] overflow-hidden rounded-xl border border-white/10 bg-black/30">
            <Suspense fallback={<LoadingState label="Loading live map..." />}>
              <LiveMap operationsMode showDevices={layers.devices || layers.activePatrols} showRoutes={layers.routes || layers.activePatrols} showCheckpoints={layers.checkpoints} showSos={layers.sos} />
            </Suspense>
          </div>
        </SocPanel>

        <SocPanel title="Patrol Details" action={<button type="button" className="text-slate-400 hover:text-white" aria-label="Clear selection">×</button>}>
          <PatrolDetails session={selectedSession} device={selectedDevice} scans={scans} />
        </SocPanel>
      </div>

      <div className="grid gap-3 xl:grid-cols-[0.9fr_1fr_0.9fr]">
        <SocPanel title="Active Patrols" action={<span className="rounded-full bg-emerald-400/15 px-2 py-1 text-[10px] font-black text-emerald-300">{activeSessions.length}</span>}>
          <div className="space-y-2">
            {(activeSessions.length ? activeSessions : sessions).slice(0, 5).map((session: any) => (
              <button key={session.id} type="button" onClick={() => setSelectedId(session.id)} className="w-full rounded-lg border border-white/5 bg-white/[0.02] p-3 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black text-white">{deviceLabel(session)}</p>
                    <p className="truncate text-xs text-slate-400">{patrolSessionLabel(session)}</p>
                  </div>
                  <ProgressMini session={session} />
                </div>
              </button>
            ))}
            {!sessions.length && <EmptyLine title="No active patrols right now" body="Online device locations and upcoming sessions will appear here." />}
          </div>
        </SocPanel>

        <SocPanel title="Live Timeline">
          <div className="space-y-2">
            {timeline.slice(0, 6).map((item) => <TimelineRow key={item.id} item={item} />)}
            {!timeline.length && <EmptyLine title="No recent map activity" body="Checkpoint scans, SOS alerts and device updates will appear here." />}
          </div>
        </SocPanel>

        <SocPanel title="Attention Required" action={<span className="rounded-full bg-red-400/15 px-2 py-1 text-[10px] font-black text-red-300">{attentionItems.length}</span>}>
          <div className="space-y-2">
            {attentionItems.slice(0, 5).map((item) => <AttentionRow key={item.id} item={item} />)}
            {!attentionItems.length && <EmptyLine title="No active map alerts" body="Delayed patrols, offline devices and SOS events will appear here." />}
            <Link to="/sos-alerts" className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-black text-blue-300 hover:border-blue-400/40">
              View all alerts
            </Link>
          </div>
        </SocPanel>
      </div>
    </SocPageShell>
  );
}

function PatrolDetails({ session, device, scans }: { session: any; device: any; scans: any[] }) {
  if (!session) return <EmptyLine title="Select a patrol or device" body="Details will appear when a patrol session has live activity." />;
  const progress = patrolSessionProgress(session);
  const recentScans = scans.filter((scan: any) => scan.device_identifier === session.device_identifier || scan.patrol_session_id === session.id).slice(0, 4);
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${toneBorder(statusTone(session.status))}`}>
          <Route className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-base font-black text-white">{patrolSessionLabel(session)}</p>
          <p className="text-xs font-semibold text-emerald-300">{deviceLabel(session)}</p>
          <p className="text-xs text-slate-500">{siteName(session)}</p>
        </div>
      </div>
      <DetailBox title="Current Checkpoint" icon={Target} value={currentCheckpointName(session) || "Awaiting first scan"} caption={`Checkpoint ${progress.completed} of ${progress.total || 0}`} tone="green" />
      <DetailBox title="Next Checkpoint" icon={Navigation} value={nextCheckpointName(session) || "Route complete"} caption={etaLabel(session)} tone="blue" />
      <div className="rounded-lg border border-white/10 bg-black/25 p-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-400">Progress</span>
          <span className="font-black text-white">{progress.completed} / {progress.total || 0} Checkpoints</span>
        </div>
        <div className="mt-2"><SocProgressBar value={progress.percent} tone={statusTone(session.status) as any} /></div>
        <p className="mt-1 text-right text-xs font-bold text-slate-400">{progress.percent}%</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <DeviceMetric icon={Battery} label="Battery" value={batteryValue(device)} tone={batteryTone(device?.battery_level)} />
        <DeviceMetric icon={Wifi} label="Network" value={networkValue(device)} tone="green" />
        <DeviceMetric icon={MapPin} label="GPS" value={gpsValue(device)} tone="blue" />
        <DeviceMetric icon={Radio} label="Connection" value={freshnessLabel(device?.last_seen_at)} tone={freshnessTone(device?.last_seen_at)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <ActionLink to="/live-patrol" icon={Eye} label="Open Live Patrol" />
        <ActionLink to={`/session-logs?session=${session.id}`} icon={CalendarClock} label="View Session" />
        <ActionLink to="/sos-alerts" icon={ShieldAlert} label="Open SOS" tone="red" />
        <button type="button" className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] text-[11px] font-black text-slate-300">
          <MessageSquare className="h-4 w-4" /> Send Message
        </button>
      </div>
      <div className="space-y-2">
        <p className="text-xs font-black uppercase tracking-wider text-slate-500">Recent Activity</p>
        {recentScans.map((scan: any) => (
          <div key={scan.id} className="flex items-center justify-between rounded-lg bg-white/[0.03] px-3 py-2 text-xs">
            <span className="text-slate-300">Scanned {scan.checkpoints?.name ?? scan.checkpoint_name ?? "checkpoint"}</span>
            <span className="font-semibold text-emerald-300">{timeLabel(scan.scanned_at)}</span>
          </div>
        ))}
        {!recentScans.length && <p className="text-xs text-slate-500">No recent checkpoint scans for this patrol.</p>}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="space-y-3 border-t border-white/10 pt-4">
      <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Legend</p>
      {[
        ["Active Patrol", "bg-emerald-400"],
        ["Scheduled", "bg-blue-400"],
        ["Delayed", "bg-amber-400"],
        ["SOS / Critical", "bg-red-400"],
        ["Offline", "bg-slate-500"],
        ["Scanned", "bg-emerald-400"],
        ["Pending", "bg-blue-400"],
        ["Current", "bg-amber-400"],
      ].map(([label, color]) => (
        <div key={label} className="flex items-center gap-2 text-xs text-slate-300">
          <span className={`h-2.5 w-2.5 rounded-full ${color}`} /> {label}
        </div>
      ))}
    </div>
  );
}

function ProgressMini({ session }: { session: any }) {
  const progress = patrolSessionProgress(session);
  return (
    <div className="w-24">
      <SocProgressBar value={progress.percent} tone={statusTone(session.status) as any} />
      <p className="mt-1 text-right text-[10px] font-bold text-slate-400">{progress.percent}%</p>
    </div>
  );
}

function DetailBox({ title, icon: Icon, value, caption, tone }: { title: string; icon: ComponentType<{ className?: string }>; value: string; caption: string; tone: Tone }) {
  return (
    <div className={`rounded-lg border ${toneBorder(tone)} bg-white/[0.03] p-3`}>
      <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-wider text-slate-500"><Icon className="h-4 w-4" /> {title}</div>
      <p className="mt-2 font-black text-white">{value}</p>
      <p className="text-xs text-slate-400">{caption}</p>
    </div>
  );
}

function DeviceMetric({ icon: Icon, label, value, tone }: { icon: ComponentType<{ className?: string }>; label: string; value: string; tone: Tone }) {
  return (
    <div className={`rounded-lg border ${toneBorder(tone)} bg-black/20 p-3 text-center`}>
      <Icon className="mx-auto h-4 w-4 text-slate-300" />
      <p className="mt-2 text-sm font-black text-white">{value}</p>
      <p className="text-[10px] text-slate-500">{label}</p>
    </div>
  );
}

function ActionLink({ to, icon: Icon, label, tone = "blue" }: { to: string; icon: ComponentType<{ className?: string }>; label: string; tone?: Tone }) {
  return (
    <Link to={to} className={`inline-flex h-10 items-center justify-center gap-2 rounded-lg border ${toneBorder(tone)} bg-white/[0.03] text-[11px] font-black ${toneText(tone)}`}>
      <Icon className="h-4 w-4" /> {label}
    </Link>
  );
}

function TimelineRow({ item }: { item: { id: string; title: string; subtitle: string; time: string; tone: Tone; icon: ComponentType<{ className?: string }> } }) {
  const Icon = item.icon;
  return (
    <div className="flex items-start gap-3 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2">
      <span className={`mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${toneBg(item.tone)}`}><Icon className="h-3.5 w-3.5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-white">{item.title}</p>
        <p className="truncate text-xs text-slate-400">{item.subtitle}</p>
      </div>
      <span className="text-[10px] font-semibold text-slate-500">{item.time}</span>
    </div>
  );
}

function AttentionRow({ item }: { item: { id: string; title: string; subtitle: string; time: string; tone: Tone } }) {
  return (
    <div className={`rounded-lg border ${toneBorder(item.tone)} bg-white/[0.03] px-3 py-2`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{item.title}</p>
          <p className="text-xs text-slate-400">{item.subtitle}</p>
        </div>
        <span className={`text-[10px] font-black ${toneText(item.tone)}`}>{item.time}</span>
      </div>
    </div>
  );
}

function EmptyLine({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-black/20 p-4 text-center">
      <p className="font-black text-white">{title}</p>
      <p className="mt-1 text-xs text-slate-500">{body}</p>
    </div>
  );
}

function buildTimeline(scans: any[], mapScans: any[], alerts: any[], sessions: any[]) {
  const rows = [
    ...scans.map((scan: any) => ({
      id: `scan-${scan.id}`,
      title: `${scan.device_identifier ?? scan.device_id ?? "Device"} scanned ${scan.checkpoints?.name ?? "checkpoint"}`,
      subtitle: scan.tag_status === "registered" ? "Registered checkpoint" : "Unregistered or pending checkpoint",
      time: timeAgo(scan.scanned_at),
      tone: scan.tag_status === "registered" ? "green" as Tone : "amber" as Tone,
      icon: scan.tag_status === "registered" ? CheckCircle2 : AlertTriangle,
      at: scan.scanned_at,
    })),
    ...mapScans.map((scan: any) => ({
      id: `map-scan-${scan.id}`,
      title: `${scan.device_name ?? "Device"} location updated`,
      subtitle: scan.checkpoint_name ?? "Latest GPS scan point",
      time: timeAgo(scan.scanned_at),
      tone: "blue" as Tone,
      icon: LocateFixed,
      at: scan.scanned_at,
    })),
    ...alerts.filter((alert: any) => alert.type === "panic_button").map((alert: any) => ({
      id: `sos-${alert.id}`,
      title: "SOS alert triggered",
      subtitle: alert.message ?? "Panic button alert",
      time: timeAgo(alert.created_at),
      tone: "red" as Tone,
      icon: ShieldAlert,
      at: alert.created_at,
    })),
    ...sessions.filter((session: any) => completedStatuses.has(String(session.status ?? "").toLowerCase())).map((session: any) => ({
      id: `session-${session.id}`,
      title: "Patrol completed",
      subtitle: `${patrolSessionLabel(session)} - ${deviceLabel(session)}`,
      time: timeAgo(session.actual_end ?? session.updated_at ?? session.scheduled_end),
      tone: "green" as Tone,
      icon: CheckCircle2,
      at: session.actual_end ?? session.updated_at ?? session.scheduled_end,
    })),
  ];
  const seen = new Set<string>();
  return rows
    .sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())
    .filter((row) => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
}

function buildAttentionItems(sessions: any[], devices: any[], alerts: any[]) {
  return [
    ...alerts.map((alert: any) => ({ id: `sos-${alert.id}`, title: "SOS alert active", subtitle: alert.message ?? "Panic button requires response", time: timeAgo(alert.created_at), tone: "red" as Tone })),
    ...sessions.filter((session: any) => delayedStatuses.has(String(session.status ?? "").toLowerCase()) || missedStatuses.has(String(session.status ?? "").toLowerCase())).map((session: any) => ({
      id: `session-${session.id}`,
      title: `${patrolSessionLabel(session)} ${titleCase(String(session.status ?? "delayed"))}`,
      subtitle: `${deviceLabel(session)} - ${siteName(session)}`,
      time: timeAgo(session.updated_at ?? session.scheduled_start),
      tone: missedStatuses.has(String(session.status ?? "").toLowerCase()) ? "red" as Tone : "amber" as Tone,
    })),
    ...devices.filter((device: any) => isOffline(device)).map((device: any) => ({
      id: `device-${device.id}`,
      title: `${device.device_name ?? "Device"} offline`,
      subtitle: device.sites?.name ?? device.site_name ?? device.device_identifier ?? "No site assigned",
      time: timeAgo(device.last_seen_at),
      tone: "red" as Tone,
    })),
    ...devices.filter((device: any) => Number(device.battery_level ?? device.metadata?.battery_level ?? 100) <= 20).map((device: any) => ({
      id: `battery-${device.id}`,
      title: `${device.device_name ?? "Device"} low battery`,
      subtitle: `${device.battery_level ?? device.metadata?.battery_level}% remaining`,
      time: timeAgo(device.last_seen_at),
      tone: "amber" as Tone,
    })),
  ];
}

function currentCheckpointName(session: any) {
  const checkpoints = orderedSessionCheckpoints(session);
  return checkpoints.find((checkpoint: any) => checkpoint.status === "scanned")?.checkpoints?.name ?? checkpoints[0]?.checkpoints?.name ?? null;
}

function nextCheckpointName(session: any) {
  return orderedSessionCheckpoints(session).find((checkpoint: any) => checkpoint.status !== "scanned")?.checkpoints?.name ?? null;
}

function orderedSessionCheckpoints(session: any) {
  return [...(session?.patrol_session_checkpoints ?? [])].sort((a: any, b: any) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0));
}

function etaLabel(session: any) {
  const next = nextCheckpointName(session);
  if (!next) return "Route complete";
  if (!session?.scheduled_end) return "ETA pending";
  const minutes = Math.max(0, Math.round((new Date(session.scheduled_end).getTime() - Date.now()) / 60000));
  return minutes ? `ETA ${minutes} min` : "Due now";
}

function siteName(session: any) {
  return session?.sites?.name ?? session?.site_name ?? "Unassigned site";
}

function deviceLabel(session: any) {
  return session?.device_name ?? shortDevice(session?.device_identifier) ?? "Unassigned device";
}

function shortDevice(value?: string | null) {
  if (!value) return null;
  if (value.startsWith("mxp-")) return `RG360-${value.slice(-6).toUpperCase()}`;
  return value;
}

function onlineDevices(devices: any[]) {
  return devices.filter((device: any) => !isOffline(device)).length;
}

function isOffline(device: any) {
  const status = String(device?.status ?? "").toLowerCase();
  if (["offline", "retired", "blocked", "wiped"].includes(status)) return true;
  if (!device?.last_seen_at) return false;
  return Date.now() - new Date(device.last_seen_at).getTime() > 15 * 60 * 1000;
}

function freshnessLabel(value?: string | null) {
  if (!value) return "Pending";
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return "Live";
  if (diff < 5 * 60_000) return "Recent";
  if (diff < 15 * 60_000) return "Stale";
  return "Offline";
}

function freshnessTone(value?: string | null): Tone {
  const label = freshnessLabel(value);
  if (label === "Live" || label === "Recent") return "green";
  if (label === "Stale") return "amber";
  return "red";
}

function statusTone(status?: string | null): Tone {
  const normalized = String(status ?? "").toLowerCase();
  if (missedStatuses.has(normalized)) return "red";
  if (delayedStatuses.has(normalized)) return "amber";
  if (activeStatuses.has(normalized) || completedStatuses.has(normalized)) return "green";
  return "blue";
}

function batteryValue(device: any) {
  const value = device?.battery_level ?? device?.metadata?.battery_level;
  return typeof value === "number" ? `${value}%` : "--";
}

function networkValue(device: any) {
  return device?.network_status ?? device?.metadata?.network ?? "Online";
}

function gpsValue(device: any) {
  return typeof device?.accuracy === "number" ? `${Math.round(device.accuracy)}m` : device?.current_gps_accuracy ? `${Math.round(device.current_gps_accuracy)}m` : "Good";
}

function averageNumber(values: number[]) {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function batteryTone(value: number | null): Tone {
  if (value == null) return "neutral";
  if (value <= 20) return "red";
  if (value <= 50) return "amber";
  return "green";
}

function gpsLabel(value: number) {
  if (value <= 15) return "Good";
  if (value <= 50) return "Fair";
  return "Weak";
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(value?: string | null) {
  if (!value) return "Pending";
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function toneBorder(tone: Tone) {
  if (tone === "red") return "border-red-400/25";
  if (tone === "amber") return "border-amber-400/25";
  if (tone === "blue") return "border-blue-400/25";
  if (tone === "green") return "border-emerald-400/25";
  return "border-white/10";
}

function toneText(tone: Tone) {
  if (tone === "red") return "text-red-300";
  if (tone === "amber") return "text-amber-300";
  if (tone === "blue") return "text-blue-300";
  if (tone === "green") return "text-emerald-300";
  return "text-slate-300";
}

function toneBg(tone: Tone) {
  if (tone === "red") return "bg-red-400/15 text-red-300";
  if (tone === "amber") return "bg-amber-400/15 text-amber-300";
  if (tone === "blue") return "bg-blue-400/15 text-blue-300";
  if (tone === "green") return "bg-emerald-400/15 text-emerald-300";
  return "bg-white/10 text-slate-300";
}


