import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Bell, Brain, Camera, CheckCircle2, ClipboardCheck, Clock3, FileText, MapPin, Radio, RefreshCw, Route, ScanLine, ShieldAlert, ShieldCheck, Smartphone, UserCheck, Wifi, Zap } from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { getSiteName, useSites } from "@/hooks/useSites";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";
import LiveMap from "@/components/dashboard/LiveMap";
import { patrolSessionLabel, patrolSessionProgress, usePatrolSessions } from "@/hooks/useScheduledPatrols";

type DateRange = "today" | "7d" | "30d";
type Severity = "normal" | "info" | "warning" | "critical" | "offline";
type IconComponent = ComponentType<{ className?: string }>;
type AnyRow = Record<string, any>;
type QueryResponse = { data?: unknown; error?: { message?: string } | null };
type QueryBuilder = PromiseLike<QueryResponse> & { select: (columns: string) => QueryBuilder; eq: (column: string, value: unknown) => QueryBuilder; gte: (column: string, value: string) => QueryBuilder; order: (column: string, options?: { ascending?: boolean }) => QueryBuilder; limit: (count: number) => QueryBuilder; maybeSingle: () => QueryBuilder };
type SupabaseQueryClient = { from: (table: string) => QueryBuilder };
type ActivityEvent = { id: string; title: string; subtitle?: string; site?: string; route: string; timestamp?: string | null; severity: Severity };
type AttentionItem = { id: string; title: string; subject: string; site: string; state: string; route: string; timestamp?: string | null; severity: "warning" | "critical" | "offline" };
type OverviewData = { companyName: string; scans: AnyRow[]; reports: AnyRow[]; reportJobs: AnyRow[]; alerts: AnyRow[]; incidents: AnyRow[]; devices: AnyRow[]; checkpoints: AnyRow[]; pendingTags: AnyRow[]; cameras: AnyRow[]; cameraEvents: AnyRow[]; aiInsights: AnyRow[] };

const db = supabase as unknown as SupabaseQueryClient;
const dateRangeStart = (range: DateRange) => { const date = new Date(); if (range === "today") date.setHours(0, 0, 0, 0); if (range === "7d") date.setDate(date.getDate() - 7); if (range === "30d") date.setDate(date.getDate() - 30); return date.toISOString(); };

export default function CommandCenter() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { data: companyId, isLoading: companyLoading } = useCompanyId();
  const { data: sites = [] } = useSites();
  const [siteId, setSiteId] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("today");
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const realtime = useRealtimeConnectionStatus("command-center");
  const periodStart = useMemo(() => dateRangeStart(dateRange), [dateRange]);
  const overview = useQuery({ queryKey: ["command-center-overview", companyId, siteId, dateRange], enabled: !!companyId, staleTime: 15_000, queryFn: async () => fetchCommandCenterOverview(companyId!, siteId, periodStart) });
  const { data: sessions = [], isLoading: sessionsLoading, error: sessionsError } = usePatrolSessions(80, siteId);

  useEffect(() => {
    if (!companyId) return;
    const tables = ["scan_logs", "alerts", "incidents", "patrol_sessions", "patrol_session_checkpoints", "devices", "pending_nfc_tags", "checkpoints", "ai_reports", "report_jobs", "ai_insights", "cameras", "camera_events"];
    const channel = supabase.channel(`command-center-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    tables.forEach((table) => channel.on("postgres_changes", { event: "*", schema: "public", table, filter: `company_id=eq.${companyId}` }, (payload) => {
      console.info("[Command Center] realtime event received", { table, eventType: payload.eventType });
      setLastUpdated(new Date());
      void queryClient.invalidateQueries({ queryKey: ["command-center-overview", companyId] });
      void queryClient.invalidateQueries({ queryKey: ["patrol_sessions", companyId] });
    }));
    channel.subscribe((status) => { if (status === "CHANNEL_ERROR") console.warn("[Command Center] realtime channel failed"); });
    return () => { void supabase.removeChannel(channel); };
  }, [companyId, queryClient]);
  useEffect(() => { if (overview.data) setLastUpdated(new Date()); }, [overview.data]);

  const selectedSiteName = siteId === "all" ? "All Sites" : getSiteName(siteId, sites);
  const model = useMemo(() => buildOperationsModel(overview.data, sessions, periodStart, selectedSiteName), [overview.data, sessions, periodStart, selectedSiteName]);
  const loading = overview.isLoading || companyLoading;
  const pageError = overview.error || sessionsError;

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.10),transparent_30%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.10),transparent_32%),linear-gradient(180deg,rgba(2,6,23,0.98),rgba(2,8,23,1))] pb-5 text-white">
      <header className="mb-4 flex flex-col gap-4 border-b border-white/10 pb-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0"><div className="mb-3 flex items-center gap-3"><TTechMxPatrolLogo variant="header" priority className="w-32" /><span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-[0.14em] text-emerald-300"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" />Live</span></div><h1 className="text-3xl font-black tracking-tight text-white">Command Center</h1><p className="mt-1 text-sm text-slate-400">Real-time overview of security operations across all sites.</p></div>
        <div className="flex flex-wrap items-center gap-2"><HeaderPill icon={Wifi} label={realtimeStatusLabel(realtime.status)} tone={realtime.status === "live" ? "normal" : "warning"} /><HeaderPill icon={Bell} label={`${model.sosActive} SOS`} tone={model.sosActive ? "critical" : "normal"} /><HeaderPill icon={ShieldCheck} label={user?.email ?? "Security Supervisor"} tone="info" /></div>
      </header>
      <section className="mb-4 grid gap-3 xl:grid-cols-[1fr_1fr_1fr_auto]"><Field label="Company"><select disabled={!isPlatformAdmin} className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/78 px-3 text-sm font-semibold text-white outline-none disabled:opacity-80"><option>{overview.data?.companyName ?? "Current company"}</option></select></Field><Field label="Site"><select value={siteId} onChange={(event) => setSiteId(event.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/78 px-3 text-sm font-semibold text-white outline-none focus:border-emerald-300/50"><option value="all">All Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></Field><Field label="Time Period"><select value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)} className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/78 px-3 text-sm font-semibold text-white outline-none focus:border-emerald-300/50"><option value="today">Today</option><option value="7d">Last 7 Days</option><option value="30d">Last 30 Days</option></select></Field><div className="flex items-end gap-3 text-sm text-slate-400"><span className="inline-flex h-10 items-center gap-2 whitespace-nowrap"><span className="h-2 w-2 rounded-full bg-emerald-300" />Last updated: {lastUpdated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span><button onClick={() => void overview.refetch()} className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-slate-950/78 text-slate-300 transition hover:border-emerald-300/40 hover:text-emerald-300" aria-label="Refresh Command Center"><RefreshCw className={`h-4 w-4 ${overview.isFetching || sessionsLoading ? "animate-spin" : ""}`} /></button></div></section>
      {pageError && <section className="mb-4 rounded-xl border border-red-400/35 bg-red-500/10 p-4 text-sm text-red-200">One Command Center module could not load. Other panels remain available while Supabase retries.</section>}
      <section className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8"><KpiCard icon={ShieldCheck} title="Operational Health" value={loading ? "--" : `${model.healthScore}%`} detail={model.healthLabel} tone={model.healthScore < 75 ? "critical" : model.healthScore < 90 ? "warning" : "normal"} subtext={`Main risk: ${model.mainRisk}`} /><KpiCard icon={Route} title="Patrol Compliance" value={loading ? "--" : `${model.patrolCompliance}%`} detail={`${model.sessionsCompleted} of ${model.sessionsExpected} completed`} tone={model.patrolCompliance < 80 ? "warning" : "normal"} /><KpiCard icon={Zap} title="Active Patrols" value={model.activeSessions.length} detail="Now" tone={model.activeSessions.length ? "normal" : "info"} /><KpiCard icon={Smartphone} title="Devices Online" value={`${model.devicesOnline} / ${model.devicesTotal}`} detail={`${model.devicesOffline} offline`} tone={model.devicesOffline ? "warning" : "normal"} /><KpiCard icon={UserCheck} title="Attendance" value="Not configured" detail="No live module" tone="offline" /><KpiCard icon={ClipboardCheck} title="Checklist Compliance" value="Not configured" detail="No live module" tone="offline" /><KpiCard icon={AlertTriangle} title="Open Incidents" value={model.openIncidents} detail={`${model.criticalIncidents} critical`} tone={model.criticalIncidents ? "critical" : model.openIncidents ? "warning" : "normal"} /><KpiCard icon={ShieldAlert} title="Active SOS" value={model.sosActive} detail={model.sosActive ? "Awaiting response" : "Clear"} tone={model.sosActive ? "critical" : "normal"} /></section>
      <section className="mb-4 rounded-xl border border-red-400/20 bg-slate-950/72 p-4">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-black uppercase tracking-[0.16em] text-white">Critical Attention</h2><span className="rounded-full border border-white/10 px-2 py-1 text-xs text-slate-400">{model.attention.length} active</span></div>
        {model.attention.length ? <div className="grid gap-3 xl:grid-cols-3">{model.attention.map((item) => <AttentionCard key={item.id} item={item} />)}</div> : <StateLine icon={CheckCircle2} text="No urgent unresolved operational issues for the selected scope." />}
      </section>
      <section className="mb-4 grid gap-4 xl:grid-cols-[1.1fr_1.1fr_1.35fr]">
        <OperationsPanel title="Live Activity Feed" action="View full activity" route="/scan-logs" badge="Live"><div className="max-h-[25rem] space-y-2 overflow-auto pr-1">{model.activity.length ? model.activity.slice(0, 24).map((event) => <ActivityRow key={event.id} event={event} />) : <StateLine icon={Radio} text="Waiting for live activity in this period." />}</div></OperationsPanel>
        <OperationsPanel title="Active Patrols" action="Open Live Patrol" route="/live-patrol" badge={`${model.activeSessions.length} active`}><div className="max-h-[25rem] space-y-3 overflow-auto pr-1">{model.activeSessions.length ? model.activeSessions.slice(0, 6).map((session) => <PatrolSessionCard key={session.id} session={session} />) : <NoActivePatrol next={model.nextSession} />}</div></OperationsPanel>
        <OperationsPanel title="Mini Live Map" action="Open Live Map" route="/live-map" badge="Map"><div className="h-[25rem] overflow-hidden rounded-lg border border-white/10 bg-slate-950/80"><LiveMap operationsMode showCheckpoints showDevices showRoutes showSos /></div></OperationsPanel>
      </section>
      <section className="grid gap-4 xl:grid-cols-3">
        <ModuleCard icon={ShieldAlert} title="SOS Alerts" route="/sos-alerts" tone={model.sosActive ? "critical" : "normal"} metrics={[`${model.sosActive} active`, `${model.sosUnacknowledged} unacknowledged`]} event={model.latestSos} />
        <ModuleCard icon={AlertTriangle} title="Incidents" route="/incidents" tone={model.criticalIncidents ? "critical" : model.openIncidents ? "warning" : "normal"} metrics={[`${model.openIncidents} open`, `${model.criticalIncidents} critical`]} event={model.latestIncident} />
        <ModuleCard icon={Smartphone} title="Devices" route="/devices" tone={model.devicesOffline ? "warning" : "normal"} metrics={[`${model.devicesOnline}/${model.devicesTotal} online`, `${model.lowBattery} low battery`, `${model.gpsHealthy} GPS healthy`]} event={model.latestDevice} />
        <ModuleCard icon={Route} title="Patrol Sessions" route="/patrols" tone={model.missedSessions ? "warning" : "normal"} metrics={[`${model.sessionsExpected} scheduled`, `${model.activeSessions.length} active`, `${model.missedSessions} missed`]} event={undefined} />
        <ModuleCard icon={Clock3} title="Session Logs" route="/session-logs" tone={model.lateSessions ? "warning" : "info"} metrics={[`${model.sessionsCompleted} completed`, `${model.lateSessions} late`, `${model.missedSessions} incomplete/missed`]} event={model.latestScan} />
        <ModuleCard icon={ScanLine} title="Scan Logs" route="/scan-logs" tone={model.unregisteredScans ? "warning" : "normal"} metrics={[`${model.scansToday} scans`, `${model.registeredScans} registered`, `${model.unregisteredScans} unregistered`]} event={model.latestScan} />
        <ModuleCard icon={Radio} title="Checkpoints" route="/checkpoints" tone={model.pendingTags ? "warning" : "normal"} metrics={[`${model.checkpointsTotal} active`, `${model.pendingTags} pending tags`, `${model.scannedCheckpoints} scanned`]} event={model.latestCheckpoint} />
        <ModuleCard icon={FileText} title="Reports" route="/reports" tone={model.failedReportJobs ? "warning" : "info"} metrics={[`${model.reportsGenerated} generated`, `${model.readyReports} ready`, `${model.failedReportJobs} failed jobs`]} event={model.latestReport} />
        <ModuleCard icon={Brain} title="AI Intelligence" route="/ai-insights" tone={model.aiInsights.length ? "info" : "offline"} metrics={model.aiInsights.length ? model.aiInsights.slice(0, 3).map((item) => item.summary ?? item.type ?? "Insight") : ["AI insights not configured"]} event={model.latestAi} />
        <ModuleCard icon={Camera} title="Cameras" route="/cameras" tone={model.camerasTotal ? "info" : "offline"} metrics={model.camerasTotal ? [`${model.camerasOnline}/${model.camerasTotal} online`, `${model.cameraEvents} events`] : ["Cameras not configured"]} event={model.latestCamera} />
        <ModuleCard icon={ClipboardCheck} title="Attendance & Checklists" route="/settings" tone="offline" metrics={["Attendance not configured", "Checklists not configured"]} event={undefined} />
      </section>
      <section className="mt-4 rounded-xl border border-white/10 bg-slate-950/72 p-4">
        <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">Quick Actions</h2><span className="text-xs text-slate-500">Role-scoped navigation</span></div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
          <QuickAction to="/patrols" label="Create Patrol" />
          <QuickAction to="/incidents" label="Create Incident" />
          <QuickAction to="/devices" label="Register Device" />
          <QuickAction to="/live-map" label="Open Live Map" />
          <QuickAction to="/reports" label="Generate Report" />
          <QuickAction to="/sos-alerts" label="View SOS" critical={model.sosActive > 0} />
          <QuickAction to="/settings" label="Create Checklist" muted />
          <QuickAction to="/reports" label="Executive Export" />
        </div>
      </section>
      <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-400"><span>Operational Health = patrol compliance, device availability, unresolved incidents, active SOS, scan quality and pending tag risk.</span><span>{selectedSiteName} - {dateRangeLabel(dateRange)}</span></footer>
    </div>
  );
}

async function fetchCommandCenterOverview(companyId: string, siteId: string, periodStart: string): Promise<OverviewData> {
  const siteFilter = (query: QueryBuilder) => siteId === "all" ? query : query.eq("site_id", siteId);
  const latest = (table: string, select: string, order: string, apply?: (q: QueryBuilder) => QueryBuilder, limit = 1) => { let query = db.from(table).select(select).eq("company_id", companyId).order(order, { ascending: false }).limit(limit); if (apply) query = apply(query); return query; };
  const [companyRes, scansRes, reportsRes, jobsRes, alertsRes, incidentsRes, devicesRes, checkpointsRes, pendingRes, camerasRes, cameraEventsRes, aiRes] = await Promise.all([
    db.from("companies").select("name").eq("id", companyId).maybeSingle(),
    latest("scan_logs", "id,company_id,site_id,checkpoint_id,device_identifier,device_id,tag_uid,tag_status,scanned_at,gps_lat,gps_lng,gps_accuracy,sites(name),checkpoints(name,site_id,sites(name))", "scanned_at", (q) => siteFilter(q.gte("scanned_at", periodStart)), 120),
    latest("ai_reports", "id,report_type,summary_text,generated_at", "generated_at", (q) => q.gte("generated_at", periodStart), 30),
    latest("report_jobs", "id,report_type,status,error_message,created_at,completed_at,failed_at,scheduled_for,site_id,sites(name)", "created_at", (q) => siteFilter(q.gte("created_at", periodStart)), 50),
    latest("alerts", "id,type,severity,message,is_read,created_at", "created_at", (q) => q.eq("type", "panic_button"), 30),
    latest("incidents", "id,title,severity,status,resolved,site_id,created_at,sites(name)", "created_at", siteFilter, 50),
    latest("devices", "id,device_name,device_identifier,status,pairing_status,last_seen_at,site_id,sites(name),battery_level,current_battery_level,current_gps_lat,current_gps_lng,current_gps_accuracy", "last_seen_at", siteFilter, 80),
    latest("checkpoints", "id,name,nfc_tag_id,site_id,created_at,sites(name)", "created_at", siteFilter, 80),
    latest("pending_nfc_tags", "id,tag_uid,nfc_tag_id,status,last_seen_at,created_at,site_id,device_identifier,sites(name)", "last_seen_at", (q) => siteFilter(q.eq("status", "pending")), 40),
    latest("cameras", "id,name,status,site_id,created_at,sites(name)", "created_at", siteFilter, 40),
    latest("camera_events", "id,event_type,description,severity,detected_at,created_at,site_id,sites(name)", "detected_at", siteFilter, 30),
    latest("ai_insights", "id,type,summary,severity,created_at", "created_at", undefined, 10),
  ]);
  const rows = (res: QueryResponse, label: string) => {
    if (res?.error) {
      console.warn(`[Command Center] ${label} query failed`, res.error);
      return [] as AnyRow[];
    }
    return (Array.isArray(res?.data) ? res.data : []) as AnyRow[];
  };
  const companyName = (companyRes?.data as { name?: string } | null | undefined)?.name ?? "Current company";
  if (companyRes?.error) console.warn("[Command Center] company query failed", companyRes.error);
  return { companyName, scans: rows(scansRes, "scan_logs"), reports: rows(reportsRes, "ai_reports"), reportJobs: rows(jobsRes, "report_jobs"), alerts: rows(alertsRes, "alerts"), incidents: rows(incidentsRes, "incidents"), devices: rows(devicesRes, "devices"), checkpoints: rows(checkpointsRes, "checkpoints"), pendingTags: rows(pendingRes, "pending_nfc_tags"), cameras: rows(camerasRes, "cameras"), cameraEvents: rows(cameraEventsRes, "camera_events"), aiInsights: rows(aiRes, "ai_insights") };
}

function buildOperationsModel(data: OverviewData | undefined, sessions: AnyRow[], periodStart: string, selectedSiteName: string) {
  const scans = data?.scans ?? [], devices = data?.devices ?? [], alerts = data?.alerts ?? [], incidents = data?.incidents ?? [], reports = data?.reports ?? [], jobs = data?.reportJobs ?? [], checkpoints = data?.checkpoints ?? [], pendingTags = data?.pendingTags ?? [], cameras = data?.cameras ?? [], cameraEvents = data?.cameraEvents ?? [], aiInsights = data?.aiInsights ?? [];
  const activeSessions = sessions.filter((s) => ["active", "in_progress", "running"].includes(String(s.status)));
  const nextSession = sessions.find((s) => ["scheduled", "awaiting_start"].includes(String(s.status)));
  const expectedSessions = sessions.filter((s) => String(s.scheduled_start ?? s.created_at ?? "") >= periodStart && !["cancelled", "paused"].includes(String(s.status)));
  const completedSessions = expectedSessions.filter((s) => ["completed", "completed_late"].includes(String(s.status)));
  const lateSessions = expectedSessions.filter((s) => ["completed_late", "late", "delayed"].includes(String(s.status)));
  const missedSessions = expectedSessions.filter((s) => ["missed", "incomplete"].includes(String(s.status)));
  const registeredScans = scans.filter((s) => s.checkpoint_id || s.tag_status === "registered");
  const unregisteredScans = scans.filter((s) => s.tag_status === "unregistered" || !s.checkpoint_id);
  const patrolCompliance = expectedSessions.length ? Math.round((completedSessions.length / expectedSessions.length) * 100) : (scans.length ? Math.round((registeredScans.length / scans.length) * 100) : 0);
  const sosActiveAlerts = alerts.filter((a) => a.type === "panic_button" && !a.is_read);
  const criticalIncidents = incidents.filter((i) => !isResolved(i) && ["critical", "high"].includes(String(i.severity)));
  const openIncidents = incidents.filter((i) => !isResolved(i));
  const onlineDevices = devices.filter((d) => String(d.status) === "online");
  const offlineDevices = devices.filter((d) => String(d.status) !== "online");
  const lowBattery = devices.filter((d) => Number(d.battery_level ?? d.current_battery_level ?? 100) <= 20).length;
  const gpsHealthy = devices.filter((d) => d.current_gps_lat != null && d.current_gps_lng != null).length;
  const scannedCheckpointIds = new Set(registeredScans.map((s) => s.checkpoint_id).filter(Boolean));
  const readyReports = reports.length + jobs.filter((j) => j.status === "completed").length;
  const failedReportJobs = jobs.filter((j) => j.status === "failed").length;
  const camerasOnline = cameras.filter((c) => String(c.status) === "online").length;
  const healthParts = [patrolCompliance || 0, devices.length ? Math.round((onlineDevices.length / devices.length) * 100) : 100, Math.max(0, 100 - sosActiveAlerts.length * 30), Math.max(0, 100 - criticalIncidents.length * 18 - Math.max(0, openIncidents.length - criticalIncidents.length) * 6), scans.length ? Math.round((registeredScans.length / scans.length) * 100) : 100, Math.max(0, 100 - pendingTags.length * 8)];
  const healthScore = Math.max(0, Math.min(100, Math.round(healthParts.reduce((sum, value) => sum + value, 0) / healthParts.length)));
  const mainRisk = sosActiveAlerts.length ? `${sosActiveAlerts.length} active SOS` : criticalIncidents.length ? `${criticalIncidents.length} critical incidents` : offlineDevices.length ? `${offlineDevices.length} offline devices` : pendingTags.length ? `${pendingTags.length} pending tags` : "No major risk";
  const healthLabel = healthScore >= 90 ? "Healthy" : healthScore >= 75 ? "Needs Attention" : "Critical";
  const latestScan = scans[0] ? activityFromScan(scans[0]) : undefined;
  const latestSos = alerts[0] ? activityFromAlert(alerts[0]) : undefined;
  const latestIncident = incidents[0] ? activityFromIncident(incidents[0]) : undefined;
  const latestDevice = devices[0] ? activityFromDevice(devices[0]) : undefined;
  const latestReport = reports[0] ? activityFromReport(reports[0]) : undefined;
  const latestCheckpoint = pendingTags[0] ? activityFromPendingTag(pendingTags[0]) : checkpoints[0] ? activity("checkpoint-" + checkpoints[0].id, "Checkpoint registered", checkpoints[0].name, "/checkpoints", checkpoints[0].created_at, "normal", siteName(checkpoints[0])) : undefined;
  const latestCamera = cameraEvents[0] ? activity("camera-" + cameraEvents[0].id, titleCase(cameraEvents[0].event_type ?? "Camera event"), cameraEvents[0].description, "/cameras", cameraEvents[0].detected_at ?? cameraEvents[0].created_at, cameraEvents[0].severity === "critical" ? "critical" : "info", siteName(cameraEvents[0])) : undefined;
  const latestAi = aiInsights[0] ? activity("ai-" + aiInsights[0].id, aiInsights[0].summary ?? titleCase(aiInsights[0].type ?? "AI insight"), "AI Intelligence", "/ai-insights", aiInsights[0].created_at, aiInsights[0].severity === "critical" ? "critical" : "info", selectedSiteName) : undefined;
  const attention = groupAttention([...sosActiveAlerts.map((alert) => attentionItem("sos-" + alert.id, "SOS Alert", alert.message ?? "Panic button pressed", selectedSiteName, alert.is_read ? "Acknowledged" : "Awaiting acknowledgement", "/sos-alerts", alert.created_at, "critical")), ...criticalIncidents.map((incident) => attentionItem("incident-" + incident.id, "Critical Incident", incident.title ?? "Incident", siteName(incident, selectedSiteName), "Open", "/incidents", incident.created_at, "critical")), ...missedSessions.map((session) => attentionItem("session-" + session.id, "Missed Patrol", patrolSessionLabel(session), siteName(session, selectedSiteName), titleCase(String(session.status)), "/session-logs", session.updated_at ?? session.scheduled_start, "warning")), ...offlineDevices.slice(0, 3).map((device) => attentionItem("device-" + device.id, "Device Offline", deviceIdentity(device), siteName(device, selectedSiteName), "Offline", "/devices", device.last_seen_at, "warning")), ...pendingTags.slice(0, 3).map((tag) => attentionItem("tag-" + tag.id, "Unregistered Tag", tag.tag_uid ?? tag.nfc_tag_id ?? "Pending NFC tag", siteName(tag, selectedSiteName), "Registration pending", "/checkpoints", tag.last_seen_at ?? tag.created_at, "warning"))]).slice(0, 6);
  const activityEvents = [...scans.slice(0, 20).map(activityFromScan), ...alerts.slice(0, 10).map(activityFromAlert), ...incidents.slice(0, 10).map(activityFromIncident), ...devices.slice(0, 10).map(activityFromDevice), ...reports.slice(0, 8).map(activityFromReport), ...jobs.slice(0, 8).map((job) => activity("job-" + job.id, `${titleCase(job.report_type ?? "Report")} job ${titleCase(job.status ?? "updated")}`, job.error_message ?? job.sites?.name ?? "Report job", "/reports", job.completed_at ?? job.failed_at ?? job.created_at, job.status === "failed" ? "warning" : "info", job.sites?.name ?? selectedSiteName))].filter(Boolean).sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime()).slice(0, 30);
  return { healthScore, healthLabel, mainRisk, patrolCompliance, sessionsExpected: expectedSessions.length, sessionsCompleted: completedSessions.length, lateSessions: lateSessions.length, missedSessions: missedSessions.length, activeSessions, nextSession, sosActive: sosActiveAlerts.length, sosUnacknowledged: sosActiveAlerts.length, openIncidents: openIncidents.length, criticalIncidents: criticalIncidents.length, devicesOnline: onlineDevices.length, devicesOffline: offlineDevices.length, devicesTotal: devices.length, lowBattery, gpsHealthy, scansToday: scans.length, registeredScans: registeredScans.length, unregisteredScans: unregisteredScans.length, scannedCheckpoints: scannedCheckpointIds.size, checkpointsTotal: checkpoints.length, pendingTags: pendingTags.length, reportsGenerated: reports.length, readyReports, failedReportJobs, camerasOnline, camerasTotal: cameras.length, cameraEvents: cameraEvents.length, aiInsights, attention, activity: activityEvents, latestScan, latestSos, latestIncident, latestDevice, latestReport, latestCheckpoint, latestCamera, latestAi };
}

function isResolved(row: AnyRow) { return row.resolved === true || ["resolved", "closed"].includes(String(row.status)); }
function titleCase(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function siteName(row: AnyRow, fallback = "All Sites") { return row.sites?.name ?? row.checkpoints?.sites?.name ?? fallback; }
function checkpointName(scan: AnyRow) { return scan.checkpoints?.name ?? (scan.tag_uid ? `Tag ${scan.tag_uid}` : "Checkpoint scan"); }
function deviceIdentity(row: AnyRow) { return row.device_name ?? row.device_identifier ?? row.device_id ?? "Patrol device"; }
function activity(id: string, title: string, subtitle: string | undefined, route: string, timestamp: string | null | undefined, severity: Severity, site?: string): ActivityEvent { return { id, title, subtitle, route, timestamp, severity, site }; }
function activityFromScan(scan: AnyRow) { return activity("scan-" + scan.id, scan.tag_status === "unregistered" ? "Unregistered tag scanned" : "Checkpoint scanned", `${checkpointName(scan)} - ${deviceIdentity(scan)}`, "/scan-logs", scan.scanned_at, scan.tag_status === "unregistered" ? "warning" : "normal", siteName(scan)); }
function activityFromAlert(alert: AnyRow) { return activity("alert-" + alert.id, alert.is_read ? "SOS acknowledged" : "SOS triggered", alert.message ?? "Panic button alert", "/sos-alerts", alert.created_at, alert.is_read ? "warning" : "critical"); }
function activityFromIncident(incident: AnyRow) { return activity("incident-" + incident.id, incident.title ?? "Incident created", incident.resolved ? "Resolved" : "Open", "/incidents", incident.created_at, ["critical", "high"].includes(String(incident.severity)) ? "critical" : "warning", siteName(incident)); }
function activityFromDevice(device: AnyRow) { return activity("device-" + device.id, `${deviceIdentity(device)} ${device.status ?? "updated"}`, device.battery_level != null ? `Battery ${device.battery_level}%` : siteName(device), "/devices", device.last_seen_at, device.status === "online" ? "normal" : "offline", siteName(device)); }
function activityFromReport(report: AnyRow) { return activity("report-" + report.id, `${titleCase(report.report_type ?? "Daily")} report generated`, report.summary_text ?? "Ready for review", "/reports", report.generated_at, "info"); }
function activityFromPendingTag(tag: AnyRow) { return activity("pending-" + tag.id, "Unregistered tag awaiting registration", tag.tag_uid ?? tag.nfc_tag_id ?? "Pending tag", "/checkpoints", tag.last_seen_at ?? tag.created_at, "warning", siteName(tag)); }
function attentionItem(id: string, title: string, subject: string, site: string, state: string, route: string, timestamp: string | null | undefined, severity: AttentionItem["severity"]): AttentionItem { return { id, title, subject, site, state, route, timestamp, severity }; }
function groupAttention(items: AttentionItem[]) { const seen = new Set<string>(); return items.filter((item) => { const key = `${item.title}-${item.subject}-${item.site}-${item.state}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function dateRangeLabel(range: DateRange) { return range === "today" ? "Today" : range === "7d" ? "Last 7 Days" : "Last 30 Days"; }
function freshness(timestamp?: string | null) { if (!timestamp) return "No timestamp"; const age = Date.now() - new Date(timestamp).getTime(); const label = formatDistanceToNow(new Date(timestamp), { addSuffix: true }); if (age < 60_000) return "Live"; if (age < 15 * 60_000) return label; if (new Date(timestamp).toDateString() === new Date().toDateString()) return `Old - ${label}`; return `Historical - ${label}`; }

function HeaderPill({ icon: Icon, label, tone }: { icon: IconComponent; label: string; tone: Severity }) { return <span className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${toneClass(tone).soft}`}><Icon className="h-4 w-4" />{label}</span>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="space-y-1 text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">{label}{children}</label>; }
function KpiCard({ icon: Icon, title, value, detail, tone, subtext }: { icon: IconComponent; title: string; value: string | number; detail: string; tone: Severity; subtext?: string }) { const style = toneClass(tone); return <article className={`rounded-xl border bg-slate-950/72 p-4 ${style.border}`}><div className="mb-3 flex items-start justify-between"><div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${style.icon}`}><Icon className="h-5 w-5" /></div><span className={`text-[10px] font-black uppercase ${style.text}`}>{detail}</span></div><p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{title}</p><p className="mt-1 text-3xl font-black text-white">{value}</p>{subtext && <p className="mt-2 text-xs text-slate-400">{subtext}</p>}</article>; }
function AttentionCard({ item }: { item: AttentionItem }) { const style = toneClass(item.severity); return <Link to={item.route} className={`block rounded-xl border bg-slate-950/76 p-4 transition hover:-translate-y-0.5 ${style.border}`}><div className="mb-2 flex items-center justify-between gap-2"><span className={`text-xs font-black uppercase ${style.text}`}>{item.title}</span><span className="text-xs text-slate-500">{freshness(item.timestamp)}</span></div><p className="font-bold text-white">{item.subject}</p><p className="mt-1 text-sm text-slate-400">{item.site} - {item.state}</p><span className={`mt-3 inline-flex rounded-lg border px-3 py-1 text-xs font-bold ${style.soft}`}>Open</span></Link>; }
function OperationsPanel({ title, action, route, badge, children }: { title: string; action: string; route: string; badge: string; children: ReactNode }) { return <section className="rounded-xl border border-white/10 bg-slate-950/72 p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-[0.14em] text-white">{title}</h2><span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">{badge}</span></div>{children}<Link to={route} className="mt-3 inline-flex text-sm font-semibold text-cyan-300 hover:text-cyan-200">{action}</Link></section>; }
function ActivityRow({ event }: { event: ActivityEvent }) { const style = toneClass(event.severity); return <Link to={event.route} className="flex gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 transition hover:border-cyan-400/25"><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${style.dot}`} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-3"><p className="truncate text-sm font-bold text-white">{event.title}</p><span className={`shrink-0 text-xs ${style.text}`}>{freshness(event.timestamp)}</span></div><p className="mt-1 truncate text-xs text-slate-400">{event.subtitle}</p>{event.site && <p className="mt-1 text-[10px] uppercase tracking-wider text-slate-600">{event.site}</p>}</div></Link>; }
function PatrolSessionCard({ session }: { session: AnyRow }) { const progress = patrolSessionProgress(session); return <Link to="/live-patrol" className="block rounded-lg border border-white/10 bg-white/[0.03] p-3 hover:border-emerald-400/30"><div className="flex items-start justify-between"><div><p className="font-bold text-white">{patrolSessionLabel(session)}</p><p className="text-xs text-slate-400">{deviceIdentity(session)} - {siteName(session)}</p></div><span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">{titleCase(String(session.status))}</span></div><div className="mt-3 flex items-center gap-3"><div className="h-2 flex-1 rounded-full bg-white/10"><div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.min(100, progress.percent)}%` }} /></div><span className="text-xs text-slate-300">{progress.completed}/{progress.total || "?"}</span></div><p className="mt-2 text-xs text-slate-500">Last activity: {freshness(session.updated_at ?? session.actual_start ?? session.scheduled_start)}</p></Link>; }
function NoActivePatrol({ next }: { next?: AnyRow }) { return <div className="rounded-lg border border-white/10 bg-white/[0.03] p-5 text-sm text-slate-400"><p className="font-bold text-white">No active patrols</p><p className="mt-1">{next ? `Next scheduled: ${patrolSessionLabel(next)} at ${format(new Date(next.scheduled_start), "HH:mm")}` : "No upcoming scheduled patrol in this filter."}</p></div>; }
function ModuleCard({ icon: Icon, title, route, tone, metrics, event }: { icon: IconComponent; title: string; route: string; tone: Severity; metrics: string[]; event?: ActivityEvent }) { const style = toneClass(tone); return <Link to={route} className={`block rounded-xl border bg-slate-950/72 p-4 transition hover:-translate-y-0.5 ${style.border}`}><div className="mb-3 flex items-center gap-3"><div className={`flex h-10 w-10 items-center justify-center rounded-lg border ${style.icon}`}><Icon className="h-5 w-5" /></div><h3 className="font-black uppercase tracking-[0.12em] text-white">{title}</h3></div><div className="grid gap-2">{metrics.slice(0, 3).map((metric) => <p key={metric} className="rounded-md bg-white/[0.03] px-3 py-2 text-sm text-slate-300">{metric}</p>)}</div>{event ? <div className="mt-3 border-t border-white/10 pt-3"><p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-500">Latest</p><p className="mt-1 line-clamp-1 text-sm font-semibold text-white">{event.title}</p><p className={`mt-1 text-xs ${style.text}`}>{freshness(event.timestamp)}</p></div> : <p className="mt-3 border-t border-white/10 pt-3 text-sm text-slate-500">No current activity</p>}</Link>; }
function StateLine({ icon: Icon, text }: { icon: IconComponent; text: string }) { return <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300"><Icon className="h-4 w-4 text-emerald-300" />{text}</div>; }
function QuickAction({ to, label, critical, muted }: { to: string; label: string; critical?: boolean; muted?: boolean }) { return <Link to={to} className={`rounded-lg border px-3 py-2 text-center text-xs font-bold transition hover:-translate-y-0.5 ${critical ? "border-red-400/40 bg-red-500/15 text-red-200" : muted ? "border-slate-600/70 bg-slate-500/10 text-slate-400" : "border-emerald-400/20 bg-emerald-400/10 text-emerald-200"}`}>{label}</Link>; }
function toneClass(tone: Severity) { const classes = { normal: { border: "border-emerald-400/24", text: "text-emerald-300", soft: "border-emerald-400/20 bg-emerald-400/10 text-emerald-300", icon: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300", dot: "bg-emerald-400" }, info: { border: "border-sky-400/24", text: "text-sky-300", soft: "border-sky-400/20 bg-sky-400/10 text-sky-300", icon: "border-sky-400/25 bg-sky-400/10 text-sky-300", dot: "bg-sky-400" }, warning: { border: "border-amber-400/35", text: "text-amber-300", soft: "border-amber-400/25 bg-amber-400/10 text-amber-300", icon: "border-amber-400/30 bg-amber-400/10 text-amber-300", dot: "bg-amber-400" }, critical: { border: "border-red-400/45 shadow-[0_0_28px_rgba(239,68,68,0.12)]", text: "text-red-300", soft: "border-red-400/30 bg-red-500/15 text-red-300", icon: "border-red-400/30 bg-red-500/15 text-red-300", dot: "bg-red-400" }, offline: { border: "border-slate-600/70", text: "text-slate-400", soft: "border-slate-600/70 bg-slate-500/10 text-slate-400", icon: "border-slate-500/30 bg-slate-500/10 text-slate-400", dot: "bg-slate-500" } } satisfies Record<Severity, { border: string; text: string; soft: string; icon: string; dot: string }>; return classes[tone]; }



