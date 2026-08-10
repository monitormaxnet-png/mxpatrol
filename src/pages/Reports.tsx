import { useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import {
  AlertCircle,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileText,
  Loader2,
  Plus,
  Search,
  Share2,
  ShieldCheck,
  Star,
  Trash2,
  Wifi,
  X,
  Zap,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useReportJobs, useReports, type ReportJob } from "@/hooks/useReports";
import { patrolScanCheckpointName, patrolScanDeviceIdentity, useCompanyId, useLivePatrolScans } from "@/hooks/usePatrolScanData";
import { supabase } from "@/integrations/supabase/client";
import SiteSelector from "@/components/sites/SiteSelector";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { SocPageShell } from "@/components/dashboard/SocComponents";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";
import { usePatrolSessionReports, usePatrolSessions } from "@/hooks/useScheduledPatrols";

type DateRange = "today" | "7d" | "30d";
type ReportTab = "all" | "generated" | "scheduled" | "pending" | "failed";
type ReportData = {
  title?: string;
  sections?: Array<{ heading: string; content: string }>;
  recommendations?: string[];
};
type ReportRecord = {
  id: string;
  company_id: string;
  report_type: string;
  summary_text: string | null;
  data: unknown;
  generated_at: string;
};
type SessionExecutionReportRow = {
  session_id: string;
  schedule_name?: string | null;
  template_name?: string | null;
  route_name?: string | null;
  site_name?: string | null;
  device_identifier?: string | null;
  device_id?: string | null;
  scheduled_start?: string | null;
  scheduled_end?: string | null;
  actual_start?: string | null;
  actual_end?: string | null;
  expected_checkpoints?: number | null;
  completed_checkpoints?: number | null;
  missed_checkpoint_count?: number | null;
  missed_checkpoint_names?: string[] | null;
  incident_count?: number | null;
  sos_count?: number | null;
  duration_seconds?: number | null;
  status?: string | null;
};type CountRow = { id?: string };
type QueryResult<T = unknown> = {
  data?: T[] | null;
  count?: number | null;
  error?: { message?: string } | null;
};
type QueryLike<T = unknown> = PromiseLike<QueryResult<T>> & {
  select: (columns: string, options?: { count?: "exact"; head?: boolean }) => QueryLike<T>;
  eq: (column: string, value: unknown) => QueryLike<T>;
  gte: (column: string, value: string) => QueryLike<T>;
};
type SupabaseQueryClient = { from: <T = unknown>(table: string) => QueryLike<T> };

const db = supabase as unknown as SupabaseQueryClient;

const reportTypeLabels: Record<string, string> = {
  daily: "Daily Patrol Report",
  weekly: "Weekly Security Summary",
  monthly: "Monthly Compliance Report",
  quarterly: "Quarterly Analytics Report",
};

const dateRangeStart = (range: DateRange) => {
  const date = new Date();
  if (range === "today") date.setHours(0, 0, 0, 0);
  if (range === "7d") date.setDate(date.getDate() - 7);
  if (range === "30d") date.setDate(date.getDate() - 30);
  return date.toISOString();
};

const titleCase = (value: string) => value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
const reportLabel = (type?: string | null) => reportTypeLabels[type ?? ""] ?? `${titleCase(type ?? "custom")} Report`;
const formatTime = (value?: string | null) => value ? format(new Date(value), "dd MMM yyyy HH:mm") : "Not available";
const rangeLabel = (range: DateRange) => range === "today" ? "Today" : range === "7d" ? "Last 7 Days" : "Last 30 Days";

async function countRows(table: string, companyId: string, since: string, apply?: (query: QueryLike<CountRow>) => QueryLike<CountRow>) {
  let query = db.from<CountRow>(table).select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("created_at", since);
  if (apply) query = apply(query);
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}
const Reports = () => {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();
  const { data: reportRows = [], isLoading, error: reportsError } = useReports();
  const { data: reportJobs = [], isLoading: jobsLoading, error: jobsError } = useReportJobs();
  const reports = reportRows as ReportRecord[];
  const [siteId, setSiteId] = useState("all");
  const [dateRange, setDateRange] = useState<DateRange>("7d");
  const [reportType, setReportType] = useState("all");
  const [activeTab, setActiveTab] = useState<ReportTab>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const realtime = useRealtimeConnectionStatus("reports-management");
  const since = useMemo(() => dateRangeStart(dateRange), [dateRange]);
  const { data: scans = [], isLoading: scansLoading, error: scansError } = useLivePatrolScans(250, siteId);
  const { data: reportSessions = [] } = usePatrolSessions(250, siteId);
  const { data: sessionReportRows = [], isLoading: sessionReportsLoading, error: sessionReportsError } = usePatrolSessionReports(250, siteId);

  const { data: company } = useQuery({
    queryKey: ["reports_company", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase.from("companies").select("name").eq("id", companyId!).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ["reports_metrics", companyId, since],
    enabled: !!companyId,
    staleTime: 20_000,
    queryFn: async () => {
      const [incidents, sos] = await Promise.all([
        countRows("incidents", companyId!, since),
        countRows("alerts", companyId!, since, (query) => query.eq("type", "panic_button")),
      ]);
      return { incidents, sos };
    },
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase.channel(`reports-management-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_reports", filter: `company_id=eq.${companyId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["ai_reports", companyId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_logs", filter: `company_id=eq.${companyId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["live_patrol_scans", companyId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "report_jobs", filter: `company_id=eq.${companyId}` }, () => {
        void queryClient.invalidateQueries({ queryKey: ["report_jobs", companyId] });
        void queryClient.invalidateQueries({ queryKey: ["ai_reports", companyId] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [companyId, queryClient]);

  const companyName = company?.name ?? "Current company";
  const registeredScans = useMemo(() => scans.filter((scan) => scan.tag_status === "registered" || !!scan.checkpoint_id), [scans]);
  const periodScans = useMemo(() => registeredScans.filter((scan) => scan.scanned_at >= since), [registeredScans, since]);
  const reportTypes = useMemo(() => Array.from(new Set([...reports.map((report) => report.report_type), ...reportJobs.map((job) => job.report_type)])).sort(), [reportJobs, reports]);

  const filteredReports = useMemo(() => reports.filter((report) => {
    const data = report.data as ReportData | null;
    const title = data?.title ?? reportLabel(report.report_type);
    const text = `${title} ${report.report_type} ${report.summary_text ?? ""}`.toLowerCase();
    return report.generated_at >= since
      && (reportType === "all" || report.report_type === reportType)
      && (activeTab === "all" || activeTab === "generated")
      && (!search || text.includes(search.toLowerCase()));
  }), [activeTab, reportType, reports, search, since]);
  const filteredJobs = useMemo(() => reportJobs.filter((job) => {
    const statusMatch = activeTab === "scheduled"
      ? job.status === "scheduled"
      : activeTab === "pending"
        ? job.status === "pending" || job.status === "running"
        : activeTab === "failed"
          ? job.status === "failed"
          : false;
    const time = job.scheduled_for ?? job.created_at;
    const siteMatch = siteId === "all" || job.site_id === siteId;
    const text = `${reportLabel(job.report_type)} ${job.report_type} ${job.status} ${job.error_message ?? ""} ${job.sites?.name ?? ""}`.toLowerCase();
    return statusMatch
      && time >= since
      && siteMatch
      && (reportType === "all" || job.report_type === reportType)
      && (!search || text.includes(search.toLowerCase()));
  }), [activeTab, reportJobs, reportType, search, since, siteId]);

  const selected = useMemo(() => filteredReports.find((report) => report.id === selectedId) ?? filteredReports[0] ?? null, [filteredReports, selectedId]);
  const sessionReports = useMemo(() => sessionReportRows.filter((session) => (session.scheduled_start ?? "") >= since), [sessionReportRows, since]);
  const expectedSessions = reportSessions.filter((session) => session.scheduled_start >= since && session.status !== "cancelled");
  const completedExpectedSessions = expectedSessions.filter((session) => ["completed", "completed_late"].includes(session.status));
  const compliance = expectedSessions.length === 0 ? (periodScans.length === 0 ? 0 : Math.round((periodScans.filter((scan) => scan.checkpoint_id || scan.tag_status === "registered").length / periodScans.length) * 1000) / 10) : Math.round((completedExpectedSessions.length / expectedSessions.length) * 1000) / 10;
  const patrolMinutes = useMemo(() => {
    if (periodScans.length < 2) return 0;
    const times = periodScans.map((scan) => new Date(scan.scanned_at).getTime()).sort((a, b) => a - b);
    return Math.round((times[times.length - 1] - times[0]) / 60000);
  }, [periodScans]);

  const reportsByType = useMemo(() => {
    const counts = new Map<string, number>();
    filteredReports.forEach((report) => counts.set(report.report_type, (counts.get(report.report_type) ?? 0) + 1));
    return Array.from(counts.entries());
  }, [filteredReports]);

  const handleGenerate = async (overrideType?: string) => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-report", {
        body: { report_type: overrideType ?? (reportType === "all" ? "daily" : reportType), site_id: siteId === "all" ? null : siteId, date_range: dateRange },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Report generated");
      void queryClient.invalidateQueries({ queryKey: ["ai_reports", companyId] });
      void queryClient.invalidateQueries({ queryKey: ["report_jobs", companyId] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  const exportCsv = () => {
    const headers = ["Company ID", "Company Name", "Site", "DeviceIdentity", "CheckpointName", "Date", "TimeStamp", "Longitude", "Latitude", "GPS Accuracy", "Scan Status"];
    const rows = periodScans.map((scan) => [
      scan.company_id,
      companyName,
      scan.sites?.name || scan.checkpoints?.sites?.name || "Unassigned",
      patrolScanDeviceIdentity(scan),
      patrolScanCheckpointName(scan),
      format(new Date(scan.scanned_at), "yyyy-MM-dd"),
      format(new Date(scan.scanned_at), "HH:mm:ss"),
      scan.gps_lng ?? "Unavailable",
      scan.gps_lat ?? "Unavailable",
      scan.gps_accuracy ?? "Unavailable",
      scan.tag_status ?? "registered",
    ]);
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `mxpatrol-report-export-${format(new Date(), "yyyyMMdd-HHmmss")}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <SocPageShell title="Reports" subtitle="Generate and manage patrol, incident and activity reports" realtime={realtime}>
      <div className="space-y-5 text-white">
        <section className="grid gap-3 xl:grid-cols-4">
          <div className="grid gap-3 md:grid-cols-4 xl:col-span-3">
            <FilterBox label="Company"><span className="font-semibold text-white">{companyName}</span></FilterBox>
            <FilterBox label="Site"><SiteSelector value={siteId} onChange={setSiteId} /></FilterBox>
            <FilterBox label="Report Type">
              <Select value={reportType} onValueChange={setReportType}>
                <SelectTrigger className="h-9 border-white/10 bg-slate-950/70 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  {reportTypes.map((type) => <SelectItem key={type} value={type}>{reportLabel(type)}</SelectItem>)}
                </SelectContent>
              </Select>
            </FilterBox>
            <FilterBox label="Date Range">
              <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
                <SelectTrigger className="h-9 border-white/10 bg-slate-950/70 text-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">Today</SelectItem>
                  <SelectItem value="7d">Last 7 Days</SelectItem>
                  <SelectItem value="30d">Last 30 Days</SelectItem>
                </SelectContent>
              </Select>
            </FilterBox>
          </div>
          <div className="flex gap-2">
            <button onClick={() => void handleGenerate()} disabled={generating} className="inline-flex h-11 items-center gap-2 rounded-lg border border-sky-400/30 bg-sky-500/10 px-4 text-sm font-bold text-sky-200 disabled:opacity-50">
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />} Generate Report
            </button>
            <button onClick={() => void handleGenerate()} disabled={generating} className="inline-flex h-11 items-center gap-2 rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-4 text-sm font-bold text-emerald-100 disabled:opacity-50">
              <Plus className="h-4 w-4" /> New Report
            </button>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard icon={FileText} tone="purple" label="Reports Generated" value={filteredReports.length} detail={rangeLabel(dateRange)} />
          <MetricCard icon={ShieldCheck} tone="green" label="Patrol Compliance" value={`${compliance}%`} detail={expectedSessions.length ? "Completed expected sessions" : "Registered scan ratio"} />
          <MetricCard icon={Clock} tone="blue" label="Total Patrol Time" value={formatDuration(patrolMinutes)} detail="Derived from scan window" />
          <MetricCard icon={AlertCircle} tone="amber" label="Incidents Reported" value={metricsLoading ? "--" : metrics?.incidents ?? 0} detail={rangeLabel(dateRange)} />
          <MetricCard icon={FileText} tone="cyan" label="Total Scans" value={scansLoading ? "--" : periodScans.length} detail="Registered scans only" />
        </section>


        <ExecutiveSummary compliance={compliance} completed={completedExpectedSessions.length} expected={expectedSessions.length} scans={periodScans.length} patrolMinutes={patrolMinutes} incidents={metrics?.incidents ?? 0} sos={metrics?.sos ?? 0} />

        <SessionExecutionReportsTable rows={sessionReports as unknown as SessionExecutionReportRow[]} loading={sessionReportsLoading} error={sessionReportsError} />

        {scansError && <div className="rounded-lg border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">Scan report data could not be loaded.</div>}

        <section className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2 rounded-xl border border-white/10 bg-slate-950/72">
            <div className="flex flex-col gap-3 border-b border-white/10 p-4 lg:flex-row lg:items-center lg:justify-between">
              <ReportTabs active={activeTab} onChange={setActiveTab} />
              <div className="flex gap-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reports..." className="h-10 w-56 rounded-lg border border-white/10 bg-slate-950/80 pl-9 pr-3 text-sm text-white outline-none" />
                </div>
                <button onClick={exportCsv} disabled={periodScans.length === 0} className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 px-3 text-sm font-semibold text-slate-200 disabled:opacity-50">
                  <Download className="h-4 w-4" /> Export CSV
                </button>
              </div>
            </div>
            <ReportTableState loading={isLoading} error={reportsError} jobsLoading={jobsLoading} jobsError={jobsError} activeTab={activeTab} reports={filteredReports} jobs={filteredJobs} selectedId={selected?.id ?? null} companyName={companyName} siteLabel={siteId === "all" ? "All Sites" : "Selected site"} onSelect={setSelectedId} onExport={exportCsv} />
          </div>
          <div className="space-y-4">
            <AiInsightsPanel compliance={compliance} scans={periodScans.length} reports={filteredReports.length} incidents={metrics?.incidents ?? 0} sos={metrics?.sos ?? 0} />
            <QuickActions generating={generating} onGenerate={() => void handleGenerate()} onExecutive={() => void handleGenerate("executive")} onExport={exportCsv} csvDisabled={periodScans.length === 0} />
            <AnalyticsPanel reportsByType={reportsByType} total={filteredReports.length} />
            <ScheduledReportsPanel jobs={reportJobs} />
          </div>
          <div className="xl:col-start-3">
            <ReportDetails report={selected} companyName={companyName} siteLabel={siteId === "all" ? "All Sites" : "Selected site"} scanCount={periodScans.length} incidents={metrics?.incidents ?? 0} sosEvents={metrics?.sos ?? 0} onClose={() => setSelectedId(null)} onExport={exportCsv} />
          </div>
        </section>

        <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-slate-950/60 px-4 py-3 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2"><Wifi className="h-4 w-4 text-emerald-300" />{realtimeStatusLabel(realtime.status)}</span>
          <span>Compliance uses completed expected patrol sessions when available; raw exports still use registered scan_logs.</span>
        </footer>
      </div>
    </SocPageShell>
  );
};
function SessionExecutionReportsTable({ rows, loading, error }: { rows: SessionExecutionReportRow[]; loading: boolean; error: unknown }) {
  if (loading) return <State icon={Loader2} spin message="Loading session execution reports..." />;
  if (error) return <State icon={AlertCircle} tone="red" message="Session execution reports could not be loaded." />;
  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/72">
      <div className="flex flex-col gap-2 border-b border-white/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">Session Execution Reports</h2>
          <p className="mt-1 text-xs text-slate-400">Schedule, session, checkpoints, missed checkpoints, incidents and SOS in one company-scoped view.</p>
        </div>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">Realtime</span>
      </div>
      {rows.length === 0 ? <State icon={FileText} message="No session execution reports match this date range." /> : (
        <div className="overflow-auto p-4">
          <table className="w-full min-w-[1180px] text-left text-sm">
            <thead className="border-b border-white/10 text-xs font-black uppercase tracking-widest text-slate-500">
              <tr>
                <th className="px-3 py-3">Session</th>
                <th className="px-3 py-3">Schedule</th>
                <th className="px-3 py-3">Site</th>
                <th className="px-3 py-3">DeviceIdentity</th>
                <th className="px-3 py-3">Start</th>
                <th className="px-3 py-3">End</th>
                <th className="px-3 py-3">Checkpoints</th>
                <th className="px-3 py-3">Missed Checkpoints</th>
                <th className="px-3 py-3">Incidents</th>
                <th className="px-3 py-3">SOS</th>
                <th className="px-3 py-3">Duration</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((row) => (
                <tr key={row.session_id} className="hover:bg-white/5">
                  <td className="px-3 py-3 font-mono text-xs text-slate-300">{String(row.session_id).slice(0, 8)}</td>
                  <td className="px-3 py-3 text-slate-200">{row.schedule_name || row.template_name || row.route_name || "Scheduled patrol"}</td>
                  <td className="px-3 py-3 text-slate-300">{row.site_name || "Unassigned"}</td>
                  <td className="px-3 py-3 font-mono text-xs text-slate-300">{row.device_identifier || row.device_id || "Any device"}</td>
                  <td className="px-3 py-3 text-slate-300">{formatTime(row.actual_start || row.scheduled_start)}</td>
                  <td className="px-3 py-3 text-slate-300">{formatTime(row.actual_end || row.scheduled_end)}</td>
                  <td className="px-3 py-3 text-slate-300">{Number(row.completed_checkpoints ?? 0)} / {Number(row.expected_checkpoints ?? 0)}</td>
                  <td className="px-3 py-3 text-slate-300">{formatMissed(row)}</td>
                  <td className="px-3 py-3 text-slate-300">{Number(row.incident_count ?? 0)}</td>
                  <td className="px-3 py-3 text-slate-300">{Number(row.sos_count ?? 0)}</td>
                  <td className="px-3 py-3 text-slate-300">{formatDurationSeconds(row.duration_seconds)}</td>
                  <td className="px-3 py-3"><span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs font-bold text-slate-200">{titleCase(row.status || "unknown")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
function FilterBox({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex min-h-14 items-center gap-3 rounded-lg border border-white/10 bg-slate-950/70 px-3 text-xs text-slate-500"><span className="shrink-0 font-semibold">{label}</span><div className="min-w-0 flex-1">{children}</div></label>;
}

function MetricCard({ icon: Icon, tone, label, value, detail }: { icon: ComponentType<{ className?: string }>; tone: "green" | "blue" | "amber" | "cyan" | "purple"; label: string; value: string | number; detail: string }) {
  const style = {
    green: "border-emerald-400/20 text-emerald-300 bg-emerald-400/10",
    blue: "border-sky-400/20 text-sky-300 bg-sky-400/10",
    amber: "border-amber-400/20 text-amber-300 bg-amber-400/10",
    cyan: "border-cyan-400/20 text-cyan-300 bg-cyan-400/10",
    purple: "border-violet-400/20 text-violet-300 bg-violet-400/10",
  }[tone];
  return <div className="rounded-xl border border-white/10 bg-slate-950/72 p-4"><div className="flex items-start gap-4"><div className={`flex h-12 w-12 items-center justify-center rounded-full border ${style}`}><Icon className="h-6 w-6" /></div><div><p className="text-3xl font-black text-white">{value}</p><p className="text-sm text-slate-300">{label}</p><p className="mt-2 text-xs text-emerald-300">{detail}</p></div></div></div>;
}

function ReportTabs({ active, onChange }: { active: ReportTab; onChange: (tab: ReportTab) => void }) {
  const tabs: ReportTab[] = ["all", "generated", "scheduled", "pending", "failed"];
  return <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-slate-950/70 p-1">{tabs.map((tab) => <button key={tab} onClick={() => onChange(tab)} className={`rounded-md px-3 py-2 text-xs font-bold uppercase tracking-widest ${active === tab ? "bg-emerald-500/20 text-emerald-200" : "text-slate-400 hover:text-white"}`}>{titleCase(tab)}</button>)}</div>;
}

function ReportTableState({ loading, error, jobsLoading, jobsError, activeTab, reports, jobs, selectedId, companyName, siteLabel, onSelect, onExport }: { loading: boolean; error: unknown; jobsLoading: boolean; jobsError: unknown; activeTab: ReportTab; reports: ReportRecord[]; jobs: ReportJob[]; selectedId: string | null; companyName: string; siteLabel: string; onSelect: (id: string) => void; onExport: () => void }) {
  if (activeTab === "scheduled" || activeTab === "pending" || activeTab === "failed") {
    if (jobsLoading) return <State icon={Loader2} spin message="Loading report jobs..." />;
    if (jobsError) return <State icon={AlertCircle} tone="red" message="Report jobs could not be loaded." />;
    if (jobs.length === 0) return <State icon={CalendarClock} message={`No ${activeTab} report jobs match the current filters.`} />;
    return <ReportJobsTable jobs={jobs} companyName={companyName} />;
  }
  if (loading) return <State icon={Loader2} spin message="Loading reports..." />;
  if (error) return <State icon={AlertCircle} tone="red" message="Reports could not be loaded." />;
  if (reports.length === 0) return <State icon={FileText} message="No generated reports match the current filters." />;
  return <ReportsTable reports={reports} selectedId={selectedId} companyName={companyName} siteLabel={siteLabel} onSelect={onSelect} onExport={onExport} />;
}

function ReportsTable({ reports, selectedId, companyName, siteLabel, onSelect, onExport }: { reports: ReportRecord[]; selectedId: string | null; companyName: string; siteLabel: string; onSelect: (id: string) => void; onExport: () => void }) {
  return (
    <div className="overflow-auto p-4">
      <table className="w-full min-w-full text-left text-sm">
        <thead className="border-b border-white/10 text-xs font-black uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-3 py-3">Favorite</th>
            <th className="px-3 py-3">Report Name</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Company</th>
            <th className="px-3 py-3">Site</th>
            <th className="px-3 py-3">Generated At</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {reports.map((report) => (
            <ReportRow
              key={report.id}
              report={report}
              selected={selectedId === report.id}
              companyName={companyName}
              siteLabel={siteLabel}
              onSelect={onSelect}
              onExport={onExport}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReportRow({ report, selected, companyName, siteLabel, onSelect, onExport }: { report: ReportRecord; selected: boolean; companyName: string; siteLabel: string; onSelect: (id: string) => void; onExport: () => void }) {
  const data = report.data as ReportData | null;
  const title = data?.title || reportLabel(report.report_type);
  return (
    <tr className={`transition hover:bg-white/5 ${selected ? "bg-emerald-500/10 outline outline-1 outline-emerald-400/30" : ""}`}>
      <td className="px-3 py-3"><Star className="h-4 w-4 text-slate-500" /></td>
      <td className="px-3 py-3">
        <button onClick={() => onSelect(report.id)} className="text-left">
          <span className="block font-semibold text-white">{title}</span>
          <span className="block font-mono text-xs text-slate-500">{report.id.slice(0, 8)}</span>
        </button>
      </td>
      <td className="px-3 py-3">
        <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs font-semibold text-emerald-300">
          {titleCase(report.report_type)}
        </span>
      </td>
      <td className="px-3 py-3 text-slate-300">{companyName}</td>
      <td className="px-3 py-3 text-slate-300">{siteLabel}</td>
      <td className="px-3 py-3 text-slate-300">{formatTime(report.generated_at)}</td>
      <td className="px-3 py-3">
        <span className="rounded-md border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-xs font-bold text-emerald-300">Ready</span>
      </td>
      <td className="px-3 py-3">
        <div className="flex gap-1">
          <IconButton label="Preview" icon={Eye} onClick={() => onSelect(report.id)} />
          <IconButton label="Download CSV" icon={Download} onClick={onExport} />
          <IconButton label="Share unavailable" icon={Share2} disabled />
        </div>
      </td>
    </tr>
  );
}

function IconButton({ label, icon: Icon, onClick, disabled }: { label: string; icon: ComponentType<{ className?: string }>; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/10 bg-slate-950/70 text-slate-300 hover:border-emerald-300/40 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-35"
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function State({ icon: Icon, message, spin, tone = "slate" }: { icon: ComponentType<{ className?: string }>; message: string; spin?: boolean; tone?: "slate" | "red" }) {
  const color = tone === "red" ? "text-red-300" : "text-slate-400";
  return (
    <div className={`m-4 flex min-h-52 items-center justify-center gap-2 rounded-lg border border-white/10 bg-slate-950/50 text-sm ${color}`}>
      <Icon className={`h-5 w-5 ${spin ? "animate-spin" : ""}`} />
      {message}
    </div>
  );
}

function ReportJobsTable({ jobs, companyName }: { jobs: ReportJob[]; companyName: string }) {
  return (
    <div className="overflow-auto p-4">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-b border-white/10 text-xs font-black uppercase tracking-widest text-slate-500">
          <tr>
            <th className="px-3 py-3">Job</th>
            <th className="px-3 py-3">Type</th>
            <th className="px-3 py-3">Company</th>
            <th className="px-3 py-3">Site</th>
            <th className="px-3 py-3">Status</th>
            <th className="px-3 py-3">Created</th>
            <th className="px-3 py-3">Finished</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {jobs.map((job) => (
            <tr key={job.id} className="transition hover:bg-white/5">
              <td className="px-3 py-3 font-mono text-xs text-slate-400">{job.id.slice(0, 8)}</td>
              <td className="px-3 py-3 text-slate-200">{reportLabel(job.report_type)}</td>
              <td className="px-3 py-3 text-slate-300">{companyName}</td>
              <td className="px-3 py-3 text-slate-300">{job.sites?.name ?? "All Sites"}</td>
              <td className="px-3 py-3"><JobStatusBadge status={job.status} /></td>
              <td className="px-3 py-3 text-slate-300">{formatTime(job.created_at)}</td>
              <td className="px-3 py-3 text-slate-300">
                {job.error_message ? <span className="text-red-300">{job.error_message}</span> : formatTime(job.completed_at ?? job.failed_at ?? job.scheduled_for)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function JobStatusBadge({ status }: { status: ReportJob["status"] }) {
  const classes = {
    scheduled: "border-sky-400/30 bg-sky-400/10 text-sky-300",
    pending: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    running: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
    completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    failed: "border-red-400/30 bg-red-400/10 text-red-300",
  }[status];
  return <span className={`rounded-md border px-2 py-1 text-xs font-bold ${classes}`}>{titleCase(status)}</span>;
}
function AnalyticsPanel({ reportsByType, total }: { reportsByType: Array<[string, number]>; total: number }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/72 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold text-white">Report Analytics</h3>
        <BarChart3 className="h-4 w-4 text-emerald-300" />
      </div>
      <div className="space-y-3">
        {reportsByType.length === 0 ? <p className="text-sm text-slate-500">No report type data yet.</p> : reportsByType.map(([type, count]) => (
          <div key={type}>
            <div className="mb-1 flex justify-between text-xs">
              <span className="text-slate-300">{reportLabel(type)}</span>
              <span className="text-slate-400">{count}</span>
            </div>
            <div className="h-2 rounded-full bg-white/10">
              <div className="h-2 rounded-full bg-emerald-400" style={{ width: `${Math.max(6, (count / Math.max(1, total)) * 100)}%` }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduledReportsPanel({ jobs }: { jobs: ReportJob[] }) {
  const scheduled = jobs.filter((job) => job.status === "scheduled").length;
  const pending = jobs.filter((job) => job.status === "pending" || job.status === "running").length;
  const failed = jobs.filter((job) => job.status === "failed").length;
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/72 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-bold text-white">Report Jobs</h3>
        <span className="rounded-full border border-emerald-400/20 px-2 py-1 text-xs text-emerald-300">Live tracking</span>
      </div>
      <div className="grid gap-2 text-sm">
        <div className="flex justify-between text-slate-300"><span>Scheduled</span><span className="font-bold text-sky-300">{scheduled}</span></div>
        <div className="flex justify-between text-slate-300"><span>Pending / Running</span><span className="font-bold text-amber-300">{pending}</span></div>
        <div className="flex justify-between text-slate-300"><span>Failed</span><span className="font-bold text-red-300">{failed}</span></div>
      </div>
    </div>
  );
}

function ReportDetails({ report, companyName, siteLabel, scanCount, incidents, sosEvents, onClose, onExport }: { report: ReportRecord | null; companyName: string; siteLabel: string; scanCount: number; incidents: number; sosEvents: number; onClose: () => void; onExport: () => void }) {
  if (!report) return <aside className="rounded-xl border border-white/10 bg-slate-950/72 p-4"><State icon={FileText} message="Select a report to view details." /></aside>;
  const data = report.data as ReportData | null;
  const title = data?.title || reportLabel(report.report_type);
  const recommendations = data?.recommendations ?? [];
  return (
    <aside className="rounded-xl border border-white/10 bg-slate-950/80 p-4">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h3 className="font-heading text-lg font-bold text-white">{title}</h3>
          <p className="text-sm text-slate-400">{siteLabel} - {formatTime(report.generated_at)}</p>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
      </div>
      <div className="mb-4 flex gap-2 border-b border-white/10">
        <span className="border-b-2 border-emerald-400 px-3 py-2 text-xs font-bold text-emerald-300">Overview</span>
        <span className="px-3 py-2 text-xs font-bold text-slate-500">Content</span>
        <span className="px-3 py-2 text-xs font-bold text-slate-500">History</span>
      </div>
      <dl className="space-y-2 text-sm">
        <Detail label="Report ID" value={report.id.slice(0, 8)} />
        <Detail label="Report Type" value={reportLabel(report.report_type)} />
        <Detail label="Company" value={companyName} />
        <Detail label="Site" value={siteLabel} />
        <Detail label="Generated At" value={formatTime(report.generated_at)} />
        <Detail label="Format" value="AI report / CSV export" />
        <Detail label="Status" value="Ready" />
      </dl>
      <div className="mt-5 rounded-lg border border-white/10 bg-white/5 p-4">
        <h4 className="mb-3 font-bold text-white">Key Highlights</h4>
        <ul className="space-y-2 text-sm text-slate-300">
          <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" />{scanCount} registered scans in current filter</li>
          <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" />{incidents} incidents recorded</li>
          <li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" />{sosEvents} SOS events recorded</li>
          {recommendations.slice(0, 2).map((item) => <li key={item} className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-300" />{item}</li>)}
        </ul>
      </div>
      <div className="mt-5 rounded-lg border border-white/10 bg-white p-4 text-slate-950">
        <div className="flex justify-center"><TTechMxPatrolLogo variant="report" className="w-40" /></div>
        <p className="mt-4 font-bold">{title}</p>
        <p className="text-xs text-slate-500">{companyName} - {siteLabel}</p>
      </div>
      <div className="mt-5 grid gap-2">
        <button onClick={onExport} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 text-sm font-bold text-emerald-200"><Download className="h-4 w-4" />Download CSV</button>
        <button disabled className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-white/10 text-sm font-bold text-slate-500"><Share2 className="h-4 w-4" />Share requires backend</button>
        <button disabled className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-400/30 text-sm font-bold text-red-300 opacity-60"><Trash2 className="h-4 w-4" />Delete disabled</button>
      </div>
    </aside>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-4"><dt className="text-slate-500">{label}</dt><dd className="text-right font-medium text-slate-200">{value}</dd></div>;
}

function ExecutiveSummary({ compliance, completed, expected, scans, patrolMinutes, incidents, sos }: { compliance: number; completed: number; expected: number; scans: number; patrolMinutes: number; incidents: number; sos: number }) {
  const issues = incidents + sos + Math.max(0, expected - completed);
  const target = expected || Math.max(scans, 1);

  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/72 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">Executive Summary</h2>
        <span className="rounded-full border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-300">Live operation</span>
      </div>
      <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
        <SummaryTile label="Today Compliance" value={`${compliance}%`} />
        <SummaryTile label="Patrols" value={`${completed} / ${target}`} caption={expected ? "Completed" : "Scans"} />
        <SummaryTile label="Attendance" value="N/A" caption="Future" />
        <SummaryTile label="Incidents" value={incidents} caption="Reported" />
        <SummaryTile label="SOS" value={sos} caption={sos ? "Active" : "Clear"} />
        <SummaryTile label="Outstanding Issues" value={issues} caption="Requires action" />
        <SummaryTile label="Avg Patrol Duration" value={formatDuration(patrolMinutes)} />
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
          <p className="text-xs text-slate-400">Expected vs Completed</p>
          <p className="mt-1 text-lg font-black text-white">{completed || scans} / {target}</p>
          <p className="text-xs font-semibold text-emerald-300">{Math.round(((completed || scans) / target) * 100)}%</p>
        </div>
      </div>
    </section>
  );
}

function SummaryTile({ label, value, caption = "Current" }: { label: string; value: string | number; caption?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-white">{value}</p>
      <p className="text-xs font-semibold text-emerald-300">{caption}</p>
    </div>
  );
}

function AiInsightsPanel({ compliance, scans, reports, incidents, sos }: { compliance: number; scans: number; reports: number; incidents: number; sos: number }) {
  const insights = [
    `Patrol compliance is ${compliance}% for the selected period.`,
    `${scans} registered checkpoint scans are available for reporting.`,
    `${reports} generated reports match the current filters.`,
    incidents ? `${incidents} incidents need operational review.` : "No incident activity is visible in this report range.",
    sos ? `${sos} SOS panic events require executive attention.` : "No SOS panic alerts were recorded in this period.",
  ];

  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/72 p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-bold text-white">AI Operational Insights</h3>
        <span className="rounded-full border border-blue-400/30 bg-blue-400/10 px-2 py-1 text-[10px] font-black text-blue-300">Beta</span>
      </div>
      <div className="space-y-2">
        {insights.map((text) => (
          <div key={text} className="flex gap-2 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-sm text-slate-300">
            <BarChart3 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function QuickActions({ generating, onGenerate, onExecutive, onExport, csvDisabled }: { generating: boolean; onGenerate: () => void; onExecutive: () => void; onExport: () => void; csvDisabled: boolean }) {
  return (
    <div className="rounded-xl border border-white/10 bg-slate-950/72 p-4">
      <h3 className="mb-3 font-bold text-white">Quick Actions</h3>
      <div className="grid gap-2">
        <ActionButton icon={Zap} label="Generate Report" onClick={onGenerate} disabled={generating} />
        <ActionButton icon={ShieldCheck} label="Create Executive Summary" onClick={onExecutive} disabled={generating} />
        <ActionButton icon={CalendarClock} label="Create Schedule" disabled />
        <ActionButton icon={FileText} label="Export PDF" onClick={() => window.print()} />
        <ActionButton icon={Download} label="Export CSV" onClick={onExport} disabled={csvDisabled} />
        <ActionButton icon={Share2} label="Share Report" disabled />
      </div>
    </div>
  );
}

function ActionButton({ icon: Icon, label, onClick, disabled }: { icon: ComponentType<{ className?: string }>; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-sm font-semibold text-slate-300 hover:border-emerald-400/30 hover:text-emerald-200 disabled:cursor-not-allowed disabled:opacity-45">
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}
function estimateReportSize(report: ReportRecord) {
  const kb = Math.max(120, Math.round((JSON.stringify(report.data ?? {}).length + (report.summary_text ?? "").length) / 4));
 return kb > 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;
}

function formatMissed(row: SessionExecutionReportRow) {
  const names = Array.isArray(row.missed_checkpoint_names) ? row.missed_checkpoint_names.filter(Boolean) : [];
  if (names.length) return names.join(", ");
  const count = Number(row.missed_checkpoint_count ?? 0);
  return count ? `${count} missed` : "None";
}

function formatDurationSeconds(value: unknown) {
  const seconds = Number(value ?? 0);
  if (!Number.isFinite(seconds) || seconds <= 0) return "-";
  const minutes = Math.round(seconds / 60);
  return formatDuration(minutes);
}
function formatDuration(minutes: number) {
  if (minutes <= 0) return "0h 00m";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours}h ${String(mins).padStart(2, "0")}m`;
}

export default Reports;


