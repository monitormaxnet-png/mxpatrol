/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { CheckCircle2, FlaskConical, Info, MinusCircle, XCircle } from 'lucide-react';
import { SocPanel } from '@/components/dashboard/SocComponents';
import { evaluateSimulatedScan, summarizeVerdicts, type OccurrenceVerdict } from '@/lib/patrolScanSimulation';
import { patrolSessionLabel } from '@/hooks/useScheduledPatrols';

type CheckpointOption = { id: string; name?: string | null; nfc_tag_id?: string | null };

const fieldClass = 'mt-2 h-11 w-full rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-white outline-none focus:border-emerald-400/40';
const labelClass = 'text-[10px] font-black uppercase tracking-wider text-slate-500';

function localInputValue(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toneFor(outcome: OccurrenceVerdict['outcome']) {
  if (outcome === 'matched') return { chip: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300', row: 'border-emerald-400/20 bg-emerald-500/5', icon: CheckCircle2, label: 'Matched' };
  if (outcome === 'candidate') return { chip: 'border-amber-400/30 bg-amber-400/10 text-amber-300', row: 'border-amber-400/20 bg-amber-500/5', icon: MinusCircle, label: 'Eligible' };
  return { chip: 'border-red-400/30 bg-red-400/10 text-red-300', row: 'border-white/10 bg-black/25', icon: XCircle, label: 'Missed' };
}

export default function ScanValidationPreview({ sessions, checkpoints, devices, loading }: { sessions: any[]; checkpoints: CheckpointOption[]; devices: any[]; loading?: boolean }) {
  const [checkpointId, setCheckpointId] = useState('');
  const [scannedAtLocal, setScannedAtLocal] = useState(() => localInputValue(new Date()));
  const [deviceIdentifier, setDeviceIdentifier] = useState('any');
  const [graceStartMinutes, setGraceStartMinutes] = useState(10);
  const [graceCompletionMinutes, setGraceCompletionMinutes] = useState(15);
  const [onlyRelevant, setOnlyRelevant] = useState(true);

  const activeCheckpointId = checkpointId || checkpoints[0]?.id || '';
  const checkpointName = checkpoints.find((row) => row.id === activeCheckpointId)?.name ?? 'Checkpoint';

  const verdicts = useMemo(() => {
    if (!activeCheckpointId || !sessions.length) return [];
    return evaluateSimulatedScan(sessions, {
      checkpointId: activeCheckpointId,
      scannedAt: new Date(scannedAtLocal).toISOString(),
      deviceIdentifier: deviceIdentifier === 'any' ? null : deviceIdentifier,
      graceStartMinutes,
      graceCompletionMinutes,
    });
  }, [activeCheckpointId, deviceIdentifier, graceCompletionMinutes, graceStartMinutes, scannedAtLocal, sessions]);

  const summary = summarizeVerdicts(verdicts);
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions]);
  const visible = onlyRelevant ? verdicts.filter((verdict) => verdict.code !== 'checkpoint_not_on_route') : verdicts;

  return (
    <div className="grid gap-4 xl:grid-cols-[0.85fr_1.15fr]">
      <SocPanel title="Simulated Scan">
        <div className="space-y-4">
          <div className="flex items-start gap-2 rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-3 text-xs font-semibold text-cyan-200">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            Preview only — nothing is written to patrol history. Adjust the inputs to see how a real RG360 scan would be matched.
          </div>
          <label className="block">
            <span className={labelClass}>Checkpoint tag</span>
            <select value={activeCheckpointId} onChange={(event) => setCheckpointId(event.target.value)} className={fieldClass}>
              {checkpoints.length ? checkpoints.map((row) => <option key={row.id} value={row.id} className="bg-slate-950">{row.name || 'Unnamed'}{row.nfc_tag_id ? ` · ${row.nfc_tag_id}` : ''}</option>) : <option value="">No checkpoints available</option>}
            </select>
          </label>
          <label className="block">
            <span className={labelClass}>Scan time</span>
            <input type="datetime-local" value={scannedAtLocal} onChange={(event) => setScannedAtLocal(event.target.value)} className={fieldClass} />
          </label>
          <label className="block">
            <span className={labelClass}>Scanning device</span>
            <select value={deviceIdentifier} onChange={(event) => setDeviceIdentifier(event.target.value)} className={fieldClass}>
              <option value="any" className="bg-slate-950">Any device</option>
              {devices.map((device: any) => <option key={device.id} value={device.device_identifier} className="bg-slate-950">{device.device_name || device.device_identifier}</option>)}
            </select>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelClass}>Start grace (min)</span>
              <input type="number" min={0} value={graceStartMinutes} onChange={(event) => setGraceStartMinutes(Number(event.target.value) || 0)} className={fieldClass} />
            </label>
            <label className="block">
              <span className={labelClass}>Completion grace (min)</span>
              <input type="number" min={0} value={graceCompletionMinutes} onChange={(event) => setGraceCompletionMinutes(Number(event.target.value) || 0)} className={fieldClass} />
            </label>
          </div>
          <label className="flex items-center gap-2 text-xs font-bold text-slate-300">
            <input type="checkbox" checked={onlyRelevant} onChange={(event) => setOnlyRelevant(event.target.checked)} className="h-4 w-4 rounded border-white/20 bg-slate-950" />
            Hide occurrences whose route excludes this checkpoint
          </label>
          <div className="grid grid-cols-3 gap-2">
            <SummaryChip label="Matched" value={summary.matched} tone="border-emerald-400/25 bg-emerald-400/10 text-emerald-200" />
            <SummaryChip label="Eligible" value={summary.candidates} tone="border-amber-400/25 bg-amber-400/10 text-amber-200" />
            <SummaryChip label="Missed" value={summary.missed} tone="border-red-400/25 bg-red-400/10 text-red-200" />
          </div>
        </div>
      </SocPanel>

      <SocPanel title="Occurrence Validation" action={<span className="inline-flex items-center gap-1 text-xs font-black text-cyan-300"><FlaskConical className="h-3.5 w-3.5" />Dry run</span>}>
        {loading ? (
          <div className="rounded-xl border border-white/10 bg-black/25 p-6 text-center text-sm text-slate-400">Loading patrol occurrences…</div>
        ) : !sessions.length || !activeCheckpointId ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-6 text-center">
            <p className="font-bold text-white">Nothing to validate yet</p>
            <p className="mt-2 text-sm text-slate-400">Create checkpoints and generate patrol sessions to preview scan matching.</p>
          </div>
        ) : !visible.length ? (
          <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-6 text-center">
            <p className="font-bold text-white">No occurrence includes {checkpointName}</p>
            <p className="mt-2 text-sm text-slate-400">Uncheck the filter to see every occurrence and its exclusion reason.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {visible.map((verdict) => {
              const session = sessionById.get(verdict.sessionId);
              const tone = toneFor(verdict.outcome);
              const Icon = tone.icon;
              return (
                <div key={verdict.sessionId} className={`rounded-lg border p-3 ${tone.row}`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-bold text-white">{session ? patrolSessionLabel(session) : 'Patrol occurrence'}</p>
                      <p className="text-xs text-slate-400">{session?.patrol_routes?.name || 'Route pending'} · {session?.device_identifier || 'Any device'}</p>
                    </div>
                    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-wider ${tone.chip}`}><Icon className="h-3 w-3" />{tone.label}</span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-200">{verdict.reason}</p>
                  {verdict.detail && <p className="text-xs text-slate-400">{verdict.detail}</p>}
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <Meta label="Match window" value={verdict.windowStart ? `${format(new Date(verdict.windowStart), 'MMM d HH:mm')} → ${verdict.windowEnd ? format(new Date(verdict.windowEnd), 'HH:mm') : '—'}` : 'No window'} />
                    <Meta label="Checkpoint order" value={verdict.scheduledOrder !== null ? `#${verdict.scheduledOrder}` : 'Not on route'} />
                    <Meta label="Progress if applied" value={verdict.progressAfter ? `${verdict.progressAfter.completed}/${verdict.progressAfter.total}` : 'Unchanged'} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </SocPanel>
    </div>
  );
}

function SummaryChip({ label, value, tone }: { label: string; value: number; tone: string }) {
  return <div className={`rounded-lg border p-2 text-center ${tone}`}><p className="text-lg font-black">{value}</p><p className="text-[10px] font-black uppercase tracking-wider">{label}</p></div>;
}

function Meta({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-white/10 bg-black/25 p-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-500">{label}</p><p className="mt-1 truncate text-xs font-semibold text-slate-200">{value}</p></div>;
}
