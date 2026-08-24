import { useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Bot, Lock, MapPin, Send, ShieldCheck, Smartphone, UserCog, X } from 'lucide-react';
import { TTechMxPatrolLogo } from '@/components/branding/TTechMxPatrolLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { useSites } from '@/hooks/useSites';
import { useAlerts, useDevices, useIncidents, useScanLogs, useCheckpoints } from '@/hooks/useDashboardData';
import { useReportJobs } from '@/hooks/useReports';
import { supabase } from '@/integrations/supabase/client';
import { LiveSecureDeviceManagementPanel } from '@/components/command-center/LiveSecureDeviceManagementPanel';
import {
  ASSISTANT_MENUS,
  MANAGEMENT_HOME,
  USER_HOME,
  homeMenu,
  menuNode,
  resolveAssistantInput,
  type AssistantMode,
  type RouterState,
} from '@/lib/assistantMenus';
import {
  PATROL_STATUS_GROUPS,
  assistantDate,
  assistantTime,
  describePatrol,
  type AssistantPatrolRow,
} from '@/lib/assistantPatrolFormat';
import {
  advanceWorkflow,
  isWorkflowAction,
  startWorkflow,
  type WorkflowContext,
  type WorkflowOption,
  type WorkflowReply,
  type WorkflowState,
} from '@/lib/assistantWorkflows';

type Message = { id: number; from: 'assistant' | 'user'; title?: string; body: ReactNode };
type SessionRow = AssistantPatrolRow & { patrol_routes?: { name: string } | null; patrol_templates?: { name: string } | null; sites?: { name: string } | null };
type MissedCheckpointRow = {
  id: string;
  status: string | null;
  scheduled_at: string | null;
  scheduled_order: number | null;
  checkpoint_name_snapshot: string | null;
  checkpoints?: { name: string } | null;
  patrol_sessions?: { id: string; status: string | null; scheduled_start: string | null; site_id: string | null; patrol_routes?: { name: string } | null; sites?: { name: string } | null } | null;
};

const PERIODS: Record<string, { label: string; from: () => Date; to: () => Date; range: string }> = {
  today: { label: 'Today', range: 'today', from: () => startOfDay(0), to: () => new Date() },
  yesterday: { label: 'Yesterday', range: '7d', from: () => startOfDay(1), to: () => startOfDay(0) },
  week: { label: 'This Week', range: '7d', from: () => startOfDay(7), to: () => new Date() },
};

function startOfDay(daysAgo: number) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date;
}

function named(row: SessionRow): AssistantPatrolRow {
  return { ...row, patrol_name: row.patrol_routes?.name ?? row.patrol_templates?.name ?? 'Patrol', site_name: row.sites?.name ?? null };
}

export default function CommandCenter() {
  const { user } = useAuth();
  const { canManage, role } = useUserRole();
  const { data: sites = [] } = useSites();
  const queryClient = useQueryClient();
  const [state, setState] = useState<RouterState>({ mode: 'user', activeMenu: USER_HOME, activeSiteId: null });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inlinePanel, setInlinePanel] = useState<ReactNode | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);

  const activeSite = sites.find((site) => site.id === state.activeSiteId) ?? sites[0] ?? null;
  const selectedSiteId = activeSite?.id ?? null;
  const selectedSite = activeSite?.name ?? 'No site assigned';
  const mode: AssistantMode = state.mode;

  const devices = useDevices(selectedSiteId ?? 'all');
  const alerts = useAlerts();
  const incidents = useIncidents();
  const scans = useScanLogs(selectedSiteId ?? 'all');
  const checkpoints = useCheckpoints(selectedSiteId ?? 'all');
  const reportJobs = useReportJobs();

  const configOptions = useQuery({
    queryKey: ['assistant_workflow_options', selectedSiteId],
    enabled: !!selectedSiteId && canManage,
    queryFn: async () => {
      const [routes, forms] = await Promise.all([
        supabase.from('patrol_routes').select('id, name').eq('site_id', selectedSiteId!).eq('status', 'active').order('name'),
        supabase.from('data_log_forms').select('id, name').eq('is_active', true).order('name'),
      ]);
      if (routes.error) throw routes.error;
      if (forms.error) throw forms.error;
      return { routes: routes.data ?? [], forms: forms.data ?? [] };
    },
  });


  const patrols = useQuery({
    queryKey: ['assistant_patrol_sessions', selectedSiteId],
    enabled: !!selectedSiteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patrol_sessions')
        .select('id, status, scheduled_start, scheduled_end, actual_start, finalized_at, checkpoint_completed, checkpoint_total, site_id, patrol_routes(name), patrol_templates(name), sites(name)')
        .eq('site_id', selectedSiteId!)
        .order('scheduled_start', { ascending: false })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as unknown as SessionRow[]).map(named);
    },
  });

  const missedCheckpoints = useQuery({
    queryKey: ['assistant_missed_checkpoints', selectedSiteId],
    enabled: !!selectedSiteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patrol_session_checkpoints')
        .select('id, status, scheduled_at, scheduled_order, checkpoint_name_snapshot, checkpoints(name), patrol_sessions!inner(id, status, scheduled_start, site_id, patrol_routes(name), sites(name))')
        .in('status', ['missed', 'overdue'])
        .eq('patrol_sessions.site_id', selectedSiteId!)
        .order('scheduled_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as MissedCheckpointRow[];
    },
  });

  const siteDevices = devices.data ?? [];
  const siteAlerts = (alerts.data ?? []).filter((row: any) => !selectedSiteId || row.site_id === selectedSiteId);
  const siteIncidents = (incidents.data ?? []).filter((row: any) => !selectedSiteId || row.site_id === selectedSiteId);
  const sitePatrols = patrols.data ?? [];
  const siteScans = scans.data ?? [];
  const siteReportJobs = (reportJobs.data ?? []).filter((job) => !selectedSiteId || job.site_id === selectedSiteId || job.site_id === null);

  const addAssistant = (title: string, body: ReactNode) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'assistant', title, body }]);
  const addUser = (body: string) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'user', body }]);

  const workflowContext: WorkflowContext = useMemo(() => ({
    siteId: selectedSiteId,
    siteName: selectedSite,
    canManage,
    checkpoints: ((checkpoints.data ?? []) as any[]).map((row) => ({ id: String(row.id), name: String(row.name) })),
    routes: (configOptions.data?.routes ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name) })),
    forms: (configOptions.data?.forms ?? []).map((row: any) => ({ id: String(row.id), name: String(row.name) })),
  }), [selectedSiteId, selectedSite, canManage, checkpoints.data, configOptions.data]);

  /** Runs the canonical management service shared with the WhatsApp Management AI. */
  const runManagementAction = async (payload: { action: string; input: Record<string, unknown> }) => {
    const { data, error } = await supabase.functions.invoke('management-actions', { body: payload });
    if (error) {
      let detail = error.message;
      const context = (error as any)?.context;
      if (context && typeof context.text === 'function') {
        const raw = await context.text().catch(() => '');
        try { detail = JSON.parse(raw)?.error ?? detail; } catch { detail = raw || detail; }
      }
      throw new Error(detail);
    }
    if ((data as any)?.error) throw new Error((data as any).error);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['devices'] }),
      queryClient.invalidateQueries({ queryKey: ['incidents'] }),
      queryClient.invalidateQueries({ queryKey: ['checkpoints'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant_config'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant_workflow_options'] }),
    ]);
    return data as { summary: string; duplicate: boolean; record: Record<string, unknown> };
  };

  const showWorkflowReply = (reply: WorkflowReply) => {
    if (reply.kind === 'cancelled' || reply.kind === 'denied') {
      setWorkflow(null);
      return addAssistant(reply.title, <WorkflowBody lines={reply.lines} />);
    }
    if (reply.kind === 'confirm') {
      setWorkflow(reply.state);
      setPendingConfirm({
        label: 'Save this record to MX Patrol?',
        run: async () => {
          const result = await runManagementAction(reply.payload);
          setWorkflow(null);
          addAssistant(result.duplicate ? 'ALREADY SAVED' : 'SAVED', (
            <div>
              <p>{result.summary}</p>
              <p className='mt-2 text-slate-400'>Reference: {String(result.record?.reference ?? result.record?.id ?? '')}</p>
            </div>
          ));
        },
      });
      return addAssistant(reply.title, <WorkflowBody lines={reply.lines} />);
    }
    setWorkflow(reply.state);
    return addAssistant(reply.title, <WorkflowBody lines={reply.lines} options={reply.options} />);
  };


  const showMenu = (key: string) => {
    const node = menuNode(key);
    addAssistant(node.title, <MenuView site={selectedSite} node={node} />);
  };

  const periodRows = (period: keyof typeof PERIODS) => {
    const from = PERIODS[period].from().getTime();
    const to = PERIODS[period].to().getTime();
    const within = (iso: string | null | undefined) => {
      if (!iso) return false;
      const value = new Date(iso).getTime();
      return value >= from && value <= to;
    };
    return {
      sessions: sitePatrols.filter((row) => within(row.scheduled_start)),
      scans: siteScans.filter((row: any) => within(row.scanned_at)),
      incidents: siteIncidents.filter((row: any) => within(row.created_at)),
      alerts: siteAlerts.filter((row: any) => within(row.created_at)),
    };
  };

  const runReportPeriod = (period: keyof typeof PERIODS) => {
    const rows = periodRows(period);
    const completed = rows.sessions.filter((row) => PATROL_STATUS_GROUPS.completed.includes(String(row.status) as never)).length;
    const missed = rows.sessions.filter((row) => row.status === 'missed').length;
    const missedCps = rows.sessions.reduce((total, row) => total + Math.max((row.checkpoint_total ?? 0) - (row.checkpoint_completed ?? 0), 0), 0);
    addAssistant(`${PERIODS[period].label.toUpperCase()} REPORT - ${selectedSite}`, (
      <div>
        <MetricGrid items={[['Patrols scheduled', rows.sessions.length], ['Completed', completed], ['Missed patrols', missed], ['Missed checkpoints', missedCps], ['Checkpoint scans', rows.scans.length], ['Incidents', rows.incidents.length], ['SOS alerts', rows.alerts.filter((row: any) => row.type === 'panic_button').length]]} />
        {rows.sessions.length ? <PatrolList rows={rows.sessions.slice(0, 6)} /> : <p className='mt-3'>No patrol sessions scheduled for this period at {selectedSite}.</p>}
      </div>
    ));
  };

  const runAction = (action: string) => {
    if (action === 'change_site') return addAssistant('CHANGE SITE', <SitePicker sites={sites} selectedId={selectedSiteId} onSelect={(site) => { setState((prev) => ({ ...prev, activeSiteId: site.id })); addAssistant('ACTIVE SITE UPDATED', <p>Now viewing <b>{site.name}</b>. All results are scoped to this site.</p>); }} />);
    if (action === 'live') return addAssistant('LIVE NOW - ' + selectedSite, <Summary devices={siteDevices} alerts={siteAlerts} incidents={siteIncidents} patrols={sitePatrols} scans={siteScans} />);
    if (action === 'attention') return addAssistant('ATTENTION - ' + selectedSite, <Attention devices={siteDevices} alerts={siteAlerts} patrols={sitePatrols} />);
    if (action === 'devices') return addAssistant('DEVICES - ' + selectedSite, <DeviceList devices={siteDevices} />);
    if (action === 'devices_offline') return addAssistant('OFFLINE DEVICES - ' + selectedSite, <DeviceList devices={siteDevices} offlineOnly />);
    if (action === 'incidents') return addAssistant('INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents} />);
    if (action === 'incidents_open') return addAssistant('OPEN INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => !row.resolved)} />);
    if (action === 'incidents_high') return addAssistant('HIGH PRIORITY INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => ['high', 'critical'].includes(String(row.severity)))} />);
    if (action === 'incidents_resolved') return addAssistant('RESOLVED INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => row.resolved)} />);
    if (action === 'checkpoints') return addAssistant('CHECKPOINTS - ' + selectedSite, <CheckpointList rows={checkpoints.data ?? []} />);
    if (action === 'pending_nfc') return addAssistant('PENDING NFC ASSIGNMENT - ' + selectedSite, <CheckpointList rows={(checkpoints.data ?? []).filter((row: any) => !row.nfc_tag_id)} />);
    if (action === 'patrol_status') return addAssistant('PATROL STATUS - ' + selectedSite, <PatrolList rows={sitePatrols.slice(0, 8)} />);
    if (action === 'completed_patrols') return addAssistant('COMPLETED PATROLS - ' + selectedSite, <PatrolList rows={filterPatrols(sitePatrols, 'completed')} />);
    if (action === 'incomplete_patrols') return addAssistant('INCOMPLETE PATROLS - ' + selectedSite, <PatrolList rows={filterPatrols(sitePatrols, 'incomplete')} variant='incomplete' />);
    if (action === 'late_patrols') return addAssistant('LATE / DELAYED PATROLS - ' + selectedSite, <PatrolList rows={filterPatrols(sitePatrols, 'late')} variant='late' />);
    if (action === 'missed_patrols') return addAssistant('MISSED PATROLS - ' + selectedSite, <PatrolList rows={filterPatrols(sitePatrols, 'missed')} variant='missed' />);
    if (action === 'missed_checkpoints') return addAssistant('MISSED CHECKPOINTS - ' + selectedSite, <MissedCheckpointList rows={missedCheckpoints.data ?? []} loading={missedCheckpoints.isLoading} />);
    if (action === 'routes' || action === 'schedules') return addAssistant(action === 'routes' ? 'PATROL ROUTES' : 'PATROL SCHEDULES', <ConfigList kind={action} siteId={selectedSiteId} />);
    if (action.startsWith('report:')) return runReportPeriod(action.slice(7) as keyof typeof PERIODS);
    if (action === 'saved_reports') return addAssistant('SAVED REPORTS - ' + selectedSite, <SavedReports jobs={siteReportJobs} loading={reportJobs.isLoading} />);
    if (action === 'generate_report') {
      setPendingConfirm({
        label: `Generate a daily patrol report for ${selectedSite}?`,
        run: async () => {
          const { data, error } = await supabase.functions.invoke('generate-report', {
            body: { report_type: 'daily', site_id: selectedSiteId, date_range: 'today' },
          });
          if (error) throw new Error(error.message);
          if ((data as any)?.error) throw new Error((data as any).error);
          await queryClient.invalidateQueries({ queryKey: ['report_jobs'] });
          await queryClient.invalidateQueries({ queryKey: ['ai_reports'] });
          addAssistant('REPORT GENERATED', <p>The patrol report for <b>{selectedSite}</b> is generated. Open <b>Saved Reports</b> to read it.</p>);
        },
      });
      return addAssistant('CONFIRM REPORT GENERATION', <p>This runs the MX Patrol report backend for <b>{selectedSite}</b>. Confirm below.</p>);
    }
    if (action === 'secure_devices') {
      setInlinePanel(<LiveSecureDeviceManagementPanel selectedSite={selectedSite} siteId={selectedSiteId} />);
      return addAssistant('SECURE PATROL DEVICES', <p>Secure device controls are open below. Every command requires confirmation and is queued by the backend.</p>);
    }
    if (isWorkflowAction(action)) {
      if (!canManage) return addAssistant('MANAGEMENT ACCESS REQUIRED', <p>Your account ({role}) does not have permission for management actions.</p>);
      return showWorkflowReply(startWorkflow(action, workflowContext));
    }
    return showMenu(state.activeMenu);
  };

  const submit = (raw?: string) => {
    const text = (raw ?? input).trim();
    if (!text) return;
    if (!raw) setInput('');
    addUser(text);

    if (pendingConfirm && /^(yes|confirm|y)$/i.test(text)) {
      const job = pendingConfirm;
      setPendingConfirm(null);
      void job.run().catch((error) => addAssistant('ACTION FAILED', <p>{error instanceof Error ? error.message : 'Unknown error'}</p>));
      return;
    }
    if (pendingConfirm && /^(no|cancel)$/i.test(text)) {
      setPendingConfirm(null);
      setWorkflow(null);
      addAssistant('CANCELLED', <p>Nothing was changed. No partial record was created.</p>);
      return;
    }

    if (workflow) {
      return showWorkflowReply(advanceWorkflow(workflow, text, workflowContext));
    }


    const result = resolveAssistantInput(state, text, { canManage });
    setState(result.state);

    if (result.kind === 'menu') {
      if (result.state.mode !== state.mode) setInlinePanel(null);
      return showMenu(result.menuKey);
    }
    if (result.kind === 'denied') {
      return addAssistant('MANAGEMENT ACCESS REQUIRED', <p>Your account ({role}) does not have permission for management actions.</p>);
    }
    if (result.kind === 'unknown') {
      return addAssistant(menuNode(result.state.activeMenu).title, <div><p>I didn't understand that. Reply with a number from this menu.</p><MenuView site={selectedSite} node={menuNode(result.state.activeMenu)} /></div>);
    }
    return runAction(result.action);
  };

  const switchMode = () => submit(mode === 'management' ? 'user' : 'management');
  const homeNode = menuNode(homeMenu(mode));

  return <div className='min-h-screen bg-[#030811] text-white'><div className='mx-auto flex min-h-screen max-w-6xl flex-col px-3 py-3 sm:px-4'><header className='mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-slate-950/80 px-4 py-3'><TTechMxPatrolLogo variant='header' priority className='w-44' /><div className='flex flex-wrap items-center gap-2'><label className='flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100'><MapPin className='h-4 w-4' /><select value={selectedSiteId ?? ''} onChange={(event) => setState((prev) => ({ ...prev, activeSiteId: event.target.value }))} className='bg-transparent font-semibold outline-none'>{sites.map((site) => <option key={site.id} value={site.id} className='bg-slate-950'>{site.name}</option>)}</select></label><span className='inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 text-sm font-semibold text-emerald-200'><span className='h-2 w-2 rounded-full bg-emerald-400' /> Online</span><span className='inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 text-sm font-semibold text-cyan-100'>{mode === 'management' ? <UserCog className='h-4 w-4' /> : <Bot className='h-4 w-4' />}{mode === 'management' ? 'Management' : 'User AI'}</span></div></header><main className='flex min-h-0 flex-1 flex-col rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_30%),linear-gradient(145deg,rgba(2,6,23,0.96),rgba(3,12,24,0.98))]'><section className='border-b border-cyan-400/15 p-4'><p className='text-xs font-black uppercase tracking-[0.16em] text-emerald-300'>{mode === 'management' ? 'Management Web AI Assistant' : 'User Web AI Assistant'}</p><h1 className='mt-2 text-2xl font-black'>{mode === 'management' ? 'Authorized management access' : 'Ask MX Patrol what you need'}</h1><p className='mt-1 text-sm text-slate-400'>Signed in as {user?.email ?? role}. Active site: {selectedSite}.</p></section><section className='grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]'><div className='flex min-h-[34rem] flex-col rounded-2xl border border-white/10 bg-slate-950/60'><div className='flex-1 space-y-3 overflow-y-auto p-4'><AssistantBubble title={homeNode.title}><MenuView site={selectedSite} node={homeNode} /></AssistantBubble>{messages.map((message) => message.from === 'user' ? <UserBubble key={message.id}>{message.body}</UserBubble> : <AssistantBubble key={message.id} title={message.title ?? 'MX PATROL'}>{message.body}</AssistantBubble>)}{pendingConfirm ? <div className='rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100'><p className='font-bold'>{pendingConfirm.label}</p><div className='mt-2 flex gap-2'><button type='button' onClick={() => submit('confirm')} className='rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 font-semibold text-emerald-200'>Confirm</button><button type='button' onClick={() => submit('cancel')} className='rounded-xl border border-white/10 px-3 py-2 font-semibold text-slate-300'>Cancel</button></div></div> : null}{inlinePanel ? <div className='rounded-2xl border border-emerald-400/25'>{inlinePanel}</div> : null}</div><div className='border-t border-white/10 p-3'><div className='flex items-center gap-3'><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} className='h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm text-white outline-none placeholder:text-slate-500' placeholder={mode === 'management' ? 'Type a number or management command...' : 'Type a number or ask MX Patrol...'} /><button onClick={() => submit()} className='flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]' aria-label='Send'><Send className='h-5 w-5' /></button></div><p className='mt-2 text-center text-[11px] text-slate-500'>Reply with the number shown in the current menu. Type back, menu or cancel any time.</p></div></div><aside className='space-y-3'>{mode === 'management' || canManage ? <Shortcut onClick={switchMode} icon={mode === 'management' ? Bot : Lock} label={mode === 'management' ? 'User Assistant' : 'Management'} /> : null}<Shortcut onClick={() => submit('live now')} icon={ShieldCheck} label='Live Now' /><Shortcut onClick={() => submit('which devices are offline')} icon={Smartphone} label='Offline Devices' /><Shortcut onClick={() => { setInlinePanel(null); submit('menu'); }} icon={X} label='Close Inline Panel' /><div className='rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300'><p className='font-black uppercase tracking-[0.12em] text-emerald-300'>Hidden system</p><p className='mt-2 leading-6'>Dashboard, map, patrols, routes, schedules and admin tools stay behind assistant actions.</p></div></aside></section></main></div></div>;
}

function WorkflowBody({ lines, options }: { lines: string[]; options?: WorkflowOption[] }) {
  return (
    <div>
      {lines.map((line, index) => <p key={line + index} className={index === 0 ? '' : 'mt-1'}>{line}</p>)}
      {options?.length ? <NumberList items={options.map((option) => option.label)} /> : null}
      <p className='mt-3 text-[11px] uppercase tracking-[0.12em] text-slate-500'>Type cancel to abandon this workflow.</p>
    </div>
  );
}


function filterPatrols(rows: AssistantPatrolRow[], group: keyof typeof PATROL_STATUS_GROUPS) {
  const statuses = PATROL_STATUS_GROUPS[group] as readonly string[];
  return rows.filter((row) => statuses.includes(String(row.status)));
}

function MenuView({ site, node }: { site: string; node: { title: string; items: { label: string }[] } }) {
  return <div><p>Viewing: <b>{site}</b></p><p className='mt-2'>What would you like to do?</p><NumberList items={node.items.map((item) => item.label)} /><p className='mt-3 text-slate-300'>Reply with a number, or type your request.</p></div>;
}
function NumberList({ items }: { items: readonly string[] }) { return <ol className='mt-3 space-y-1'>{items.map((item, index) => <li key={item + index}><span className='text-emerald-300'>{index + 1}.</span> {item}</li>)}</ol>; }
function AssistantBubble({ title, children }: { title: string; children: ReactNode }) { return <div className='max-w-2xl rounded-2xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white'><p className='mb-2 font-black uppercase tracking-[0.08em] text-emerald-300'>{title}</p><div className='leading-6 text-slate-100'>{children}</div></div>; }
function UserBubble({ children }: { children: ReactNode }) { return <div className='ml-auto max-w-xl rounded-2xl bg-emerald-600 px-4 py-3 text-sm text-white'>{children}</div>; }
function Shortcut({ icon: Icon, label, onClick }: { icon: typeof Bot; label: string; onClick: () => void }) { return <button type='button' onClick={onClick} className='flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left text-sm font-semibold text-slate-100 hover:border-emerald-400/30'><span className='flex items-center gap-3'><Icon className='h-5 w-5 text-emerald-300' />{label}</span><ArrowRight className='h-4 w-4 text-slate-500' /></button>; }
function SitePicker({ sites, selectedId, onSelect }: { sites: Array<{ id: string; name: string }>; selectedId: string | null; onSelect: (site: { id: string; name: string }) => void }) { if (!sites.length) return <p>No sites are assigned to your account yet.</p>; return <div className='grid gap-2'>{sites.map((site) => <button key={site.id} onClick={() => onSelect(site)} className={(site.id === selectedId ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-slate-950/70 text-slate-300') + ' rounded-xl border px-3 py-2 text-left'}>{site.name}</button>)}</div>; }
function MetricGrid({ items }: { items: Array<[string, number]> }) { return <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>{items.map(([label, value]) => <div key={label} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><p className='text-2xl font-black text-emerald-300'>{value}</p><p className='text-xs text-slate-400'>{label}</p></div>)}</div>; }
function Summary({ devices, alerts, incidents, patrols, scans }: { devices: any[]; alerts: any[]; incidents: any[]; patrols: AssistantPatrolRow[]; scans: any[] }) { return <MetricGrid items={[['Devices Online', devices.filter((row) => row.status === 'online').length], ['Devices Offline', devices.filter((row) => row.status === 'offline').length], ['Active Patrols', patrols.filter((row) => ['active', 'in_progress'].includes(String(row.status))).length], ['Completed', filterPatrols(patrols, 'completed').length], ['Incidents', incidents.length], ['SOS', alerts.filter((row: any) => row.type === 'panic_button').length], ['Scans', scans.length]]} />; }
function Attention({ devices, alerts, patrols }: { devices: any[]; alerts: any[]; patrols: AssistantPatrolRow[] }) { return <MetricGrid items={[['Open Alerts', alerts.filter((row: any) => !row.is_read).length], ['SOS Alerts', alerts.filter((row: any) => row.type === 'panic_button').length], ['Offline Devices', devices.filter((row) => row.status === 'offline').length], ['Missed Patrols', filterPatrols(patrols, 'missed').length]]} />; }
function DeviceList({ devices, offlineOnly }: { devices: any[]; offlineOnly?: boolean }) { const rows = offlineOnly ? devices.filter((row) => row.status === 'offline') : devices; if (!rows.length) return <p>{offlineOnly ? 'All devices are online.' : 'No devices found for this site.'}</p>; return <div className='space-y-2'>{rows.slice(0, 10).map((device) => <div key={device.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{device.device_identifier ?? device.device_name ?? 'Device'}</b><p className='text-slate-400'>{device.status ?? 'unknown'}</p></div>)}</div>; }
function IncidentList({ rows }: { rows: any[] }) { if (!rows.length) return <p>No incidents match this view for the active site.</p>; return <div className='space-y-2'>{rows.slice(0, 8).map((incident) => <div key={incident.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{incident.title ?? incident.incident_type ?? 'Incident'}</b><p className='text-slate-400'>{incident.severity ?? 'normal'} - {incident.resolved ? 'Resolved' : 'Open'} - {assistantDate(incident.created_at) ?? ''}</p></div>)}</div>; }
function CheckpointList({ rows }: { rows: any[] }) { if (!rows.length) return <p>No checkpoints match this view for the active site.</p>; return <div className='space-y-2'>{rows.slice(0, 12).map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{row.name}</b><p className='text-slate-400'>NFC: {row.nfc_tag_id ? 'Assigned' : 'Awaiting assignment'}</p></div>)}</div>; }

function PatrolList({ rows, variant }: { rows: AssistantPatrolRow[]; variant?: 'missed' | 'late' | 'incomplete' }) {
  if (!rows.length) return <p>No matching patrols for the active site.</p>;
  return <div className='space-y-2'>{rows.slice(0, 10).map((row) => {
    const view = describePatrol(row);
    return <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
      <b>{view.patrol}</b>
      <p className='text-slate-400'>{view.site} · {view.date}</p>
      <p className='text-emerald-200'>Scheduled: {view.scheduledTime}{view.scheduledWindow ? ` (window ${view.scheduledWindow})` : ''}</p>
      <p className='text-slate-300'>Status: {variant === 'missed' ? 'Missed' : view.status}</p>
      {variant === 'late' ? <p className='text-amber-200'>Actual start: {view.actualStart ?? 'not started'}{view.lateBy ? ` · Late by ${view.lateBy}` : ''}</p> : null}
      {variant !== 'missed' ? <p className='text-slate-300'>Checkpoints: {view.checkpoints}{view.missedCheckpoints ? ` · ${view.missedCheckpoints} missed` : ''}</p> : null}
    </div>;
  })}</div>;
}

function MissedCheckpointList({ rows, loading }: { rows: MissedCheckpointRow[]; loading: boolean }) {
  if (loading) return <p>Loading missed checkpoints…</p>;
  if (!rows.length) return <p>No missed checkpoints for the active site.</p>;
  return <div className='space-y-2'>{rows.map((row) => {
    const session = row.patrol_sessions;
    return <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
      <b>{row.checkpoints?.name ?? row.checkpoint_name_snapshot ?? 'Checkpoint'}</b>
      <p className='text-slate-400'>Patrol: {session?.patrol_routes?.name ?? 'Session'} · {session?.sites?.name ?? 'Site'}</p>
      <p className='text-slate-300'>{assistantDate(row.scheduled_at ?? session?.scheduled_start) ?? 'Unknown date'} · Expected: {assistantTime(row.scheduled_at ?? session?.scheduled_start) ?? 'Unknown'}</p>
      <p className='text-rose-200'>Status: {String(row.status ?? 'missed')}</p>
    </div>;
  })}</div>;
}

function SavedReports({ jobs, loading }: { jobs: Array<{ id: string; report_type: string; status: string; date_range: string; created_at: string; sites?: { name: string } | null; ai_reports?: { summary_text: string | null; generated_at: string | null } | null }>; loading: boolean }) {
  if (loading) return <p>Loading reports…</p>;
  if (!jobs.length) return <p>No reports have been generated yet. Choose <b>Generate Patrol Report</b> to create one.</p>;
  return <div className='space-y-2'>{jobs.slice(0, 8).map((job) => <div key={job.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
    <b>{job.report_type.replace(/_/g, ' ')}</b>
    <p className='text-slate-400'>{job.sites?.name ?? 'All sites'} · {job.date_range} · {job.status}</p>
    <p className='text-slate-400'>{assistantDate(job.ai_reports?.generated_at ?? job.created_at)} {assistantTime(job.ai_reports?.generated_at ?? job.created_at)}</p>
    {job.ai_reports?.summary_text ? <p className='mt-1 text-slate-200'>{job.ai_reports.summary_text.slice(0, 400)}</p> : null}
  </div>)}</div>;
}

function ConfigList({ kind, siteId }: { kind: 'routes' | 'schedules'; siteId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ['assistant_config', kind, siteId],
    enabled: !!siteId,
    queryFn: async () => {
      const table = kind === 'routes' ? 'patrol_routes' : 'patrol_schedules';
      const columns = kind === 'routes' ? 'id, name, status' : 'id, name, status, start_time, end_time, frequency_type, next_run_at';
      const { data: rows, error } = await supabase.from(table).select(columns).eq('site_id', siteId!).limit(20);
      if (error) throw error;
      return (rows ?? []) as any[];
    },
  });
  if (isLoading) return <p>Loading…</p>;
  if (!data?.length) return <p>Nothing configured for the active site yet.</p>;
  return <div className='space-y-2'>{data.map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{row.name}</b><p className='text-slate-400'>{row.status ?? 'active'}{row.start_time ? ` · ${row.start_time}${row.end_time ? ` - ${row.end_time}` : ''}` : ''}{row.frequency_type ? ` · ${row.frequency_type}` : ''}</p></div>)}</div>;
}

