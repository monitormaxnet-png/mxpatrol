import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { AlertTriangle, Download, Loader2, Search, ShieldCheck, ShieldOff, Smartphone, WifiOff } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNowStrict } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import SiteSelector from "@/components/sites/SiteSelector";
import { SocPageShell } from "@/components/dashboard/SocComponents";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { supabase } from "@/integrations/supabase/client";

type SecurityCounts = { total: number; secure: number; attention: number; disabled: number; offline: number; outdated: number; kiosk_disabled: number; integrity_failures: number };
type DeviceReportRow = { id?: string | null; site_id?: string | null; site?: string | null; device_identifier?: string | null; device_name?: string | null; status?: string | null; app_version?: string | null; last_seen_at?: string | null; secure_mode_status?: string | null; security_state?: string | null; needs_attention?: boolean; patrol_session?: { id?: string | null; name?: string | null; status?: string | null; scheduled_start?: string | null } | null };
type PatrolGroup = SecurityCounts & { patrol_id: string; patrol_name: string; patrol_status: string; scheduled_start?: string | null; rows: DeviceReportRow[] };
type SiteGroup = SecurityCounts & { site_id?: string | null; site_name: string; patrols: PatrolGroup[] };
type DeviceSecurityReport = { generated_at: string; summary: SecurityCounts; rows: DeviceReportRow[]; sites: SiteGroup[] };

const statusOptions = ["all", "Secure", "Attention", "Integrity Failure", "Kiosk Inactive", "Offline", "Disabled", "Revoked", "Outdated app"];

const DeviceSecurityReports = () => {
  const { isPlatformOwner, isLoading: ownerLoading } = usePlatformAdmin();
  const [siteId, setSiteId] = useState("all");
  const [patrolId, setPatrolId] = useState("all");
  const [status, setStatus] = useState("all");
  const [search, setSearch] = useState("");

  const reportQuery = useQuery({
    queryKey: ["device-security-reports", siteId],
    enabled: isPlatformOwner,
    staleTime: 20_000,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("secure-device-management", { body: { action: "get_device_security_reports", site_id: siteId === "all" ? null : siteId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.report as DeviceSecurityReport;
    },
  });

  const report = reportQuery.data;
  const patrolOptions = useMemo(() => {
    const patrols = new Map<string, string>();
    report?.sites.forEach((site) => site.patrols.forEach((patrol) => patrols.set(patrol.patrol_id, patrol.patrol_name)));
    return Array.from(patrols.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [report]);

  const filteredSites = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (report?.sites ?? []).map((site) => ({
      ...site,
      patrols: site.patrols.map((patrol) => ({
        ...patrol,
        rows: patrol.rows.filter((row) => {
          const rowStatus = row.security_state ?? "Attention";
          const text = `${row.device_name ?? ""} ${row.device_identifier ?? ""} ${site.site_name} ${patrol.patrol_name}`.toLowerCase();
          return (patrolId === "all" || patrol.patrol_id === patrolId) && (status === "all" || rowStatus === status) && (!needle || text.includes(needle));
        }),
      })).filter((patrol) => patrol.rows.length > 0),
    })).filter((site) => site.patrols.length > 0);
  }, [patrolId, report?.sites, search, status]);

  const filteredRows = useMemo(() => filteredSites.flatMap((site) => site.patrols.flatMap((patrol) => patrol.rows)), [filteredSites]);

  const exportCsv = () => {
    const headers = ["Site", "Patrol", "Device", "Identifier", "Security State", "Device Status", "App Version", "Last Seen"];
    const rows = filteredSites.flatMap((site) => site.patrols.flatMap((patrol) => patrol.rows.map((row) => [site.site_name, patrol.patrol_name, row.device_name ?? "Patrol Device", row.device_identifier ?? "", row.security_state ?? "Attention", row.status ?? "unknown", row.app_version ?? "unknown", row.last_seen_at ?? ""])));
    const csv = [headers, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `mxpatrol-device-security-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  if (ownerLoading) return <SocPageShell title="Device Security Reports" subtitle="Platform-owner device security analytics"><State icon={Loader2} spin label="Checking owner access..." /></SocPageShell>;
  if (!isPlatformOwner) return <SocPageShell title="Device Security Reports" subtitle="Platform-owner device security analytics"><State icon={ShieldOff} label="Owner access required." tone="red" /></SocPageShell>;

  return (
    <SocPageShell title="Device Security Reports" subtitle="All secure patrol devices grouped by site and patrol">
      <div className="space-y-5 text-white">
        <section className="grid gap-3 xl:grid-cols-[1fr_auto]">
          <div className="grid gap-3 md:grid-cols-4">
            <Filter label="Site"><SiteSelector value={siteId} onChange={setSiteId} /></Filter>
            <Filter label="Patrol"><Select value={patrolId} onValueChange={setPatrolId}><SelectTrigger className="h-9 border-white/10 bg-slate-950/70 text-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Patrols</SelectItem>{patrolOptions.map(([id, name]) => <SelectItem key={id} value={id}>{name}</SelectItem>)}</SelectContent></Select></Filter>
            <Filter label="Security State"><Select value={status} onValueChange={setStatus}><SelectTrigger className="h-9 border-white/10 bg-slate-950/70 text-white"><SelectValue /></SelectTrigger><SelectContent>{statusOptions.map((option) => <SelectItem key={option} value={option}>{option === "all" ? "All States" : option}</SelectItem>)}</SelectContent></Select></Filter>
            <Filter label="Device Search"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm text-white outline-none" placeholder="Device or site" /></div></Filter>
          </div>
          <button onClick={exportCsv} disabled={!filteredRows.length} className="inline-flex h-11 items-center gap-2 self-end rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-200 disabled:opacity-45"><Download className="h-4 w-4" /> Export CSV</button>
        </section>

        <section className="grid gap-3 md:grid-cols-4 xl:grid-cols-8">
          <Metric label="Total" value={report?.summary.total ?? 0} />
          <Metric label="Secure" value={report?.summary.secure ?? 0} tone="green" />
          <Metric label="Attention" value={report?.summary.attention ?? 0} tone="amber" />
          <Metric label="Offline" value={report?.summary.offline ?? 0} />
          <Metric label="Disabled" value={report?.summary.disabled ?? 0} tone="red" />
          <Metric label="Outdated" value={report?.summary.outdated ?? 0} tone="blue" />
          <Metric label="Kiosk Inactive" value={report?.summary.kiosk_disabled ?? 0} tone="amber" />
          <Metric label="Integrity Failures" value={report?.summary.integrity_failures ?? 0} tone="red" />
        </section>

        {reportQuery.isLoading && <State icon={Loader2} spin label="Loading device security reports..." />}
        {reportQuery.isError && <State icon={AlertTriangle} label={reportQuery.error instanceof Error ? reportQuery.error.message : "Device security reports could not load."} tone="red" />}
        {!reportQuery.isLoading && !reportQuery.isError && filteredSites.length === 0 && <State icon={ShieldCheck} label="No device security reports match the current filters." />}
        <section className="space-y-4">{filteredSites.map((site) => <SiteReport key={site.site_id ?? "unassigned"} site={site} />)}</section>
      </div>
    </SocPageShell>
  );
};

function SiteReport({ site }: { site: SiteGroup }) {
  return <div className="rounded-xl border border-white/10 bg-slate-950/72"><div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between"><div><h2 className="text-lg font-black text-white">{site.site_name}</h2><p className="text-sm text-slate-400">{site.total} devices across {site.patrols.length} patrol groups</p></div><div className="grid grid-cols-4 gap-2 text-center text-xs"><Mini label="Secure" value={site.secure} /><Mini label="Attention" value={site.attention} /><Mini label="Offline" value={site.offline} /><Mini label="Disabled" value={site.disabled} /></div></div><div className="divide-y divide-white/10">{site.patrols.map((patrol) => <PatrolReport key={patrol.patrol_id} patrol={patrol} />)}</div></div>;
}

function PatrolReport({ patrol }: { patrol: PatrolGroup }) {
  return <div className="p-4"><div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between"><div><h3 className="font-bold text-white">{patrol.patrol_name}</h3><p className="text-xs text-slate-500">{patrol.patrol_status} {patrol.scheduled_start ? `- ${new Date(patrol.scheduled_start).toLocaleString()}` : ""}</p></div><span className="w-fit rounded-md border border-white/10 bg-white/[0.03] px-2 py-1 text-xs font-bold text-slate-300">{patrol.total} devices</span></div><div className="overflow-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b border-white/10 text-xs font-black uppercase text-slate-500"><tr><th className="px-3 py-2">Device</th><th className="px-3 py-2">Security</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">App</th><th className="px-3 py-2">Last Seen</th><th className="px-3 py-2">Patrol Status</th></tr></thead><tbody className="divide-y divide-white/10">{patrol.rows.map((row) => <DeviceRow key={row.id ?? row.device_identifier ?? row.device_name} row={row} />)}</tbody></table></div></div>;
}

function DeviceRow({ row }: { row: DeviceReportRow }) {
  return <tr className="hover:bg-white/[0.03]"><td className="px-3 py-3"><div className="flex items-center gap-2"><Smartphone className="h-4 w-4 text-emerald-300" /><div><p className="font-semibold text-white">{row.device_name ?? "Patrol Device"}</p><p className="font-mono text-xs text-slate-500">{row.device_identifier ?? "unassigned"}</p></div></div></td><td className="px-3 py-3"><SecurityBadge state={row.security_state ?? "Attention"} /></td><td className="px-3 py-3 text-slate-300">{row.status ?? "unknown"}</td><td className="px-3 py-3 text-slate-300">{row.app_version ?? "unknown"}</td><td className="px-3 py-3 text-slate-300">{row.last_seen_at ? formatDistanceToNowStrict(new Date(row.last_seen_at), { addSuffix: true }) : "No heartbeat"}</td><td className="px-3 py-3 text-slate-300">{row.patrol_session?.status ?? "No linked patrol"}</td></tr>;
}

function Filter({ label, children }: { label: string; children: ReactNode }) {
  return <label className="block rounded-lg border border-white/10 bg-slate-950/60 p-3"><span className="mb-2 block text-xs font-black uppercase text-slate-500">{label}</span>{children}</label>;
}

function Metric({ label, value, tone = "slate" }: { label: string; value: number; tone?: "slate" | "green" | "amber" | "red" | "blue" }) {
  const colors = { slate: "text-white", green: "text-emerald-300", amber: "text-amber-300", red: "text-red-300", blue: "text-sky-300" };
  return <div className="rounded-lg border border-white/10 bg-slate-950/72 p-3"><p className="text-xs text-slate-400">{label}</p><p className={`mt-1 text-2xl font-black ${colors[tone]}`}>{value}</p></div>;
}

function Mini({ label, value }: { label: string; value: number }) {
  return <div className="rounded-md border border-white/10 bg-slate-950/70 px-3 py-2"><p className="font-black text-white">{value}</p><p className="text-slate-500">{label}</p></div>;
}

function SecurityBadge({ state }: { state: string }) {
  const ok = state === "Secure";
  const bad = state === "Disabled" || state === "Revoked" || state === "Integrity Failure";
  const classes = ok ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : bad ? "border-red-400/30 bg-red-400/10 text-red-300" : "border-amber-400/30 bg-amber-400/10 text-amber-300";
  return <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-bold ${classes}`}>{state === "Offline" ? <WifiOff className="h-3 w-3" /> : null}{state}</span>;
}

function State({ icon: Icon, label, spin, tone = "slate" }: { icon: ComponentType<{ className?: string }>; label: string; spin?: boolean; tone?: "slate" | "red" }) {
  return <div className={`flex min-h-64 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/72 p-6 text-sm ${tone === "red" ? "text-red-300" : "text-slate-300"}`}><Icon className={`h-5 w-5 ${spin ? "animate-spin" : ""}`} />{label}</div>;
}

export default DeviceSecurityReports;