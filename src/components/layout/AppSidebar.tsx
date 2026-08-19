import { NavLink, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  Bell,
  CalendarDays,
  Brain,
  Building2,
  Camera,
  FileText,
  LayoutDashboard,
  ListChecks,
  History,
  LogOut,
  Map,
  MessageSquare,
  Radio,
  Route,
  ScanLine,
  Settings,
  Shield,
  X,
} from "lucide-react";
import { useUserRole, type AppRole } from "@/hooks/useUserRole";
import { usePlatformAdmin } from "@/hooks/usePlatformAdmin";
import { useAuth } from "@/contexts/AuthContext";
import { useAlerts } from "@/hooks/useDashboardData";
import { useRealtimeConnectionStatus, realtimeStatusLabel } from "@/hooks/useRealtimeConnectionStatus";
import { TTechMxPatrolLogo } from "@/components/branding/TTechMxPatrolLogo";

type NavItem = {
  to: string;
  icon: typeof LayoutDashboard;
  label: string;
  minRole?: AppRole[];
  badge?: number;
};

const baseNavItems: NavItem[] = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Command Center" },
  { to: "/live-patrol", icon: Activity, label: "Live Patrol" },
  { to: "/patrols", icon: Route, label: "Patrols", minRole: ["admin", "supervisor"] },
  { to: "/routes", icon: Route, label: "Routes", minRole: ["admin", "supervisor"] },
  { to: "/schedules", icon: CalendarDays, label: "Schedules", minRole: ["admin", "supervisor"] },
  { to: "/live-map", icon: Map, label: "Live Map" },
  { to: "/session-logs", icon: ListChecks, label: "Session Logs" },
  { to: "/scan-logs", icon: History, label: "Scan Logs", minRole: ["admin", "supervisor"] },
  { to: "/reports", icon: FileText, label: "Reports", minRole: ["admin", "supervisor"] },
  { to: "/whatsapp", icon: MessageSquare, label: "WhatsApp Assistant", minRole: ["admin", "supervisor"] },
  { to: "/incidents", icon: AlertTriangle, label: "Incidents" },
  { to: "/checkpoints", icon: ScanLine, label: "Checkpoints", minRole: ["admin", "supervisor"] },
  { to: "/devices", icon: Radio, label: "Devices", minRole: ["admin"] },
  { to: "/nfc-scanner", icon: ScanLine, label: "NFC Scanner" },
  { to: "/sos-alerts", icon: Bell, label: "SOS Alerts" },
  { to: "/cameras", icon: Camera, label: "Cameras", minRole: ["admin", "supervisor"] },
  { to: "/ai-insights", icon: Brain, label: "AI Intelligence", minRole: ["admin", "supervisor"] },
  { to: "/settings", icon: Settings, label: "Settings", minRole: ["admin"] },
];

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
}

const AppSidebar = ({ open, onClose }: AppSidebarProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { role } = useUserRole();
  const { isPlatformAdmin } = usePlatformAdmin();
  const { data: alerts = [] } = useAlerts();
  const realtime = useRealtimeConnectionStatus("sidebar");

  const unreadSos = alerts.filter((alert) => alert.type === "panic_button" && !alert.is_read).length;
  const platformItems: NavItem[] = isPlatformAdmin
    ? [{ to: "/companies", icon: Building2, label: "Companies" }]
    : [];

  const visibleItems = [
    ...platformItems,
    ...baseNavItems.map((item) => (item.to === "/sos-alerts" ? { ...item, badge: unreadSos } : item)),
  ].filter((item) => !item.minRole || item.minRole.includes(role));

  const handleLogout = async () => {
    await signOut();
    onClose();
    navigate("/login", { replace: true });
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-emerald-400/10 bg-[#030812] transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-20 items-center justify-between border-b border-white/10 px-4">
          <div>
            <TTechMxPatrolLogo variant="sidebar" priority className="w-40" />
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {visibleItems.map(({ to, icon: Icon, label, badge }) => {
            const isActive = location.pathname === to || location.pathname.startsWith(`${to}/`) || (to === "/dashboard" && location.pathname === "/command-center");
            return (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
                  isActive
                    ? "border-l-2 border-emerald-400 bg-emerald-400/10 text-emerald-300 shadow-[0_0_18px_rgba(16,185,129,0.12)]"
                    : "text-slate-300 hover:bg-white/5 hover:text-white"
                }`}
              >
                <span className="flex min-w-0 items-center gap-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{label}</span>
                </span>
                {!!badge && (
                  <span className="ml-2 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-black text-white">
                    {badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="space-y-4 border-t border-white/10 p-4">
          <div className="rounded-xl border border-white/10 bg-slate-950/70 p-4 text-xs">
            <p className="mb-3 font-black uppercase tracking-[0.14em] text-slate-300">System Status</p>
            <StatusLine label="Database" value="Online" />
            <StatusLine label="Realtime" value={realtimeStatusLabel(realtime.status)} active={realtime.status === "live"} />
            <StatusLine label="Storage" value="Healthy" />
            <StatusLine label="API Services" value="Online" />
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-slate-950/70 px-3 py-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-400/10 text-emerald-300">
              <Shield className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs font-bold text-white">System Online</p>
              <p className="text-[10px] capitalize text-slate-400">{role} access</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold text-slate-300 transition-all hover:bg-white/5 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            Logout
          </button>
        </div>
      </aside>
    </>
  );
};

function StatusLine({ label, value, active = true }: { label: string; value: string; active?: boolean }) {
  return (
    <div className="mb-2 flex items-center justify-between last:mb-0">
      <span className="text-slate-400">{label}</span>
      <span className={`flex items-center gap-1 font-semibold ${active ? "text-emerald-300" : "text-amber-300"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-amber-400"}`} />
        {value}
      </span>
    </div>
  );
}

export default AppSidebar;
