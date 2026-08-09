/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import { format, formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Download,
  Eye,
  FileText,
  Loader2,
  MapPin,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Smartphone,
  XCircle,
} from "lucide-react";
import { Link } from "react-router-dom";
import SiteSelector from "@/components/sites/SiteSelector";
import { SocKpiCard, SocPageShell, SocPanel, SocProgressBar } from "@/components/dashboard/SocComponents";
import { exportCsv } from "@/components/dashboard/dashboardTableFilters";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import {
  patrolSessionLabel,
  patrolSessionProgress,
  usePatrolRoutes,
  usePatrolSchedules,
  usePatrolSessions,
  usePatrolTemplates,
} from "@/hooks/useScheduledPatrols";

type SessionStatusTone = "green" | "blue" | "amber" | "red" | "neutral";
type SessionRow = Record<string, any>;

const activeStatuses = new Set(["active", "in_progress"]);
const scheduledStatuses = new Set(["scheduled", "awaiting_start"]);
const completedStatuses = new Set(["completed", "completed_late"]);
const completedLateStatuses = new Set(["completed_late"]);
const incompleteStatuses = new Set(["incomplete"]);
const missedStatuses = new Set(["missed"]);
const attentionStatuses = new Set(["late_start", "late", "delayed", "missed", "incomplete"]);
const pageSizeOptions = [10, 25, 50];

export default function SessionLogsPage() {
  const realtime = useRealtimeConnectionStatus("session-logs-page");
  const [siteId, setSiteId] = useState("all");
  const [templateFilter, setTemplateFilter] = useState("all");
  const [routeFilter, setRouteFilter] = useState("all");
  const [scheduleFilter, setScheduleFilter] = useState("all");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [timeFilter, setTimeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const sessionsQuery = usePatrolSessions(250, siteId);
  const templatesQuery = usePatrolTemplates(siteId);
  const routesQuery = usePatrolRoutes(siteId);
  const schedulesQuery = usePatrolSchedules(siteId);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim().toLowerCase()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const sessions = useMemo(() => sessionsQuery.data ?? [], [sessionsQuery.data]);
  const templateOptions = useMemo(() => uniqueOptions(sessions.map((session) => patrolSessionLabel(session))), [sessions]);
  const routeOptions = useMemo(() => uniqueOptions(sessions.map((session) => routeName(session))), [sessions]);
  const scheduleOptions = useMemo(() => uniqueOptions(sessions.map((session) => scheduleName(session))), [sessions]);
  const deviceOptions = useMemo(() => uniqueOptions(sessions.map((session) => deviceLabel(session))), [sessions]);
  const statusOptions = useMemo(() => uniqueOptions(sessions.map((session) => session.status).filter(Boolean)), [sessions]);

  const filteredSessions = useMemo(() => {
    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const end = endDate ? new Date(`${endDate}T23:59:59`).getTime() : Number.POSITIVE_INFINITY;
    return sessions.filter((session) => {
      const scheduled = new Date(session.scheduled_start ?? 0).getTime();
      const displayId = displaySessionId(session).toLowerCase();
      const text = `${displayId} ${session.id} ${patrolSessionLabel(session)} ${routeName(session)} ${scheduleName(session)} ${deviceLabel(session)} ${siteName(session)}`.toLowerCase();
      const hour = Number(formatTime(session.scheduled_start).slice(0, 2));
      return (
        scheduled >= start &&
        scheduled <= end &&
        (templateFilter === "all" || patrolSessionLabel(session) === templateFilter) &&
        (routeFilter === "all" || routeName(session) === routeFilter) &&
        (scheduleFilter === "all" || scheduleName(session) === scheduleFilter) &&
        (deviceFilter === "all" || deviceLabel(session) === deviceFilter) &&
        (statusFilter === "all" || session.status === statusFilter) &&
        (timeFilter === "all" || timeBucket(hour) === timeFilter) &&
        (!debouncedSearch || text.includes(debouncedSearch))
      );
    });
  }, [debouncedSearch, deviceFilter, endDate, routeFilter, scheduleFilter, sessions, startDate, statusFilter, templateFilter, timeFilter]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, deviceFilter, endDate, routeFilter, scheduleFilter, siteId, startDate, statusFilter, templateFilter, timeFilter]);

  const kpis = useMemo(() => buildKpis(filteredSessions), [filteredSessions]);
  const pageCount = Math.max(1, Math.ceil(filteredSessions.length / pageSize));
  const pageRows = filteredSessions.slice((page - 1) * pageSize, page * pageSize);
  const selectedSession = filteredSessions.find((session) => session.id === selectedId) ?? pageRows[0] ?? filteredSessions[0] ?? null;
  const timeline = filteredSessions.slice().sort((a, b) => new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime()).slice(0, 8);
  const isLoading = sessionsQuery.isLoading || templatesQuery.isLoading || routesQuery.isLoading || schedulesQuery.isLoading;
  const error = sessionsQuery.error || templatesQuery.error || routesQuery.error || schedulesQuery.error;

  const clearFilters = () => {
    setTemplateFilter("all");
    setRouteFilter("all");
    setScheduleFilter("all");
    setDeviceFilter("all");
    setStatusFilter("all");
    setTimeFilter("all");
    setSearch("");
  };

  const exportSessions = () => {
    exportCsv(
      "patrol-session-logs.csv",
      ["Display Session ID", "Internal UUID", "Patrol Template", "Route", "Site", "Device", "Scheduled Start", "Scheduled End", "Actual Start", "Actual End", "Progress", "Missed Checkpoints", "Incidents", "SOS", "Status", "Duration", "Compliance Result"],
      filteredSessions.map((session) => {
        const progress = patrolSessionProgress(session);
        return [
          displaySessionId(session),
          session.id,
          patrolSessionLabel(session),
          routeName(session),
          siteName(session),
          deviceLabel(session),
          formatDateTime(session.scheduled_start),
          formatDateTime(session.scheduled_end),
          formatDateTime(session.actual_start),
          formatDateTime(session.actual_end),
          `${progress.completed}/${progress.total} (${progress.percent}%)`,
          missed(session).join(", ") || "None",
          session.incident_count ?? 0,
          session.sos_count ?? 0,
          prettify(session.status || "unknown"),
          durationLabel(session),
          complianceResult(session),
        ];
      })
    );
  };

  return (
    <SocPageShell title="Session Logs" subtitle="Review scheduled patrol executions, completion status and checkpoint progress." realtime={realtime}>
      <section className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/72 p-4 shadow-[0_0_30px_rgba(0,0,0,0.22)] lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300"><Radio className="h-3 w-3" />Live</span>
          <p className="text-sm text-slate-400">One row represents one patrol session. Individual NFC scans stay on Scan Logs.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={exportSessions} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-black text-slate-200 hover:border-cyan-400/30"><Download className="h-4 w-4" />Export CSV</button>
          <button type="button" onClick={exportSessions} className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 text-xs font-black text-emerald-200"><FileText className="h-4 w-4" />Session Report</button>
          <button type="button" onClick={() => void sessionsQuery.refetch()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-black text-slate-200 hover:border-cyan-400/30"><RefreshCw className="h-4 w-4" />Refresh</button>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-7">
        <SocKpiCard title="Scheduled" value={kpis.scheduled} caption="Expected sessions" icon={CalendarClock} tone="blue" loading={isLoading} />
        <SocKpiCard title="Active" value={kpis.active} caption="Now" icon={Radio} tone={kpis.active ? "blue" : "neutral"} loading={isLoading} />
        <SocKpiCard title="Completed" value={kpis.completed} caption={`${kpis.completedRate}%`} icon={CheckCircle2} tone="green" loading={isLoading} />
        <SocKpiCard title="Completed Late" value={kpis.completedLate} caption="Needs review" icon={Clock3} tone={kpis.completedLate ? "amber" : "neutral"} loading={isLoading} />
        <SocKpiCard title="Incomplete" value={kpis.incomplete} caption="Open" icon={AlertTriangle} tone={kpis.incomplete ? "red" : "neutral"} loading={isLoading} />
        <SocKpiCard title="Missed" value={kpis.missed} caption="Failed sessions" icon={XCircle} tone={kpis.missed ? "red" : "neutral"} loading={isLoading} />
        <SocKpiCard title="Compliance" value={`${kpis.compliance}%`} caption={kpis.compliance >= 90 ? "Good" : "Attention"} icon={ShieldCheck} tone={kpis.compliance >= 90 ? "green" : "amber"} loading={isLoading} />
      </section>

      <SocPanel title="Session Filters" action={<span className="text-xs text-slate-500">{filteredSessions.length} sessions</span>}>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <FilterShell label="Site"><SiteSelector value={siteId} onChange={setSiteId} className="h-10 border-0 bg-transparent px-0" /></FilterShell>
          <FilterSelect label="Patrol Template" value={templateFilter} onChange={setTemplateFilter} options={templateOptions} />
          <FilterSelect label="Route" value={routeFilter} onChange={setRouteFilter} options={routeOptions} />
          <FilterSelect label="Schedule" value={scheduleFilter} onChange={setScheduleFilter} options={scheduleOptions} />
          <FilterSelect label="Device" value={deviceFilter} onChange={setDeviceFilter} options={deviceOptions} />
          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={statusOptions.map(prettify)} rawOptions={statusOptions} />
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_1fr_auto_auto]">
          <label className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3"><Search className="h-4 w-4 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search session ID, route, device..." className="min-w-0 flex-1 bg-transparent text-sm text-slate-200 outline-none" /></label>
          <DateInput label="Start Date" value={startDate} onChange={setStartDate} />
          <DateInput label="End Date" value={endDate} onChange={setEndDate} />
          <FilterSelect label="Time" value={timeFilter} onChange={setTimeFilter} options={["all", "morning", "afternoon", "night"]} />
          <button type="button" onClick={clearFilters} className="h-11 rounded-lg border border-white/10 bg-slate-950/80 px-4 text-xs font-black text-slate-300 hover:border-white/20">Clear Filters</button>
          <button type="button" onClick={() => void sessionsQuery.refetch()} className="h-11 rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-4 text-xs font-black text-emerald-200">Filter</button>
        </div>
      </SocPanel>

      {error ? <ErrorState onRetry={() => void sessionsQuery.refetch()} /> : null}

      <div className="grid gap-4 xl:grid-cols-[0.38fr_1fr]">
        <SocPanel title="Today's Timeline" action={<span className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Live</span>}>
          {isLoading ? <LoadingState label="Loading timeline..." /> : timeline.length ? <div className="space-y-2">{timeline.map((session) => <TimelineItem key={session.id} session={session} selected={selectedSession?.id === session.id} onSelect={() => setSelectedId(session.id)} />)}</div> : <EmptyState title="No patrol sessions found for this period." body="Select another date or create a schedule from Patrols." />}
        </SocPanel>

        <SocPanel title={`Sessions (${filteredSessions.length})`} action={<span className="text-xs text-slate-500">Realtime updates session progress</span>}>
          {isLoading ? <LoadingState label="Loading patrol sessions..." /> : filteredSessions.length ? <SessionTable rows={pageRows} selectedId={selectedSession?.id ?? null} onSelect={setSelectedId} multiSite={siteId === "all"} /> : <EmptyState title="No patrol sessions found for this period." body="If patrols are not configured yet, create a patrol route, template and schedule first." />}
          {filteredSessions.length ? <Pagination page={page} pageCount={pageCount} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} /> : null}
        </SocPanel>
      </div>

      {selectedSession ? <SessionDetails session={selectedSession} /> : null}

      <p className="text-xs text-slate-500">Compliance is calculated from real patrol_sessions: completed and completed_late sessions divided by expected sessions, excluding cancelled and paused sessions.</p>
    </SocPageShell>
  );
}

function SessionTable({ rows, selectedId, onSelect, multiSite }: { rows: SessionRow[]; selectedId: string | null; onSelect: (id: string) => void; multiSite: boolean }) {
  return <div className="overflow-auto"><table className="w-full min-w-[1180px] text-left text-sm"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">Scheduled Time</th><th className="px-3 py-3">Session</th><th className="px-3 py-3">Patrol Template</th><th className="px-3 py-3">Route</th>{multiSite ? <th className="px-3 py-3">Site</th> : null}<th className="px-3 py-3">Device</th><th className="px-3 py-3">Scheduled Window</th><th className="px-3 py-3">Actual Start</th><th className="px-3 py-3">Actual End</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3">Duration</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">GPS</th><th className="px-3 py-3">Actions</th></tr></thead><tbody className="divide-y divide-white/5">{rows.map((session) => { const progress = patrolSessionProgress(session); const selected = session.id === selectedId; return <tr key={session.id} onClick={() => onSelect(session.id)} className={`cursor-pointer transition hover:bg-white/[0.04] ${selected ? "bg-emerald-400/5" : ""}`}><td className="px-3 py-3 font-mono text-slate-200">{formatTime(session.scheduled_start)}</td><td className="px-3 py-3"><p className="font-mono text-xs font-black text-white">{displaySessionId(session)}</p><p className="text-[10px] text-slate-500">UUID hidden in details</p></td><td className="px-3 py-3 text-slate-300">{patrolSessionLabel(session)}</td><td className="px-3 py-3 text-slate-300">{routeName(session)}</td>{multiSite ? <td className="px-3 py-3 text-slate-300">{siteName(session)}</td> : null}<td className="px-3 py-3"><p className="font-semibold text-slate-200">{deviceLabel(session)}</p><p className="max-w-36 truncate font-mono text-[10px] text-slate-500">{session.device_identifier || session.device_id || "No device"}</p></td><td className="px-3 py-3 text-slate-300">{formatTime(session.scheduled_start)} - {formatTime(session.scheduled_end)}</td><td className="px-3 py-3 text-slate-300">{formatTime(session.actual_start)}</td><td className="px-3 py-3 text-slate-300">{formatTime(session.actual_end)}</td><td className="px-3 py-3"><div className="min-w-28"><div className="mb-1 flex justify-between text-xs text-slate-300"><span>{progress.completed}/{progress.total || 0}</span><span>{progress.percent}%</span></div><SocProgressBar value={progress.percent} tone={statusTone(session.status) as any} /></div></td><td className="px-3 py-3 text-slate-300">{durationLabel(session)}</td><td className="px-3 py-3"><StatusBadge status={session.status} /></td><td className="px-3 py-3"><GpsBadge session={session} /></td><td className="px-3 py-3"><button type="button" onClick={(event) => { event.stopPropagation(); onSelect(session.id); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-white/10 bg-slate-950/80 px-2 text-xs font-bold text-slate-200"><Eye className="h-3.5 w-3.5" />View</button></td></tr>; })}</tbody></table></div>;
}

function SessionDetails({ session }: { session: SessionRow }) {
  const checkpoints = sortedCheckpoints(session);
  const progress = patrolSessionProgress(session);
  return <SocPanel title="Session Details" action={<StatusBadge status={session.status} />}><div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]"><div className="space-y-3"><DetailBlock title="Session Identity" rows={[["Display ID", displaySessionId(session)], ["Internal UUID", session.id], ["Patrol Template", patrolSessionLabel(session)], ["Route", routeName(session)], ["Schedule", scheduleName(session)], ["Site", siteName(session)], ["Device", deviceLabel(session)], ["Full Device ID", session.device_identifier || session.device_id || "Unassigned"]]} /><DetailBlock title="Timing" rows={[["Scheduled Start", formatDateTime(session.scheduled_start)], ["Scheduled End", formatDateTime(session.scheduled_end)], ["Actual Start", formatDateTime(session.actual_start)], ["Actual End", formatDateTime(session.actual_end)], ["Elapsed", durationLabel(session)], ["Progress", `${progress.completed}/${progress.total || 0} (${progress.percent}%)`]]} /><DetailBlock title="Execution Links" rows={[["Missed Checkpoints", missed(session).join(", ") || "None"], ["Incidents", String(session.incident_count ?? 0)], ["Open Incidents", String(session.open_incident_count ?? 0)], ["SOS Events", String(session.sos_count ?? 0)], ["Unacknowledged SOS", String(session.unacknowledged_sos_count ?? 0)]]} /><Link to={`/scan-logs?patrol_session_id=${session.id}`} className="inline-flex h-10 items-center justify-center rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 text-xs font-black text-cyan-200">View all scans for this session</Link></div><div><p className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">Checkpoint Timeline</p>{checkpoints.length ? <div className="space-y-2">{checkpoints.map((checkpoint, index) => <CheckpointTimelineRow key={checkpoint.id ?? `${checkpoint.checkpoint_id}-${index}`} checkpoint={checkpoint} index={index} />)}</div> : <EmptyState title="No checkpoint timeline yet" body="This session exists, but no patrol_session_checkpoints are linked yet." />}</div></div></SocPanel>;
}

function TimelineItem({ session, selected, onSelect }: { session: SessionRow; selected: boolean; onSelect: () => void }) {
  const progress = patrolSessionProgress(session);
  return <button type="button" onClick={onSelect} className={`w-full rounded-xl border p-3 text-left transition ${selected ? "border-emerald-400/35 bg-emerald-400/10" : "border-white/10 bg-black/20 hover:border-emerald-400/20"}`}><div className="flex items-start gap-3"><span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${dotTone(statusTone(session.status))}`}><Clock3 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="font-mono text-sm font-black text-white">{formatTime(session.scheduled_start)}</p><StatusBadge status={session.status} /></div><p className="mt-1 truncate text-sm font-semibold text-slate-200">{patrolSessionLabel(session)}</p><p className="mt-1 truncate text-xs text-slate-500">{deviceLabel(session)} - {progress.completed}/{progress.total || 0}</p></div></div></button>;
}

function CheckpointTimelineRow({ checkpoint, index }: { checkpoint: any; index: number }) {
  return <div className="grid gap-3 rounded-xl border border-white/10 bg-black/20 p-3 sm:grid-cols-[44px_1fr_120px_120px_120px]"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-200">{index + 1}</span><div><p className="font-semibold text-white">{checkpointName(checkpoint)}</p><p className="font-mono text-xs text-slate-500">{checkpoint.checkpoints?.nfc_tag_id || checkpoint.checkpoint_id}</p></div><SmallDatum label="Expected" value={formatTime(checkpoint.scheduled_at)} /><SmallDatum label="Scanned" value={formatTime(checkpoint.scanned_at)} /><div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Status</p><StatusBadge status={checkpoint.status || (checkpoint.scanned_at ? "scanned" : "pending")} /></div></div>;
}

function DetailBlock({ title, rows }: { title: string; rows: string[][] }) { return <div className="rounded-xl border border-white/10 bg-black/20 p-4"><p className="mb-3 text-[10px] font-black uppercase tracking-wider text-slate-500">{title}</p><div className="space-y-2">{rows.map(([label, value]) => <div key={label} className="flex justify-between gap-4 text-sm"><span className="text-slate-500">{label}</span><span className="max-w-[62%] break-words text-right font-semibold text-slate-200">{value}</span></div>)}</div></div>; }
function SmallDatum({ label, value }: { label: string; value: string }) { return <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 text-sm font-semibold text-slate-200">{value}</p></div>; }
function FilterShell({ label, children }: { label: string; children: React.ReactNode }) { return <label className="rounded-lg border border-white/10 bg-slate-950/80 px-3 py-1.5"><span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span>{children}</label>; }
function FilterSelect({ label, value, onChange, options, rawOptions }: { label: string; value: string; onChange: (value: string) => void; options: string[]; rawOptions?: string[] }) { const source = rawOptions ?? options; return <label className="rounded-lg border border-white/10 bg-slate-950/80 px-3 py-1.5"><span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-full bg-transparent text-sm font-semibold text-slate-200 outline-none"><option value="all" className="bg-slate-950">All {label}s</option>{source.filter((option) => option !== "all").map((option) => <option key={option} value={option} className="bg-slate-950">{rawOptions ? prettify(option) : option}</option>)}</select></label>; }
function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="rounded-lg border border-white/10 bg-slate-950/80 px-3 py-1.5"><span className="block text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span><input type="date" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-full bg-transparent text-sm font-semibold text-slate-200 outline-none" /></label>; }
function Pagination({ page, pageCount, pageSize, onPage, onPageSize }: { page: number; pageCount: number; pageSize: number; onPage: (page: number) => void; onPageSize: (size: number) => void }) { return <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3 text-xs text-slate-400"><span>Page {page} of {pageCount}</span><div className="flex items-center gap-2"><button type="button" disabled={page <= 1} onClick={() => onPage(page - 1)} className="h-8 rounded-lg border border-white/10 px-3 disabled:opacity-40">Prev</button><button type="button" disabled={page >= pageCount} onClick={() => onPage(page + 1)} className="h-8 rounded-lg border border-white/10 px-3 disabled:opacity-40">Next</button><select value={pageSize} onChange={(event) => { onPageSize(Number(event.target.value)); onPage(1); }} className="h-8 rounded-lg border border-white/10 bg-slate-950 px-2 text-slate-200">{pageSizeOptions.map((size) => <option key={size} value={size}>{size} / page</option>)}</select></div></div>; }
function StatusBadge({ status }: { status?: string | null }) { const tone = statusTone(status); return <span className={`inline-flex w-fit rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${badgeTone(tone)}`}>{prettify(status || "unknown")}</span>; }
function GpsBadge({ session }: { session: SessionRow }) { const checkpoints = sortedCheckpoints(session); const scanned = checkpoints.filter((checkpoint) => checkpoint.scanned_at); const linked = checkpoints.filter((checkpoint) => checkpoint.scan_log_id); const label = linked.length ? "GPS Available" : scanned.length ? "GPS Partial" : "GPS Missing"; const tone = linked.length ? "green" : scanned.length ? "amber" : "neutral"; return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-black ${dotTone(tone)}`} title="Detailed latitude, longitude and accuracy are shown in Scan Logs."><MapPin className="h-3 w-3" />{label}</span>; }
function LoadingState({ label }: { label: string }) { return <div className="flex min-h-36 items-center justify-center gap-2 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }
function EmptyState({ title, body }: { title: string; body: string }) { return <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-6 text-center"><p className="font-bold text-white">{title}</p><p className="mt-2 text-sm text-slate-400">{body}</p></div>; }
function ErrorState({ onRetry }: { onRetry: () => void }) { return <div className="rounded-xl border border-red-400/25 bg-red-500/10 p-4 text-sm text-red-100"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><span>Session logs could not be loaded. Realtime/details failures will not break the rest of the page.</span><button type="button" onClick={onRetry} className="h-9 rounded-lg border border-red-300/30 px-3 text-xs font-black">Retry</button></div></div>; }

function buildKpis(sessions: SessionRow[]) {
  const expected = sessions.filter((session) => !["cancelled", "paused"].includes(session.status));
  const completed = expected.filter((session) => session.status === "completed").length;
  const completedLate = expected.filter((session) => completedLateStatuses.has(session.status)).length;
  const active = expected.filter((session) => activeStatuses.has(session.status)).length;
  const incomplete = expected.filter((session) => incompleteStatuses.has(session.status)).length;
  const missed = expected.filter((session) => missedStatuses.has(session.status)).length;
  const completedRequired = completed + completedLate;
  const compliance = expected.length ? Math.round((completedRequired / expected.length) * 100) : 0;
  const completedRate = expected.length ? Math.round((completed / expected.length) * 100) : 0;
  return { scheduled: expected.length, active, completed, completedLate, incomplete, missed, compliance, completedRate };
}
function uniqueOptions(values: string[]) { return Array.from(new Set(values.filter(Boolean).filter((value) => value !== "-"))).sort(); }
function sortedCheckpoints(session: SessionRow) { return [...(session?.patrol_session_checkpoints ?? [])].sort((a, b) => Number(a.sequence_order ?? a.scheduled_order ?? 0) - Number(b.sequence_order ?? b.scheduled_order ?? 0)); }
function displaySessionId(session: SessionRow) { const start = session.scheduled_start ? format(new Date(session.scheduled_start), "yyyy-MMdd") : "unknown"; const suffix = String(session.id ?? "").replace(/-/g, "").slice(0, 4).toUpperCase(); return `PAT-${start}-${suffix}`; }
function routeName(session: SessionRow) { return session.patrol_routes?.name || session.route_name || "No route"; }
function scheduleName(session: SessionRow) { return session.patrol_schedules?.name || session.schedule_name || "No schedule"; }
function siteName(session: SessionRow) { return session.sites?.name || session.site_name || "Unassigned site"; }
function checkpointName(checkpoint: any) { return checkpoint?.checkpoints?.name || checkpoint?.checkpoint_name || checkpoint?.name || "Unnamed checkpoint"; }
function deviceLabel(session: SessionRow) { const raw = session.device_name || session.devices?.device_name || session.devices?.name || session.device_identifier || session.device_id; if (!raw) return "Unassigned device"; if (String(raw).startsWith("mxp-")) return `RG360-${String(raw).slice(-4).toUpperCase()}`; return String(raw); }
function durationLabel(session: SessionRow) { const start = session.actual_start ? new Date(session.actual_start).getTime() : null; const end = session.actual_end ? new Date(session.actual_end).getTime() : null; if (!start || !end || end < start) return "-"; const minutes = Math.round((end - start) / 60000); return `${minutes}m`; }
function complianceResult(session: SessionRow) { if (session.status === "completed") return "Compliant"; if (session.status === "completed_late") return "Compliant late"; if (attentionStatuses.has(session.status)) return "Requires attention"; return "Pending"; }
function statusTone(status?: string | null): SessionStatusTone { if (status === "completed") return "green"; if (activeStatuses.has(status ?? "")) return "blue"; if (scheduledStatuses.has(status ?? "") || completedLateStatuses.has(status ?? "") || ["late_start", "late", "delayed"].includes(status ?? "")) return "amber"; if (missedStatuses.has(status ?? "") || incompleteStatuses.has(status ?? "")) return "red"; return "neutral"; }
function badgeTone(tone: SessionStatusTone) { if (tone === "green") return "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"; if (tone === "blue") return "border-cyan-400/30 bg-cyan-400/10 text-cyan-300"; if (tone === "amber") return "border-amber-400/30 bg-amber-400/10 text-amber-300"; if (tone === "red") return "border-red-400/30 bg-red-400/10 text-red-300"; return "border-white/10 bg-white/5 text-slate-300"; }
function dotTone(tone: SessionStatusTone) { if (tone === "green") return "bg-emerald-400/15 text-emerald-300"; if (tone === "blue") return "bg-cyan-400/15 text-cyan-300"; if (tone === "amber") return "bg-amber-400/15 text-amber-300"; if (tone === "red") return "bg-red-400/15 text-red-300"; return "bg-white/10 text-slate-300"; }
function formatDateTime(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : format(date, "MMM d, yyyy HH:mm"); }
function formatTime(value?: string | null) { if (!value) return "-"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "-" : format(date, "HH:mm"); }
function timeBucket(hour: number) { if (!Number.isFinite(hour)) return "all"; if (hour >= 5 && hour < 12) return "morning"; if (hour >= 12 && hour < 18) return "afternoon"; return "night"; }
function prettify(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }