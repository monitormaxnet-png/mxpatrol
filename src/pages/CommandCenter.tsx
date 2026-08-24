import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Bot, Lock, MapPin, Send, ShieldCheck, Smartphone, UserCog, X } from 'lucide-react';
import { TTechMxPatrolLogo } from '@/components/branding/TTechMxPatrolLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { useSites } from '@/hooks/useSites';
import { useAlerts, useDevices, useIncidents, useScanLogs } from '@/hooks/useDashboardData';
import { supabase } from '@/integrations/supabase/client';
import { LiveSecureDeviceManagementPanel } from '@/components/command-center/LiveSecureDeviceManagementPanel';

type AssistantMode = 'user' | 'management';
type Message = { id: number; from: 'assistant' | 'user'; title?: string; body: ReactNode };
type PatrolSessionRow = { id: string; status: string | null; checkpoint_completed: number | null; checkpoint_total: number | null; site_id: string | null };

const userItems = ['Live Now', 'Attention', 'Devices', 'Incidents', 'Reports', 'Completed Patrols', 'Incomplete Patrols', 'Late / Delayed Patrols', 'Missed Patrols', 'Missed Checkpoints', 'Change Site', 'Management'];
const managementItems = ['Operations', 'Devices', 'Checkpoints', 'Incidents', 'Patrol Configuration', 'Reports', 'Secure Patrol Devices', 'Change Site', 'User Assistant'];
const managementGroups = {
  operations: ['Live Patrol', 'Patrol Status', 'Completed Patrols', 'Late / Delayed Patrols', 'Incomplete Patrols', 'Missed Patrols', 'Missed Checkpoints', 'Live Map', 'Back'],
  devices: ['Register Device', 'View Devices', 'Offline Devices', 'Device Security', 'Replace Device', 'Back'],
  checkpoints: ['Register Checkpoint', 'View Checkpoints', 'Pending NFC Assignment', 'Unregistered Tags', 'Data Log Forms', 'Back'],
  incidents: ['Register Incident', 'Open Incidents', 'High Priority', 'Resolved Incidents', 'Back'],
  patrols: ['Create Patrol', 'Create Route', 'Create Schedule', 'View Routes', 'View Schedules', 'Back'],
  reports: ['Today Summary', 'Patrol Performance', 'Incident Report', 'Data Log Report', 'Generate Report', 'Back'],
};

export default function CommandCenter() {
  const { user } = useAuth();
  const { canManage, role } = useUserRole();
  const { data: sites = [] } = useSites();
  const [mode, setMode] = useState<AssistantMode>('user');
  const [selectedSite, setSelectedSite] = useState('Airport Junction');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inlinePanel, setInlinePanel] = useState<ReactNode | null>(null);
  const siteChoices = useMemo(() => sites.map((site) => site.name).filter(Boolean), [sites]);
  const visibleSites = siteChoices.length ? siteChoices : ['Airport Junction'];
  const selectedSiteId = sites.find((site) => site.name === selectedSite)?.id ?? null;
  const devices = useDevices(selectedSiteId ?? 'all');
  const alerts = useAlerts();
  const incidents = useIncidents();
  const scans = useScanLogs(selectedSiteId ?? 'all');
  const patrols = useQuery({
    queryKey: ['assistant_patrol_sessions', selectedSiteId],
    queryFn: async () => {
      let query = supabase.from('patrol_sessions').select('id, status, checkpoint_completed, checkpoint_total, site_id').limit(80);
      if (selectedSiteId) query = query.eq('site_id', selectedSiteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolSessionRow[];
    },
  });

  const addAssistant = (title: string, body: ReactNode) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'assistant', title, body }]);
  const addUser = (body: string) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'user', body }]);
  const siteDevices = devices.data ?? [];
  const siteAlerts = (alerts.data ?? []).filter((row: any) => !selectedSiteId || row.site_id === selectedSiteId);
  const siteIncidents = (incidents.data ?? []).filter((row: any) => !selectedSiteId || row.site_id === selectedSiteId);
  const sitePatrols = patrols.data ?? [];
  const siteScans = scans.data ?? [];

  const switchToUser = () => {
    setMode('user');
    setInlinePanel(null);
    addAssistant('USER AI ASSISTANT', <Menu site={selectedSite} items={userItems} />);
  };

  const switchToManagement = () => {
    if (!canManage) {
      addAssistant('MANAGEMENT ACCESS REQUIRED', <div><p>Your account does not have permission to use management controls.</p><SmallButton onClick={switchToUser}>Return to User Assistant</SmallButton></div>);
      return;
    }
    setMode('management');
    setInlinePanel(null);
    addAssistant('MANAGEMENT AI ASSISTANT', <Menu site={selectedSite} items={managementItems} />);
  };

  const userResponse = (value: string) => {
    if (value === '12' || value.includes('management') || value.includes('admin')) return switchToManagement();
    if (value === '11' || value.includes('change site')) return addAssistant('CHANGE SITE', <SitePicker sites={visibleSites} selected={selectedSite} onSelect={setSelectedSite} />);
    if (value === '1' || value.includes('live') || value.includes('summary') || value.includes('report')) return addAssistant('SITE SUMMARY - ' + selectedSite, <Summary devices={siteDevices} alerts={siteAlerts} incidents={siteIncidents} patrols={sitePatrols} scans={siteScans} />);
    if (value === '2' || value.includes('attention') || value.includes('problem')) return addAssistant('ATTENTION - ' + selectedSite, <Attention devices={siteDevices} alerts={siteAlerts} patrols={sitePatrols} />);
    if (value === '3' || value.includes('device')) return addAssistant('DEVICES - ' + selectedSite, <Devices devices={siteDevices} offlineOnly={value.includes('offline')} />);
    if (value === '4' || value.includes('incident')) return addAssistant('INCIDENTS - ' + selectedSite, <Incidents rows={siteIncidents} />);
    if (value === '6' || value.includes('completed')) return addAssistant('COMPLETED PATROLS', <Patrols rows={sitePatrols} statuses={['completed', 'completed_late']} />);
    if (value === '7' || value.includes('incomplete')) return addAssistant('INCOMPLETE PATROLS', <Patrols rows={sitePatrols} statuses={['incomplete']} />);
    if (value === '8' || value.includes('late') || value.includes('delayed')) return addAssistant('LATE / DELAYED PATROLS', <Patrols rows={sitePatrols} statuses={['late', 'late_start', 'delayed', 'completed_late']} />);
    if (value === '9' || value.includes('missed patrol')) return addAssistant('MISSED PATROLS', <Patrols rows={sitePatrols} statuses={['missed']} />);
    if (value === '10' || value.includes('missed checkpoint')) return addAssistant('MISSED CHECKPOINTS', <p>{missedCheckpointCount(sitePatrols)} checkpoint(s) missed or incomplete for this site.</p>);
    addAssistant('MX PATROL', <Menu site={selectedSite} items={userItems} />);
  };

  const managementResponse = (value: string) => {
    if (value === '9' || value.includes('user')) return switchToUser();
    if (value === '8' || value.includes('change site')) return addAssistant('CHANGE SITE', <SitePicker sites={visibleSites} selected={selectedSite} onSelect={setSelectedSite} />);
    if (value === '1' || value.includes('operation')) return addAssistant('OPERATIONS', <NumberList items={managementGroups.operations} />);
    if (value === '2' || value === 'devices') return addAssistant('DEVICES', <NumberList items={managementGroups.devices} />);
    if (value === '3' || value.includes('checkpoint')) return addAssistant('CHECKPOINTS', <InlineWorkflow title='Checkpoint registration' steps={['Checkpoint Name', 'Zone / Location', 'Site', 'NFC Assignment', 'Data Log Form', 'Confirm']} />);
    if (value === '4' || value.includes('incident')) return addAssistant('INCIDENTS', <InlineWorkflow title='Incident registration' steps={['Incident Type', 'Priority', 'Location', 'Description', 'Photo optional', 'Confirm']} />);
    if (value === '5' || value.includes('patrol') || value.includes('route') || value.includes('schedule')) return addAssistant('PATROL CONFIGURATION', <NumberList items={managementGroups.patrols} />);
    if (value === '6' || value.includes('report')) return addAssistant('REPORTS', <NumberList items={managementGroups.reports} />);
    if (value === '7' || value.includes('secure') || value.includes('lock') || value.includes('revoke')) {
      setInlinePanel(<LiveSecureDeviceManagementPanel selectedSite={selectedSite} siteId={selectedSiteId} />);
      return addAssistant('SECURE PATROL DEVICES', <p>Secure device controls are open below. Every command requires confirmation and is queued by the backend.</p>);
    }
    if (value.includes('register device')) return addAssistant('REGISTER DEVICE', <InlineWorkflow title='Device registration' steps={['Device Name', 'Device Identifier', 'Site', 'Confirm']} />);
    addAssistant('MX PATROL - MANAGEMENT', <Menu site={selectedSite} items={managementItems} />);
  };

  const submit = () => {
    const text = input.trim();
    if (!text) return;
    setInput('');
    addUser(text);
    const value = text.toLowerCase();
    if (value === 'menu' || value === 'main') return addAssistant(mode === 'management' ? 'MX PATROL - MANAGEMENT' : 'MX PATROL', <Menu site={selectedSite} items={mode === 'management' ? managementItems : userItems} />);
    if (value === 'back' || value === 'cancel') { setInlinePanel(null); return addAssistant(mode === 'management' ? 'MX PATROL - MANAGEMENT' : 'MX PATROL', <Menu site={selectedSite} items={mode === 'management' ? managementItems : userItems} />); }
    return mode === 'management' ? managementResponse(value) : userResponse(value);
  };

  return <div className='min-h-screen bg-[#030811] text-white'><div className='mx-auto flex min-h-screen max-w-6xl flex-col px-3 py-3 sm:px-4'><header className='mb-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-cyan-400/20 bg-slate-950/80 px-4 py-3'><TTechMxPatrolLogo variant='header' priority className='w-44' /><div className='flex flex-wrap items-center gap-2'><label className='flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100'><MapPin className='h-4 w-4' /><select value={selectedSite} onChange={(event) => setSelectedSite(event.target.value)} className='bg-transparent font-semibold outline-none'>{visibleSites.map((site) => <option key={site} value={site} className='bg-slate-950'>{site}</option>)}</select></label><span className='inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 text-sm font-semibold text-emerald-200'><span className='h-2 w-2 rounded-full bg-emerald-400' /> Online</span><span className='inline-flex h-10 items-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 text-sm font-semibold text-cyan-100'>{mode === 'management' ? <UserCog className='h-4 w-4' /> : <Bot className='h-4 w-4' />}{mode === 'management' ? 'Management' : 'User AI'}</span></div></header><main className='flex min-h-0 flex-1 flex-col rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.12),transparent_30%),linear-gradient(145deg,rgba(2,6,23,0.96),rgba(3,12,24,0.98))]'><section className='border-b border-cyan-400/15 p-4'><p className='text-xs font-black uppercase tracking-[0.16em] text-emerald-300'>{mode === 'management' ? 'Management Web AI Assistant' : 'User Web AI Assistant'}</p><h1 className='mt-2 text-2xl font-black'>{mode === 'management' ? 'Authorized management access' : 'Ask MX Patrol what you need'}</h1><p className='mt-1 text-sm text-slate-400'>Signed in as {user?.email ?? role}. One active site at a time.</p></section><section className='grid flex-1 gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_18rem]'><div className='flex min-h-[34rem] flex-col rounded-2xl border border-white/10 bg-slate-950/60'><div className='flex-1 space-y-3 overflow-y-auto p-4'><AssistantBubble title={mode === 'management' ? 'MX PATROL - MANAGEMENT' : 'MX PATROL'}><Menu site={selectedSite} items={mode === 'management' ? managementItems : userItems} /></AssistantBubble>{messages.map((message) => message.from === 'user' ? <UserBubble key={message.id}>{message.body}</UserBubble> : <AssistantBubble key={message.id} title={message.title ?? 'MX PATROL'}>{message.body}</AssistantBubble>)}{inlinePanel ? <div className='rounded-2xl border border-emerald-400/25'>{inlinePanel}</div> : null}</div><div className='border-t border-white/10 p-3'><div className='flex items-center gap-3'><input value={input} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); }} className='h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm text-white outline-none placeholder:text-slate-500' placeholder={mode === 'management' ? 'Type a number or management command...' : 'Type a number or ask MX Patrol...'} /><button onClick={submit} className='flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]' aria-label='Send'><Send className='h-5 w-5' /></button></div><p className='mt-2 text-center text-[11px] text-slate-500'>AI responses can make mistakes. Verify critical actions before confirming.</p></div></div><aside className='space-y-3'><Shortcut onClick={() => mode === 'management' ? switchToUser() : switchToManagement()} icon={mode === 'management' ? Bot : Lock} label={mode === 'management' ? 'User Assistant' : 'Management'} /><Shortcut onClick={() => userResponse('live now')} icon={ShieldCheck} label='Live Now' /><Shortcut onClick={() => userResponse('which devices are offline')} icon={Smartphone} label='Offline Devices' /><Shortcut onClick={() => setInlinePanel(null)} icon={X} label='Close Inline Panel' /><div className='rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300'><p className='font-black uppercase tracking-[0.12em] text-emerald-300'>Hidden system</p><p className='mt-2 leading-6'>Dashboard, map, patrols, routes, schedules and admin tools stay behind assistant actions.</p></div></aside></section></main></div></div>;
}

function Menu({ site, items }: { site: string; items: string[] }) { return <div><p>Viewing: <b>{site}</b></p><p className='mt-2'>What would you like to do?</p><NumberList items={items} /><p className='mt-3 text-slate-300'>Reply with a number, or type your request.</p></div>; }
function NumberList({ items }: { items: readonly string[] }) { return <ol className='mt-3 space-y-1'>{items.map((item, index) => <li key={item}><span className='text-emerald-300'>{index + 1}.</span> {item}</li>)}</ol>; }
function AssistantBubble({ title, children }: { title: string; children: ReactNode }) { return <div className='max-w-2xl rounded-2xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white'><p className='mb-2 font-black uppercase tracking-[0.08em] text-emerald-300'>{title}</p><div className='leading-6 text-slate-100'>{children}</div></div>; }
function UserBubble({ children }: { children: ReactNode }) { return <div className='ml-auto max-w-xl rounded-2xl bg-emerald-600 px-4 py-3 text-sm text-white'>{children}</div>; }
function SmallButton({ children, onClick }: { children: ReactNode; onClick: () => void }) { return <button type='button' onClick={onClick} className='mt-3 inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 text-sm font-semibold text-emerald-200'>{children}<ArrowRight className='h-4 w-4' /></button>; }
function Shortcut({ icon: Icon, label, onClick }: { icon: typeof Bot; label: string; onClick: () => void }) { return <button type='button' onClick={onClick} className='flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left text-sm font-semibold text-slate-100 hover:border-emerald-400/30'><span className='flex items-center gap-3'><Icon className='h-5 w-5 text-emerald-300' />{label}</span><ArrowRight className='h-4 w-4 text-slate-500' /></button>; }
function SitePicker({ sites, selected, onSelect }: { sites: string[]; selected: string; onSelect: (site: string) => void }) { return <div className='grid gap-2'>{sites.map((site) => <button key={site} onClick={() => onSelect(site)} className={(site === selected ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-slate-950/70 text-slate-300') + ' rounded-xl border px-3 py-2 text-left'}>{site}</button>)}</div>; }
function missedCheckpointCount(rows: PatrolSessionRow[]) { return rows.reduce((total, row) => total + Math.max((row.checkpoint_total ?? 0) - (row.checkpoint_completed ?? 0), 0), 0); }
function MetricGrid({ items }: { items: Array<[string, number]> }) { return <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>{items.map(([label, value]) => <div key={label} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><p className='text-2xl font-black text-emerald-300'>{value}</p><p className='text-xs text-slate-400'>{label}</p></div>)}</div>; }
function Summary({ devices, alerts, incidents, patrols, scans }: { devices: any[]; alerts: any[]; incidents: any[]; patrols: PatrolSessionRow[]; scans: any[] }) { return <MetricGrid items={[[ 'Devices Online', devices.filter((row) => row.status === 'online').length ], [ 'Devices Offline', devices.filter((row) => row.status === 'offline').length ], [ 'Active Patrols', patrols.filter((row) => ['active', 'in_progress'].includes(String(row.status))).length ], [ 'Completed', patrols.filter((row) => ['completed', 'completed_late'].includes(String(row.status))).length ], [ 'Incidents', incidents.length ], [ 'SOS', alerts.filter((row: any) => row.type === 'panic_button').length ], [ 'Scans', scans.length ]]} />; }
function Attention({ devices, alerts, patrols }: { devices: any[]; alerts: any[]; patrols: PatrolSessionRow[] }) { return <MetricGrid items={[[ 'Open Alerts', alerts.filter((row: any) => !row.is_read).length ], [ 'SOS Alerts', alerts.filter((row: any) => row.type === 'panic_button').length ], [ 'Offline Devices', devices.filter((row) => row.status === 'offline').length ], [ 'Missed Patrols', patrols.filter((row) => row.status === 'missed').length ]]} />; }
function Devices({ devices, offlineOnly }: { devices: any[]; offlineOnly?: boolean }) { const rows = offlineOnly ? devices.filter((row) => row.status === 'offline') : devices; if (!rows.length) return <p>{offlineOnly ? 'All devices are online.' : 'No devices found for this site.'}</p>; return <div className='space-y-2'>{rows.slice(0, 8).map((device) => <div key={device.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{device.device_identifier ?? device.device_name ?? 'Device'}</b><p className='text-slate-400'>{device.status ?? 'unknown'}</p></div>)}</div>; }
function Incidents({ rows }: { rows: any[] }) { if (!rows.length) return <p>No incidents recorded for this site.</p>; return <div className='space-y-2'>{rows.slice(0, 6).map((incident) => <div key={incident.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{incident.title ?? incident.incident_type ?? 'Incident'}</b><p className='text-slate-400'>{incident.severity ?? 'normal'} - {incident.resolved ? 'Resolved' : 'Open'}</p></div>)}</div>; }
function Patrols({ rows, statuses }: { rows: PatrolSessionRow[]; statuses: string[] }) { const filtered = rows.filter((row) => statuses.includes(String(row.status))); if (!filtered.length) return <p>No matching patrols for the active site.</p>; return <div className='space-y-2'>{filtered.slice(0, 8).map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{String(row.status).replace(/_/g, ' ')}</b><p className='text-slate-400'>{row.checkpoint_completed ?? 0}/{row.checkpoint_total ?? 0} checkpoints</p></div>)}</div>; }
function InlineWorkflow({ title, steps }: { title: string; steps: string[] }) { return <div><p className='font-bold text-emerald-200'>{title}</p><NumberList items={steps} /><p className='mt-3 text-amber-200'>Management writes require confirmation before saving.</p></div>; }