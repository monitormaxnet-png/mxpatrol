import { AlertCircle, CheckCircle2, Clock3, Loader2, MapPin, Radio, Route, ScanLine, Smartphone } from "lucide-react";
import { format, formatDistanceToNowStrict } from "date-fns";
import {
  patrolScanCheckpointName,
  patrolScanDeviceIdentity,
  useLivePatrolScans,
  type PatrolScanRow,
} from "@/hooks/usePatrolScanData";
import { patrolSessionLabel, patrolSessionProgress, usePatrolSessions, type PatrolSessionRow } from "@/hooks/useScheduledPatrols";
import { realtimeStatusLabel, useRealtimeConnectionStatus } from "@/hooks/useRealtimeConnectionStatus";

const ACTIVE_SESSION_STATUSES = ["active", "in_progress", "running"];

export default function LivePatrolSession() {
  const { data: activeSessions = [], isLoading: sessionsLoading, error: sessionsError } = usePatrolSessions(8, "all", ACTIVE_SESSION_STATUSES);
  const { data: scans = [], isLoading: scansLoading, error: scansError } = useLivePatrolScans(30, "all");
  const realtime = useRealtimeConnectionStatus("live-patrol-session");

  const currentSession = activeSessions[0] as PatrolSessionRow | undefined;
  const latestScan = currentSession ? findLatestScanForSession(scans, currentSession) : undefined;
  const checkpointName = latestScan ? patrolScanCheckpointName(latestScan) : currentCheckpointFromSession(currentSession);
  const progress = currentSession ? patrolSessionProgress(currentSession) : { completed: 0, total: 0, percent: 0 };
  const gps = latestScan?.gps_lat != null && latestScan.gps_lng != null
    ? `${latestScan.gps_lat.toFixed(6)}, ${latestScan.gps_lng.toFixed(6)}`
    : "Unavailable";
  const startedAt = currentSession?.actual_start ?? currentSession?.scheduled_start ?? null;
  const isLoading = sessionsLoading || scansLoading;
  const error = sessionsError ?? scansError;

  return (
    <div className="glass-card flex min-h-[340px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Live Patrol Session</h3>
          <p className="text-[11px] text-muted-foreground">Current active patrol from session state and realtime scans</p>
        </div>
        <span className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-medium ${realtime.status === "live" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>
          <Radio className={`h-3 w-3 ${realtime.status === "live" ? "animate-pulse" : ""}`} /> {realtimeStatusLabel(realtime.status)}
        </span>
      </div>

      {isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading current patrol...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Live patrol session could not be loaded.
        </div>
      )}

      {!isLoading && !error && !currentSession && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <ScanLine className="mb-2 h-7 w-7" />
          No active patrol session
        </div>
      )}

      {!isLoading && !error && currentSession && (
        <div className="flex flex-1 flex-col gap-4 p-5">
          <div className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
            <div className="flex min-h-[190px] items-center justify-center rounded-xl border border-emerald-400/15 bg-emerald-400/[0.04]">
              <div className="relative flex h-36 w-36 items-center justify-center rounded-full border border-emerald-400/25 bg-slate-950/70">
                <div className="absolute inset-4 rounded-full border border-emerald-400/20" />
                <div className="absolute inset-8 rounded-full border border-emerald-400/20" />
                <div className="absolute h-full w-px bg-emerald-400/20" />
                <div className="absolute w-full h-px bg-emerald-400/20" />
                <ShieldDot />
              </div>
            </div>
            <div className="grid content-start gap-3 text-sm">
              <SummaryRow icon={MapPin} label="Site" value={siteName(currentSession, latestScan)} />
              <SummaryRow icon={Smartphone} label="Device" value={deviceIdentity(currentSession, latestScan)} />
              <SummaryRow icon={ScanLine} label="Current Checkpoint" value={checkpointName} highlight />
              <SummaryRow icon={Clock3} label="Last Scan" value={latestScan ? format(new Date(latestScan.scanned_at), "HH:mm:ss") : "Waiting"} />
              <SummaryRow icon={MapPin} label="GPS" value={gps} mono />
              <SummaryRow icon={CheckCircle2} label="Status" value={titleCase(String(currentSession.status ?? "Active"))} highlight />
            </div>
          </div>

          <div className="border-t border-border/50 pt-4">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Route Progress</span>
              <span className="font-semibold text-foreground">{Math.round(progress.percent)}% Complete</span>
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-muted/50">
              <div className="h-full rounded-full bg-success" style={{ width: `${Math.min(100, progress.percent)}%` }} />
            </div>
            <div className="mt-4 grid gap-3 text-sm sm:grid-cols-3">
              <Metric label="Checkpoints" value={`${progress.completed} / ${progress.total || "?"}`} />
              <Metric label="Route" value={currentSession.patrol_routes?.name ?? patrolSessionLabel(currentSession)} />
              <Metric label="Elapsed" value={startedAt ? formatElapsed(startedAt) : "Not started"} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function findLatestScanForSession(scans: PatrolScanRow[], session: PatrolSessionRow) {
  return scans.find((scan) => scan.patrol_session_id === session.id)
    ?? scans.find((scan) => scan.device_identifier && scan.device_identifier === session.device_identifier)
    ?? scans[0];
}

function currentCheckpointFromSession(session?: PatrolSessionRow) {
  const checkpoints = [...(session?.patrol_session_checkpoints ?? [])].sort((a, b) => Number(a.scheduled_order ?? 0) - Number(b.scheduled_order ?? 0));
  const latestScanned = [...checkpoints].reverse().find((checkpoint) => ["scanned", "scanned_late"].includes(String(checkpoint.status)));
  return latestScanned?.checkpoints?.name ?? checkpoints.find((checkpoint) => !["scanned", "scanned_late"].includes(String(checkpoint.status)))?.checkpoints?.name ?? "Waiting for scan";
}

function siteName(session: PatrolSessionRow, scan?: PatrolScanRow) {
  return scan?.sites?.name ?? session.sites?.name ?? "Unassigned";
}

function deviceIdentity(session: PatrolSessionRow, scan?: PatrolScanRow) {
  return scan ? patrolScanDeviceIdentity(scan) : session.device_identifier ?? session.device_id ?? "Unassigned device";
}

function formatElapsed(startedAt: string) {
  return formatDistanceToNowStrict(new Date(startedAt), { addSuffix: false });
}

function titleCase(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function ShieldDot() {
  return <div className="relative z-10 flex h-10 w-10 items-center justify-center rounded-full border border-success/40 bg-success/15 text-success"><Radio className="h-5 w-5" /></div>;
}

function SummaryRow({ icon: Icon, label, value, highlight, mono }: { icon: typeof Radio; label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[1.15rem_8.5rem_minmax(0,1fr)] items-center gap-2 border-b border-border/35 pb-2 last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate font-semibold ${highlight ? "text-success" : "text-foreground"} ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-border/40 bg-muted/20 px-3 py-2"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 truncate font-semibold text-foreground" title={value}>{value}</p></div>;
}