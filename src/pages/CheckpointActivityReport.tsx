import { useMemo, useState } from "react";
import { Download, Loader2, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import SiteSelector from "@/components/sites/SiteSelector";
import { SocPageShell } from "@/components/dashboard/SocComponents";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { supabase } from "@/integrations/supabase/client";

type ScanRow = { id: string; site_id: string | null; device_identifier: string | null; scanned_at: string; gps_lat: number | null; gps_lng: number | null; gps_accuracy: number | null; checkpoints?: { id: string; name: string } | null; sites?: { name: string } | null };
const db = supabase as any;
const today = () => new Date().toISOString().slice(0, 10);

export default function CheckpointActivityReport() {
  const { data: companyId } = useCompanyId();
  const [siteId, setSiteId] = useState("all");
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [checkpoint, setCheckpoint] = useState("all");
  const [device, setDevice] = useState("");
  const [search, setSearch] = useState("");

  const scans = useQuery({
    queryKey: ["checkpoint-activity-report", companyId, siteId, from, to, checkpoint, device],
    enabled: !!companyId,
    queryFn: async () => {
      const start = new Date(`${from}T00:00:00`).toISOString();
      const end = new Date(`${to}T23:59:59.999`).toISOString();
      let query = db.from("scan_logs").select("id, site_id, device_identifier, scanned_at, gps_lat, gps_lng, gps_accuracy, checkpoints(id, name), sites(name)").eq("company_id", companyId).not("checkpoint_id", "is", null).eq("tag_status", "registered").gte("scanned_at", start).lte("scanned_at", end).order("scanned_at", { ascending: true }).limit(1000);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      if (checkpoint !== "all") query = query.eq("checkpoint_id", checkpoint);
      if (device.trim()) query = query.ilike("device_identifier", `%${device.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ScanRow[];
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (scans.data ?? []).filter((row) => !needle || `${row.checkpoints?.name ?? ""} ${row.sites?.name ?? ""} ${row.device_identifier ?? ""}`.toLowerCase().includes(needle));
  }, [scans.data, search]);
  const checkpoints = useMemo(() => Array.from(new Map((scans.data ?? []).map((row) => [row.checkpoints?.id, row.checkpoints?.name]).filter(([id]) => !!id) as Array<[string, string]>).entries()).sort((a, b) => a[1].localeCompare(b[1])), [scans.data]);

  const exportCsv = () => {
    const headers = ["Checkpoint", "Site", "Date", "Time", "Device", "Latitude", "Longitude", "Accuracy"];
    const csvRows = rows.map((row) => [row.checkpoints?.name ?? "Checkpoint", row.sites?.name ?? "Unassigned", format(new Date(row.scanned_at), "dd MMM yyyy"), format(new Date(row.scanned_at), "HH:mm:ss"), row.device_identifier ?? "", row.gps_lat ?? "", row.gps_lng ?? "", row.gps_accuracy ?? ""]);
    const csv = [headers, ...csvRows].map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `mxpatrol-checkpoint-activity-${from}-to-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  return <SocPageShell title="Checkpoint Activity Report" subtitle="Registered checkpoint scans by site, date and time without requiring patrol schedules"><div className="space-y-4 text-white"><section className="grid gap-3 md:grid-cols-7"><Filter label="Site"><SiteSelector value={siteId} onChange={setSiteId} /></Filter><Filter label="From"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm" /></Filter><Filter label="To"><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm" /></Filter><Filter label="Checkpoint"><select value={checkpoint} onChange={(e) => setCheckpoint(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm"><option value="all">All</option>{checkpoints.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Filter><Filter label="Device"><input value={device} onChange={(e) => setDevice(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm" placeholder="Optional" /></Filter><Filter label="Search"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={search} onChange={(e) => setSearch(e.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm" placeholder="Checkpoint" /></div></Filter><button onClick={exportCsv} disabled={!rows.length} className="inline-flex h-[66px] items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-4 text-sm font-bold text-emerald-200 disabled:opacity-45"><Download className="h-4 w-4" /> Export CSV</button></section><section className="rounded-xl border border-white/10 bg-slate-950/72">{scans.isLoading ? <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" />Loading checkpoint activity...</div> : <div className="overflow-auto"><table className="w-full min-w-[820px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Checkpoint</th><th className="px-3 py-3">Site</th><th className="px-3 py-3">Date</th><th className="px-3 py-3">Time</th><th className="px-3 py-3">Device</th><th className="px-3 py-3">GPS</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map((row) => <tr key={row.id} className="hover:bg-white/[0.03]"><td className="px-3 py-3 font-semibold text-white">{row.checkpoints?.name ?? "Checkpoint"}</td><td className="px-3 py-3 text-slate-300">{row.sites?.name ?? "Unassigned"}</td><td className="px-3 py-3 text-slate-300">{format(new Date(row.scanned_at), "dd MMM yyyy")}</td><td className="px-3 py-3 font-mono text-slate-300">{format(new Date(row.scanned_at), "HH:mm:ss")}</td><td className="px-3 py-3 font-mono text-xs text-slate-400">{row.device_identifier ?? "Unknown"}</td><td className="px-3 py-3 text-slate-300">{row.gps_lat != null && row.gps_lng != null ? `${row.gps_lat}, ${row.gps_lng}` : "Unavailable"}</td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-center text-sm text-slate-400">No registered checkpoint scans match this report.</p>}</div>}</section></div></SocPageShell>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block rounded-lg border border-white/10 bg-slate-950/70 p-3"><span className="mb-2 block text-xs font-black uppercase text-slate-500">{label}</span>{children}</label>; }