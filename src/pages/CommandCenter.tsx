import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, AlertTriangle, ArrowRight, Bell, Bot, Camera, CheckCircle2, ChevronDown, Clock3, Cpu, FileText, Lock, MapPin, Mic, Route, Send, ScanLine, Shield, ShieldAlert, ShieldCheck, Smartphone, Users, X } from 'lucide-react';
import { TTechMxPatrolLogo } from '@/components/branding/TTechMxPatrolLogo';
import { useAuth } from '@/contexts/AuthContext';
import { useUserRole } from '@/hooks/useUserRole';
import { usePlatformAdmin } from '@/hooks/usePlatformAdmin';
import { useSites } from '@/hooks/useSites';
import { useAlerts, useDevices, useIncidents, useScanLogs, useCheckpoints, useRealtimeSubscriptions } from '@/hooks/useDashboardData';
import { useReportJobs } from '@/hooks/useReports';
import { supabase } from '@/integrations/supabase/client';
import { LiveSecureDeviceManagementPanel } from '@/components/command-center/LiveSecureDeviceManagementPanel';
import PendingUnregisteredCheckpoints from '@/components/dashboard/PendingUnregisteredCheckpoints';
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
  PATROL_STATUS_LABELS,
  patrolStatusSummaryLine,
  patrolSummaryTotals,
  summarizePatrolSessions,
  assistantDate,
  assistantTime,
  describePatrol,
  patrolStatusCounts,
  type AssistantPatrolRow,
  type PatrolStatusGroup,
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
import { reportMenuItems } from '@/lib/assistantReportDefinitions';
import { buildMxPdfReportHtml, downloadMxPdfReport, reportTypeFromAction, type MxPdfReportInput } from '@/lib/mxPdfReports';
import { resolveSosAlert } from '@/lib/resolveSosAlert';
import { setFeedbackSoundEnabled } from '@/lib/feedbackSound';
import { startSosSiren, stopSosSiren } from '@/lib/sosSirenManager';

const LiveMap = lazy(() => import('@/components/dashboard/LiveMap'));

type Message = { id: number; from: 'assistant' | 'user'; title?: string; body: ReactNode };
type SessionRow = AssistantPatrolRow & { patrol_routes?: { id?: string | null; name: string } | null; patrol_templates?: { id?: string | null; name: string } | null; sites?: { name: string } | null };
type MissedCheckpointRow = {
  id: string;
  status: string | null;
  scheduled_at: string | null;
  scheduled_order: number | null;
  checkpoint_name_snapshot: string | null;
  checkpoints?: { name: string } | null;
  patrol_sessions?: { id: string; status: string | null; scheduled_start: string | null; site_id: string | null; patrol_routes?: { name: string } | null; sites?: { name: string } | null } | null;
};

type DashboardDevice = { id: string; status?: string | null; device_identifier?: string | null; device_name?: string | null; last_seen_at?: string | null; site_id?: string | null };
type DashboardAlert = { id: string; type?: string | null; is_read?: boolean | null; title?: string | null; message?: string | null; created_at?: string | null; site_id?: string | null; checkpoint_id?: string | null; resolved_at?: string | null; resolved_by?: string | null; resolved_source?: string | null };
type DashboardIncident = { id: string; resolved?: boolean | null; severity?: string | null; title?: string | null; incident_type?: string | null; created_at?: string | null; site_id?: string | null };
type DashboardScan = { id: string; scanned_at?: string | null; tag_status?: string | null; device_identifier?: string | null; checkpoints?: { name?: string | null } | null; guards?: { full_name?: string | null } | null };
type DatalogSubmission = { id: string; submitted_at?: string | null; datalog_value?: string | null; responses_json?: any; site_id?: string | null; checkpoint_id?: string | null; sites?: { name?: string | null } | null; checkpoints?: { name?: string | null; data_log_label?: string | null } | null };
type IncidentPhotoActivity = { id: string; captured_at?: string | null; created_at?: string | null; company_id?: string | null; site_id?: string | null; device_identifier?: string | null; storage_path?: string | null };
type RecordingActivity = { id: string; captured_at?: string | null; created_at?: string | null; company_id?: string | null; site_id?: string | null; device_identifier?: string | null; storage_path?: string | null; filename?: string | null };
type ActivityType = 'scans' | 'photos' | 'datalog' | 'sos' | 'recordings';
type ActivityAckRow = { activity_type: ActivityType; acknowledged_at: string | null };
type LiveCheckpointRow = { id: string; session_id?: string | null; patrol_session_id?: string | null; status?: string | null; scheduled_at?: string | null; scheduled_order?: number | null; checkpoint_name_snapshot?: string | null; scanned_at?: string | null; checkpoints?: { name?: string | null } | null };
type AssistantCompany = { id: string; name: string; status?: string | null; site_count?: number; reference?: string | null };
type AssistantSite = { id: string; company_id: string; company_name?: string | null; name: string; address?: string | null; gps_lat?: number | null; gps_lng?: number | null; status?: string | null; created_at?: string | null };

const ACTIVITY_TYPES: ActivityType[] = ['scans', 'photos', 'datalog', 'sos', 'recordings'];
const isAudioEvidencePath = (path?: string | null) => /\.(m4a|mp3|wav|aac|ogg|webm)$/i.test(path ?? '');
const isImageEvidencePath = (path?: string | null) => /\.(jpe?g|png|webp|gif)$/i.test(path ?? '');

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
  return { ...row, patrol_id: row.patrol_routes?.id ?? row.patrol_templates?.id ?? null, patrol_name: row.patrol_routes?.name ?? row.patrol_templates?.name ?? 'Patrol', site_name: row.sites?.name ?? null };
}

export default function CommandCenter() {
  const { user } = useAuth();
  const { canManage, role } = useUserRole();
  const { isPlatformOwner } = usePlatformAdmin();
  const { data: sites = [] } = useSites();
  const queryClient = useQueryClient();
  useRealtimeSubscriptions();
  const [state, setState] = useState<RouterState>({ mode: 'user', activeMenu: USER_HOME, activeSiteId: null });
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [inlinePanel, setInlinePanel] = useState<ReactNode | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<null | { label: string; run: () => Promise<void> }>(null);
  const [workflow, setWorkflow] = useState<WorkflowState | null>(null);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [resolvingSosId, setResolvingSosId] = useState<string | null>(null);
  const [acknowledgedSosIds, setAcknowledgedSosIds] = useState<Set<string>>(() => new Set());
  const [sosSoundArmed, setSosSoundArmed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem('mxpatrol_sos_sound_armed') === 'true');
  const [sosSoundPrompt, setSosSoundPrompt] = useState(false);
  const seenSosIdsRef = useRef<Set<string>>(new Set());
  const sosInitialLoadRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);
  const forceNextScrollRef = useRef(false);

  const platformCompanies = useQuery({
    queryKey: ['assistant_platform_companies', isPlatformOwner],
    enabled: !!user && isPlatformOwner,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('management-actions', { body: { action: 'list_companies', input: {} } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (((data as any)?.record?.rows ?? []) as AssistantCompany[]);
    },
  });

  const selectedCompany = (platformCompanies.data ?? []).find((company) => company.id === selectedCompanyId) ?? null;
  const selectedCompanyName = selectedCompany?.name ?? (isPlatformOwner ? 'No company selected' : 'Your company');

  const platformSites = useQuery({
    queryKey: ['assistant_company_sites', selectedCompanyId],
    enabled: !!user && canManage && isPlatformOwner && !!selectedCompanyId,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('management-actions', { body: { action: 'list_sites', input: { company_id: selectedCompanyId } } });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (((data as any)?.record?.rows ?? []) as AssistantSite[]);
    },
  });

  const ownerCompanySites = (platformSites.data ?? []) as AssistantSite[];
  const availableSites = (isPlatformOwner ? ownerCompanySites : sites) as AssistantSite[];
  const allSitesSelected = state.activeSiteId === 'all';
  const activeSite = allSitesSelected ? null : availableSites.find((site) => site.id === state.activeSiteId) ?? availableSites[0] ?? null;
  const selectedSiteId = allSitesSelected ? null : activeSite?.id ?? null;
  const selectedSite = allSitesSelected ? 'All Sites' : activeSite?.name ?? 'No site assigned';
  const ownerScoped = isPlatformOwner && !!selectedCompanyId;
  const activityCompanyId = selectedCompanyId ?? activeSite?.company_id ?? availableSites[0]?.company_id ?? null;
  const mode: AssistantMode = state.mode;

  const devices = useDevices(selectedSiteId ?? 'all');
  const alerts = useAlerts();
  const incidents = useIncidents();
  const scans = useScanLogs(selectedSiteId ?? 'all');
  const checkpoints = useCheckpoints(selectedSiteId ?? 'all');
  const reportJobs = useReportJobs();
  const scanCountToday = useQuery({
    queryKey: ['dashboard_scan_count_today', selectedSiteId],
    enabled: !!user && (!isPlatformOwner || !!selectedCompanyId),
    queryFn: async () => {
      let query = supabase
        .from('scan_logs')
        .select('id', { count: 'exact', head: true })
        .gte('scanned_at', startOfDay(0).toISOString());
      if (ownerScoped && selectedCompanyId) query = query.eq('company_id', selectedCompanyId);
      if (selectedSiteId) query = query.eq('site_id', selectedSiteId);
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
  });

  const configOptions = useQuery({
    queryKey: ['assistant_workflow_options', selectedSiteId],
    enabled: !!selectedSiteId && canManage,
    queryFn: async () => {
      const [routes, forms, profiles, roles] = await Promise.all([
        supabase.from('patrol_routes').select('id, name').eq('site_id', selectedSiteId!).eq('status', 'active').order('name'),
        supabase
          .from('data_log_forms')
          .select('id, name, site_id, data_log_form_fields(id)')
          .eq('is_active', true)
          .or(`site_id.is.null,site_id.eq.${selectedSiteId!}`)
          .order('name'),
        supabase.from('profiles').select('id, full_name, phone').order('full_name'),
        supabase.from('user_roles').select('user_id, role'),
      ]);
      if (routes.error) throw routes.error;
      if (forms.error) throw forms.error;
      if (profiles.error) throw profiles.error;
      if (roles.error) throw roles.error;
      const roleByUser = new Map((roles.data ?? []).map((row: any) => [String(row.user_id), String(row.role)]));
      const users = (profiles.data ?? []).map((row: any) => ({ id: String(row.id), name: String(row.full_name ?? row.phone ?? row.id), phone: row.phone ?? null, role: roleByUser.get(String(row.id)) ?? null }));
      return { routes: routes.data ?? [], forms: forms.data ?? [], users };
    },
  });

  const whatsappAuthorizations = useQuery({
    queryKey: ['assistant_whatsapp_authorizations', selectedSiteId],
    enabled: !!selectedSiteId && canManage,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('management-actions', {
        body: { action: 'list_whatsapp_authorizations', input: { site_id: selectedSiteId } },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      return (((data as any)?.record?.rows ?? []) as any[]);
    },
  });

  const patrols = useQuery({
    queryKey: ['assistant_patrol_sessions', selectedSiteId],
    enabled: !!selectedSiteId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('patrol_sessions')
        .select('id, status, scheduled_start, scheduled_end, actual_start, finalized_at, checkpoint_completed, checkpoint_total, site_id, patrol_routes(id,name), patrol_templates(id,name), sites(name)')
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
        .gte('scheduled_at', startOfDay(0).toISOString())
        .lte('scheduled_at', new Date().toISOString())
        .eq('patrol_sessions.site_id', selectedSiteId!)
        .order('scheduled_at', { ascending: false })
        .limit(25);
      if (error) throw error;
      return (data ?? []) as unknown as MissedCheckpointRow[];
    },
  });
  const dataLogSubmissions = useQuery({
    queryKey: ['assistant_data_log_submissions', selectedCompanyId, selectedSiteId],
    enabled: !!user && (!isPlatformOwner || !!selectedCompanyId),
    queryFn: async () => {
      let query = supabase
        .from('data_log_submissions')
        .select('id, submitted_at, datalog_value, responses_json, site_id, checkpoint_id, sites(name), checkpoints(name, data_log_label)')
        .order('submitted_at', { ascending: false })
        .limit(100);
      if (ownerScoped && selectedCompanyId) query = query.eq('company_id', selectedCompanyId);
      if (selectedSiteId) query = query.eq('site_id', selectedSiteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as unknown as DatalogSubmission[];
    },
  });

  const incidentPhotoActivity = useQuery({
    queryKey: ['dashboard_incident_photo_activity', activityCompanyId, selectedSiteId],
    enabled: !!user && !!activityCompanyId,
    queryFn: async () => {
      const client = supabase as any;
      let query = client
        .from('incident_report_photos')
        .select('id, captured_at, created_at, company_id, site_id, device_identifier, storage_path')
        .eq('company_id', activityCompanyId!)
        .gte('captured_at', startOfDay(0).toISOString())
        .order('captured_at', { ascending: false })
        .limit(100);
      if (selectedSiteId) query = query.eq('site_id', selectedSiteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as IncidentPhotoActivity[];
    },
  });

  const recordingActivity = useQuery({
    queryKey: ['dashboard_recording_activity', activityCompanyId, selectedSiteId],
    enabled: !!user && !!activityCompanyId,
    queryFn: async () => {
      const client = supabase as any;
      let query = client
        .from('incident_report_photos')
        .select('id, captured_at, created_at, company_id, site_id, device_identifier, storage_path')
        .eq('company_id', activityCompanyId!)
        .gte('captured_at', startOfDay(0).toISOString())
        .order('captured_at', { ascending: false })
        .limit(200);
      if (selectedSiteId) query = query.eq('site_id', selectedSiteId);
      const { data, error } = await query;
      if (error) throw error;
      return ((data ?? []) as RecordingActivity[])
        .filter((row) => isAudioEvidencePath(row.storage_path))
        .map((row) => ({ ...row, filename: row.filename ?? row.storage_path?.split('/').pop() ?? null }));
    },
  });

  const activityAcknowledgements = useQuery({
    queryKey: ['dashboard_activity_acknowledgements', user?.id, activityCompanyId, selectedSiteId],
    enabled: !!user?.id && !!activityCompanyId,
    queryFn: async () => {
      const client = supabase as any;
      let query = client
        .from('user_activity_acknowledgements')
        .select('activity_type, acknowledged_at')
        .eq('user_id', user!.id)
        .eq('company_id', activityCompanyId!)
        .in('activity_type', ACTIVITY_TYPES)
        .order('acknowledged_at', { ascending: false });
      query = selectedSiteId ? query.eq('site_id', selectedSiteId) : query.is('site_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as ActivityAckRow[];
    },
  });
  const ownerScopedData = useQuery({
    queryKey: ['assistant_owner_scoped_dashboard', selectedCompanyId, selectedSiteId],
    enabled: !!user && ownerScoped && !!selectedCompanyId,
    queryFn: async () => {
      const companyId = selectedCompanyId!;
      const siteId = selectedSiteId;
      const siteScoped = (query: any) => siteId ? query.eq('site_id', siteId) : query;
      const alertQuery = siteId
        ? supabase.from('alerts').select('*, sites(name), checkpoints(name), patrol_sessions(status, patrol_routes(name), patrol_templates(name))').eq('company_id', companyId).eq('site_id', siteId).order('created_at', { ascending: false }).limit(100)
        : supabase.from('alerts').select('*, sites(name), checkpoints(name), patrol_sessions(status, patrol_routes(name), patrol_templates(name))').eq('company_id', companyId).order('created_at', { ascending: false }).limit(100);
      const [deviceRows, alertRows, incidentRows, scanRows, checkpointRows, patrolRows, dataLogRows, routeRows, formRows] = await Promise.all([
        siteScoped(supabase.from('devices').select('*, sites(name)').eq('company_id', companyId)).order('last_seen_at', { ascending: false }).limit(100),
        alertQuery,
        siteScoped(supabase.from('incidents').select('*').eq('company_id', companyId)).order('created_at', { ascending: false }).limit(100),
        siteScoped(supabase.from('scan_logs').select('*, sites(name), guards(full_name, badge_number), checkpoints(name)').eq('company_id', companyId)).order('scanned_at', { ascending: false }).limit(200),
        siteScoped(supabase.from('checkpoints').select('*, sites(name)').eq('company_id', companyId)).order('sort_order').limit(200),
        siteScoped(supabase.from('patrol_sessions').select('id, status, scheduled_start, scheduled_end, actual_start, finalized_at, checkpoint_completed, checkpoint_total, site_id, patrol_routes(id,name), patrol_templates(id,name), sites(name)').eq('company_id', companyId)).order('scheduled_start', { ascending: false }).limit(100),
        siteScoped(supabase.from('data_log_submissions').select('id, submitted_at, datalog_value, responses_json, site_id, checkpoint_id, sites(name), checkpoints(name, data_log_label)').eq('company_id', companyId)).order('submitted_at', { ascending: false }).limit(100),
        siteScoped(supabase.from('patrol_routes').select('id, name').eq('company_id', companyId)).eq('status', 'active').order('name'),
        siteId ? supabase.from('data_log_forms').select('id, name, site_id, data_log_form_fields(id)').eq('company_id', companyId).eq('is_active', true).or(`site_id.is.null,site_id.eq.${siteId}`).order('name') : supabase.from('data_log_forms').select('id, name, site_id, data_log_form_fields(id)').eq('company_id', companyId).eq('is_active', true).order('name'),
      ]);
      const results = [deviceRows, alertRows, incidentRows, scanRows, checkpointRows, patrolRows, dataLogRows, routeRows, formRows];
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      const siteCheckpointIds = new Set((checkpointRows.data ?? []).map((c) => c.id));
      const siteAlertsData = siteId ? (alertRows.data ?? []).filter((a) => a.site_id === siteId || (!!a.checkpoint_id && siteCheckpointIds.has(a.checkpoint_id))) : (alertRows.data ?? []);
      return {
        devices: deviceRows.data ?? [],
        alerts: siteAlertsData,
        incidents: incidentRows.data ?? [],
        scans: scanRows.data ?? [],
        checkpoints: checkpointRows.data ?? [],
        patrols: ((patrolRows.data ?? []) as unknown as SessionRow[]).map(named),
        dataLogs: dataLogRows.data ?? [],
        routes: routeRows.data ?? [],
        forms: formRows.data ?? [],
      };
    },
  });

  const ownerData = ownerScoped ? ownerScopedData.data : null;
  const siteDevices = (ownerData?.devices ?? devices.data ?? []) as DashboardDevice[];
  const siteCheckpointIdSet = new Set(((checkpoints.data ?? []) as any[]).map((cp) => cp.id));
  const siteAlerts = ownerData ? (ownerData.alerts as DashboardAlert[]) : ((alerts.data ?? []) as DashboardAlert[]).filter((row) => {
    if (!selectedSiteId) return true;
    if (row.site_id) return row.site_id === selectedSiteId;
    if (row.checkpoint_id) return siteCheckpointIdSet.has(row.checkpoint_id);
    return false;
  });
  const siteIncidents = ownerData ? (ownerData.incidents as DashboardIncident[]) : ((incidents.data ?? []) as DashboardIncident[]).filter((row) => !selectedSiteId || row.site_id === selectedSiteId);
  const sitePatrols = ownerData?.patrols ?? patrols.data ?? [];
  const siteScans = (ownerData?.scans ?? scans.data ?? []) as DashboardScan[];
  const siteCheckpoints = (ownerData?.checkpoints ?? checkpoints.data ?? []) as any[];
  const siteRoutes = (ownerData?.routes ?? configOptions.data?.routes ?? []) as any[];
  const siteForms = (ownerData?.forms ?? configOptions.data?.forms ?? []) as any[];
  const siteReportJobs = (reportJobs.data ?? []).filter((job) => !selectedSiteId || job.site_id === selectedSiteId || job.site_id === null);
  const siteDataLogs = (ownerData?.dataLogs ?? dataLogSubmissions.data ?? []) as DatalogSubmission[];
  const livePatrolRows = sitePatrols.filter((row) => ["active", "in_progress", "late_start", "awaiting_start"].includes(String(row.status)));
  const livePatrolIds = livePatrolRows.map((row) => row.id).filter(Boolean);
  const livePatrolCheckpoints = useQuery({
    queryKey: ["assistant_live_patrol_checkpoints", selectedSiteId, livePatrolIds.join("|")],
    enabled: livePatrolIds.length > 0,
    queryFn: async () => {
      // Cast the client: the generated types make this chained query
      // instantiate infinitely deep for TypeScript.
      const client = supabase as any;
      const { data, error } = await client
        .from("patrol_session_checkpoints")
        .select("id, session_id, status, scheduled_at, scheduled_order, checkpoint_name_snapshot, scanned_at, checkpoints(name)")
        .in("session_id", livePatrolIds)
        .in("status", ["pending", "scheduled", "due", "overdue"])
        .order("scheduled_at", { ascending: true })
        .order("scheduled_order", { ascending: true })
        .limit(100);
      if (error) throw error;
      return ((data ?? []) as LiveCheckpointRow[]).map((row) => ({ ...row, patrol_session_id: row.session_id ?? row.patrol_session_id ?? null }));
    },
  });
  const activeSosAlerts = useMemo(() => siteAlerts.filter((alert) => alert.type === 'panic_button' && !alert.is_read), [siteAlerts]);
  const unacknowledgedSosAlerts = useMemo(() => activeSosAlerts.filter((alert) => !acknowledgedSosIds.has(alert.id)), [acknowledgedSosIds, activeSosAlerts]);

  useEffect(() => {
    sosInitialLoadRef.current = false;
    seenSosIdsRef.current = new Set();
    setAcknowledgedSosIds(new Set());
    stopSosSiren();
  }, [selectedSiteId]);

  useEffect(() => {
    if (sosSoundArmed) return;
    const arm = () => {
      setFeedbackSoundEnabled(true);
      window.localStorage.setItem('mxpatrol_sos_sound_armed', 'true');
      setSosSoundArmed(true);
      setSosSoundPrompt(false);
    };
    window.addEventListener('pointerdown', arm, { once: true });
    window.addEventListener('keydown', arm, { once: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('keydown', arm);
    };
  }, [sosSoundArmed]);

  useEffect(() => {
    const activeIds = activeSosAlerts.map((alert) => alert.id);
    if (!sosInitialLoadRef.current) {
      seenSosIdsRef.current = new Set(activeIds);
      sosInitialLoadRef.current = true;
      return;
    }
    const nextNew = activeSosAlerts.filter((alert) => !seenSosIdsRef.current.has(alert.id));
    if (!nextNew.length) return;
    setAcknowledgedSosIds((prev) => {
      const next = new Set(prev);
      for (const alert of nextNew) next.delete(alert.id);
      return next;
    });
    for (const alert of nextNew) seenSosIdsRef.current.add(alert.id);
    if (!sosSoundArmed) setSosSoundPrompt(true);
    startSosSiren();
  }, [activeSosAlerts, sosSoundArmed]);

  useEffect(() => {
    if (!unacknowledgedSosAlerts.length) stopSosSiren();
  }, [unacknowledgedSosAlerts.length]);


  useEffect(() => {
    if (!shouldAutoScrollRef.current && !forceNextScrollRef.current) return;
    messagesEndRef.current?.scrollIntoView({ block: 'end', behavior: forceNextScrollRef.current ? 'smooth' : 'auto' });
    forceNextScrollRef.current = false;
  }, [messages.length, pendingConfirm, inlinePanel, mode, selectedSite]);

  const handleConversationScroll = () => {
    const node = conversationRef.current;
    if (!node) return;
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom < 96;
  };

  const addAssistant = (title: string, body: ReactNode) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'assistant', title, body }]);
  const addUser = (body: string) => setMessages((rows) => [...rows, { id: Date.now() + rows.length, from: 'user', body }]);

  const workflowContext: WorkflowContext = useMemo(() => ({
    siteId: selectedSiteId,
    siteName: selectedSite,
    canManage,
    checkpoints: siteCheckpoints.map((row: any) => ({ id: String(row.id), name: String(row.name) })),
    routes: siteRoutes.map((row: any) => ({ id: String(row.id), name: String(row.name) })),
    forms: siteForms
      .map((row: any) => ({
        id: String(row.id),
        name: String(row.name),
        field_count: Array.isArray(row.data_log_form_fields) ? row.data_log_form_fields.length : 0,
      }))
      .filter((form: { field_count: number }) => form.field_count > 0),
    users: configOptions.data?.users ?? [],
    companies: platformCompanies.data ?? [],
    selectedCompanyId: isPlatformOwner ? selectedCompanyId : null,
    selectedCompanyName,
    isPlatformOwner,
    whatsappAuthorizations: whatsappAuthorizations.data ?? [],
  }), [selectedSiteId, selectedSite, canManage, checkpoints.data, configOptions.data, whatsappAuthorizations.data, platformCompanies.data, selectedCompanyId, selectedCompanyName, isPlatformOwner]);

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
      queryClient.invalidateQueries({ queryKey: ['assistant_whatsapp_authorizations'] }),
      queryClient.invalidateQueries({ queryKey: ['alerts'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant_owner_scoped_dashboard'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant_platform_companies'] }),
      queryClient.invalidateQueries({ queryKey: ['assistant_company_sites'] }),
      queryClient.invalidateQueries({ queryKey: ['sites'] }),
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
    if (key === 'user_patrol_status' || key === 'management_patrol_status') {
      return addAssistant(`PATROL STATUS TODAY - ${selectedSite}`, <PatrolStatusOverview site={selectedSite} rows={periodRows('today').sessions} node={node} loading={patrols.isLoading} />);
    }
    addAssistant(node.title, <MenuView site={selectedSite} node={node} isPlatformOwner={isPlatformOwner} />);
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
      dataLogs: siteDataLogs.filter((row: any) => within(row.submitted_at ?? row.created_at)),
    };
  };

  const runReportPeriod = (period: keyof typeof PERIODS) => {
    const rows = periodRows(period);
    const completed = rows.sessions.filter((row) => PATROL_STATUS_GROUPS.completed.includes(String(row.status) as never)).length;
    const missed = rows.sessions.filter((row) => row.status === 'missed').length;
    const missedCps = rows.sessions.reduce((total, row) => total + Math.max((row.checkpoint_total ?? 0) - (row.checkpoint_completed ?? 0), 0), 0);
    addAssistant(`${PERIODS[period].label.toUpperCase()} REPORT - ${selectedSite}`, (
      <div>
        <MetricGrid items={[['Patrols scheduled', rows.sessions.length], ['Completed', completed], ['Missed patrols', missed], ['Missed checkpoints', missedCps], ['Checkpoint scans', rows.scans.length], ['Incidents', rows.incidents.length], ['SOS alerts', rows.alerts.filter((row: any) => row.type === 'panic_button' && !row.is_read).length]]} />
        {rows.sessions.length ? <PatrolList rows={rows.sessions.slice(0, 6)} /> : <p className='mt-3'>No patrol sessions scheduled for this period at {selectedSite}.</p>}
      </div>
    ));
  };

  const handleAcknowledgeSos = (alert: DashboardAlert) => {
    setAcknowledgedSosIds((prev) => {
      const next = new Set(prev);
      next.add(alert.id);
      return next;
    });
    if (unacknowledgedSosAlerts.filter((row) => row.id !== alert.id).length === 0) stopSosSiren();
  };

  const handleEnableSosSound = () => {
    setFeedbackSoundEnabled(true);
    window.localStorage.setItem('mxpatrol_sos_sound_armed', 'true');
    setSosSoundArmed(true);
    setSosSoundPrompt(false);
    if (unacknowledgedSosAlerts.length) startSosSiren();
  };

  const handleResolveSos = async (alert: DashboardAlert) => {
    if (!canManage) throw new Error('Management access required');
    if (!window.confirm('Resolve this SOS alert? This closes the active SOS case but keeps it in reports/history.')) return;
    setResolvingSosId(alert.id);
    try {
      await resolveSosAlert(alert.id, selectedSiteId);
      handleAcknowledgeSos(alert);
      window.dispatchEvent(new CustomEvent('mxpatrol:sos-resolved', { detail: { id: alert.id } }));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['alerts'] }),
        queryClient.invalidateQueries({ queryKey: ['assistant_owner_scoped_dashboard'] }),
      ]);
    } finally {
      setResolvingSosId(null);
    }
  };

  const acknowledgeActivity = async (activityType: ActivityType) => {
    if (!user?.id || !activityCompanyId) return;
    const now = new Date().toISOString();
    const client = supabase as any;
    if (selectedSiteId) {
      const { error } = await client.from('user_activity_acknowledgements').upsert({
        user_id: user.id,
        company_id: activityCompanyId,
        site_id: selectedSiteId,
        activity_type: activityType,
        acknowledged_at: now,
        updated_at: now,
      }, { onConflict: 'user_id,company_id,site_id,activity_type' });
      if (error) throw error;
    } else {
      const existing = await client
        .from('user_activity_acknowledgements')
        .select('id')
        .eq('user_id', user.id)
        .eq('company_id', activityCompanyId)
        .eq('activity_type', activityType)
        .is('site_id', null)
        .order('acknowledged_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (existing.error) throw existing.error;
      if (existing.data?.id) {
        const { error } = await client
          .from('user_activity_acknowledgements')
          .update({ acknowledged_at: now, updated_at: now })
          .eq('id', existing.data.id);
        if (error) throw error;
      } else {
        const { error } = await client.from('user_activity_acknowledgements').insert({
          user_id: user.id,
          company_id: activityCompanyId,
          site_id: null,
          activity_type: activityType,
          acknowledged_at: now,
          updated_at: now,
        });
        if (error) throw error;
      }
    }
    await queryClient.invalidateQueries({ queryKey: ['dashboard_activity_acknowledgements'] });
  };

  const openActivityMetric = (activityType: ActivityType) => {
    const title = activityTitle(activityType) + ' - ' + selectedSite;
    addAssistant(title, <ActivityDrilldown type={activityType} site={selectedSite} scans={todayRows.scans} photos={todayIncidentPhotos} dataLogs={todayDataLogs} sosAlerts={todaySosAlerts} recordings={todayRecordings} />);
    if (activityType === 'sos') todaySosAlerts.filter((alert) => !alert.is_read).forEach(handleAcknowledgeSos);
    void acknowledgeActivity(activityType).catch((error) => addAssistant('ACKNOWLEDGEMENT FAILED', <p>{error instanceof Error ? error.message : 'Could not save activity acknowledgement.'}</p>));
  };
  const runAction = (action: string) => {
    if (action === 'change_site') return addAssistant('CHANGE SITE', <SitePicker sites={availableSites} selectedId={selectedSiteId} onSelect={(site) => { setState((prev) => ({ ...prev, activeSiteId: site.id })); addAssistant('ACTIVE SITE UPDATED', <p>Now viewing <b>{site.name}</b>. All results are scoped to this site.</p>); }} />);
    if (action === 'dashboard_guidance') return addAssistant('DASHBOARD', <p>User Mode is for reports only. Use the Dashboard panels for live/current operations such as patrol status, devices, SOS, incidents, datalog, and live activity.</p>);
    if (action === 'live') return addAssistant('LIVE NOW - ' + selectedSite, <Summary devices={siteDevices} alerts={todayRows.alerts} incidents={openIncidents} patrols={operationPatrolRows} scans={todayRows.scans} />);
    if (action === 'attention') return addAssistant('ATTENTION TODAY - ' + selectedSite, <Attention devices={siteDevices} alerts={todayRows.alerts} patrols={todayPatrolRows} />);
    if (action === 'devices') return addAssistant('DEVICES - ' + selectedSite, <DeviceList devices={siteDevices} />);
    if (action === 'devices_offline') return addAssistant('OFFLINE DEVICES - ' + selectedSite, <DeviceList devices={siteDevices} offlineOnly />);
    if (action === 'incidents') return addAssistant('INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents} />);
    if (action === 'incidents_open') return addAssistant('OPEN INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => !row.resolved)} />);
    if (action === 'incidents_high') return addAssistant('HIGH PRIORITY INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => ['high', 'critical'].includes(String(row.severity)))} />);
    if (action === 'incidents_resolved') return addAssistant('RESOLVED INCIDENTS - ' + selectedSite, <IncidentList rows={siteIncidents.filter((row: any) => row.resolved)} />);
    if (action === 'checkpoints') return addAssistant('CHECKPOINTS - ' + selectedSite, <CheckpointList rows={siteCheckpoints} />);
    if (action === 'pending_nfc') return addAssistant('PENDING UNREGISTERED CHECKPOINTS - ' + selectedSite, <PendingUnregisteredCheckpoints />);
    if (action === 'patrol_status') return showMenu(state.mode === 'management' ? 'management_patrol_status' : 'user_patrol_status');
    if (action === 'completed_patrols') return addAssistant('COMPLETED PATROLS - ' + selectedSite, <PatrolSessionSummary rows={periodRows('today').sessions} group='completed' site={selectedSite} />);
    if (action === 'incomplete_patrols') return addAssistant('INCOMPLETE PATROLS - ' + selectedSite, <PatrolSessionSummary rows={periodRows('today').sessions} group='incomplete' site={selectedSite} />);
    if (action === 'late_patrols') return addAssistant('LATE PATROLS - ' + selectedSite, <PatrolSessionSummary rows={periodRows('today').sessions} group='late' site={selectedSite} />);
    if (action === 'missed_patrols') return addAssistant('MISSED PATROLS - ' + selectedSite, <PatrolSessionSummary rows={periodRows('today').sessions} group='missed' site={selectedSite} />);
    if (action === 'late_sessions') return addAssistant('LATE SESSIONS - ' + selectedSite, <PatrolSessionDrilldown rows={periodRows('today').sessions} kind='late' />);
    if (action === 'missed_sessions') return addAssistant('MISSED SESSIONS - ' + selectedSite, <PatrolSessionDrilldown rows={periodRows('today').sessions} kind='missed' />);
    if (action === 'missed_checkpoints') return addAssistant('MISSED CHECKPOINTS TODAY - ' + selectedSite, <MissedCheckpointList rows={missedCheckpoints.data ?? []} loading={missedCheckpoints.isLoading} />);
    if (action === 'datalog_today') return addAssistant('DATALOG TODAY - ' + selectedSite, <CurrentDatalogEntries rows={todayDataLogs} />);
    if (action === 'view_companies') {
      if (!isPlatformOwner) return addAssistant('OWNER ACCESS REQUIRED', <p>Only MX Patrol platform owners can view all companies.</p>);
      return addAssistant('COMPANIES', <CompanyList rows={platformCompanies.data ?? []} loading={platformCompanies.isLoading} selectedId={selectedCompanyId} onSelect={(company) => { setSelectedCompanyId(company.id); setState((prev) => ({ ...prev, activeSiteId: null })); addAssistant('COMPANY CONTEXT UPDATED', <p>Now managing <b>{company.name}</b>. Choose <b>View Sites</b> or <b>Register Site</b> next.</p>); }} />);
    }
    if (action === 'view_sites') return addAssistant('SITES - ' + selectedCompanyName, <SitePicker sites={availableSites} selectedId={selectedSiteId} onSelect={(site) => { setState((prev) => ({ ...prev, activeSiteId: site.id })); addAssistant('ACTIVE SITE UPDATED', <p>Now viewing <b>{site.name}</b>. All results are scoped to this site.</p>); }} />);
    if (action === 'view_whatsapp_numbers') return addAssistant('WHATSAPP MANAGEMENT - ' + selectedSite, <WhatsAppAuthorizationPanel rows={whatsappAuthorizations.data ?? []} users={workflowContext.users} siteId={selectedSiteId} loading={whatsappAuthorizations.isLoading} onCreate={async (input) => {
      const result = await runManagementAction({ action: 'create_whatsapp_authorization', input: { ...input, site_id: selectedSiteId, created_via: 'web_command_center' } });
      return result.summary;
    }} onRevoke={async (authorizationId) => {
      const result = await runManagementAction({ action: 'revoke_whatsapp_authorization', input: { site_id: selectedSiteId, authorization_id: authorizationId } });
      return result.summary;
    }} />);
    if (action === 'routes' || action === 'schedules') return addAssistant(action === 'routes' ? 'PATROL ROUTES' : 'PATROL SCHEDULES', <ConfigList kind={action} siteId={selectedSiteId} />);
    if (action.startsWith('report:')) {
      const period = action.slice(7) as keyof typeof PERIODS;
      if (PERIODS[period]) return runReportPeriod(period);
      if (action.startsWith('report:device_security:') && !isPlatformOwner) return addAssistant('OWNER ACCESS REQUIRED', <p>Only MX Patrol platform owners can access Device Security Reports.</p>);
      const reportType = reportTypeFromAction(action);
      if (!reportType) return addAssistant('REPORT UNAVAILABLE', <p>This report has been retired. Choose one of the six PDF reports from Reports.</p>);
      const rows = periodRows('today');
      const reportInput: MxPdfReportInput = {
        type: reportType,
        companyName: selectedCompanyName,
        siteName: selectedSite,
        periodLabel: PERIODS.today.label,
        scans: rows.scans,
        patrols: rows.sessions,
        alerts: rows.alerts,
        incidents: rows.incidents,
        datalogs: rows.dataLogs,
        checkpoints: siteCheckpoints,
      };
      return addAssistant('REPORT GENERATED', <InlineReportPreview title={reportTitle(action)} input={reportInput} />);
    }
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
      if (!isPlatformOwner) {
        setInlinePanel(null);
        return addAssistant('OWNER ACCESS REQUIRED', <p>Only MX Patrol platform owners can access Secure Patrol Device Mode.</p>);
      }
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
    forceNextScrollRef.current = true;
    shouldAutoScrollRef.current = true;
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


    const result = resolveAssistantInput(state, text, { canManage, isPlatformOwner });
    setState(result.state);

    if (result.kind === 'menu') {
      if (result.state.mode !== state.mode) setInlinePanel(null);
      return showMenu(result.menuKey);
    }
    if (result.kind === 'denied') {
      return addAssistant('MANAGEMENT ACCESS REQUIRED', <p>Your account ({role}) does not have permission for management actions.</p>);
    }
    if (result.kind === 'unknown') {
      return addAssistant(menuNode(result.state.activeMenu).title, <div><p>I didn't understand that. Reply with a number from this menu.</p><MenuView site={selectedSite} node={menuNode(result.state.activeMenu)} isPlatformOwner={isPlatformOwner} /></div>);
    }
    return runAction(result.action);
  };

  const switchMode = () => submit(mode === 'management' ? 'user' : 'management');
  const homeNode = menuNode(homeMenu(mode));
  const todayRows = periodRows('today');
  const todayPatrolRows = todayRows.sessions;
  const todayDataLogs = siteDataLogs.filter((row) => {
    const value = new Date(row.submitted_at ?? 0).getTime();
    return Number.isFinite(value) && value >= startOfDay(0).getTime() && value <= Date.now();
  });
  const todayIncidentPhotos = (incidentPhotoActivity.data ?? []).filter((row) => withinToday(row.captured_at ?? row.created_at) && isImageEvidencePath(row.storage_path));
  const todayRecordings = (recordingActivity.data ?? []).filter((row) => withinToday(row.captured_at ?? row.created_at));
  const todaySosAlerts = todayRows.alerts.filter((row) => row.type === 'panic_button');
  const ackMap = new Map<ActivityType, string | null>();
  for (const row of activityAcknowledgements.data ?? []) {
    const current = ackMap.get(row.activity_type);
    const currentTime = current ? new Date(current).getTime() : 0;
    const rowTime = row.acknowledged_at ? new Date(row.acknowledged_at).getTime() : 0;
    if (!current || rowTime > currentTime) ackMap.set(row.activity_type, row.acknowledged_at);
  }
  const openIncidents = siteIncidents.filter((row) => !row.resolved);
  const operationPatrolRows = [...livePatrolRows, ...todayPatrolRows.filter((row) => !livePatrolRows.some((live) => live.id === row.id))];
  const onlineDevices = siteDevices.filter((device) => device.status === 'online').length;
  const activePatrolCount = livePatrolRows.length;
  const sosAlertCount = todaySosAlerts.filter((row) => !row.is_read).length;
  const openIncidentCount = openIncidents.length;
  const todayIncidentCount = todayRows.incidents.length;
  const highPriorityIncidentCount = openIncidents.filter((row) => ['high', 'critical'].includes(String(row.severity))).length;
  const loadedScansToday = todayRows.scans.length;
  const scanCountValue = scanCountToday.data ?? loadedScansToday;
  const photoCountValue = todayIncidentPhotos.length;
  const datalogCountValue = todayDataLogs.length;
  const recordingCountValue = todayRecordings.length;
  const activityLatest: Record<ActivityType, string | null> = {
    scans: latestIso(todayRows.scans, (row) => row.scanned_at),
    photos: latestIso(todayIncidentPhotos, (row) => row.captured_at ?? row.created_at),
    datalog: latestIso(todayDataLogs, (row) => row.submitted_at),
    sos: latestIso(todaySosAlerts, (row) => row.created_at),
    recordings: latestIso(todayRecordings, (row) => row.captured_at ?? row.created_at),
  };
  const activityUnseen = (activityType: ActivityType) => isNewerThanAck(activityLatest[activityType], ackMap.get(activityType));
  const patrolCounts = patrolStatusCounts(todayPatrolRows);
  const totalPatrols = Object.values(patrolCounts).reduce((total, value) => total + value, 0) || todayPatrolRows.length;
  const activityBuckets = Array.from({ length: 12 }, (_, index) => {
    const hour = index * 2;
    return {
      label: String(hour).padStart(2, '0'),
      patrols: todayRows.scans.filter((row) => new Date(row.scanned_at ?? 0).getHours() >= hour && new Date(row.scanned_at ?? 0).getHours() < hour + 2).length,
      alerts: todayRows.alerts.filter((row) => new Date(row.created_at ?? 0).getHours() >= hour && new Date(row.created_at ?? 0).getHours() < hour + 2).length,
    };
  });
  const topPatrols = (livePatrolRows.length ? livePatrolRows : todayPatrolRows).slice(0, 3);
  const recentIncidents = openIncidents.slice(0, 3);

  return (
    <div className='min-h-screen overflow-x-hidden bg-[#030811] text-white'>
      <div className='mx-auto flex min-h-screen max-w-[120rem] flex-col gap-3 px-3 py-3 sm:px-4'>
        <header className='grid gap-3 rounded-lg border border-cyan-400/20 bg-slate-950/85 p-3 shadow-[0_0_35px_rgba(14,165,233,0.08)] lg:grid-cols-[13rem_minmax(0,1fr)] lg:items-center'>
          <div className='flex min-h-14 items-center justify-center rounded-md bg-black/50 px-3'>
            <TTechMxPatrolLogo variant='header' priority className='w-44' />
          </div>
          <div className='grid gap-3 lg:grid-cols-[minmax(13rem,0.9fr)_minmax(15rem,1fr)_minmax(13rem,0.8fr)_auto_auto] lg:items-center'>
            {isPlatformOwner ? <label className='flex min-w-0 items-center gap-3 rounded-md border border-emerald-400/20 bg-slate-950/70 px-3 py-2 text-sm text-slate-300'>
              <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-emerald-400/25 text-emerald-300'><Users className='h-4 w-4' /></span>
              <span className='min-w-0 flex-1'>
                <span className='block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500'>Company</span>
                <select value={selectedCompanyId ?? ''} onChange={(event) => { setSelectedCompanyId(event.target.value || null); setState((prev) => ({ ...prev, activeSiteId: null })); }} className='w-full bg-transparent text-base font-bold text-white outline-none'>
                  <option value='' className='bg-slate-950'>Choose company</option>
                  {(platformCompanies.data ?? []).map((company) => <option key={company.id} value={company.id} className='bg-slate-950'>{company.name}</option>)}
                </select>
              </span>
              <ChevronDown className='h-4 w-4 text-slate-500' />
            </label> : null}
            <label className='flex min-w-0 items-center gap-3 rounded-md border border-cyan-400/20 bg-slate-950/70 px-3 py-2 text-sm text-slate-300'>
              <span className='flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cyan-400/25 text-cyan-300'><MapPin className='h-4 w-4' /></span>
              <span className='min-w-0 flex-1'>
                <span className='block text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500'>Active Site</span>
                <select value={allSitesSelected ? 'all' : selectedSiteId ?? ''} disabled={isPlatformOwner && !selectedCompanyId} onChange={(event) => setState((prev) => ({ ...prev, activeSiteId: event.target.value || null }))} className='w-full bg-transparent text-base font-bold text-white outline-none disabled:text-slate-500'>
                  <option value='' className='bg-slate-950'>{isPlatformOwner && !selectedCompanyId ? 'Choose company first' : availableSites.length ? 'Choose site' : 'No sites'}</option>
                  {availableSites.length ? <option value='all' className='bg-slate-950'>All Sites</option> : null}
                  {availableSites.map((site) => <option key={site.id} value={site.id} className='bg-slate-950'>{site.name}</option>)}
                </select>
              </span>
              <ChevronDown className='h-4 w-4 text-slate-500' />
            </label>
            <div className='flex items-center gap-3 rounded-md border border-emerald-400/20 bg-slate-950/70 px-4 py-3'>
              <span className='h-3 w-3 rounded-full bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.8)]' />
              <span><span className='block text-sm font-black uppercase text-emerald-300'>Online</span><span className='text-xs text-slate-400'>All systems operational</span></span>
            </div>
            <div className='flex items-center gap-3 rounded-md border border-white/10 bg-slate-950/70 px-4 py-3'>
              <Clock3 className='h-5 w-5 text-cyan-300' />
              <span><span className='block font-mono text-sm font-bold'>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span className='text-xs text-slate-400'>{new Date().toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })}</span></span>
            </div>
            <div className='flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-950/70 px-4 py-3'>
              <Bell className='h-5 w-5 text-slate-300' />
              <span className='h-9 w-9 rounded-full border border-emerald-400/50 text-center text-sm font-black leading-9 text-emerald-300'>{(user?.email ?? role ?? 'AI').slice(0, 2).toUpperCase()}</span>
            </div>
          </div>
        </header>

        <section className='rounded-lg border border-emerald-400/20 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-100'>
          <b>Today&apos;s Operations</b> - {selectedSite}. Current patrols, today&apos;s scans, today&apos;s SOS activity, and currently open incidents. Historical trends live under Reports.
        </section>

        <section className='grid gap-3 md:grid-cols-2 xl:grid-cols-5'>
          <KpiCard title='Active Patrols' value={activePatrolCount} total={totalPatrols || undefined} note='Live sessions' icon={Users} tone='emerald' />
          <KpiCard title='Devices Online' value={onlineDevices} total={siteDevices.length || undefined} note='Reporting devices' icon={Smartphone} tone='cyan' />
          <KpiCard title='SOS Alerts' value={todaySosAlerts.length} note={sosAlertCount ? 'Action required' : 'All clear'} icon={ShieldAlert} tone='rose' unseen={activityUnseen('sos')} onClick={() => openActivityMetric('sos')} />
          <KpiCard title='Open Incidents' value={openIncidentCount} note={`${todayIncidentCount} today, ${highPriorityIncidentCount} high priority`} icon={Shield} tone='amber' />
          <KpiCard title='Scans Today' value={scanCountValue} note={scanCountToday.isLoading ? 'Counting scans...' : `${loadedScansToday} loaded today`} icon={ScanLine} tone='blue' unseen={activityUnseen('scans')} onClick={() => openActivityMetric('scans')} />
        </section>

        <section className='grid gap-3 md:grid-cols-3 xl:grid-cols-5'>
          <KpiCard title='Photos' value={photoCountValue} note='Captured today' icon={Camera} tone='cyan' unseen={activityUnseen('photos')} onClick={() => openActivityMetric('photos')} />
          <KpiCard title='Datalog' value={datalogCountValue} note='Entries today' icon={FileText} tone='emerald' unseen={activityUnseen('datalog')} onClick={() => openActivityMetric('datalog')} />
          <KpiCard title='Recordings' value={recordingCountValue} note='Audio today' icon={Mic} tone='blue' unseen={activityUnseen('recordings')} onClick={() => openActivityMetric('recordings')} />
          <div className='md:col-span-3 xl:col-span-2'><SiteActivityTodayMatrix site={selectedSite} counts={{ scans: scanCountValue, photos: photoCountValue, datalog: datalogCountValue, sos: todaySosAlerts.length, recordings: recordingCountValue }} unseen={{ scans: activityUnseen('scans'), photos: activityUnseen('photos'), datalog: activityUnseen('datalog'), sos: activityUnseen('sos'), recordings: activityUnseen('recordings') }} onOpen={openActivityMetric} /></div>
        </section>

        <section className='grid gap-3 xl:grid-cols-[minmax(0,1fr)_22rem]'>
          <section className='flex h-[24rem] min-h-[24rem] flex-col overflow-hidden rounded-lg border border-cyan-400/20 bg-slate-950/80 shadow-[0_0_35px_rgba(14,165,233,0.08)]'>
            <div className='shrink-0 border-b border-white/10 px-4 py-3'>
              <div className='flex items-start justify-between gap-3'>
                <div>
                  <h2 className='flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-slate-100'><Bot className='h-4 w-4 text-cyan-300' /> Web AI Assistant</h2>
                  <p className='mt-1 text-xs font-black uppercase tracking-[0.12em] text-emerald-300'>MX Patrol</p>
                  <p className='text-xs text-slate-400'>Viewing: {selectedSite}</p>
                </div>
                <span className='rounded-md border border-cyan-400/25 px-2 py-1 text-xs font-bold text-cyan-200'>{mode === 'management' ? 'Management AI' : 'User AI'}</span>
              </div>
            </div>
            <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
              <div ref={conversationRef} onScroll={handleConversationScroll} className='min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4'>
                <AssistantBubble title={homeNode.title}><MenuView site={selectedSite} node={homeNode} isPlatformOwner={isPlatformOwner} /></AssistantBubble>
                <div className='grid gap-2 sm:grid-cols-2'>
                  {mode === 'management' || canManage ? <Shortcut onClick={switchMode} icon={mode === 'management' ? Bot : Lock} label={mode === 'management' ? 'User Assistant' : 'Management'} /> : null}
                  <Shortcut onClick={() => submit('checkpoint scan report')} icon={ScanLine} label='Checkpoint Report' />
                  <Shortcut onClick={() => submit('patrol report')} icon={FileText} label='Patrol Report' />
                  <Shortcut onClick={() => { setInlinePanel(null); submit('menu'); }} icon={X} label='Close Inline Panel' />
                </div>
                {messages.map((message) => message.from === 'user' ? <UserBubble key={message.id}>{message.body}</UserBubble> : <AssistantBubble key={message.id} title={message.title ?? 'MX PATROL'}>{message.body}</AssistantBubble>)}
                {pendingConfirm ? <div className='rounded-2xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-100'><p className='font-bold'>{pendingConfirm.label}</p><div className='mt-2 flex gap-2'><button type='button' onClick={() => submit('confirm')} className='rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 font-semibold text-emerald-200'>Confirm</button><button type='button' onClick={() => submit('cancel')} className='rounded-xl border border-white/10 px-3 py-2 font-semibold text-slate-300'>Cancel</button></div></div> : null}
                {inlinePanel ? <div className='rounded-2xl border border-emerald-400/25'>{inlinePanel}</div> : null}
                <div ref={messagesEndRef} aria-hidden='true' />
              </div>
              <form className='relative z-20 shrink-0 border-t border-white/10 bg-slate-950/95 p-3 pointer-events-auto' onSubmit={(event) => { event.preventDefault(); submit(); }}>
                <div className='flex items-center gap-3'>
                  <input type='text' autoComplete='off' value={input} onChange={(event) => setInput(event.target.value)} className='relative z-20 h-12 min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/80 px-4 text-sm text-white outline-none placeholder:text-slate-500 focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/20' placeholder={mode === 'management' ? 'Type a number or management command...' : 'Type a number or ask MX Patrol...'} />
                  <button type='submit' className='relative z-20 flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]' aria-label='Send'><Send className='h-5 w-5' /></button>
                </div>
                <p className='mt-2 text-center text-[11px] text-slate-500'>Reply with the number shown in the current menu. Type back, menu or cancel any time.</p>
              </form>
            </div>
          </section>
          <DashboardPanel title='Current SOS Rules' icon={ShieldCheck} action='Acknowledge != Resolve'>
            <div className='grid gap-3 text-sm text-slate-300'>
              <p><b className='text-amber-200'>Acknowledge</b> stops the siren and marks the alert seen on this dashboard.</p>
              <p><b className='text-emerald-200'>Resolve SOS</b> closes the real SOS record and removes it from the active count.</p>
              <p className='text-xs text-slate-500'>Resolved SOS records remain available in reports and history.</p>
            </div>
          </DashboardPanel>
        </section>

        <main className='grid min-h-0 flex-1 gap-3 xl:grid-cols-[25rem_minmax(34rem,1fr)_30rem]'>
          <div className='flex min-h-0 flex-col gap-3'>
            <DashboardPanel title="Today's Patrol Status" icon={ShieldCheck} action='Today'>
              <PatrolStatusDonut counts={patrolCounts} total={totalPatrols} />
            </DashboardPanel>
            <DashboardPanel title="Live Patrol Tracker" icon={Route} action={livePatrolRows.length ? "In progress" : "Idle"}>
              <LivePatrolTracker rows={livePatrolRows} checkpoints={livePatrolCheckpoints.data ?? []} loading={patrols.isLoading || livePatrolCheckpoints.isLoading} />
            </DashboardPanel>
            <DashboardPanel title='Device Feedback' icon={Cpu} action='View all' className='flex-1'>
              <DeviceFeedbackRows devices={siteDevices} scans={todayRows.scans} alerts={todayRows.alerts} />
            </DashboardPanel>
          </div>

          <DashboardPanel title={`Live Map - ${selectedSite}`} icon={MapPin} action='Map Controls' className='min-h-[34rem] overflow-hidden' bodyClassName='min-h-[32rem] p-0'>
            <Suspense fallback={<div className='flex h-full min-h-[32rem] items-center justify-center text-sm text-slate-400'>Loading live map...</div>}>
              <LiveMap operationsMode resizeSignal={messages.length} />
            </Suspense>
          </DashboardPanel>

          <DashboardPanel title='SOS Alerts' icon={ShieldAlert} action={sosAlertCount ? 'Action required' : 'All clear'} className={(sosAlertCount ? 'border-rose-400/30 bg-rose-950/20 shadow-[0_0_34px_rgba(244,63,94,0.14)] ' : '') + 'min-h-[34rem]'}>
            <SosResolutionPanel alerts={siteAlerts} siteName={selectedSite} canManage={canManage} resolvingId={resolvingSosId} acknowledgedIds={acknowledgedSosIds} soundPrompt={sosSoundPrompt} onAcknowledge={handleAcknowledgeSos} onEnableSound={handleEnableSosSound} onResolve={handleResolveSos} />
          </DashboardPanel>
        </main>

        {canManage ? <section className='rounded-lg border border-emerald-400/20 bg-slate-950/75 p-4 shadow-[0_0_30px_rgba(14,165,233,0.07)]'>
          <div className='mb-3 flex items-center justify-between gap-3'>
            <div>
              <h2 className='flex items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-slate-100'><Smartphone className='h-4 w-4 text-emerald-300' /> WhatsApp Access Management</h2>
              <p className='mt-1 text-xs text-slate-400'>Authorize and revoke WhatsApp numbers for {selectedSite} without using the assistant.</p>
            </div>
            <span className='rounded-md border border-emerald-400/25 px-2 py-1 text-xs font-bold text-emerald-200'>{whatsappAuthorizations.data?.length ?? 0} records</span>
          </div>
          <WhatsAppAuthorizationPanel rows={whatsappAuthorizations.data ?? []} users={workflowContext.users} siteId={selectedSiteId} loading={whatsappAuthorizations.isLoading} onCreate={async (input) => {
            const result = await runManagementAction({ action: 'create_whatsapp_authorization', input: { ...input, site_id: selectedSiteId, created_via: 'command_center_screen' } });
            return result.summary;
          }} onRevoke={async (authorizationId) => {
            const result = await runManagementAction({ action: 'revoke_whatsapp_authorization', input: { site_id: selectedSiteId, authorization_id: authorizationId } });
            return result.summary;
          }} />
        </section> : null}

        <section className='grid gap-3 xl:grid-cols-[1.15fr_0.85fr_0.85fr]'>
          <DashboardPanel title="Today's Activity Timeline" icon={Activity}>
            <ActivityTimeline buckets={activityBuckets} />
          </DashboardPanel>
          <DashboardPanel title='Current Patrols' icon={Route} action={livePatrolRows.length ? 'Live' : 'Today'}>
            <ActivePatrolRows rows={topPatrols} />
          </DashboardPanel>
          <DashboardPanel title='Open Incidents' icon={AlertTriangle} action='Current'>
            <RecentIncidentRows rows={recentIncidents} />
          </DashboardPanel>
        </section>
      </div>
    </div>
  );
}
type Tone = 'emerald' | 'cyan' | 'rose' | 'amber' | 'blue';

const toneClasses: Record<Tone, { border: string; text: string; bg: string; glow: string }> = {
  emerald: { border: 'border-emerald-400/25', text: 'text-emerald-300', bg: 'bg-emerald-400/10', glow: 'shadow-[0_0_28px_rgba(16,185,129,0.16)]' },
  cyan: { border: 'border-cyan-400/25', text: 'text-cyan-300', bg: 'bg-cyan-400/10', glow: 'shadow-[0_0_28px_rgba(34,211,238,0.14)]' },
  rose: { border: 'border-rose-500/30', text: 'text-rose-300', bg: 'bg-rose-500/10', glow: 'shadow-[0_0_28px_rgba(244,63,94,0.14)]' },
  amber: { border: 'border-amber-400/25', text: 'text-amber-300', bg: 'bg-amber-400/10', glow: 'shadow-[0_0_28px_rgba(245,158,11,0.14)]' },
  blue: { border: 'border-blue-400/25', text: 'text-blue-300', bg: 'bg-blue-400/10', glow: 'shadow-[0_0_28px_rgba(96,165,250,0.14)]' },
};

function DashboardPanel({ title, icon: Icon, action, children, className = '', bodyClassName = '' }: { title: string; icon: typeof Bot; action?: string; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`flex flex-col rounded-lg border border-cyan-400/15 bg-slate-950/75 shadow-[0_0_30px_rgba(14,165,233,0.07)] ${className}`}>
      <div className='flex min-h-12 items-center justify-between border-b border-white/10 px-4 py-3'>
        <h2 className='flex min-w-0 items-center gap-2 text-sm font-black uppercase tracking-[0.08em] text-slate-100'><Icon className='h-4 w-4 shrink-0 text-cyan-300' /><span className='truncate'>{title}</span></h2>
        {action ? <span className='shrink-0 rounded-md border border-white/10 px-2 py-1 text-xs text-slate-400'>{action}</span> : null}
      </div>
      <div className={`flex-1 p-4 ${bodyClassName}`}>{children}</div>
    </section>
  );
}

function KpiCard({ title, value, total, note, icon: Icon, tone, unseen = false, onClick }: { title: string; value: number; total?: number; note: string; icon: typeof Bot; tone: Tone; unseen?: boolean; onClick?: () => void }) {
  const classes = toneClasses[tone];
  const labelClass = 'text-sm font-black uppercase tracking-[0.08em] ' + (unseen ? 'text-rose-300' : classes.text);
  const valueClass = (unseen ? 'text-rose-300 drop-shadow-[0_0_12px_rgba(244,63,94,0.55)]' : 'text-white') + ' text-4xl font-black leading-none';
  const iconWrapClass = 'flex h-14 w-14 shrink-0 items-center justify-center rounded-full border ' + (unseen ? 'border-rose-400/45 bg-rose-500/15' : classes.border + ' ' + classes.bg);
  const iconClass = 'h-7 w-7 ' + (unseen ? 'text-rose-300' : classes.text);
  const cardClass = 'rounded-lg border ' + (unseen ? 'border-rose-400/45 bg-rose-950/25 shadow-[0_0_30px_rgba(244,63,94,0.18)]' : classes.border + ' bg-slate-950/75 ' + classes.glow) + ' p-5 text-left';
  const content = (
    <div className='flex items-start justify-between gap-4'>
      <div className='min-w-0'>
        <p className={labelClass}>{title}</p>
        <p className='mt-3 flex items-end gap-2 font-mono'><span className={valueClass}>{value}</span>{total ? <span className='pb-1 text-lg font-bold text-slate-400'>/ {total}</span> : null}</p>
        <p className='mt-2 text-xs text-slate-400'>{unseen ? 'New activity - click to view' : note}</p>
      </div>
      <span className={iconWrapClass}><Icon className={iconClass} /></span>
    </div>
  );
  if (onClick) return <button type='button' onClick={onClick} className={cardClass + ' w-full transition hover:-translate-y-0.5 hover:border-rose-300/60 focus:outline-none focus:ring-2 focus:ring-rose-300/25'}>{content}</button>;
  return <article className={cardClass}>{content}</article>;
}

function PatrolStatusDonut({ counts, total }: { counts: Record<PatrolStatusGroup, number>; total: number }) {
  const safeTotal = Math.max(total, 1);
  const completed = Math.round((counts.completed / safeTotal) * 100);
  const incomplete = Math.round((counts.incomplete / safeTotal) * 100);
  const late = Math.round((counts.late / safeTotal) * 100);
  const missed = Math.max(0, 100 - completed - incomplete - late);
  const gradient = `conic-gradient(#22c55e 0 ${completed}%, #60a5fa ${completed}% ${completed + incomplete}%, #fbbf24 ${completed + incomplete}% ${completed + incomplete + late}%, #ef4444 ${completed + incomplete + late}% 100%)`;
  const rows: Array<[PatrolStatusGroup, string, string, number]> = [
    ['completed', 'Completed', 'bg-emerald-400', completed],
    ['incomplete', 'Incomplete', 'bg-blue-400', incomplete],
    ['late', 'Late / Delayed', 'bg-amber-400', late],
    ['missed', 'Missed', 'bg-rose-400', missed],
  ];
  return (
    <div className='grid gap-5 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center xl:grid-cols-1 2xl:grid-cols-[9rem_minmax(0,1fr)]'>
      <div className='relative mx-auto h-36 w-36 rounded-full p-4' style={{ background: gradient }}>
        <div className='flex h-full w-full flex-col items-center justify-center rounded-full bg-slate-950 text-center'>
          <span className='font-mono text-3xl font-black text-white'>{total}</span>
          <span className='text-xs text-slate-400'>Total Patrols</span>
        </div>
      </div>
      <div className='space-y-3'>
        {rows.map(([key, label, color, percent]) => (
          <div key={key} className='grid grid-cols-[1fr_auto_auto] items-center gap-3 text-sm'>
            <span className='flex min-w-0 items-center gap-2 text-slate-200'><span className={`h-2.5 w-2.5 rounded-full ${color}`} />{label}</span>
            <span className='font-mono font-bold text-white'>{counts[key]}</span>
            <span className='w-9 text-right font-mono text-slate-500'>{percent}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function alertField(message: string | null | undefined, label: string) {
  if (!message) return null;
  const parts = message.split('|').map((part) => part.trim());
  const lower = label.toLowerCase();
  const match = parts.find((part) => part.toLowerCase().startsWith(lower + ':') || part.toLowerCase().startsWith(lower + '='));
  if (!match) return null;
  const index = match.includes('=') ? match.indexOf('=') : match.indexOf(':');
  return match.slice(index + 1).trim() || null;
}

function SosResolutionPanel({ alerts, siteName, canManage, resolvingId, acknowledgedIds, soundPrompt, onAcknowledge, onEnableSound, onResolve }: { alerts: DashboardAlert[]; siteName: string; canManage: boolean; resolvingId: string | null; acknowledgedIds: Set<string>; soundPrompt: boolean; onAcknowledge: (alert: DashboardAlert) => void; onEnableSound: () => void; onResolve: (alert: DashboardAlert) => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const rows = alerts.filter((alert) => alert.type === 'panic_button').sort((a, b) => Number(Boolean(a.is_read)) - Number(Boolean(b.is_read)) || new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime());
  if (!rows.length) return <p className='text-sm text-slate-400'>No SOS alerts for this site.</p>;
  return <div className='space-y-3'>
    {soundPrompt ? <button type='button' onClick={onEnableSound} className='w-full rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-100'>Enable SOS Sound</button> : null}
    {error ? <p className='rounded-md border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-100'>{error}</p> : null}
    <div className='h-[15rem] space-y-2 overflow-y-auto overscroll-contain pr-1 snap-y snap-mandatory' aria-label={siteName + ' SOS alerts'}>
    {rows.map((alert) => {
      const active = !alert.is_read;
      const acknowledged = acknowledgedIds.has(alert.id);
      const busy = resolvingId === alert.id;
      const device = alertField(alert.message, 'Device') ?? alertField(alert.message, 'Device ID') ?? 'Patrol device';
      const site = alertField(alert.message, 'Site') ?? siteName;
      return <div key={alert.id} className={(active ? acknowledged ? 'border-amber-400/35 bg-amber-500/10' : 'border-rose-400/45 bg-rose-500/15 shadow-[0_0_24px_rgba(244,63,94,0.18)]' : 'border-white/10 bg-slate-950/70') + ' min-h-[15rem] snap-start rounded-md border p-3'}>
        <div className='flex items-start justify-between gap-3'>
          <div className='min-w-0'>
            <p className={(active ? 'text-rose-100' : 'text-slate-200') + ' truncate text-sm font-black'}>{alert.title ?? 'SOS Alert'}</p>
            <div className='mt-2 grid gap-1 text-xs text-slate-300'>
              <span>Device: <b className='text-white'>{device}</b></span>
              <span>Site: <b className='text-white'>{site}</b></span>
              <span>Triggered: <b className='font-mono text-white'>{assistantDate(alert.created_at) ?? '--'} {assistantTime(alert.created_at) ?? '--:--'}</b></span>
              <span>Status: <b className={active ? acknowledged ? 'text-amber-200' : 'text-rose-200' : 'text-emerald-200'}>{active ? acknowledged ? 'Acknowledged - active' : 'New active SOS' : 'Resolved'}</b></span>
            </div>
            <p className='mt-2 line-clamp-2 text-xs text-slate-500'>{alert.message ?? 'Panic button activated'}</p>
            {alert.is_read ? <p className='mt-2 font-mono text-xs text-emerald-300'>Resolved: {assistantDate(alert.resolved_at) ?? 'saved'} {assistantTime(alert.resolved_at) ?? ''}{alert.resolved_source ? ' - ' + alert.resolved_source : ''}</p> : null}
          </div>
          <span className={(active ? acknowledged ? 'border-amber-400/35 text-amber-200' : 'border-rose-400/45 text-rose-100' : 'border-emerald-400/30 text-emerald-200') + ' shrink-0 rounded-md border px-2 py-1 text-xs font-bold'}>{active ? acknowledged ? 'Active' : 'New' : 'Resolved'}</span>
        </div>
        {active ? <div className='mt-3 grid gap-2 sm:grid-cols-2'>
          <button type='button' onClick={() => onAcknowledge(alert)} className='rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-sm font-black text-amber-100'>
            {acknowledged ? 'Acknowledged' : 'Acknowledge'}
          </button>
          {canManage ? <button type='button' disabled={busy} onClick={async () => { setError(null); try { await onResolve(alert); } catch (err) { setError(err instanceof Error ? err.message : 'SOS alert could not be resolved.'); } }} className='rounded-md border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-sm font-black text-emerald-100 disabled:cursor-not-allowed disabled:opacity-45'>
            {busy ? 'Resolving...' : 'Resolve SOS'}
          </button> : <span className='rounded-md border border-white/10 px-3 py-2 text-center text-xs font-bold text-slate-400'>Management access required</span>}
        </div> : null}
      </div>;
    })}
    </div>
  </div>;
}

function DeviceFeedbackRows({ devices, scans, alerts }: { devices: DashboardDevice[]; scans: DashboardScan[]; alerts: DashboardAlert[] }) {
  const rows = [
    ...alerts.filter((alert) => alert.type === 'panic_button').slice(0, 2).map((alert) => ({ id: alert.id, title: alert.title ?? 'SOS Alert', detail: alert.message ?? 'Panic button activated', time: assistantTime(alert.created_at), tone: 'rose' as Tone, icon: ShieldAlert })),
    ...devices.filter((device) => device.status === 'offline').slice(0, 3).map((device) => ({ id: device.id, title: device.device_name ?? device.device_identifier ?? 'Offline device', detail: 'Device offline', time: assistantTime(device.last_seen_at), tone: 'amber' as Tone, icon: AlertTriangle })),
    ...scans.slice(0, 4).map((scan) => ({ id: scan.id, title: scan.checkpoints?.name ?? scan.device_identifier ?? 'Checkpoint scan', detail: scan.guards?.full_name ?? formatStatusText(scan.tag_status ?? 'Scan received'), time: assistantTime(scan.scanned_at), tone: 'emerald' as Tone, icon: CheckCircle2 })),
  ].slice(0, 5);
  if (!rows.length) return <p className='text-sm text-slate-400'>No device feedback yet.</p>;
  return <div className='space-y-3'>{rows.map((row) => <FeedbackRow key={row.id} row={row} />)}</div>;
}

function FeedbackRow({ row }: { row: { title: string; detail: string; time: string | null; tone: Tone; icon: typeof Bot } }) {
  const classes = toneClasses[row.tone];
  const Icon = row.icon;
  return (
    <div className='grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0'>
      <span className={`flex h-8 w-8 items-center justify-center rounded-md border ${classes.border} ${classes.bg}`}><Icon className={`h-4 w-4 ${classes.text}`} /></span>
      <span className='min-w-0'><span className={`block truncate text-sm font-bold ${classes.text}`}>{row.title}</span><span className='block truncate text-xs text-slate-400'>{row.detail}</span></span>
      <span className='font-mono text-xs text-slate-500'>{row.time ?? '--:--'}</span>
    </div>
  );
}

function SiteActivityTodayMatrix({ site, counts, unseen, onOpen }: { site: string; counts: Record<ActivityType, number>; unseen: Record<ActivityType, boolean>; onOpen: (type: ActivityType) => void }) {
  const columns: Array<[ActivityType, string]> = [['scans', 'Scans'], ['photos', 'Photos'], ['datalog', 'Datalog'], ['sos', 'SOS Alerts'], ['recordings', 'Recordings']];
  return <div className='h-full rounded-lg border border-cyan-400/15 bg-slate-950/75 p-4 shadow-[0_0_30px_rgba(14,165,233,0.07)]'>
    <h2 className='text-sm font-black uppercase tracking-[0.08em] text-slate-100'>Site Activity - Today</h2>
    <div className='mt-3 overflow-x-auto'>
      <table className='w-full min-w-[28rem] text-left text-xs'>
        <thead className='text-slate-500'><tr><th className='pb-2 pr-3'>Site</th>{columns.map(([, label]) => <th key={label} className='pb-2 px-2'>{label}</th>)}</tr></thead>
        <tbody><tr className='border-t border-white/10'><td className='py-3 pr-3 font-bold text-white'>{site}</td>{columns.map(([type]) => <td key={type} className='px-2 py-3'><button type='button' onClick={() => onOpen(type)} className={(unseen[type] ? 'text-rose-300' : 'text-slate-100') + ' rounded-md px-2 py-1 font-mono text-sm font-black hover:bg-white/5'}>{counts[type]}</button></td>)}</tr></tbody>
      </table>
    </div>
  </div>;
}

function ActivityDrilldown({ type, site, scans, photos, dataLogs, sosAlerts, recordings }: { type: ActivityType; site: string; scans: DashboardScan[]; photos: IncidentPhotoActivity[]; dataLogs: DatalogSubmission[]; sosAlerts: DashboardAlert[]; recordings: RecordingActivity[] }) {
  const empty = <p className='text-slate-400'>No {activityTitle(type).toLowerCase()} records for {site} today.</p>;
  if (type === 'scans') return scans.length ? <ReportRows rows={scans.slice(0, 12).map((row) => ({ label: row.checkpoints?.name ?? row.device_identifier ?? 'Checkpoint scan', value: assistantTime(row.scanned_at) ?? '--:--', meta: row.tag_status ?? undefined }))} empty='' /> : empty;
  if (type === 'photos') return photos.length ? <ReportRows rows={photos.slice(0, 12).map((row) => ({ label: row.storage_path?.split('/').pop() ?? 'Incident photo', value: assistantTime(row.captured_at ?? row.created_at) ?? '--:--', meta: row.device_identifier ?? undefined }))} empty='' /> : empty;
  if (type === 'datalog') return <CurrentDatalogEntries rows={dataLogs} />;
  if (type === 'sos') return sosAlerts.length ? <AlertRows rows={sosAlerts} /> : empty;
  return recordings.length ? <ReportRows rows={recordings.slice(0, 12).map((row) => ({ label: row.filename ?? row.storage_path?.split('/').pop() ?? 'Recording', value: assistantTime(row.captured_at ?? row.created_at) ?? '--:--', meta: row.device_identifier ?? undefined }))} empty='' /> : empty;
}

function activityTitle(type: ActivityType) {
  const labels: Record<ActivityType, string> = { scans: 'Scans Today', photos: 'Photos Today', datalog: 'Datalog Today', sos: 'SOS Alerts Today', recordings: 'Recordings Today' };
  return labels[type];
}

function withinToday(iso?: string | null) {
  const value = new Date(iso ?? 0).getTime();
  return Number.isFinite(value) && value >= startOfDay(0).getTime() && value <= Date.now();
}

function latestIso<T>(rows: T[], getIso: (row: T) => string | null | undefined) {
  let latest: string | null = null;
  let latestMs = -Infinity;
  rows.forEach((row) => {
    const iso = getIso(row);
    const value = new Date(iso ?? 0).getTime();
    if (Number.isFinite(value) && value > latestMs) {
      latest = iso ?? null;
      latestMs = value;
    }
  });
  return latest;
}

function isNewerThanAck(latestIsoValue: string | null, acknowledgedAt?: string | null) {
  if (!latestIsoValue) return false;
  if (!acknowledgedAt) return true;
  return new Date(latestIsoValue).getTime() > new Date(acknowledgedAt).getTime();
}
function ActivityTimeline({ buckets }: { buckets: Array<{ label: string; patrols: number; alerts: number }> }) {
  const max = Math.max(1, ...buckets.map((bucket) => bucket.patrols + bucket.alerts));
  return (
    <div>
      <div className='flex h-28 items-end gap-2'>
        {buckets.map((bucket) => (
          <div key={bucket.label} className='flex flex-1 flex-col items-center gap-1'>
            <div className='flex h-24 w-full items-end justify-center gap-1'>
              <span className='w-2 rounded-t bg-emerald-400' style={{ height: `${Math.max(8, (bucket.patrols / max) * 96)}px` }} />
              <span className='w-2 rounded-t bg-rose-400' style={{ height: `${Math.max(bucket.alerts ? 8 : 0, (bucket.alerts / max) * 96)}px` }} />
            </div>
            <span className='font-mono text-[10px] text-slate-500'>{bucket.label}:00</span>
          </div>
        ))}
      </div>
      <div className='mt-4 flex gap-5 text-xs text-slate-400'><span className='flex items-center gap-2'><span className='h-2 w-2 rounded-full bg-emerald-400' />Patrols</span><span className='flex items-center gap-2'><span className='h-2 w-2 rounded-full bg-rose-400' />Alerts</span></div>
    </div>
  );
}

function patrolTimeRemaining(row: AssistantPatrolRow) {
  if (!row.scheduled_end) return row.status === "awaiting_start" ? "Awaiting start" : "No end time";
  const diff = new Date(row.scheduled_end).getTime() - Date.now();
  if (!Number.isFinite(diff)) return "No end time";
  const minutes = Math.ceil(Math.abs(diff) / 60000);
  if (diff >= 0) return minutes + " min left";
  return minutes + " min over";
}

function checkpointLabel(row?: LiveCheckpointRow) {
  if (!row) return "No pending checkpoint";
  return row.checkpoints?.name ?? row.checkpoint_name_snapshot ?? "Next checkpoint";
}

function LivePatrolTracker({ rows, checkpoints, loading }: { rows: AssistantPatrolRow[]; checkpoints: LiveCheckpointRow[]; loading: boolean }) {
  if (loading) return <p className="text-sm text-slate-400">Loading live patrol sessions...</p>;
  if (!rows.length) return <p className="text-sm text-slate-400">No patrol sessions are currently in progress for this site.</p>;
  return <div className="space-y-3">{rows.slice(0, 5).map((row) => {
    const next = checkpoints.find((checkpoint) => checkpoint.patrol_session_id === row.id);
    const total = Math.max(row.checkpoint_total ?? 0, 0);
    const completed = Math.max(row.checkpoint_completed ?? 0, 0);
    const pct = total ? Math.min(100, Math.round((completed / total) * 100)) : 0;
    return <div key={row.id} className="rounded-md border border-white/10 bg-slate-950/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-black text-white">{row.patrol_name ?? "Patrol"}</p>
          <p className="mt-1 truncate text-xs text-slate-400">Next: {checkpointLabel(next)}</p>
        </div>
        <span className="shrink-0 rounded-md border border-emerald-400/25 px-2 py-1 font-mono text-xs font-bold text-emerald-300">{patrolTimeRemaining(row)}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800">
        <div className="h-full rounded-full bg-emerald-400" style={{ width: pct + "%" }} />
      </div>
      <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
        <span>{completed}/{total || "?"} checkpoints</span>
        <span>{formatStatusText(String(row.status ?? "active"))}</span>
      </div>
    </div>;
  })}</div>;
}

function ActivePatrolRows({ rows }: { rows: AssistantPatrolRow[] }) {
  if (!rows.length) return <p className='text-sm text-slate-400'>No active patrols for this site.</p>;
  return <div className='space-y-3'>{rows.map((row, index) => { const view = describePatrol(row); return <div key={row.id} className='grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0'><span className='flex h-7 w-7 items-center justify-center rounded-md border border-cyan-400/30 font-mono text-sm font-black text-cyan-300'>{index + 1}</span><span className='min-w-0'><span className='block truncate text-sm font-bold text-white'>{view.patrol}</span><span className='block truncate text-xs text-slate-400'>{view.site}</span></span><span className='text-xs font-bold text-emerald-300'>{view.status}</span></div>; })}</div>;
}

function RecentIncidentRows({ rows }: { rows: DashboardIncident[] }) {
  if (!rows.length) return <p className='text-sm text-slate-400'>No recent incidents for this site.</p>;
  return <div className='space-y-3'>{rows.map((incident) => <div key={incident.id} className='grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 border-b border-white/10 pb-3 last:border-b-0 last:pb-0'><span className='flex h-8 w-8 items-center justify-center rounded-md border border-rose-400/25 bg-rose-400/10'><AlertTriangle className='h-4 w-4 text-rose-300' /></span><span className='min-w-0'><span className='block truncate text-sm font-bold text-white'>{incident.title ?? incident.incident_type ?? 'Incident'}</span><span className='block truncate text-xs text-slate-400'>{incident.resolved ? 'Resolved' : 'Open'}</span></span><span className='text-right'><span className='block font-mono text-xs text-slate-500'>{assistantTime(incident.created_at) ?? '--:--'}</span><span className='text-xs font-bold capitalize text-amber-300'>{incident.severity ?? 'normal'}</span></span></div>)}</div>;
}

function formatStatusText(value: string) {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
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

/** Patrol Status overview: real, site-scoped counts plus numbered drill-down. */
function PatrolStatusOverview({ site, rows, node, loading }: { site: string; rows: AssistantPatrolRow[]; node: { items: { label: string }[] }; loading: boolean }) {
  const counts = patrolStatusCounts(rows);
  const groups: PatrolStatusGroup[] = ['completed', 'incomplete', 'late', 'missed'];
  return (
    <div>
      <p>Viewing: <b>{site}</b></p>
      {loading ? <p className='mt-2'>Loading patrol status...</p> : (
        <div className='mt-3 flex flex-wrap gap-2'>
          {groups.map((group) => (
            <div key={group} className='min-w-[7.5rem] rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2'>
              <p className='text-xl font-black text-emerald-300'>{counts[group]}</p>
              <p className='text-xs text-slate-400'>{PATROL_STATUS_LABELS[group]}</p>
            </div>
          ))}
        </div>
      )}
      <NumberList items={node.items.map((item) => item.label)} />
      <p className='mt-3 text-slate-300'>Reply with a number to open the detailed list.</p>
    </div>
  );
}


function reportTitle(action: string) {
  const title = action.split(':').slice(1).join(' ').replace(/_/g, ' ');
  return title.replace(/\b\w/g, (char) => char.toUpperCase());
}

function scanBucket(scan: DashboardScan) {
  const status = String(scan.tag_status ?? 'registered').toLowerCase();
  if (status.includes('duplicate')) return 'Duplicate';
  if (status.includes('unregistered') || status.includes('unknown')) return 'Unregistered';
  if (status.includes('offline')) return 'Offline Synced';
  if (status.includes('reject') || status.includes('fail')) return 'Rejected / Failed';
  return 'Registered';
}

function checkpointName(scan: DashboardScan) {
  return scan.checkpoints?.name ?? 'Unassigned checkpoint';
}

function countBy<T>(rows: T[], getKey: (row: T) => string) {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(getKey(row), (counts.get(getKey(row)) ?? 0) + 1);
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

function AssistantReportPanel({ action, site, scans, patrols, alerts, incidents, devices, checkpoints, routes, forms, dataLogs, loading }: { action: string; site: string; scans: DashboardScan[]; patrols: AssistantPatrolRow[]; alerts: DashboardAlert[]; incidents: DashboardIncident[]; devices: DashboardDevice[]; checkpoints: any[]; routes: any[]; forms: any[]; dataLogs: DatalogSubmission[]; loading: boolean }) {
  if (loading) return <p>Loading report data for {site}...</p>;
  const [, category, report] = action.split(':');
  const sos = alerts.filter((row) => row.type === 'panic_button');
  const openIncidents = incidents.filter((row) => !row.resolved);
  const resolvedIncidents = incidents.filter((row) => row.resolved);
  const statusCounts = patrolStatusCounts(patrols);
  const duplicateScans = scans.filter((scan) => scanBucket(scan) === 'Duplicate');
  const unregisteredScans = scans.filter((scan) => scanBucket(scan) === 'Unregistered');
  const offlineScans = scans.filter((scan) => scanBucket(scan) === 'Offline Synced');
  const onlineDevices = devices.filter((device) => device.status === 'online');
  const offlineDevices = devices.filter((device) => device.status === 'offline');

  if (category === 'checkpoint_scans' && report === 'matrix') return <CheckpointTimeMatrix scans={scans} checkpoints={checkpoints} />;
  if (category === 'checkpoint_scans') {
    const rows = report === 'unregistered' ? unregisteredScans : report === 'duplicate' ? duplicateScans : report === 'offline_synced' ? offlineScans : scans;
    const grouped = report === 'checkpoint' ? countBy(rows, checkpointName) : report === 'device' ? countBy(rows, (row) => row.device_identifier ?? 'Unknown device') : countBy(rows, scanBucket);
    return <div><MetricGrid items={[['Total scans', scans.length], ['Registered', scans.filter((scan) => scanBucket(scan) === 'Registered').length], ['Unregistered', unregisteredScans.length], ['Duplicates', duplicateScans.length], ['Offline synced', offlineScans.length]]} /><ReportRows rows={grouped.map(([label, value]) => ({ label, value: String(value) }))} empty='No checkpoint scans match this report.' /></div>;
  }

  if (category === 'patrols') {
    if (report === 'details' || report === 'timeline') return <PatrolList rows={patrols} />;
    return <div><MetricGrid items={[['Patrol definitions', routes.length], ['Scheduled sessions', patrols.length], ['Completed', statusCounts.completed], ['Incomplete', statusCounts.incomplete], ['Late / Delayed', statusCounts.late], ['Missed', statusCounts.missed]]} /><PatrolStatusDonut counts={statusCounts} total={patrols.length} /></div>;
  }

  if (category === 'sos') {
    const rows = report === 'active' ? sos.filter((row) => !row.is_read) : report === 'resolved' ? sos.filter((row) => row.is_read) : sos;
    return <div><MetricGrid items={[['Total SOS', sos.length], ['Active', sos.filter((row) => !row.is_read).length], ['Resolved', sos.filter((row) => row.is_read).length]]} /><AlertRows rows={rows} /></div>;
  }

  if (category === 'incidents') {
    const grouped = report === 'device' ? countBy(incidents as any[], (row) => String(row.device_identifier ?? 'Unknown device')) : countBy(incidents, (row) => row.severity ?? 'normal');
    return <div><MetricGrid items={[['Total incidents', incidents.length], ['Open', openIncidents.length], ['Resolved', resolvedIncidents.length], ['High Priority', incidents.filter((row) => ['high', 'critical'].includes(String(row.severity))).length]]} /><ReportRows rows={grouped.map(([label, value]) => ({ label, value: String(value) }))} empty='No incidents match this report.' /></div>;
  }

  if (category === 'devices') {
    const selected = report === 'online' ? onlineDevices : report === 'disabled' ? devices.filter((device: any) => ['disabled', 'revoked'].includes(String(device.status))) : devices;
    return <div><MetricGrid items={[['Total devices', devices.length], ['Online', onlineDevices.length], ['Offline', offlineDevices.length], ['Disabled / Revoked', devices.filter((device: any) => ['disabled', 'revoked'].includes(String(device.status))).length]]} /><DeviceList devices={selected} /></div>;
  }

  if (category === 'checkpoint_performance') {
    const grouped = countBy(scans, checkpointName);
    const rows = report === 'least_scanned' ? grouped.slice().reverse() : grouped;
    return <ReportRows rows={rows.map(([label, value]) => ({ label, value: `${value} scans` }))} empty='No checkpoint performance data yet.' />;
  }

  if (category === 'data_logs') {
    const rows = dataLogs.map((entry) => {
      const label = String(entry.checkpoints?.data_log_label ?? entry.responses_json?.label ?? 'Datalog');
      const value = String(entry.datalog_value ?? entry.responses_json?.datalog_value ?? '-');
      const when = [assistantDate(entry.submitted_at), assistantTime(entry.submitted_at)].filter(Boolean).join(' ');
      return { label: `${entry.checkpoints?.name ?? 'Checkpoint'} - ${when}`, value: `${label}: ${value}` };
    });
    return <div><MetricGrid items={[['Submissions', dataLogs.length], ['Checkpoints', new Set(dataLogs.map((row) => row.checkpoint_id).filter(Boolean)).size], ['Site', site], ['Latest', dataLogs[0] ? assistantTime(dataLogs[0].submitted_at) : '-']]} /><ReportRows rows={rows} empty='No Datalog submissions match this site yet.' /></div>;
  }

  if (category === 'schedules') {
    return <div><MetricGrid items={[['Schedules', routes.length], ['Completed sessions', statusCounts.completed], ['Missed sessions', statusCounts.missed], ['Late starts', statusCounts.late]]} /><ReportRows rows={routes.map((route: any) => ({ label: String(route.name ?? 'Schedule'), value: 'Configured route' }))} empty='No schedules or routes are configured for this site.' /></div>;
  }

  if (category === 'routes') {
    const usage = countBy(patrols, (row) => row.patrol_name ?? 'Unassigned route');
    return <div><MetricGrid items={[['Total routes', routes.length], ['Used routes', usage.length], ['Completed sessions', statusCounts.completed], ['Avg completion', patrols.length ? Math.round((statusCounts.completed / patrols.length) * 100) : 0]]} /><ReportRows rows={usage.map(([label, value]) => ({ label, value: `${value} sessions` }))} empty='No route usage has been recorded for this site.' /></div>;
  }

  if (category === 'device_security') {
    const secureRows = devices as Array<DashboardDevice & { kiosk_active?: boolean | null; app_version?: string | null; device_owner_active?: boolean | null; secure_mode_status?: string | null; developer_mode_detected?: boolean | null; adb_detected?: boolean | null }>;
    return <div><MetricGrid items={[['Total devices', devices.length], ['Kiosk inactive', secureRows.filter((device) => device.device_owner_active && !device.kiosk_active).length], ['Integrity failures', secureRows.filter((device) => String(device.secure_mode_status ?? '').includes('fail') || device.developer_mode_detected || device.adb_detected).length], ['Disabled', secureRows.filter((device) => device.status === 'disabled').length]]} /><DeviceList devices={devices} /></div>;
  }

  return <p>This report uses the active site context and existing MX Patrol data sources.</p>;
}

function ReportRows({ rows, empty }: { rows: Array<{ label: string; value: string }>; empty: string }) {
  if (!rows.length) return <p>{empty}</p>;
  return <div className='mt-3 space-y-2'>{rows.slice(0, 12).map((row) => <div key={row.label} className='flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/70 p-3'><span className='min-w-0 truncate font-bold'>{row.label}</span><span className='shrink-0 font-mono text-sm text-emerald-300'>{row.value}</span></div>)}</div>;
}

function AlertRows({ rows }: { rows: DashboardAlert[] }) {
  if (!rows.length) return <p className='mt-3'>No SOS alerts match this report.</p>;
  return <div className='mt-3 space-y-2'>{rows.slice(0, 8).map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{row.title ?? 'SOS Alert'}</b><p className='text-slate-400'>{row.is_read ? 'Resolved' : 'Active'} - {assistantDate(row.created_at) ?? ''} {assistantTime(row.created_at) ?? ''}</p></div>)}</div>;
}

function CheckpointTimeMatrix({ scans, checkpoints }: { scans: DashboardScan[]; checkpoints: any[] }) {
  const names = (checkpoints.length ? checkpoints.map((row: any) => String(row.name)) : Array.from(new Set(scans.map(checkpointName)))).slice(0, 6);
  const sessions = Array.from(new Set(scans.map((scan) => assistantTime(scan.scanned_at)?.slice(0, 2) ?? 'Unknown'))).sort().slice(0, 8);
  if (!names.length || !sessions.length) return <p>No checkpoint scans available for the matrix.</p>;
  return <div className='mt-2 overflow-x-auto'><table className='min-w-full text-left text-xs'><thead><tr><th className='border-b border-white/10 p-2 text-slate-400'>Time</th>{names.map((name) => <th key={name} className='border-b border-white/10 p-2 text-slate-400'>{name}</th>)}</tr></thead><tbody>{sessions.map((hour) => <tr key={hour}><td className='border-b border-white/10 p-2 font-mono text-emerald-300'>{hour}:00</td>{names.map((name) => { const hit = scans.find((scan) => checkpointName(scan) === name && (assistantTime(scan.scanned_at)?.startsWith(hour) ?? false)); return <td key={name} className='border-b border-white/10 p-2'>{hit ? `${assistantTime(hit.scanned_at)} - ${scanBucket(hit)}` : 'Missed'}</td>; })}</tr>)}</tbody></table></div>;
}
function MenuView({ site, node, isPlatformOwner = false }: { site: string; node: { key?: string; title: string; items: { label: string; action?: string }[] }; isPlatformOwner?: boolean }) {
  const visibleItems = node.key ? reportMenuItems(node.key, isPlatformOwner) : [];
  const sourceItems = visibleItems.length ? visibleItems : node.items;
  const items = sourceItems.filter((item) => isPlatformOwner || !['register_company', 'view_companies'].includes(String(item.action)));
  return <div><p>Viewing: <b>{site}</b></p><p className='mt-2'>What would you like to do?</p><NumberList items={items.map((item) => item.label)} /><p className='mt-3 text-slate-300'>Reply with a number, or type your request.</p></div>;
}
function NumberList({ items }: { items: readonly string[] }) { return <ol className='mt-3 space-y-1'>{items.map((item, index) => <li key={item + index}><span className='text-emerald-300'>{index + 1}.</span> {item}</li>)}</ol>; }
function AssistantBubble({ title, children }: { title: string; children: ReactNode }) { return <div className='max-w-2xl rounded-2xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white'><p className='mb-2 font-black uppercase tracking-[0.08em] text-emerald-300'>{title}</p><div className='leading-6 text-slate-100'>{children}</div></div>; }
function UserBubble({ children }: { children: ReactNode }) { return <div className='ml-auto max-w-xl rounded-2xl bg-emerald-600 px-4 py-3 text-sm text-white'>{children}</div>; }
function Shortcut({ icon: Icon, label, onClick }: { icon: typeof Bot; label: string; onClick: () => void }) { return <button type='button' onClick={onClick} className='flex w-full items-center justify-between rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-left text-sm font-semibold text-slate-100 hover:border-emerald-400/30'><span className='flex items-center gap-3'><Icon className='h-5 w-5 text-emerald-300' />{label}</span><ArrowRight className='h-4 w-4 text-slate-500' /></button>; }
function SitePicker({ sites, selectedId, onSelect }: { sites: Array<{ id: string; name: string; status?: string | null }>; selectedId: string | null; onSelect: (site: { id: string; name: string; status?: string | null }) => void }) { if (!sites.length) return <p>No sites are assigned to your account yet.</p>; return <div className='grid gap-2'>{sites.map((site) => <button key={site.id} onClick={() => onSelect(site)} className={(site.id === selectedId ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-slate-950/70 text-slate-300') + ' rounded-xl border px-3 py-2 text-left'}>{site.name}</button>)}</div>; }
function InlineReportPreview({ title, input }: { title: string; input: MxPdfReportInput }) {
  const html = useMemo(() => buildMxPdfReportHtml(input), [input]);
  return <div className='space-y-3'>
    <p className='text-slate-300'>{title} generated inside MX Patrol.</p>
    <button type='button' onClick={() => { void downloadMxPdfReport(input); }} className='rounded-lg border border-emerald-400/40 bg-emerald-500/20 px-3 py-2 text-sm font-bold text-emerald-100'>Download PDF</button>
    <iframe title={title + ' preview'} srcDoc={html} className='h-96 w-full rounded-lg bg-white' sandbox='allow-same-origin' />
  </div>;
}

function CompanyList({ rows, loading, selectedId, onSelect }: { rows: AssistantCompany[]; loading: boolean; selectedId: string | null; onSelect: (company: AssistantCompany) => void }) {
  if (loading) return <p>Loading companies...</p>;
  if (!rows.length) return <p>No companies found.</p>;
  return <div className='space-y-2'>{rows.slice(0, 20).map((company, index) => <button key={company.id} type='button' onClick={() => onSelect(company)} className={(company.id === selectedId ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-100' : 'border-white/10 bg-slate-950/70 text-slate-300') + ' grid w-full grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border px-3 py-2 text-left'}><span className='font-mono text-emerald-300'>{index + 1}.</span><span className='min-w-0'><span className='block truncate font-bold'>{company.name}</span><span className='block text-xs text-slate-400'>{company.status ?? 'active'}</span></span><span className='text-xs text-slate-400'>Sites: {company.site_count ?? 0}</span></button>)}</div>;
}
function MetricGrid({ items }: { items: Array<[string, number | string]> }) { return <div className='grid gap-2 sm:grid-cols-2 lg:grid-cols-4'>{items.map(([label, value]) => <div key={label} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><p className='text-2xl font-black text-emerald-300'>{value}</p><p className='text-xs text-slate-400'>{label}</p></div>)}</div>; }
function CurrentDatalogEntries({ rows }: { rows: DatalogSubmission[] }) {
  const entries = rows.map((entry) => {
    const label = String(entry.checkpoints?.data_log_label ?? entry.responses_json?.label ?? 'Datalog');
    const value = String(entry.datalog_value ?? entry.responses_json?.datalog_value ?? '-');
    const when = assistantTime(entry.submitted_at) ?? '--:--';
    return { label: `${entry.checkpoints?.name ?? 'Checkpoint'} - ${when}`, value: `${label}: ${value}` };
  });
  return <div><MetricGrid items={[["Entries today", rows.length], ["Checkpoints", new Set(rows.map((row) => row.checkpoint_id).filter(Boolean)).size]]} /><ReportRows rows={entries} empty='No Datalog entries captured today for this site.' /></div>;
}
function Summary({ devices, alerts, incidents, patrols, scans }: { devices: any[]; alerts: any[]; incidents: any[]; patrols: AssistantPatrolRow[]; scans: any[] }) { return <MetricGrid items={[['Devices Online', devices.filter((row) => row.status === 'online').length], ['Devices Offline', devices.filter((row) => row.status === 'offline').length], ['Active Patrols', patrols.filter((row) => ['active', 'in_progress'].includes(String(row.status))).length], ['Completed', filterPatrols(patrols, 'completed').length], ['Incidents', incidents.length], ['SOS', alerts.filter((row: any) => row.type === 'panic_button' && !row.is_read).length], ['Scans', scans.length]]} />; }
function Attention({ devices, alerts, patrols }: { devices: any[]; alerts: any[]; patrols: AssistantPatrolRow[] }) { return <MetricGrid items={[['Open Alerts', alerts.filter((row: any) => !row.is_read).length], ['SOS Alerts', alerts.filter((row: any) => row.type === 'panic_button').length], ['Offline Devices', devices.filter((row) => row.status === 'offline').length], ['Missed Patrols', filterPatrols(patrols, 'missed').length]]} />; }
function DeviceList({ devices, offlineOnly }: { devices: any[]; offlineOnly?: boolean }) { const rows = offlineOnly ? devices.filter((row) => row.status === 'offline') : devices; if (!rows.length) return <p>{offlineOnly ? 'All devices are online.' : 'No devices found for this site.'}</p>; return <div className='space-y-2'>{rows.slice(0, 10).map((device) => <div key={device.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{device.device_name ?? device.device_identifier ?? 'Device'}</b><p className='text-slate-400'>{device.device_identifier ? `${device.device_identifier} - ` : ''}{device.status ?? 'unknown'}</p></div>)}</div>; }
function IncidentList({ rows }: { rows: any[] }) { if (!rows.length) return <p>No incidents match this view for the active site.</p>; return <div className='space-y-2'>{rows.slice(0, 8).map((incident) => <div key={incident.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{incident.title ?? incident.incident_type ?? 'Incident'}</b><p className='text-slate-400'>{incident.severity ?? 'normal'} - {incident.resolved ? 'Resolved' : 'Open'} - {assistantDate(incident.created_at) ?? ''}</p></div>)}</div>; }
function CheckpointList({ rows }: { rows: any[] }) { if (!rows.length) return <p>No checkpoints match this view for the active site.</p>; return <div className='space-y-2'>{rows.slice(0, 12).map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{row.name}</b><p className='text-slate-400'>NFC: {row.nfc_tag_id ? 'Assigned' : 'Awaiting assignment'}</p></div>)}</div>; }

function drilldownLateMinutes(row: AssistantPatrolRow): number | null {
  if (!row.scheduled_start || !row.actual_start) return null;
  const diff = new Date(row.actual_start).getTime() - new Date(row.scheduled_start).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return Math.round(diff / 60000);
}

function PatrolSessionDrilldown({ rows, kind }: { rows: AssistantPatrolRow[]; kind: 'late' | 'missed' }) {
  const statuses = PATROL_STATUS_GROUPS[kind] as readonly string[];
  const selected = rows
    .filter((row) => statuses.includes(String(row.status)))
    .sort((a, b) => String(a.patrol_name ?? 'Patrol').localeCompare(String(b.patrol_name ?? 'Patrol')) || new Date(a.scheduled_start ?? 0).getTime() - new Date(b.scheduled_start ?? 0).getTime());

  if (!selected.length) {
    const empty = kind === 'late' ? 'No late patrol sessions found for the selected period.' : 'No missed patrol sessions found for the selected period.';
    return <div><p className='text-slate-300'>Period: Today</p><p className='mt-3'>{empty}</p><p className='mt-3 text-slate-400'>Type back to return.</p></div>;
  }

  const patrolNames = Array.from(new Set(selected.map((row) => row.patrol_name ?? 'Patrol')));
  return <div className='space-y-4'>
    <p className='text-slate-300'>Period: Today</p>
    {patrolNames.map((patrol) => {
      const patrolRows = selected.filter((row) => (row.patrol_name ?? 'Patrol') === patrol);
      return <div key={patrol} className='space-y-2'>
        <p className='font-bold text-emerald-300'>{patrol}</p>
        {patrolRows.map((row) => {
          const scheduled = assistantTime(row.scheduled_start) ?? 'Unknown time';
          const minutes = drilldownLateMinutes(row);
          const label = kind === 'late'
            ? scheduled + ' session - ' + (minutes == null ? 'Late' : minutes + ' min late')
            : scheduled + ' session - Missed';
          return <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3 font-mono text-sm text-slate-100'>{label}</div>;
        })}
      </div>;
    })}
    <p className='text-slate-400'>Type back to return.</p>
  </div>;
}
function PatrolSessionSummary({ rows, group, site }: { rows: AssistantPatrolRow[]; group: PatrolStatusGroup; site: string }) {
  const sections = summarizePatrolSessions(rows, group);
  const totals = patrolSummaryTotals(sections, group);
  if (!sections.length) {
    const empty = group === 'completed'
      ? 'No completed patrol sessions found for the selected period.'
      : group === 'incomplete'
        ? 'No incomplete patrol sessions.'
        : group === 'late'
          ? 'No late patrol sessions.'
          : 'No missed patrol sessions.';
    return <div><p className='text-slate-300'>Period: Today</p><p className='mt-3'>{empty}</p><p className='mt-3 text-slate-400'>View Reports for detailed session evidence.</p></div>;
  }
  return <div className='space-y-3'>
    <p className='text-slate-300'>Period: Today</p>
    {sections.map((section) => <div key={section.site_id ?? section.site_name} className='space-y-2'>
      {!section.site_id || section.site_name !== site ? <p className='font-bold text-emerald-300'>{section.site_name}</p> : null}
      {section.rows.map((row) => <div key={row.site_id + row.patrol_id} className='flex items-center justify-between gap-4 rounded-xl border border-white/10 bg-slate-950/70 p-3'>
        <span className='min-w-0 truncate font-bold'>{row.patrol_name}</span>
        <span className='shrink-0 text-sm text-emerald-300'>{patrolStatusSummaryLine(row, group)}</span>
      </div>)}
    </div>)}
    <p className='font-bold text-slate-100'>{group === 'completed' ? 'Total: ' + totals.matching + ' / ' + totals.expected + ' sessions completed' : 'Total ' + group + ' sessions: ' + totals.matching}</p>
    <p className='text-slate-400'>View Reports for detailed session evidence.</p>
  </div>;
}
function PatrolList({ rows, variant }: { rows: AssistantPatrolRow[]; variant?: 'missed' | 'late' | 'incomplete' }) {
  if (!rows.length) return <p>No matching patrols for the active site.</p>;
  return <div className='space-y-2'>{rows.slice(0, 10).map((row) => {
    const view = describePatrol(row);
    return <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
      <b>{view.patrol}</b>
      <p className='text-slate-400'>{view.site} - {view.date}</p>
      <p className='text-emerald-200'>Scheduled: {view.scheduledTime}{view.scheduledWindow ? ` (window ${view.scheduledWindow})` : ''}</p>
      <p className='text-slate-300'>Status: {variant === 'missed' ? 'Missed' : view.status}</p>
      {variant === 'late' ? <p className='text-amber-200'>Actual start: {view.actualStart ?? 'not started'}{view.lateBy ? ` - Late by ${view.lateBy}` : ''}</p> : null}
      {variant !== 'missed' ? <p className='text-slate-300'>Checkpoints: {view.checkpoints}{view.missedCheckpoints ? ` - ${view.missedCheckpoints} missed` : ''}</p> : null}
    </div>;
  })}</div>;
}

function MissedCheckpointList({ rows, loading }: { rows: MissedCheckpointRow[]; loading: boolean }) {
  if (loading) return <p>Loading missed checkpoints...</p>;
  if (!rows.length) return <p>No missed checkpoints for the active site.</p>;
  return <div className='space-y-2'>{rows.map((row) => {
    const session = row.patrol_sessions;
    return <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
      <b>{row.checkpoints?.name ?? row.checkpoint_name_snapshot ?? 'Checkpoint'}</b>
      <p className='text-slate-400'>Patrol: {session?.patrol_routes?.name ?? 'Session'} - {session?.sites?.name ?? 'Site'}</p>
      <p className='text-slate-300'>{assistantDate(row.scheduled_at ?? session?.scheduled_start) ?? 'Unknown date'} - Expected: {assistantTime(row.scheduled_at ?? session?.scheduled_start) ?? 'Unknown'}</p>
      <p className='text-rose-200'>Status: {String(row.status ?? 'missed')}</p>
    </div>;
  })}</div>;
}

function SavedReports({ jobs, loading }: { jobs: Array<{ id: string; report_type: string; status: string; date_range: string; created_at: string; sites?: { name: string } | null; ai_reports?: { summary_text: string | null; generated_at: string | null } | null }>; loading: boolean }) {
  if (loading) return <p>Loading reports...</p>;
  if (!jobs.length) return <p>No reports have been generated yet. Choose <b>Generate Patrol Report</b> to create one.</p>;
  return <div className='space-y-2'>{jobs.slice(0, 8).map((job) => <div key={job.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
    <b>{job.report_type.replace(/_/g, ' ')}</b>
    <p className='text-slate-400'>{job.sites?.name ?? 'All sites'} - {job.date_range} - {job.status}</p>
    <p className='text-slate-400'>{assistantDate(job.ai_reports?.generated_at ?? job.created_at)} {assistantTime(job.ai_reports?.generated_at ?? job.created_at)}</p>
    {job.ai_reports?.summary_text ? <p className='mt-1 text-slate-200'>{job.ai_reports.summary_text.slice(0, 400)}</p> : null}
  </div>)}</div>;
}

function WhatsAppAuthorizationPanel({ rows, users, siteId, loading, onCreate, onRevoke }: { rows: any[]; users: Array<{ id: string; name: string; phone?: string | null; role?: string | null }>; siteId: string | null; loading: boolean; onCreate: (input: { target_user_id?: string; target_user?: string; display_name: string; phone: string; access_type: string }) => Promise<string>; onRevoke: (authorizationId: string) => Promise<string> }) {
  const [userId, setUserId] = useState(users[0]?.id ?? 'manual');
  const selectedUser = users.find((user) => user.id === userId) ?? null;
  const [displayName, setDisplayName] = useState(selectedUser?.name ?? '');
  const [phone, setPhone] = useState(selectedUser?.phone ?? '');
  const [accessType, setAccessType] = useState('user');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const user = users.find((row) => row.id === userId);
    if (!user) return;
    setDisplayName(user.name);
    setPhone(user.phone ?? '');
  }, [userId, users]);

  const create = async () => {
    if (!siteId) return setNotice('Choose a site before authorizing WhatsApp access.');
    if (!displayName.trim()) return setNotice('Choose or type a user name.');
    if (!phone.trim()) return setNotice('Enter the WhatsApp number with country code.');
    setBusy(true);
    setNotice(null);
    try {
      const summary = await onCreate({ target_user_id: selectedUser?.id, target_user: selectedUser?.name ?? displayName.trim(), display_name: displayName.trim(), phone: phone.trim(), access_type: accessType });
      setNotice(summary);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not authorize WhatsApp number.');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (row: any) => {
    const label = row.display_name ?? row.masked_phone ?? row.phone ?? 'this number';
    if (!confirm('Revoke WhatsApp access for ' + label + '?')) return;
    setBusy(true);
    setNotice(null);
    try {
      const summary = await onRevoke(String(row.id));
      setNotice(summary);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Could not revoke WhatsApp access.');
    } finally {
      setBusy(false);
    }
  };

  return <div className='space-y-4'>
    <div className='rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4'>
      <b>Authorize WhatsApp access</b>
      <div className='mt-3 grid gap-2 md:grid-cols-2'>
        <label className='text-xs text-slate-300'>User
          <select value={userId} onChange={(event) => setUserId(event.target.value)} className='mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-white'>
            <option value='manual'>Manual name</option>
            {users.map((user) => <option key={user.id} value={user.id}>{user.name}{user.role ? ' (' + user.role + ')' : ''}</option>)}
          </select>
        </label>
        <label className='text-xs text-slate-300'>Access
          <select value={accessType} onChange={(event) => setAccessType(event.target.value)} className='mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-white'>
            <option value='user'>User Mode</option>
            <option value='management'>Management Mode</option>
          </select>
        </label>
        <label className='text-xs text-slate-300'>Display name
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className='mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-white' placeholder='John Doe' />
        </label>
        <label className='text-xs text-slate-300'>WhatsApp number
          <input value={phone} onChange={(event) => setPhone(event.target.value)} className='mt-1 w-full rounded-lg border border-white/10 bg-slate-950 p-2 text-white' placeholder='+26771234567' />
        </label>
      </div>
      <button type='button' onClick={create} disabled={busy || !siteId} className='mt-3 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-black text-black disabled:opacity-50'>{busy ? 'Working...' : 'Create Link Code'}</button>
      {notice ? <p className='mt-3 text-sm text-emerald-100'>{notice}</p> : null}
    </div>
    <div>
      <b>Authorized numbers</b>
      {loading ? <p className='mt-2 text-slate-400'>Loading WhatsApp authorizations...</p> : !rows.length ? <p className='mt-2 text-slate-400'>No WhatsApp numbers are authorized for this site yet.</p> : <div className='mt-2 space-y-2'>{rows.slice(0, 20).map((row) => <div key={row.id} className='flex flex-col gap-3 rounded-xl border border-white/10 bg-slate-950/70 p-3 md:flex-row md:items-center md:justify-between'><div><b>{row.display_name ?? 'Unknown user'}</b><p className='text-slate-400'>{row.masked_phone ?? row.phone ?? 'Not linked'} - {row.status ?? 'unknown'}{row.access_type ? ' - ' + row.access_type : ''}</p>{row.link_code ? <p className='font-mono text-emerald-200'>Code: {row.link_code}</p> : null}{row.link_code_expires_at ? <p className='text-xs text-slate-500'>Expires: {assistantDate(row.link_code_expires_at)} {assistantTime(row.link_code_expires_at)}</p> : null}</div><button type='button' onClick={() => revoke(row)} disabled={busy || row.status === 'revoked'} className='rounded-lg border border-red-400/30 px-3 py-2 text-sm font-bold text-red-200 disabled:opacity-40'>Revoke</button></div>)}</div>}
    </div>
  </div>;
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
  if (isLoading) return <p>Loading...</p>;
  if (!data?.length) return <p>Nothing configured for the active site yet.</p>;
  return <div className='space-y-2'>{data.map((row) => <div key={row.id} className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><b>{row.name}</b><p className='text-slate-400'>{row.status ?? 'active'}{row.start_time ? ` - ${row.start_time}${row.end_time ? ` - ${row.end_time}` : ''}` : ''}{row.frequency_type ? ` - ${row.frequency_type}` : ''}</p></div>)}</div>;
}
