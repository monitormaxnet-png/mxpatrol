import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowDownUp, CheckCircle2, Clock3, Download, Eye, FileDown, Filter, Layers, Loader2, MapPin, Pencil, Plus, Radio, RotateCcw, Scan, ScanLine, Search, ShieldCheck, SlidersHorizontal, Wifi, XCircle } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { SocKpiCard, SocPageShell, SocPanel, SocStatusPill } from "@/components/dashboard/SocComponents";
import { useAuth } from "@/contexts/AuthContext";
import { useCheckpoints, usePatrols } from "@/hooks/useDashboardData";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { useSites } from "@/hooks/useSites";
import { useUserRole } from "@/hooks/useUserRole";
import { useNfcReader } from "@/hooks/useNfcReader";
import { ensureLocationPermission, getCachedDeviceLocation, getDeviceLocation } from "@/lib/deviceGeolocation";
import { normalizeNfcUid } from "@/lib/nfcUid";
import { reviewPendingNfcTag } from "@/lib/nfcWorkflow";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

type CheckpointRow = Database["public"]["Tables"]["checkpoints"]["Row"] & { site_id?: string | null; sites?: { name: string } | null };
type ScanRow = Database["public"]["Tables"]["scan_logs"]["Row"] & { sites?: { name: string } | null };
type DeviceRow = Database["public"]["Tables"]["devices"]["Row"] & { site_id?: string | null; sites?: { name: string } | null };
type PendingNfcTag = { id: string; company_id: string; tag_uid: string; first_seen_at: string; last_seen_at: string; gps_lat: number | null; gps_lng: number | null; gps_accuracy: number | null; scan_log_id: string | null; alert_id: string | null; device_identifier?: string | null };
type CheckpointForm = { name: string; nfc_tag_id: string; location_lat: string; location_lng: string; patrol_id: string; sort_order: string; site_id: string };
type Filters = { siteId: string; zone: string; type: string; status: string; technology: string; routeId: string; registration: string; search: string; dateFrom: string; dateTo: string };
type SortKey = "name" | "status" | "lastScanned" | "scans" | "site" | "zone";
type SortDirection = "asc" | "desc";

const emptyForm: CheckpointForm = { name: "", nfc_tag_id: "", location_lat: "", location_lng: "", patrol_id: "", sort_order: "0", site_id: "" };
const defaultFilters = (): Filters => { const t = new Date(); const f = new Date(t); f.setDate(t.getDate() - 7); return { siteId: "all", zone: "all", type: "all", status: "all", technology: "all", routeId: "all", registration: "all", search: "", dateFrom: f.toISOString().slice(0, 10), dateTo: t.toISOString().slice(0, 10) }; };
const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number) => Promise.race([promise, new Promise<T>((_, reject) => window.setTimeout(() => reject(new Error("GPS capture timed out")), timeoutMs))]);
const errMsg = (e: unknown, fallback: string) => e instanceof Error ? e.message : e && typeof e === "object" ? String((e as { message?: unknown; details?: unknown; hint?: unknown; error?: unknown }).message || (e as { details?: unknown }).details || (e as { hint?: unknown }).hint || (e as { error?: unknown }).error || fallback) : fallback;
const captureGps = async () => { await ensureLocationPermission().catch(() => undefined); const cached = getCachedDeviceLocation(30000); const loc = cached ?? await withTimeout(getDeviceLocation({ maxAgeMs: 30000 }), 30000); return { lat: loc.lat.toFixed(7), lng: loc.lng.toFixed(7) }; };
const fmtDate = (v?: string | null) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? format(d, "dd MMM yyyy") : "-"; };
const fmtTime = (v?: string | null) => { const d = v ? new Date(v) : null; return d && !Number.isNaN(d.getTime()) ? format(d, "HH:mm:ss") : "-"; };
const code = (cp: CheckpointRow) => `CP-${cp.id.slice(0, 4).toUpperCase()}`;
const site = (cp: CheckpointRow) => cp.sites?.name || "Unassigned";
const zone = (cp: CheckpointRow) => cp.sites?.name || "Unassigned";
const type = (cp: CheckpointRow) => cp.location_lat != null && cp.location_lng != null ? "Mapped" : "Unmapped";
const active = (cp: CheckpointRow) => Boolean(normalizeNfcUid(cp.nfc_tag_id));

function useDebouncedValue(value: string, delay = 350) { const [debounced, setDebounced] = useState(value); useEffect(() => { const timer = window.setTimeout(() => setDebounced(value), delay); return () => window.clearTimeout(timer); }, [delay, value]); return debounced; }
function Badge({ label, tone = "neutral" }: { label: string; tone?: "green" | "blue" | "amber" | "red" | "purple" | "neutral" }) { const c = { green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", blue: "border-blue-400/30 bg-blue-400/10 text-blue-300", amber: "border-amber-400/30 bg-amber-400/10 text-amber-300", red: "border-red-400/30 bg-red-400/10 text-red-300", purple: "border-violet-400/30 bg-violet-400/10 text-violet-300", neutral: "border-white/10 bg-white/5 text-slate-300" }[tone]; return <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${c}`}>{label}</span>; }
function FilterSelect({ label, value, onChange, children, disabled }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode; disabled?: boolean }) { return <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span><select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-200 outline-none focus:border-emerald-400/50 disabled:opacity-50">{children}</select></label>; }

function NfcScanButton({ onTagScanned, currentTag }: { onTagScanned: (result: { tag: string; lat: string; lng: string }) => void; currentTag: string }) {
  const [gpsLoading, setGpsLoading] = useState(false);
  const { status, lastTag, errorMessage, supported, startScanning, stopScanning } = useNfcReader({ onScan: async (result) => { stopScanning(); setGpsLoading(true); try { const gps = await captureGps(); onTagScanned({ tag: result.serialNumber, ...gps }); toast.success("NFC tag and GPS coordinates captured"); } catch { toast.warning("NFC tag captured. Waiting for GPS fix..."); onTagScanned({ tag: result.serialNumber, lat: "", lng: "" }); } finally { setGpsLoading(false); } } });
  const scan = () => { if (status === "scanning") { stopScanning(); return; } void ensureLocationPermission().catch(() => undefined); startScanning(); };
  return <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/70 p-3"><div className="flex items-center justify-between gap-3"><div><Label className="text-xs font-black uppercase tracking-[0.12em] text-slate-400">NFC UID Registration</Label><p className="mt-1 text-xs text-slate-500">Use RG360/native registration where available. Manual UID entry is advanced fallback.</p></div><Badge label={supported ? "Native Ready" : "Manual"} tone={supported ? "green" : "amber"} /></div><div className="flex gap-2"><Input value={currentTag} readOnly placeholder="Scan with RG360 or enter manually below" className="border-white/10 bg-black/40 font-mono text-sm" /><Button type="button" onClick={scan} disabled={gpsLoading} variant={status === "scanning" ? "destructive" : "default"}>{gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scan className="h-4 w-4" />}{gpsLoading ? "GPS" : status === "scanning" ? "Stop" : "Register using RG360"}</Button></div>{status === "scanning" && <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300">Registration mode active. Hold the checkpoint tag near the device.</p>}{lastTag && status === "success" && <p className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-semibold text-emerald-300">Tag detected: {lastTag}</p>}{errorMessage && <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-semibold text-red-300">{errorMessage}</p>}</div>;
}

export default function Checkpoints() {
  const { user } = useAuth(); const queryClient = useQueryClient(); const realtime = useRealtimeConnectionStatus("checkpoints-page"); const { data: companyId } = useCompanyId(); const { data: sites = [] } = useSites(); const { data: patrols = [] } = usePatrols(); const { canManage } = useUserRole();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters()); const [page, setPage] = useState(0); const [pageSize, setPageSize] = useState(10); const [filterPanelOpen, setFilterPanelOpen] = useState(false); const [sortKey, setSortKey] = useState<SortKey>("name"); const [sortDirection, setSortDirection] = useState<SortDirection>("asc"); const [open, setOpen] = useState(false); const [editId, setEditId] = useState<string | null>(null); const [form, setForm] = useState<CheckpointForm>(emptyForm); const [saving, setSaving] = useState(false); const [deleting, setDeleting] = useState<string | null>(null); const [reviewingTag, setReviewingTag] = useState<string | null>(null); const [selectedId, setSelectedId] = useState<string | null>(null); const [highlightedId, setHighlightedId] = useState<string | null>(null); const debouncedSearch = useDebouncedValue(filters.search); const activeFilterCount = Object.entries(filters).filter(([key, value]) => key !== "search" && value !== "all" && value !== "").length + (filters.search.trim() ? 1 : 0); const nfcSupported = typeof window !== "undefined" && "NDEFReader" in window;
  const { data: raw = [], isLoading } = useCheckpoints(filters.siteId); const checkpoints = raw as unknown as CheckpointRow[];
  const scanQuery = useQuery({ queryKey: ["checkpoint_scan_stats", companyId, filters.dateFrom, filters.dateTo, filters.siteId], enabled: !!companyId, queryFn: async () => { let q = supabase.from("scan_logs").select("id, company_id, site_id, checkpoint_id, device_id, device_identifier, scanned_at, gps_lat, gps_lng, gps_accuracy, tag_uid, tag_status, is_offline_sync, created_at, sites(name)").eq("company_id", companyId!).gte("scanned_at", `${filters.dateFrom}T00:00:00.000Z`).lte("scanned_at", `${filters.dateTo}T23:59:59.999Z`).order("scanned_at", { ascending: false }).limit(1000); if (filters.siteId !== "all") q = q.eq("site_id", filters.siteId); const { data, error } = await q; if (error) throw error; return (data ?? []) as unknown as ScanRow[]; } });
  const devicesQuery = useQuery({ queryKey: ["checkpoint_devices", companyId, filters.siteId], enabled: !!companyId, queryFn: async () => { let q = supabase.from("devices").select("*, sites(name)").eq("company_id", companyId!).order("last_seen_at", { ascending: false }); if (filters.siteId !== "all") q = q.eq("site_id", filters.siteId); const { data, error } = await q; if (error) throw error; return (data ?? []) as unknown as DeviceRow[]; } });
  const { data: pendingTags = [] } = useQuery({ queryKey: ["pending_nfc_tags", companyId], enabled: canManage, queryFn: async () => { let q = supabase.from("pending_nfc_tags").select("id, company_id, tag_uid, first_seen_at, last_seen_at, gps_lat, gps_lng, gps_accuracy, scan_log_id, alert_id, device_identifier").eq("status", "pending").order("last_seen_at", { ascending: false }); if (companyId) q = q.eq("company_id", companyId); const { data, error } = await q; if (error) throw error; return (data ?? []) as PendingNfcTag[]; } });  useEffect(() => {
    if (!companyId) return;
    const ch = supabase
      .channel(`checkpoint-management-${companyId}-${Date.now()}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "checkpoints", filter: `company_id=eq.${companyId}` }, (p) => {
        const id = (p.new as { id?: string } | null)?.id ?? null;
        setHighlightedId(id); realtime.markUpdated(); queryClient.invalidateQueries({ queryKey: ["checkpoints"] });
        window.setTimeout(() => setHighlightedId((c) => c === id ? null : c), 3500);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "scan_logs", filter: `company_id=eq.${companyId}` }, () => {
        realtime.markUpdated(); queryClient.invalidateQueries({ queryKey: ["checkpoint_scan_stats"] }); queryClient.invalidateQueries({ queryKey: ["scan_logs"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pending_nfc_tags", filter: `company_id=eq.${companyId}` }, () => {
        realtime.markUpdated(); queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags", companyId] });
      })
      .subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [companyId, queryClient, realtime]);

  const scans = useMemo(() => scanQuery.data ?? [], [scanQuery.data]);
  const devices = useMemo(() => devicesQuery.data ?? [], [devicesQuery.data]);
  const scansByCheckpoint = useMemo(() => {
    const m = new Map<string, ScanRow[]>();
    for (const s of scans) if (s.checkpoint_id) m.set(s.checkpoint_id, [...(m.get(s.checkpoint_id) ?? []), s]);
    return m;
  }, [scans]);
  const latestScan = (id: string) => scansByCheckpoint.get(id)?.[0] ?? null;
  const totalScans = (id: string) => scansByCheckpoint.get(id)?.length ?? 0;
  const zones = useMemo(() => Array.from(new Set(checkpoints.map(zone))).filter(Boolean).sort(), [checkpoints]);
  const filtered = useMemo(() => {
    const s = normalizeNfcUid(debouncedSearch) || debouncedSearch.trim().toLowerCase();
    return checkpoints.filter((cp) => {
      const hay = [cp.name, code(cp), cp.nfc_tag_id, site(cp)].join(" ").toLowerCase();
      if (filters.zone !== "all" && zone(cp) !== filters.zone) return false;
      if (filters.type !== "all" && type(cp).toLowerCase() !== filters.type) return false;
      if (filters.status === "active" && !active(cp)) return false;
      if (filters.status === "pending" && active(cp)) return false;
      if (filters.registration === "registered" && !active(cp)) return false;
      if (filters.registration === "unregistered" && active(cp)) return false;
      if (filters.routeId !== "all" && cp.patrol_id !== filters.routeId) return false;
      if (filters.technology !== "all" && filters.technology !== "iso14443a") return false;
      if (s && !hay.includes(s)) return false;
      return true;
    });
  }, [checkpoints, debouncedSearch, filters.registration, filters.routeId, filters.status, filters.technology, filters.type, filters.zone]);
  const sorted = useMemo(() => {
    const dir = sortDirection === "asc" ? 1 : -1;
    const valueFor = (cp: CheckpointRow) => sortKey === "status" ? (active(cp) ? "active" : "pending") : sortKey === "lastScanned" ? (scansByCheckpoint.get(cp.id)?.[0]?.scanned_at ?? "") : sortKey === "scans" ? (scansByCheckpoint.get(cp.id)?.length ?? 0) : sortKey === "site" ? site(cp) : sortKey === "zone" ? zone(cp) : cp.name;
    return [...filtered].sort((a, b) => {
      const av = valueFor(a);
      const bv = valueFor(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, scansByCheckpoint, sortDirection, sortKey]);
  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const rows = sorted.slice(page * pageSize, page * pageSize + pageSize);
  useEffect(() => setPage(0), [debouncedSearch, filters.registration, filters.routeId, filters.siteId, filters.status, filters.technology, filters.type, filters.zone, pageSize]);
  useEffect(() => {
    if (!selectedId && sorted[0]) setSelectedId(sorted[0].id);
    if (selectedId && !sorted.some((cp) => cp.id === selectedId)) setSelectedId(sorted[0]?.id ?? null);
  }, [selectedId, sorted]);
  const selected = sorted.find((cp) => cp.id === selectedId) ?? null;
  const summary = useMemo(() => {
    const registered = filtered.filter(active).length;
    const scanned = new Set(scans.map((s) => s.checkpoint_id).filter(Boolean));
    return { total: filtered.length, registered, active: registered, inactive: 0, pending: pendingTags.length, zones: new Set(filtered.map(zone)).size, scanned: scanned.size, notScanned: filtered.filter((cp) => !scanned.has(cp.id)).length };
  }, [filtered, pendingTags.length, scans]);

  const openCreate = () => { setEditId(null); setForm(emptyForm); setOpen(true); };
  const openEdit = (cp: CheckpointRow) => { setEditId(cp.id); setForm({ name: cp.name, nfc_tag_id: cp.nfc_tag_id, location_lat: cp.location_lat?.toString() || "", location_lng: cp.location_lng?.toString() || "", patrol_id: cp.patrol_id || "", sort_order: cp.sort_order?.toString() || "0", site_id: cp.site_id || "" }); setOpen(true); };
  const findExistingCheckpointByTag = async (cid: string, uid: string, excludeId?: string | null) => {
    const normalized = normalizeNfcUid(uid);
    const { data, error } = await supabase.from("checkpoints").select("id, name, nfc_tag_id").eq("company_id", cid);
    if (error) throw error;
    return (data ?? []).find((cp) => (!excludeId || cp.id !== excludeId) && normalizeNfcUid(cp.nfc_tag_id) === normalized) ?? null;
  };
  const handleSave = async () => {
    const uid = normalizeNfcUid(form.nfc_tag_id);
    if (!form.name || !uid) { toast.error("Name and NFC Tag ID are required"); return; }
    if (!user) { toast.error("Please sign in again"); return; }
    setSaving(true);
    const wasEditing = !!editId;
    const { data: profile } = await supabase.from("profiles").select("company_id").eq("id", user.id).single();
    if (!profile?.company_id) { toast.error("No company associated"); setSaving(false); return; }
    try {
      const dup = await findExistingCheckpointByTag(profile.company_id, uid, editId);
      if (dup) { toast.error(`This NFC tag is already registered to "${dup.name}"`); setSaving(false); return; }
    } catch (e) { toast.error("Could not verify NFC tag uniqueness: " + errMsg(e, "Unknown error")); setSaving(false); return; }
    const payload = { company_id: profile.company_id, name: form.name, nfc_tag_id: uid, location_lat: form.location_lat ? parseFloat(form.location_lat) : null, location_lng: form.location_lng ? parseFloat(form.location_lng) : null, patrol_id: form.patrol_id || null, sort_order: parseInt(form.sort_order, 10) || 0, site_id: form.site_id || null };
    const { error } = editId ? await supabase.from("checkpoints").update(payload).eq("id", editId) : await supabase.from("checkpoints").insert(payload);
    setSaving(false);
    if (error) toast.error("Failed to save: " + error.message);
    else { toast.success(wasEditing ? "Checkpoint updated" : "Checkpoint created"); setForm(emptyForm); setEditId(null); if (wasEditing) setOpen(false); queryClient.invalidateQueries({ queryKey: ["checkpoints"] }); }
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm("Deactivate/archive needs a checkpoint status column. Delete this checkpoint record?")) return;
    setDeleting(id); const { error } = await supabase.from("checkpoints").delete().eq("id", id); setDeleting(null);
    if (error) toast.error("Failed to delete: " + error.message); else { toast.success("Checkpoint deleted"); queryClient.invalidateQueries({ queryKey: ["checkpoints"] }); }
  };  const approvePendingTagDirectly = async (tag: PendingNfcTag, name: string) => {
    const uid = normalizeNfcUid(tag.tag_uid);
    const dup = await findExistingCheckpointByTag(tag.company_id, uid);
    let checkpointId = dup?.id ?? null;
    if (!checkpointId) {
      const { data, error } = await supabase.from("checkpoints").insert({ company_id: tag.company_id, name, nfc_tag_id: uid, location_lat: tag.gps_lat, location_lng: tag.gps_lng, sort_order: 0 }).select("id").single();
      if (error) throw error;
      checkpointId = data.id;
    }
    const { error: scanError } = await supabase.from("scan_logs").update({ checkpoint_id: checkpointId, tag_status: "registered" } as never).eq("company_id", tag.company_id).is("checkpoint_id", null).eq("tag_uid", uid);
    if (scanError) throw scanError;
    const { error: pendingError } = await supabase.from("pending_nfc_tags").update({ status: "approved", checkpoint_id: checkpointId, reviewed_by: user?.id ?? null, reviewed_at: new Date().toISOString() } as never).eq("id", tag.id).eq("company_id", tag.company_id);
    if (pendingError) throw pendingError;
  };
  const approvePendingTag = async (tag: PendingNfcTag) => {
    const name = `Checkpoint ${normalizeNfcUid(tag.tag_uid).slice(-6).toUpperCase()}`;
    setReviewingTag(tag.id);
    try {
      try { await reviewPendingNfcTag({ pendingTagId: tag.id, decision: "approved", checkpointName: name }); }
      catch { await approvePendingTagDirectly(tag, name); }
      toast.success("NFC tag registered as a checkpoint");
      await Promise.all([queryClient.invalidateQueries({ queryKey: ["checkpoints"] }), queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] }), queryClient.invalidateQueries({ queryKey: ["scan_logs"] })]);
    } catch (e) { toast.error("Failed to approve tag: " + errMsg(e, "Unknown error")); }
    finally { setReviewingTag(null); }
  };
  const ignorePendingTag = async (tag: PendingNfcTag) => {
    setReviewingTag(tag.id);
    try { await reviewPendingNfcTag({ pendingTagId: tag.id, decision: "rejected" }); toast.success("NFC tag rejected"); queryClient.invalidateQueries({ queryKey: ["pending_nfc_tags"] }); }
    catch (e) { toast.error("Failed to reject tag: " + errMsg(e, "Unknown error")); }
    finally { setReviewingTag(null); }
  };
  const exportCsv = () => {
    const header = ["checkpoint_name", "checkpoint_code", "uid", "site", "zone", "type", "status", "latitude", "longitude", "last_scanned", "total_scans", "linked_route"];
    const esc = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = sorted.map((cp) => [cp.name, code(cp), normalizeNfcUid(cp.nfc_tag_id), site(cp), zone(cp), type(cp), active(cp) ? "active" : "pending", cp.location_lat, cp.location_lng, latestScan(cp.id)?.scanned_at, totalScans(cp.id), patrols.find((p) => p.id === cp.patrol_id)?.name].map(esc).join(","));
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `checkpoints-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const updateFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((cur) => ({ ...cur, [key]: value }));
  const setSort = (key: SortKey) => { setSortKey((current) => { if (current === key) setSortDirection((direction) => direction === "asc" ? "desc" : "asc"); else setSortDirection(key === "name" || key === "site" || key === "zone" ? "asc" : "desc"); return key; }); };

  return <SocPageShell title="Checkpoints" subtitle="Manage all NFC checkpoints and their locations" realtime={realtime}>
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/72 p-3 shadow-[0_0_30px_rgba(0,0,0,0.22)] xl:flex-row xl:items-center xl:justify-between">
      <div className="relative min-w-0 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
        <Input value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} placeholder="Search checkpoints by name, code, site, or NFC UID..." className="h-11 border-white/10 bg-slate-950/80 pl-9 text-sm" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant={filterPanelOpen ? "default" : "outline"} onClick={() => setFilterPanelOpen((value) => !value)} className="h-11"><SlidersHorizontal className="h-4 w-4" /> Filters {activeFilterCount > 0 && <span className="ml-1 rounded-full bg-emerald-400 px-2 py-0.5 text-[10px] font-black text-black">{activeFilterCount}</span>}</Button>
      <SocStatusPill icon={Wifi} label={realtime.status === "live" ? "Realtime Connected" : "Realtime Reconnecting"} tone={realtime.status === "live" ? "green" : "amber"} />
      <Button variant="outline" disabled><Download className="h-4 w-4" /> Import</Button>
      <Button variant="outline" onClick={exportCsv} disabled={!sorted.length}><FileDown className="h-4 w-4" /> Export</Button>
      {canManage && <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button onClick={openCreate} className="bg-emerald-500 text-black hover:bg-emerald-400"><Plus className="h-4 w-4" /> Add Checkpoint</Button></DialogTrigger><DialogContent className="max-h-[90vh] w-[calc(100vw-1rem)] overflow-y-auto border-white/10 bg-[#050914] text-slate-200 sm:max-w-2xl"><DialogHeader><DialogTitle>{editId ? "Edit Checkpoint" : "Create Checkpoint"}</DialogTitle><DialogDescription className="text-slate-400">Create metadata first, then register the physical NFC UID with the RG360/native scanner or advanced manual entry.</DialogDescription></DialogHeader><div className="space-y-4"><div className="grid gap-3 sm:grid-cols-2" id="checkpoint-basics-section"><div className="sm:col-span-2"><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Main Entrance Gate" className="border-white/10 bg-black/40" /></div><div><Label>Checkpoint Code</Label><Input value={editId ? editId.slice(0, 8).toUpperCase() : "Generated after save"} readOnly className="border-white/10 bg-black/40 text-slate-500" /></div><div><Label>Type</Label><Input value={form.location_lat && form.location_lng ? "Mapped" : "Unmapped"} readOnly className="border-white/10 bg-black/40 text-slate-500" /></div></div><NfcScanButton currentTag={form.nfc_tag_id} onTagScanned={({ tag, lat, lng }) => setForm((cur) => ({ ...cur, nfc_tag_id: tag, location_lat: lat || cur.location_lat, location_lng: lng || cur.location_lng }))} />{!nfcSupported && <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"><Label>Advanced Manual UID Entry</Label><Input value={form.nfc_tag_id} onChange={(e) => setForm({ ...form, nfc_tag_id: e.target.value })} placeholder="ce055774" className="mt-2 border-white/10 bg-black/40 font-mono" /></div>}<div className="grid gap-3 sm:grid-cols-2"><div><Label>Latitude</Label><Input type="number" step="any" value={form.location_lat} onChange={(e) => setForm({ ...form, location_lat: e.target.value })} className="border-white/10 bg-black/40" /></div><div><Label>Longitude</Label><Input type="number" step="any" value={form.location_lng} onChange={(e) => setForm({ ...form, location_lng: e.target.value })} className="border-white/10 bg-black/40" /></div><div><Label>Site</Label><Select value={form.site_id || "none"} onValueChange={(v) => setForm({ ...form, site_id: v === "none" ? "" : v })}><SelectTrigger className="border-white/10 bg-black/40"><SelectValue placeholder="Select site" /></SelectTrigger><SelectContent><SelectItem value="none">Unassigned</SelectItem>{sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent></Select></div><div><Label>Patrol Route</Label><Select value={form.patrol_id || "none"} onValueChange={(v) => setForm({ ...form, patrol_id: v === "none" ? "" : v })}><SelectTrigger className="border-white/10 bg-black/40"><SelectValue placeholder="Select route" /></SelectTrigger><SelectContent><SelectItem value="none">None</SelectItem>{patrols.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent></Select></div></div><div><Label>Sort Order</Label><Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: e.target.value })} className="border-white/10 bg-black/40" /></div><div className="flex gap-2 border-t border-white/10 pt-3"><DialogClose asChild><Button type="button" variant="outline" className="flex-1" disabled={saving}>Cancel</Button></DialogClose><Button onClick={handleSave} disabled={saving || !normalizeNfcUid(form.nfc_tag_id)} className="flex-1 bg-emerald-500 text-black hover:bg-emerald-400">{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{editId ? "Update Checkpoint" : "Create Checkpoint"}</Button></div></div></DialogContent></Dialog>}
      </div>
    </div>
    <Collapsible open={filterPanelOpen} onOpenChange={setFilterPanelOpen}><CollapsibleContent><SocPanel title="Operational Filters" action={<Button size="sm" variant="outline" onClick={() => { setFilters(defaultFilters()); setPage(0); }}><RotateCcw className="h-4 w-4" /> Clear Filters</Button>}>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <FilterSelect label="Site" value={filters.siteId} onChange={(v) => updateFilter("siteId", v)}><option value="all">All Sites</option>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</FilterSelect>
        <FilterSelect label="Zone" value={filters.zone} onChange={(v) => updateFilter("zone", v)}><option value="all">All Zones</option>{zones.map((z) => <option key={z} value={z}>{z}</option>)}</FilterSelect>
        <FilterSelect label="Type" value={filters.type} onChange={(v) => updateFilter("type", v)}><option value="all">All Types</option><option value="mapped">Mapped</option><option value="unmapped">Unmapped</option></FilterSelect>
        <FilterSelect label="Status" value={filters.status} onChange={(v) => updateFilter("status", v)}><option value="all">All Status</option><option value="active">Active</option><option value="pending">Pending Registration</option></FilterSelect>
        <FilterSelect label="NFC Technology" value={filters.technology} onChange={(v) => updateFilter("technology", v)}><option value="all">All</option><option value="iso14443a">ISO14443A</option></FilterSelect>
        <FilterSelect label="Route" value={filters.routeId} onChange={(v) => updateFilter("routeId", v)}><option value="all">All Routes</option>{patrols.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</FilterSelect>
        <FilterSelect label="Registered" value={filters.registration} onChange={(v) => updateFilter("registration", v)}><option value="all">All Tags</option><option value="registered">Registered</option><option value="unregistered">Pending UID</option></FilterSelect>
        <FilterSelect label="Sort By" value={sortKey} onChange={(v) => setSortKey(v as SortKey)}><option value="name">Name</option><option value="site">Site</option><option value="zone">Zone</option><option value="status">Status</option><option value="lastScanned">Last Scanned</option><option value="scans">Scan Count</option></FilterSelect>
        <label className="space-y-1 xl:col-span-3"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Search</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><Input value={filters.search} onChange={(e) => updateFilter("search", e.target.value)} placeholder="Search checkpoint name, code, site, or NFC UID..." className="border-white/10 bg-slate-950/80 pl-9" /></div></label>
        <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Scan From</span><Input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className="border-white/10 bg-slate-950/80 text-xs" /></label>
        <label className="space-y-1"><span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">Scan To</span><Input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className="border-white/10 bg-slate-950/80 text-xs" /></label>
      </div>
    </SocPanel></CollapsibleContent></Collapsible>
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
      <SocKpiCard title="Total Checkpoints" value={summary.total} caption="Filtered" icon={MapPin} tone="blue" loading={isLoading} />
      <SocKpiCard title="Registered" value={summary.registered} caption={`${summary.total ? Math.round((summary.registered / summary.total) * 100) : 0}% of total`} icon={ShieldCheck} tone="green" loading={isLoading} />
      <SocKpiCard title="Active" value={summary.active} caption="UID assigned" icon={CheckCircle2} tone="green" loading={isLoading} />
      <SocKpiCard title="Inactive" value={summary.inactive} caption="Status column pending" icon={XCircle} tone="amber" loading={isLoading} />
      <SocKpiCard title="Unregistered Tags" value={summary.pending} caption="Pending review" icon={AlertTriangle} tone={summary.pending ? "red" : "green"} loading={isLoading} />
      <SocKpiCard title="Zones" value={summary.zones} caption="Derived from sites" icon={Layers} tone="blue" loading={isLoading} />
      <SocKpiCard title="Scanned" value={summary.scanned} caption="Selected period" icon={ScanLine} tone="green" loading={scanQuery.isLoading} />
      <SocKpiCard title="Not Scanned" value={summary.notScanned} caption="Selected period" icon={Clock3} tone={summary.notScanned ? "amber" : "green"} loading={scanQuery.isLoading} />
    </section>
    {canManage && pendingTags.length > 0 && <SocPanel title="Unregistered Tags Awaiting Review" action={<Badge label={`${pendingTags.length} pending`} tone="amber" />}><div className="grid gap-3 lg:grid-cols-2">{pendingTags.slice(0, 4).map((tag) => <div key={tag.id} className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-3"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-mono text-sm font-black text-amber-200">{tag.tag_uid}</p><p className="text-xs text-slate-400">{fmtDate(tag.last_seen_at)} {fmtTime(tag.last_seen_at)}  -  {tag.device_identifier || "Unknown device"}</p></div><div className="flex gap-2"><Button size="sm" onClick={() => void approvePendingTag(tag)} disabled={reviewingTag !== null}>{reviewingTag === tag.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />} Register</Button><Button size="sm" variant="outline" onClick={() => void ignorePendingTag(tag)} disabled={reviewingTag !== null}>Reject</Button></div></div></div>)}</div></SocPanel>}
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_minmax(340px,0.9fr)] 2xl:grid-cols-[minmax(0,1.45fr)_minmax(360px,0.85fr)_340px]">
      <SocPanel title={`Checkpoints (${sorted.length})`} action={<div className="flex items-center gap-2 text-xs text-slate-400"><button type="button" onClick={() => setSort(sortKey)} className="inline-flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 hover:text-white" aria-label="Toggle table sort direction"><ArrowDownUp className="h-3.5 w-3.5" /> {sortDirection}</button><span>Page {page + 1} of {totalPages}</span></div>} className="xl:row-span-2">
        {isLoading ? <div className="flex h-48 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-emerald-300" /></div> : sorted.length === 0 ? <EmptyState title="No checkpoints found" body="No real checkpoint records match the selected filters." /> : <div className="overflow-x-auto"><table className="min-w-[940px] w-full text-left text-sm"><thead><tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.12em] text-slate-500"><th className="px-3 py-3">Checkpoint</th><th className="px-3 py-3">Type</th><th className="px-3 py-3">Zone</th><th className="px-3 py-3">Site</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last Scanned</th><th className="px-3 py-3">Scans</th><th className="px-3 py-3">Actions</th></tr></thead><tbody>{rows.map((cp) => { const last = latestScan(cp.id); return <tr key={cp.id} onClick={() => setSelectedId(cp.id)} className={`cursor-pointer border-b border-white/5 transition ${selectedId === cp.id ? "bg-emerald-400/10 shadow-[inset_3px_0_0_rgba(52,211,153,0.9)]" : highlightedId === cp.id ? "bg-blue-400/10" : "hover:bg-white/[0.03]"}`}><td className="px-3 py-3"><div className="font-black text-white">{cp.name}</div><div className="font-mono text-xs text-slate-500">{code(cp)}  -  {normalizeNfcUid(cp.nfc_tag_id) || "Pending UID"}</div></td><td className="px-3 py-3"><Badge label={type(cp)} tone={type(cp) === "Mapped" ? "blue" : "purple"} /></td><td className="px-3 py-3 text-slate-300">{zone(cp)}</td><td className="px-3 py-3 text-slate-300">{site(cp)}</td><td className="px-3 py-3"><Badge label={active(cp) ? "Active" : "Pending"} tone={active(cp) ? "green" : "amber"} /></td><td className="px-3 py-3 whitespace-nowrap">{last ? `${fmtDate(last.scanned_at)} ${fmtTime(last.scanned_at)}` : "Never"}</td><td className="px-3 py-3 font-black text-white">{totalScans(cp.id)}</td><td className="px-3 py-3"><div className="flex gap-1"><Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); setSelectedId(cp.id); }}><Eye className="h-4 w-4" /></Button>{canManage && <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(cp); }}><Pencil className="h-4 w-4" /></Button>}<Button size="icon" variant="ghost" asChild onClick={(e) => e.stopPropagation()}><Link to={`/scan-logs?checkpointId=${cp.id}`}><ScanLine className="h-4 w-4" /></Link></Button></div></td></tr>; })}</tbody></table></div>}
        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-xs text-slate-400"><span>Rows per page</span><select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1"><option value={10}>10</option><option value={25}>25</option><option value={50}>50</option></select></div><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((v) => Math.max(0, v - 1))}>Previous</Button><span className="text-xs text-slate-400">{page + 1} / {totalPages}</span><Button variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((v) => Math.min(totalPages - 1, v + 1))}>Next</Button></div></div>
      </SocPanel>
      <div className="space-y-4"><SocPanel title="Checkpoint Map" action={<Button size="sm" variant="outline" asChild><Link to="/live-map"><MapPin className="h-4 w-4" /> Open Live Map</Link></Button>}><CheckpointMap checkpoints={sorted} selectedId={selectedId} onSelect={setSelectedId} pendingTags={pendingTags} /></SocPanel><SocPanel title="Checkpoint Distribution"><Distribution checkpoints={sorted} /></SocPanel></div>
      <CheckpointDetails checkpoint={selected} scans={selected ? scansByCheckpoint.get(selected.id) ?? [] : []} devices={devices} patrolName={selected ? patrols.find((p) => p.id === selected.patrol_id)?.name ?? null : null} canManage={canManage} onEdit={selected ? () => openEdit(selected) : undefined} onDelete={selected ? () => void handleDelete(selected.id) : undefined} deleting={deleting === selected?.id} />
    </div>
  </SocPageShell>;
}function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/60 p-8 text-center"><Filter className="mx-auto mb-3 h-8 w-8 text-slate-500" /><h3 className="text-lg font-black text-white">{title}</h3><p className="mt-1 text-sm text-slate-400">{body}</p></div>;
}
function CheckpointMap({ checkpoints, selectedId, onSelect, pendingTags }: { checkpoints: CheckpointRow[]; selectedId: string | null; onSelect: (id: string) => void; pendingTags: PendingNfcTag[] }) {
  const located = checkpoints.filter((cp) => cp.location_lat != null && cp.location_lng != null);
  if (!located.length && !pendingTags.length) return <EmptyState title="No map coordinates" body="Add GPS coordinates or register tags from RG360 scans to populate the checkpoint map." />;
  return <div className="relative h-[360px] overflow-hidden rounded-xl border border-white/10 bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.10),transparent_35%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))]"><div className="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:32px_32px]" />{located.map((cp, i) => <button key={cp.id} type="button" onClick={() => onSelect(cp.id)} className={`absolute flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border ${selectedId === cp.id ? "border-emerald-200 bg-emerald-400 text-black shadow-[0_0_24px_rgba(52,211,153,0.85)]" : "border-emerald-400 bg-slate-950 text-emerald-300"}`} style={{ left: `${12 + ((i * 23) % 76)}%`, top: `${18 + ((i * 31) % 66)}%` }} title={cp.name}><MapPin className="h-4 w-4" /></button>)}{pendingTags.slice(0, 6).map((tag, i) => <div key={tag.id} className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-red-400 bg-red-500/20 text-red-300" style={{ left: `${20 + ((i * 17) % 64)}%`, top: `${30 + ((i * 19) % 52)}%` }} title={tag.tag_uid}><AlertTriangle className="h-3.5 w-3.5" /></div>)}<div className="absolute bottom-3 left-3 flex gap-2 rounded-lg border border-white/10 bg-black/60 px-3 py-2 text-[10px] text-slate-300"><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Active</span><span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" /> Unregistered</span></div></div>;
}
function Distribution({ checkpoints }: { checkpoints: CheckpointRow[] }) {
  const groups = useMemo(() => { const m = new Map<string, number>(); for (const cp of checkpoints) m.set(zone(cp), (m.get(zone(cp)) ?? 0) + 1); return Array.from(m.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6); }, [checkpoints]);
  if (!groups.length) return <EmptyState title="No distribution data" body="Checkpoint distribution appears once records exist." />;
  const total = checkpoints.length || 1;
  return <div className="space-y-3">{groups.map(([label, count]) => <div key={label}><div className="mb-1 flex items-center justify-between text-xs"><span className="font-semibold text-slate-300">{label}</span><span className="text-slate-500">{count}  -  {Math.round((count / total) * 100)}%</span></div><div className="h-2 rounded-full bg-slate-800"><div className="h-full rounded-full bg-emerald-400" style={{ width: `${Math.round((count / total) * 100)}%` }} /></div></div>)}</div>;
}
function CheckpointDetails({ checkpoint, scans, devices, patrolName, canManage, onEdit, onDelete, deleting }: { checkpoint: CheckpointRow | null; scans: ScanRow[]; devices: DeviceRow[]; patrolName: string | null; canManage: boolean; onEdit?: () => void; onDelete?: () => void; deleting?: boolean }) {
  const [sheet, setSheet] = useState(false);
  const content = checkpoint ? <DetailsContent checkpoint={checkpoint} scans={scans} devices={devices} patrolName={patrolName} canManage={canManage} onEdit={onEdit} onDelete={onDelete} deleting={deleting} /> : <EmptyState title="No checkpoint selected" body="Select a checkpoint row or map marker to inspect its details." />;
  return <><div className="hidden 2xl:block">{content}</div><div className="2xl:hidden"><Button variant="outline" className="w-full" onClick={() => setSheet(true)} disabled={!checkpoint}><Eye className="h-4 w-4" /> Open Checkpoint Details</Button><Sheet open={sheet} onOpenChange={setSheet}><SheetContent className="w-full overflow-y-auto border-white/10 bg-[#050914] text-slate-200 sm:max-w-xl"><SheetHeader><SheetTitle className="text-white">Checkpoint Details</SheetTitle></SheetHeader><div className="mt-4">{content}</div></SheetContent></Sheet></div></>;
}
function DetailsContent({ checkpoint, scans, devices, patrolName, canManage, onEdit, onDelete, deleting }: { checkpoint: CheckpointRow; scans: ScanRow[]; devices: DeviceRow[]; patrolName: string | null; canManage: boolean; onEdit?: () => void; onDelete?: () => void; deleting?: boolean }) {
  const linked = devices.filter((d) => d.site_id && d.site_id === checkpoint.site_id).slice(0, 5);
  const last = scans[0];
  return <SocPanel title="Checkpoint Details" action={<Badge label={active(checkpoint) ? "Active" : "Pending"} tone={active(checkpoint) ? "green" : "amber"} />}><div className="space-y-4"><div className="flex items-start gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/10 text-emerald-300"><Radio className="h-6 w-6" /></div><div><h3 className="text-lg font-black text-white">{checkpoint.name}</h3><p className="font-mono text-xs text-slate-500">{code(checkpoint)}  -  {normalizeNfcUid(checkpoint.nfc_tag_id) || "Pending UID"}</p></div></div><div className="space-y-2"><Detail label="Type" value={type(checkpoint)} /><Detail label="Site" value={site(checkpoint)} /><Detail label="Zone" value={zone(checkpoint)} /><Detail label="NFC Technology" value="ISO14443A" /><Detail label="UID" value={normalizeNfcUid(checkpoint.nfc_tag_id) || "Pending"} mono /><Detail label="First Registered" value={fmtDate(checkpoint.created_at)} /><Detail label="Last Scanned" value={last ? `${fmtDate(last.scanned_at)} ${fmtTime(last.scanned_at)}` : "Never"} /><Detail label="Total Scans" value={scans.length} /><Detail label="Latitude" value={checkpoint.location_lat ?? "-"} mono /><Detail label="Longitude" value={checkpoint.location_lng ?? "-"} mono /><Detail label="Route" value={patrolName || "No route linked"} /></div><div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-400">Latest Scan History</p>{scans.length ? scans.slice(0, 4).map((s) => <div key={s.id} className="mb-2 rounded-lg border border-white/10 p-2 text-xs last:mb-0"><div className="flex justify-between"><span className="font-semibold text-white">{fmtDate(s.scanned_at)} {fmtTime(s.scanned_at)}</span><Badge label={s.is_offline_sync ? "Offline" : "Synced"} tone={s.is_offline_sync ? "amber" : "green"} /></div><p className="mt-1 text-slate-400">{s.device_identifier || s.device_id || "Unknown device"}  -  GPS {s.gps_accuracy != null ? `${Math.round(s.gps_accuracy)}m` : "missing"}</p></div>) : <p className="text-xs text-slate-500">No scans in selected period.</p>}<Button asChild variant="outline" className="mt-3 w-full"><Link to={`/scan-logs?checkpointId=${checkpoint.id}`}>View Full Scan History</Link></Button></div><div className="rounded-xl border border-white/10 bg-black/30 p-3"><p className="mb-2 text-xs font-black uppercase tracking-[0.12em] text-slate-400">Linked Devices</p>{linked.length ? linked.map((d) => <div key={d.id} className="mb-2 text-xs last:mb-0"><p className="font-semibold text-white">{d.device_name || d.device_identifier}</p><p className="text-slate-500">{d.status}  -  Battery {d.battery_level ?? "-"}%</p></div>) : <p className="text-xs text-slate-500">No permanent checkpoint-device link exists; showing site devices where available.</p>}</div>{canManage && <div className="grid gap-2"><Button onClick={onEdit} className="bg-emerald-500 text-black hover:bg-emerald-400"><Pencil className="h-4 w-4" /> Edit Checkpoint</Button><Button asChild variant="outline"><Link to={`/scan-logs?checkpointId=${checkpoint.id}`}><ScanLine className="h-4 w-4" /> View Scan History</Link></Button><Button variant="outline" disabled title="Needs checkpoint status column">Activate / Deactivate</Button><Button variant="destructive" onClick={onDelete} disabled={deleting}>{deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Delete Record</Button></div>}</div></SocPanel>;
}
function Detail({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return <div className="grid grid-cols-[8rem_1fr] gap-3 text-xs"><span className="text-slate-500">{label}</span><span className={`break-words font-semibold text-slate-200 ${mono ? "font-mono" : ""}`}>{value ?? "-"}</span></div>;
}
