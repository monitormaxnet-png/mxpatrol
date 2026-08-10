/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState, type ReactNode } from "react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  FileUp,
  Filter,
  Map as MapIcon,
  MoreVertical,
  Pause,
  Play,
  Plus,
  Route as RouteIcon,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SocKpiCard, SocPanel, SocProgressBar } from "@/components/dashboard/SocComponents";
import { useCheckpoints } from "@/hooks/useDashboardData";
import { useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";
import { useSites } from "@/hooks/useSites";
import {
  useCreatePatrolRoute,
  useDeletePatrolEntity,
  usePatrolRoutes,
  usePatrolSchedules,
  usePatrolSessions,
  useUpdatePatrolEntity,
  type PatrolRouteRow,
  type PatrolScheduleRow,
  type PatrolSessionRow,
} from "@/hooks/useScheduledPatrols";

const routeStatuses = ["all", "active", "paused", "archived"];

type RouteCheckpointRule = {
  checkpoint_id: string;
  sequence_order: number;
  expected_offset_minutes?: number | null;
  is_required?: boolean;
};

type RouteFormState = {
  name: string;
  description: string;
  siteId: string;
  status: "active" | "paused" | "archived";
  checkpoints: RouteCheckpointRule[];
};

const blankRouteForm = (): RouteFormState => ({ name: "", description: "", siteId: "", status: "active", checkpoints: [] });

export default function RoutesPage() {
  const realtime = useRealtimeConnectionStatus("routes");
  const [siteId, setSiteId] = useState("all");
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [drawer, setDrawer] = useState<PatrolRouteRow | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PatrolRouteRow | null>(null);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<RouteFormState>(blankRouteForm);

  const { data: sites = [] } = useSites();
  const { data: routes = [], isLoading, error } = usePatrolRoutes(siteId);
  const { data: schedules = [] } = usePatrolSchedules(siteId);
  const { data: sessions = [] } = usePatrolSessions(500, siteId);
  const { data: checkpoints = [], isLoading: checkpointsLoading } = useCheckpoints(form.siteId || siteId);
  const createRoute = useCreatePatrolRoute();
  const updateRoute = useUpdatePatrolEntity("route");
  const deleteRoute = useDeletePatrolEntity("route");

  const visibleRoutes = useMemo(() => routes.filter((route) => {
    const text = `${route.name ?? ""} ${route.route_code ?? ""} ${route.sites?.name ?? ""}`.toLowerCase();
    return (status === "all" || route.status === status) && (!query || text.includes(query.toLowerCase()));
  }), [query, routes, status]);

  const metrics = useMemo(() => {
    const checkpointIds = new Set<string>();
    routes.forEach((route) => routeCheckpoints(route).forEach((checkpoint) => checkpointIds.add(checkpoint.checkpoint_id)));
    return {
      total: routes.length,
      active: routes.filter((route) => route.status === "active").length,
      checkpoints: checkpointIds.size,
      schedules: schedules.filter((schedule: any) => !!schedule.route_id).length,
    };
  }, [routes, schedules]);

  const selected = drawer ? routes.find((route) => route.id === drawer.id) ?? drawer : null;

  const openCreate = () => {
    setEditing(null);
    setForm(blankRouteForm());
    setStep(0);
    setDialogOpen(true);
  };

  const openEdit = (route: PatrolRouteRow) => {
    setEditing(route);
    setForm({
      name: route.name ?? "",
      description: route.description ?? "",
      siteId: route.site_id ?? "",
      status: route.status ?? "active",
      checkpoints: routeCheckpoints(route).map((checkpoint, index) => ({
        checkpoint_id: checkpoint.checkpoint_id,
        sequence_order: Number(checkpoint.sequence_order ?? index + 1),
        expected_offset_minutes: checkpoint.expected_offset_minutes ?? checkpoint.expected_arrival_offset_minutes ?? null,
        is_required: checkpoint.is_required ?? true,
      })),
    });
    setStep(0);
    setDialogOpen(true);
  };

  const closeDialog = () => {
    setDialogOpen(false);
    setEditing(null);
    setForm(blankRouteForm());
    setStep(0);
  };

  const submitRoute = async () => {
    if (!form.name.trim()) return toast.error("Route name is required");
    if (!form.siteId) return toast.error("Select a site");
    if (!form.checkpoints.length) return toast.error("Select at least one checkpoint");
    const payload = {
      name: form.name.trim(),
      description: form.description || null,
      site_id: form.siteId,
      status: form.status,
      checkpoints: form.checkpoints.map((checkpoint, index) => ({ ...checkpoint, sequence_order: index + 1 })),
    };
    if (editing) await updateRoute.mutateAsync({ id: editing.id, values: payload });
    else await createRoute.mutateAsync(payload);
    realtime.markUpdated();
    closeDialog();
  };

  const duplicateRoute = async (route: PatrolRouteRow) => {
    await createRoute.mutateAsync({
      name: `${route.name ?? "Route"} Copy`,
      description: route.description ?? null,
      site_id: route.site_id ?? null,
      status: "paused",
      checkpoints: routeCheckpoints(route).map((checkpoint, index) => ({
        checkpoint_id: checkpoint.checkpoint_id,
        sequence_order: index + 1,
        expected_offset_minutes: checkpoint.expected_offset_minutes ?? checkpoint.expected_arrival_offset_minutes ?? null,
        is_required: checkpoint.is_required ?? true,
      })),
    });
  };

  const setRouteStatus = (route: PatrolRouteRow, next: "active" | "paused" | "archived") => {
    const activeScheduleCount = routeSchedules(route, schedules).filter((schedule) => schedule.status === "active").length;
    if (["paused", "archived"].includes(next) && activeScheduleCount > 0) {
      const ok = confirm(`This route is used by ${activeScheduleCount} active schedule${activeScheduleCount === 1 ? "" : "s"}. Continue without changing schedules?`);
      if (!ok) return;
    }
    updateRoute.mutate({ id: route.id, values: { status: next } });
  };

  const removeRoute = (route: PatrolRouteRow) => {
    if (!confirm(`Delete ${route.name}? If this route is linked to schedules or sessions, deletion will be blocked and you should archive it instead.`)) return;
    deleteRoute.mutate(route.id);
  };

  return (
    <div className="min-h-full space-y-4 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.08),transparent_28%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_30%)] pb-6 text-white">
      <header className="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/72 p-4 shadow-[0_0_36px_rgba(0,0,0,0.26)] xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-black">Routes</h1>
          <p className="text-sm text-slate-400">Create and manage checkpoint routes for patrols.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button disabled className="btn-muted"><FileUp className="h-4 w-4" />Import Route</button>
          <button onClick={openCreate} className="btn-primary"><Plus className="h-4 w-4" />New Route</button>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <SocKpiCard icon={RouteIcon} title="Total Routes" value={metrics.total} caption="All time" loading={isLoading} />
        <SocKpiCard icon={ShieldCheck} tone="green" title="Active Routes" value={metrics.active} caption="Currently active" loading={isLoading} />
        <SocKpiCard icon={MapIcon} tone="blue" title="Checkpoints Used" value={metrics.checkpoints} caption="Across all routes" loading={isLoading} />
        <SocKpiCard icon={Filter} tone="amber" title="Schedules Using Routes" value={metrics.schedules} caption="Active schedule links" loading={isLoading} />
      </section>

      <SocPanel title="Route Filters" action={<span className="text-xs text-slate-500">{visibleRoutes.length} routes</span>}>
        <div className="grid gap-3 lg:grid-cols-[1fr_1fr_2fr_auto]">
          <Pick value={siteId} onValue={setSiteId} items={[{ id: "all", name: "All Sites" }, ...sites]} />
          <Pick value={status} onValue={setStatus} items={routeStatuses.map((item) => ({ id: item, name: item === "all" ? "All Statuses" : title(item) }))} />
          <label className="relative block">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search routes..." className="input-dark pl-9" />
          </label>
          <button className="rounded-lg border border-white/10 px-3 text-sm font-bold" onClick={() => { setSiteId("all"); setStatus("all"); setQuery(""); }}>Clear</button>
        </div>
      </SocPanel>

      <SocPanel title="Routes">
        {error && <State text="Routes could not be loaded." tone="red" />}
        {isLoading && <State text="Loading routes..." />}
        {!isLoading && !visibleRoutes.length && <State text="No patrol routes yet. Create a route by selecting checkpoints from one of your sites." action={<button className="btn-primary" onClick={openCreate}><Plus className="h-4 w-4" />Create First Route</button>} />}
        {!!visibleRoutes.length && (
          <>
            <div className="hidden lg:block">
              <RouteTable routes={visibleRoutes} schedules={schedules} sessions={sessions} onView={setDrawer} onEdit={openEdit} onDuplicate={duplicateRoute} onStatus={setRouteStatus} onDelete={removeRoute} />
            </div>
            <div className="grid gap-3 lg:hidden">
              {visibleRoutes.map((route) => <RouteCard key={route.id} route={route} schedules={schedules} sessions={sessions} onView={setDrawer} />)}
            </div>
          </>
        )}
      </SocPanel>

      <RouteDetailsDrawer route={selected} schedules={schedules} sessions={sessions} onClose={() => setDrawer(null)} onEdit={openEdit} onDuplicate={duplicateRoute} onStatus={setRouteStatus} />
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!open) closeDialog(); else setDialogOpen(true); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto border-white/10 bg-slate-950 text-white">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Route" : "New Route"}</DialogTitle>
            <DialogDescription>{editing ? "Update route configuration for future sessions. Existing session snapshots stay unchanged." : "Create a route by selecting checkpoints from one site."}</DialogDescription>
          </DialogHeader>
          <RouteForm form={form} setForm={setForm} step={step} setStep={setStep} sites={sites} checkpoints={checkpoints} checkpointsLoading={checkpointsLoading} submit={submitRoute} busy={createRoute.isPending || updateRoute.isPending} editing={!!editing} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RouteTable({ routes, schedules, sessions, onView, onEdit, onDuplicate, onStatus, onDelete }: any) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[920px] text-left text-sm"><thead className="border-b border-white/10 text-xs uppercase text-slate-400"><tr>{["Route", "Site", "Checkpoints", "Schedules", "Status", "Last Used", "Actions"].map((heading) => <th key={heading} className="px-3 py-3">{heading}</th>)}</tr></thead><tbody className="divide-y divide-white/10">{routes.map((route: PatrolRouteRow) => <tr key={route.id} className="hover:bg-white/[0.03]"><td className="px-3 py-4"><p className="font-bold">{route.name}</p><p className="text-xs text-slate-400">{routeCode(route)}</p></td><td className="px-3 py-4">{route.sites?.name ?? "Unassigned"}</td><td className="px-3 py-4">{routeCheckpoints(route).length} checkpoints</td><td className="px-3 py-4">{routeSchedules(route, schedules).length} schedules</td><td className="px-3 py-4"><StatusBadge status={route.status} /></td><td className="px-3 py-4">{lastUsedLabel(route, sessions)}</td><td className="px-3 py-4"><div className="flex gap-1"><button className="btn-muted h-9 px-3" onClick={() => onView(route)}><Eye className="h-4 w-4" />View</button><button className="icon-btn" onClick={() => onEdit(route)}><RouteIcon className="h-4 w-4" /></button><RouteMore route={route} onEdit={onEdit} onDuplicate={onDuplicate} onStatus={onStatus} onDelete={onDelete} /></div></td></tr>)}</tbody></table></div>;
}

function RouteCard({ route, schedules, sessions, onView }: any) {
  return <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4"><div className="flex items-start justify-between"><div><p className="font-black">{route.name}</p><p className="text-sm text-slate-400">{route.sites?.name ?? "Unassigned"}</p></div><StatusBadge status={route.status} /></div><div className="mt-4 grid grid-cols-2 gap-2 text-sm text-slate-300"><InfoTiny label="Checkpoints" value={routeCheckpoints(route).length} /><InfoTiny label="Schedules" value={routeSchedules(route, schedules).length} /><InfoTiny label="Last Used" value={lastUsedLabel(route, sessions)} /><InfoTiny label="Code" value={routeCode(route)} /></div><button onClick={() => onView(route)} className="btn-primary mt-4 w-full"><Eye className="h-4 w-4" />View Route</button></div>;
}

function RouteMore({ route, onEdit, onDuplicate, onStatus, onDelete }: any) {
  return <DropdownMenu><DropdownMenuTrigger className="icon-btn"><MoreVertical className="h-4 w-4" /></DropdownMenuTrigger><DropdownMenuContent align="end" className="border-white/10 bg-slate-950 text-slate-200"><DropdownMenuItem onClick={() => onEdit(route)}>Edit</DropdownMenuItem><DropdownMenuItem onClick={() => onDuplicate(route)}><Copy className="mr-2 h-4 w-4" />Duplicate</DropdownMenuItem>{route.status === "paused" ? <DropdownMenuItem onClick={() => onStatus(route, "active")}><Play className="mr-2 h-4 w-4" />Resume</DropdownMenuItem> : <DropdownMenuItem onClick={() => onStatus(route, "paused")}><Pause className="mr-2 h-4 w-4" />Pause</DropdownMenuItem>}<DropdownMenuItem onClick={() => onStatus(route, "archived")}><Archive className="mr-2 h-4 w-4" />Archive</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem className="text-red-300" onClick={() => onDelete(route)}><Trash2 className="mr-2 h-4 w-4" />Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function RouteDetailsDrawer({ route, schedules, sessions, onClose, onEdit, onDuplicate, onStatus }: any) {
  const routeScheduleRows = route ? routeSchedules(route, schedules) : [];
  const routeSessionRows = route ? routeSessions(route, sessions) : [];
  const perf = routePerformance(routeSessionRows);
  return <Sheet open={!!route} onOpenChange={(open) => !open && onClose()}><SheetContent className="w-full overflow-y-auto border-white/10 bg-slate-950 text-white sm:max-w-2xl"><SheetHeader><SheetTitle>{route?.name ?? "Route"}</SheetTitle><SheetDescription>{route?.sites?.name ?? "Unassigned"} - {routeCode(route)} - {title(route?.status ?? "active")}</SheetDescription></SheetHeader>{route && <Tabs defaultValue="overview" className="mt-6"><TabsList className="grid w-full grid-cols-4 bg-slate-900"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="checkpoints">Checkpoints</TabsTrigger><TabsTrigger value="schedules">Schedules</TabsTrigger><TabsTrigger value="history">History</TabsTrigger></TabsList><TabsContent value="overview" className="space-y-4"><div className="grid grid-cols-2 gap-2"><Info label="Checkpoints" value={routeCheckpoints(route).length} /><Info label="Schedules" value={routeScheduleRows.length} /><Info label="Last Used" value={lastUsedLabel(route, sessions)} /><Info label="Completion" value={`${perf.completionRate}%`} /></div><Info label="Route Name" value={route.name} /><Info label="Site" value={route.sites?.name ?? "Unassigned"} /><Info label="Status" value={title(route.status ?? "active")} /><Info label="Created" value={fmt(route.created_at)} /><Info label="Last Updated" value={fmt(route.updated_at)} /><RoutePerformance perf={perf} /><button onClick={() => onEdit(route)} className="btn-primary"><RouteIcon className="h-4 w-4" />Edit Route</button></TabsContent><TabsContent value="checkpoints" className="space-y-2"><RouteCheckpointList route={route} /></TabsContent><TabsContent value="schedules" className="space-y-2">{routeScheduleRows.map((schedule: any) => <div key={schedule.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3"><div className="flex justify-between"><div><p className="font-bold">{schedule.name}</p><p className="text-xs text-slate-400">{title(schedule.frequency_type ?? schedule.frequency ?? "daily")} {schedule.start_time ?? ""}</p></div><StatusBadge status={schedule.status} /></div><p className="mt-2 text-xs text-slate-400">DeviceIdentity: {schedule.device_identifier ?? "Any device"}</p></div>)}{!routeScheduleRows.length && <State text="No schedules currently use this route." />}</TabsContent><TabsContent value="history" className="space-y-2"><RouteHistory sessions={routeSessionRows} />{!routeSessionRows.length && <State text="No sessions have executed this route yet." />}</TabsContent></Tabs>}<div className="mt-6 grid grid-cols-3 gap-2"><button className="btn-muted" onClick={() => onDuplicate(route)}>Duplicate</button><button className="btn-muted text-amber-300" onClick={() => onStatus(route, route?.status === "paused" ? "active" : "paused")}>{route?.status === "paused" ? "Resume" : "Pause"} Route</button><button className="btn-primary" onClick={() => onEdit(route)}>Edit Route</button></div></SheetContent></Sheet>;
}

function RouteForm({ form, setForm, step, setStep, sites, checkpoints, checkpointsLoading, submit, busy, editing }: any) {
  const patch = (value: Partial<RouteFormState>) => setForm({ ...form, ...value });
  const selectedIds = new Set(form.checkpoints.map((checkpoint: RouteCheckpointRule) => checkpoint.checkpoint_id));
  const selected = form.checkpoints.map((rule: RouteCheckpointRule) => ({ rule, checkpoint: checkpoints.find((item: any) => item.id === rule.checkpoint_id) })).filter((item: any) => item.checkpoint);
  const toggleCheckpoint = (checkpointId: string, checked: boolean) => {
    if (checked) patch({ checkpoints: [...form.checkpoints, { checkpoint_id: checkpointId, sequence_order: form.checkpoints.length + 1, expected_offset_minutes: form.checkpoints.length * 10, is_required: true }] });
    else patch({ checkpoints: resequence(form.checkpoints.filter((checkpoint) => checkpoint.checkpoint_id !== checkpointId)) });
  };
  const move = (index: number, delta: number) => {
    const next = [...form.checkpoints];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    patch({ checkpoints: resequence(next) });
  };
  const setRule = (checkpointId: string, updates: Partial<RouteCheckpointRule>) => patch({ checkpoints: form.checkpoints.map((checkpoint) => checkpoint.checkpoint_id === checkpointId ? { ...checkpoint, ...updates } : checkpoint) });
  return <div className="space-y-5"><div className="flex flex-wrap gap-2">{["Details", "Checkpoints", "Order", "Rules", "Review"].map((label, index) => <button key={label} onClick={() => setStep(index)} className={`rounded-full px-3 py-1 text-xs font-bold ${step === index ? "bg-emerald-500 text-white" : "bg-slate-900 text-slate-400"}`}>{index + 1}. {label}</button>)}</div>{step === 0 && <div className="grid gap-3"><Field label="Route Name"><input className="input-dark" value={form.name} onChange={(event) => patch({ name: event.target.value })} /></Field><Field label="Site"><Pick value={form.siteId} onValue={(value) => patch({ siteId: value, checkpoints: [] })} items={sites} placeholder="Select site" /></Field><Field label="Description"><textarea className="input-dark min-h-20" value={form.description} onChange={(event) => patch({ description: event.target.value })} /></Field>{editing && <Field label="Status"><Pick value={form.status} onValue={(value) => patch({ status: value as RouteFormState["status"] })} items={["active", "paused", "archived"].map((item) => ({ id: item, name: title(item) }))} /></Field>}</div>}{step === 1 && <div className="space-y-2"><div className="flex items-center justify-between"><button className="text-xs font-bold text-emerald-300" onClick={() => patch({ checkpoints: form.checkpoints.length === checkpoints.length ? [] : checkpoints.map((checkpoint: any, index: number) => ({ checkpoint_id: checkpoint.id, sequence_order: index + 1, expected_offset_minutes: index * 10, is_required: true })) })}>{form.checkpoints.length === checkpoints.length ? "Clear all" : "Select all"}</button><span className="text-xs text-slate-400">{form.checkpoints.length} selected</span></div>{checkpointsLoading && <State text="Loading checkpoints..." />}{!checkpointsLoading && !checkpoints.length && <State text="No checkpoints are available at this site." />}{checkpoints.map((checkpoint: any) => <label key={checkpoint.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-slate-900/70 p-3"><span>{checkpoint.name}<span className="block text-xs text-slate-400">{checkpoint.sites?.name ?? "Site"} - {checkpoint.status ?? "active"}</span></span><input type="checkbox" checked={selectedIds.has(checkpoint.id)} onChange={(event) => toggleCheckpoint(checkpoint.id, event.target.checked)} /></label>)}</div>}{step === 2 && <div className="space-y-2">{selected.map(({ rule, checkpoint }: any, index: number) => <div key={rule.checkpoint_id} className="grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-slate-900/70 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-200">{index + 1}</span><span className="font-semibold">{checkpoint.name}</span><span className="flex gap-1"><button className="icon-btn" onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></button><button className="icon-btn" onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></button></span></div>)}{!selected.length && <State text="Select checkpoints before ordering this route." />}</div>}{step === 3 && <div className="space-y-2">{selected.map(({ rule, checkpoint }: any) => <div key={rule.checkpoint_id} className="grid gap-3 rounded-lg border border-white/10 bg-slate-900/70 p-3 md:grid-cols-[1fr_150px_160px]"><div><p className="font-semibold">{checkpoint.name}</p><p className="text-xs text-slate-400">#{rule.sequence_order}</p></div><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={rule.is_required !== false} onChange={(event) => setRule(rule.checkpoint_id, { is_required: event.target.checked })} />Required</label><Field label="Offset min"><input type="number" min={0} className="input-dark" value={rule.expected_offset_minutes ?? 0} onChange={(event) => setRule(rule.checkpoint_id, { expected_offset_minutes: Number(event.target.value) })} /></Field></div>)}</div>}{step === 4 && <div className="rounded-xl border border-white/10 bg-slate-900/70 p-4"><p className="text-lg font-black">{form.name || "Untitled route"}</p><p className="text-sm text-slate-400">{sites.find((site: any) => site.id === form.siteId)?.name ?? "No site selected"}</p><p className="mt-3 text-sm">{form.checkpoints.length} checkpoints</p><ol className="mt-3 space-y-1 text-sm text-slate-300">{selected.map(({ rule, checkpoint }: any) => <li key={rule.checkpoint_id}>{rule.sequence_order}. {checkpoint.name} - {rule.is_required === false ? "Optional" : "Required"}</li>)}</ol></div>}<div className="flex justify-between border-t border-white/10 pt-4"><button className="btn-muted" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Back</button>{step < 4 ? <button className="btn-primary" onClick={() => setStep(step + 1)}>Next</button> : <button className="btn-primary" disabled={busy} onClick={submit}><Plus className="h-4 w-4" />{editing ? "Save Route" : "Create Route"}</button>}</div></div>;
}

function RouteCheckpointList({ route }: { route: PatrolRouteRow }) {
  return <div className="space-y-2">{routeCheckpoints(route).map((checkpoint, index) => <div key={checkpoint.id ?? checkpoint.checkpoint_id} className="grid grid-cols-[44px_1fr_auto] items-center gap-3 rounded-xl border border-white/10 bg-black/20 p-3"><span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-200">{String(index + 1).padStart(2, "0")}</span><div><p className="font-semibold text-white">{checkpoint.checkpoints?.name ?? "Checkpoint"}</p><p className="text-xs text-slate-500">{checkpoint.checkpoints?.nfc_tag_id ?? checkpoint.checkpoint_id}</p></div><span className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-slate-300">{checkpoint.is_required === false ? "Optional" : "Required"}</span></div>)}</div>;
}

function RouteHistory({ sessions }: { sessions: PatrolSessionRow[] }) {
  return <div className="space-y-2">{sessions.slice(0, 10).map((session) => { const progress = sessionProgress(session); return <div key={session.id} className="rounded-lg border border-white/10 bg-slate-900/60 p-3"><div className="flex justify-between"><div><p className="font-semibold">{fmt(session.scheduled_start, "dd MMM yyyy")}</p><p className="text-xs text-slate-400">{session.patrol_schedules?.name ?? session.schedule_name ?? "Schedule"} - {session.device_identifier ?? "Any device"}</p></div><StatusBadge status={session.status} /></div><div className="mt-3 grid grid-cols-4 gap-2 text-xs text-slate-300"><InfoTiny label="Checkpoints" value={`${progress.completed}/${progress.total}`} /><InfoTiny label="Missed" value={missedCount(session)} /><InfoTiny label="Incidents" value={session.incident_count ?? 0} /><InfoTiny label="SOS" value={session.sos_count ?? 0} /></div></div>; })}</div>;
}

function RoutePerformance({ perf }: { perf: ReturnType<typeof routePerformance> }) {
  return <div className="rounded-xl border border-white/10 bg-slate-900/60 p-4"><p className="font-bold">Performance</p><div className="mt-3 grid grid-cols-2 gap-2"><InfoTiny label="Executions" value={perf.executions} /><InfoTiny label="Completed" value={perf.completed} /><InfoTiny label="Incomplete" value={perf.incomplete} /><InfoTiny label="Missed" value={perf.missed} /></div><div className="mt-3"><div className="mb-1 flex justify-between text-xs text-slate-400"><span>Checkpoint completion</span><span>{perf.checkpointsDone}/{perf.checkpointsTotal}</span></div><SocProgressBar value={perf.completionRate} tone={perf.completionRate < 80 ? "red" : "green"} /></div><p className="mt-3 text-xs text-slate-400">Most missed checkpoint: {perf.mostMissed || "None"}</p></div>;
}

function Pick({ value, onValue, items, placeholder }: any) { return <Select value={value || undefined} onValueChange={onValue}><SelectTrigger className="border-white/10 bg-slate-950/80 text-white"><SelectValue placeholder={placeholder} /></SelectTrigger><SelectContent>{items.map((item: any) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select>; }
function Field({ label, children }: any) { return <label className="grid gap-2 text-sm font-semibold text-slate-300"><span>{label}</span>{children}</label>; }
function Info({ label, value }: { label: string; value: any }) { return <div className="flex justify-between rounded-lg border border-white/10 bg-slate-900/60 p-3 text-sm"><span className="text-slate-400">{label}</span><span className="font-semibold">{value}</span></div>; }
function InfoTiny({ label, value }: { label: string; value: any }) { return <div className="rounded-lg border border-white/10 bg-black/20 p-2"><p className="text-[10px] uppercase text-slate-500">{label}</p><p className="mt-1 font-bold text-slate-100">{value}</p></div>; }
function State({ text, tone = "slate", action }: { text: string; tone?: string; action?: ReactNode }) { return <div className={`rounded-lg border p-6 text-center text-sm ${tone === "red" ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-white/10 bg-slate-950/60 text-slate-400"}`}><p>{text}</p>{action && <div className="mt-4 flex justify-center">{action}</div>}</div>; }
function StatusBadge({ status }: { status?: string | null }) { const value = status ?? "active"; const cls = value === "active" ? "border-emerald-400/20 bg-emerald-400/10 text-emerald-300" : value === "paused" ? "border-amber-400/20 bg-amber-400/10 text-amber-300" : "border-white/10 bg-slate-800 text-slate-300"; return <span className={`rounded-md border px-2 py-1 text-xs font-bold ${cls}`}>{title(value)}</span>; }
function routeCheckpoints(route?: PatrolRouteRow | null) { return [...(route?.patrol_route_checkpoints ?? [])].sort((a: any, b: any) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0)); }
function routeSchedules(route: PatrolRouteRow, schedules: PatrolScheduleRow[]) { return schedules.filter((schedule) => schedule.route_id === route.id); }
function routeSessions(route: PatrolRouteRow, sessions: PatrolSessionRow[]) { return sessions.filter((session) => session.route_id === route.id || session.patrol_route_id === route.id); }
function routeCode(route?: PatrolRouteRow | null) { return route?.route_code ?? route?.code ?? (route?.id ? `RTE-${route.id.slice(0, 4).toUpperCase()}` : "RTE-PENDING"); }
function lastUsedLabel(route: PatrolRouteRow, sessions: PatrolSessionRow[]) { const latest = routeSessions(route, sessions).map((session) => session.actual_end ?? session.last_scan_at ?? session.scheduled_start).filter(Boolean).sort().at(-1); return latest ? `${formatDistanceToNowStrict(new Date(latest), { addSuffix: true })}` : "-"; }
function routePerformance(sessions: PatrolSessionRow[]) { const completed = sessions.filter((session) => ["completed", "completed_late"].includes(session.status)).length; const incomplete = sessions.filter((session) => session.status === "incomplete").length; const missed = sessions.filter((session) => session.status === "missed").length; let checkpointsDone = 0; let checkpointsTotal = 0; const missedByName = new globalThis.Map<string, number>(); sessions.forEach((session) => { const progress = sessionProgress(session); checkpointsDone += progress.completed; checkpointsTotal += progress.total; (session.patrol_session_checkpoints ?? []).filter((checkpoint: any) => checkpoint.status === "missed").forEach((checkpoint: any) => { const name = checkpoint.checkpoint_name_snapshot ?? checkpoint.checkpoints?.name ?? "Unknown checkpoint"; missedByName.set(name, (missedByName.get(name) ?? 0) + 1); }); }); const mostMissed = Array.from(missedByName.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? ""; return { executions: sessions.length, completed, incomplete, missed, checkpointsDone, checkpointsTotal, completionRate: checkpointsTotal ? Math.round((checkpointsDone / checkpointsTotal) * 1000) / 10 : 0, mostMissed }; }
function sessionProgress(session: PatrolSessionRow) { const completed = Number(session.checkpoint_completed ?? session.completed_required_count ?? 0); const total = Number(session.checkpoint_total ?? session.total_required_count ?? 0); return { completed, total }; }
function missedCount(session: PatrolSessionRow) { return (session.patrol_session_checkpoints ?? []).filter((checkpoint: any) => checkpoint.status === "missed").length; }
function resequence(items: RouteCheckpointRule[]) { return items.map((item, index) => ({ ...item, sequence_order: index + 1 })); }
function title(value: string) { return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase()); }
function fmt(value?: string | null, pattern = "yyyy-MM-dd HH:mm") { return value ? format(new Date(value), pattern) : "-"; }
