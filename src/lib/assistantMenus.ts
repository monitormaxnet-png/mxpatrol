import { REPORT_ROOT_ITEMS, REPORT_SUBMENUS, isDeviceSecurityReportAction, reportMenuItems } from './assistantReportDefinitions';
export type AssistantMode = 'user' | 'management';

export type MenuItem = { label: string; action: string };
export type MenuNode = { key: string; title: string; parent: string | null; items: MenuItem[] };

export type RouterState = {
  mode: AssistantMode;
  activeMenu: string;
  activeSiteId: string | null;
};

export type Resolution =
  | { kind: 'menu'; state: RouterState; menuKey: string }
  | { kind: 'action'; state: RouterState; action: string }
  | { kind: 'denied'; state: RouterState; action: string }
  | { kind: 'unknown'; state: RouterState };

export const USER_HOME = 'user_home';
export const MANAGEMENT_HOME = 'management_home';

export const ASSISTANT_MENUS: Record<string, MenuNode> = {
  [USER_HOME]: {
    key: USER_HOME,
    title: "TODAY'S OPERATIONS",
    parent: null,
    items: [
      { label: 'Patrol Status', action: 'menu:patrol_status' },
      { label: 'Missed Checkpoints Today', action: 'missed_checkpoints' },
      { label: 'Incidents', action: 'incidents' },
      { label: 'Datalog Today', action: 'datalog_today' },
      { label: 'Reports', action: 'menu:user_reports' },
      { label: 'Change Site', action: 'change_site' },
      { label: 'Management', action: 'switch_management' },
    ],
  },
  user_patrol_status: {
    key: 'user_patrol_status',
    title: 'PATROL STATUS',
    parent: USER_HOME,
    items: [
      { label: 'Completed', action: 'completed_patrols' },
      { label: 'Incomplete', action: 'incomplete_patrols' },
      { label: 'Late / Delayed', action: 'late_patrols' },
      { label: 'Missed', action: 'missed_patrols' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_patrol_status: {
    key: 'management_patrol_status',
    title: 'PATROL STATUS',
    parent: 'management_operations',
    items: [
      { label: 'Completed', action: 'completed_patrols' },
      { label: 'Incomplete', action: 'incomplete_patrols' },
      { label: 'Late / Delayed', action: 'late_patrols' },
      { label: 'Missed', action: 'missed_patrols' },
      { label: 'Back', action: 'back' },
    ],
  },

  user_reports: {
    key: 'user_reports',
    title: 'REPORTS',
    parent: USER_HOME,
    items: REPORT_ROOT_ITEMS,
  },
  [MANAGEMENT_HOME]: {
    key: MANAGEMENT_HOME,
    title: 'MX PATROL - MANAGEMENT',
    parent: null,
    items: [
      { label: 'Organization Setup', action: 'menu:management_organization' },
      { label: 'Operations', action: 'menu:management_operations' },
      { label: 'Devices', action: 'menu:management_devices' },
      { label: 'Checkpoints', action: 'menu:management_checkpoints' },
      { label: 'Incidents', action: 'menu:management_incidents' },
      { label: 'Patrol Configuration', action: 'menu:management_patrol_config' },
      { label: 'Reports', action: 'menu:management_reports' },
      { label: 'WhatsApp Management', action: 'menu:management_whatsapp' },
      { label: 'Secure Patrol Devices', action: 'secure_devices' },
      { label: 'Change Site', action: 'change_site' },
      { label: 'User Assistant', action: 'switch_user' },
    ],
  },
  management_operations: {
    key: 'management_operations',
    title: 'OPERATIONS',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'Live Patrol', action: 'live' },
      { label: 'Patrol Status', action: 'menu:patrol_status' },
      { label: 'Missed Checkpoints', action: 'missed_checkpoints' },
      { label: 'Back', action: 'back' },
    ],

  },
  management_organization: {
    key: 'management_organization',
    title: 'ORGANIZATION SETUP',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'Register Company', action: 'register_company' },
      { label: 'Register Site', action: 'register_site' },
      { label: 'View Companies', action: 'view_companies' },
      { label: 'View Sites', action: 'view_sites' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_devices: {
    key: 'management_devices',
    title: 'DEVICES',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'View Devices', action: 'devices' },
      { label: 'Offline Devices', action: 'devices_offline' },
      { label: 'Device Security', action: 'secure_devices' },
      { label: 'Register Device', action: 'register_device' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_checkpoints: {
    key: 'management_checkpoints',
    title: 'CHECKPOINTS',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'View Checkpoints', action: 'checkpoints' },
      { label: 'Missed Checkpoints', action: 'missed_checkpoints' },
      { label: 'Pending NFC Assignment', action: 'pending_nfc' },
      { label: 'Register Checkpoint', action: 'register_checkpoint' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_incidents: {
    key: 'management_incidents',
    title: 'INCIDENTS',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'Open Incidents', action: 'incidents_open' },
      { label: 'High Priority', action: 'incidents_high' },
      { label: 'Resolved Incidents', action: 'incidents_resolved' },
      { label: 'Register Incident', action: 'register_incident' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_patrol_config: {
    key: 'management_patrol_config',
    title: 'PATROL CONFIGURATION',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'View Patrol Status', action: 'menu:patrol_status' },
      { label: 'View Routes', action: 'routes' },
      { label: 'View Schedules', action: 'schedules' },
      { label: 'Create Patrol Template', action: 'create_patrol' },
      { label: 'Create Route', action: 'create_route' },
      { label: 'Create Schedule', action: 'create_schedule' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_whatsapp: {
    key: 'management_whatsapp',
    title: 'WHATSAPP MANAGEMENT',
    parent: MANAGEMENT_HOME,
    items: [
      { label: 'Authorize WhatsApp Number', action: 'authorize_whatsapp' },
      { label: 'View Authorized Numbers', action: 'view_whatsapp_numbers' },
      { label: 'Revoke WhatsApp Access', action: 'revoke_whatsapp_access' },
      { label: 'Back', action: 'back' },
    ],
  },
  management_reports: {
    key: 'management_reports',
    title: 'REPORTS',
    parent: MANAGEMENT_HOME,
    items: REPORT_ROOT_ITEMS,
  },
  ...Object.fromEntries(Object.entries(REPORT_SUBMENUS).map(([key, menu]) => [key, {
    key,
    title: menu.title,
    parent: menu.parent,
    items: menu.items,
  }])),
};

export function homeMenu(mode: AssistantMode): string {
  return mode === 'management' ? MANAGEMENT_HOME : USER_HOME;
}

export function menuNode(key: string): MenuNode {
  return ASSISTANT_MENUS[key] ?? ASSISTANT_MENUS[USER_HOME];
}

const MANAGEMENT_ONLY_ACTIONS = new Set([
  'secure_devices',
  'register_device',
  'register_checkpoint',
  'register_incident',
  'create_patrol',
  'create_route',
  'create_schedule',
  'pending_nfc',
  'generate_report',
  'report:device_security:summary',
  'report:device_security:kiosk_inactive',
  'report:device_security:outdated_apps',
  'report:device_security:integrity_failures',
  'report:device_security:disabled',
  'report:device_security:command_history',
  'report:device_security:maintenance',
  'authorize_whatsapp',
  'view_whatsapp_numbers',
  'revoke_whatsapp_access',
  'register_company',
  'register_site',
  'view_companies',
  'view_sites',
  
  'routes',
  'schedules',
]);

/** Natural-language intents. Evaluated only for non-numeric input, so menu numbers never fall through. */
const NL_INTENTS: Array<[RegExp, string]> = [
  [/patrol\s+status/, 'menu:patrol_status'],
  [/(missed\s+checkpoint|checkpoint.*miss)/, 'missed_checkpoints'],
  [/^(missed|missed sessions?|show missed sessions?)$/, 'missed_sessions'],
  [/^(late sessions?|show late sessions?)$/, 'late_sessions'],
  [/missed\s+patrol/, 'missed_patrols'],
  [/(late|delayed)\s+patrol/, 'late_patrols'],
  [/incomplete\s+patrol/, 'incomplete_patrols'],
  [/completed\s+patrol/, 'completed_patrols'],
  [/(offline\s+device|device.*offline)/, 'devices_offline'],
  [/(whatsapp|authorize.*number|link code|revoke.*whatsapp)/, 'menu:management_whatsapp'],
  [/(whatsapp|authorize.*number|link code|revoke.*whatsapp)/, 'menu:management_whatsapp'],
  [/(organization|organisation|company|companies|site registration|register site|register company|view sites)/, 'menu:management_organization'],
  [/(yesterday.*report|report.*yesterday)/, 'report:yesterday'],
  [/(week.*report|report.*week)/, 'report:week'],
  [/(today.*report|report.*today|daily report)/, 'report:today'],
  [/generate.*report/, 'generate_report'],
  [/checkpoint.*matrix/, 'report:checkpoint_scans:matrix'],
  [/(checkpoint.*activity|activity.*checkpoint|checkpoint.*scan.*report|scan.*checkpoint.*report)/, 'menu:reports_checkpoint_activity'],
  [/(scan.*investigation|investigation.*scan)/, 'menu:reports_scan_investigations'],
  [/patrol.*report/, 'menu:reports_patrols'],
  [/sos.*report/, 'menu:reports_sos'],
  [/incident.*report/, 'menu:reports_incidents'],
  [/^(datalog|data log|data logs)$/, 'datalog_today'],
  [/data log.*report/, 'menu:reports_data_logs'],
  [/device security.*report/, 'menu:reports_device_security'],
  [/device.*report/, 'menu:reports_devices'],
  [/schedule.*report/, 'menu:reports_schedules'],
  [/route.*report/, 'menu:reports_routes'],
  [/(secure device|device security|lock device|disable device|enable device|revoke device|maintenance mode)/, 'secure_devices'],
  [/device/, 'devices'],
  [/incident/, 'incidents'],
  [/(saved|available)\s+report/, 'saved_reports'],
  [/report/, 'menu:reports'],
  [/(live now|live|what.*happening)/, 'live'],
  [/(attention|problem|issue)/, 'attention'],
  [/checkpoint/, 'checkpoints'],
  [/(change site|switch site)/, 'change_site'],
];

function normalize(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, ' ');
}

function applyAction(state: RouterState, action: string, canManage: boolean, isPlatformOwner = false): Resolution {
  if (action === 'back') {
    const configuredParent = menuNode(state.activeMenu).parent ?? homeMenu(state.mode);
    const parent = configuredParent === 'reports_root' ? (state.mode === 'management' ? 'management_reports' : 'user_reports') : configuredParent;
    const next = { ...state, activeMenu: parent };
    return { kind: 'menu', state: next, menuKey: parent };
  }

  if (action === 'switch_management') {
    if (!canManage) return { kind: 'denied', state, action: 'switch_management' };
    const next: RouterState = { ...state, mode: 'management', activeMenu: MANAGEMENT_HOME };
    return { kind: 'menu', state: next, menuKey: MANAGEMENT_HOME };
  }

  if (action === 'switch_user') {
    const next: RouterState = { ...state, mode: 'user', activeMenu: USER_HOME };
    return { kind: 'menu', state: next, menuKey: USER_HOME };
  }

  if (action.startsWith('menu:')) {
    let key = action.slice(5);
    if (key === 'reports') key = state.mode === 'management' ? 'management_reports' : 'user_reports';
    if (key === 'patrol_status') key = state.mode === 'management' ? 'management_patrol_status' : 'user_patrol_status';
    if (!ASSISTANT_MENUS[key]) return { kind: 'unknown', state };
    if (key.startsWith('management_') && !canManage) return { kind: 'denied', state, action: key };
    if (isDeviceSecurityReportAction(action) && !isPlatformOwner) return { kind: 'denied', state, action };
    const next = { ...state, activeMenu: key };
    return { kind: 'menu', state: next, menuKey: key };
  }

  if (MANAGEMENT_ONLY_ACTIONS.has(action) && !canManage) {
    return { kind: 'denied', state, action };
  }
  if (isDeviceSecurityReportAction(action) && !isPlatformOwner) {
    return { kind: 'denied', state, action };
  }

  return { kind: 'action', state, action };
}

/**
 * Interprets one assistant input against the CURRENT menu context.
 * Numeric input is only ever resolved against `state.activeMenu`.
 */
export function resolveAssistantInput(
  state: RouterState,
  rawInput: string,
  opts: { canManage: boolean; isPlatformOwner?: boolean },
): Resolution {
  const input = normalize(rawInput);
  if (!input) return { kind: 'unknown', state };

  if (input === 'menu' || input === 'main' || input === 'main menu' || input === 'home') {
    const key = homeMenu(state.mode);
    return { kind: 'menu', state: { ...state, activeMenu: key }, menuKey: key };
  }

  if (input === 'back') return applyAction(state, 'back', opts.canManage, opts.isPlatformOwner);

  if (input === 'cancel' || input === 'exit' || input === 'stop') {
    const key = homeMenu(state.mode);
    return { kind: 'menu', state: { ...state, activeMenu: key }, menuKey: key };
  }

  if (input === 'user' || input === 'user assistant') return applyAction(state, 'switch_user', opts.canManage, opts.isPlatformOwner);
  if (input === 'management' || input === 'management assistant' || input === 'admin') {
    return applyAction(state, 'switch_management', opts.canManage, opts.isPlatformOwner);
  }

  const node = menuNode(state.activeMenu);
  const visibleReportItems = reportMenuItems(state.activeMenu, !!opts.isPlatformOwner);
  const menuItems = visibleReportItems.length ? visibleReportItems : node.items;

  if (/^\d+$/.test(input)) {
    const index = Number(input);
    const item = menuItems[index - 1];
    if (!item) return { kind: 'unknown', state };
    return applyAction(state, item.action, opts.canManage, opts.isPlatformOwner);
  }

  const labelMatch = menuItems.find((item) => normalize(item.label).replace(/[^a-z0-9 ]/g, '').trim() === input.replace(/[^a-z0-9 ]/g, '').trim());
  if (labelMatch) return applyAction(state, labelMatch.action, opts.canManage, opts.isPlatformOwner);

  for (const [pattern, action] of NL_INTENTS) {
    if (pattern.test(input)) return applyAction(state, action, opts.canManage, opts.isPlatformOwner);
  }

  return { kind: 'unknown', state };
}




