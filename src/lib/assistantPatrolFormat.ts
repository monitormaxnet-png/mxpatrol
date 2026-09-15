export type AssistantPatrolRow = {
  id: string;
  status: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  finalized_at?: string | null;
  checkpoint_completed: number | null;
  checkpoint_total: number | null;
  site_id: string | null;
  patrol_id?: string | null;
  patrol_name?: string | null;
  site_name?: string | null;
};

const TZ = 'Africa/Johannesburg';

export function assistantTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).format(date);
}

export function assistantDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'short', day: '2-digit', timeZone: TZ }).format(date);
}

export function lateByMinutes(row: AssistantPatrolRow): number | null {
  if (!row.scheduled_start || !row.actual_start) return null;
  const diff = new Date(row.actual_start).getTime() - new Date(row.scheduled_start).getTime();
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return Math.round(diff / 60000);
}

export function formatDuration(minutes: number | null): string | null {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

export type PatrolDescription = {
  patrol: string;
  site: string;
  date: string;
  scheduledTime: string;
  scheduledWindow: string | null;
  actualStart: string | null;
  lateBy: string | null;
  status: string;
  checkpoints: string;
  missedCheckpoints: number;
};

export function describePatrol(row: AssistantPatrolRow): PatrolDescription {
  const scheduled = assistantTime(row.scheduled_start);
  const end = assistantTime(row.scheduled_end);
  const done = row.checkpoint_completed ?? 0;
  const total = row.checkpoint_total ?? 0;
  return {
    patrol: row.patrol_name || 'Patrol',
    site: row.site_name || 'Unassigned site',
    date: assistantDate(row.scheduled_start) ?? 'Unknown date',
    scheduledTime: scheduled ?? 'Unknown',
    scheduledWindow: scheduled && end ? `${scheduled} - ${end}` : null,
    actualStart: assistantTime(row.actual_start),
    lateBy: formatDuration(lateByMinutes(row)),
    status: String(row.status ?? 'unknown').replace(/_/g, ' '),
    checkpoints: `${done}/${total}`,
    missedCheckpoints: Math.max(total - done, 0),
  };
}

/** Single-line report detail helper, e.g. `06:00 - Missed - Night Patrol`. */
export function patrolHeadline(row: AssistantPatrolRow): string {
  const view = describePatrol(row);
  const label = view.status === 'missed' ? 'Missed' : view.status.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${view.scheduledTime} - ${label} - ${view.patrol}`;
}

export const PATROL_STATUS_GROUPS = {
  completed: ['completed', 'completed_late'],
  incomplete: ['incomplete'],
  late: ['late', 'late_start', 'delayed', 'completed_late'],
  missed: ['missed'],
} as const;

export type PatrolStatusGroup = keyof typeof PATROL_STATUS_GROUPS;

export const PATROL_STATUS_LABELS: Record<PatrolStatusGroup, string> = {
  completed: 'Completed',
  incomplete: 'Incomplete',
  late: 'Late / Delayed',
  missed: 'Missed',
};

export const PATROL_STATUS_TITLES: Record<PatrolStatusGroup, string> = {
  completed: 'COMPLETED PATROLS',
  incomplete: 'INCOMPLETE PATROLS',
  late: 'LATE PATROLS',
  missed: 'MISSED PATROLS',
};

export const PATROL_STATUS_EMPTY: Record<PatrolStatusGroup, string> = {
  completed: 'No completed patrol sessions found for the selected period.',
  incomplete: 'No incomplete patrol sessions.',
  late: 'No late patrol sessions.',
  missed: 'No missed patrol sessions.',
};

/** Counts each patrol outcome from real session rows already scoped to the active site/period. */
export function patrolStatusCounts(rows: Array<{ status: string | null }>): Record<PatrolStatusGroup, number> {
  const count = (group: PatrolStatusGroup) =>
    rows.filter((row) => (PATROL_STATUS_GROUPS[group] as readonly string[]).includes(String(row.status))).length;
  return { completed: count('completed'), incomplete: count('incomplete'), late: count('late'), missed: count('missed') };
}

export type PatrolSessionSummaryRow = {
  site_id: string | null;
  site_name: string;
  patrol_id: string;
  patrol_name: string;
  expected_sessions: number;
  completed_sessions: number;
  incomplete_sessions: number;
  late_sessions: number;
  missed_sessions: number;
};

export type PatrolSessionSummarySection = {
  site_id: string | null;
  site_name: string;
  rows: PatrolSessionSummaryRow[];
};

function statusInGroup(status: string | null | undefined, group: PatrolStatusGroup): boolean {
  return (PATROL_STATUS_GROUPS[group] as readonly string[]).includes(String(status));
}

function sessionSiteName(row: AssistantPatrolRow): string {
  return row.site_name || 'Unassigned site';
}

function sessionPatrolName(row: AssistantPatrolRow): string {
  return row.patrol_name || 'Patrol';
}

/**
 * Groups canonical patrol_sessions by site and Patrol definition/name.
 * `expected_sessions` is the number of generated sessions in the selected period,
 * never a checkpoint count.
 */
export function summarizePatrolSessions(rows: AssistantPatrolRow[], group: PatrolStatusGroup): PatrolSessionSummarySection[] {
  const buckets = new Map<string, PatrolSessionSummaryRow>();

  for (const row of rows) {
    const siteName = sessionSiteName(row);
    const patrolName = sessionPatrolName(row);
    const patrolId = row.patrol_id || `${row.site_id ?? 'none'}:${patrolName}`;
    const key = `${row.site_id ?? 'none'}:${patrolId}`;
    const current = buckets.get(key) ?? {
      site_id: row.site_id ?? null,
      site_name: siteName,
      patrol_id: patrolId,
      patrol_name: patrolName,
      expected_sessions: 0,
      completed_sessions: 0,
      incomplete_sessions: 0,
      late_sessions: 0,
      missed_sessions: 0,
    };

    current.expected_sessions += 1;
    if (statusInGroup(row.status, 'completed')) current.completed_sessions += 1;
    if (statusInGroup(row.status, 'incomplete')) current.incomplete_sessions += 1;
    if (statusInGroup(row.status, 'late')) current.late_sessions += 1;
    if (statusInGroup(row.status, 'missed')) current.missed_sessions += 1;
    buckets.set(key, current);
  }

  const statusKey = `${group}_sessions` as keyof Pick<PatrolSessionSummaryRow, 'completed_sessions' | 'incomplete_sessions' | 'late_sessions' | 'missed_sessions'>;
  const visibleRows = Array.from(buckets.values())
    .filter((row) => row[statusKey] > 0)
    .sort((a, b) => a.site_name.localeCompare(b.site_name) || a.patrol_name.localeCompare(b.patrol_name));

  const sections = new Map<string, PatrolSessionSummarySection>();
  for (const row of visibleRows) {
    const key = row.site_id ?? row.site_name;
    const section = sections.get(key) ?? { site_id: row.site_id, site_name: row.site_name, rows: [] };
    section.rows.push(row);
    sections.set(key, section);
  }

  return Array.from(sections.values());
}

export function patrolSummaryTotals(sections: PatrolSessionSummarySection[], group: PatrolStatusGroup) {
  const rows = sections.flatMap((section) => section.rows);
  if (group === 'completed') {
    return {
      matching: rows.reduce((sum, row) => sum + row.completed_sessions, 0),
      expected: rows.reduce((sum, row) => sum + row.expected_sessions, 0),
    };
  }
  return {
    matching: rows.reduce((sum, row) => sum + Number(row[`${group}_sessions` as keyof PatrolSessionSummaryRow] ?? 0), 0),
    expected: rows.reduce((sum, row) => sum + row.expected_sessions, 0),
  };
}

export function patrolStatusSummaryLine(row: PatrolSessionSummaryRow, group: PatrolStatusGroup): string {
  if (group === 'completed') {
    return `${row.patrol_name} - ${row.completed_sessions} / ${row.expected_sessions} sessions completed`;
  }
  const count = Number(row[`${group}_sessions` as keyof PatrolSessionSummaryRow] ?? 0);
  const label = group === 'incomplete' ? 'incomplete' : group === 'late' ? 'late' : 'missed';
  return `${row.patrol_name} - ${count} ${label} session${count === 1 ? '' : 's'}`;
}