import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Battery,
  Bell,
  BellRing,
  Camera,
  CheckCircle2,
  Clock,
  Copy,
  Crosshair,
  ExternalLink,
  Eye,
  FileText,
  Filter,
  Loader2,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Search,
  ShieldAlert,
  Siren,
  Smartphone,
  UserCheck,
  Wifi,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useCheckpoints, useRealtimeSubscriptions } from "@/hooks/useDashboardData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { useSites } from "@/hooks/useSites";

type SosStatus = "active" | "acknowledged" | "dispatched" | "resolved" | "false_alarm";
type Tone = "red" | "amber" | "green" | "blue" | "slate" | "purple";

type SosAlertRow = {
  id: string;
  company_id: string;
  created_at: string;
  guard_id: string | null;
  is_read: boolean | null;
  message: string;
  patrol_id: string | null;
  severity: string | null;
  type: string;
  companies?: { name: string | null } | null;
  guards?: { full_name: string | null; badge_number: string | null; phone?: string | null } | null;
};

type DeviceRow = {
  id: string;
  company_id: string;
  device_identifier: string;
  device_name: string | null;
  status: string | null;
  site_id?: string | null;
  site_location?: string | null;
  battery_level?: number | null;
  current_gps_lat?: number | null;
  current_gps_lng?: number | null;
  current_gps_accuracy?: number | null;
  current_gps_at?: string | null;
  last_seen_at?: string | null;
  sites?: { name: string | null } | null;
  guards?: { full_name: string | null; badge_number: string | null; phone?: string | null } | null;
};

type ScanRow = {
  id: string;
  company_id: string;
  checkpoint_id: string | null;
  device_identifier: string | null;
  scanned_at: string;
  tag_status: string;
  tag_uid: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  gps_accuracy: number | null;
  checkpoints?: { name: string | null } | null;
  sites?: { name: string | null } | null;
};

type IncidentPhoto = {
  id: string;
  site_id: string | null;
  device_identifier: string;
  storage_path: string;
  captured_at: string;
  gps_lat: number | null;
  gps_lng: number | null;
  signed_url?: string;
};

type ParsedSos = {
  deviceIdentifier: string | null;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;
  keyName: string | null;
  heldMs: number | null;
  triggeredAt: string | null;
};

type DispatchSos = {
  alert: SosAlertRow;
  parsed: ParsedSos;
  device: DeviceRow | null;
  lastScan: ScanRow | null;
  companyName: string;
  siteId: string | null;
  siteName: string;
  deviceName: string;
  guardName: string;
  location: { lat: number; lng: number; accuracy: number | null; source: string } | null;
  status: SosStatus;
};

const parseNumber = (value: string | undefined) => {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseSosMessage = (message: string): ParsedSos => {
  const deviceMatch = message.match(/(?:device|Device ID)\s*[:=]\s*([^|]+)/i);
  const gpsMatch = message.match(/(?:gps|Location)\s*[:=]\s*(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)(?:\s*\(.*?(\d+(?:\.\d+)?)m\))?/i);
  const keyMatch = message.match(/key\s*[:=]\s*([^|]+)/i);
  const heldMatch = message.match(/held\s*[:=]\s*(\d+)ms/i);
  const atMatch = message.match(/at\s*[:=]\s*([^|]+)/i);
  return {
    deviceIdentifier: deviceMatch?.[1]?.trim() || null,
    lat: parseNumber(gpsMatch?.[1]),
    lng: parseNumber(gpsMatch?.[2]),
    accuracy: parseNumber(gpsMatch?.[3]),
    keyName: keyMatch?.[1]?.trim() || null,
    heldMs: parseNumber(heldMatch?.[1]),
    triggeredAt: atMatch?.[1]?.trim() || null,
  };
};

const formatTime = (date: string) => format(new Date(date), "HH:mm:ss");
const formatDate = (date: string) => format(new Date(date), "MMM d, yyyy");

const shortDevice = (identifier: string | null) => {
  if (!identifier) return "Unknown device";
  const tail = identifier.split("-").pop();
  return tail ? `RG360-${tail.slice(-6).toUpperCase()}` : identifier;
};

const distanceKm = (a: { lat: number; lng: number } | null, b: { lat: number; lng: number } | null) => {
  if (!a || !b) return null;
  const rad = Math.PI / 180;
  const earthKm = 6371;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s1 = Math.sin(dLat / 2) ** 2;
  const s2 = Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(s1 + s2), Math.sqrt(1 - s1 - s2));
};

const heartbeatState = (date?: string | null) => {
  if (!date) return { label: "Offline", tone: "slate" as Tone, ageMs: Number.POSITIVE_INFINITY };
  const ageMs = Date.now() - new Date(date).getTime();
  if (ageMs <= 2 * 60 * 1000) return { label: "Online", tone: "green" as Tone, ageMs };
  if (ageMs <= 10 * 60 * 1000) return { label: "Delayed", tone: "amber" as Tone, ageMs };
  return { label: "Offline", tone: "red" as Tone, ageMs };
};

const toneClasses: Record<Tone, string> = {
  red: "border-red-500/40 bg-red-950/30 text-red-200",
  amber: "border-amber-500/40 bg-amber-950/25 text-amber-200",
  green: "border-emerald-500/40 bg-emerald-950/25 text-emerald-200",
  blue: "border-sky-500/40 bg-sky-950/25 text-sky-200",
  slate: "border-slate-700/70 bg-slate-900/45 text-slate-300",
  purple: "border-purple-500/40 bg-purple-950/25 text-purple-200",
};

const statusTone = (status: SosStatus): Tone => status === "resolved" ? "green" : status === "acknowledged" || status === "dispatched" ? "amber" : status === "false_alarm" ? "slate" : "red";
const alertRef = (alert: SosAlertRow) => `SOS-${alert.created_at.slice(0, 4)}-${alert.id.slice(0, 4).toUpperCase()}`;

const SosAlerts = () => {
  useRealtimeSubscriptions();
  const queryClient = useQueryClient();
  const realtime = useRealtimeConnectionStatus("sos-emergency-center");
  const { user } = useAuth();
  const { data: sites = [] } = useSites();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [siteFilter, setSiteFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [search, setSearch] = useState("");

  const { data: alerts = [], isLoading: alertsLoading, error: alertsError } = useQuery({
    queryKey: ["sos_alerts_page"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*, companies(name), guards(full_name, badge_number)")
        .eq("type", "panic_button")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data as SosAlertRow[];
    },
  });

  const { data: devices = [] } = useQuery({
    queryKey: ["sos_devices"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("devices")
        .select("*, sites(name), guards(full_name, badge_number)")
        .order("last_seen_at", { ascending: false });
      if (error) throw error;
      return data as unknown as DeviceRow[];
    },
  });

  const { data: scans = [] } = useQuery({
    queryKey: ["sos_recent_scans"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_logs")
        .select("*, checkpoints(name), sites(name)")
        .order("scanned_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data as unknown as ScanRow[];
    },
  });

  const { data: checkpoints = [] } = useCheckpoints();

  const { data: photos = [] } = useQuery({
    queryKey: ["sos_incident_photos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("incident_report_photos" as never)
        .select("id, site_id, device_identifier, storage_path, captured_at, gps_lat, gps_lng")
        .order("captured_at", { ascending: false })
        .limit(24);
      if (error) throw error;
      const rows = (data ?? []) as unknown as IncidentPhoto[];
      return Promise.all(rows.map(async (photo) => {
        const { data: signed } = await supabase.storage.from("incident-reports").createSignedUrl(photo.storage_path, 60 * 20);
        return { ...photo, signed_url: signed?.signedUrl };
      }));
    },
  });

  const dispatchAlerts = useMemo<DispatchSos[]>(() => {
    const deviceMap = new Map(devices.map((device) => [device.device_identifier, device]));
    return alerts.map((alert) => {
      const parsed = parseSosMessage(alert.message);
      const device = parsed.deviceIdentifier ? deviceMap.get(parsed.deviceIdentifier) ?? null : null;
      const createdAt = new Date(alert.created_at).getTime();
      const lastScan = scans.find((scan) => {
        if (!parsed.deviceIdentifier || scan.device_identifier !== parsed.deviceIdentifier) return false;
        return new Date(scan.scanned_at).getTime() <= createdAt;
      }) ?? null;
      const location = parsed.lat != null && parsed.lng != null
        ? { lat: parsed.lat, lng: parsed.lng, accuracy: parsed.accuracy, source: "SOS GPS" }
        : device?.current_gps_lat != null && device?.current_gps_lng != null
          ? { lat: device.current_gps_lat, lng: device.current_gps_lng, accuracy: device.current_gps_accuracy ?? null, source: "Last device GPS" }
          : lastScan?.gps_lat != null && lastScan?.gps_lng != null
            ? { lat: lastScan.gps_lat, lng: lastScan.gps_lng, accuracy: lastScan.gps_accuracy, source: "Last scan GPS" }
            : null;
      const siteName = device?.sites?.name || lastScan?.sites?.name || device?.site_location || "Unassigned site";
      return {
        alert,
        parsed,
        device,
        lastScan,
        companyName: alert.companies?.name || "Company pending",
        siteId: device?.site_id ?? null,
        siteName,
        deviceName: device?.device_name || shortDevice(parsed.deviceIdentifier),
        guardName: alert.guards?.full_name || device?.guards?.full_name || "No guard assigned",
        location,
        status: alert.is_read ? "resolved" : "active",
      };
    });
  }, [alerts, devices, scans]);

  const filteredAlerts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return dispatchAlerts.filter((item) => {
      const haystack = `${alertRef(item.alert)} ${item.alert.id} ${item.deviceName} ${item.parsed.deviceIdentifier ?? ""} ${item.guardName} ${item.siteName} ${item.lastScan?.checkpoints?.name ?? ""} ${item.alert.message}`.toLowerCase();
      return (
        (statusFilter === "all" || item.status === statusFilter) &&
        (siteFilter === "all" || item.siteId === siteFilter || item.siteName === siteFilter) &&
        (priorityFilter === "all" || item.alert.severity === priorityFilter) &&
        (!term || haystack.includes(term))
      );
    });
  }, [dispatchAlerts, priorityFilter, search, siteFilter, statusFilter]);

  const selected = useMemo(() => {
    if (selectedId) {
      const match = dispatchAlerts.find((item) => item.alert.id === selectedId);
      if (match) return match;
    }
    return filteredAlerts[0] ?? dispatchAlerts[0] ?? null;
  }, [dispatchAlerts, filteredAlerts, selectedId]);

  const activeCount = dispatchAlerts.filter((item) => item.status === "active").length;
  const resolvedToday = dispatchAlerts.filter((item) => item.status === "resolved" && new Date(item.alert.created_at).toDateString() === new Date().toDateString()).length;
  const resolvedCount = dispatchAlerts.filter((item) => item.status === "resolved").length;
  const acknowledgedCount = dispatchAlerts.filter((item) => item.status === "acknowledged" || item.status === "dispatched").length;
  const highRiskSite = useMemo(() => {
    const counts = new Map<string, number>();
    dispatchAlerts.filter((item) => item.status === "active").forEach((item) => counts.set(item.siteName, (counts.get(item.siteName) ?? 0) + 1));
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "All clear";
  }, [dispatchAlerts]);

  const avgResponse = useMemo(() => {
    const resolved = dispatchAlerts.filter((item) => item.status === "resolved");
    if (resolved.length === 0) return "Pending";
    const avgMs = resolved.reduce((total, item) => total + Math.max(0, Date.now() - new Date(item.alert.created_at).getTime()), 0) / resolved.length;
    const minutes = Math.floor(avgMs / 60000);
    const seconds = Math.floor((avgMs % 60000) / 1000);
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }, [dispatchAlerts]);

  const nearbyDevices = useMemo(() => {
    const center = selected?.location ? { lat: selected.location.lat, lng: selected.location.lng } : null;
    return devices
      .filter((device) => device.company_id === selected?.alert.company_id && device.device_identifier !== selected?.parsed.deviceIdentifier)
      .map((device) => {
        const devicePoint = device.current_gps_lat != null && device.current_gps_lng != null ? { lat: device.current_gps_lat, lng: device.current_gps_lng } : null;
        return { device, heartbeat: heartbeatState(device.last_seen_at ?? device.current_gps_at), distance: distanceKm(center, devicePoint) };
      })
      .sort((a, b) => (a.distance ?? Number.POSITIVE_INFINITY) - (b.distance ?? Number.POSITIVE_INFINITY))
      .slice(0, 4);
  }, [devices, selected]);

  const evidence = useMemo(() => {
    if (!selected) return [];
    return photos.filter((photo) => {
      const sameDevice = photo.device_identifier === selected.parsed.deviceIdentifier;
      const sameSite = selected.siteId && photo.site_id === selected.siteId;
      return sameDevice || sameSite;
    }).slice(0, 6);
  }, [photos, selected]);

  const recentTimeline = useMemo(() => {
    if (!selected) return [];
    const rows = scans
      .filter((scan) => scan.device_identifier === selected.parsed.deviceIdentifier && new Date(scan.scanned_at).getTime() <= new Date(selected.alert.created_at).getTime())
      .slice(0, 4)
      .map((scan) => ({ time: scan.scanned_at, title: scan.checkpoints?.name ? "Checkpoint scanned" : "Scan recorded", detail: scan.checkpoints?.name || scan.tag_uid || "NFC tag", tone: scan.tag_status === "registered" ? "green" as Tone : "amber" as Tone, icon: Route }));
    return [
      { time: selected.alert.created_at, title: "SOS triggered", detail: selected.deviceName, tone: "red" as Tone, icon: Siren },
      { time: selected.parsed.triggeredAt || selected.alert.created_at, title: selected.location ? "Location captured" : "Location pending", detail: selected.location?.source || "Waiting for GPS", tone: selected.location ? "blue" as Tone : "amber" as Tone, icon: Crosshair },
      ...rows,
      ...(selected.status === "resolved" ? [{ time: selected.alert.created_at, title: "Marked resolved", detail: "Supervisor acknowledged closure", tone: "green" as Tone, icon: CheckCircle2 }] : []),
    ];
  }, [scans, selected]);

  const mapPoints = useMemo(() => {
    const points: Array<{ id: string; label: string; lat: number; lng: number; type: "sos" | "checkpoint" | "device" }> = [];
    if (selected?.location) points.push({ id: selected.alert.id, label: "SOS", lat: selected.location.lat, lng: selected.location.lng, type: "sos" });
    if (selected?.device?.current_gps_lat != null && selected.device.current_gps_lng != null) {
      points.push({ id: selected.device.id, label: selected.deviceName, lat: selected.device.current_gps_lat, lng: selected.device.current_gps_lng, type: "device" });
    }
    checkpoints
      .filter((checkpoint) => checkpoint.location_lat != null && checkpoint.location_lng != null && (!selected || checkpoint.company_id === selected.alert.company_id))
      .slice(0, 12)
      .forEach((checkpoint) => points.push({ id: checkpoint.id, label: checkpoint.name, lat: checkpoint.location_lat!, lng: checkpoint.location_lng!, type: "checkpoint" }));
    return points;
  }, [checkpoints, selected]);

  const resolveMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase.from("alerts").update({ is_read: true }).eq("id", alertId);
      if (error) throw error;
    },
    onSuccess: (_data, alertId) => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      queryClient.invalidateQueries({ queryKey: ["sos_alerts_page"] });
      window.dispatchEvent(new CustomEvent("mxpatrol:sos-resolved", { detail: { id: alertId } }));
      toast.success("SOS alert resolved");
    },
    onError: () => toast.error("Could not resolve SOS alert"),
  });

  const copyReference = async () => {
    if (!selected) return;
    await navigator.clipboard?.writeText(`${alertRef(selected.alert)} ${selected.deviceName} ${selected.siteName}`);
    toast.success("SOS reference copied");
  };

  const openMap = () => {
    if (!selected?.location) return;
    window.open(`https://www.google.com/maps?q=${selected.location.lat},${selected.location.lng}`, "_blank", "noopener,noreferrer");
  };

  const createIncidentHref = selected ? `/incidents?sosAlert=${selected.alert.id}` : "/incidents";

  if (alertsLoading) return <SosSkeleton />;
  if (alertsError) return <SosEmpty title="SOS alerts could not load" description="Refresh the page or check your Supabase connection." />;

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white">SOS Alerts</h1>
            <Badge className={`${realtime.status === "live" ? "border-red-500/50 bg-red-500/15 text-red-200" : "border-amber-500/50 bg-amber-500/15 text-amber-200"}`}>
              <span className="mr-1.5 h-2 w-2 animate-pulse rounded-full bg-current" /> {realtimeStatusLabel(realtime.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">Real-time emergency alerts and response management</p>
        </div>
        <div className="grid w-full gap-2 md:grid-cols-2 xl:w-auto xl:grid-cols-[150px_150px_150px_220px_220px_auto]">
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Sites</SelectItem>{sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent>
          </Select>
          <Select value={priorityFilter} onValueChange={setPriorityFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Priority</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" className="justify-start"><Clock className="mr-2 h-4 w-4" /> Latest 100 alerts</Button>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search alerts..." className="pl-9" />
          </div>
          <Button variant="outline" aria-label="Refresh SOS alerts" onClick={() => { queryClient.invalidateQueries({ queryKey: ["sos_alerts_page"] }); queryClient.invalidateQueries({ queryKey: ["sos_devices"] }); }}><RefreshCw className="h-4 w-4" /></Button>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <SosKpi title="Active SOS" value={activeCount} caption={activeCount ? "Critical response" : "All clear"} tone={activeCount ? "red" : "green"} icon={Siren} />
        <SosKpi title="Acknowledged" value={acknowledgedCount} caption="Requires backend status fields" tone="amber" icon={BellRing} />
        <SosKpi title="Resolved Today" value={resolvedToday} caption={`${resolvedCount} total resolved`} tone="green" icon={CheckCircle2} />
        <SosKpi title="Avg Response" value={avgResponse} caption="Based on resolved rows" tone="blue" icon={Clock} />
        <SosKpi title="False Alarms" value="-" caption="No false_alarm field yet" tone="slate" icon={Bell} />
        <SosKpi title="High Risk Site" value={highRiskSite} caption="Current hotspot" tone={highRiskSite === "All clear" ? "green" : "red"} icon={AlertTriangle} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(520px,1.8fr)_minmax(330px,1fr)]">
        <SosAlertList alerts={filteredAlerts} selectedId={selected?.alert.id ?? null} onSelect={setSelectedId} />
        <EmergencyMap selected={selected} points={mapPoints} onOpenMap={openMap} />
        <SelectedSosPanel selected={selected} resolving={resolveMutation.isPending} onResolve={() => selected && resolveMutation.mutate(selected.alert.id)} onCopy={copyReference} createIncidentHref={createIncidentHref} onOpenMap={openMap} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(280px,0.8fr)_minmax(280px,0.75fr)_minmax(420px,1.3fr)]">
        <SosTimeline timeline={recentTimeline} />
        <div className="space-y-4">
          <NearbyDevices devices={nearbyDevices} />
          <NearestResponseUnit />
        </div>
        <div className="space-y-4">
          <IncidentEvidence evidence={evidence} />
          <SosStats total={dispatchAlerts.length} active={activeCount} resolved={resolvedCount} />
        </div>
      </section>

      <div className="sr-only" aria-live="assertive">{activeCount > 0 ? `${activeCount} active SOS alerts require attention` : "No active SOS alerts"}</div>
    </div>
  );
};

const SosKpi = ({ title, value, caption, tone, icon: Icon }: { title: string; value: string | number; caption: string; tone: Tone; icon: LucideIcon }) => (
  <div className={`min-h-[124px] rounded-lg border p-4 ${toneClasses[tone]}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">{title}</p>
        <p className="mt-2 truncate text-3xl font-bold leading-none text-white">{value}</p>
        <p className="mt-3 text-xs font-medium text-current">{caption}</p>
      </div>
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-current/30 bg-current/10"><Icon className="h-5 w-5" /></span>
    </div>
  </div>
);

const SosAlertList = ({ alerts, selectedId, onSelect }: { alerts: DispatchSos[]; selectedId: string | null; onSelect: (id: string) => void }) => (
  <aside className="rounded-lg border border-border/70 bg-slate-950/70">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 p-4">
      <div>
        <h2 className="font-semibold text-white">Active SOS Alerts</h2>
        <p className="text-xs text-slate-400">{alerts.length} matching records</p>
      </div>
      <Badge variant="outline" className="border-slate-700 text-slate-300">Newest</Badge>
    </div>
    <div className="max-h-[620px] space-y-3 overflow-y-auto p-3">
      {alerts.length === 0 ? <SosEmpty title="No active SOS alerts" description="The system is monitoring connected patrol devices." compact /> : alerts.map((item) => <SosAlertListItem key={item.alert.id} item={item} active={selectedId === item.alert.id} onSelect={onSelect} />)}
    </div>
  </aside>
);

const SosAlertListItem = ({ item, active, onSelect }: { item: DispatchSos; active: boolean; onSelect: (id: string) => void }) => {
  const tone = statusTone(item.status);
  return (
    <button type="button" onClick={() => onSelect(item.alert.id)} className={`w-full rounded-lg border p-4 text-left transition focus:outline-none focus:ring-2 focus:ring-red-400/50 ${active ? "border-red-400 bg-red-950/30 shadow-[0_0_24px_rgba(239,68,68,.18)]" : "border-border/60 bg-slate-900/45 hover:border-red-500/40"}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border ${toneClasses[tone]}`}><Siren className="h-4 w-4" /></span>
            <div className="min-w-0">
              <p className="truncate font-mono text-sm font-bold text-white">{alertRef(item.alert)}</p>
              <p className="text-xs text-slate-400">{formatTime(item.alert.created_at)} - {formatDistanceToNowStrict(new Date(item.alert.created_at), { addSuffix: true })}</p>
            </div>
          </div>
          <div className="mt-3 space-y-1 text-xs text-slate-300">
            <p className="truncate"><Smartphone className="mr-1 inline h-3 w-3 text-sky-300" />{item.deviceName}</p>
            <p className="truncate"><UserCheck className="mr-1 inline h-3 w-3 text-slate-400" />{item.guardName}</p>
            <p className="truncate"><MapPin className="mr-1 inline h-3 w-3 text-emerald-300" />{item.siteName}</p>
          </div>
        </div>
        <Badge className={toneClasses[tone]}>{item.status}</Badge>
      </div>
    </button>
  );
};

const pointStyle = (lat: number, lng: number, points: Array<{ lat: number; lng: number }>) => {
  if (points.length <= 1) return { left: "50%", top: "48%" };
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const x = maxLng === minLng ? 50 : 10 + ((lng - minLng) / (maxLng - minLng)) * 80;
  const y = maxLat === minLat ? 48 : 12 + ((maxLat - lat) / (maxLat - minLat)) * 76;
  return { left: `${x}%`, top: `${y}%` };
};

const EmergencyMap = ({ selected, points, onOpenMap }: { selected: DispatchSos | null; points: Array<{ id: string; label: string; lat: number; lng: number; type: "sos" | "checkpoint" | "device" }>; onOpenMap: () => void }) => (
  <section className="overflow-hidden rounded-lg border border-border/70 bg-slate-950/70">
    <div className="flex items-center justify-between gap-3 border-b border-border/70 p-4">
      <div>
        <h2 className="font-semibold text-white">Live Emergency Map</h2>
        <p className="text-xs text-slate-400">Selected SOS focus, checkpoints and nearby device position.</p>
      </div>
      <div className="hidden items-center gap-3 text-xs text-slate-400 sm:flex">
        <LegendDot tone="red" label="Active" /><LegendDot tone="amber" label="Acknowledged" /><LegendDot tone="green" label="Checkpoint" /><LegendDot tone="blue" label="Device" />
      </div>
    </div>
    <div className="relative min-h-[520px] overflow-hidden bg-[#020812]">
      <div className="absolute inset-0 opacity-45" style={{ backgroundImage: "linear-gradient(rgba(56,189,248,.1) 1px, transparent 1px), linear-gradient(90deg, rgba(56,189,248,.1) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(239,68,68,.18),transparent_32%),radial-gradient(circle_at_80%_18%,rgba(37,99,235,.22),transparent_28%),linear-gradient(135deg,rgba(15,23,42,.88),rgba(2,6,23,.96))]" />
      {selected?.location ? points.map((point) => {
        const style = pointStyle(point.lat, point.lng, points);
        const color = point.type === "sos" ? "bg-red-500 text-red-100 shadow-[0_0_34px_rgba(239,68,68,.85)]" : point.type === "device" ? "bg-sky-500 text-sky-950 shadow-[0_0_20px_rgba(14,165,233,.55)]" : "bg-emerald-500 text-emerald-950 shadow-[0_0_15px_rgba(16,185,129,.45)]";
        return (
          <div key={`${point.type}-${point.id}`} className="absolute z-10 -translate-x-1/2 -translate-y-1/2" style={style}>
            <div className={`relative flex h-10 w-10 items-center justify-center rounded-full border border-white/40 ${color}`}>
              {point.type === "sos" && <span className="absolute -inset-5 animate-ping rounded-full border border-red-400/60" />}
              {point.type === "sos" ? <Siren className="h-5 w-5" /> : point.type === "device" ? <Smartphone className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            </div>
            <div className="mt-2 min-w-28 rounded-md border border-border/50 bg-slate-950/90 px-2 py-1 text-[10px] text-white">{point.label}</div>
          </div>
        );
      }) : (
        <div className="absolute inset-0 flex items-center justify-center p-8 text-center text-sm text-slate-400">
          <div><MapPin className="mx-auto mb-3 h-10 w-10 text-slate-600" />Location unavailable<br />Last known position will appear when the device reports GPS.</div>
        </div>
      )}
      <div className="absolute right-4 top-4 grid gap-2">
        <MapButton label="Zoom in" icon={Plus} /><MapButton label="Zoom out" icon={X} /><MapButton label="Recenter selected alert" icon={Crosshair} onClick={onOpenMap} disabled={!selected?.location} />
      </div>
      {selected && <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-border/70 bg-slate-950/85 p-4">
        <div className="grid gap-3 text-xs text-slate-300 sm:grid-cols-3 xl:grid-cols-5">
          <Detail label="Device" value={selected.deviceName} />
          <Detail label="Guard" value={selected.guardName} />
          <Detail label="Site" value={selected.siteName} />
          <Detail label="GPS" value={selected.location ? `${selected.location.accuracy ?? "?"}m` : "Unavailable"} />
          <Detail label="Updated" value={selected.device?.last_seen_at ? formatDistanceToNowStrict(new Date(selected.device.last_seen_at), { addSuffix: true }) : "Pending"} />
        </div>
      </div>}
    </div>
  </section>
);

const SelectedSosPanel = ({ selected, resolving, onResolve, onCopy, createIncidentHref, onOpenMap }: { selected: DispatchSos | null; resolving: boolean; onResolve: () => void; onCopy: () => void; createIncidentHref: string; onOpenMap: () => void }) => {
  if (!selected) return <section className="rounded-lg border border-border/70 bg-slate-950/70 p-5"><SosEmpty title="Select an SOS alert" description="Select an SOS alert to open the response console." compact /></section>;
  const heartbeat = heartbeatState(selected.device?.last_seen_at ?? selected.device?.current_gps_at);
  return (
    <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm text-slate-400">{alertRef(selected.alert)}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge className={toneClasses[statusTone(selected.status)]}>{selected.status}</Badge>
            <Badge className={toneClasses[selected.alert.severity === "critical" ? "red" : "amber"]}>{selected.alert.severity || "critical"}</Badge>
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="icon" variant="outline" aria-label="Copy alert reference" onClick={onCopy}><Copy className="h-4 w-4" /></Button>
          <Button size="icon" variant="outline" aria-label="Open alert map" onClick={onOpenMap} disabled={!selected.location}><Navigation className="h-4 w-4" /></Button>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-slate-900/45 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-14 w-14 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-200"><Smartphone className="h-7 w-7" /></span>
          <div className="min-w-0">
            <p className="truncate text-lg font-semibold text-white">{selected.deviceName}</p>
            <p className="text-sm text-slate-400">{selected.guardName}</p>
            <Badge className={`mt-2 ${toneClasses[heartbeat.tone]}`}>{heartbeat.label}</Badge>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Detail label="Site" value={selected.siteName} />
          <Detail label="Battery" value={selected.device?.battery_level != null ? `${selected.device.battery_level}%` : "Pending"} />
          <Detail label="Network" value={selected.device?.status || "Unknown"} />
          <Detail label="GPS" value={selected.location ? `${selected.location.accuracy ?? "?"}m` : "Unavailable"} />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-slate-900/45 p-4">
        <h3 className="text-sm font-semibold text-white">Incident Information</h3>
        <div className="mt-4 grid gap-3 text-sm">
          <Detail label="Triggered At" value={`${formatDate(selected.alert.created_at)} ${formatTime(selected.alert.created_at)}`} />
          <Detail label="Location" value={selected.location ? `${selected.location.lat.toFixed(6)}, ${selected.location.lng.toFixed(6)}` : "Location unavailable"} />
          <Detail label="Last Checkpoint" value={selected.lastScan?.checkpoints?.name || selected.lastScan?.tag_uid || "No checkpoint found"} />
          <Detail label="Source" value="Panic button SOS" />
          <p className="rounded-md border border-border/50 bg-slate-950/50 p-3 text-xs leading-5 text-slate-300">{selected.alert.message}</p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border/70 bg-slate-900/45 p-4">
        <h3 className="text-sm font-semibold text-white">Quick Actions</h3>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button size="sm" disabled={selected.status !== "active" || resolving} onClick={onResolve} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"><CheckCircle2 className="mr-2 h-4 w-4" />Acknowledge</Button>
          <Button size="sm" variant="outline" disabled><Radio className="mr-2 h-4 w-4" />Dispatch</Button>
          <Button size="sm" variant="outline" disabled><Phone className="mr-2 h-4 w-4" />Call Guard</Button>
          <Button size="sm" variant="outline" asChild><Link to="/cameras"><Camera className="mr-2 h-4 w-4" />Open Camera</Link></Button>
          <Button size="sm" variant="outline" asChild><Link to={createIncidentHref}><FileText className="mr-2 h-4 w-4" />Create Incident</Link></Button>
          <Button size="sm" variant="destructive" disabled={selected.status !== "active" || resolving} onClick={onResolve}><ShieldAlert className="mr-2 h-4 w-4" />Mark Resolved</Button>
        </div>
      </div>
    </section>
  );
};

const SosTimeline = ({ timeline }: { timeline: Array<{ time: string; title: string; detail: string; tone: Tone; icon: LucideIcon }> }) => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-white">Alert Timeline</h2><Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Live updates</Badge></div>
    <div className="mt-4 space-y-3">
      {timeline.length === 0 ? <p className="text-sm text-slate-400">Select an alert to view timeline events.</p> : timeline.map(({ time, title, detail, tone, icon: Icon }, index) => (
        <div key={`${title}-${time}`} className="flex gap-3">
          <div className="flex flex-col items-center"><span className={`flex h-8 w-8 items-center justify-center rounded-full border ${toneClasses[tone]}`}><Icon className="h-4 w-4" /></span>{index < timeline.length - 1 && <span className="h-8 w-px bg-border" />}</div>
          <div><p className="text-xs text-slate-400">{formatTime(time)}</p><p className="text-sm font-medium text-white">{title}</p><p className="text-xs text-slate-400">{detail}</p></div>
        </div>
      ))}
    </div>
  </section>
);

const NearbyDevices = ({ devices }: { devices: Array<{ device: DeviceRow; heartbeat: { label: string; tone: Tone; ageMs: number }; distance: number | null }> }) => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-white">Nearby Devices</h2><span className="text-xs text-slate-400">{devices.length} in proximity</span></div>
    <div className="mt-4 space-y-2">
      {devices.length === 0 ? <p className="rounded-md border border-dashed border-border/60 p-4 text-sm text-slate-400">No nearby devices with matching company/location data.</p> : devices.map(({ device, heartbeat, distance }) => (
        <div key={device.id} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-slate-900/45 p-3">
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{device.device_name || shortDevice(device.device_identifier)}</p><p className="truncate text-xs text-slate-400">{device.guards?.full_name || device.sites?.name || "Unassigned"}</p></div>
          <div className="text-right"><Badge className={toneClasses[heartbeat.tone]}>{heartbeat.label}</Badge><p className="mt-1 text-xs text-slate-400">{distance == null ? "Distance pending" : `${distance.toFixed(2)} km`}</p></div>
        </div>
      ))}
    </div>
  </section>
);

const NearestResponseUnit = () => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
    <h2 className="font-semibold text-white">Nearest Response Unit</h2>
    <div className="mt-4 rounded-lg border border-dashed border-border/70 p-5 text-sm text-slate-400">
      No response-unit table is configured yet. Dispatch controls are ready for a backend adapter when response units are added.
    </div>
  </section>
);

const IncidentEvidence = ({ evidence }: { evidence: IncidentPhoto[] }) => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
    <div className="flex items-center justify-between"><h2 className="font-semibold text-white">Incident Evidence</h2><span className="text-xs text-slate-400">{evidence.length} items attached</span></div>
    {evidence.length === 0 ? <p className="mt-4 rounded-md border border-dashed border-border/60 p-4 text-sm text-slate-400">No linked SOS evidence photos yet.</p> : (
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {evidence.map((photo) => (
          <div key={photo.id} className="overflow-hidden rounded-lg border border-border/70 bg-slate-900/45">
            {photo.signed_url ? <img src={photo.signed_url} alt="SOS evidence" className="h-32 w-full object-cover" loading="lazy" /> : <div className="flex h-32 items-center justify-center bg-black/30 text-slate-500"><Camera className="h-8 w-8" /></div>}
            <div className="p-3"><p className="truncate text-sm font-medium text-white">{photo.device_identifier}</p><p className="text-xs text-slate-400">{formatDistanceToNowStrict(new Date(photo.captured_at), { addSuffix: true })}</p></div>
          </div>
        ))}
      </div>
    )}
  </section>
);

const SosStats = ({ total, active, resolved }: { total: number; active: number; resolved: number }) => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
    <h2 className="font-semibold text-white">Incident Stats</h2>
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <StatBox label="Total SOS" value={total} tone="blue" />
      <StatBox label="Unresolved" value={active} tone={active ? "red" : "green"} />
      <StatBox label="Resolved" value={resolved} tone="green" />
    </div>
  </section>
);

const StatBox = ({ label, value, tone }: { label: string; value: string | number; tone: Tone }) => (
  <div className={`rounded-lg border p-4 ${toneClasses[tone]}`}><p className="text-xs uppercase tracking-[0.14em] text-slate-400">{label}</p><p className="mt-2 text-2xl font-bold text-white">{value}</p></div>
);

const Detail = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border border-border/50 bg-slate-950/50 p-3">
    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm text-slate-100">{value}</p>
  </div>
);

const LegendDot = ({ tone, label }: { tone: Tone; label: string }) => (
  <span className="inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : tone === "green" ? "bg-emerald-400" : "bg-sky-400"}`} />{label}</span>
);

const MapButton = ({ label, icon: Icon, onClick, disabled }: { label: string; icon: LucideIcon; onClick?: () => void; disabled?: boolean }) => (
  <Button size="icon" variant="outline" aria-label={label} onClick={onClick} disabled={disabled} className="bg-slate-950/80"><Icon className="h-4 w-4" /></Button>
);

const SosSkeleton = () => (
  <div className="space-y-5">
    <div className="h-24 animate-pulse rounded-lg border border-border/70 bg-slate-950/70" />
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-32 animate-pulse rounded-lg border border-border/70 bg-slate-950/70" />)}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(280px,0.85fr)_minmax(520px,1.8fr)_minmax(330px,1fr)]"><div className="h-[560px] animate-pulse rounded-lg border border-border/70 bg-slate-950/70" /><div className="h-[560px] animate-pulse rounded-lg border border-border/70 bg-slate-950/70" /><div className="h-[560px] animate-pulse rounded-lg border border-border/70 bg-slate-950/70" /></div>
  </div>
);

const SosEmpty = ({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) => (
  <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-slate-950/45 text-center ${compact ? "p-5" : "min-h-[320px] p-10"}`}>
    <ShieldAlert className="h-10 w-10 text-slate-500" />
    <h3 className="mt-4 font-semibold text-white">{title}</h3>
    <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>
  </div>
);

export default SosAlerts;
