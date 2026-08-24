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

/** Single-line summary used by both web and text surfaces, e.g. `06:00 — Missed — Night Patrol`. */
export function patrolHeadline(row: AssistantPatrolRow): string {
  const view = describePatrol(row);
  const label = view.status === 'missed' ? 'Missed' : view.status.replace(/\b\w/g, (c) => c.toUpperCase());
  return `${view.scheduledTime} — ${label} — ${view.patrol}`;
}

export const PATROL_STATUS_GROUPS = {
  completed: ['completed', 'completed_late'],
  incomplete: ['incomplete'],
  late: ['late', 'late_start', 'delayed', 'completed_late'],
  missed: ['missed'],
} as const;
