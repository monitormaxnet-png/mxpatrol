/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, Eye, FileText, ListChecks, Loader2, Map as MapIcon, MoreHorizontal, Pencil, Play, Plus, Radio, Route, Save, ShieldCheck, Trash2, XCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import SiteSelector from '@/components/sites/SiteSelector';
import { SocKpiCard, SocPageShell, SocPanel, SocProgressBar } from '@/components/dashboard/SocComponents';
import { useRealtimeConnectionStatus } from '@/hooks/useRealtimeConnectionStatus';
import { supabase } from '@/integrations/supabase/client';
import { useDevices } from '@/hooks/useDashboardData';
import { useCompanyId } from '@/hooks/usePatrolScanData';
import { patrolSessionLabel, patrolSessionProgress, useCreatePatrolRoute, useCreatePatrolSchedule, useCreatePatrolTemplate, useGeneratePatrolSessions, usePatrolRoutes, usePatrolSchedules, usePatrolSessions, usePatrolTemplates, type CreatePatrolRouteInput, type CreatePatrolScheduleInput, type CreatePatrolTemplateInput } from '@/hooks/useScheduledPatrols';

type Tab = 'operations' | 'templates' | 'routes' | 'schedules';
type Tone = 'green' | 'blue' | 'amber' | 'red' | 'neutral';
const activeStatuses = new Set(['awaiting_start', 'active', 'in_progress', 'late_start', 'delayed']);
const completedStatuses = new Set(['completed', 'completed_late']);
const lateStatuses = new Set(['completed_late', 'late', 'late_start', 'delayed']);
const missedStatuses = new Set(['missed', 'incomplete']);
type CheckpointOption = { id: string; name?: string | null; nfc_tag_id?: string | null; site_id?: string | null; sites?: { name?: string | null } | null };
const db = supabase as any;

function useRouteCheckpointOptions(siteId: string) {
  const { data: companyId } = useCompanyId();

  return useQuery({
    queryKey: ['route_checkpoint_options', companyId, siteId],
    enabled: !!companyId,
    queryFn: async () => {
      let query = db
        .from('checkpoints')
        .select('id, name, nfc_tag_id, site_id, sites(name)')
        .eq('company_id', companyId)
        .order('name', { ascending: true });
      if (siteId !== 'all') query = query.eq('site_id', siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as CheckpointOption[];
    },
  });
}
export default function Patrols() {
  const realtime = useRealtimeConnectionStatus('patrols-page');
  const [siteId, setSiteId] = useState('all');
  const [tab, setTab] = useState<Tab>('operations');
  const [selectedDate, setSelectedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [templateFilter, setTemplateFilter] = useState('all');
  const [deviceFilter, setDeviceFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const templates = usePatrolTemplates(siteId);
  const routes = usePatrolRoutes(siteId);
  const schedules = usePatrolSchedules(siteId);
  const sessions = usePatrolSessions(160, siteId);
  const devices = useDevices(siteId);
  const generate = useGeneratePatrolSessions();
  const createRoute = useCreatePatrolRoute();
  const createTemplate = useCreatePatrolTemplate();
  const createSchedule = useCreatePatrolSchedule();
  const checkpointOptions = useRouteCheckpointOptions(siteId);
  const sessionRows = useMemo(() => sessions.data ?? [], [sessions.data]);
  const templateRows = useMemo(() => templates.data ?? [], [templates.data]);
  const routeRows = useMemo(() => routes.data ?? [], [routes.data]);
  const scheduleRows = useMemo(() => schedules.data ?? [], [schedules.data]);
  const deviceRows = useMemo(() => devices.data ?? [], [devices.data]);
  const onlineDevices = deviceRows.filter((device: any) => device.status === 'online').length;
  const dateSessions = useMemo(() => sessionRows.filter((session) => String(session.scheduled_start ?? '').startsWith(selectedDate)), [selectedDate, sessionRows]);
  const deviceOptions = useMemo(() => Array.from(new Set(sessionRows.map(deviceLabel).filter((value) => value !== 'Unassigned device'))).sort(), [sessionRows]);
  const filteredSessions = useMemo(() => dateSessions.filter((session) => {
    const matchesTemplate = templateFilter === 'all' || patrolSessionLabel(session) === templateFilter;
    const matchesDevice = deviceFilter === 'all' || deviceLabel(session) === deviceFilter;
    const matchesStatus = statusFilter === 'all' || session.status === statusFilter;
    return matchesTemplate && matchesDevice && matchesStatus;
  }), [dateSessions, deviceFilter, statusFilter, templateFilter]);
  const activeSessions = filteredSessions.filter((session) => activeStatuses.has(session.status));
  const completedSessions = filteredSessions.filter((session) => completedStatuses.has(session.status));
  const lateSessions = filteredSessions.filter((session) => lateStatuses.has(session.status));
  const missedSessions = filteredSessions.filter((session) => missedStatuses.has(session.status));
  const compliance = filteredSessions.length ? Math.round((completedSessions.length / filteredSessions.length) * 100) : 0;
  const selectedSession = activeSessions[0] ?? filteredSessions[0] ?? sessionRows[0];
  const attentionItems = buildAttentionItems(filteredSessions);
  const recentActivity = buildRecentActivity(sessionRows).slice(0, 20);

  return (
    <SocPageShell title="Patrols" subtitle="Monitor today's scheduled patrols, active sessions and compliance." realtime={realtime}>
      <section className="rounded-xl border border-white/10 bg-slate-950/72 p-4 shadow-[0_0_30px_rgba(0,0,0,0.22)]">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <SiteSelector value={siteId} onChange={setSiteId} className="flex min-h-11 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3" />
            <FilterSelect label="Template" value={templateFilter} onChange={setTemplateFilter} options={['all', ...templateRows.map((row) => row.name).filter(Boolean)]} />
            <FilterSelect label="Device" value={deviceFilter} onChange={setDeviceFilter} options={['all', ...deviceOptions]} />
            <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={['all', ...Array.from(new Set(dateSessions.map((row) => row.status).filter(Boolean)))]} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-slate-200 outline-none focus:border-emerald-400/40" />
            <button type="button" onClick={() => setTab('templates')} className="h-10 rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 text-xs font-black text-emerald-200">New Patrol Template</button>
            <button type="button" onClick={() => setTab('routes')} className="h-10 rounded-lg border border-blue-400/25 bg-blue-400/10 px-3 text-xs font-black text-blue-200">New Route</button>
            <button type="button" onClick={() => setTab('schedules')} className="h-10 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 text-xs font-black text-amber-200">New Schedule</button>
            <Link to="/live-patrol" className="inline-flex h-10 items-center rounded-lg border border-cyan-400/25 bg-cyan-400/10 px-3 text-xs font-black text-cyan-200">View Live Patrol</Link>
          </div>
        </div>
      </section>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <SocKpiCard title="Scheduled Today" value={filteredSessions.length} caption="Expected sessions" icon={CalendarClock} tone="blue" loading={sessions.isLoading} />
        <SocKpiCard title="Active Now" value={activeSessions.length} caption="Awaiting or underway" icon={Radio} tone={activeSessions.length ? 'green' : 'neutral'} loading={sessions.isLoading} />
        <SocKpiCard title="Completed" value={completedSessions.length} caption="Verified sessions" icon={CheckCircle2} tone="green" loading={sessions.isLoading} />
        <SocKpiCard title="Late" value={lateSessions.length} caption="Late starts/completions" icon={Clock3} tone={lateSessions.length ? 'amber' : 'neutral'} loading={sessions.isLoading} />
        <SocKpiCard title="Missed" value={missedSessions.length} caption="Requires review" icon={XCircle} tone={missedSessions.length ? 'red' : 'neutral'} loading={sessions.isLoading} />
        <SocKpiCard title="Devices Online" value={onlineDevices} subValue={'/ ' + deviceRows.length} caption="All systems" icon={ShieldCheck} tone="blue" loading={sessions.isLoading || devices.isLoading} />
      </section>
      <TabNav active={tab} onChange={setTab} />
      {tab === 'operations' ? (
        <OperationsView loading={sessions.isLoading} sessions={filteredSessions} activeSessions={activeSessions} attentionItems={attentionItems} recentActivity={recentActivity} selectedSession={selectedSession} devices={deviceRows} hasSetupData={templateRows.length > 0 || routeRows.length > 0 || scheduleRows.length > 0} onOpenTemplates={() => setTab('templates')} onOpenRoutes={() => setTab('routes')} onOpenSchedules={() => setTab('schedules')} />
      ) : (
        <ConfigurationView tab={tab} siteId={siteId} templates={templateRows} routes={routeRows} schedules={scheduleRows} devices={deviceRows} checkpointOptions={checkpointOptions.data ?? []} loading={templates.isLoading || routes.isLoading || schedules.isLoading || checkpointOptions.isLoading} generatePending={generate.isPending} createRoutePending={createRoute.isPending} createTemplatePending={createTemplate.isPending} createSchedulePending={createSchedule.isPending} onGenerate={() => generate.mutate()} onCreateRoute={(route) => createRoute.mutate(route)} onCreateTemplate={(template) => createTemplate.mutate(template)} onCreateSchedule={(schedule) => createSchedule.mutate(schedule)} />
      )}
    </SocPageShell>
  );
}

function OperationsView({ loading, sessions, activeSessions, attentionItems, recentActivity, selectedSession, devices, hasSetupData, onOpenTemplates, onOpenRoutes, onOpenSchedules }: { loading: boolean; sessions: any[]; activeSessions: any[]; attentionItems: ReturnType<typeof buildAttentionItems>; recentActivity: ReturnType<typeof buildRecentActivity>; selectedSession: any; devices: any[]; hasSetupData: boolean; onOpenTemplates: () => void; onOpenRoutes: () => void; onOpenSchedules: () => void; }) {
  if (loading) return <LoadingRows label="Loading scheduled patrol operations..." />;
  if (!hasSetupData) {
    return <SocPanel title="No Scheduled Patrols Are Configured"><div className="grid gap-5 p-3 xl:grid-cols-[1.1fr_0.9fr]"><div><p className="text-sm text-slate-300">Create patrol operations in the same order supervisors will use them in the field.</p><ol className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">{['Create or select checkpoints', 'Build a route', 'Create a patrol template', 'Add a schedule', 'Assign a device if required', 'Activate the schedule'].map((step, index) => <li key={step} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/25 p-3"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-black text-emerald-200">{index + 1}</span>{step}</li>)}</ol></div><div className="flex flex-col justify-center gap-3"><button type="button" onClick={onOpenRoutes} className="h-11 rounded-lg border border-cyan-400/25 bg-cyan-400/10 text-sm font-black text-cyan-200">Create Route</button><button type="button" onClick={onOpenTemplates} className="h-11 rounded-lg border border-emerald-400/25 bg-emerald-400/10 text-sm font-black text-emerald-200">Create Patrol Template</button><button type="button" onClick={onOpenSchedules} className="h-11 rounded-lg border border-amber-400/25 bg-amber-400/10 text-sm font-black text-amber-200">Create Schedule</button></div></div></SocPanel>;
  }
  if (!sessions.length) return <SocPanel title="No Patrol Sessions Scheduled"><div className="p-8 text-center"><p className="text-lg font-black text-white">No patrol sessions are scheduled for the selected date.</p><p className="mt-2 text-sm text-slate-400">Templates, routes and schedules are still available below. The backend scheduler will create sessions when they are due.</p></div></SocPanel>;
  const upcoming = sessions.filter((session) => ['scheduled', 'awaiting_start'].includes(session.status)).slice().sort((a, b) => String(a.scheduled_start ?? '').localeCompare(String(b.scheduled_start ?? ''))).slice(0, 4);
  return <div className="space-y-4"><div className="grid gap-4 xl:grid-cols-[280px_1fr]"><SocPanel title="Next Patrols Starting Soon">{upcoming.length ? <div className="space-y-2">{upcoming.map((session) => <Link key={session.id} to={`/session-logs?session=${session.id}`} className="block rounded-lg border border-white/10 bg-black/25 p-3 transition hover:border-blue-400/30 hover:bg-blue-400/5"><div className="flex items-start justify-between gap-3"><span className="font-mono text-sm font-black text-white">{formatTime(session.scheduled_start)}</span><span className="rounded-md bg-blue-400/15 px-2 py-1 text-[10px] font-black text-blue-300">{countdown(session.scheduled_start)}</span></div><p className="mt-2 font-bold text-white">{patrolSessionLabel(session)}</p><p className="text-xs text-slate-400">{session.patrol_routes?.name || 'Route pending'}</p><p className="mt-1 text-xs font-semibold text-slate-500">{deviceLabel(session)}</p></Link>)}</div> : <CompactEmpty title="No upcoming patrols" body="Upcoming scheduled patrols for the selected day will appear here." />}</SocPanel><SocPanel title="Patrols Overview" action={<Link to="/session-logs" className="text-xs font-bold text-blue-400 hover:text-blue-300">View Session Logs</Link>}><PatrolOverviewTable sessions={sessions} devices={devices} /></SocPanel></div><div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr_0.85fr_0.75fr]"><SocPanel title="Attention Required" action={<span className="text-xs font-bold text-red-300">{attentionItems.length} open</span>}>{attentionItems.length ? <div className="space-y-2">{attentionItems.slice(0, 6).map((item) => <AttentionRow key={item.id} item={item} />)}</div> : <CompactEmpty title="No patrol warnings" body="Missed, late and incomplete sessions will appear here." />}</SocPanel><SocPanel title="Live Map Preview" action={<Link to="/live-map" className="text-xs font-bold text-blue-400 hover:text-blue-300">Open Live Map</Link>}><RouteMapPreview sessions={activeSessions.length ? activeSessions : sessions} /></SocPanel><SocPanel title="Patrol Status Breakdown"><StatusBreakdown sessions={sessions} /></SocPanel><SocPanel title="Quick Actions"><QuickActions onOpenTemplates={onOpenTemplates} onOpenRoutes={onOpenRoutes} onOpenSchedules={onOpenSchedules} /></SocPanel></div><SocPanel title="Recent Patrol Activity" action={<LiveMiniBadge />}>{recentActivity.length ? <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">{recentActivity.slice(0, 8).map((activity) => <ActivityRow key={activity.id} activity={activity} />)}</div> : <CompactEmpty title="No recent patrol activity" body="New sessions and RG360 checkpoint scans will populate this feed." />}</SocPanel></div>;
}

function PatrolOverviewTable({ sessions, devices }: { sessions: any[]; devices: any[] }) {
  if (!sessions.length) return <CompactEmpty title="No patrol sessions for this filter" body="Use the date, site, device or KPI filters to find scheduled patrol sessions." />;
  return <div className="overflow-auto"><table className="w-full min-w-[1080px] text-left text-sm"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr><th className="px-3 py-3">Patrol</th><th className="px-3 py-3">Device</th><th className="px-3 py-3">Site</th><th className="px-3 py-3">Progress</th><th className="px-3 py-3">Current Checkpoint</th><th className="px-3 py-3">Next Checkpoint</th><th className="px-3 py-3">ETA</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Last Activity</th><th className="px-3 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-white/5">{sessions.map((session) => { const progress = patrolSessionProgress(session); const device = findDevice(session, devices); const tone = statusTone(session.status); return <tr key={session.id} className="transition hover:bg-white/[0.03]"><td className="px-3 py-3"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 rounded-full ${solidDotTone(tone)}`} /><div><p className="font-black text-white">{patrolSessionLabel(session)}</p><p className="text-xs text-slate-500">{session.patrol_schedules?.name || 'On demand'}</p></div></div></td><td className="px-3 py-3"><p className="font-bold text-white">{deviceLabelFromDevice(device, session)}</p><p className="text-xs text-slate-500">{device?.battery_level != null ? `${device.battery_level}% battery` : 'Battery unknown'}</p></td><td className="px-3 py-3 text-slate-300">{siteNameFromDevice(session, device)}</td><td className="px-3 py-3"><div className="flex items-center gap-2"><SocProgressBar value={progress.percent} tone={tone as any} /><span className="w-20 text-xs text-slate-400">{progress.completed}/{progress.total || 0} {progress.percent}%</span></div></td><td className="px-3 py-3 text-slate-300">{currentCheckpointName(session) || 'Awaiting start'}</td><td className="px-3 py-3 text-slate-300">{nextCheckpointName(session) || 'Route complete'}</td><td className="px-3 py-3 font-semibold text-slate-300">{etaLabel(session)}</td><td className="px-3 py-3"><StatusBadge status={movingStatus(session)} /></td><td className="px-3 py-3 text-slate-400">{lastActivityLabel(session)}</td><td className="px-3 py-3"><div className="flex justify-end gap-2"><Link to={`/live-patrol?session=${session.id}`} className="rounded-md border border-white/10 p-2 text-slate-300 hover:border-emerald-400/40 hover:text-emerald-300" aria-label="View patrol"><Eye className="h-4 w-4" /></Link><Link to={`/live-map?device=${session.device_identifier ?? ''}`} className="rounded-md border border-white/10 p-2 text-slate-300 hover:border-blue-400/40 hover:text-blue-300" aria-label="Open map"><MapIcon className="h-4 w-4" /></Link><Link to={`/session-logs?session=${session.id}`} className="rounded-md border border-white/10 p-2 text-slate-300 hover:border-cyan-400/40 hover:text-cyan-300" aria-label="Open session"><FileText className="h-4 w-4" /></Link><button type="button" className="rounded-md border border-white/10 p-2 text-slate-300" aria-label="More actions"><MoreHorizontal className="h-4 w-4" /></button></div></td></tr>; })}</tbody></table></div>;
}

function RouteMapPreview({ sessions }: { sessions: any[] }) {
  const rows = sessions.slice(0, 3);
  return <div className="relative min-h-[240px] overflow-hidden rounded-lg border border-white/10 bg-[radial-gradient(circle_at_30%_30%,rgba(34,197,94,0.16),transparent_26%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-4"><div className="absolute inset-0 opacity-25 [background-image:linear-gradient(rgba(148,163,184,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,.08)_1px,transparent_1px)] [background-size:34px_34px]" /><svg className="absolute inset-0 h-full w-full" viewBox="0 0 500 260" aria-hidden="true"><path d="M50 190 C120 120, 170 190, 230 110 S360 90, 445 55" fill="none" stroke="rgba(34,197,94,.75)" strokeWidth="4" strokeDasharray="8 8" /><path d="M90 210 C150 175, 205 220, 275 150 S365 155, 455 115" fill="none" stroke="rgba(249,115,22,.75)" strokeWidth="3" strokeDasharray="7 9" /></svg><div className="relative z-10 space-y-3">{rows.map((session, index) => <div key={session.id} className="w-fit rounded-lg border border-white/10 bg-black/60 px-3 py-2 shadow-[0_0_18px_rgba(0,0,0,.3)]" style={{ marginLeft: `${index * 18}%` }}><p className="text-xs font-black text-white">{deviceLabel(session)}</p><p className="text-[11px] text-slate-400">{currentCheckpointName(session) || patrolSessionLabel(session)}</p></div>)}</div>{!rows.length && <div className="relative z-10 flex h-[200px] items-center justify-center text-sm text-slate-500">No active patrol route to preview.</div>}</div>;
}

function StatusBreakdown({ sessions }: { sessions: any[] }) {
  const rows = [{ label: 'Active', count: sessions.filter((row) => activeStatuses.has(row.status)).length, tone: 'green' as Tone }, { label: 'Scheduled', count: sessions.filter((row) => ['scheduled', 'awaiting_start'].includes(row.status)).length, tone: 'blue' as Tone }, { label: 'Completed', count: sessions.filter((row) => completedStatuses.has(row.status)).length, tone: 'green' as Tone }, { label: 'Delayed', count: sessions.filter((row) => lateStatuses.has(row.status)).length, tone: 'amber' as Tone }, { label: 'Missed', count: sessions.filter((row) => missedStatuses.has(row.status)).length, tone: 'red' as Tone }];
  return <div className="grid gap-4"><div className="mx-auto flex h-32 w-32 items-center justify-center rounded-full border border-white/10 bg-[conic-gradient(rgba(34,197,94,.9),rgba(59,130,246,.9),rgba(245,158,11,.9),rgba(239,68,68,.9),rgba(34,197,94,.9))]"><div className="flex h-24 w-24 flex-col items-center justify-center rounded-full bg-slate-950 text-center"><span className="text-3xl font-black text-white">{sessions.length}</span><span className="text-xs text-slate-500">Total</span></div></div><div className="space-y-2">{rows.map((row) => <div key={row.label} className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm"><span className="flex items-center gap-2 text-slate-300"><span className={`h-2 w-2 rounded-full ${solidDotTone(row.tone)}`} />{row.label}</span><span className="font-black text-white">{row.count}</span></div>)}</div></div>;
}

function QuickActions({ onOpenTemplates, onOpenRoutes, onOpenSchedules }: { onOpenTemplates: () => void; onOpenRoutes: () => void; onOpenSchedules: () => void }) {
  return <div className="space-y-2"><QuickAction label="Create Patrol" icon={Plus} onClick={onOpenTemplates} /><QuickAction label="Create Route" icon={Route} onClick={onOpenRoutes} /><QuickAction label="Create Schedule" icon={CalendarClock} onClick={onOpenSchedules} /><Link to="/devices" className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-slate-300 hover:border-emerald-400/25 hover:text-emerald-300"><ShieldCheck className="h-4 w-4" /> Assign Device</Link><Link to="/reports" className="flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-slate-300 hover:border-emerald-400/25 hover:text-emerald-300"><FileText className="h-4 w-4" /> Export Patrol Report</Link></div>;
}

function QuickAction({ label, icon: Icon, onClick }: { label: string; icon: any; onClick: () => void }) {
  return <button type="button" onClick={onClick} className="flex h-10 w-full items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 text-xs font-bold text-slate-300 hover:border-emerald-400/25 hover:text-emerald-300"><Icon className="h-4 w-4" /> {label}</button>;
}
function ConfigurationView({ tab, siteId, templates, routes, schedules, devices, checkpointOptions, loading, generatePending, createRoutePending, createTemplatePending, createSchedulePending, onGenerate, onCreateRoute, onCreateTemplate, onCreateSchedule }: { tab: Exclude<Tab, 'operations'>; siteId: string; templates: any[]; routes: any[]; schedules: any[]; devices: any[]; checkpointOptions: CheckpointOption[]; loading: boolean; generatePending: boolean; createRoutePending: boolean; createTemplatePending: boolean; createSchedulePending: boolean; onGenerate: () => void; onCreateRoute: (route: CreatePatrolRouteInput) => void; onCreateTemplate: (template: CreatePatrolTemplateInput) => void; onCreateSchedule: (schedule: CreatePatrolScheduleInput) => void; }) {
  const [editing, setEditing] = useState<{ kind: 'template' | 'route' | 'schedule'; row: any } | null>(null);
  const updateTemplate = useUpdatePatrolEntity('template');
  const updateRoute = useUpdatePatrolEntity('route');
  const updateSchedule = useUpdatePatrolEntity('schedule');
  const deleteTemplate = useDeletePatrolEntity('template');
  const deleteRoute = useDeletePatrolEntity('route');
  const deleteSchedule = useDeletePatrolEntity('schedule');

  const mutationFor = (kind: 'template' | 'route' | 'schedule') => kind === 'template' ? updateTemplate : kind === 'route' ? updateRoute : updateSchedule;
  const removeFor = (kind: 'template' | 'route' | 'schedule') => kind === 'template' ? deleteTemplate : kind === 'route' ? deleteRoute : deleteSchedule;

  const confirmDelete = (kind: 'template' | 'route' | 'schedule', row: any) => {
    const extra = kind === 'schedule' ? ' Its scheduled (not yet started) patrol sessions will be removed too.' : '';
    if (!window.confirm(`Delete "${row.name}"? This cannot be undone.${extra}`)) return;
    removeFor(kind).mutate(row.id);
  };

  const rowActions = (kind: 'template' | 'route' | 'schedule') => (row: any) => (
    <RowActions
      pending={removeFor(kind).isPending}
      onEdit={() => setEditing({ kind, row })}
      onDelete={() => confirmDelete(kind, row)}
    />
  );

  const dialog = editing ? (
    <EditPatrolDialog
      kind={editing.kind}
      row={editing.row}
      routes={routes}
      templates={templates}
      devices={devices}
      pending={mutationFor(editing.kind).isPending}
      onClose={() => setEditing(null)}
      onSave={(values) => mutationFor(editing.kind).mutate({ id: editing.row.id, values }, { onSuccess: () => setEditing(null) })}
    />
  ) : null;

  if (loading) return <LoadingRows label="Loading patrol configuration..." />;
  if (tab === 'templates') return <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]"><TemplateCreationPanel siteId={siteId} pending={createTemplatePending} onCreate={onCreateTemplate} /><SocPanel title="Patrol Templates"><ConfigTable rows={templates} empty="No patrol templates yet. Create a template, then a route and a schedule." columns={['Template', 'Site', 'Duration', 'Status']} render={(row) => [row.name, row.sites?.name || 'Company-wide', row.expected_duration_minutes ? `${row.expected_duration_minutes} min` : '—', row.status || 'active']} actions={rowActions('template')} /></SocPanel>{dialog}</div>;
  if (tab === 'routes') return <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]"><RouteCreationPanel siteId={siteId} checkpoints={checkpointOptions} pending={createRoutePending} onCreate={onCreateRoute} /><SocPanel title="Routes"><ConfigTable rows={routes} empty="No patrol routes yet. Build an ordered checkpoint route before scheduling patrols." columns={['Route', 'Site', 'Checkpoints', 'Mode', 'Status']} render={(row) => [row.name, row.sites?.name || 'Company-wide', String(row.patrol_route_checkpoints?.length ?? 0), row.sequence_mode || row.mode || 'Flexible', row.status || 'active']} actions={rowActions('route')} /></SocPanel>{dialog}</div>;
  return <div className="grid gap-4 xl:grid-cols-[0.95fr_1.05fr]"><ScheduleCreationPanel routes={routes} templates={templates} devices={devices} pending={createSchedulePending} onCreate={onCreateSchedule} /><SocPanel title="Schedules" action={<button type="button" onClick={onGenerate} disabled={generatePending} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-xs font-black text-slate-300 disabled:opacity-50">{generatePending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Admin Generate</button>}><ConfigTable rows={schedules} empty="No active patrol schedules yet. Add a schedule to let the backend create sessions automatically." columns={['Schedule', 'Route', 'Recurrence', 'Active Days', 'Time Window', 'Device', 'Next Run', 'Status']} render={(row) => [row.name, row.patrol_routes?.name || '—', formatRecurrence(row), formatActiveDays(row.days_of_week), formatTimeWindow(row.start_time, row.end_time), row.device_identifier || 'Any device', formatDateTime(row.next_run_at), row.status || 'active']} actions={rowActions('schedule')} /></SocPanel>{dialog}</div>;
}

function RowActions({ onEdit, onDelete, pending }: { onEdit: () => void; onDelete: () => void; pending: boolean }) {
  return <div className="flex items-center justify-end gap-2">
    <button type="button" onClick={onEdit} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 text-[11px] font-black text-slate-300 transition hover:border-cyan-400/30 hover:text-cyan-200"><Pencil className="h-3.5 w-3.5" />Edit</button>
    <button type="button" onClick={onDelete} disabled={pending} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-red-400/25 bg-red-400/10 px-2.5 text-[11px] font-black text-red-200 transition hover:bg-red-400/20 disabled:opacity-50">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}Delete</button>
  </div>;
}

function EditPatrolDialog({ kind, row, routes, templates, devices, pending, onClose, onSave }: { kind: 'template' | 'route' | 'schedule'; row: any; routes: any[]; templates: any[]; devices: any[]; pending: boolean; onClose: () => void; onSave: (values: Record<string, any>) => void }) {
  const [name, setName] = useState(row.name ?? '');
  const [description, setDescription] = useState(row.description ?? '');
  const [status, setStatus] = useState(row.status ?? 'active');
  const [duration, setDuration] = useState(String(row.expected_duration_minutes ?? 60));
  const [routeId, setRouteId] = useState(row.route_id ?? '');
  const [templateId, setTemplateId] = useState(row.template_id ?? 'none');
  const [frequencyType, setFrequencyType] = useState(row.frequency_type ?? row.frequency ?? 'daily');
  const [intervalValue, setIntervalValue] = useState(String(row.interval_value ?? 1));
  const [startTime, setStartTime] = useState((row.start_time ?? '').slice(0, 5));
  const [endTime, setEndTime] = useState((row.end_time ?? '').slice(0, 5));
  const [days, setDays] = useState<number[]>(Array.isArray(row.days_of_week) ? row.days_of_week : []);
  const [graceStart, setGraceStart] = useState(String(row.grace_start_minutes ?? 10));
  const [graceCompletion, setGraceCompletion] = useState(String(row.grace_completion_minutes ?? 40));
  const [deviceIdentifier, setDeviceIdentifier] = useState(row.device_identifier ?? 'any');

  const toggleDay = (day: number) => setDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);
  const canSave = name.trim().length > 0 && (kind !== 'schedule' || !!routeId) && !pending;

  const save = () => {
    if (!canSave) return;
    if (kind === 'template') {
      onSave({ name: name.trim(), description: description.trim() || null, status, expected_duration_minutes: Math.max(Number(duration) || 60, 1) });
      return;
    }
    if (kind === 'route') {
      onSave({ name: name.trim(), description: description.trim() || null, status });
      return;
    }
    onSave({
      name: name.trim(),
      route_id: routeId,
      template_id: templateId === 'none' ? null : templateId,
      frequency_type: frequencyType,
      interval_value: Math.max(Number(intervalValue) || 1, 1),
      start_time: startTime || null,
      end_time: endTime || null,
      days_of_week: days,
      status,
      grace_start_minutes: Math.max(Number(graceStart) || 0, 0),
      grace_completion_minutes: Math.max(Number(graceCompletion) || 1, 1),
      device_identifier: deviceIdentifier === 'any' ? null : deviceIdentifier,
    });
  };

  const title = kind === 'template' ? 'Edit Patrol Template' : kind === 'route' ? 'Edit Route' : 'Edit Schedule';

  return <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-black/70 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
    <div className="my-8 w-full max-w-lg rounded-2xl border border-white/10 bg-slate-950/95 p-5 shadow-2xl">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-black text-white">{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 text-slate-400 hover:text-white"><XCircle className="h-4 w-4" /></button>
      </div>
      <div className="mt-4 space-y-4">
        <label className="block"><span className={labelClass}>Name</span><input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} /></label>
        {kind !== 'schedule' ? <label className="block"><span className={labelClass}>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40" /></label> : null}
        {kind === 'template' ? <label className="block"><span className={labelClass}>Expected Duration (minutes)</span><input type="number" min={1} max={1440} value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass} /></label> : null}
        {kind === 'schedule' ? <>
          <label className="block"><span className={labelClass}>Route</span><select value={routeId} onChange={(event) => setRouteId(event.target.value)} className={fieldClass}>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
          <label className="block"><span className={labelClass}>Template (optional)</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={fieldClass}><option value="none">No template</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={labelClass}>Frequency</span><select value={frequencyType} onChange={(event) => setFrequencyType(event.target.value)} className={fieldClass}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="every_n_minutes">Every N minutes</option><option value="every_n_hours">Every N hours</option></select></label>
            <label className="block"><span className={labelClass}>Interval</span><input type="number" min={1} value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} className={fieldClass} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={labelClass}>Start Time</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldClass} /></label>
            <label className="block"><span className={labelClass}>End Time</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={fieldClass} /></label>
          </div>
          <div><span className={labelClass}>Active Days</span><div className="mt-2 flex flex-wrap gap-2">{weekDays.map((day) => { const selected = days.includes(day.value); return <button key={day.value} type="button" onClick={() => toggleDay(day.value)} className={`h-9 min-w-12 rounded-lg border px-3 text-xs font-black transition ${selected ? 'border-emerald-400/35 bg-emerald-400/15 text-emerald-100' : 'border-white/10 bg-black/25 text-slate-400 hover:border-cyan-400/25'}`}>{day.label}</button>; })}</div></div>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={labelClass}>Grace Start (min)</span><input type="number" min={0} max={240} value={graceStart} onChange={(event) => setGraceStart(event.target.value)} className={fieldClass} /></label>
            <label className="block"><span className={labelClass}>Grace Completion (min)</span><input type="number" min={1} max={1440} value={graceCompletion} onChange={(event) => setGraceCompletion(event.target.value)} className={fieldClass} /></label>
          </div>
          <label className="block"><span className={labelClass}>Assigned Device</span><select value={deviceIdentifier} onChange={(event) => setDeviceIdentifier(event.target.value)} className={fieldClass}><option value="any">Any device</option>{devices.filter((device) => device.device_identifier).map((device) => <option key={device.id} value={device.device_identifier}>{displayDeviceLabel(device.device_name || device.device_identifier)}</option>)}</select></label>
        </> : null}
        <label className="block"><span className={labelClass}>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)} className={fieldClass}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
      </div>
      <div className="mt-5 flex gap-3">
        <button type="button" onClick={onClose} className="h-11 flex-1 rounded-lg border border-white/10 bg-white/[0.04] text-sm font-black text-slate-300">Cancel</button>
        <button type="button" onClick={save} disabled={!canSave} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/15 text-sm font-black text-emerald-100 disabled:opacity-45">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Save Changes</button>
      </div>
    </div>
  </div>;
}


function formatRecurrence(row: any) {
  const type = row.frequency_type || row.frequency;
  const interval = Number(row.interval_value ?? 1) || 1;
  if (!type) return '—';
  if (type === 'every_n_minutes') return `Every ${interval} min`;
  if (type === 'every_n_hours') return `Every ${interval} hr`;
  if (type === 'hourly') return interval > 1 ? `Every ${interval} hr` : 'Hourly';
  if (type === 'daily') return interval > 1 ? `Every ${interval} days` : 'Daily';
  if (type === 'weekly') return interval > 1 ? `Every ${interval} weeks` : 'Weekly';
  return `${type}${interval > 1 ? ` x${interval}` : ''}`;
}

function formatActiveDays(days: unknown) {
  if (!Array.isArray(days) || !days.length) return 'Every day';
  const labels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  if (days.length === 7) return 'Every day';
  return [1, 2, 3, 4, 5, 6, 0].filter((day) => days.includes(day)).map((day) => labels[day]).join(' ');
}

function formatTimeWindow(start?: string | null, end?: string | null) {
  if (!start && !end) return 'All day';
  const trim = (value?: string | null) => (value ? String(value).slice(0, 5) : '—');
  return `${trim(start)} - ${trim(end)}`;
}

const fieldClass = 'mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none focus:border-emerald-400/40';
const labelClass = 'text-[10px] font-black uppercase tracking-wider text-slate-500';

function TemplateCreationPanel({ siteId, pending, onCreate }: { siteId: string; pending: boolean; onCreate: (template: CreatePatrolTemplateInput) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState('60');
  const minutes = Number(duration);
  const canCreate = name.trim().length > 0 && Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 && !pending;

  const submit = () => {
    if (!canCreate) return;
    onCreate({ name: name.trim(), description: description.trim() || null, site_id: siteId === 'all' ? null : siteId, status: 'active', expected_duration_minutes: Math.round(minutes) });
    setName('');
    setDescription('');
  };

  return <SocPanel title="Create Patrol Template" action={<span className="text-[10px] font-black uppercase tracking-wider text-emerald-300">Step 1</span>}>
    <div className="space-y-4">
      <div className="rounded-xl border border-emerald-400/15 bg-emerald-400/5 p-3 text-sm text-slate-300"><p className="font-bold text-white">What is a template?</p><p className="mt-1 text-xs text-slate-400">A template names the patrol type and its expected duration. Routes and schedules attach to it.</p></div>
      <label className="block"><span className={labelClass}>Template Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Night Perimeter Patrol" className={fieldClass} /></label>
      <label className="block"><span className={labelClass}>Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} placeholder="Optional notes" className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40" /></label>
      <label className="block"><span className={labelClass}>Expected Duration (minutes)</span><input type="number" min={1} max={1440} value={duration} onChange={(event) => setDuration(event.target.value)} className={fieldClass} /></label>
      <p className="text-xs text-slate-500">{siteId === 'all' ? 'No site filter selected - template will be company-wide.' : 'Template will be linked to the selected site.'}</p>
      <button type="button" onClick={submit} disabled={!canCreate} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/15 text-sm font-black text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-45">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create Template</button>
    </div>
  </SocPanel>;
}

const weekDays = [{ value: 1, label: 'Mon' }, { value: 2, label: 'Tue' }, { value: 3, label: 'Wed' }, { value: 4, label: 'Thu' }, { value: 5, label: 'Fri' }, { value: 6, label: 'Sat' }, { value: 0, label: 'Sun' }];

function ScheduleCreationPanel({ routes, templates, devices, pending, onCreate }: { routes: any[]; templates: any[]; devices: any[]; pending: boolean; onCreate: (schedule: CreatePatrolScheduleInput) => void }) {
  const [name, setName] = useState('');
  const [routeId, setRouteId] = useState('');
  const [templateId, setTemplateId] = useState('none');
  const [frequencyType, setFrequencyType] = useState<'hourly' | 'daily' | 'weekly' | 'every_n_minutes' | 'every_n_hours'>('daily');
  const [intervalValue, setIntervalValue] = useState('1');
  const [startTime, setStartTime] = useState('18:00');
  const [endTime, setEndTime] = useState('06:00');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [graceStart, setGraceStart] = useState('10');
  const [graceCompletion, setGraceCompletion] = useState('40');
  const [deviceIdentifier, setDeviceIdentifier] = useState('any');
  const interval = Number(intervalValue);
  const canCreate = name.trim().length > 0 && !!routeId && Number.isFinite(interval) && interval > 0 && !pending;

  const toggleDay = (day: number) => setDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day]);

  const submit = () => {
    if (!canCreate) return;
    const route = routes.find((row) => row.id === routeId);
    onCreate({
      name: name.trim(),
      route_id: routeId,
      site_id: route?.site_id ?? null,
      template_id: templateId === 'none' ? (route?.template_id ?? null) : templateId,
      frequency_type: frequencyType,
      interval_value: Math.round(interval),
      start_time: startTime || null,
      end_time: endTime || null,
      days_of_week: frequencyType === 'weekly' ? days : days,
      timezone: 'Africa/Gaborone',
      status: 'active',
      grace_start_minutes: Math.max(Number(graceStart) || 0, 0),
      grace_completion_minutes: Math.max(Number(graceCompletion) || 1, 1),
      device_identifier: deviceIdentifier === 'any' ? null : deviceIdentifier,
    });
    setName('');
  };

  return <SocPanel title="Create Schedule" action={<span className="text-[10px] font-black uppercase tracking-wider text-amber-300">Step 3</span>}>
    <div className="space-y-4">
      <div className="rounded-xl border border-amber-400/15 bg-amber-400/5 p-3 text-sm text-slate-300"><p className="font-bold text-white">How schedules work</p><p className="mt-1 text-xs text-slate-400">A schedule turns a route into recurring patrol sessions the RG360 devices must complete.</p></div>
      {routes.length ? null : <CompactEmpty title="No routes available" body="Create a route first - a schedule must point at an ordered checkpoint route." />}
      <label className="block"><span className={labelClass}>Schedule Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Tlokweng Hourly Patrol" className={fieldClass} /></label>
      <label className="block"><span className={labelClass}>Route</span><select value={routeId} onChange={(event) => setRouteId(event.target.value)} className={fieldClass}><option value="">Select route</option>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}{route.sites?.name ? ` - ${route.sites.name}` : ''}</option>)}</select></label>
      <label className="block"><span className={labelClass}>Template (optional)</span><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} className={fieldClass}><option value="none">Inherit from route</option>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={labelClass}>Frequency</span><select value={frequencyType} onChange={(event) => setFrequencyType(event.target.value as any)} className={fieldClass}><option value="hourly">Hourly</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="every_n_minutes">Every N minutes</option><option value="every_n_hours">Every N hours</option></select></label>
        <label className="block"><span className={labelClass}>Interval</span><input type="number" min={1} value={intervalValue} onChange={(event) => setIntervalValue(event.target.value)} className={fieldClass} /></label>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={labelClass}>Start Time</span><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={labelClass}>End Time</span><input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={fieldClass} /></label>
      </div>
      <div><span className={labelClass}>Active Days</span><div className="mt-2 flex flex-wrap gap-2">{weekDays.map((day) => { const selected = days.includes(day.value); return <button key={day.value} type="button" onClick={() => toggleDay(day.value)} className={`h-9 min-w-12 rounded-lg border px-3 text-xs font-black transition ${selected ? 'border-emerald-400/35 bg-emerald-400/15 text-emerald-100' : 'border-white/10 bg-black/25 text-slate-400 hover:border-cyan-400/25'}`}>{day.label}</button>; })}</div></div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={labelClass}>Grace Start (min)</span><input type="number" min={0} max={240} value={graceStart} onChange={(event) => setGraceStart(event.target.value)} className={fieldClass} /></label>
        <label className="block"><span className={labelClass}>Grace Completion (min)</span><input type="number" min={1} max={1440} value={graceCompletion} onChange={(event) => setGraceCompletion(event.target.value)} className={fieldClass} /></label>
      </div>
      <label className="block"><span className={labelClass}>Assigned Device</span><select value={deviceIdentifier} onChange={(event) => setDeviceIdentifier(event.target.value)} className={fieldClass}><option value="any">Any device</option>{devices.filter((device) => device.device_identifier).map((device) => <option key={device.id} value={device.device_identifier}>{displayDeviceLabel(device.device_name || device.device_identifier)}</option>)}</select></label>
      <button type="button" onClick={submit} disabled={!canCreate} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/15 text-sm font-black text-amber-100 transition hover:bg-amber-400/20 disabled:cursor-not-allowed disabled:opacity-45">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create Schedule</button>
    </div>
  </SocPanel>;
}

function RouteCreationPanel({ siteId, checkpoints, pending, onCreate }: { siteId: string; checkpoints: CheckpointOption[]; pending: boolean; onCreate: (route: CreatePatrolRouteInput) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const needsSite = siteId === 'all';
  const canCreate = !needsSite && name.trim().length > 0 && selectedIds.length > 0 && !pending;

  const toggleCheckpoint = (checkpointId: string) => {
    setSelectedIds((current) => current.includes(checkpointId) ? current.filter((id) => id !== checkpointId) : [...current, checkpointId]);
  };

  const submit = () => {
    if (!canCreate) return;
    onCreate({
      name: name.trim(),
      description: description.trim() || null,
      site_id: siteId,
      status: 'active',
      checkpoints: selectedIds.map((checkpointId, index) => ({
        checkpoint_id: checkpointId,
        sequence_order: index + 1,
        expected_offset_minutes: index * 5,
        is_required: true,
      })),
    });
  };

  return <SocPanel title="Create Route" action={<span className="text-[10px] font-black uppercase tracking-wider text-cyan-300">Ordered Checkpoints</span>}><div className="space-y-4"><div className="rounded-xl border border-cyan-400/15 bg-cyan-400/5 p-3 text-sm text-slate-300"><p className="font-bold text-white">How to build a patrol route</p><p className="mt-1 text-xs text-slate-400">Select one site, name the route, then click checkpoints in the order the RG360 should visit them.</p></div>{needsSite ? <CompactEmpty title="Select a site first" body="Routes belong to one site. Choose Tlokweng or another site from the page filter before creating a route." /> : null}<label className="block"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Route Name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Main Gate Patrol" className="mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none focus:border-emerald-400/40" /></label><label className="block"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Description</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional route notes" rows={3} className="mt-2 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 py-2 text-sm text-white outline-none focus:border-emerald-400/40" /></label><div><div className="mb-2 flex items-center justify-between"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">Checkpoint Order</span><span className="text-xs font-bold text-slate-400">{selectedIds.length} selected</span></div>{checkpoints.length ? <div className="max-h-80 space-y-2 overflow-y-auto pr-1">{checkpoints.map((checkpoint) => { const order = selectedIds.indexOf(checkpoint.id) + 1; const selected = order > 0; return <button key={checkpoint.id} type="button" onClick={() => toggleCheckpoint(checkpoint.id)} disabled={needsSite} className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-emerald-400/35 bg-emerald-400/10' : 'border-white/10 bg-black/25 hover:border-cyan-400/25'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-black ${selected ? 'bg-emerald-400 text-black' : 'bg-white/10 text-slate-300'}`}>{selected ? order : <Plus className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-white">{checkpoint.name || 'Unnamed checkpoint'}</span><span className="block truncate font-mono text-xs text-slate-500">{checkpoint.nfc_tag_id || 'No NFC UID'} - {checkpoint.sites?.name || 'Selected site'}</span></span></button>; })}</div> : <CompactEmpty title="No checkpoints for this site" body="Create checkpoints first, then return here to arrange them into a patrol route." />}</div><button type="button" onClick={submit} disabled={!canCreate} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/15 text-sm font-black text-emerald-100 transition hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-45">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Create Route</button></div></SocPanel>;
}
function ActivePatrolCard({ session }: { session: any }) {
  const progress = patrolSessionProgress(session);
  const tone = statusTone(session.status);
  const checkpoints = sortedCheckpoints(session);
  const current = checkpoints.find((checkpoint) => checkpoint.status === 'current' || checkpoint.status === 'in_progress') ?? checkpoints.find((checkpoint) => checkpoint.scanned_at);
  const next = checkpoints.find((checkpoint) => !checkpoint.scanned_at && !['skipped', 'missed'].includes(checkpoint.status));
  return <Link to={`/live-patrol?session=${session.id}`} className={`block rounded-xl border p-4 transition hover:-translate-y-0.5 ${panelTone(tone)}`}><div className="flex items-start justify-between gap-3"><div><p className="font-mono text-sm font-black text-white">{deviceLabel(session)}</p><p className="mt-1 text-xs text-slate-400">{siteName(session)}</p></div><StatusBadge status={session.status} /></div><div className="mt-4 space-y-2 text-sm text-slate-300"><InfoLine label="Patrol" value={patrolSessionLabel(session)} /><InfoLine label="Route" value={session.patrol_routes?.name || 'Route pending'} /><InfoLine label="Current" value={checkpointName(current) || 'Awaiting first checkpoint'} /><InfoLine label="Next" value={checkpointName(next) || 'No next checkpoint'} /></div><div className="mt-4 flex items-center gap-3"><SocProgressBar value={progress.percent} tone={tone as any} /><span className="w-16 text-right text-xs font-black text-slate-300">{progress.completed}/{progress.total || '-'}</span></div><div className="mt-4 grid grid-cols-3 gap-2 text-[11px] text-slate-400"><MiniMetric label="Start" value={formatTime(session.actual_start ?? session.scheduled_start)} /><MiniMetric label="Elapsed" value={elapsedLabel(session)} /><MiniMetric label="Last scan" value={session.last_scan_at ? formatDistanceToNow(new Date(session.last_scan_at), { addSuffix: true }) : 'None'} /></div></Link>;
}

function TimelineRow({ session }: { session: any }) {
  const progress = patrolSessionProgress(session);
  const tone = statusTone(session.status);
  return <Link to={`/live-patrol?session=${session.id}`} className="grid gap-3 rounded-xl border border-white/10 bg-black/25 p-3 transition hover:border-emerald-400/25 hover:bg-white/[0.03] md:grid-cols-[78px_1.2fr_1fr_1fr_150px_120px] md:items-center"><div className="font-mono text-lg font-black text-white">{formatTime(session.scheduled_start)}</div><div><p className="font-bold text-white">{patrolSessionLabel(session)}</p><p className="text-xs text-slate-500">{session.patrol_routes?.name || 'Route pending'}</p></div><div className="text-sm text-slate-300">{siteName(session)}</div><div className="font-mono text-xs text-cyan-200">{deviceLabel(session)}</div><div><SocProgressBar value={progress.percent} tone={tone as any} /><p className="mt-1 text-xs text-slate-500">{progress.completed}/{progress.total || 0} checkpoints</p></div><StatusBadge status={session.status} /></Link>;
}

function RoutePreview({ session }: { session: any }) {
  if (!session) return <CompactEmpty title="No session selected" body="Select an active patrol or timeline row to preview its checkpoint order." />;
  const checkpoints = sortedCheckpoints(session);
  if (!checkpoints.length) return <CompactEmpty title="No checkpoint sequence" body="This session has no route checkpoint sequence yet." />;
  return <div className="space-y-2"><div className="rounded-lg border border-white/10 bg-black/25 p-3"><p className="font-bold text-white">{patrolSessionLabel(session)}</p><p className="text-xs text-slate-500">{session.patrol_routes?.name || 'Route pending'} - {siteName(session)}</p></div>{checkpoints.slice(0, 10).map((checkpoint, index) => { const complete = !!checkpoint.scanned_at || checkpoint.status === 'completed'; const missed = checkpoint.status === 'missed'; const current = checkpoint.status === 'current' || checkpoint.status === 'in_progress'; const tone = missed ? 'red' : current ? 'blue' : complete ? 'green' : 'neutral'; return <div key={checkpoint.id ?? `${checkpoint.checkpoint_id}-${index}`} className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2.5"><span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-black ${dotTone(tone)}`}>{index + 1}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{checkpointName(checkpoint)}</p><p className="text-xs text-slate-500">{complete ? `Scanned ${formatDateTime(checkpoint.scanned_at)}` : current ? 'Current checkpoint' : missed ? 'Missed' : 'Pending'}</p></div></div>; })}</div>;
}

function AttentionRow({ item }: { item: ReturnType<typeof buildAttentionItems>[number] }) {
  return <Link to={`/live-patrol?session=${item.sessionId}`} className={`block rounded-lg border p-3 ${panelTone(item.tone)}`}><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-current" /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-bold text-white">{item.title}</p><span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{item.time}</span></div><p className="mt-1 text-xs text-slate-300">{item.reason}</p><p className="mt-1 text-xs text-slate-500">{item.device} - {item.site}</p></div></div></Link>;
}

function ActivityRow({ activity }: { activity: ReturnType<typeof buildRecentActivity>[number] }) {
  const Icon = activity.icon;
  return <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/20 p-2.5"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${dotTone(activity.tone)}`}><Icon className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{activity.title}</p><p className="truncate text-xs text-slate-500">{activity.subtitle}</p></div><span className="text-xs text-slate-500">{activity.time}</span></div>;
}

function ConfigTable({ rows, columns, render, empty, actions }: { rows: any[]; columns: string[]; render: (row: any) => string[]; empty: string; actions?: (row: any) => React.ReactNode }) {
  if (!rows.length) return <CompactEmpty title={empty} body="This section uses real Supabase data only. No demo records are shown." />;
  const headers = actions ? [...columns, 'Actions'] : columns;
  return <div className="overflow-auto"><table className="w-full min-w-[860px] text-left text-sm"><thead className="border-b border-white/10 text-[10px] font-black uppercase tracking-wider text-slate-500"><tr>{headers.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}</tr></thead><tbody className="divide-y divide-white/5">{rows.map((row) => <tr key={row.id} className="hover:bg-white/[0.03]">{render(row).map((value, index) => <td key={index} className="px-3 py-3 text-slate-300">{value}</td>)}{actions ? <td className="px-3 py-3">{actions(row)}</td> : null}</tr>)}</tbody></table></div>;
}


function TabNav({ active, onChange }: { active: Tab; onChange: (tab: Tab) => void }) {
  const tabs: { id: Tab; label: string; icon: any }[] = [{ id: 'operations', label: 'Operations', icon: Radio }, { id: 'templates', label: 'Templates', icon: FileText }, { id: 'routes', label: 'Routes', icon: Route }, { id: 'schedules', label: 'Schedules', icon: CalendarClock }];
  return <div className="flex flex-wrap gap-2 rounded-xl border border-white/10 bg-slate-950/72 p-2">{tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => onChange(id)} className={`inline-flex h-10 items-center gap-2 rounded-lg px-3 text-xs font-black uppercase tracking-wider transition ${active === id ? 'bg-emerald-500/18 text-emerald-200 shadow-[0_0_18px_rgba(34,197,94,0.12)]' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>)}</div>;
}
function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[] }) { const uniqueOptions = Array.from(new Set(options.filter(Boolean))); return <label className="flex h-11 items-center gap-2 rounded-lg border border-white/10 bg-slate-950/80 px-3"><span className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-200 outline-none">{uniqueOptions.map((option) => <option key={option} value={option} className="bg-slate-950">{option === 'all' ? `All ${label}s` : prettify(option)}</option>)}</select></label>; }
function StatusBadge({ status }: { status?: string | null }) { const tone = statusTone(status); return <span className={`inline-flex w-fit rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${badgeTone(tone)}`}>{prettify(status || 'unknown')}</span>; }
function LiveMiniBadge() { return <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300"><span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />Live</span>; }
function CompactEmpty({ title, body }: { title: string; body: string }) { return <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-6 text-center"><p className="font-bold text-white">{title}</p><p className="mt-2 text-sm text-slate-400">{body}</p></div>; }
function LoadingRows({ label }: { label: string }) { return <div className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/60 text-sm text-slate-400"><Loader2 className="h-4 w-4 animate-spin" />{label}</div>; }
function InfoLine({ label, value }: { label: string; value: string }) { return <div className="flex justify-between gap-3"><span className="text-slate-500">{label}</span><span className="text-right font-semibold text-slate-200">{value}</span></div>; }
function MiniMetric({ label, value }: { label: string; value: string }) { return <div className="rounded-lg border border-white/10 bg-black/20 p-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 truncate font-semibold text-slate-200">{value}</p></div>; }

function buildAttentionItems(sessions: any[]) { return sessions.filter((session) => missedStatuses.has(session.status) || lateStatuses.has(session.status) || isPastAwaitingStart(session)).map((session) => ({ id: `attention-${session.id}`, sessionId: session.id, title: patrolSessionLabel(session), reason: missedStatuses.has(session.status) ? 'Patrol was missed or left incomplete' : lateStatuses.has(session.status) ? 'Patrol is running late' : 'Session is awaiting start beyond the scheduled window', device: deviceLabel(session), site: siteName(session), tone: missedStatuses.has(session.status) ? 'red' as Tone : 'amber' as Tone, time: formatTime(session.updated_at ?? session.scheduled_start) })); }
function buildRecentActivity(sessions: any[]) { return sessions.slice().sort((a, b) => new Date(b.last_scan_at ?? b.updated_at ?? b.created_at ?? 0).getTime() - new Date(a.last_scan_at ?? a.updated_at ?? a.created_at ?? 0).getTime()).map((session) => { const progress = patrolSessionProgress(session); if (completedStatuses.has(session.status)) return { id: `activity-complete-${session.id}`, title: 'Patrol completed', subtitle: `${patrolSessionLabel(session)} - ${deviceLabel(session)}`, time: relativeTime(session.actual_end ?? session.updated_at), icon: CheckCircle2, tone: 'green' as Tone }; if (session.last_scan_at) return { id: `activity-scan-${session.id}`, title: 'Checkpoint progress updated', subtitle: `${progress.completed}/${progress.total || 0} checkpoints - ${patrolSessionLabel(session)}`, time: relativeTime(session.last_scan_at), icon: ListChecks, tone: 'blue' as Tone }; if (missedStatuses.has(session.status)) return { id: `activity-missed-${session.id}`, title: 'Patrol requires attention', subtitle: `${patrolSessionLabel(session)} - ${siteName(session)}`, time: relativeTime(session.updated_at ?? session.scheduled_end), icon: AlertTriangle, tone: 'red' as Tone }; return { id: `activity-session-${session.id}`, title: 'Patrol session generated', subtitle: `${patrolSessionLabel(session)} - ${siteName(session)}`, time: relativeTime(session.created_at ?? session.scheduled_start), icon: CalendarClock, tone: 'neutral' as Tone }; }); }
function sortedCheckpoints(session: any) { return [...(session?.patrol_session_checkpoints ?? [])].sort((a, b) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0)); }
function checkpointName(checkpoint: any) { return checkpoint?.checkpoints?.name ?? checkpoint?.checkpoint_name ?? checkpoint?.name ?? ''; }
function siteName(session: any) { return session?.sites?.name || session?.site_name || 'Unassigned site'; }
function deviceLabel(session: any) { return session?.device_name || session?.devices?.device_name || session?.devices?.name || session?.device_identifier || session?.device_id || 'Unassigned device'; }
function elapsedLabel(session: any) { const start = session.actual_start ?? session.started_at; return start ? formatDistanceToNow(new Date(start)) : 'Not started'; }
function isPastAwaitingStart(session: any) { const start = new Date(session.scheduled_start ?? 0).getTime(); return ['awaiting_start', 'scheduled'].includes(session.status) && Number.isFinite(start) && start > 0 && Date.now() > start; }
function statusTone(status?: string | null): Tone { if (completedStatuses.has(status ?? '')) return 'green'; if (activeStatuses.has(status ?? '')) return 'blue'; if (lateStatuses.has(status ?? '')) return 'amber'; if (missedStatuses.has(status ?? '')) return 'red'; return 'neutral'; }
function panelTone(tone: Tone) { if (tone === 'red') return 'border-red-400/25 bg-red-500/10 text-red-200 shadow-[0_0_24px_rgba(239,68,68,0.10)]'; if (tone === 'amber') return 'border-amber-400/25 bg-amber-500/10 text-amber-200 shadow-[0_0_24px_rgba(245,158,11,0.10)]'; if (tone === 'blue') return 'border-cyan-400/25 bg-cyan-500/10 text-cyan-200 shadow-[0_0_24px_rgba(14,165,233,0.10)]'; if (tone === 'green') return 'border-emerald-400/25 bg-emerald-500/10 text-emerald-200 shadow-[0_0_24px_rgba(34,197,94,0.10)]'; return 'border-white/10 bg-black/25 text-slate-300'; }
function badgeTone(tone: Tone) { if (tone === 'red') return 'border-red-400/30 bg-red-400/10 text-red-300'; if (tone === 'amber') return 'border-amber-400/30 bg-amber-400/10 text-amber-300'; if (tone === 'blue') return 'border-blue-400/30 bg-blue-400/10 text-blue-300'; if (tone === 'green') return 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300'; return 'border-white/10 bg-white/5 text-slate-300'; }
function dotTone(tone: Tone) { if (tone === 'red') return 'bg-red-400/15 text-red-300'; if (tone === 'amber') return 'bg-amber-400/15 text-amber-300'; if (tone === 'blue') return 'bg-blue-400/15 text-blue-300'; if (tone === 'green') return 'bg-emerald-400/15 text-emerald-300'; return 'bg-white/10 text-slate-300'; }
function formatDateTime(value?: string | null) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : format(date, 'MMM d HH:mm'); }
function formatTime(value?: string | null) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : format(date, 'HH:mm'); }
function relativeTime(value?: string | null) { if (!value) return '-'; const date = new Date(value); return Number.isNaN(date.getTime()) ? '-' : formatDistanceToNow(date, { addSuffix: true }); }
function prettify(value: string) { return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()); }






function findDevice(session: any, devices: any[]) {
  return devices.find((device) => session.device_identifier && device.device_identifier === session.device_identifier) ?? devices.find((device) => session.device_id && device.id === session.device_id) ?? null;
}

function deviceLabelFromDevice(device: any, session: any) {
  return displayDeviceLabel(device?.device_name || session?.device_name || session?.device_identifier || session?.device_id || 'Unassigned device');
}

function displayDeviceLabel(value: string) {
  if (!value) return 'Unassigned device';
  if (value.startsWith('mxp-')) return `RG360-${value.slice(-6).toUpperCase()}`;
  return value;
}

function siteNameFromDevice(session: any, device: any) {
  return session?.sites?.name || device?.sites?.name || session?.site_name || 'Unassigned site';
}

function currentCheckpointName(session: any) {
  const checkpoints = sortedCheckpoints(session);
  const current = checkpoints.find((checkpoint) => checkpoint.status === 'current' || checkpoint.status === 'in_progress') ?? [...checkpoints].reverse().find((checkpoint) => checkpoint.scanned_at || checkpoint.status === 'completed' || checkpoint.status === 'scanned');
  return checkpointName(current);
}

function nextCheckpointName(session: any) {
  const next = sortedCheckpoints(session).find((checkpoint) => !checkpoint.scanned_at && !['completed', 'scanned', 'missed', 'skipped'].includes(String(checkpoint.status)));
  return checkpointName(next);
}

function etaLabel(session: any) {
  const next = nextCheckpointName(session);
  if (!next) return '-';
  const progress = patrolSessionProgress(session);
  const remaining = Math.max(Number(progress.total || 0) - Number(progress.completed || 0), 0);
  if (!remaining) return '-';
  return `${Math.max(remaining * 3, 3)} min`;
}

function movingStatus(session: any) {
  if (['active', 'in_progress'].includes(String(session.status)) && session.last_scan_at && Date.now() - new Date(session.last_scan_at).getTime() < 2 * 60000) return 'moving';
  return session.status || 'scheduled';
}

function lastActivityLabel(session: any) {
  return relativeTime(session.last_scan_at ?? session.actual_start ?? session.updated_at ?? session.scheduled_start);
}

function countdown(value?: string | null) {
  if (!value) return 'Soon';
  const minutes = Math.round((new Date(value).getTime() - Date.now()) / 60000);
  if (minutes <= 0) return 'Due now';
  if (minutes < 60) return `In ${minutes} min`;
  return `In ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function solidDotTone(tone: Tone) {
  if (tone === 'red') return 'bg-red-400';
  if (tone === 'amber') return 'bg-amber-400';
  if (tone === 'blue') return 'bg-blue-400';
  if (tone === 'green') return 'bg-emerald-400';
  return 'bg-slate-500';
}
