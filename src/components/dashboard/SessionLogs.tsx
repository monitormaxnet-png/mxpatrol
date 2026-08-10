import { AlertCircle, CheckCircle2, Clock, ExternalLink, Loader2, MapPin, Radio, ScanLine, Smartphone } from "lucide-react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import {
  patrolScanCheckpointName,
  patrolScanDeviceIdentity,
  useSessionScanLogs,
  type PatrolScanRow,
} from "@/hooks/usePatrolScanData";
import { patrolSessionLabel, usePatrolSessions, type PatrolSessionRow } from "@/hooks/useScheduledPatrols";

const ACTIVE_SESSION_STATUSES = ["active", "in_progress", "running"];

export default function SessionLogs() {
  const { data: activeSessions = [], isLoading: sessionsLoading, error: sessionsError } = usePatrolSessions(8, "all", ACTIVE_SESSION_STATUSES);
  const { data: scans = [], isLoading: scansLoading, error: scansError } = useSessionScanLogs(30, "all");
  const currentSession = activeSessions[0] as PatrolSessionRow | undefined;
  const sessionScans = currentSession
    ? scans.filter((scan) => scan.patrol_session_id === currentSession.id || (!!scan.device_identifier && scan.device_identifier === currentSession.device_identifier))
    : scans;
  const latest = sessionScans[0] ?? scans[0];
  const activity = (sessionScans.length ? sessionScans : scans).slice(0, 5);
  const sequence = sequenceLabel(latest);
  const isLoading = sessionsLoading || scansLoading;
  const error = sessionsError ?? scansError;

  return (
    <div className="glass-card flex min-h-[360px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border/50 px-5 py-4">
        <div>
          <h3 className="font-heading text-sm font-semibold text-foreground">Session Logs</h3>
          <p className="text-[11px] text-muted-foreground">Current session details and latest scan activity</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-medium text-primary">
          <Radio className="h-3 w-3" /> Realtime
        </span>
      </div>

      {isLoading && (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading session summary...
        </div>
      )}

      {!isLoading && error && (
        <div className="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
          <AlertCircle className="h-4 w-4" /> Session logs could not be loaded.
        </div>
      )}

      {!isLoading && !error && !latest && (
        <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-muted-foreground">
          <Clock className="mb-2 h-7 w-7" />
          No session scans yet. Registered and unregistered scan events will appear here automatically.
        </div>
      )}

      {!isLoading && !error && latest && (
        <div className="flex flex-1 flex-col p-5">
          <div className="grid gap-3 text-sm">
            <SummaryRow icon={ScanLine} label="Session ID" value={currentSession?.id ?? latest.patrol_session_id ?? latest.id} mono />
            <SummaryRow icon={MapPin} label="Site" value={latest.sites?.name ?? currentSession?.sites?.name ?? "Unassigned"} />
            <SummaryRow icon={Smartphone} label="Device Identity" value={patrolScanDeviceIdentity(latest)} />
            <SummaryRow icon={ScanLine} label="Latest Checkpoint" value={patrolScanCheckpointName(latest)} highlight />
            <SummaryRow icon={Clock} label="Latest Scan Time" value={format(new Date(latest.scanned_at), "HH:mm:ss")} />
            <SummaryRow icon={MapPin} label="Sequence Status" value={sequence.label} highlight={sequence.good} warning={!sequence.good} />
          </div>

          <div className="mt-4 border-t border-border/50 pt-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="text-sm font-semibold text-foreground">Latest Activity</h4>
              <Link to="/session-logs" className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80">
                View Full Session <ExternalLink className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-2">
              {activity.map((scan, index) => (
                <ActivityItem key={scan.id} scan={scan} current={index === 0} />
              ))}
            </div>
            {currentSession && <p className="mt-3 truncate text-[11px] text-muted-foreground" title={patrolSessionLabel(currentSession)}>Session: {patrolSessionLabel(currentSession)}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function sequenceLabel(scan?: PatrolScanRow) {
  const status = String(scan?.patrol_validation_status ?? "");
  if (status === "out_of_order") return { label: "Out of Sequence", good: false };
  if (["on_time", "early", "late"].includes(status)) return { label: status === "late" ? "Late Scan" : "In Sequence", good: true };
  if (scan?.tag_status === "unregistered") return { label: "Pending Registration", good: false };
  return { label: "Recorded", good: true };
}

function SummaryRow({ icon: Icon, label, value, highlight, warning, mono }: { icon: typeof Radio; label: string; value: string; highlight?: boolean; warning?: boolean; mono?: boolean }) {
  return (
    <div className="grid grid-cols-[1.15rem_9rem_minmax(0,1fr)] items-center gap-2 border-b border-border/35 pb-2 last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}</span>
      <span className={`truncate font-semibold ${warning ? "text-warning" : highlight ? "text-primary" : "text-foreground"} ${mono ? "font-mono text-xs" : ""}`} title={value}>{value}</span>
    </div>
  );
}

function ActivityItem({ scan, current }: { scan: PatrolScanRow; current: boolean }) {
  const sequence = sequenceLabel(scan);
  return (
    <div className="grid grid-cols-[0.75rem_4.75rem_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border/30 bg-muted/15 px-3 py-2 text-sm">
      <span className={`h-2.5 w-2.5 rounded-full ${current ? "bg-primary" : sequence.good ? "bg-success" : "bg-warning"}`} />
      <span className="font-mono text-xs text-muted-foreground">{format(new Date(scan.scanned_at), "HH:mm:ss")}</span>
      <span className="truncate font-semibold text-foreground" title={patrolScanCheckpointName(scan)}>{patrolScanCheckpointName(scan)}</span>
      <span className={current ? "text-primary" : sequence.good ? "text-success" : "text-warning"}>{current ? "Current" : sequence.good ? "Scanned" : "Review"}</span>
    </div>
  );
}