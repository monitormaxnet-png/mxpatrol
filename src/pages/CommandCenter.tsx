import { useMemo, useState, type ComponentType, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowLeft, ArrowRight, Bell, CalendarDays, Check, ChevronDown, FileText, Grid2X2, Lock, MapPin, Menu, Mic, MoreVertical, Paperclip, Plus, RefreshCw, Send, Shield, ShieldCheck, Smartphone, Siren, UserRound, Wifi, X } from "lucide-react";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { useSites } from "@/hooks/useSites";
import { LiveSecureDeviceManagementPanel } from "@/components/command-center/LiveSecureDeviceManagementPanel";

type IconComponent = ComponentType<{ className?: string }>;
type Tone = "green" | "blue" | "amber" | "red" | "neutral";
type Metric = { label: string; value: string; delta: string; icon: IconComponent; tone: Tone };

const metrics: Metric[] = [
  { label: "Active Patrols", value: "7", delta: "2 vs yesterday", icon: ShieldCheck, tone: "green" },
  { label: "Devices Online", value: "24", delta: "5 vs yesterday", icon: Smartphone, tone: "green" },
  { label: "Devices Patrolling", value: "12", delta: "3 vs yesterday", icon: UserRound, tone: "blue" },
  { label: "Completed Patrols", value: "18", delta: "20%", icon: Check, tone: "green" },
  { label: "Late Starts", value: "3", delta: "1 vs yesterday", icon: CalendarDays, tone: "amber" },
  { label: "Missed Patrols", value: "2", delta: "1 vs yesterday", icon: X, tone: "red" },
  { label: "Incidents", value: "1", delta: "2 vs yesterday", icon: Siren, tone: "red" },
  { label: "SOS Alerts", value: "0", delta: "No change", icon: AlertTriangle, tone: "red" },
  { label: "Reports", value: "6", delta: "2 vs yesterday", icon: FileText, tone: "blue" },
];

const actions = [
  { label: "Device Registration", hint: "Register new device", icon: Smartphone, route: "/devices" },
  { label: "Checkpoint Registration", hint: "Add new checkpoint", icon: MapPin, route: "/checkpoints" },
  { label: "Incident Registration", hint: "Report new incident", icon: Siren, route: "/incidents", critical: true },
];

const management = [
  [1, "Dashboard", "/dashboard"], [2, "Live Patrol", "/live-patrol"], [3, "Live Map", "/live-map"], [4, "Patrols", "/patrols"], [5, "Routes", "/routes"], [6, "Schedules", "/schedules"], [7, "Scan Logs", "/scan-logs"], [8, "Reports", "/reports"], [9, "Incidents", "/incidents"], [10, "Devices", "/devices"], [11, "Checkpoints", "/checkpoints"], [12, "AI Assistant", "/whatsapp"], [13, "Device Registration", "/devices"], [14, "Checkpoint Registration", "/checkpoints"], [15, "Incident Registration", "/incidents"], [16, "Settings", "/settings"], [17, "Logout", ""],
] as const;
const userOptions = ["Live Now", "Attention", "Devices", "Incidents", "Reports", "Complete Patrols", "Incomplete Patrols", "Late / Delayed Patrols", "Missed Patrols", "Missed Checkpoints List"];
const summary = [["Complete", "18", "green"], ["Incomplete", "2", "amber"], ["Late / Delayed", "3", "amber"], ["Missed Patrols", "2", "red"], ["Missed Checkpoints List", "5", "red"], ["Incidents", "1", "red"], ["SOS Alerts", "0", "green"], ["Reports Generated", "6", "blue"]] as const;

export default function CommandCenter() {
  const { user } = useAuth();
  const { canManage, role } = useUserRole();
  const { data: sites = [] } = useSites();
  const [managementOpen, setManagementOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [selectedSite, setSelectedSite] = useState("Airport Junction");
  const siteChoices = useMemo(() => {
    const names = sites.map((site) => site.name).filter(Boolean);
    return names.length ? names : ["Airport Junction", "Main Gate Complex", "Warehouse A"];
  }, [sites]);
  const selectedSiteId = sites.find((site) => site.name === selectedSite)?.id ?? null;
  return <div className="min-h-screen overflow-hidden bg-[#030811] text-white"><div className="mx-auto min-h-screen max-w-[1320px] px-3 py-3 sm:px-4"><WebViewBar /><div className="grid min-h-[calc(100vh-5.25rem)] overflow-hidden rounded-2xl border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.13),transparent_30%),radial-gradient(circle_at_top_right,rgba(14,165,233,0.14),transparent_32%),linear-gradient(145deg,rgba(2,6,23,0.96),rgba(3,12,24,0.98))] shadow-[0_0_55px_rgba(14,165,233,0.10)] lg:grid-cols-[22rem_1fr]"><ManagementAssistantPanel canManage={canManage} role={role} open={managementOpen} onToggle={() => setManagementOpen((value) => !value)} /><main className="min-w-0 border-t border-cyan-400/15 lg:border-l lg:border-t-0"><TopHeader selectedSite={selectedSite} siteChoices={siteChoices} onSiteChange={setSelectedSite} userLabel={user?.email ?? "Site Supervisor"} /><div className="space-y-3 p-3 sm:p-4"><DashboardGrid />{canManage ? <LiveSecureDeviceManagementPanel selectedSite={selectedSite} siteId={selectedSiteId} /> : null}{canManage ? <DataLogFormWorkflow selectedSite={selectedSite} /> : null}<LiveMapOverview selectedSite={selectedSite} /><UserAssistantChat selectedSite={selectedSite} message={message} onMessageChange={setMessage} /></div></main></div></div></div>;
}

function WebViewBar() {
  return <div className="mb-3 flex items-center gap-3 text-slate-100"><div className="hidden min-w-[8.5rem] text-sm font-semibold sm:block">9:41 AM</div><div className="flex flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/80 px-3 py-2 shadow-[inset_0_0_25px_rgba(148,163,184,0.05)]"><button className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Back"><ArrowLeft className="h-4 w-4" /></button><button className="flex h-8 w-8 items-center justify-center rounded-xl text-slate-400 hover:bg-white/5 hover:text-white" aria-label="Forward"><ArrowRight className="h-4 w-4" /></button><div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#07101d] px-3 py-2 text-sm text-slate-300"><Lock className="h-3.5 w-3.5 text-slate-400" /><span className="truncate">app.mxpatrol.ttech.co.bw</span></div><RefreshCw className="hidden h-4 w-4 text-slate-300 sm:block" /><MoreVertical className="h-4 w-4 text-slate-400" /></div><div className="hidden items-center gap-2 text-sm font-semibold sm:flex"><Wifi className="h-4 w-4" />100%</div></div>;
}
function TopHeader({ selectedSite, siteChoices, onSiteChange, userLabel }: { selectedSite: string; siteChoices: string[]; onSiteChange: (site: string) => void; userLabel: string }) {
  return <header className="flex flex-col gap-3 border-b border-cyan-400/15 px-4 py-3 md:flex-row md:items-center md:justify-between"><TTechMxPatrolLogo variant="header" priority className="w-44" /><div className="flex flex-wrap items-center justify-center gap-2 md:justify-end"><label className="relative"><select value={selectedSite} onChange={(event) => onSiteChange(event.target.value)} className="h-10 appearance-none rounded-xl border border-cyan-400/25 bg-slate-950/80 pl-3 pr-9 text-sm font-semibold text-white outline-none focus:border-emerald-300/60" aria-label="Active Site">{siteChoices.map((site) => <option key={site} value={site}>{site}</option>)}</select><ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cyan-200" /></label><span className="inline-flex h-10 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 text-sm font-semibold text-emerald-200"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Online</span><button className="relative flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-slate-300" aria-label="Notifications"><Bell className="h-4 w-4" /><span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-black text-white">3</span></button><div className="flex items-center gap-2 rounded-xl border border-cyan-400/15 bg-slate-950/70 px-3 py-2"><div className="flex h-8 w-8 items-center justify-center rounded-full border border-blue-400/35 bg-blue-400/10 text-xs font-black text-blue-200">AD</div><div className="hidden min-w-0 sm:block"><p className="max-w-36 truncate text-xs font-bold text-white">{userLabel}</p><p className="text-[10px] uppercase tracking-[0.12em] text-slate-500">Supervisor</p></div></div></div></header>;
}

function DashboardGrid() {
  return <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/50 p-3"><div className="mb-3 flex items-center justify-between gap-3"><h1 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-white"><Grid2X2 className="h-4 w-4 text-cyan-300" /> Dashboard Overview</h1><button className="inline-flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 text-xs font-semibold text-slate-300"><CalendarDays className="h-4 w-4" /> Today <ChevronDown className="h-3.5 w-3.5" /></button></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map((metric) => <MetricCard key={metric.label} metric={metric} />)}{actions.map((action) => <RegistrationActionCard key={action.label} {...action} />)}</div></section>;
}

function MetricCard({ metric }: { metric: Metric }) {
  const Icon = metric.icon;
  const tone = toneClasses(metric.tone);
  const deltaColor = metric.tone === "red" ? "text-red-300" : "text-emerald-300";
  return <article className="min-h-[7.4rem] rounded-xl border border-white/10 bg-[linear-gradient(140deg,rgba(15,23,42,0.82),rgba(2,6,23,0.78))] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]"><div className="flex items-start gap-4"><div className={"flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border " + tone.icon}><Icon className="h-7 w-7" /></div><div className="min-w-0"><p className="text-sm text-slate-200">{metric.label}</p><p className="mt-1 text-3xl font-black leading-none text-white">{metric.value}</p><p className={"mt-2 text-xs " + deltaColor}>up {metric.delta}</p></div></div></article>;
}

function RegistrationActionCard({ label, hint, icon: Icon, route, critical = false }: { label: string; hint: string; icon: IconComponent; route: string; critical?: boolean }) {
  const iconClass = critical ? "bg-red-500 text-white" : "border border-emerald-400/25 bg-emerald-400/10 text-emerald-300";
  return <Link to={route} className="group min-h-[7.4rem] rounded-xl border border-white/10 bg-[linear-gradient(140deg,rgba(15,23,42,0.82),rgba(2,6,23,0.78))] p-4 transition hover:border-emerald-400/40"><div className="flex items-center justify-between gap-3"><div className={"flex h-12 w-12 items-center justify-center rounded-2xl " + iconClass}><Icon className="h-7 w-7" /></div><ArrowRight className="h-5 w-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-emerald-300" /></div><p className="mt-3 text-sm font-semibold text-white">{label}</p><p className="mt-1 text-xs text-slate-500">{hint}</p></Link>;
}

const dataLogOptions = [
  ["1", "No form", "Scan completes normally"],
  ["2", "Use existing form", "Attach a saved form"],
  ["3", "Create checklist", "Yes/No or Pass/Fail items"],
  ["4", "Create data-entry form", "Custom field collection"],
  ["5", "Create checklist + data form", "Combine both"],
] as const;

const checklistPreview = [
  ["Door locked?", "Yes / No"],
  ["Fire extinguisher present?", "Yes / No"],
  ["Lights working?", "Yes / No"],
  ["Area clear?", "Pass / Fail"],
  ["Any damage observed?", "Pass / Fail"],
] as const;


function SecureDeviceManagementPanel({ selectedSite }: { selectedSite: string }) {
  const overview = [
    ["Total Devices", "128", Smartphone, "neutral"],
    ["Secure Devices", "112", ShieldCheck, "green"],
    ["Attention", "9", AlertTriangle, "amber"],
    ["Disabled", "7", X, "red"],
    ["Offline", "15", Wifi, "blue"],
  ] as const;
  const secureDeviceRows = [
    { id: "MX-021", name: "Gate Patrol 1", site: "Head Office", kiosk: "Locked", security: "Outdated app", tone: "amber" as Tone },
    { id: "MX-034", name: "Night Shift 2", site: "Warehouse", kiosk: "Inactive", security: "Kiosk inactive", tone: "red" as Tone },
    { id: "MX-047", name: "Perimeter 3", site: "Depot", kiosk: "Locked", security: "Secure", tone: "green" as Tone },
    { id: "MX-052", name: "Reception", site: "Head Office", kiosk: "Locked", security: "Offline", tone: "blue" as Tone },
  ];
  const secureEvents = [
    "Device MX-021 locked remotely",
    "Maintenance mode ended on MX-034",
    "App update required on MX-047",
  ];

  return <section className="rounded-2xl border border-emerald-400/20 bg-slate-950/50 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-emerald-300"><Lock className="h-4 w-4" /> Management AI: Secure Patrol Device Mode</h2><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">Site: {selectedSite}</span></div><div className="grid gap-3 xl:grid-cols-[1fr_0.9fr]"><div className="space-y-3"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">{overview.map(([label, value, Icon, tone]) => <div key={label} className="rounded-xl border border-white/10 bg-[#07101d]/85 p-3"><div className="mb-2 flex items-center justify-between"><span className="text-[11px] uppercase tracking-[0.1em] text-slate-400">{label}</span><Icon className={"h-4 w-4 " + toneClasses(tone as Tone).text} /></div><p className={"text-2xl font-black " + toneClasses(tone as Tone).text}>{value}</p></div>)}</div><div className="overflow-hidden rounded-xl border border-white/10 bg-[#07101d]/85"><div className="grid grid-cols-[0.8fr_1.2fr_1fr_0.8fr_1fr_0.8fr] gap-2 border-b border-white/10 px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em] text-slate-500"><span>Device</span><span>Name</span><span>Site</span><span>Kiosk</span><span>Security</span><span>Action</span></div>{secureDeviceRows.map((device) => <div key={device.id} className="grid grid-cols-[0.8fr_1.2fr_1fr_0.8fr_1fr_0.8fr] items-center gap-2 border-b border-white/5 px-3 py-3 text-xs last:border-b-0"><span className="font-bold text-white">{device.id}</span><span className="text-slate-300">{device.name}</span><span className="text-slate-400">{device.site}</span><span className="text-slate-300">{device.kiosk}</span><span className={toneClasses(device.tone).text}>{device.security}</span><span className="flex gap-1"><button className="flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 text-emerald-300" aria-label={"Lock " + device.id}><Lock className="h-3.5 w-3.5" /></button><button className="flex h-7 w-7 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-400/10 text-amber-300" aria-label={"Maintenance " + device.id}><RefreshCw className="h-3.5 w-3.5" /></button></span></div>)}</div><div className="grid gap-2 sm:grid-cols-5">{["Lock Device", "Disable Device", "Maintenance Mode", "Require Update", "Revoke Device"].map((label, index) => <button key={label} className={(index === 4 ? "border-red-400/25 text-red-200" : "border-emerald-400/20 text-emerald-200") + " h-10 rounded-xl border bg-slate-950/70 px-3 text-xs font-semibold"}>{label}</button>)}</div></div><aside className="rounded-xl border border-cyan-400/15 bg-[#07101d]/85 p-4"><p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-cyan-300">AI confirmation flow</p><AssistantBubble title="MANAGEMENT AI" time="10:15 AM"><p>Found 9 devices with security issues.</p><ul className="mt-2 list-inside list-disc text-slate-300"><li>3 outdated app versions</li><li>2 developer mode enabled</li><li>1 kiosk inactive</li><li>3 offline more than 24 hours</li></ul></AssistantBubble><UserBubble time="10:16 AM">Lock device MX-021</UserBubble><AssistantBubble title="CONFIRM SECURE COMMAND" time="10:16 AM"><p>Device: MX-021</p><p>Action: Lock Device</p><p>This queues a secure remote command and records an audit event.</p></AssistantBubble><div className="mt-4 rounded-xl border border-white/10 bg-slate-950/70 p-3"><p className="text-xs font-black uppercase tracking-[0.1em] text-emerald-300">Recent security events</p><div className="mt-2 space-y-2">{secureEvents.map((event) => <div key={event} className="flex items-center justify-between text-xs text-slate-300"><span className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-300" />{event}</span><span className="text-slate-500">2 min ago</span></div>)}</div></div></aside></div></section>;
}
function DataLogFormWorkflow({ selectedSite }: { selectedSite: string }) {
  const steps = ["Checkpoint Name", "Zone / Location", "Site", "NFC Tag Assignment", "Data Log Form", "Confirm Registration"];
  return <section className="rounded-2xl border border-emerald-400/20 bg-slate-950/50 p-3"><div className="mb-3 flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-sm font-black uppercase tracking-[0.12em] text-emerald-300"><FileText className="h-4 w-4" /> Management AI: Checkpoint Data Log Form</h2><span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-xs font-semibold text-emerald-200">Site: {selectedSite}</span></div><div className="mb-3 grid gap-2 md:grid-cols-6">{steps.map((step, index) => <div key={step} className={(index === 4 ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100" : "border-white/10 bg-slate-950/65 text-slate-300") + " rounded-xl border px-3 py-2 text-[11px] font-black uppercase tracking-[0.08em]"}><span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-[10px] text-white">{index + 1}</span>{step}</div>)}</div><div className="grid gap-3 xl:grid-cols-[0.95fr_1.25fr_0.95fr]"><div className="rounded-xl border border-white/10 bg-[#07101d]/85 p-4"><p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-emerald-300">Data Log Form Options</p><div className="space-y-2">{dataLogOptions.map(([number, label, hint], index) => <button key={label} className={(index === 2 ? "border-emerald-400/45 bg-emerald-400/10" : "border-white/10 bg-slate-950/70") + " flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left"}><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-400/35 text-xs font-black text-emerald-300">{number}</span><span className="min-w-0"><span className="block text-sm font-semibold text-white">{label}</span><span className="block text-xs text-slate-500">{hint}</span></span>{index === 2 ? <Check className="ml-auto h-4 w-4 text-emerald-300" /> : null}</button>)}</div></div><div className="rounded-xl border border-white/10 bg-[#07101d]/85 p-4"><div className="mb-3 flex items-center justify-between"><p className="text-xs font-black uppercase tracking-[0.12em] text-emerald-300">Checklist Builder</p><button className="inline-flex h-9 items-center gap-2 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 text-xs font-semibold text-emerald-200"><Plus className="h-4 w-4" /> Add Item</button></div><div className="space-y-2">{checklistPreview.map(([label, type], index) => <div key={label} className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm"><span className="text-xs font-black text-slate-500">{index + 1}</span><span className="text-slate-100">{label}</span><span className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-200">{type}</span><span className="text-[11px] uppercase tracking-[0.08em] text-slate-500">Required</span></div>)}</div></div><div className="rounded-xl border border-white/10 bg-[#07101d]/85 p-4"><p className="mb-3 text-xs font-black uppercase tracking-[0.12em] text-emerald-300">Live Form Preview</p><div className="rounded-2xl bg-slate-100 p-4 text-slate-950 shadow-[0_0_24px_rgba(16,185,129,0.12)]"><p className="text-sm font-black">Loading Bay Inspection</p><p className="mb-3 text-xs text-slate-500">Complete all required fields.</p>{checklistPreview.map(([label, type]) => <div key={label} className="mb-2 rounded-lg border border-slate-200 bg-white p-2"><p className="mb-1 text-xs font-semibold">{label}</p><div className="grid grid-cols-2 gap-2 text-[11px]">{type.split(" / ").map((choice) => <span key={choice} className="rounded-md bg-emerald-100 px-2 py-1 text-center text-emerald-800">{choice}</span>)}</div></div>)}<label className="mt-2 block rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-500">Notes optional</label></div></div></div><div className="mt-3 rounded-xl border border-cyan-400/15 bg-cyan-400/[0.04] p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-cyan-300">AI confirmation guard</p><p className="mt-2 text-sm leading-6 text-slate-300">The Web AI and WhatsApp AI use the same checkpoint registration model. Required Data Log Forms keep a scanned checkpoint in awaiting_data until validated responses are submitted.</p></div></section>;
}

function LiveMapOverview({ selectedSite }: { selectedSite: string }) {
  return <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/50 p-3"><div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">Live Map Overview</h2><span className="text-xs font-semibold text-cyan-300">Viewing: {selectedSite}</span></div><div className="grid gap-3 lg:grid-cols-[1fr_14rem]"><div className="relative h-56 overflow-hidden rounded-xl border border-cyan-400/15 bg-[#06111f]"><div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(14,165,233,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(14,165,233,0.12)_1px,transparent_1px)] [background-size:72px_72px]" /><div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_70%,rgba(16,185,129,0.16),transparent_18%),radial-gradient(circle_at_72%_35%,rgba(14,165,233,0.18),transparent_22%)]" /><MapRoute /><div className="absolute left-4 top-4 rounded-xl border border-white/10 bg-slate-950/75 p-3 text-xs text-slate-300 backdrop-blur"><MapLegend label="Checkpoint" color="bg-emerald-400" /><MapLegend label="Patrol Live" color="bg-blue-500" /><MapLegend label="Active Route" color="bg-emerald-400" /><MapLegend label="SOS Hotspot" color="bg-red-500" /></div><span className="absolute bottom-4 left-4 border-b-2 border-l-2 border-white px-2 py-1 text-xs text-white">100 m</span></div><aside className="flex flex-col justify-between gap-3 rounded-xl border border-cyan-400/15 bg-slate-950/70 p-4"><div className="space-y-4"><MapStat label="Online Devices" value="24" tone="green" /><MapStat label="Patrolling" value="12" tone="blue" /><MapStat label="Inactive" value="5" tone="neutral" /></div><Link to="/live-map" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-400/10 text-sm font-semibold text-emerald-300 hover:bg-emerald-400/15">Open Live Map <ArrowRight className="h-4 w-4" /></Link></aside></div></section>;
}

function ManagementAssistantPanel({ canManage, role, open, onToggle }: { canManage: boolean; role: string; open: boolean; onToggle: () => void }) {
  const showMenu = canManage && open;
  return <aside className="flex min-h-[44rem] flex-col border-cyan-400/15 bg-[#050b14]/86 p-4"><div className="mb-6 flex items-center gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-2xl border-2 border-emerald-400 text-xl font-black text-emerald-300 shadow-[0_0_20px_rgba(16,185,129,0.22)]">AI</div><div><p className="font-semibold text-white">AI Assistant</p><p className="text-sm text-slate-400">Your smart security assistant</p></div></div><section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5"><div className="flex items-center gap-4"><div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/10 text-emerald-300"><Shield className="h-9 w-9" /></div><div className="min-w-0"><p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-300">Management AI</p><p className="mt-1 text-sm text-slate-400">Authorized access only</p><p className="mt-1 text-xs capitalize text-slate-500">Current role: {role}</p></div></div><button type="button" onClick={onToggle} disabled={!canManage} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-slate-950/70 text-sm font-semibold text-white transition enabled:hover:border-emerald-400/40 disabled:cursor-not-allowed disabled:opacity-55"><Lock className="h-4 w-4" /> {showMenu ? "Hide Management" : "Switch to Management"}</button>{!canManage && <p className="mt-3 text-xs text-amber-300">Management access is hidden for this role.</p>}</section>{showMenu ? <section className="mt-4 flex-1 overflow-hidden rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.03] p-4"><p className="mb-3 text-xs font-black uppercase tracking-[0.14em] text-emerald-300">Management Menu</p><div className="grid max-h-[32rem] gap-2 overflow-y-auto pr-1">{management.map(([number, label, route]) => route ? <Link key={number} to={route} className="flex items-center justify-between rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-200 hover:border-emerald-400/30 hover:text-white"><span><b className="text-emerald-300">{number}.</b> {label}</span><ArrowRight className="h-3.5 w-3.5 text-slate-500" /></Link> : <button key={number} className="rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2 text-left text-sm text-slate-200"><b className="text-emerald-300">{number}.</b> {label}</button>)}</div></section> : <section className="mt-6 flex-1"><p className="text-sm font-black uppercase tracking-[0.12em] text-emerald-300">Main Menu</p><p className="mt-4 max-w-[17rem] text-sm leading-6 text-slate-300">To get started, reply with the number of what you want to know or do.</p></section>}<div className="mt-6 rounded-2xl border border-white/10 bg-slate-950/50 p-4"><div className="flex items-center gap-3 text-emerald-300"><ShieldCheck className="h-7 w-7" /><span className="text-sm font-semibold">Secure. Private. Protected.</span></div><p className="mt-3 text-sm text-slate-400">Your data and system are protected.</p></div></aside>;
}

function UserAssistantChat({ selectedSite, message, onMessageChange }: { selectedSite: string; message: string; onMessageChange: (value: string) => void }) {
  return <section className="rounded-2xl border border-cyan-400/20 bg-slate-950/50 p-3"><div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-3"><div className="flex h-11 w-11 items-center justify-center rounded-2xl border-2 border-emerald-400 text-sm font-black text-emerald-300">AI</div><div><h2 className="text-sm font-black uppercase tracking-[0.12em] text-white">AI Assistant: User</h2><p className="text-xs text-slate-400">Ask anything about your security operations.</p></div></div><button className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-slate-950/80 px-3 text-sm font-semibold text-white"><Plus className="h-4 w-4" /> New Chat</button></div><div className="grid gap-3 lg:grid-cols-[1fr_1.08fr]"><div className="space-y-3"><AssistantBubble title="MX PATROL" time="9:41 AM"><p>Good morning</p><p>Viewing: {selectedSite}</p><p>What would you like to do?</p><ol className="mt-3 space-y-1">{userOptions.map((option, index) => <li key={option}>{index + 1}. {option}</li>)}</ol><p className="mt-3 text-slate-300">You can also ask me something like:</p><p className="text-slate-100">Which devices are offline?</p></AssistantBubble><AssistantBubble title="DEVICES" time="9:41 AM"><p><span className="mr-2 inline-block h-3 w-3 rounded-full bg-emerald-400" />All devices are online.</p><p className="mt-2">Reply with a number, or type menu.</p></AssistantBubble><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{summary.map(([label, value, tone]) => <SummaryChip key={label} label={label} value={value} tone={tone} />)}</div></div><div className="flex min-h-[26rem] flex-col justify-end rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_bottom_right,rgba(16,185,129,0.12),transparent_28%),rgba(2,6,23,0.35)] p-4"><UserBubble time="9:41 AM">Which devices are offline?</UserBubble><UserBubble time="9:41 AM">4</UserBubble><div className="mt-auto pt-5"><div className="mb-2 flex flex-wrap gap-2"><QuickPrompt>Show missed patrols</QuickPrompt><QuickPrompt>Device status</QuickPrompt><QuickPrompt>Generate report</QuickPrompt><QuickPrompt>Today's summary</QuickPrompt></div><div className="flex items-center gap-3"><button className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 text-slate-300" aria-label="Assistant menu"><Menu className="h-5 w-5" /></button><label className="flex h-12 min-w-0 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/80 px-4"><input value={message} onChange={(event) => onMessageChange(event.target.value)} className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-500" placeholder="Type a number or your question..." /><Paperclip className="h-5 w-5 text-slate-400" /><Send className="h-5 w-5 text-emerald-300" /></label><button className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-500 text-white shadow-[0_0_24px_rgba(16,185,129,0.35)]" aria-label="Voice input"><Mic className="h-5 w-5" /></button></div><p className="mt-3 text-center text-[11px] text-slate-500">AI responses can make mistakes. Please verify critical information.</p></div></div></div></section>;
}

function MapRoute() {
  const checkpoints = [{ x: 80, y: 190 }, { x: 305, y: 116 }, { x: 536, y: 106 }, { x: 808, y: 86 }, { x: 760, y: 206 }];
  const patrols = [{ x: 230, y: 108 }, { x: 470, y: 172 }, { x: 650, y: 92 }];
  return <svg viewBox="0 0 900 260" className="absolute inset-0 h-full w-full" role="img" aria-label="Live patrol route visualization"><path d="M80 190 C170 110 225 205 305 116 S438 56 536 106 650 73 808 86" fill="none" stroke="rgba(34,197,94,0.95)" strokeWidth="7" strokeLinecap="round" /><path d="M215 178 C310 154 425 222 528 150 S660 132 760 206" fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth="5" strokeDasharray="9 9" strokeLinecap="round" />{checkpoints.map((point, index) => <g key={index}><circle cx={point.x} cy={point.y} r="18" fill="rgba(34,197,94,0.16)" stroke="rgba(34,197,94,0.9)" strokeWidth="4" /><circle cx={point.x} cy={point.y} r="8" fill="#d1fae5" /></g>)}{patrols.map((point, index) => <g key={"patrol-" + index}><circle cx={point.x} cy={point.y} r="16" fill="#1d4ed8" stroke="#60a5fa" strokeWidth="4" /><circle cx={point.x} cy={point.y} r="5" fill="white" /></g>)}<circle cx="155" cy="182" r="28" fill="rgba(239,68,68,0.22)" stroke="rgba(239,68,68,0.7)" strokeWidth="3" /><circle cx="155" cy="182" r="9" fill="#ef4444" /></svg>;
}

function MapLegend({ label, color }: { label: string; color: string }) {
  return <div className="mb-2 flex items-center gap-2 last:mb-0"><span className={"h-2.5 w-2.5 rounded-full " + color} />{label}</div>;
}

function MapStat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const color = tone === "green" ? "bg-emerald-400 text-emerald-300" : tone === "blue" ? "bg-blue-500 text-blue-300" : "bg-slate-500 text-slate-300";
  const [dotColor, textColor] = color.split(" ");
  return <div className="flex items-center justify-between gap-3 text-sm"><span className="flex items-center gap-2 text-slate-300"><span className={"h-2.5 w-2.5 rounded-full " + dotColor} />{label}</span><b className={textColor}>{value}</b></div>;
}

function AssistantBubble({ title, time, children }: { title: string; time: string; children: ReactNode }) {
  return <div className="max-w-xl rounded-xl border border-white/10 bg-slate-900/75 p-4 text-sm text-white"><p className="mb-2 font-black uppercase tracking-[0.08em]">{title}</p><div className="leading-5 text-slate-100">{children}</div><p className="mt-2 text-right text-xs text-slate-500">{time}</p></div>;
}

function UserBubble({ time, children }: { time: string; children: ReactNode }) {
  return <div className="mb-4 ml-auto max-w-[22rem] rounded-xl bg-emerald-600 px-4 py-2 text-sm text-white shadow-[0_0_18px_rgba(16,185,129,0.18)]">{children}<span className="ml-3 text-xs text-emerald-100/80">{time}</span></div>;
}

function QuickPrompt({ children }: { children: ReactNode }) {
  return <button className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-200 hover:border-cyan-300/45">{children}</button>;
}

function SummaryChip({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const color = toneClasses(tone).text;
  return <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3"><p className={"text-lg font-black " + color}>{value}</p><p className="text-[11px] leading-tight text-slate-400">{label}</p></div>;
}

function toneClasses(tone: Tone) {
  const map = {
    green: { icon: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300", text: "text-emerald-300" },
    blue: { icon: "border-blue-400/25 bg-blue-400/10 text-blue-300", text: "text-blue-300" },
    amber: { icon: "border-amber-400/25 bg-amber-400/10 text-amber-300", text: "text-amber-300" },
    red: { icon: "border-red-400/25 bg-red-500/15 text-red-300", text: "text-red-300" },
    neutral: { icon: "border-slate-500/25 bg-slate-500/10 text-slate-300", text: "text-slate-300" },
  } satisfies Record<Tone, { icon: string; text: string }>;
  return map[tone];
}
