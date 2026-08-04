import { useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Clock,
  Edit,
  Eye,
  FileText,
  Filter,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Paperclip,
  Plus,
  Radio,
  RefreshCw,
  Search,
  ShieldAlert,
  Siren,
  Smartphone,
  UserCheck,
  X,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format, formatDistanceToNowStrict } from "date-fns";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/contexts/AuthContext";
import { useIncidents } from "@/hooks/useDashboardData";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { useUserRole } from "@/hooks/useUserRole";
import { useSites, type Site } from "@/hooks/useSites";
import { supabase } from "@/integrations/supabase/client";

type IncidentRow = {
  id: string;
  company_id: string;
  title: string;
  description: string | null;
  severity: "low" | "medium" | "high" | "critical";
  resolved: boolean | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
  guard_id: string | null;
  location_lat: number | null;
  location_lng: number | null;
  ai_classification?: string | null;
  ai_suggested_action?: string | null;
  guards?: { full_name: string | null; badge_number: string | null } | null;
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

type IncidentSosAlert = { id: string; message: string; severity: string | null; created_at: string; companies?: { name: string | null } | null };
type EvidenceImage = { storage_path: string; signed_url?: string };
type FormState = { title: string; description: string; severity: string; site_id: string };

const severityStyles = {
  critical: { badge: "border-red-500/50 bg-red-500/15 text-red-200", label: "Critical", rail: "border-l-red-400" },
  high: { badge: "border-red-500/50 bg-red-500/15 text-red-200", label: "High", rail: "border-l-red-400" },
  medium: { badge: "border-amber-500/50 bg-amber-500/15 text-amber-200", label: "Medium", rail: "border-l-amber-400" },
  low: { badge: "border-sky-500/50 bg-sky-500/15 text-sky-200", label: "Low", rail: "border-l-sky-400" },
};

const extractField = (text: string | null | undefined, label: string) => {
  if (!text) return null;
  const lower = label.toLowerCase();
  const inline = text
    .split("|")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${lower}:`) || part.toLowerCase().startsWith(`${lower}=`));
  if (inline) return inline.slice(inline.includes("=") ? inline.indexOf("=") + 1 : inline.indexOf(":") + 1).trim();
  const line = text
    .split("\n")
    .map((part) => part.trim())
    .find((part) => part.toLowerCase().startsWith(`${lower}:`));
  return line ? line.slice(line.indexOf(":") + 1).trim() : null;
};

const evidencePaths = (description?: string | null) =>
  (description || "")
    .split("\n")
    .map((line) => line.split("|").pop()?.trim() || "")
    .filter((value) => /\.(jpe?g|png|webp)$/i.test(value));

const siteNameFor = (incident: IncidentRow | null, sites: Site[]) =>
  incident
    ? extractField(incident.description, "Reporting site") ||
      extractField(incident.description, "Site") ||
      sites.find((site) => site.gps_lat === incident.location_lat && site.gps_lng === incident.location_lng)?.name ||
      "Unassigned site"
    : "Unassigned site";

const incidentType = (incident: IncidentRow) => {
  const text = `${incident.title} ${incident.description ?? ""}`.toLowerCase();
  if (text.includes("sos") || text.includes("panic")) return "SOS";
  if (text.includes("photo")) return "Evidence";
  if (text.includes("checkpoint")) return "Checkpoint";
  if (text.includes("battery") || text.includes("device")) return "Device";
  if (incident.ai_classification) return "AI";
  return "Manual";
};

const incidentSource = (incident: IncidentRow) =>
  ({ SOS: "SOS panic alert", Evidence: "RG360 photo evidence", Checkpoint: "Checkpoint event", Device: "Device alert", AI: "AI/anomaly", Manual: "Manual report" }[
    incidentType(incident)
  ] || "Manual report");
const incidentNo = (incident: IncidentRow) => `INC-${incident.id.slice(0, 6).toUpperCase()}`;

const KpiCard = ({ title, value, caption, tone, icon: Icon }: { title: string; value: string | number; caption: string; tone: "green" | "red" | "amber" | "blue"; icon: LucideIcon }) => {
  const iconTone = { green: "border-emerald-500/25 bg-emerald-500/10 text-emerald-300", red: "border-red-500/25 bg-red-500/10 text-red-300", amber: "border-amber-500/25 bg-amber-500/10 text-amber-300", blue: "border-sky-500/25 bg-sky-500/10 text-sky-300" }[tone];
  const textTone = { green: "text-emerald-300", red: "text-red-300", amber: "text-amber-300", blue: "text-sky-300" }[tone];
  return (
    <div className="min-h-[128px] rounded-lg border border-border/60 bg-slate-950/70 p-5">
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">{title}</p>
          <p className="mt-3 text-3xl font-bold leading-none text-white">{value}</p>
          <p className={`mt-3 text-sm font-medium ${textTone}`}>{caption}</p>
        </div>
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full border ${iconTone}`}>
          <Icon className="h-5 w-5" />
        </span>
      </div>
    </div>
  );
};

const DetailBlock = ({ label, value }: { label: string; value: string }) => (
  <div className="min-w-0">
    <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p>
    <p className="mt-1 truncate text-sm leading-6 text-slate-100">{value || "-"}</p>
  </div>
);

const Incidents = () => {
  const queryClient = useQueryClient();
  const realtime = useRealtimeConnectionStatus("incidents-live");
  const { user } = useAuth();
  const { canManage } = useUserRole();
  const { data: rawIncidents = [], isLoading, error } = useIncidents();
  const { data: sites = [] } = useSites();
  const incidents = rawIncidents as unknown as IncidentRow[];

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [siteFilter, setSiteFilter] = useState("all");
  const [severityFilter, setSeverityFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [photoFilter, setPhotoFilter] = useState("all");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [incidentPhotos, setIncidentPhotos] = useState<IncidentPhoto[]>([]);
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [viewerPhoto, setViewerPhoto] = useState<IncidentPhoto | null>(null);
  const [viewerUrl, setViewerUrl] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [sosAlerts, setSosAlerts] = useState<IncidentSosAlert[]>([]);
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<string[]>([]);
  const [selectedSosAlertIds, setSelectedSosAlertIds] = useState<string[]>([]);
  const [detailEvidence, setDetailEvidence] = useState<EvidenceImage[]>([]);
  const [form, setForm] = useState<FormState>({ title: "", description: "", severity: "medium", site_id: "" });

  const loadIncidentPhotos = useCallback(async () => {
    setLoadingPhotos(true);
    setPhotoError(null);
    try {
      const { data, error: photoQueryError } = await supabase
        .from("incident_report_photos" as never)
        .select("id, site_id, device_identifier, storage_path, captured_at, gps_lat, gps_lng")
        .order("captured_at", { ascending: false })
        .limit(30);
      if (photoQueryError) throw photoQueryError;
      const rows = (data ?? []) as unknown as IncidentPhoto[];
      const signed = await Promise.all(
        rows.map(async (photo) => {
          const { data: signedData } = await supabase.storage.from("incident-reports").createSignedUrl(photo.storage_path, 60 * 20);
          return { ...photo, signed_url: signedData?.signedUrl };
        }),
      );
      setIncidentPhotos(signed);
    } catch (err) {
      console.error("[Incidents] evidence photo load failed", err);
      setPhotoError("Could not load evidence photos");
    } finally {
      setLoadingPhotos(false);
    }
  }, []);

  const loadSosAlerts = useCallback(async () => {
    const { data, error: alertError } = await supabase
      .from("alerts")
      .select("id, message, severity, created_at, companies(name)")
      .eq("type", "panic_button")
      .order("created_at", { ascending: false })
      .limit(12);
    if (alertError) {
      console.error("[Incidents] SOS alert load failed", alertError);
      return;
    }
    const rows = (data ?? []) as unknown as IncidentSosAlert[];
    setSosAlerts(rows);
    setSelectedSosAlertIds((ids) => ids.filter((id) => rows.some((alert) => alert.id === id)));
  }, []);

  useEffect(() => {
    void loadIncidentPhotos();
    void loadSosAlerts();
    const channel = supabase
      .channel("incident-management-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, () => queryClient.invalidateQueries({ queryKey: ["incidents"] }))
      .on("postgres_changes", { event: "*", schema: "public", table: "incident_report_photos" }, () => void loadIncidentPhotos())
      .on("postgres_changes", { event: "*", schema: "public", table: "alerts" }, () => void loadSosAlerts())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadIncidentPhotos, loadSosAlerts, queryClient]);

  const filteredIncidentPhotos = useMemo(() => {
    if (photoFilter === "all") return incidentPhotos;
    return incidentPhotos.filter((photo) => photo.site_id === photoFilter);
  }, [incidentPhotos, photoFilter]);

  const filteredIncidents = useMemo(() => {
    const term = search.trim().toLowerCase();
    return incidents.filter((incident) => {
      const status = incident.resolved ? "resolved" : "open";
      const type = incidentType(incident).toLowerCase();
      const siteName = siteNameFor(incident, sites);
      const haystack = `${incident.title} ${incident.description ?? ""} ${siteName} ${incident.guards?.full_name ?? ""}`.toLowerCase();
      return (
        (!term || haystack.includes(term)) &&
        (statusFilter === "all" || statusFilter === status) &&
        (severityFilter === "all" || severityFilter === incident.severity) &&
        (typeFilter === "all" || typeFilter === type) &&
        (siteFilter === "all" || siteName === siteFilter)
      );
    });
  }, [incidents, search, severityFilter, siteFilter, sites, statusFilter, typeFilter]);

  const selected = useMemo(() => filteredIncidents.find((incident) => incident.id === selectedId) ?? filteredIncidents[0] ?? null, [filteredIncidents, selectedId]);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
    if (!selected && selectedId) setSelectedId(null);
  }, [selected, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!selected) {
        setDetailEvidence([]);
        return;
      }
      const paths = evidencePaths(selected.description);
      const signed = await Promise.all(
        paths.map(async (path) => {
          const { data } = await supabase.storage.from("incident-reports").createSignedUrl(path, 60 * 20);
          return { storage_path: path, signed_url: data?.signedUrl };
        }),
      );
      if (!cancelled) setDetailEvidence(signed);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const stats = useMemo(() => {
    const open = incidents.filter((incident) => !incident.resolved).length;
    const highPriority = incidents.filter((incident) => !incident.resolved && ["critical", "high"].includes(incident.severity)).length;
    const resolved = incidents.filter((incident) => incident.resolved).length;
    const evidenceCount = incidents.reduce((total, incident) => total + evidencePaths(incident.description).length, 0) + incidentPhotos.length;
    const sosCount = incidents.filter((incident) => incidentType(incident) === "SOS" && !incident.resolved).length;
    return { total: incidents.length, open, highPriority, resolved, evidenceCount, sosCount };
  }, [incidents, incidentPhotos.length]);

  const selectedSiteName = siteNameFor(selected, sites);
  const selectedEvidencePaths = selected ? evidencePaths(selected.description) : [];
  const timeline = selected
    ? [
        { label: "Incident reported", time: selected.created_at, tone: selected.severity === "low" ? "blue" : selected.severity === "medium" ? "amber" : "red" },
        { label: selected.location_lat && selected.location_lng ? "Location captured" : "Location pending", time: selected.created_at, tone: selected.location_lat && selected.location_lng ? "green" : "amber" },
        { label: selectedEvidencePaths.length ? `${selectedEvidencePaths.length} evidence item attached` : "Awaiting evidence", time: selected.updated_at, tone: selectedEvidencePaths.length ? "blue" : "slate" },
        { label: selected.resolved ? "Incident resolved" : "Open for supervisor action", time: selected.resolved_at ?? selected.updated_at, tone: selected.resolved ? "green" : "amber" },
      ]
    : [];

  const resetForm = () => {
    setForm({ title: "", description: "", severity: "medium", site_id: "" });
    setSelectedPhotoIds([]);
    setSelectedSosAlertIds([]);
  };

  const resetFilters = () => {
    setSearch("");
    setSiteFilter("all");
    setSeverityFilter("all");
    setStatusFilter("all");
    setTypeFilter("all");
  };

  const chooseSosAlert = useCallback((alertId: string) => {
    setSelectedSosAlertIds((current) => (current.includes(alertId) ? current.filter((id) => id !== alertId) : [...current, alertId]));
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sosAlertId = params.get("sosAlert");
    if (!sosAlertId) return;
    const raw = sessionStorage.getItem("mxpatrol_sos_alert_context");
    const context = raw ? JSON.parse(raw) as { title?: string; description?: string; severity?: string; siteName?: string } : {};
    const targetSite = sites.find((site) => site.name === context.siteName);
    setForm({ title: context.title || "SOS panic incident", description: context.description || "Created from SOS panic alert.", severity: context.severity || "critical", site_id: targetSite?.id || "" });
    setSelectedSosAlertIds([sosAlertId]);
    setIsCreateOpen(true);
  }, [sites]);

  const uploadEvidencePhoto = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const ext = file.name.split(".").pop() || "jpg";
    const path = `manual/${user?.id ?? "unknown"}/${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage.from("incident-reports").upload(path, file, { upsert: false, contentType: file.type });
    if (uploadError) {
      toast.error(uploadError.message || "Could not upload evidence photo");
      return;
    }
    setForm((current) => ({ ...current, description: `${current.description}\nEvidence photo | ${path}`.trim() }));
    toast.success("Evidence photo attached");
  };

  const viewPhoto = async (photo: IncidentPhoto) => {
    setViewerPhoto(photo);
    setViewerUrl(photo.signed_url ?? null);
    setViewerLoading(!photo.signed_url);
    if (photo.signed_url) return;
    const { data, error: signedError } = await supabase.storage.from("incident-reports").createSignedUrl(photo.storage_path, 60 * 20);
    if (signedError || !data?.signedUrl) {
      toast.error("Could not open evidence photo");
      setViewerLoading(false);
      return;
    }
    setViewerUrl(data.signedUrl);
    setViewerLoading(false);
  };

  const openIncidentFromPhoto = (photo: IncidentPhoto) => {
    const site = sites.find((item) => item.id === photo.site_id);
    setForm({
      title: `RG360 photo evidence - ${photo.device_identifier}`,
      description: `Incident created from RG360 photo.\nReporting site: ${site?.name ?? "Unassigned site"}\nDevice: ${photo.device_identifier}\nCaptured: ${format(new Date(photo.captured_at), "PPpp")}\nEvidence photo | ${photo.storage_path}`,
      severity: "medium",
      site_id: photo.site_id ?? "",
    });
    setSelectedPhotoIds([photo.id]);
    setIsCreateOpen(true);
  };

  const createIncident = async () => {
    if (!form.title.trim()) {
      toast.error("Incident title is required");
      return;
    }
    setIsSubmitting(true);
    try {
      const selectedSite = sites.find((site) => site.id === form.site_id);
      const selectedPhotoNotes = incidentPhotos.filter((photo) => selectedPhotoIds.includes(photo.id)).map((photo) => `Evidence photo | ${photo.storage_path}`);
      const selectedSosNotes = sosAlerts.filter((alert) => selectedSosAlertIds.includes(alert.id)).map((alert) => `SOS alert | ${alert.id} | ${alert.message}`);
      const description = [form.description.trim(), selectedSite ? `Reporting site: ${selectedSite.name}` : "", ...selectedPhotoNotes, ...selectedSosNotes].filter(Boolean).join("\n");
      const { error: insertError } = await supabase.from("incidents").insert({
        title: form.title.trim(),
        description,
        severity: form.severity,
        location_lat: selectedSite?.gps_lat ?? null,
        location_lng: selectedSite?.gps_lng ?? null,
      });
      if (insertError) throw insertError;
      toast.success("Incident created");
      resetForm();
      setIsCreateOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["incidents"] });
    } catch (err) {
      console.error("[Incidents] create failed", err);
      toast.error((err as Error)?.message || "Could not create incident");
    } finally {
      setIsSubmitting(false);
    }
  };

  const resolveIncident = async (incident: IncidentRow) => {
    const { error: updateError } = await supabase.from("incidents").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", incident.id);
    if (updateError) {
      toast.error(updateError.message || "Could not resolve incident");
      return;
    }
    toast.success("Incident resolved");
    await queryClient.invalidateQueries({ queryKey: ["incidents"] });
  };

  const reopenIncident = async (incident: IncidentRow) => {
    const { error: updateError } = await supabase.from("incidents").update({ resolved: false, resolved_at: null }).eq("id", incident.id);
    if (updateError) {
      toast.error(updateError.message || "Could not reopen incident");
      return;
    }
    toast.success("Incident reopened");
    await queryClient.invalidateQueries({ queryKey: ["incidents"] });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-tight text-white">Incidents</h1>
            <Badge className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              <span className="mr-1.5 h-2 w-2 rounded-full bg-emerald-400" /> {realtimeStatusLabel(realtime.status)}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-400">Monitor, triage and resolve operational security incidents.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => { void queryClient.invalidateQueries({ queryKey: ["incidents"] }); void loadIncidentPhotos(); void loadSosAlerts(); }}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={(open) => { setIsCreateOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="bg-emerald-500 text-slate-950 hover:bg-emerald-400" disabled={!canManage}>
                <Plus className="mr-2 h-4 w-4" /> New Incident
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-border/70 bg-slate-950 text-white">
              <DialogHeader>
                <DialogTitle>Create Incident Report</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="incident-title">Title</Label>
                  <Input id="incident-title" value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder="e.g. Unauthorized access attempt" />
                </div>
                <div className="space-y-2">
                  <Label>Severity</Label>
                  <Select value={form.severity} onValueChange={(value) => setForm((current) => ({ ...current, severity: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="medium">Medium</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                      <SelectItem value="critical">Critical</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Reporting Site</Label>
                  <Select value={form.site_id || "none"} onValueChange={(value) => setForm((current) => ({ ...current, site_id: value === "none" ? "" : value }))}>
                    <SelectTrigger><SelectValue placeholder="Select site" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Unassigned</SelectItem>
                      {sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Description</Label>
                  <Textarea value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder="What happened, where, and what action was taken?" className="min-h-[120px]" />
                </div>
                <div className="rounded-lg border border-border/70 bg-slate-900/40 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">Evidence Photos</p>
                      <p className="text-xs text-slate-400">Upload or attach available RG360 captures.</p>
                    </div>
                    <Label className="inline-flex cursor-pointer items-center rounded-md border border-sky-500/30 px-3 py-2 text-sm text-sky-200 hover:bg-sky-500/10">
                      <Paperclip className="mr-2 h-4 w-4" /> Upload
                      <Input type="file" accept="image/*" className="hidden" onChange={uploadEvidencePhoto} />
                    </Label>
                  </div>
                  <ChooserGrid photos={filteredIncidentPhotos.slice(0, 6)} selectedIds={selectedPhotoIds} onToggle={(id) => setSelectedPhotoIds((ids) => ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id])} onView={viewPhoto} />
                </div>
                <div className="rounded-lg border border-border/70 bg-slate-900/40 p-4">
                  <p className="font-semibold text-white">Available SOS Alerts</p>
                  <p className="text-xs text-slate-400">Attach panic alerts that belong to this incident.</p>
                  <SosChooser alerts={sosAlerts} selectedIds={selectedSosAlertIds} onToggle={chooseSosAlert} />
                </div>
                <div className="flex justify-end gap-3 md:col-span-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button onClick={createIncident} disabled={isSubmitting || !canManage} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400">
                    {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <ShieldAlert className="mr-2 h-4 w-4" />} Create Incident
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </header>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <KpiCard title="Total Incidents" value={stats.total} caption="All recorded" tone="blue" icon={FileText} />
        <KpiCard title="Open" value={stats.open} caption="Requires attention" tone={stats.open ? "red" : "green"} icon={AlertTriangle} />
        <KpiCard title="High Priority" value={stats.highPriority} caption="Critical or high" tone={stats.highPriority ? "red" : "green"} icon={ShieldAlert} />
        <KpiCard title="Resolved" value={stats.resolved} caption="Closed incidents" tone="green" icon={CheckCircle2} />
        <KpiCard title="SOS Linked" value={stats.sosCount} caption="Active panic cases" tone={stats.sosCount ? "red" : "green"} icon={Siren} />
        <KpiCard title="Evidence" value={stats.evidenceCount} caption="Photos attached" tone="blue" icon={Camera} />
      </section>

      <section className="rounded-lg border border-border/70 bg-slate-950/70 p-4">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(260px,1.5fr)_repeat(4,minmax(150px,1fr))_auto]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search incidents, sites, devices..." className="pl-9" />
          </div>
          <Select value={siteFilter} onValueChange={setSiteFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Sites</SelectItem>{sites.map((site) => <SelectItem key={site.id} value={site.name}>{site.name}</SelectItem>)}</SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Types</SelectItem><SelectItem value="sos">SOS</SelectItem><SelectItem value="evidence">Evidence</SelectItem><SelectItem value="checkpoint">Checkpoint</SelectItem><SelectItem value="device">Device</SelectItem><SelectItem value="manual">Manual</SelectItem></SelectContent>
          </Select>
          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Priority</SelectItem><SelectItem value="critical">Critical</SelectItem><SelectItem value="high">High</SelectItem><SelectItem value="medium">Medium</SelectItem><SelectItem value="low">Low</SelectItem></SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="all">All Status</SelectItem><SelectItem value="open">Open</SelectItem><SelectItem value="resolved">Resolved</SelectItem></SelectContent>
          </Select>
          <Button variant="outline" onClick={resetFilters}><Filter className="mr-2 h-4 w-4" /> Clear</Button>
        </div>
      </section>

      {isLoading ? <IncidentSkeleton /> : error ? <IncidentEmptyState title="Incidents could not load" description={(error as Error)?.message || "Refresh and try again."} /> : incidents.length === 0 ? <IncidentEmptyState title="No incidents yet" description="New reports, SOS alerts and RG360 photo evidence will appear here." /> : (
        <section className="grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
          <aside className="rounded-lg border border-border/70 bg-slate-950/70">
            <div className="sticky top-0 z-10 border-b border-border/70 bg-slate-950/95 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-white">Incident Queue</h2>
                  <p className="text-xs text-slate-400">{filteredIncidents.length} matching records</p>
                </div>
                <Badge variant="outline" className="border-slate-700 text-slate-300">Newest first</Badge>
              </div>
            </div>
            <div className="max-h-[720px] space-y-2 overflow-y-auto p-3">
              {filteredIncidents.length === 0 ? <IncidentEmptyState title="No matching incidents" description="Adjust filters to widen the queue." compact /> : filteredIncidents.map((incident) => (
                <IncidentQueueItem key={incident.id} incident={incident} active={selected?.id === incident.id} siteName={siteNameFor(incident, sites)} onClick={() => setSelectedId(incident.id)} />
              ))}
            </div>
          </aside>

          <main className="min-w-0 rounded-lg border border-border/70 bg-slate-950/70">
            {!selected ? <IncidentEmptyState title="Select an incident" description="Choose an item from the queue to inspect the full record." /> : (
              <>
                <div className={`border-l-4 ${severityStyles[selected.severity].rail} border-b border-border/70 p-5`}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-mono text-slate-400">{incidentNo(selected)}</span>
                        <Badge className={severityStyles[selected.severity].badge}>{severityStyles[selected.severity].label}</Badge>
                        <Badge className={selected.resolved ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200" : "border-red-500/40 bg-red-500/10 text-red-200"}>{selected.resolved ? "Resolved" : "Open"}</Badge>
                      </div>
                      <h2 className="mt-2 text-2xl font-semibold text-white">{selected.title}</h2>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-400"><MapPin className="h-4 w-4" /> {selectedSiteName} <span>-</span> {format(new Date(selected.created_at), "PPpp")}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {selected.resolved ? <Button variant="outline" onClick={() => void reopenIncident(selected)} disabled={!canManage}>Reopen Incident</Button> : <Button onClick={() => void resolveIncident(selected)} disabled={!canManage} className="bg-emerald-500 text-slate-950 hover:bg-emerald-400"><CheckCircle2 className="mr-2 h-4 w-4" /> Resolve Incident</Button>}
                      <Button variant="outline" onClick={() => setIsCreateOpen(true)} disabled={!canManage}><Paperclip className="mr-2 h-4 w-4" /> Add Evidence</Button>
                      <Button variant="outline" disabled><Edit className="mr-2 h-4 w-4" /> Edit</Button>
                    </div>
                  </div>
                </div>

                <Tabs defaultValue="overview" className="p-5">
                  <TabsList className="grid w-full grid-cols-5 bg-slate-900/70">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="timeline">Timeline</TabsTrigger>
                    <TabsTrigger value="evidence">Evidence ({detailEvidence.length})</TabsTrigger>
                    <TabsTrigger value="linked">Linked</TabsTrigger>
                    <TabsTrigger value="notes">Notes</TabsTrigger>
                  </TabsList>
                  <TabsContent value="overview" className="mt-5 space-y-5">
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.9fr)]">
                      <IncidentDetails incident={selected} siteName={selectedSiteName} />
                      <TimelinePanel timeline={timeline} />
                    </div>
                    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
                      <IncidentMap incident={selected} siteName={selectedSiteName} />
                      <LinkedRecords incident={selected} siteName={selectedSiteName} />
                    </div>
                    <EvidencePanel evidence={detailEvidence} photos={filteredIncidentPhotos} onView={viewPhoto} onOpenIncident={openIncidentFromPhoto} />
                  </TabsContent>
                  <TabsContent value="timeline" className="mt-5"><TimelinePanel timeline={timeline} expanded /></TabsContent>
                  <TabsContent value="evidence" className="mt-5"><EvidencePanel evidence={detailEvidence} photos={filteredIncidentPhotos} onView={viewPhoto} onOpenIncident={openIncidentFromPhoto} expanded /></TabsContent>
                  <TabsContent value="linked" className="mt-5"><LinkedRecords incident={selected} siteName={selectedSiteName} expanded /></TabsContent>
                  <TabsContent value="notes" className="mt-5"><SummarySection title="Operational Notes"><p className="whitespace-pre-wrap text-sm leading-7 text-slate-300">{selected.description || "No notes have been added yet."}</p></SummarySection></TabsContent>
                </Tabs>
              </>
            )}
          </main>
        </section>
      )}

      <PhotoPanel photos={filteredIncidentPhotos} loading={loadingPhotos} error={photoError} photoFilter={photoFilter} setPhotoFilter={setPhotoFilter} sites={sites} onView={viewPhoto} onOpenIncident={openIncidentFromPhoto} />

      <Dialog open={!!viewerPhoto} onOpenChange={(open) => { if (!open) { setViewerPhoto(null); setViewerUrl(null); } }}>
        <DialogContent className="max-w-3xl border-border/70 bg-slate-950 text-white">
          <DialogHeader><DialogTitle>Evidence Photo</DialogTitle></DialogHeader>
          <div className="overflow-hidden rounded-lg border border-border/70 bg-black/40">
            {viewerLoading ? <div className="flex h-[420px] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-sky-300" /></div> : viewerUrl ? <img src={viewerUrl} alt="Incident evidence" className="max-h-[70vh] w-full object-contain" /> : <div className="p-8 text-center text-slate-400">Photo unavailable</div>}
          </div>
          {viewerPhoto && <p className="text-sm text-slate-400">{viewerPhoto.device_identifier} - {format(new Date(viewerPhoto.captured_at), "PPpp")}</p>}
        </DialogContent>
      </Dialog>
    </div>
  );
};

const IncidentQueueItem = ({ incident, active, siteName, onClick }: { incident: IncidentRow; active: boolean; siteName: string; onClick: () => void }) => {
  const style = severityStyles[incident.severity];
  return (
    <button type="button" onClick={onClick} className={`w-full rounded-lg border p-4 text-left transition ${active ? "border-emerald-500/50 bg-emerald-500/10" : "border-border/60 bg-slate-900/45 hover:border-slate-600"}`}>
      <div className="flex items-start gap-3">
        <span className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${incident.resolved ? "bg-emerald-500/10 text-emerald-300" : "bg-red-500/10 text-red-300"}`}>
          {incident.resolved ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-semibold text-white">{incidentNo(incident)}</p>
            <span className="shrink-0 text-xs text-slate-400">{format(new Date(incident.created_at), "HH:mm")}</span>
          </div>
          <p className="mt-1 truncate text-sm text-slate-200">{incident.title}</p>
          <p className="mt-1 truncate text-xs text-slate-400">{siteName}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <Badge className={style.badge}>{style.label}</Badge>
            <span className={incident.resolved ? "text-xs text-emerald-300" : "text-xs text-red-300"}>{incident.resolved ? "Resolved" : "Open"}</span>
          </div>
        </div>
      </div>
    </button>
  );
};

const IncidentSkeleton = () => (
  <div className="grid gap-5 xl:grid-cols-[350px_minmax(0,1fr)]">
    <div className="h-[560px] animate-pulse rounded-lg border border-border/70 bg-slate-950/70" />
    <div className="h-[560px] animate-pulse rounded-lg border border-border/70 bg-slate-950/70" />
  </div>
);

const IncidentEmptyState = ({ title, description, compact = false }: { title: string; description: string; compact?: boolean }) => (
  <div className={`flex flex-col items-center justify-center rounded-lg border border-dashed border-border/70 bg-slate-950/45 text-center ${compact ? "p-6" : "min-h-[320px] p-10"}`}>
    <ShieldAlert className="h-10 w-10 text-slate-500" />
    <h3 className="mt-4 font-semibold text-white">{title}</h3>
    <p className="mt-2 max-w-md text-sm text-slate-400">{description}</p>
  </div>
);

const SummarySection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="rounded-lg border border-border/70 bg-slate-900/45 p-4">
    <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-300">{title}</h3>
    <div className="mt-4">{children}</div>
  </section>
);

const IncidentDetails = ({ incident, siteName }: { incident: IncidentRow; siteName: string }) => (
  <SummarySection title="Incident Details">
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      <DetailBlock label="Incident Type" value={incidentType(incident)} />
      <DetailBlock label="Reported By" value={incident.guards?.full_name || incidentSource(incident)} />
      <DetailBlock label="Reported At" value={format(new Date(incident.created_at), "PPp")} />
      <DetailBlock label="Reporting Site" value={siteName} />
      <DetailBlock label="Priority" value={severityStyles[incident.severity].label} />
      <DetailBlock label="Status" value={incident.resolved ? "Resolved" : "Open"} />
      <DetailBlock label="GPS" value={incident.location_lat && incident.location_lng ? `${incident.location_lat.toFixed(6)}, ${incident.location_lng.toFixed(6)}` : "Not captured"} />
      <DetailBlock label="AI Classification" value={incident.ai_classification || "Not classified"} />
      <DetailBlock label="Suggested Action" value={incident.ai_suggested_action || "Supervisor review"} />
    </div>
    <div className="mt-5 rounded-md border border-border/60 bg-black/20 p-4">
      <p className="text-sm leading-7 text-slate-300">{incident.description || "No description was provided for this incident."}</p>
    </div>
  </SummarySection>
);

const IncidentMap = ({ incident, siteName }: { incident: IncidentRow; siteName: string }) => (
  <SummarySection title="Incident Location">
    <div className="relative min-h-[280px] overflow-hidden rounded-lg border border-border/60 bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.22),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.95),rgba(2,6,23,0.95))]">
      <div className="absolute inset-0 opacity-30" style={{ backgroundImage: "linear-gradient(rgba(148,163,184,.12) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.12) 1px, transparent 1px)", backgroundSize: "42px 42px" }} />
      <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-red-400/70 bg-red-500/15 text-red-200 shadow-[0_0_40px_rgba(239,68,68,0.25)]">
        <Siren className="h-9 w-9" />
      </div>
      <div className="absolute right-4 top-4 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs text-emerald-300">Live</div>
      <div className="absolute bottom-4 left-4 right-4 rounded-lg border border-border/70 bg-slate-950/80 p-3">
        <p className="font-semibold text-white">{siteName}</p>
        <p className="text-sm text-slate-400">{incident.location_lat && incident.location_lng ? `${incident.location_lat.toFixed(6)}, ${incident.location_lng.toFixed(6)}` : "GPS coordinates not available"}</p>
      </div>
    </div>
  </SummarySection>
);

const TimelinePanel = ({ timeline, expanded = false }: { timeline: { label: string; time: string; tone: string }[]; expanded?: boolean }) => (
  <SummarySection title="Incident Timeline">
    <div className={expanded ? "grid gap-3 md:grid-cols-2" : "space-y-3"}>
      {timeline.map((item) => (
        <div key={`${item.label}-${item.time}`} className="flex gap-3 rounded-lg border border-border/60 bg-slate-950/40 p-3">
          <span className={`mt-1 h-3 w-3 shrink-0 rounded-full ${item.tone === "green" ? "bg-emerald-400" : item.tone === "red" ? "bg-red-400" : item.tone === "blue" ? "bg-sky-400" : item.tone === "amber" ? "bg-amber-400" : "bg-slate-500"}`} />
          <div className="min-w-0">
            <p className="text-sm font-medium text-white">{item.label}</p>
            <p className="text-xs text-slate-400">{format(new Date(item.time), "PPp")}</p>
          </div>
        </div>
      ))}
    </div>
  </SummarySection>
);

const EvidencePanel = ({ evidence, photos, onView, onOpenIncident, expanded = false }: { evidence: EvidenceImage[]; photos: IncidentPhoto[]; onView: (photo: IncidentPhoto) => void; onOpenIncident: (photo: IncidentPhoto) => void; expanded?: boolean }) => (
  <SummarySection title={expanded ? "Evidence Library" : "Evidence Preview"}>
    {evidence.length === 0 && photos.length === 0 ? <p className="text-sm text-slate-400">No evidence photos have been attached yet.</p> : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {evidence.map((item) => <div key={item.storage_path} className="overflow-hidden rounded-lg border border-border/70 bg-slate-950/50">{item.signed_url ? <img src={item.signed_url} alt="Attached evidence" className="h-36 w-full object-cover" loading="lazy" /> : <div className="flex h-36 items-center justify-center text-slate-500"><ImageIcon className="h-8 w-8" /></div>}<p className="truncate p-3 text-xs text-slate-400">{item.storage_path}</p></div>)}
        {photos.slice(0, expanded ? 12 : 3).map((photo) => <PhotoCard key={photo.id} photo={photo} onView={onView} onOpenIncident={onOpenIncident} />)}
      </div>
    )}
  </SummarySection>
);

const PhotoCard = ({ photo, onView, onOpenIncident }: { photo: IncidentPhoto; onView: (photo: IncidentPhoto) => void; onOpenIncident: (photo: IncidentPhoto) => void }) => (
  <div className="overflow-hidden rounded-lg border border-border/70 bg-slate-950/50">
    <button type="button" className="block h-36 w-full bg-black/30" onClick={() => onView(photo)}>
      {photo.signed_url ? <img src={photo.signed_url} alt="RG360 evidence" className="h-full w-full object-cover" loading="lazy" /> : <span className="flex h-full items-center justify-center text-slate-500"><ImageIcon className="h-8 w-8" /></span>}
    </button>
    <div className="space-y-3 p-3">
      <p className="truncate text-sm font-medium text-white">{photo.device_identifier}</p>
      <p className="text-xs text-slate-400">{formatDistanceToNowStrict(new Date(photo.captured_at), { addSuffix: true })}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" size="sm" onClick={() => onView(photo)}><Eye className="mr-1 h-3 w-3" /> View</Button>
        <Button variant="outline" size="sm" onClick={() => onOpenIncident(photo)}><Plus className="mr-1 h-3 w-3" /> Open</Button>
      </div>
    </div>
  </div>
);

const LinkedRecords = ({ incident, siteName, expanded = false }: { incident: IncidentRow; siteName: string; expanded?: boolean }) => {
  const records = [
    { icon: MapPin, label: "Reporting Site", value: siteName, status: "Active" },
    { icon: Smartphone, label: "Source", value: incidentSource(incident), status: incident.resolved ? "Closed" : "Live" },
    { icon: UserCheck, label: "Assigned Guard", value: incident.guards?.full_name || "Supervisor queue", status: incident.guards?.badge_number || "Unassigned" },
    { icon: FileText, label: "Incident Record", value: incidentNo(incident), status: incident.resolved ? "Resolved" : "Open" },
  ];
  return (
    <SummarySection title="Linked Records">
      <div className={expanded ? "grid gap-3 sm:grid-cols-2" : "space-y-3"}>
        {records.map(({ icon: Icon, label, value, status }) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-slate-950/40 p-3">
            <div className="flex min-w-0 items-center gap-3">
              <Icon className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.12em] text-slate-500">{label}</p>
                <p className="truncate text-sm font-medium text-white">{value}</p>
              </div>
            </div>
            <span className="shrink-0 text-xs text-emerald-300">{status}</span>
          </div>
        ))}
      </div>
    </SummarySection>
  );
};

const PhotoPanel = ({ photos, loading, error, photoFilter, setPhotoFilter, sites, onView, onOpenIncident }: { photos: IncidentPhoto[]; loading: boolean; error: string | null; photoFilter: string; setPhotoFilter: (value: string) => void; sites: Site[]; onView: (photo: IncidentPhoto) => void; onOpenIncident: (photo: IncidentPhoto) => void }) => (
  <section className="rounded-lg border border-border/70 bg-slate-950/70 p-5">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold text-white">RG360 Evidence Photos</h2>
        <p className="text-sm text-slate-400">Open photos before creating or attaching an incident report.</p>
      </div>
      <Select value={photoFilter} onValueChange={setPhotoFilter}>
        <SelectTrigger className="w-full sm:w-[220px]"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="all">All Sites</SelectItem>{sites.map((site) => <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>)}</SelectContent>
      </Select>
    </div>
    {loading ? <div className="mt-5 flex h-32 items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-sky-300" /></div> : error ? <p className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">{error}</p> : photos.length === 0 ? <p className="mt-5 rounded-lg border border-dashed border-border/70 p-6 text-center text-sm text-slate-400">No RG360 evidence photos match this filter.</p> : <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">{photos.slice(0, 12).map((photo) => <PhotoCard key={photo.id} photo={photo} onView={onView} onOpenIncident={onOpenIncident} />)}</div>}
  </section>
);

const ChooserGrid = ({ photos, selectedIds, onToggle, onView }: { photos: IncidentPhoto[]; selectedIds: string[]; onToggle: (id: string) => void; onView: (photo: IncidentPhoto) => void }) => (
  <div className="mt-4 grid gap-2 sm:grid-cols-2">
    {photos.length === 0 ? <p className="text-sm text-slate-500">No available RG360 photos.</p> : photos.map((photo) => (
      <div key={photo.id} className={`rounded-md border p-2 ${selectedIds.includes(photo.id) ? "border-emerald-500/50 bg-emerald-500/10" : "border-border/60 bg-slate-950/40"}`}>
        <button type="button" className="h-20 w-full overflow-hidden rounded bg-black/30" onClick={() => onView(photo)}>{photo.signed_url ? <img src={photo.signed_url} alt="RG360 evidence option" className="h-full w-full object-cover" /> : <ImageIcon className="m-auto mt-6 h-6 w-6 text-slate-500" />}</button>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-slate-400">{photo.device_identifier}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => onToggle(photo.id)}>{selectedIds.includes(photo.id) ? "Added" : "Add"}</Button>
        </div>
      </div>
    ))}
  </div>
);

const SosChooser = ({ alerts, selectedIds, onToggle }: { alerts: IncidentSosAlert[]; selectedIds: string[]; onToggle: (id: string) => void }) => (
  <div className="mt-4 max-h-72 space-y-2 overflow-y-auto pr-1">
    {alerts.length === 0 ? <p className="text-sm text-slate-500">No available SOS alerts.</p> : alerts.map((alert) => (
      <button key={alert.id} type="button" onClick={() => onToggle(alert.id)} className={`w-full rounded-md border p-3 text-left ${selectedIds.includes(alert.id) ? "border-red-500/50 bg-red-500/10" : "border-border/60 bg-slate-950/40 hover:border-slate-600"}`}>
        <div className="flex items-center justify-between gap-3">
          <span className="font-medium text-white">SOS Alert</span>
          <span className="text-xs text-slate-400">{formatDistanceToNowStrict(new Date(alert.created_at), { addSuffix: true })}</span>
        </div>
        <p className="mt-1 line-clamp-2 text-xs text-slate-400">{alert.message}</p>
      </button>
    ))}
  </div>
);

export default Incidents;
