import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, RefreshCw, ShieldCheck, Smartphone, Wifi, X } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type Tone = 'green' | 'blue' | 'amber' | 'red' | 'neutral';
type IconComponent = ComponentType<{ className?: string }>;
type SecureDeviceAction = 'request_device_lock' | 'request_device_disable' | 'request_maintenance_mode' | 'request_app_update' | 'request_integrity_check' | 'revoke_device';

type SecureDeviceRow = {
  id?: string;
  device_identifier?: string | null;
  device_name?: string | null;
  status?: string | null;
  site?: string | null;
  kiosk_active?: boolean | null;
  secure_mode_enabled?: boolean | null;
  secure_mode_status?: string | null;
  developer_mode_detected?: boolean | null;
  adb_detected?: boolean | null;
};

type SecureDeviceSummary = {
  rows: SecureDeviceRow[];
  total: number;
  secure: number;
  attention: number;
  disabled: number;
  offline: number;
  outdated: number;
  kiosk_disabled: number;
  integrity_failures: number;
};

const actionLabels: Record<SecureDeviceAction, string> = {
  request_device_lock: 'Lock Device',
  request_device_disable: 'Disable Device',
  request_maintenance_mode: 'Maintenance Mode',
  request_app_update: 'Require App Update',
  request_integrity_check: 'Security Check',
  revoke_device: 'Revoke Device',
};

function toneClasses(tone: Tone) {
  const map = {
    green: 'text-emerald-300',
    blue: 'text-blue-300',
    amber: 'text-amber-300',
    red: 'text-red-300',
    neutral: 'text-slate-300',
  } satisfies Record<Tone, string>;
  return map[tone];
}

function secureState(device: SecureDeviceRow): { label: string; tone: Tone } {
  if (device.secure_mode_status === 'revoked') return { label: 'Revoked', tone: 'red' };
  if (device.secure_mode_status === 'disabled') return { label: 'Disabled', tone: 'red' };
  if (device.secure_mode_status === 'maintenance') return { label: 'Maintenance', tone: 'amber' };
  if (device.secure_mode_status === 'update_required') return { label: 'Update Required', tone: 'amber' };
  if (device.secure_mode_status === 'integrity_failed') return { label: 'Integrity Failure', tone: 'red' };
  if (device.developer_mode_detected || device.adb_detected) return { label: 'Attention', tone: 'amber' };
  if (device.status === 'offline') return { label: 'Offline', tone: 'blue' };
  if (device.secure_mode_enabled || device.kiosk_active) return { label: 'Secure', tone: 'green' };
  return { label: 'Attention', tone: 'amber' };
}

function useSecureDeviceSummary(siteId: string | null) {
  return useQuery({
    queryKey: ['secure-device-summary', siteId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('secure-device-management', {
        body: { action: 'get_secure_device_summary', site_id: siteId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.summary as SecureDeviceSummary;
    },
  });
}

function useSecureDeviceCommand(siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, deviceIdentifier }: { action: SecureDeviceAction; deviceIdentifier: string }) => {
      const payload = action === 'request_maintenance_mode' ? { expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString() } : {};
      const { data, error } = await supabase.functions.invoke('secure-device-management', {
        body: { action, site_id: siteId, device_identifier: deviceIdentifier, payload, channel: 'web' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.result as { command_type: string; queued: boolean };
    },
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['secure-device-summary', siteId] });
      toast.success('Secure command queued', { description: variables.deviceIdentifier });
    },
    onError: (error) => {
      toast.error('Secure command failed', { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}

function MetricBox({ label, value, icon: Icon, tone, loading }: { label: string; value: number; icon: IconComponent; tone: Tone; loading: boolean }) {
  return <div className='rounded-xl border border-white/10 bg-[#07101d]/85 p-3'><div className='mb-2 flex items-center justify-between'><span className='text-[11px] uppercase tracking-[0.1em] text-slate-400'>{label}</span><Icon className={'h-4 w-4 ' + toneClasses(tone)} /></div><p className={'text-2xl font-black ' + toneClasses(tone)}>{loading ? '...' : value}</p></div>;
}

export function LiveSecureDeviceManagementPanel({ selectedSite, siteId }: { selectedSite: string; siteId: string | null }) {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const summaryQuery = useSecureDeviceSummary(siteId);
  const commandMutation = useSecureDeviceCommand(siteId);
  const summary = summaryQuery.data;
  const rows = (summary?.rows ?? []).slice(0, 8);
  const activeDevice = selectedDevice ?? rows[0]?.device_identifier ?? null;

  const requestCommand = (action: SecureDeviceAction, deviceIdentifier: string | null = activeDevice) => {
    if (!deviceIdentifier) {
      toast.error('Select a secure patrol device first');
      return;
    }
    if (!window.confirm(actionLabels[action] + ' for ' + deviceIdentifier + '? This queues a secure backend command and records an audit event.')) return;
    commandMutation.mutate({ action, deviceIdentifier });
  };

  return <section className='rounded-2xl border border-emerald-400/20 bg-slate-950/50 p-3'><div className='mb-3 flex flex-wrap items-center justify-between gap-3'><h2 className='flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-emerald-300'><Lock className='h-4 w-4' /> Management AI: Secure Patrol Device Mode</h2><span className='rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200'>Site: {selectedSite}</span></div><div className='grid gap-3 xl:grid-cols-[1fr_0.9fr]'><div className='space-y-3'><div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5'><MetricBox label='Total Devices' value={summary?.total ?? 0} icon={Smartphone} tone='neutral' loading={summaryQuery.isLoading} /><MetricBox label='Secure Devices' value={summary?.secure ?? 0} icon={ShieldCheck} tone='green' loading={summaryQuery.isLoading} /><MetricBox label='Attention' value={summary?.attention ?? 0} icon={AlertTriangle} tone='amber' loading={summaryQuery.isLoading} /><MetricBox label='Disabled' value={summary?.disabled ?? 0} icon={X} tone='red' loading={summaryQuery.isLoading} /><MetricBox label='Offline' value={summary?.offline ?? 0} icon={Wifi} tone='blue' loading={summaryQuery.isLoading} /></div><div className='overflow-hidden rounded-xl border border-white/10 bg-[#07101d]/85'><div className='grid grid-cols-[0.8fr_1.2fr_1fr_0.8fr_1fr_0.8fr] gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500'><span>Device</span><span>Name</span><span>Site</span><span>Kiosk</span><span>Security</span><span>Action</span></div>{summaryQuery.isError ? <div className='px-3 py-6 text-sm text-red-300'>Secure device data could not load.</div> : rows.length ? rows.map((device) => { const state = secureState(device); const identifier = device.device_identifier ?? 'Device'; return <button type='button' key={device.id ?? identifier} onClick={() => setSelectedDevice(identifier)} className={(activeDevice === identifier ? 'border-emerald-400/35 bg-emerald-400/[0.07]' : 'border-white/5') + ' grid w-full grid-cols-[0.8fr_1.2fr_1fr_0.8fr_1fr_0.8fr] items-center gap-2 border-b px-3 py-3 text-left text-xs last:border-b-0'}><span className='font-bold text-white'>{identifier}</span><span className='truncate text-slate-300'>{device.device_name ?? 'Unnamed device'}</span><span className='truncate text-slate-400'>{device.site ?? 'Unassigned'}</span><span className='text-slate-300'>{device.kiosk_active ? 'Locked' : 'Inactive'}</span><span className={toneClasses(state.tone)}>{state.label}</span><span className='flex gap-1'><span role='button' tabIndex={0} onClick={(event) => { event.stopPropagation(); requestCommand('request_device_lock', identifier); }} className='flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300' aria-label={'Lock ' + identifier}><Lock className='h-3.5 w-3.5' /></span><span role='button' tabIndex={0} onClick={(event) => { event.stopPropagation(); requestCommand('request_maintenance_mode', identifier); }} className='flex h-7 w-7 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-300' aria-label={'Maintenance ' + identifier}><RefreshCw className='h-3.5 w-3.5' /></span></span></button>; }) : <div className='px-3 py-6 text-sm text-slate-400'>{summaryQuery.isLoading ? 'Loading secure devices...' : 'No secure devices for this site.'}</div>}</div><div className='grid gap-2 sm:grid-cols-3 xl:grid-cols-6'>{(Object.entries(actionLabels) as [SecureDeviceAction, string][]).map(([action, label]) => <button type='button' key={action} disabled={commandMutation.isPending || !activeDevice} onClick={() => requestCommand(action)} className={(action === 'revoke_device' ? 'border-red-400/25 text-red-200' : 'border-emerald-400/20 text-emerald-200') + ' h-10 rounded-xl border bg-slate-950/70 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'}>{label}</button>)}</div></div><aside className='rounded-xl border border-cyan-400/15 bg-[#07101d]/85 p-4'><p className='mb-3 text-xs font-black uppercase tracking-[0.12em] text-cyan-300'>AI confirmation flow</p><div className='rounded-xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white'><p className='mb-2 font-black uppercase tracking-[0.08em]'>Management AI</p><p>{summary ? 'Found ' + summary.attention + ' devices with security issues.' : 'Secure device status loads from the backend.'}</p><ul className='mt-2 list-inside list-disc text-slate-300'><li>{summary?.outdated ?? 0} outdated app versions</li><li>{summary?.kiosk_disabled ?? 0} kiosk inactive</li><li>{summary?.integrity_failures ?? 0} integrity failures</li><li>{summary?.offline ?? 0} offline devices</li></ul></div><div className='my-4 ml-auto max-w-[22rem] rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white'>Selected: {activeDevice ?? 'No device selected'}</div><div className='rounded-xl border border-white/10 bg-slate-950/70 p-3'><p className='text-xs font-black uppercase tracking-[0.1em] text-emerald-300'>Security guarantees</p><div className='mt-2 space-y-2'>{['Commands are queued through secure-device-management', 'High-impact actions require confirmation', 'Every command writes a device security event'].map((event) => <div key={event} className='flex items-center gap-2 text-xs text-slate-300'><Check className='h-3.5 w-3.5 text-emerald-300' />{event}</div>)}</div></div></aside></div></section>;
}