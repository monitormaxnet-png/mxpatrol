import { Shield, Building2, Users, Bell, Key } from "lucide-react";

const SettingsPage = () => {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-2xl font-bold text-foreground">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your organization and platform configuration</p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          { icon: Building2, title: "Organization", desc: "Company profile, branding, and tenant settings" },
          { icon: Users, title: "Team & Roles", desc: "Manage admins, supervisors, and guard accounts" },
          { icon: Bell, title: "Notifications", desc: "Alert thresholds, channels, and escalation rules" },
          { icon: Key, title: "API & Integrations", desc: "NFC hardware, WhatsApp, and third-party connections" },
          { icon: Shield, title: "Security", desc: "RLS policies, audit logs, and device binding" },
        ].map((item, i) => (
          <div key={i} className="glass-card flex items-center gap-4 p-5 cursor-pointer transition-colors hover:bg-muted/30">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <item.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-heading text-sm font-semibold text-foreground">{item.title}</p>
              <p className="text-xs text-muted-foreground">{item.desc}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default SettingsPage;
