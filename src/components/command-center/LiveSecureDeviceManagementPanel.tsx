import { useState, type ComponentType } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, RefreshCw, ShieldCheck, Smartphone, Wifi, X, Zap, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { usePlatformAdmin } from '@/hooks/usePlatformAdmin';

type Tone = 'green' | 'blue' | 'amber' | 'red' | 'neutral';
type IconComponent = ComponentType<{ className?: string }>;
type SecureDeviceAction =
  | 'request_device_lock'
  | 'request_device_disable'
  | 'request_device_enable'
  | 'request_maintenance_mode'
  | 'request_exit_maintenance'
  | 'request_enable_kiosk_mode'
  | 'request_disable_kiosk_mode'
  | 'request_app_update'
  | 'request_integrity_check'
  | 'revoke_device';

type SecureDeviceRow = {
  id?: string;
  device_identifier?: string | null;
  device_name?: string | null;
  status?: string | null;
  site?: string | null;
  last_seen_at?: string | null;
  app_version?: string | null;
  minimum_app_version?: string | null;
  device_owner_active?: boolean | null;
  kiosk_active?: boolean | null;
  secure_mode_enabled?: boolean | null;
  secure_mode_status?: string | null;
  developer_mode_detected?: boolean | null;
  adb_detected?: boolean | null;
  last_integrity_check_at?: string | null;
  maintenance_expires_at?: string | null;
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

type CommandResult = { command_id: string | null; command_type: string; command_status: string; queued: boolean };

const actionLabels: Record<SecureDeviceAction, string> = {
  request_device_lock: 'Lock Device',
  request_device_disable: 'Disable Device',
  request_device_enable: 'Enable Device',
  request_maintenance_mode: 'Maintenance Mode',
  request_exit_maintenance: 'Exit Maintenance',
  request_enable_kiosk_mode: 'Enable Kiosk Mode',
  request_disable_kiosk_mode: 'Disable Kiosk Mode',
  request_app_update: 'Require App Update',
  request_integrity_check: 'Security Check',
  revoke_device: 'Revoke Device',
};

const actionIcons: Record<SecureDeviceAction, IconComponent> = {
  request_device_lock: Lock,
  request_device_disable: X,
  request_device_enable: Check,
  request_maintenance_mode: RefreshCw,
  request_exit_maintenance: ShieldCheck,
  request_enable_kiosk_mode: Lock,
  request_disable_kiosk_mode: ShieldCheck,
  request_app_update: Zap,
  request_integrity_check: ShieldCheck,
  revoke_device: Trash2,
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
  if (isOutdated(device)) return { label: 'Outdated app', tone: 'amber' };
  if (device.secure_mode_enabled && !device.kiosk_active) return { label: 'Kiosk Inactive', tone: 'amber' };
  if (device.status === 'offline') return { label: 'Offline', tone: 'blue' };
  if (device.secure_mode_enabled || device.kiosk_active) return { label: 'Secure', tone: 'green' };
  return { label: 'Attention', tone: 'amber' };
}

function isOutdated(device: SecureDeviceRow) {
  if (!device.app_version || !device.minimum_app_version) return false;
  const left = device.app_version.split('.').map((part) => Number(part) || 0);
  const right = device.minimum_app_version.split('.').map((part) => Number(part) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff < 0;
  }
  return false;
}

function timeAgo(iso?: string | null) {
  if (!iso) return 'Unknown';
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return 'Unknown';
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return minutes + ' min ago';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + ' hr ago';
  return Math.floor(hours / 24) + ' days ago';
}

function useSecureDeviceSummary(siteId: string | null) {
  return useQuery({
    queryKey: ['secure-device-summary', siteId],
    enabled: Boolean(siteId),
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('secure-device-management', {
        body: { action: 'get_secure_device_summary', site_id: siteId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (!data?.summary) throw new Error('Secure device summary was not returned by the backend');
      return data.summary as SecureDeviceSummary;
    },
  });
}

function useSecureDeviceCommand(siteId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ action, deviceIdentifier }: { action: SecureDeviceAction; deviceIdentifier: string }) => {
      if (!siteId) throw new Error('Choose an active site before managing secure devices');
      const payload = action === 'request_maintenance_mode' ? { expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), duration_minutes: 10 } : {};
      const { data, error } = await supabase.functions.invoke('secure-device-management', {
        body: { action, site_id: siteId, device_identifier: deviceIdentifier, payload, channel: 'web' },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data.result as CommandResult;
    },
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['secure-device-summary', siteId] });
      toast.success('Secure command ' + result.command_status, { description: variables.deviceIdentifier });
    },
    onError: (error) => {
      toast.error('Secure command failed', { description: error instanceof Error ? error.message : 'Please try again.' });
    },
  });
}

function MetricBox({ label, value, icon: Icon, tone, loading, error }: { label: string; value?: number; icon: IconComponent; tone: Tone; loading: boolean; error: boolean }) {
  return (
    <div className='rounded-xl border border-white/10 bg-[#07101d]/85 p-3'>
      <div className='mb-2 flex items-center justify-between gap-3'>
        <span className='text-[11px] uppercase tracking-[0.1em] text-slate-400'>{label}</span>
        <Icon className={'h-4 w-4 shrink-0 ' + toneClasses(tone)} aria-hidden='true' />
      </div>
      <p className={'text-2xl font-black ' + (error ? 'text-slate-500' : toneClasses(tone))}>{loading ? '...' : error ? '-' : value}</p>
    </div>
  );
}

function DetailLine({ label, value }: { label: string; value?: string | number | boolean | null }) {
  if (value === undefined || value === null || value === '') return null;
  return <div className='flex items-center justify-between gap-3 border-b border-white/10 py-2 text-xs last:border-b-0'><span className='text-slate-500'>{label}</span><span className='text-right font-semibold text-slate-200'>{String(value)}</span></div>;
}

function isKioskAction(action: SecureDeviceAction) {
  return action === 'request_enable_kiosk_mode' || action === 'request_disable_kiosk_mode';
}

function kioskStatus(device: SecureDeviceRow | null) {
  if (!device) return 'Unknown';
  if (!device.device_owner_active && !device.kiosk_active) return 'Not Provisioned';
  return device.kiosk_active ? 'Active' : 'Inactive';
}

function deviceKey(device: SecureDeviceRow) {
  return String(device.device_identifier ?? device.id ?? '');
}

function deviceDisplayName(device: SecureDeviceRow | null) {
  if (!device) return 'No device selected';
  return String(device.device_name ?? device.device_identifier ?? device.id ?? 'Device');
}

function compactId(value?: string | null) {
  if (!value) return 'Unknown';
  return value.length > 18 ? value.slice(0, 8) + '...' + value.slice(-6) : value;
}

function canRunAction(action: SecureDeviceAction, device: SecureDeviceRow | null, canManageKiosk = false) {
  if (!device) return false;
  if (isKioskAction(action) && !canManageKiosk) return false;
  const status = String(device.secure_mode_status ?? '').toLowerCase();
  const revoked = status === 'revoked';
  const disabled = status === 'disabled';
  const maintenance = status === 'maintenance' || Boolean(device.maintenance_expires_at);
  if (revoked) return action === 'revoke_device';
  if (action === 'request_enable_kiosk_mode') return !device.kiosk_active && Boolean(device.device_owner_active) && !disabled;
  if (action === 'request_disable_kiosk_mode') return Boolean(device.kiosk_active);
  if (action === 'request_device_enable') return disabled;
  if (action === 'request_device_disable') return !disabled;
  if (action === 'request_maintenance_mode') return !maintenance && !disabled;
  if (action === 'request_exit_maintenance') return maintenance;
  if (action === 'request_device_lock') return !disabled;
  return true;
}
export function LiveSecureDeviceManagementPanel({ selectedSite, siteId }: { selectedSite: string; siteId: string | null }) {
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<SecureDeviceAction | null>(null);
  const [lastCommand, setLastCommand] = useState<CommandResult | null>(null);
  const summaryQuery = useSecureDeviceSummary(siteId);
  const commandMutation = useSecureDeviceCommand(siteId);
  const { isPlatformAdmin } = usePlatformAdmin();
  const summary = summaryQuery.data;
  const rows = summary?.rows ?? [];
  const activeDevice = rows.find((row) => deviceKey(row) === selectedDevice) ?? null;
  const activeIdentifier = activeDevice ? deviceKey(activeDevice) : null;
  const activeDeviceName = deviceDisplayName(activeDevice);

  const metrics = [
    ['Total Devices', summary?.total, Smartphone, 'neutral'],
    ['Secure Devices', summary?.secure, ShieldCheck, 'green'],
    ['Attention', summary?.attention, AlertTriangle, 'amber'],
    ['Disabled', summary?.disabled, X, 'red'],
    ['Offline', summary?.offline, Wifi, 'blue'],
  ] as const;

  const askCommand = (action: SecureDeviceAction) => {
    if (!activeIdentifier) {
      toast.error('Select a secure patrol device first');
      return;
    }
    setPendingAction(action);
  };

  const confirmCommand = () => {
    if (!pendingAction || !activeIdentifier) return;
    commandMutation.mutate(
      { action: pendingAction, deviceIdentifier: activeIdentifier },
      {
        onSuccess: (result) => {
          setLastCommand(result);
          setPendingAction(null);
        },
      },
    );
  };

  return (
    <section className='rounded-2xl border border-emerald-400/20 bg-slate-950/50 p-3'>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-3'>
        <h2 className='flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-emerald-300'><Lock className='h-4 w-4' /> Management AI: Secure Patrol Device Mode</h2>
        <span className='rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200'>Site: {selectedSite}</span>
      </div>

      <div className='grid gap-3 xl:grid-cols-[1fr_0.9fr]'>
        <div className='space-y-3'>
          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-5'>
            {metrics.map(([label, value, Icon, tone]) => <MetricBox key={label} label={label} value={value} icon={Icon} tone={tone} loading={summaryQuery.isLoading} error={summaryQuery.isError} />)}
          </div>

          <div className='overflow-hidden rounded-xl border border-white/10 bg-[#07101d]/85'>
            <div className='grid grid-cols-[1.2fr_1fr_0.8fr_1fr_0.8fr] gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500'>
              <span>Device Name</span><span>Site</span><span>Kiosk</span><span>Security</span><span>Status</span>
            </div>
            {!siteId ? <div className='px-3 py-6 text-sm text-amber-200'>Choose an active site before loading secure devices.</div> : null}
            {siteId && summaryQuery.isLoading ? <div className='px-3 py-6 text-sm text-slate-400'>Loading secure device status...</div> : null}
            {siteId && summaryQuery.isError ? <div className='space-y-3 px-3 py-6 text-sm text-red-300'><p>Secure device data could not load.</p><p className='text-xs text-red-200/80'>{summaryQuery.error instanceof Error ? summaryQuery.error.message : 'Backend request failed.'}</p><button type='button' onClick={() => summaryQuery.refetch()} className='rounded-lg border border-red-400/25 px-3 py-2 text-xs font-bold text-red-100'>Retry</button></div> : null}
            {siteId && summaryQuery.isSuccess && !rows.length ? <div className='px-3 py-6 text-sm text-slate-400'>No secure patrol devices found for this active site.</div> : null}
            {siteId && summaryQuery.isSuccess && rows.map((device) => {
              const state = secureState(device);
              const identifier = deviceKey(device);
              const displayName = deviceDisplayName(device);
              const selected = selectedDevice === identifier;
              return (
                <button type='button' key={device.id ?? identifier} aria-pressed={selected} onClick={() => { setSelectedDevice(identifier); setPendingAction(null); setLastCommand(null); }} className={(selected ? 'border-emerald-400/45 bg-emerald-400/[0.09] ring-1 ring-emerald-400/30' : 'border-white/5 hover:border-emerald-400/25 hover:bg-emerald-400/[0.04]') + ' grid w-full grid-cols-[1.2fr_1fr_0.8fr_1fr_0.8fr] items-center gap-2 border-b px-3 py-3 text-left text-xs transition last:border-b-0 focus:outline-none focus:ring-2 focus:ring-emerald-400/40'}>
                  <span><b className='block text-white'>{displayName}</b><span className='text-slate-500'>{selected ? 'Selected - ' : ''}{compactId(device.id ?? device.device_identifier)}</span></span>
                  <span className='truncate text-slate-400'>{device.site ?? 'Unassigned'}</span>
                  <span className='text-slate-300'>{kioskStatus(device)}</span>
                  <span className={toneClasses(state.tone)}>{state.label}</span>
                  <span className={device.status === 'online' ? 'text-emerald-300' : device.status === 'offline' ? 'text-blue-300' : 'text-slate-300'}>{device.status ?? 'unknown'}{selected ? ' - Selected' : ''}</span>
                </button>
              );
            })}
          </div>

          <div className='grid gap-2 sm:grid-cols-2 xl:grid-cols-4'>
            {(Object.entries(actionLabels) as [SecureDeviceAction, string][]).filter(([action]) => !isKioskAction(action) || isPlatformAdmin).map(([action, label]) => {
              const Icon = actionIcons[action];
              const destructive = action === 'revoke_device' || action === 'request_device_disable';
              return <button type='button' key={action} disabled={commandMutation.isPending || !canRunAction(action, activeDevice, isPlatformAdmin)} onClick={() => askCommand(action)} className={(destructive ? 'border-red-400/25 text-red-200' : 'border-emerald-400/20 text-emerald-200') + ' inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-slate-950/70 px-3 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50'}><Icon className='h-3.5 w-3.5' />{label}</button>;
            })}
          </div>
        </div>

        <aside className='rounded-xl border border-cyan-400/15 bg-[#07101d]/85 p-4'>
          <p className='mb-3 text-xs font-black uppercase tracking-[0.12em] text-cyan-300'>AI confirmation flow</p>
          <div className='rounded-xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white'>
            <p className='mb-2 font-black uppercase tracking-[0.08em]'>Management AI</p>
            {summaryQuery.isLoading ? <p>Loading secure device status...</p> : summaryQuery.isError ? <p className='text-red-200'>Secure device data could not load.</p> : <p>{summary ? 'Found ' + summary.attention + ' devices with security issues.' : 'Secure device status loads from the backend.'}</p>}
            {summary ? <ul className='mt-2 list-inside list-disc text-slate-300'><li>{summary.outdated} outdated app versions</li><li>{summary.kiosk_disabled} kiosk inactive</li><li>{summary.integrity_failures} integrity failures</li><li>{summary.offline} offline devices</li></ul> : null}
          </div>

          <div className='my-4 rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white'>Selected: {activeDeviceName}</div>

          {activeDevice ? <div className='mb-4 rounded-xl border border-white/10 bg-slate-950/70 p-3'>
            <p className='text-xs font-black uppercase tracking-[0.1em] text-emerald-300'>Security Status</p>
            <DetailLine label='Device Name' value={activeDeviceName} />
            <DetailLine label='Device ID' value={compactId(activeDevice.id)} />
            <DetailLine label='Device Identifier' value={compactId(activeDevice.device_identifier)} />
            <DetailLine label='Site' value={activeDevice.site ?? selectedSite} />
            <DetailLine label='Device Owner' value={activeDevice.device_owner_active ? 'Active' : 'Not Provisioned'} />
            <DetailLine label='Kiosk Status' value={kioskStatus(activeDevice)} />
            <DetailLine label='App Version' value={activeDevice.app_version ?? 'Unknown'} />
            <DetailLine label='Minimum Version' value={activeDevice.minimum_app_version} />
            <DetailLine label='Integrity' value={activeDevice.secure_mode_status === 'integrity_failed' ? 'Failed' : activeDevice.last_integrity_check_at ? 'Passed' : 'Unknown'} />
            <DetailLine label='Enrollment' value={activeDevice.secure_mode_enabled ? 'Valid' : 'Not configured'} />
            <DetailLine label='Last Seen' value={timeAgo(activeDevice.last_seen_at)} />
            <DetailLine label='Device Status' value={activeDevice.status ?? 'unknown'} />
          </div> : null}

          {pendingAction && activeIdentifier ? <div className='mb-4 rounded-xl border border-amber-400/25 bg-amber-400/10 p-3 text-sm text-amber-50'>
            <p className='font-black uppercase tracking-[0.08em]'>{actionLabels[pendingAction]} - Confirm</p>
            <p className='mt-2'>Device: {activeDeviceName}</p>
            <p>Site: {selectedSite}</p>
            {isKioskAction(pendingAction) ? <p>Current Kiosk Status: {kioskStatus(activeDevice)}</p> : null}
            <p className='mt-2 text-amber-100/80'>{isKioskAction(pendingAction) ? 'This queues a real Android kiosk command. Kiosk Status updates only after the patrol device acknowledges the policy.' : 'This will queue a canonical secure-device-management command and write a security event.'}</p>
            <div className='mt-3 flex gap-2'>
              <button type='button' onClick={confirmCommand} disabled={commandMutation.isPending} className='rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-xs font-bold text-emerald-100'>Confirm</button>
              <button type='button' onClick={() => setPendingAction(null)} disabled={commandMutation.isPending} className='rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-slate-200'>Cancel</button>
            </div>
          </div> : null}

          {lastCommand ? <div className='mb-4 rounded-xl border border-blue-400/20 bg-blue-400/10 p-3 text-xs text-blue-100'>Command status: <b>{lastCommand.command_status}</b>{lastCommand.command_id ? ' - ' + lastCommand.command_id.slice(0, 8) : ''}</div> : null}

          <div className='rounded-xl border border-white/10 bg-slate-950/70 p-3'>
            <p className='text-xs font-black uppercase tracking-[0.1em] text-emerald-300'>Security controls</p>
            <div className='mt-2 space-y-2'>{['Commands routed through secure-device-management', 'High-impact actions require confirmation', 'Commands and security events are audited', 'Device identity/enrollment is verified where implemented'].map((event) => <div key={event} className='flex items-center gap-2 text-xs text-slate-300'><Check className='h-3.5 w-3.5 text-emerald-300' />{event}</div>)}</div>
          </div>
        </aside>
      </div>
    </section>
  );
}
