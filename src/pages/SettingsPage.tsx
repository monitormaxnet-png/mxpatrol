import { useState, useEffect } from "react";
import { Building2, Users, Loader2, Save, Plus, Trash2, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type UserRole = {
  id: string;
  user_id: string;
  role: "admin" | "supervisor" | "guard";
  profile?: { full_name: string | null; avatar_url: string | null } | null;
};

const SettingsPage = () => {
  const { user } = useAuth();

  // Company state
  const [company, setCompany] = useState<{ id: string; name: string; domain: string | null } | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");
  const [savingCompany, setSavingCompany] = useState(false);
  const [loadingCompany, setLoadingCompany] = useState(true);

  // Users/roles state
  const [roles, setRoles] = useState<UserRole[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(true);

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
      const { data } = await supabase
        .from("user_roles")
        .select("id, user_id, role");

      if (data) {
        // Fetch profiles for each user
        const userIds = [...new Set(data.map((r) => r.user_id))];
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url")
          .in("id", userIds);

        const profileMap = new Map(profiles?.map((p) => [p.id, p]) || []);
        const enriched = data.map((r) => ({
          ...r,
          profile: profileMap.get(r.user_id) || null,
        }));
        setRoles(enriched);
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
    const { error } = await supabase
      .from("user_roles")
      .update({ role: newRole })
      .eq("id", roleId);

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

  const roleColors: Record<string, string> = {
    admin: "bg-destructive/10 text-destructive",
    supervisor: "bg-warning/10 text-warning",
    guard: "bg-primary/10 text-primary",
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Settings</h2>
        <p className="text-sm text-muted-foreground">Manage your organization and platform configuration</p>
      </div>

      <Tabs defaultValue="company" className="space-y-4">
        <TabsList className="grid w-full grid-cols-2 lg:w-[300px]">
          <TabsTrigger value="company" className="flex items-center gap-2">
            <Building2 className="h-4 w-4" />
            Company
          </TabsTrigger>
          <TabsTrigger value="users" className="flex items-center gap-2">
            <Users className="h-4 w-4" />
            Users & Roles
          </TabsTrigger>
        </TabsList>

        {/* Company Tab */}
        <TabsContent value="company">
          <div className="glass-card p-5 lg:p-6 space-y-5">
            <h3 className="font-heading text-sm font-semibold text-foreground">Company Settings</h3>

            {loadingCompany ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-4 max-w-md">
                <div>
                  <Label>Company Name</Label>
                  <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
                </div>
                <div>
                  <Label>Domain</Label>
                  <Input value={companyDomain} onChange={(e) => setCompanyDomain(e.target.value)} placeholder="example.com" />
                </div>
                <Button onClick={handleSaveCompany} disabled={savingCompany}>
                  {savingCompany ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Changes
                </Button>
              </div>
            )}
          </div>
        </TabsContent>

        {/* Users & Roles Tab */}
        <TabsContent value="users">
          <div className="glass-card p-5 lg:p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="font-heading text-sm font-semibold text-foreground">Users & Roles</h3>
            </div>

            {loadingRoles ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : roles.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">No users found</p>
            ) : (
              <div className="space-y-3">
                {roles.map((role) => (
                  <div key={role.id} className="flex items-center gap-4 rounded-lg border border-border/30 p-4">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
                      <Shield className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {role.profile?.full_name || "Unnamed User"}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{role.user_id}</p>
                    </div>
                    <Select
                      value={role.role}
                      onValueChange={(v) => handleUpdateRole(role.id, v as "admin" | "supervisor" | "guard")}
                    >
                      <SelectTrigger className="w-[130px] h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">Admin</SelectItem>
                        <SelectItem value="supervisor">Supervisor</SelectItem>
                        <SelectItem value="guard">Guard</SelectItem>
                      </SelectContent>
                    </Select>
                    <button
                      onClick={() => handleDeleteRole(role.id, role.user_id)}
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="Remove role"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
