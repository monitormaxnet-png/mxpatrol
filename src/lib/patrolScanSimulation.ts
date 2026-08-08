/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Preview-only patrol scan simulation.
 *
 * Pure functions: nothing here writes to the database. Given a hypothetical
 * (simulated) checkpoint scan, it explains for every patrol occurrence whether
 * the scan would be matched to it or missed, and why.
 */

export type SimulatedScan = {
  checkpointId: string;
  scannedAt: string; // ISO timestamp
  deviceIdentifier?: string | null;
  graceStartMinutes?: number;
  graceCompletionMinutes?: number;
};

export type OccurrenceVerdict = {
  sessionId: string;
  outcome: 'matched' | 'candidate' | 'missed';
  code:
    | 'matched'
    | 'candidate_other_occurrence_preferred'
    | 'checkpoint_not_on_route'
    | 'occurrence_closed'
    | 'device_not_bound'
    | 'before_start_window'
    | 'after_completion_window'
    | 'checkpoint_already_scanned'
    | 'no_scheduled_window';
  reason: string;
  detail?: string;
  windowStart: string | null;
  windowEnd: string | null;
  checkpointName: string | null;
  scheduledOrder: number | null;
  progressAfter: { completed: number; total: number } | null;
};

const CLOSED_STATUSES = new Set(['completed', 'completed_late', 'missed', 'incomplete', 'cancelled', 'archived']);

const minutes = (value: number) => value * 60 * 1000;

function toTime(value?: string | null) {
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function sessionCheckpoints(session: any): any[] {
  return session?.patrol_session_checkpoints ?? [];
}

function fallbackEnd(session: any, start: number | null) {
  const end = toTime(session?.scheduled_end);
  if (end) return end;
  const duration = Number(session?.patrol_templates?.expected_duration_minutes ?? session?.expected_duration_minutes ?? 60);
  return start ? start + minutes(Number.isFinite(duration) && duration > 0 ? duration : 60) : null;
}

function formatClock(value: number | null) {
  if (!value) return 'unknown time';
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function evaluateSimulatedScan(sessions: any[], scan: SimulatedScan): OccurrenceVerdict[] {
  const scanTime = toTime(scan.scannedAt);
  const graceStart = minutes(scan.graceStartMinutes ?? 10);
  const graceEnd = minutes(scan.graceCompletionMinutes ?? 15);

  const verdicts: OccurrenceVerdict[] = sessions.map((session) => {
    const checkpoints = sessionCheckpoints(session);
    const target = checkpoints.find((row) => row.checkpoint_id === scan.checkpointId);
    const start = toTime(session.scheduled_start);
    const end = fallbackEnd(session, start);
    const windowStart = start ? new Date(start - graceStart).toISOString() : null;
    const windowEnd = end ? new Date(end + graceEnd).toISOString() : null;
    const completed = checkpoints.filter((row) => row.scanned_at).length;
    const total = checkpoints.length;
    const base = {
      sessionId: session.id,
      windowStart,
      windowEnd,
      checkpointName: target?.checkpoints?.name ?? null,
      scheduledOrder: target?.sequence_order ?? null,
      progressAfter: null as OccurrenceVerdict['progressAfter'],
    };

    if (!target) {
      return { ...base, outcome: 'missed' as const, code: 'checkpoint_not_on_route' as const, reason: 'Checkpoint is not part of this occurrence’s route', detail: total ? `Route expects ${total} other checkpoint${total === 1 ? '' : 's'}` : 'No checkpoints attached to this occurrence' };
    }

    if (CLOSED_STATUSES.has(String(session.status))) {
      return { ...base, outcome: 'missed' as const, code: 'occurrence_closed' as const, reason: 'Occurrence is already closed', detail: `Status: ${String(session.status).replace(/_/g, ' ')}` };
    }

    const boundDevice = session.device_identifier ?? session.device_id ?? null;
    if (boundDevice && scan.deviceIdentifier && boundDevice !== scan.deviceIdentifier) {
      return { ...base, outcome: 'missed' as const, code: 'device_not_bound' as const, reason: 'Scan came from a device not bound to this occurrence', detail: `Bound to ${boundDevice}` };
    }

    if (target.scanned_at) {
      return { ...base, outcome: 'missed' as const, code: 'checkpoint_already_scanned' as const, reason: 'Checkpoint already recorded for this occurrence', detail: `Recorded at ${formatClock(toTime(target.scanned_at))}` };
    }

    if (!start) {
      return { ...base, outcome: 'missed' as const, code: 'no_scheduled_window' as const, reason: 'Occurrence has no scheduled window to match against' };
    }

    if (scanTime !== null && scanTime < start - graceStart) {
      return { ...base, outcome: 'missed' as const, code: 'before_start_window' as const, reason: 'Scan is before the start window', detail: `Window opens ${formatClock(start - graceStart)} (incl. ${scan.graceStartMinutes ?? 10} min grace)` };
    }

    if (scanTime !== null && end && scanTime > end + graceEnd) {
      return { ...base, outcome: 'missed' as const, code: 'after_completion_window' as const, reason: 'Scan is after the completion window', detail: `Window closed ${formatClock(end + graceEnd)} (incl. ${scan.graceCompletionMinutes ?? 15} min grace)` };
    }

    return {
      ...base,
      outcome: 'matched' as const,
      code: 'matched' as const,
      reason: 'Scan falls inside the window and the checkpoint is still open',
      detail: `Window ${formatClock(start - graceStart)} – ${formatClock(end ? end + graceEnd : null)}`,
      progressAfter: { completed: completed + 1, total },
    };
  });

  // Only one occurrence can actually consume the scan: the closest open window.
  const matched = verdicts
    .map((verdict, index) => ({ verdict, index }))
    .filter(({ verdict }) => verdict.outcome === 'matched')
    .sort((a, b) => (toTime(a.verdict.windowStart) ?? 0) - (toTime(b.verdict.windowStart) ?? 0));

  matched.slice(1).forEach(({ index }) => {
    verdicts[index] = {
      ...verdicts[index],
      outcome: 'candidate',
      code: 'candidate_other_occurrence_preferred',
      reason: 'Eligible, but an earlier open occurrence would consume the scan first',
    };
  });

  return verdicts;
}

export function summarizeVerdicts(verdicts: OccurrenceVerdict[]) {
  return {
    matched: verdicts.filter((verdict) => verdict.outcome === 'matched').length,
    candidates: verdicts.filter((verdict) => verdict.outcome === 'candidate').length,
    missed: verdicts.filter((verdict) => verdict.outcome === 'missed').length,
  };
}
