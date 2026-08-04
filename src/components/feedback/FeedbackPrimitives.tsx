import { type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Radio, Wifi, WifiOff } from "lucide-react";
import { realtimeStatusLabel } from "@/hooks/useRealtimeConnectionStatus";

type RealtimeStatus = "connecting" | "live" | "reconnecting";
type Tone = "success" | "info" | "warning" | "critical" | "muted";

const toneClasses: Record<Tone, string> = {
  success: "border-success/40 bg-success/10 text-success",
  info: "border-primary/40 bg-primary/10 text-primary",
  warning: "border-warning/40 bg-warning/10 text-warning",
  critical: "border-destructive/40 bg-destructive/10 text-destructive",
  muted: "border-border/50 bg-muted/30 text-muted-foreground",
};

export function LiveStatusBadge({ status, lastUpdatedAt, compact = false }: { status: RealtimeStatus; lastUpdatedAt?: string | null; compact?: boolean }) {
  const tone: Tone = status === "live" ? "success" : status === "reconnecting" ? "warning" : "muted";
  const Icon = status === "live" ? Wifi : status === "reconnecting" ? Radio : WifiOff;
  const label = status === "live" ? "Connected" : realtimeStatusLabel(status);

  return (
    <div className={`inline-flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-semibold ${toneClasses[tone]}`} aria-live="polite">
      <span className="relative flex h-2.5 w-2.5">
        {status === "live" && <span className="absolute inline-flex h-full w-full rounded-full bg-success/50 opacity-75 live-soft-ping" />}
        <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${status === "live" ? "bg-success" : status === "reconnecting" ? "bg-warning" : "bg-muted-foreground"}`} />
      </span>
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      {!compact && lastUpdatedAt && <span className="hidden text-muted-foreground sm:inline">Last updated {new Date(lastUpdatedAt).toLocaleTimeString()}</span>}
    </div>
  );
}

export function LoadingState({ label = "Loading latest operational data..." }: { label?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-slate-950/40 p-6 text-center text-sm text-muted-foreground">
      <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin text-primary" />
      <p>{label}</p>
    </div>
  );
}

export function EmptyState({ title, description, icon }: { title: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="rounded-lg border border-border/50 bg-slate-950/35 p-6 text-center">
      <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-muted/30 text-muted-foreground">
        {icon ?? <Clock className="h-5 w-5" />}
      </div>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
  );
}

export function ErrorState({ title = "This panel could not load", description, onRetry }: { title?: string; description?: string; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/35 bg-destructive/10 p-5 text-sm text-destructive">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{title}</p>
          {description && <p className="mt-1 text-xs text-destructive/80">{description}</p>}
          {onRetry && (
            <button type="button" onClick={onRetry} className="mt-3 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-semibold hover:bg-destructive/10">
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ActionComplete({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-success">
      <CheckCircle2 className="h-3.5 w-3.5" /> {children}
    </span>
  );
}
