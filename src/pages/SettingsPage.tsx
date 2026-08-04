import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Building2, Users, Loader2, Save, Trash2, Shield, Bell, Lock,
  Mail, Globe, BadgeCheck, AlertTriangle, Eye, EyeOff, MapPin, Plus, Pencil, X
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

type SiteRecord = {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  status: string;
  created_at: string;
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

  // Sites state
  const [sites, setSites] = useState<SiteRecord[]>([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [savingSite, setSavingSite] = useState(false);
  const [editingSiteId, setEditingSiteId] = useState<string | null>(null);
  const [showSiteForm, setShowSiteForm] = useState(false);
  const [siteName, setSiteName] = useState("");
  const [siteAddress, setSiteAddress] = useState("");
  const [siteGpsLat, setSiteGpsLat] = useState("");
  const [siteGpsLng, setSiteGpsLng] = useState("");
  const [siteStatus, setSiteStatus] = useState("active");

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

  const resetSiteForm = () => {
    setEditingSiteId(null);
    setSiteName("");
    setSiteAddress("");
    setSiteGpsLat("");
    setSiteGpsLng("");
    setSiteStatus("active");
  };

  const loadSites = async (companyId: string) => {
    setLoadingSites(true);
    const { data, error } = await (supabase.from("sites" as never) as any)
      .select("id, company_id, name, address, gps_lat, gps_lng, status, created_at")
      .eq("company_id", companyId)
      .order("name", { ascending: true });
    setLoadingSites(false);

    if (error) {
      toast.error("Failed to load sites: " + error.message);
      return;
    }

    setSites((data ?? []) as SiteRecord[]);
  };

  const openNewSiteForm = () => {
    resetSiteForm();
    setShowSiteForm(true);
  };

  const openEditSiteForm = (site: SiteRecord) => {
    setEditingSiteId(site.id);
    setSiteName(site.name);
    setSiteAddress(site.address || "");
    setSiteGpsLat(site.gps_lat === null ? "" : String(site.gps_lat));
    setSiteGpsLng(site.gps_lng === null ? "" : String(site.gps_lng));
    setSiteStatus(site.status || "active");
    setShowSiteForm(true);
  };

  const closeSiteForm = () => {
    resetSiteForm();
    setShowSiteForm(false);
  };

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

  useEffect(() => {
    if (!company?.id) {
      setSites([]);
      return;
    }
    loadSites(company.id);
  }, [company?.id]);

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

  const handleSaveSite = async () => {
    if (!company?.id || !isAdmin) return;

    const trimmedName = siteName.trim();
    if (!trimmedName) {
      toast.error("Site name is required");
      return;
    }

    const lat = siteGpsLat.trim() ? Number(siteGpsLat) : null;
    const lng = siteGpsLng.trim() ? Number(siteGpsLng) : null;
    if ((lat !== null && !Number.isFinite(lat)) || (lng !== null && !Number.isFinite(lng))) {
      toast.error("GPS coordinates must be valid numbers");
      return;
    }

    setSavingSite(true);
    const payload = {
      company_id: company.id,
      name: trimmedName,
      address: siteAddress.trim() || null,
      gps_lat: lat,
      gps_lng: lng,
      status: siteStatus,
    };

    const query = supabase.from("sites" as never) as any;
    const { error } = editingSiteId
      ? await query.update(payload).eq("id", editingSiteId).eq("company_id", company.id)
      : await query.insert(payload);

    setSavingSite(false);
    if (error) {
      toast.error("Failed to save site: " + error.message);
      return;
    }

    toast.success(editingSiteId ? "Site updated" : "Site added");
    closeSiteForm();
    await loadSites(company.id);
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
        <TabsList className="grid w-full grid-cols-5 lg:w-[640px]">
          <TabsTrigger value="company" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <Building2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Company</span>
          </TabsTrigger>
          <TabsTrigger value="sites" className="flex items-center gap-1.5 text-xs lg:text-sm">
            <MapPin className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Sites</span>
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


        {/* Sites Tab */}
        <TabsContent value="sites">
          <SectionCard>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
                  <MapPin className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <h3 className="font-heading text-sm font-semibold text-foreground">Manage Sites</h3>
                  <p className="text-xs text-muted-foreground">Add and edit branches for the current company</p>
                </div>
              </div>
              {isAdmin && (
                <Button onClick={openNewSiteForm} size="sm" className="w-full sm:w-auto">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Site
                </Button>
              )}
            </div>

            <Separator className="bg-border/30" />

            {showSiteForm && (
              <div className="rounded-lg border border-border/30 bg-secondary/20 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{editingSiteId ? "Edit Site" : "Add Site"}</h4>
                    <p className="text-xs text-muted-foreground">Sites are saved under {company?.name || "this company"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={closeSiteForm}
                    className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title="Close"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Site Name</Label>
                    <Input value={siteName} onChange={(e) => setSiteName(e.target.value)} placeholder="Main Branch" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Status</Label>
                    <Select value={siteStatus} onValueChange={setSiteStatus}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="inactive">Inactive</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5 md:col-span-2">
                    <Label className="text-xs text-muted-foreground">Address</Label>
                    <Input value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} placeholder="Street address" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">GPS Latitude</Label>
                    <Input value={siteGpsLat} onChange={(e) => setSiteGpsLat(e.target.value)} inputMode="decimal" placeholder="-26.2041" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">GPS Longitude</Label>
                    <Input value={siteGpsLng} onChange={(e) => setSiteGpsLng(e.target.value)} inputMode="decimal" placeholder="28.0473" />
                  </div>
                </div>

                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <Button onClick={handleSaveSite} disabled={savingSite} className="w-full sm:w-auto">
                    {savingSite ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    {editingSiteId ? "Save Site" : "Add Site"}
                  </Button>
                  <Button type="button" variant="outline" onClick={closeSiteForm} className="w-full sm:w-auto">
                    Cancel
                  </Button>
                </div>
              </div>
            )}

            {loadingSites ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sites.length === 0 ? (
              <div className="rounded-lg border border-border/30 py-10 text-center">
                <MapPin className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm font-medium text-foreground">No sites added yet</p>
                <p className="text-xs text-muted-foreground">Create the first site for this company.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border/30">
                <table className="w-full min-w-[760px] text-left text-sm">
                  <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-medium">Site</th>
                      <th className="px-4 py-3 font-medium">Status</th>
                      <th className="px-4 py-3 font-medium">Address</th>
                      <th className="px-4 py-3 font-medium">GPS Latitude</th>
                      <th className="px-4 py-3 font-medium">GPS Longitude</th>
                      <th className="px-4 py-3 font-medium text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {sites.map((site) => (
                      <tr key={site.id} className="bg-background/20">
                        <td className="px-4 py-3 font-medium text-foreground">{site.name}</td>
                        <td className="px-4 py-3">
                          <Badge variant="outline" className={site.status === "active" ? "border-success/30 text-success" : "border-muted-foreground/30 text-muted-foreground"}>
                            {site.status === "active" ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">{site.address || "-"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{site.gps_lat ?? "-"}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{site.gps_lng ?? "-"}</td>
                        <td className="px-4 py-3 text-right">
                          {isAdmin ? (
                            <Button variant="ghost" size="sm" onClick={() => openEditSiteForm(site)}>
                              <Pencil className="mr-2 h-4 w-4" />
                              Edit
                            </Button>
                          ) : (
                            <span className="text-xs text-muted-foreground">View only</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!isAdmin && (
              <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Lock className="h-3 w-3" /> Only admins can add or edit sites
              </p>
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
