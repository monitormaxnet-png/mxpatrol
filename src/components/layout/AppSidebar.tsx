import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Shield,
  MapPin,
  Users,
  AlertTriangle,
  Brain,
  FileText,
  Settings,
  Radio,
  X,
} from "lucide-react";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Command Center" },
  { to: "/patrols", icon: MapPin, label: "Patrols" },
  { to: "/guards", icon: Users, label: "Guards" },
  { to: "/incidents", icon: AlertTriangle, label: "Incidents" },
  { to: "/ai-insights", icon: Brain, label: "AI Insights" },
  { to: "/reports", icon: FileText, label: "Reports" },
  { to: "/devices", icon: Radio, label: "Devices" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

interface AppSidebarProps {
  open: boolean;
  onClose: () => void;
}

const AppSidebar = ({ open, onClose }: AppSidebarProps) => {
  const location = useLocation();

  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-background/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`fixed left-0 top-0 z-50 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar transition-transform duration-300 lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        {/* Brand */}
        <div className="flex h-14 items-center justify-between border-b border-sidebar-border px-4 lg:h-16 lg:px-5">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 glow-primary lg:h-9 lg:w-9">
              <Shield className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
            </div>
            <div>
              <h1 className="font-heading text-sm font-bold text-foreground tracking-wide">SENTINEL</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Patrol Intelligence</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map(({ to, icon: Icon, label }) => {
            const isActive = location.pathname === to;
            return (
              <NavLink
                key={to}
                to={to}
                onClick={onClose}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-all ${
                  isActive
                    ? "bg-primary/10 text-primary glow-primary"
                    : "text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            );
          })}
        </nav>

        {/* Status */}
        <div className="border-t border-sidebar-border p-4">
          <div className="glass-card flex items-center gap-3 px-3 py-2.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
            </span>
            <div>
              <p className="text-xs font-medium text-foreground">System Online</p>
              <p className="text-[10px] text-muted-foreground">All services operational</p>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
};

export default AppSidebar;
