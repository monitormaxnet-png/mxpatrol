import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Copy,
  Database,
  Eye,
  FileDown,
  Filter,
  LocateFixed,
  MapPin,
  Radio,
  RefreshCcw,
  RotateCcw,
  ScanLine,
  Search,
  ShieldCheck,
  Smartphone,
  Wifi,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SocKpiCard, SocPageShell, SocPanel, SocStatusPill } from "@/components/dashboard/SocComponents";
import { useCompanyId } from "@/hooks/usePatrolScanData";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { useSites } from "@/hooks/useSites";
import { supabase } from "@/integrations/supabase/client";
import type { Database as SupabaseDatabase, Json } from "@/integrations/supabase/types";

type ScanLogRow = SupabaseDatabase["public"]["Tables"]["scan_logs"]["Row"] & {
  site_id?: string | null;
  sites?: { name: string } | null;
  checkpoints?: { id?: string; name: string; nfc_tag_id?: string; patrol_id?: string | null; sites?: { name: string } | null } | null;
  guards?: { full_name: string | null; badge_number: string | null } | null;
};

type DeviceOption = {
  id: string;
  device_identifier: string;
  device_name: string | null;
  site_id?: string | null;
};

type CheckpointOption = {
  id: string;
  name: string;
  nfc_tag_id: string;
  site_id?: string | null;
  patrol_id?: string | null;
};

type CompanyOption = { id: string; name: string };

type Filters = {
  from: string;
  to: string;
  companyId: string;
  siteId: string;
  device: string;
  checkpointId: string;
  status: string;
  sync: string;
  registration: string;
  gps: string;
  text: string;
};

const PAGE_SIZES = [25, 50, 100];

const defaultFilters = (): Filters => {
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 7);
  return {
    from: from.toISOString().slice(0, 10),
    to: today.toISOString().slice(0, 10),
    companyId: "current",
    siteId: "all",
    device: "all",
    checkpointId: "all",
    status: "all",
    sync: "all",
    registration: "all",
    gps: "all",
    text: "",
  };
};

const statusTone = (status: string | null | undefined) => {
  if (status === "registered" || status === "success" || status === "synced") return "green";
  if (status === "unregistered" || status === "pending_registration" || status === "offline_saved") return "amber";
  if (status === "failed" || status === "rejected" || status === "suspicious") return "red";
  return "blue";
};

const toneClasses = {
  green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  red: "border-red-400/30 bg-red-400/10 text-red-300",
  blue: "border-blue-400/30 bg-blue-400/10 text-blue-300",
  neutral: "border-white/10 bg-white/5 text-slate-300",
} as const;

const labelDate = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "MMM d, yyyy");
};

const labelTime = (value: string | null | undefined) => {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return format(date, "HH:mm:ss");
};

const metadataValue = (metadata: Json | null | undefined, key: string) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const value = metadata[key];
  if (value === null || value === undefined) return null;
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? String(value) : null;
};

const deviceLabel = (scan: ScanLogRow) => scan.device_identifier || scan.device_id || "Unknown device";
const checkpointLabel = (scan: ScanLogRow) => scan.checkpoints?.name || (scan.tag_uid ? `Unregistered tag ${scan.tag_uid}` : "No checkpoint");
const siteLabel = (scan: ScanLogRow) => scan.sites?.name || scan.checkpoints?.sites?.name || scan.site_id || "Unassigned";
const isRegistered = (scan: ScanLogRow) => scan.tag_status === "registered" || !!scan.checkpoint_id;
const hasGps = (scan: ScanLogRow) => scan.gps_lat !== null && scan.gps_lng !== null;
const readableDevice = (scan: ScanLogRow, devices: DeviceOption[]) => {
  const matched = devices.find((device) => device.device_identifier === scan.device_identifier || device.id === scan.device_id);
  const raw = scan.device_identifier || scan.device_id || "unknown-device";
  const fallback = raw.startsWith("mxp-") ? `RG360-${raw.slice(-6).toUpperCase()}` : raw;
  return { name: matched?.device_name || fallback, subtitle: matched?.device_name ? raw : scan.is_manual ? "Manual correction" : "Device app", identifier: raw };
};
const gpsQuality = (scan: ScanLogRow) => {
  if (!hasGps(scan) || scan.gps_accuracy == null) return { label: "Missing", tone: "amber" as const, detail: "No GPS" };
  const meters = Math.round(scan.gps_accuracy);
  if (meters <= 10) return { label: "Excellent", tone: "green" as const, detail: `${meters}m` };
  if (meters <= 25) return { label: "Good", tone: "green" as const, detail: `${meters}m` };
  if (meters <= 50) return { label: "Fair", tone: "amber" as const, detail: `${meters}m` };
  if (meters <= 100) return { label: "Poor", tone: "amber" as const, detail: `${meters}m` };
  return { label: "Very Poor", tone: "red" as const, detail: `${meters}m` };
};
const validationState = (scan: ScanLogRow, duplicateUid: boolean) => {
  if (["rejected", "failed"].includes(scan.tag_status)) return { label: scan.tag_status === "rejected" ? "Rejected" : "Failed", tone: "red" as const };
  if (duplicateUid) return { label: "Duplicate", tone: "amber" as const };
  if (!isRegistered(scan) || scan.tag_status === "unregistered") return { label: "Needs Review", tone: "amber" as const };
  const gps = gpsQuality(scan);
  if (gps.label === "Poor" || gps.label === "Very Poor") return { label: "Poor GPS", tone: gps.tone };
  return { label: "Verified", tone: "green" as const };
};
const syncState = (scan: ScanLogRow) => scan.is_offline_sync ? { label: "Offline Synced", tone: "blue" as const } : { label: "Synced", tone: "green" as const };

function StatusBadge({ label, tone = "neutral" }: { label: string; tone?: keyof typeof toneClasses }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.08em] ${toneClasses[tone]}`}>
      {label}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <label className="space-y-1">
      <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">{label}</span>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        className="h-10 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-200 outline-none transition focus:border-emerald-400/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {children}
      </select>
    </label>
  );
}

function useDebouncedValue(value: string, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

export default function ScanLogs() {
  const queryClient = useQueryClient();
  const realtime = useRealtimeConnectionStatus("scan-logs-page");
  const { data: currentCompanyId } = useCompanyId();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { data: sites = [] } = useSites();
  const [filters, setFilters] = useState<Filters>(() => defaultFilters());
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [selectedScan, setSelectedScan] = useState<ScanLogRow | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const debouncedText = useDebouncedValue(filters.text);

  const effectiveCompanyId = filters.companyId !== "current" ? filters.companyId : currentCompanyId;

  const companiesQuery = useQuery({
    queryKey: ["scan_logs_companies", isPlatformAdmin],
    enabled: isPlatformAdmin,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("companies")
        .select("id, name")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CompanyOption[];
    },
  });

  const devicesQuery = useQuery({
    queryKey: ["scan_logs_devices", effectiveCompanyId],
    enabled: !!effectiveCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("id, device_identifier, device_name, site_id")
        .eq("company_id", effectiveCompanyId!)
        .order("device_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as DeviceOption[];
    },
  });

  const checkpointsQuery = useQuery({
    queryKey: ["scan_logs_checkpoints", effectiveCompanyId, filters.siteId],
    enabled: !!effectiveCompanyId,
    queryFn: async () => {
      let query = supabase
        .from("checkpoints")
        .select("id, name, nfc_tag_id, site_id, patrol_id")
        .eq("company_id", effectiveCompanyId!)
        .order("name", { ascending: true });
      if (filters.siteId !== "all") query = query.eq("site_id", filters.siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CheckpointOption[];
    },
  });

  const scansQueryKey = ["scan_logs_page", effectiveCompanyId, filters, debouncedText, page, pageSize];

  const scansQuery = useQuery({
    queryKey: scansQueryKey,
    enabled: !!effectiveCompanyId,
    queryFn: async () => {
      const fromDate = `${filters.from}T00:00:00.000Z`;
      const toDate = `${filters.to}T23:59:59.999Z`;
      const from = page * pageSize;
      const to = from + pageSize - 1;

      let query = supabase
        .from("scan_logs")
        .select(
          "id, company_id, site_id, checkpoint_id, guard_id, device_id, device_identifier, scanned_at, created_at, gps_lat, gps_lng, gps_accuracy, tag_uid, tag_status, is_offline_sync, is_manual, manual_scan_reason, device_metadata, face_verified, face_confidence, scanned_by, user_id, sites(name), checkpoints(id, name, nfc_tag_id, patrol_id, sites(name)), guards(full_name, badge_number)",
          { count: "exact" }
        )
        .eq("company_id", effectiveCompanyId!)
        .gte("scanned_at", fromDate)
        .lte("scanned_at", toDate)
        .order("scanned_at", { ascending: false })
        .range(from, to);

      if (filters.siteId !== "all") query = query.eq("site_id", filters.siteId);
      if (filters.device !== "all") query = query.eq("device_identifier", filters.device);
      if (filters.checkpointId !== "all") query = query.eq("checkpoint_id", filters.checkpointId);
      if (filters.status !== "all") query = query.eq("tag_status", filters.status);
      if (filters.sync === "offline") query = query.eq("is_offline_sync", true);
      if (filters.sync === "online") query = query.or("is_offline_sync.is.null,is_offline_sync.eq.false");
      if (filters.registration === "registered") query = query.not("checkpoint_id", "is", null);
      if (filters.registration === "unregistered") query = query.is("checkpoint_id", null);
      if (filters.gps === "available") query = query.not("gps_lat", "is", null).not("gps_lng", "is", null);
      if (filters.gps === "missing") query = query.or("gps_lat.is.null,gps_lng.is.null");
      if (debouncedText.trim()) {
        const term = debouncedText.trim().replace(/%/g, "\\%");
        query = query.or(`tag_uid.ilike.%${term}%,device_identifier.ilike.%${term}%`);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { rows: (data ?? []) as unknown as ScanLogRow[], count: count ?? 0 };
    },
  });

  const rows = useMemo(() => scansQuery.data?.rows ?? [], [scansQuery.data?.rows]);
  const totalRows = scansQuery.data?.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const companyName = useMemo(() => {
    if (!effectiveCompanyId) return "No company";
    return companiesQuery.data?.find((company) => company.id === effectiveCompanyId)?.name || "Current company";
  }, [companiesQuery.data, effectiveCompanyId]);

  useEffect(() => {
    setPage(0);
  }, [debouncedText, filters.checkpointId, filters.companyId, filters.device, filters.from, filters.gps, filters.registration, filters.siteId, filters.status, filters.sync, filters.to, pageSize]);

  useEffect(() => {
    if (!effectiveCompanyId) return;
    const channel = supabase
      .channel(`scan-logs-page-${effectiveCompanyId}-${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "scan_logs", filter: `company_id=eq.${effectiveCompanyId}` },
        (payload) => {
          const newId = (payload.new as { id?: string }).id ?? null;
          setHighlightedId(newId);
          realtime.markUpdated();
          queryClient.invalidateQueries({ queryKey: ["scan_logs_page", effectiveCompanyId] });
          queryClient.invalidateQueries({ queryKey: ["session_scan_logs", effectiveCompanyId] });
          queryClient.invalidateQueries({ queryKey: ["live_patrol_scans", effectiveCompanyId] });
          window.setTimeout(() => setHighlightedId((current) => (current === newId ? null : current)), 3500);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "scan_logs", filter: `company_id=eq.${effectiveCompanyId}` },
        () => {
          realtime.markUpdated();
          queryClient.invalidateQueries({ queryKey: ["scan_logs_page", effectiveCompanyId] });
        }
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[ScanLogs] Realtime scan channel failed");
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [effectiveCompanyId, queryClient, realtime]);

  const summary = useMemo(() => {
    const uidCounts = new Map<string, number>();
    rows.forEach((scan) => { if (scan.tag_uid) uidCounts.set(scan.tag_uid, (uidCounts.get(scan.tag_uid) ?? 0) + 1); });
    const duplicateUidSet = new Set(Array.from(uidCounts.entries()).filter(([, count]) => count > 1).map(([uid]) => uid));
    const registered = rows.filter(isRegistered).length;
    const unregistered = rows.filter((scan) => !isRegistered(scan) || scan.tag_status === "unregistered").length;
    const pendingReview = rows.filter((scan) => scan.tag_status === "pending_registration" || !isRegistered(scan)).length;
    const offlineSynced = rows.filter((scan) => !!scan.is_offline_sync).length;
    const pendingSync = rows.filter((scan) => ["pending_sync", "offline_saved"].includes(scan.tag_status)).length;
    const rejected = rows.filter((scan) => ["failed", "rejected"].includes(scan.tag_status)).length;
    const duplicate = rows.filter((scan) => !!scan.tag_uid && duplicateUidSet.has(scan.tag_uid)).length;
    const poorGps = rows.filter((scan) => ["Poor", "Very Poor", "Missing"].includes(gpsQuality(scan).label)).length;
    const gpsValues = rows.map((scan) => scan.gps_accuracy).filter((value): value is number => typeof value === "number");
    const avgGps = gpsValues.length ? Math.round(gpsValues.reduce((sum, value) => sum + value, 0) / gpsValues.length) : 0;
    return { registered, unregistered, pendingReview, offlineSynced, pendingSync, rejected, duplicate, duplicateUidSet, poorGps, avgGps };
  }, [rows]);

  const updateFilter = useCallback(<K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  const clearFilters = () => {
    setFilters(defaultFilters());
    setPage(0);
  };

  const refresh = () => {
    void scansQuery.refetch();
  };

  const copyUid = useCallback((uid: string | null | undefined) => {
    if (!uid || !navigator.clipboard) return;
    void navigator.clipboard.writeText(uid);
  }, []);

  const exportCsv = () => {
    const header = [
      "date",
      "time",
      "company",
      "site",
      "device_identifier",
      "checkpoint",
      "tag_uid",
      "status",
      "gps_lat",
      "gps_lng",
      "gps_accuracy",
      "sync_state",
      "source",
      "created_at",
    ];
    const escape = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
    const lines = rows.map((scan) => [
      labelDate(scan.scanned_at),
      labelTime(scan.scanned_at),
      companyName,
      siteLabel(scan),
      deviceLabel(scan),
      checkpointLabel(scan),
      scan.tag_uid,
      scan.tag_status,
      scan.gps_lat,
      scan.gps_lng,
      scan.gps_accuracy,
      scan.is_offline_sync ? "offline synced" : "synced",
      scan.is_manual ? "manual" : "RG360/device",
      scan.created_at,
    ].map(escape).join(","));
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scan-logs-${filters.from}-to-${filters.to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SocPageShell title="Scan Logs" subtitle="Investigate individual NFC scan events, location accuracy and synchronization status." realtime={realtime}>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-9">
        <SocKpiCard title="Total Scans" value={totalRows} caption={`${rows.length} loaded on this page`} icon={ScanLine} tone="blue" loading={scansQuery.isLoading} />
        <button type="button" className="text-left" onClick={() => updateFilter("registration", "registered")}>
          <SocKpiCard title="Registered" value={summary.registered} caption="Checkpoint matched" icon={ShieldCheck} tone="green" loading={scansQuery.isLoading} />
        </button>
        <button type="button" className="text-left" onClick={() => updateFilter("registration", "unregistered")}>
          <SocKpiCard title="Unregistered" value={summary.unregistered} caption="Needs checkpoint review" icon={AlertTriangle} tone={summary.unregistered ? "amber" : "green"} loading={scansQuery.isLoading} />
        </button>
        <SocKpiCard title="Pending Review" value={summary.pendingReview} caption="Unregistered or pending" icon={Clock3} tone={summary.pendingReview ? "amber" : "green"} loading={scansQuery.isLoading} />
        <button type="button" className="text-left" onClick={() => updateFilter("sync", "offline")}>
          <SocKpiCard title="Offline Synced" value={summary.offlineSynced} caption="Saved offline, synced later" icon={Database} tone={summary.offlineSynced ? "blue" : "green"} loading={scansQuery.isLoading} />
        </button>
        <SocKpiCard title="Pending Sync" value={summary.pendingSync} caption="No pending queue column in scan_logs" icon={Wifi} tone={summary.pendingSync ? "amber" : "green"} loading={scansQuery.isLoading} />
        <button type="button" className="text-left" onClick={() => updateFilter("status", "rejected")}>
          <SocKpiCard title="Rejected" value={summary.rejected} caption="Rejected or failed" icon={XCircle} tone={summary.rejected ? "red" : "green"} loading={scansQuery.isLoading} />
        </button>
        <SocKpiCard title="Duplicate / Suspicious" value={summary.duplicate} caption="Repeated UID on page" icon={Radio} tone={summary.duplicate ? "red" : "green"} loading={scansQuery.isLoading} />
        <SocKpiCard title="Avg GPS Accuracy" value={summary.avgGps ? `${summary.avgGps}m` : "-"} caption={summary.poorGps ? `${summary.poorGps} poor/missing` : "Good"} icon={LocateFixed} tone={summary.poorGps ? "amber" : "blue"} loading={scansQuery.isLoading} />
      </section>

      {(summary.unregistered || summary.rejected || summary.duplicate || summary.poorGps || summary.pendingSync) > 0 && (
        <SocPanel title="Attention Required" action={<Link to="/checkpoints" className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Review pending tags</Link>}>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {summary.unregistered > 0 && <AttentionTile title="Unregistered UID" value={summary.unregistered} detail="Needs review" tone="amber" />}
            {summary.duplicate > 0 && <AttentionTile title="Repeated UID" value={summary.duplicate} detail="Check duplicate timing" tone="red" />}
            {summary.rejected > 0 && <AttentionTile title="Rejected scan" value={summary.rejected} detail="Review failure cause" tone="red" />}
            {summary.pendingSync > 0 && <AttentionTile title="Pending sync" value={summary.pendingSync} detail="Awaiting device sync" tone="amber" />}
            {summary.poorGps > 0 && <AttentionTile title="Poor GPS" value={summary.poorGps} detail="Fair, poor or missing" tone="amber" />}
          </div>
        </SocPanel>
      )}

      <SocPanel
        title="Operational Filters"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <SocStatusPill icon={Wifi} label={`Last updated ${realtime.lastUpdatedAt ? labelTime(realtime.lastUpdatedAt) : "waiting"}`} tone={realtime.status === "live" ? "green" : "amber"} />
            <Button type="button" size="sm" variant="outline" onClick={refresh} disabled={scansQuery.isFetching}>
              <RefreshCcw className={`h-4 w-4 ${scansQuery.isFetching ? "animate-spin" : ""}`} /> Refresh
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={exportCsv} disabled={!rows.length}>
              <FileDown className="h-4 w-4" /> Export CSV
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">From</span>
            <Input type="date" value={filters.from} onChange={(event) => updateFilter("from", event.target.value)} className="border-white/10 bg-slate-950/80 text-xs text-slate-200" />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] font-black uppercase tracking-[0.12em] text-slate-500">To</span>
            <Input type="date" value={filters.to} onChange={(event) => updateFilter("to", event.target.value)} className="border-white/10 bg-slate-950/80 text-xs text-slate-200" />
          </label>
          {isPlatformAdmin && (
            <FilterSelect label="Company" value={filters.companyId} onChange={(value) => updateFilter("companyId", value)}>
              <option value="current">Current Company</option>
              {(companiesQuery.data ?? []).map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
            </FilterSelect>
          )}
          <FilterSelect label="Site" value={filters.siteId} onChange={(value) => updateFilter("siteId", value)}>
            <option value="all">All Sites</option>
            {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
          </FilterSelect>
          <FilterSelect label="Device" value={filters.device} onChange={(value) => updateFilter("device", value)}>
            <option value="all">All Devices</option>
            {(devicesQuery.data ?? []).map((device) => (
              <option key={device.id} value={device.device_identifier}>
                {device.device_name || device.device_identifier}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect label="Checkpoint" value={filters.checkpointId} onChange={(value) => updateFilter("checkpointId", value)}>
            <option value="all">All Checkpoints</option>
            {(checkpointsQuery.data ?? []).map((checkpoint) => <option key={checkpoint.id} value={checkpoint.id}>{checkpoint.name}</option>)}
          </FilterSelect>
          <FilterSelect label="Status" value={filters.status} onChange={(value) => updateFilter("status", value)}>
            <option value="all">All Statuses</option>
            <option value="registered">Registered</option>
            <option value="unregistered">Unregistered</option>
            <option value="pending_registration">Pending Registration</option>
            <option value="rejected">Rejected</option>
            <option value="failed">Failed</option>
          </FilterSelect>
          <FilterSelect label="Sync" value={filters.sync} onChange={(value) => updateFilter("sync", value)}>
            <option value="all">All Sync States</option>
            <option value="online">Synced Online</option>
            <option value="offline">Offline Saved</option>
          </FilterSelect>
          <FilterSelect label="Registered" value={filters.registration} onChange={(value) => updateFilter("registration", value)}>
            <option value="all">All Tags</option>
            <option value="registered">Registered Only</option>
            <option value="unregistered">Unregistered Only</option>
          </FilterSelect>
          <FilterSelect label="GPS" value={filters.gps} onChange={(value) => updateFilter("gps", value)}>
            <option value="all">All GPS States</option>
            <option value="available">GPS Available</option>
            <option value="missing">GPS Missing</option>
          </FilterSelect>

        </div>
        <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
          <label className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input
              value={filters.text}
              onChange={(event) => updateFilter("text", event.target.value)}
              placeholder="Search NFC UID or device identifier..."
              className="border-white/10 bg-slate-950/80 pl-9 text-sm text-slate-200"
            />
          </label>
          <Button type="button" variant="outline" onClick={clearFilters}>
            <RotateCcw className="h-4 w-4" /> Clear Filters
          </Button>
        </div>
      </SocPanel>

      <SocPanel title="Scan Timeline" action={<span className="text-xs font-semibold text-slate-400">Latest {Math.min(rows.length, 8)} scans</span>}>
        {rows.length ? (
          <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
            {rows.slice(0, 8).map((scan) => {
              const gps = gpsQuality(scan);
              const device = readableDevice(scan, devicesQuery.data ?? []);
              const duplicateUid = !!scan.tag_uid && summary.duplicateUidSet.has(scan.tag_uid);
              const validation = validationState(scan, duplicateUid);
              return (
                <button key={scan.id} type="button" onClick={() => setSelectedScan(scan)} className={`rounded-lg border bg-white/[0.03] p-3 text-left transition hover:border-cyan-400/30 ${highlightedId === scan.id ? "border-emerald-400/50 bg-emerald-400/10" : "border-white/10"}`}>
                  <div className="mb-2 flex items-center justify-between gap-2"><span className="font-mono text-xs text-slate-400">{labelTime(scan.scanned_at)}</span><StatusBadge label={validation.label} tone={validation.tone} /></div>
                  <p className="truncate text-sm font-bold text-white">{checkpointLabel(scan)}</p>
                  <p className="mt-1 truncate text-xs text-slate-400">{device.name} - {siteLabel(scan)}</p>
                  <p className={`mt-2 text-xs font-semibold ${gps.tone === "red" ? "text-red-300" : gps.tone === "amber" ? "text-amber-300" : "text-emerald-300"}`}>{gps.label} GPS - {gps.detail}</p>
                </button>
              );
            })}
          </div>
        ) : <StateEmpty icon={ScanLine} title="No timeline yet" text="No scan logs match this filter window." />}
      </SocPanel>

      <SocPanel
        title="Scan Investigation Table"
        action={<span className="text-xs font-semibold text-slate-400">{totalRows} records - page {page + 1} of {totalPages}</span>}
      >
        {scansQuery.error && (
          <div className="mb-3 rounded-xl border border-red-400/20 bg-red-500/10 p-4 text-sm text-red-200">
            Scan logs could not be loaded. Check your connection and Supabase permissions.
          </div>
        )}
        {!scansQuery.isLoading && rows.length === 0 ? (
          <StateEmpty icon={Filter} title="No scan logs found" text="No real scan_logs rows match the selected filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-[1180px] w-full text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-[10px] uppercase tracking-[0.12em] text-slate-500">
                  <th className="px-3 py-3">Date</th>
                  <th className="px-3 py-3">Time</th>
                  <th className="px-3 py-3">Device</th>
                  <th className="px-3 py-3">Site</th>
                  <th className="px-3 py-3">Checkpoint</th>
                  <th className="px-3 py-3">NFC UID</th>
                  <th className="px-3 py-3">Registration</th>
                  <th className="px-3 py-3">Validation</th>
                  <th className="px-3 py-3">GPS Quality</th>
                  <th className="px-3 py-3">Location</th>
                  <th className="px-3 py-3">Sync</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Evidence</th>
                  <th className="px-3 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((scan) => {
                  const registered = isRegistered(scan);
                  const status = registered ? "registered" : scan.tag_status || "unregistered";
                  const device = readableDevice(scan, devicesQuery.data ?? []);
                  const gps = gpsQuality(scan);
                  const sync = syncState(scan);
                  const duplicateUid = !!scan.tag_uid && summary.duplicateUidSet.has(scan.tag_uid);
                  const validation = validationState(scan, duplicateUid);
                  const mapUrl = hasGps(scan) ? `/live-map?lat=${scan.gps_lat}&lng=${scan.gps_lng}&scan=${scan.id}` : "/live-map";
                  return (
                    <tr
                      key={scan.id}
                      onClick={() => setSelectedScan(scan)}
                      className={`cursor-pointer border-b border-white/5 text-slate-200 transition ${
                        highlightedId === scan.id ? "bg-emerald-400/15 shadow-[inset_3px_0_0_rgba(52,211,153,0.9)]" : "hover:bg-white/[0.03]"
                      }`}
                    >
                      <td className="px-3 py-3 whitespace-nowrap">{labelDate(scan.scanned_at)}</td>
                      <td className="px-3 py-3 whitespace-nowrap font-mono text-xs">{labelTime(scan.scanned_at)}</td>
                      <td className="px-3 py-3">
                        <div className="font-bold text-white">{device.name}</div>
                        <div className="max-w-[13rem] truncate text-xs text-slate-500" title={device.identifier}>{device.subtitle}</div>
                      </td>
                      <td className="px-3 py-3 whitespace-nowrap">{siteLabel(scan)}</td>
                      <td className="px-3 py-3">
                        <div className="max-w-[180px] truncate font-semibold">{checkpointLabel(scan)}</div>
                        {!registered && <div className="text-xs text-amber-300">Review or register checkpoint</div>}
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <code className="rounded border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-200">{scan.tag_uid || "-"}</code>
                          {scan.tag_uid && <button type="button" onClick={(event) => { event.stopPropagation(); copyUid(scan.tag_uid); }} className="rounded p-1 text-slate-400 hover:bg-white/10 hover:text-white" aria-label="Copy UID"><Copy className="h-3.5 w-3.5" /></button>}
                        </div>
                      </td>
                      <td className="px-3 py-3"><StatusBadge label={status.replace(/_/g, " ")} tone={statusTone(status)} /></td>
                      <td className="px-3 py-3"><StatusBadge label={validation.label} tone={validation.tone} /></td>
                      <td className="px-3 py-3"><StatusBadge label={`${gps.label} ${gps.detail}`} tone={gps.tone} /></td>
                      <td className="px-3 py-3">
                        {hasGps(scan) ? <Link to={mapUrl} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:text-cyan-200"><MapPin className="h-3.5 w-3.5" />Location Available</Link> : <span className="text-xs text-amber-300">GPS Missing</span>}
                      </td>
                      <td className="px-3 py-3"><StatusBadge label={sync.label} tone={sync.tone} /></td>
                      <td className="px-3 py-3">{scan.is_manual ? "Manual correction" : "RG360/device"}</td>
                      <td className="px-3 py-3"><EvidenceBadges scan={scan} /></td>
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-1">
                          <Button type="button" variant="ghost" size="sm" onClick={(event) => { event.stopPropagation(); setSelectedScan(scan); }}><Eye className="h-4 w-4" /></Button>
                          <Button asChild variant="ghost" size="sm" onClick={(event) => event.stopPropagation()}><Link to={mapUrl}><MapPin className="h-4 w-4" /></Link></Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span>Rows per page</span>
            <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))} className="rounded-lg border border-white/10 bg-slate-950 px-2 py-1 text-slate-200">
              {PAGE_SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((value) => Math.max(0, value - 1))}>Previous</Button>
            <span className="text-xs font-semibold text-slate-400">{page + 1} / {totalPages}</span>
            <Button type="button" variant="outline" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((value) => Math.min(totalPages - 1, value + 1))}>Next</Button>
          </div>
        </div>
      </SocPanel>

      <ScanDetailSheet scan={selectedScan} companyName={companyName} onOpenChange={(open) => !open && setSelectedScan(null)} />
    </SocPageShell>
  );
}

function ScanDetailSheet({ scan, companyName, onOpenChange }: { scan: ScanLogRow | null; companyName: string; onOpenChange: (open: boolean) => void }) {
  if (!scan) return <Sheet open={false} onOpenChange={onOpenChange} />;
  const registered = isRegistered(scan);
  const battery = metadataValue(scan.device_metadata, "battery_level") || metadataValue(scan.device_metadata, "battery");
  const network = metadataValue(scan.device_metadata, "network") || metadataValue(scan.device_metadata, "network_state");
  const appVersion = metadataValue(scan.device_metadata, "app_version");
  const mapUrl = hasGps(scan) ? `/live-map?lat=${scan.gps_lat}&lng=${scan.gps_lng}&scan=${scan.id}` : "/live-map";

  return (
    <Sheet open={!!scan} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto border-white/10 bg-[#050914] text-slate-200 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-white">Scan Detail</SheetTitle>
        </SheetHeader>
        <div className="mt-5 space-y-4">
          <DetailPanel title="Scan Identity" icon={ScanLine}>
            <DetailLine label="Scan ID" value={scan.id} mono />
            <DetailLine label="Timestamp" value={`${labelDate(scan.scanned_at)} ${labelTime(scan.scanned_at)}`} />
            <DetailLine label="Company" value={companyName} />
            <DetailLine label="Site" value={siteLabel(scan)} />
            <DetailLine label="Device Name" value={deviceLabel(scan)} />
            <DetailLine label="Device Identifier" value={scan.device_identifier || "-"} mono />
            <DetailLine label="Tag UID" value={scan.tag_uid || "-"} mono />
            <DetailLine label="Checkpoint" value={checkpointLabel(scan)} />
            <DetailLine label="Checkpoint ID" value={scan.checkpoint_id || "-"} mono />
            <DetailLine label="Status" value={registered ? "Registered checkpoint" : scan.tag_status || "Unregistered"} />
          </DetailPanel>

          <DetailPanel title="Location" icon={MapPin}>
            <DetailLine label="Latitude" value={scan.gps_lat ?? "-"} mono />
            <DetailLine label="Longitude" value={scan.gps_lng ?? "-"} mono />
            <DetailLine label="GPS Accuracy" value={scan.gps_accuracy != null ? `${Math.round(scan.gps_accuracy)}m` : "No GPS recorded"} />
            <DetailLine label="Location Source" value={hasGps(scan) ? "Recorded with scan" : "GPS missing"} />
            <Button asChild variant="outline" className="mt-2 w-full">
              <Link to={mapUrl}><MapPin className="h-4 w-4" /> Open on Map</Link>
            </Button>
          </DetailPanel>

          <DetailPanel title="Patrol Relationship" icon={Radio}>
            <DetailLine label="Patrol Route" value={scan.checkpoints?.patrol_id || "Not linked in scan_logs"} mono />
            <DetailLine label="Patrol Session" value="No patrol_session_id column on scan_logs yet" />
            <DetailLine label="Previous Checkpoint" value="Requires patrol session model" />
            <DetailLine label="Next Checkpoint" value="Requires patrol route sequence data" />
          </DetailPanel>

          <DetailPanel title="Device Information" icon={Smartphone}>
            <DetailLine label="Device ID" value={scan.device_id || "-"} mono />
            <DetailLine label="Battery" value={battery ? `${battery}%` : "Not recorded"} />
            <DetailLine label="Network" value={network || "Not recorded"} />
            <DetailLine label="App Version" value={appVersion || "Not recorded"} />
            <DetailLine label="Guard Context" value={scan.guards?.full_name || "No guard assigned"} />
          </DetailPanel>

          <DetailPanel title="Sync And Validation" icon={Database}>
            <DetailLine label="Created At" value={`${labelDate(scan.created_at)} ${labelTime(scan.created_at)}`} />
            <DetailLine label="Sync State" value={scan.is_offline_sync ? "Offline saved, then synchronized" : "Saved online"} />
            <DetailLine label="Manual Correction" value={scan.is_manual ? "Yes" : "No"} />
            <DetailLine label="Manual Reason" value={scan.manual_scan_reason || "-"} />
            <DetailLine label="Checkpoint Match" value={registered ? "Matched checkpoint" : "No checkpoint match"} />
            <DetailLine label="Face Verified" value={scan.face_verified === null ? "Not used" : scan.face_verified ? "Yes" : "No"} />
            <DetailLine label="Face Confidence" value={scan.face_confidence != null ? `${Math.round(scan.face_confidence * 100)}%` : "-"} />
          </DetailPanel>

          <DetailPanel title="Developer Debug" icon={AlertTriangle}>
            <DetailLine label="Raw tag_status" value={scan.tag_status} mono />
            <DetailLine label="Raw source" value={scan.scanned_by || scan.user_id || "device"} mono />
            <p className="mt-2 text-xs text-slate-500">
              Technical database errors are intentionally not shown to supervisors here. Check Supabase logs for write failures.
            </p>
          </DetailPanel>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function AttentionTile({ title, value, detail, tone }: { title: string; value: number; detail: string; tone: "amber" | "red" }) {
  const style = tone === "red" ? "border-red-400/25 bg-red-500/10 text-red-300" : "border-amber-400/25 bg-amber-400/10 text-amber-300";
  return (
    <div className={`rounded-lg border p-3 ${style}`}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-black uppercase tracking-[0.08em]">{title}</p>
        <span className="text-lg font-black text-white">{value}</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">{detail}</p>
    </div>
  );
}

function StateEmpty({ icon: Icon, title, text }: { icon: typeof ScanLine; title: string; text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/10 bg-slate-950/60 p-10 text-center">
      <Icon className="mx-auto mb-3 h-8 w-8 text-slate-500" />
      <h3 className="text-lg font-black text-white">{title}</h3>
      <p className="mt-1 text-sm text-slate-400">{text}</p>
    </div>
  );
}

function EvidenceBadges({ scan }: { scan: ScanLogRow }) {
  const badges = [];
  if (scan.face_verified !== null) badges.push(scan.face_verified ? "Face" : "Face failed");
  if (scan.manual_scan_reason) badges.push("Review note");
  if (!badges.length) return <span className="text-xs text-slate-500">None linked</span>;
  return <div className="flex flex-wrap gap-1">{badges.map((badge) => <StatusBadge key={badge} label={badge} tone="blue" />)}</div>;
}

function DetailPanel({ title, icon: Icon, children }: { title: string; icon: typeof ScanLine; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-slate-950/70 p-4">
      <h3 className="mb-3 flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-white">
        <Icon className="h-4 w-4 text-emerald-300" /> {title}
      </h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function DetailLine({ label, value, mono }: { label: string; value: string | number | null | undefined; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-3 text-xs">
      <span className="text-slate-500">{label}</span>
      <span className={`break-words font-semibold text-slate-200 ${mono ? "font-mono" : ""}`}>{value ?? "-"}</span>
    </div>
  );
}




