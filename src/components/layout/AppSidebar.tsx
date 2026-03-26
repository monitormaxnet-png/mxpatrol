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
  Scan,
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

const AppSidebar = () => {
  const location = useLocation();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <div className="flex h-16 items-center gap-3 border-b border-sidebar-border px-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 glow-primary">
          <Shield className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="font-heading text-sm font-bold text-foreground tracking-wide">SENTINEL</h1>
          <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Patrol Intelligence</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-1 px-3 py-4">
        {navItems.map(({ to, icon: Icon, label }) => {
          const isActive = location.pathname === to;
          return (
            <NavLink
              key={to}
              to={to}
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
  );
};

export default AppSidebar;
