import type { ComponentType, ReactNode } from "react";
import { Bell, Search, Sun, Wifi } from "lucide-react";
import { realtimeStatusLabel } from "@/hooks/useRealtimeConnectionStatus";

type IconComponent = ComponentType<{ className?: string }>;
type Tone = "green" | "blue" | "amber" | "red" | "neutral";

const toneStyles: Record<Tone, { border: string; bg: string; text: string; glow: string }> = {
  green: { border: "border-emerald-400/20", bg: "bg-emerald-400/10", text: "text-emerald-300", glow: "shadow-[0_0_24px_rgba(16,185,129,0.10)]" },
  blue: { border: "border-blue-400/20", bg: "bg-blue-400/10", text: "text-blue-300", glow: "shadow-[0_0_24px_rgba(59,130,246,0.10)]" },
  amber: { border: "border-amber-400/20", bg: "bg-amber-400/10", text: "text-amber-300", glow: "shadow-[0_0_24px_rgba(245,158,11,0.10)]" },
  red: { border: "border-red-400/20", bg: "bg-red-400/10", text: "text-red-300", glow: "shadow-[0_0_24px_rgba(239,68,68,0.12)]" },
  neutral: { border: "border-white/10", bg: "bg-slate-950/70", text: "text-slate-300", glow: "shadow-[0_0_24px_rgba(0,0,0,0.20)]" },
};

export function SocPageShell({
  title,
  subtitle,
  realtime,
  children,
}: {
  title: string;
  subtitle: string;
  realtime: { status: "connecting" | "live" | "reconnecting"; lastUpdatedAt: string | null; markUpdated: () => void; };
  children: ReactNode;
}) {
  const connected = realtime.status === "live";
  return (
    <div className="min-h-full space-y-4 bg-[radial-gradient(circle_at_top_left,rgba(34,197,94,0.07),transparent_26%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.08),transparent_30%)] pb-4">
      <header className="flex flex-col gap-4 rounded-xl border border-white/10 bg-slate-950/70 px-4 py-4 shadow-[0_0_36px_rgba(0,0,0,0.26)] xl:flex-row xl:items-center xl:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-slate-300 md:flex">
            <Search className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-heading text-2xl font-black text-white">{title}</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-2 py-1 text-[10px] font-black uppercase tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 animate-pulse" /> Live
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SocStatusPill icon={Wifi} label={realtimeStatusLabel(realtime.status)} tone={connected ? "green" : "amber"} />
          <SocIconButton icon={Bell} label="Notifications" badge />
          <SocIconButton icon={Sun} label="Display" />
          <div className="flex h-10 items-center gap-3 rounded-lg border border-white/10 bg-slate-950/80 px-3 text-sm text-slate-200">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-xs font-black text-white">SS</span>
            <div className="hidden leading-tight sm:block">
              <p className="text-xs font-bold text-white">Security Supervisor</p>
              <p className="text-[10px] text-slate-400">MX Patrol</p>
            </div>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

export function SocKpiCard({
  title,
  value,
  caption,
  icon: Icon,
  tone = "green",
  subValue,
  loading,
}: {
  title: string;
  value: string | number;
  caption: string;
  icon: IconComponent;
  tone?: Tone;
  subValue?: string;
  loading?: boolean;
}) {
  const style = toneStyles[tone];
  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} ${style.glow} p-4`}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[10px] font-black uppercase tracking-[0.14em] text-slate-400">{title}</p>
        <Icon className={`h-4 w-4 ${style.text}`} />
      </div>
      <div className="mt-3 flex items-end gap-1">
        <span className="text-3xl font-black leading-none text-white">{loading ? "--" : value}</span>
        {subValue && <span className="pb-0.5 text-sm font-semibold text-slate-500">{subValue}</span>}
      </div>
      <p className={`mt-2 text-xs font-semibold ${style.text}`}>{caption}</p>
    </div>
  );
}

export function SocPanel({ title, action, children, className = "" }: { title: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-white/10 bg-slate-950/72 shadow-[0_0_30px_rgba(0,0,0,0.24)] ${className}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <h2 className="text-sm font-black uppercase tracking-[0.08em] text-white">{title}</h2>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function SocStatusPill({ icon: Icon, label, tone = "neutral" }: { icon: IconComponent; label: string; tone?: Tone }) {
  const style = toneStyles[tone];
  return (
    <span className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-semibold ${style.border} ${style.bg} ${style.text}`}>
      <Icon className="h-4 w-4" /> {label}
    </span>
  );
}

function SocIconButton({ icon: Icon, label, badge }: { icon: IconComponent; label: string; badge?: boolean }) {
  return (
    <button type="button" aria-label={label} className="relative flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-slate-950/80 text-slate-300 hover:border-emerald-400/30 hover:text-emerald-300">
      <Icon className="h-4 w-4" />
      {badge && <span className="absolute -right-1 -top-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-black leading-4 text-white">!</span>}
    </button>
  );
}

export function SocProgressBar({ value, tone = "green" }: { value: number; tone?: Tone }) {
  const color = tone === "red" ? "bg-red-400" : tone === "amber" ? "bg-amber-400" : tone === "blue" ? "bg-blue-400" : "bg-emerald-400";
  return (
    <div className="h-1.5 w-full rounded-full bg-slate-800">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }} />
    </div>
  );
}

