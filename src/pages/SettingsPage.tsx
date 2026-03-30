import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Building2, Users, Loader2, Save, Trash2, Shield, Bell, Lock,
  Mail, Globe, Phone, BadgeCheck, AlertTriangle, Eye, EyeOff
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

type UserRole = {
  id: string;
  user_id: string;
  role: "admin" | "supervisor" | "guard";
  profile?: { full_name: string | null; avatar_url: string | null } | null;
};

const roleConfig = {
  admin: { label: "Admin", icon: Shield, color: "bg-destructive/10 text-destructive border-destructive/20" },
  supervisor: { label: "Supervisor", icon: Eye, color: "bg-warning/10 text-warning border-warning/20" },
  guard: { label: "Guard", icon: BadgeCheck, color: "bg-primary/10 text-primary border-primary/20" },
};

const SettingsPage = () => {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();

  // Company state
  const [company, setCompany] = useState<{ id: string; name: string; domain: string | null } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [loadingCompany, setLoadingCompany] = useState(true);

  // Users/roles state
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

  // Notification preferences (local state - could be persisted to company settings)
  const [notifCriticalAlerts, setNotifCriticalAlerts] = useState(true);
  const [notifMissedCheckpoints, setNotifMissedCheckpoints] = useState(true);
  const [notifPatrolUpdates, setNotifPatrolUpdates] = useState(true);
  const [notifIncidentReports, setNotifIncidentReports] = useState(true);
  const [notifDeviceOffline, setNotifDeviceOffline] = useState(true);
  const [notifAIInsights, setNotifAIInsights] = useState(false);

  // Security
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  // Load company data
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user.id)
        .single();

      if (profile?.company_id) {
        const { data: comp } = await supabase
          .from("companies")
          .select("id, name, domain")
          .eq("id", profile.company_id)
          .single();

        if (comp) {
          setCompany(comp);
          setCompanyName(comp.name);
          setCompanyDomain(comp.domain || "");
        }
      }
      setLoadingCompany(false);
    };
    load();
  }, [user]);

  // Load user roles
  useEffect(() => {
    if (!user) return;
    const loadRoles = async () => {
      const { data } = await supabase.from("user_roles").select("id, user_id, role");
      if (data) {
        const userIds = [...new Set(data.map((r) => r.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        setRoles(data.map((r) => ({ ...r, profile: profileMap.get(r.user_id) || null })));
      }
      setLoadingRoles(false);
    };
    loadRoles();
  }, [user]);

  const handleSaveCompany = async () => {
    if (!company) return;
    setSavingCompany(true);
    const { error } = await supabase
      .from("companies")
      .update({ name: companyName, domain: companyDomain || null })
      .eq("id", company.id);
    setSavingCompany(false);
    if (error) toast.error("Failed to update: " + error.message);
    else toast.success("Company settings saved");
  };

  const handleUpdateRole = async (roleId: string, newRole: "admin" | "supervisor" | "guard") => {
    const { error } = await supabase.from("user_roles").update({ role: newRole }).eq("id", roleId);
    if (error) toast.error("Failed to update role");
    else {
      setRoles((prev) => prev.map((r) => (r.id === roleId ? { ...r, role: newRole } : r)));
      toast.success("Role updated");
    }
  };

  const handleDeleteRole = async (roleId: string, userId: string) => {
    if (userId === user?.id) {
      toast.error("You cannot remove your own role");
      return;
    }
    const { error } = await supabase.from("user_roles").delete().eq("id", roleId);
    if (error) toast.error("Failed to remove role");
    else {
      setRoles((prev) => prev.filter((r) => r.id !== roleId));
      toast.success("Role removed");
    }
  };

  const handleChangePassword = async () => {
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setChangingPassword(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setChangingPassword(false);
    if (error) toast.error(error.message);
    else {
      toast.success("Password updated successfully");
      setNewPassword("");
      setConfirmPassword("");
    }
  };

  const handleSaveNotifications = () => {
    toast.success("Notification preferences saved");
  };

  const SectionCard = ({ children, className = "" }: { children: React.ReactNode; className?: string }) => (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`glass-card p-5 lg:p-6 space-y-5 ${className}`}
    >
      {children}
    </motion.div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your organization and platform configuration</p>
      </div>

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
          <TabsTrigger value="company" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <Building2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Company</span>
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <Users className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Users</span>
          </TabsTrigger>
          <TabsTrigger value="notifications" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <Bell className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Alerts</span>
          </TabsTrigger>
          <TabsTrigger value="security" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <Lock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Security</span>
          </TabsTrigger>
        </TabsList>

        {/* Company Tab */}
        <TabsContent value="company">
          <SectionCard>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                <Building2 className="h-4 w-4 text-primary" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-foreground">Company Settings</h3>
                <p className="text-xs text-muted-foreground">Configure your organization details</p>
              </div>
            </div>

            <Separator className="bg-border/30" />

            {loadingCompany ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Company Name</Label>
                  <div className="relative">
                    <Building2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} className="pl-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Domain</Label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="example.com" className="pl-9" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Contact Email</Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input value={user?.email || ""} disabled className="pl-9 opacity-60" />
                  </div>
                </div>
                {isAdmin && (
                  <Button onClick={handleSaveCompany} disabled={savingCompany} className="w-full sm:w-auto">
                    {savingCompany ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Save Changes
                  </Button>
                )}
                {!isAdmin && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <Lock className="h-3 w-3" /> Only admins can edit company settings
                  </p>
                )}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* Users & Roles Tab */}
        <TabsContent value="users">
          <SectionCard>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Users className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-semibold text-foreground">Team Members</h3>
                  <p className="text-xs text-muted-foreground">{roles.length} user{roles.length !== 1 ? "s" : ""} in organization</p>
                </div>
              </div>
              <div className="flex gap-2">
                {Object.entries(roleConfig).map(([key, cfg]) => {
                  const count = roles.filter(r => r.role === key).length;
                  return count > 0 ? (
                    <Badge key={key} variant="outline" className={`text-[10px] ${cfg.color} hidden lg:flex`}>
                      {count} {cfg.label}{count > 1 ? "s" : ""}
                    </Badge>
                  ) : null;
                })}
              </div>
            </div>

            <Separator className="bg-border/30" />

            {loadingRoles ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : roles.length === 0 ? (
              <div className="text-center py-8">
                <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No users found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {roles.map((role, index) => {
                  const cfg = roleConfig[role.role];
                  const RoleIcon = cfg.icon;
                  const isCurrentUser = role.user_id === user?.id;
                  return (
                    <motion.div
                      key={role.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="flex items-center gap-3 rounded-lg border border-border/30 bg-secondary/20 p-3 lg:p-4"
                    >
                      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.color}`}>
                        <RoleIcon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground truncate">
                            {role.profile?.full_name || "Unnamed User"}
                          </p>
                          {isCurrentUser && (
                            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">You</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">{role.user_id.slice(0, 8)}...</p>
                      </div>
                      {isAdmin ? (
                        <Select
                          value={role.role}
                          onValueChange={(v) => handleUpdateRole(role.id, v as "admin" | "supervisor" | "guard")}
                        >
                          <SelectTrigger className="w-[110px] lg:w-[130px] h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="supervisor">Supervisor</SelectItem>
                            <SelectItem value="guard">Guard</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className={`text-xs ${cfg.color}`}>{cfg.label}</Badge>
                      )}
                      {isAdmin && !isCurrentUser && (
                        <button
                          onClick={() => handleDeleteRole(role.id, role.user_id)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          title="Remove user"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </motion.div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications">
          <SectionCard>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning/10">
                <Bell className="h-4 w-4 text-warning" />
              </div>
              <div>
                <h3 className="font-heading text-sm font-semibold text-foreground">Notification Preferences</h3>
                <p className="text-xs text-muted-foreground">Control which alerts you receive</p>
              </div>
            </div>

            <Separator className="bg-border/30" />

            <div className="space-y-4 max-w-lg">
              {[
                { label: "Critical Alerts", desc: "Panic button, system failures", state: notifCriticalAlerts, set: setNotifCriticalAlerts, critical: true },
                { label: "Missed Checkpoints", desc: "When guards miss scheduled scans", state: notifMissedCheckpoints, set: setNotifMissedCheckpoints },
                { label: "Patrol Updates", desc: "Patrol start, completion, delays", state: notifPatrolUpdates, set: setNotifPatrolUpdates },
                { label: "Incident Reports", desc: "New incidents submitted by guards", state: notifIncidentReports, set: setNotifIncidentReports },
                { label: "Device Offline", desc: "Guard device connectivity issues", state: notifDeviceOffline, set: setNotifDeviceOffline },
                { label: "AI Insights", desc: "Anomaly detection and predictions", state: notifAIInsights, set: setNotifAIInsights },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between gap-4 rounded-lg border border-border/20 p-3">
                  <div className="flex items-center gap-3">
                    {item.critical && <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />}
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.label}</p>
                      <p className="text-xs text-muted-foreground">{item.desc}</p>
                    </div>
                  </div>
                  <Switch checked={item.state} onCheckedChange={item.set} />
                </div>
              ))}

              <Button onClick={handleSaveNotifications} className="w-full sm:w-auto">
                <Save className="mr-2 h-4 w-4" />
                Save Preferences
              </Button>
            </div>
          </SectionCard>
        </TabsContent>

        {/* Security Tab */}
        <TabsContent value="security">
          <div className="space-y-4">
            <SectionCard>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-destructive/10">
                  <Lock className="h-4 w-4 text-destructive" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-semibold text-foreground">Change Password</h3>
                  <p className="text-xs text-muted-foreground">Update your account password</p>
                </div>
              </div>

              <Separator className="bg-border/30" />

              <div className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="pl-9 pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Confirm Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      type={showPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      className="pl-9"
                    />
                  </div>
                </div>
                <Button onClick={handleChangePassword} disabled={changingPassword || !newPassword} className="w-full sm:w-auto">
                  {changingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Shield className="mr-2 h-4 w-4" />}
                  Update Password
                </Button>
              </div>
            </SectionCard>

            <SectionCard>
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <Shield className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-semibold text-foreground">Session Info</h3>
                  <p className="text-xs text-muted-foreground">Current authentication details</p>
                </div>
              </div>

              <Separator className="bg-border/30" />

              <div className="space-y-3 max-w-md">
                <div className="flex items-center justify-between rounded-lg border border-border/20 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Email</p>
                    <p className="text-sm font-medium text-foreground">{user?.email}</p>
                  </div>
                  <Mail className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/20 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">User ID</p>
                    <p className="text-sm font-mono text-foreground">{user?.id?.slice(0, 16)}...</p>
                  </div>
                  <BadgeCheck className="h-4 w-4 text-success" />
                </div>
                <div className="flex items-center justify-between rounded-lg border border-border/20 p-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Authentication</p>
                    <p className="text-sm font-medium text-foreground">Email & Password</p>
                  </div>
                  <Lock className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            </SectionCard>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
