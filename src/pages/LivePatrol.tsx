/* eslint-disable @typescript-eslint/no-explicit-any */
import { lazy, Suspense, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Battery,
  CheckCircle2,
  Clock3,
  Eye,
  FileText,
  Map as MapIcon,
  MapPin,
  MoreHorizontal,
  Radio,
  Route,
  ShieldAlert,
  Smartphone,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAlerts, useDevices, useRealtimeSubscriptions, useScanLogs } from "@/hooks/useDashboardData";
import { patrolScanCheckpointName, useLivePatrolScans } from "@/hooks/usePatrolScanData";
import { patrolSessionLabel, patrolSessionProgress, usePatrolSessions } from "@/hooks/useScheduledPatrols";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { SocKpiCard, SocPageShell, SocPanel, SocProgressBar } from "@/components/dashboard/SocComponents";

const LiveMap = lazy(() => import("@/components/dashboard/LiveMap"));

const liveStatuses = new Set(["awaiting_start", "active", "in_progress", "late_start", "delayed"]);
const healthyStatuses = new Set(["active", "in_progress"]);
const lateStatuses = new Set(["late_start", "delayed", "completed_late"]);
const missedStatuses = new Set(["missed", "incomplete"]);

const statusTone: Record<string, "green" | "blue" | "amber" | "red" | "neutral"> = {
  awaiting_start: "blue",
  active: "green",
  in_progress: "green",
  moving: "blue",
  late_start: "amber",
  delayed: "amber",
  completed_late: "amber",
  missed: "red",
  incomplete: "red",
  completed: "green",
  scheduled: "neutral",
};

function displayDeviceName(value?: string | null) {
  if (!value) return "Any paired device";
  if (value.startsWith("mxp-")) return `RG360-${value.slice(-6).toUpperCase()}`;
  return value;
}

function displayStatus(value?: string | null) {
  return String(value ?? "scheduled").replace(/_/g, " ");
}

function formatTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date);
}

function relativeTime(value?: string | null) {
  if (!value) return "No activity yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No activity yet";
  return formatDistanceToNow(date, { addSuffix: true });
}

function durationSince(value?: string | null) {
  if (!value) return "-";
  const started = new Date(value).getTime();
  if (Number.isNaN(started)) return "-";
  const minutes = Math.max(0, Math.round((Date.now() - started) / 60000));
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function sessionCheckpoints(session: any) {
  return [...(session?.patrol_session_checkpoints ?? [])].sort(
    (a, b) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0)
  );
}

function checkpointName(checkpoint: any) {
  return checkpoint?.checkpoints?.name ?? checkpoint?.checkpoint_name ?? "Checkpoint";
}

function currentCheckpoint(session: any, latestScan?: any) {
  const checkpoints = sessionCheckpoints(session);
  const scanned = [...checkpoints].reverse().find((item) => item.scanned_at || item.status === "scanned" || item.status === "completed");
  const active = checkpoints.find((item) => ["active", "current", "in_progress"].includes(String(item.status ?? "")));
  return scanned ? checkpointName(scanned) : active ? checkpointName(active) : latestScan ? patrolScanCheckpointName(latestScan) : "Awaiting first scan";
}

function nextCheckpoint(session: any) {
  const upcoming = sessionCheckpoints(session).find((item) => !item.scanned_at && !["scanned", "completed"].includes(String(item.status ?? "")));
  return upcoming ? checkpointName(upcoming) : "Route complete";
}

function sessionDevice(session: any, devices: any[]) {
  return (
    devices.find((device) => session.device_identifier && device.device_identifier === session.device_identifier) ??
    devices.find((device) => session.device_id && device.id === session.device_id) ??
    null
  );
}

function latestSessionScan(session: any, scans: any[]) {
  return scans.find(
    (scan) =>
      (scan.patrol_session_id && scan.patrol_session_id === session.id) ||
      (session.device_identifier && scan.device_identifier === session.device_identifier)
  );
}

function sessionLastActivity(session: any, latestScan?: any) {
  return latestScan?.scanned_at ?? session.last_scan_at ?? session.actual_start ?? session.started_at ?? session.updated_at ?? session.scheduled_start;
}

function sessionSiteName(session: any, device?: any) {
  return session.sites?.name ?? device?.sites?.name ?? "Unassigned site";
}

function sessionStatusLabel(session: any, latestScan?: any) {
  if (latestScan?.scanned_at) {
    const ageMs = Date.now() - new Date(latestScan.scanned_at).getTime();
    if (ageMs <= 2 * 60 * 1000 && healthyStatuses.has(String(session.status))) return "moving";
  }
  return String(session.status ?? "scheduled");
}

function toneClasses(tone: "green" | "blue" | "amber" | "red" | "neutral") {
  if (tone === "red") return "border-red-400/30 bg-red-400/10 text-red-300";
  if (tone === "amber") return "border-amber-400/30 bg-amber-400/10 text-amber-300";
  if (tone === "blue") return "border-blue-400/30 bg-blue-400/10 text-blue-300";
  if (tone === "green") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300";
  return "border-white/10 bg-white/5 text-slate-300";
}

export default function LivePatrol() {
  useRealtimeSubscriptions();
  const realtime = useRealtimeConnectionStatus("live-patrol-page");
  const [siteFilter, setSiteFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

  const { data: devices = [], isLoading: devicesLoading } = useDevices(siteFilter);
  const { data: scans = [], isLoading: scansLoading } = useScanLogs(siteFilter);
  const { data: liveScans = [] } = useLivePatrolScans(80, siteFilter);
  const { data: sessions = [], isLoading: sessionsLoading } = usePatrolSessions(160, siteFilter);
  const { data: alerts = [], isLoading: alertsLoading } = useAlerts();

  const loading = devicesLoading || scansLoading || sessionsLoading || alertsLoading;

  const siteOptions = useMemo(() => {
    const sites = new Map<string, string>();
    sessions.forEach((session: any) => {
      if (session.site_id) sites.set(session.site_id, session.sites?.name ?? "Unnamed site");
    });
    devices.forEach((device: any) => {
      if (device.site_id) sites.set(device.site_id, device.sites?.name ?? "Unnamed site");
    });
    return Array.from(sites.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [devices, sessions]);

  const activeSessions = useMemo(
    () => sessions.filter((session: any) => liveStatuses.has(String(session.status ?? ""))),
    [sessions]
  );

  const visibleSessions = useMemo(() => {
    const term = search.trim().toLowerCase();
    return sessions
      .filter((session: any) => (statusFilter === "active" ? liveStatuses.has(String(session.status ?? "")) : statusFilter === "all" || session.status === statusFilter))
      .filter((session: any) => deviceFilter === "all" || session.device_identifier === deviceFilter || session.device_id === deviceFilter)
      .filter((session: any) => {
        if (!term) return true;
        const device = sessionDevice(session, devices);
        const latest = latestSessionScan(session, scans);
        const haystack = [
          patrolSessionLabel(session),
          displayDeviceName(device?.device_name ?? session.device_name ?? session.device_identifier),
          sessionSiteName(session, device),
          currentCheckpoint(session, latest),
          displayStatus(session.status),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      })
      .slice(0, 18);
  }, [deviceFilter, devices, scans, search, sessions, statusFilter]);

  const selectedSession =
    visibleSessions.find((session: any) => session.id === selectedSessionId) ??
    visibleSessions[0] ??
    activeSessions[0] ??
    null;
  const selectedDevice = selectedSession ? sessionDevice(selectedSession, devices) : null;
  const selectedLatestScan = selectedSession ? latestSessionScan(selectedSession, scans) : null;
  const selectedProgress = selectedSession ? patrolSessionProgress(selectedSession) : { completed: 0, total: 0, percent: 0 };

  const onlineDevices = devices.filter((device: any) => device.status === "online").length;
  const devicesPatrolling = new Set(activeSessions.map((session: any) => session.device_identifier ?? session.device_id).filter(Boolean)).size;
  const delayedCount = activeSessions.filter((session: any) => lateStatuses.has(String(session.status ?? ""))).length;
  const missedCount = sessions.filter((session: any) => missedStatuses.has(String(session.status ?? ""))).length;
  const activeSos = alerts.filter((alert: any) => alert.type === "panic_button" && !alert.is_read).length;
  const complianceBase = sessions.filter((session: any) => !["cancelled", "paused"].includes(String(session.status ?? "")));
  const compliantCount = complianceBase.filter((session: any) => ["completed", "completed_late"].includes(String(session.status ?? ""))).length;
  const compliance = complianceBase.length ? Math.round((compliantCount / complianceBase.length) * 100) : Math.round(activeSessions.reduce((sum: number, session: any) => sum + patrolSessionProgress(session).percent, 0) / Math.max(activeSessions.length, 1));

  const nextScheduled = sessions
    .filter((session: any) => ["scheduled", "awaiting_start"].includes(String(session.status ?? "")))
    .sort((a: any, b: any) => new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime())[0];

  const timelineItems = selectedSession ? sessionCheckpoints(selectedSession) : [];

  return (
    <SocPageShell title="Live Patrol" subtitle="Real-time monitoring of active patrol sessions and RG360 device activity." realtime={realtime}>
      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 lg:flex-row lg:items-end">
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Site
          <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-emerald-400/50">
            <option value="all">All Sites</option>
            {siteOptions.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Status
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-emerald-400/50">
            <option value="active">Active Patrols</option>
            <option value="all">All Sessions</option>
            <option value="awaiting_start">Awaiting Start</option>
            <option value="in_progress">In Progress</option>
            <option value="delayed">Delayed</option>
            <option value="missed">Missed</option>
            <option value="completed">Completed</option>
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold text-slate-400">
          Device
          <select value={deviceFilter} onChange={(event) => setDeviceFilter(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none focus:border-emerald-400/50">
            <option value="all">All Devices</option>
            {devices.map((device: any) => (
              <option key={device.id} value={device.device_identifier ?? device.id}>{displayDeviceName(device.device_name ?? device.device_identifier)}</option>
            ))}
          </select>
        </label>
        <label className="grid min-w-0 flex-1 gap-1 text-xs font-semibold text-slate-400">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search patrol, device, site, checkpoint..." className="h-10 rounded-lg border border-white/10 bg-black/40 px-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-emerald-400/50" />
        </label>
        <div className="flex items-center gap-2 text-xs font-bold text-slate-400 lg:ml-auto">
          <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_12px_rgba(52,211,153,0.65)]" />
          Last updated: {realtime.lastUpdatedAt ? formatTime(realtime.lastUpdatedAt) : "live"}
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SocKpiCard title="Active Patrols" value={activeSessions.length} caption="Now" icon={Route} tone="green" loading={loading} />
        <SocKpiCard title="Devices Online" value={onlineDevices} caption="All systems" icon={Smartphone} tone="blue" loading={loading} />
        <SocKpiCard title="Devices Patrolling" value={devicesPatrolling} caption="In progress" icon={Radio} tone="blue" loading={loading} />
        <SocKpiCard title="Delayed / Late" value={delayedCount} caption={delayedCount ? "Needs attention" : "On schedule"} icon={Clock3} tone={delayedCount ? "amber" : "green"} loading={loading} />
        <SocKpiCard title="SOS Alerts" value={activeSos} caption={activeSos ? "Respond now" : "All clear"} icon={ShieldAlert} tone={activeSos ? "red" : "green"} loading={loading} />
        <SocKpiCard title="Compliance" value={`${compliance}%`} caption={missedCount ? `${missedCount} missed/incomplete` : "Good"} icon={CheckCircle2} tone={compliance >= 85 ? "green" : compliance >= 65 ? "amber" : "red"} loading={loading} />
      </section>

      <SocPanel title="Live Timeline" action={<span className="text-xs font-bold text-blue-300">Selected patrol</span>}>
        {selectedSession ? (
          <div className="flex gap-4 overflow-x-auto px-2 py-3">
            <div className="flex min-w-[120px] flex-col gap-1">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-400 text-black"><Radio className="h-4 w-4" /></span>
              <p className="text-xs font-black text-white">Started</p>
              <p className="text-[11px] text-slate-400">{formatTime(selectedSession.actual_start ?? selectedSession.scheduled_start)}</p>
            </div>
            {timelineItems.slice(0, 8).map((item: any, index) => {
              const done = !!item.scanned_at || ["scanned", "completed"].includes(String(item.status ?? ""));
              const isNext = !done && checkpointName(item) === nextCheckpoint(selectedSession);
              return (
                <div key={item.id ?? item.checkpoint_id ?? index} className="flex min-w-[145px] flex-col gap-1 border-l border-white/10 pl-4">
                  <span className={`flex h-9 w-9 items-center justify-center rounded-full ${done ? "bg-emerald-400 text-black" : isNext ? "border border-blue-400 bg-blue-400/15 text-blue-200" : "border border-slate-600 text-slate-400"}`}>
                    {done ? <CheckCircle2 className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
                  </span>
                  <p className="text-xs font-black text-white">{checkpointName(item)}</p>
                  <p className="text-[11px] text-slate-400">{done ? formatTime(item.scanned_at) : isNext ? "Next" : "Pending"}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/25 p-6 text-center">
            <p className="text-lg font-black text-white">No Active Patrols</p>
            <p className="mt-1 text-sm text-slate-400">Waiting for the next scheduled patrol session.</p>
            {nextScheduled && <p className="mt-3 text-xs font-bold text-emerald-300">Next: {patrolSessionLabel(nextScheduled)} at {formatTime(nextScheduled.scheduled_start)}</p>}
          </div>
        )}
      </SocPanel>

      <section className="grid gap-4 2xl:grid-cols-[1fr_310px]">
        <SocPanel title={`Active Patrols (${visibleSessions.length})`} action={<Link to="/session-logs" className="text-xs font-bold text-blue-400 hover:text-blue-300">View Sessions</Link>}>
          <div className="overflow-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-3 py-2">Patrol</th>
                  <th className="px-3 py-2">Device</th>
                  <th className="px-3 py-2">Site</th>
                  <th className="px-3 py-2">Progress</th>
                  <th className="px-3 py-2">Current Checkpoint</th>
                  <th className="px-3 py-2">Last Activity</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {visibleSessions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center">
                      <p className="text-base font-black text-white">No active patrols right now</p>
                      <p className="mt-1 text-sm text-slate-500">Scheduled patrols will appear here when they start or become due.</p>
                    </td>
                  </tr>
                )}
                {visibleSessions.map((session: any) => {
                  const device = sessionDevice(session, devices);
                  const latest = latestSessionScan(session, scans) ?? liveScans.find((scan: any) => scan.device_identifier === session.device_identifier);
                  const progress = patrolSessionProgress(session);
                  const lastActivity = sessionLastActivity(session, latest);
                  const label = sessionStatusLabel(session, latest);
                  const tone = statusTone[label] ?? statusTone[session.status] ?? "neutral";
                  return (
                    <tr key={session.id} className={`cursor-pointer transition hover:bg-white/[0.03] ${selectedSession?.id === session.id ? "bg-emerald-400/[0.04]" : ""}`} onClick={() => setSelectedSessionId(session.id)}>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-3">
                          <span className={`h-2.5 w-2.5 rounded-full ${tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : tone === "blue" ? "bg-blue-400" : "bg-emerald-400"}`} />
                          <div>
                            <p className="font-black text-white">{patrolSessionLabel(session)}</p>
                            <p className="text-xs text-slate-500">Schedule: {session.patrol_schedules?.name ?? "On demand"}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-bold text-white">{displayDeviceName(device?.device_name ?? session.device_name ?? session.device_identifier)}</p>
                        <p className={`text-xs font-bold ${device?.status === "online" ? "text-emerald-300" : "text-slate-500"}`}>{device?.status ?? "assigned"}</p>
                      </td>
                      <td className="px-3 py-3 text-slate-300">{sessionSiteName(session, device)}</td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <SocProgressBar value={progress.percent} tone={tone === "red" ? "red" : tone === "amber" ? "amber" : "green"} />
                          <span className="w-20 text-xs text-slate-400">{progress.completed}/{progress.total} ({progress.percent}%)</span>
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-semibold text-white">{currentCheckpoint(session, latest)}</p>
                        <p className="text-xs text-slate-500">Next: {nextCheckpoint(session)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-slate-300">{relativeTime(lastActivity)}</p>
                        <p className="text-xs text-slate-500">{formatTime(lastActivity)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`rounded-md border px-2 py-1 text-xs font-black uppercase ${toneClasses(tone)}`}>{displayStatus(label)}</span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex justify-end gap-2">
                          <Link to={`/session-logs?session=${session.id}`} className="rounded-md border border-white/10 p-2 text-slate-300 hover:border-emerald-400/40 hover:text-emerald-300" onClick={(event) => event.stopPropagation()} aria-label="Open session"><Eye className="h-4 w-4" /></Link>
                          <Link to={`/live-map?device=${session.device_identifier ?? ""}`} className="rounded-md border border-white/10 p-2 text-slate-300 hover:border-blue-400/40 hover:text-blue-300" onClick={(event) => event.stopPropagation()} aria-label="Open map"><MapIcon className="h-4 w-4" /></Link>
                          <button type="button" className="rounded-md border border-white/10 p-2 text-slate-300" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SocPanel>

        <SocPanel title="Patrol Details" action={selectedSession ? <button type="button" onClick={() => setSelectedSessionId(null)} className="text-slate-500 hover:text-white">x</button> : null}>
          {selectedSession ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-emerald-400/20 bg-emerald-400/[0.08] p-4">
                <div className="flex items-start gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-400/15 text-emerald-300"><Route className="h-5 w-5" /></span>
                  <div>
                    <p className="font-black text-white">{patrolSessionLabel(selectedSession)}</p>
                    <p className="text-xs font-bold text-emerald-300">{displayDeviceName(selectedDevice?.device_name ?? selectedSession.device_name ?? selectedSession.device_identifier)}</p>
                  </div>
                </div>
                <div className="mt-4 space-y-2">
                  <SocProgressBar value={selectedProgress.percent} tone={lateStatuses.has(String(selectedSession.status)) ? "amber" : "green"} />
                  <div className="flex justify-between text-xs text-slate-400"><span>{selectedProgress.completed} / {selectedProgress.total}</span><span>{selectedProgress.percent}%</span></div>
                </div>
              </div>

              <dl className="grid gap-3 text-sm">
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Site</dt><dd className="text-right font-semibold text-white">{sessionSiteName(selectedSession, selectedDevice)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Started</dt><dd className="text-right text-slate-300">{formatTime(selectedSession.actual_start ?? selectedSession.scheduled_start)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Duration</dt><dd className="text-right text-slate-300">{durationSince(selectedSession.actual_start ?? selectedSession.scheduled_start)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Current checkpoint</dt><dd className="text-right font-semibold text-white">{currentCheckpoint(selectedSession, selectedLatestScan)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Next checkpoint</dt><dd className="text-right text-slate-300">{nextCheckpoint(selectedSession)}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Last activity</dt><dd className="text-right text-slate-300">{relativeTime(sessionLastActivity(selectedSession, selectedLatestScan))}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Battery</dt><dd className={`text-right font-bold ${Number(selectedDevice?.battery_level ?? 100) <= 20 ? "text-amber-300" : "text-emerald-300"}`}>{selectedDevice?.battery_level != null ? `${selectedDevice.battery_level}%` : "Unknown"}</dd></div>
                <div className="flex justify-between gap-4"><dt className="text-slate-500">Network</dt><dd className="text-right text-slate-300">{selectedDevice?.status === "online" ? "Online" : selectedDevice?.status ?? "Unknown"}</dd></div>
              </dl>

              <div className="grid grid-cols-2 gap-2">
                <Link to={`/live-map?device=${selectedSession.device_identifier ?? ""}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-xs font-black text-emerald-300 hover:bg-emerald-400/15"><MapIcon className="h-4 w-4" /> View Map</Link>
                <Link to={`/session-logs?session=${selectedSession.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-blue-400/25 bg-blue-400/10 text-xs font-black text-blue-300 hover:bg-blue-400/15"><FileText className="h-4 w-4" /> Session</Link>
                <Link to={`/scan-logs?patrol_session_id=${selectedSession.id}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-purple-400/25 bg-purple-400/10 text-xs font-black text-purple-300 hover:bg-purple-400/15"><Radio className="h-4 w-4" /> Timeline</Link>
                <Link to={`/sos-alerts?device=${selectedSession.device_identifier ?? ""}`} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-400/25 bg-red-400/10 text-xs font-black text-red-300 hover:bg-red-400/15"><ShieldAlert className="h-4 w-4" /> SOS</Link>
              </div>

              <div className="rounded-lg border border-white/10 bg-black/25 p-3">
                <p className="mb-2 text-xs font-black uppercase tracking-wider text-slate-400">Recent Activity</p>
                <div className="space-y-2">
                  {liveScans.filter((scan: any) => scan.device_identifier === selectedSession.device_identifier).slice(0, 4).map((scan: any) => (
                    <div key={scan.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate text-slate-300">Scanned {patrolScanCheckpointName(scan)}</span>
                      <span className="text-emerald-300"><CheckCircle2 className="h-4 w-4" /></span>
                    </div>
                  ))}
                  {!liveScans.some((scan: any) => scan.device_identifier === selectedSession.device_identifier) && <p className="text-xs text-slate-500">No scan activity yet.</p>}
                </div>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-white/10 bg-black/25 p-6 text-center text-sm text-slate-500">Select an active patrol to view device, checkpoint, and response details.</div>
          )}
        </SocPanel>
      </section>

      <section className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <SocPanel title="Devices Offline" action={<span className="text-xs font-bold text-red-300">{devices.filter((device: any) => device.status !== "online").length} offline</span>}>
          <div className="grid gap-3 sm:grid-cols-2">
            {devices.filter((device: any) => device.status !== "online").slice(0, 4).map((device: any) => (
              <div key={device.id} className="rounded-lg border border-white/10 bg-black/25 p-4">
                <p className="font-black text-white">{displayDeviceName(device.device_name ?? device.device_identifier)}</p>
                <p className="mt-2 text-xs text-slate-500">Last seen: {relativeTime(device.last_seen_at)}</p>
                <p className="mt-2 flex items-center gap-2 text-xs text-slate-400"><MapPin className="h-3.5 w-3.5" /> {device.sites?.name ?? "Unassigned"}</p>
                <p className="mt-2 flex items-center gap-2 text-xs font-bold text-red-300"><Battery className="h-3.5 w-3.5" /> {device.battery_level != null ? `${device.battery_level}%` : "Battery unknown"}</p>
              </div>
            ))}
            {!devices.some((device: any) => device.status !== "online") && <p className="text-sm text-emerald-300">All assigned devices are online.</p>}
          </div>
        </SocPanel>

        <SocPanel title="Live Device Map" action={<Link to="/live-map" className="text-xs font-bold text-blue-400 hover:text-blue-300">Open full map</Link>}>
          <div className="min-h-[330px] overflow-hidden rounded-lg">
            <Suspense fallback={<div className="flex h-[330px] items-center justify-center text-sm text-slate-500">Loading live map...</div>}>
              <LiveMap />
            </Suspense>
          </div>
        </SocPanel>
      </section>
    </SocPageShell>
  );
}


