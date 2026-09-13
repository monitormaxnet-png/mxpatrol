export type ReportCategory = {
  label: string;
  action: string;
  ownerOnly?: boolean;
};

export type ReportMenu = {
  title: string;
  parent: string;
  items: ReportCategory[];
};

export const REPORT_ROOT_ITEMS: ReportCategory[] = [
  { label: 'Checkpoint Scan Reports', action: 'menu:reports_checkpoint_scans' },
  { label: 'Patrol Reports', action: 'menu:reports_patrols' },
  { label: 'SOS Reports', action: 'menu:reports_sos' },
  { label: 'Incident Reports', action: 'menu:reports_incidents' },
  { label: 'Data Log Reports', action: 'menu:reports_data_logs' },
  { label: 'Device Reports', action: 'menu:reports_devices' },
  { label: 'Checkpoint Performance Reports', action: 'menu:reports_checkpoint_performance' },
  { label: 'Schedule Reports', action: 'menu:reports_schedules' },
  { label: 'Route Reports', action: 'menu:reports_routes' },
  { label: 'Device Security Reports', action: 'menu:reports_device_security', ownerOnly: true },
  { label: 'Back', action: 'back' },
];

export const REPORT_SUBMENUS: Record<string, ReportMenu> = {
  reports_checkpoint_scans: {
    title: 'CHECKPOINT SCAN REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Scans by Site / Date / Time', action: 'report:checkpoint_scans:site_time' },
      { label: 'Scans by Checkpoint', action: 'report:checkpoint_scans:checkpoint' },
      { label: 'Checkpoint Time Matrix', action: 'report:checkpoint_scans:matrix' },
      { label: 'Scans by Device', action: 'report:checkpoint_scans:device' },
      { label: 'Unregistered Tags', action: 'report:checkpoint_scans:unregistered' },
      { label: 'Duplicate Scans', action: 'report:checkpoint_scans:duplicate' },
      { label: 'Offline Synced Scans', action: 'report:checkpoint_scans:offline_synced' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_patrols: {
    title: 'PATROL REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Patrol Summary', action: 'report:patrols:summary' },
      { label: 'Patrol Session Details', action: 'report:patrols:details' },
      { label: 'Patrol Performance', action: 'report:patrols:performance' },
      { label: 'Patrol Timeline', action: 'report:patrols:timeline' },
      { label: 'Missed Checkpoints', action: 'missed_checkpoints' },
      { label: 'Late / Delayed Sessions', action: 'late_patrols' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_sos: {
    title: 'SOS REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'SOS Summary', action: 'report:sos:summary' },
      { label: 'Active SOS', action: 'report:sos:active' },
      { label: 'Resolved SOS', action: 'report:sos:resolved' },
      { label: 'SOS by Device', action: 'report:sos:device' },
      { label: 'SOS by Site', action: 'report:sos:site' },
      { label: 'Response Times', action: 'report:sos:response_times' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_incidents: {
    title: 'INCIDENT REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Incident Summary', action: 'report:incidents:summary' },
      { label: 'Open Incidents', action: 'incidents_open' },
      { label: 'High Priority', action: 'incidents_high' },
      { label: 'Resolved Incidents', action: 'incidents_resolved' },
      { label: 'Incidents by Site', action: 'report:incidents:site' },
      { label: 'Incidents by Device', action: 'report:incidents:device' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_data_logs: {
    title: 'DATA LOG REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Submission Summary', action: 'report:data_logs:summary' },
      { label: 'By Checkpoint', action: 'report:data_logs:checkpoint' },
      { label: 'By Form', action: 'report:data_logs:form' },
      { label: 'By Device', action: 'report:data_logs:device' },
      { label: 'Missing/Incomplete Data Logs', action: 'report:data_logs:missing' },
      { label: 'Offline Synced Data Logs', action: 'report:data_logs:offline_synced' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_devices: {
    title: 'DEVICE REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Device Summary', action: 'report:devices:summary' },
      { label: 'Online Devices', action: 'report:devices:online' },
      { label: 'Offline Devices', action: 'devices_offline' },
      { label: 'Device Activity', action: 'report:devices:activity' },
      { label: 'Device Patrol Activity', action: 'report:devices:patrol_activity' },
      { label: 'App Version Status', action: 'report:devices:app_versions' },
      { label: 'Disabled/Revoked Devices', action: 'report:devices:disabled' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_checkpoint_performance: {
    title: 'CHECKPOINT PERFORMANCE',
    parent: 'reports_root',
    items: [
      { label: 'Most Scanned', action: 'report:checkpoint_performance:most_scanned' },
      { label: 'Least Scanned', action: 'report:checkpoint_performance:least_scanned' },
      { label: 'Missed Checkpoint Rate', action: 'report:checkpoint_performance:missed_rate' },
      { label: 'Repeatedly Missed Checkpoints', action: 'report:checkpoint_performance:repeatedly_missed' },
      { label: 'Average Scan Timing', action: 'report:checkpoint_performance:timing' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_schedules: {
    title: 'SCHEDULE REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Schedule Summary', action: 'report:schedules:summary' },
      { label: 'Active Schedules', action: 'schedules' },
      { label: 'Paused Schedules', action: 'report:schedules:paused' },
      { label: 'Missed Scheduled Sessions', action: 'missed_patrols' },
      { label: 'Late Starts', action: 'late_patrols' },
      { label: 'Completion Rate', action: 'report:schedules:completion_rate' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_routes: {
    title: 'ROUTE REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Route Summary', action: 'report:routes:summary' },
      { label: 'Route Usage', action: 'report:routes:usage' },
      { label: 'Route Completion Rate', action: 'report:routes:completion_rate' },
      { label: 'Missed Checkpoints by Route', action: 'report:routes:missed_checkpoints' },
      { label: 'Average Route Duration', action: 'report:routes:duration' },
      { label: 'Schedules Using Route', action: 'report:routes:schedules' },
      { label: 'Back', action: 'back' },
    ],
  },
  reports_device_security: {
    title: 'DEVICE SECURITY REPORTS',
    parent: 'reports_root',
    items: [
      { label: 'Security Summary', action: 'report:device_security:summary' },
      { label: 'Kiosk Inactive', action: 'report:device_security:kiosk_inactive' },
      { label: 'Outdated Apps', action: 'report:device_security:outdated_apps' },
      { label: 'Integrity Failures', action: 'report:device_security:integrity_failures' },
      { label: 'Disabled Devices', action: 'report:device_security:disabled' },
      { label: 'Security Command History', action: 'report:device_security:command_history' },
      { label: 'Maintenance Sessions', action: 'report:device_security:maintenance' },
      { label: 'Back', action: 'back' },
    ],
  },
};

export function reportRootItems(isPlatformOwner: boolean): ReportCategory[] {
  return REPORT_ROOT_ITEMS.filter((item) => !item.ownerOnly || isPlatformOwner);
}

export function reportMenuItems(key: string, isPlatformOwner: boolean): ReportCategory[] {
  if (key === 'user_reports' || key === 'management_reports') return reportRootItems(isPlatformOwner);
  return REPORT_SUBMENUS[key]?.items ?? [];
}

export function isDeviceSecurityReportAction(action: string): boolean {
  return action.startsWith('report:device_security:') || action === 'menu:reports_device_security';
}
