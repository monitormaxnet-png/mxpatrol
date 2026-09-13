import { useMemo, useState } from "react";
import { CheckCircle2, Loader2, Search, ShieldCheck } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { toast } from "sonner";
import SiteSelector from "@/components/sites/SiteSelector";
import { SocPageShell } from "@/components/dashboard/SocComponents";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { supabase } from "@/integrations/supabase/client";

type Investigation = { id: string; site_id: string | null; device_identifier: string | null; scanned_uid: string | null; scanned_at: string; investigation_type: string; registered_status: string; reason: string; status: string; notes: string | null; sites?: { name: string } | null; checkpoints?: { name: string } | null };
const db = supabase as any;
const types = ["all", "unscheduled_scan", "unregistered_checkpoint", "wrong_patrol", "unknown_uid", "location_mismatch", "other"];
const statuses = ["all", "pending", "reviewed", "resolved", "ignored"];

export default function ScanInvestigations() {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();
  const [siteId, setSiteId] = useState("all");
  const [type, setType] = useState("all");
  const [status, setStatus] = useState("pending");
  const [search, setSearch] = useState("");

  const investigations = useQuery({
    queryKey: ["scan-investigations", companyId, siteId, type, status],
    enabled: !!companyId,
    queryFn: async () => {
      let query = db.from("scan_investigations").select("id, site_id, device_identifier, scanned_uid, scanned_at, investigation_type, registered_status, reason, status, notes, sites(name), checkpoints(name)").eq("company_id", companyId).order("scanned_at", { ascending: false }).limit(250);
      if (siteId !== "all") query = query.eq("site_id", siteId);
      if (type !== "all") query = query.eq("investigation_type", type);
      if (status !== "all") query = query.eq("status", status);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as Investigation[];
    },
  });

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (investigations.data ?? []).filter((row) => !needle || `${row.device_identifier ?? ""} ${row.scanned_uid ?? ""} ${row.reason} ${row.sites?.name ?? ""} ${row.checkpoints?.name ?? ""}`.toLowerCase().includes(needle));
  }, [investigations.data, search]);

  const updateStatus = async (row: Investigation, nextStatus: "reviewed" | "resolved" | "ignored") => {
    const { error } = await db.from("scan_investigations").update({ status: nextStatus, reviewed_at: new Date().toISOString() }).eq("id", row.id).eq("company_id", companyId);
    if (error) return toast.error(error.message);
    toast.success(`Investigation ${nextStatus}`);
    void queryClient.invalidateQueries({ queryKey: ["scan-investigations"] });
  };

  return <SocPageShell title="Scan Investigations" subtitle="Review scans that did not legitimately belong to scheduled patrol execution"><div className="space-y-4 text-white"><section className="grid gap-3 md:grid-cols-5"><Filter label="Site"><SiteSelector value={siteId} onChange={setSiteId} /></Filter><Filter label="Type"><Select value={type} onChange={setType} values={types} /></Filter><Filter label="Status"><Select value={status} onChange={setStatus} values={statuses} /></Filter><Filter label="Search"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 pl-9 pr-3 text-sm outline-none" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="UID, device, reason" /></div></Filter><div className="rounded-lg border border-white/10 bg-slate-950/70 p-3"><p className="text-xs uppercase text-slate-500">Visible</p><p className="mt-1 text-2xl font-black">{rows.length}</p></div></section><section className="rounded-xl border border-white/10 bg-slate-950/72">{investigations.isLoading ? <State label="Loading investigations..." /> : <div className="overflow-auto"><table className="w-full min-w-[980px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-slate-500"><tr><th className="px-3 py-3">Time</th><th className="px-3 py-3">Site</th><th className="px-3 py-3">Device</th><th className="px-3 py-3">Checkpoint / UID</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Action</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map((row) => <tr key={row.id} className="hover:bg-white/[0.03]"><td className="px-3 py-3 text-slate-300">{format(new Date(row.scanned_at), "dd MMM yyyy HH:mm")}</td><td className="px-3 py-3 text-slate-300">{row.sites?.name ?? "Unassigned"}</td><td className="px-3 py-3 font-mono text-xs text-slate-300">{row.device_identifier ?? "Unknown"}</td><td className="px-3 py-3"><p className="text-white">{row.checkpoints?.name ?? "Unknown checkpoint"}</p><p className="font-mono text-xs text-slate-500">{row.scanned_uid ?? "No UID"}</p></td><td className="px-3 py-3"><Badge value={row.investigation_type} /></td><td className="px-3 py-3 text-slate-300">{row.reason}</td><td className="px-3 py-3"><Badge value={row.status} /></td><td className="px-3 py-3"><div className="flex gap-2"><button className="rounded-md border border-white/10 p-2 text-slate-300 hover:text-emerald-300" title="Mark reviewed" onClick={() => void updateStatus(row, "reviewed")}><ShieldCheck className="h-4 w-4" /></button><button className="rounded-md border border-white/10 p-2 text-slate-300 hover:text-emerald-300" title="Resolve" onClick={() => void updateStatus(row, "resolved")}><CheckCircle2 className="h-4 w-4" /></button></div></td></tr>)}</tbody></table>{!rows.length && <p className="p-6 text-center text-sm text-slate-400">No scan investigations match the current filters.</p>}</div>}</section></div></SocPageShell>;
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block rounded-lg border border-white/10 bg-slate-950/70 p-3"><span className="mb-2 block text-xs font-black uppercase text-slate-500">{label}</span>{children}</label>; }
function Select({ value, onChange, values }: { value: string; onChange: (value: string) => void; values: string[] }) { return <select value={value} onChange={(event) => onChange(event.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-slate-950/70 px-3 text-sm text-white outline-none">{values.map((item) => <option key={item} value={item}>{item === "all" ? "All" : item.replace(/_/g, " ")}</option>)}</select>; }
function Badge({ value }: { value: string }) { return <span className="rounded-md border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-xs font-bold text-emerald-300">{value.replace(/_/g, " ")}</span>; }
function State({ label }: { label: string }) { return <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-slate-300"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }