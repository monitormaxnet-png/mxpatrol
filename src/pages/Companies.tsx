import { useEffect, useState } from "react";
import { Building2, Loader2, Plus, RefreshCw, Save, Search, Shield, Users, MapPin, Radio, Pencil, X, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

interface PlatformCompany {
  id: string;
  name: string;
  domain: string | null;
  status: string;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  created_at: string;
  updated_at: string;
  counts: { users: number; sites: number; devices: number };
}

const emptyForm = {
  company_id: "",
  name: "",
  domain: "",
  contact_name: "",
  contact_email: "",
  contact_phone: "",
  address: "",
  status: "active",
  admin_full_name: "",
  admin_email: "",
};

const normalizeCompany = (company: any): PlatformCompany => ({
  ...company,
  status: company.status ?? company.settings?.status ?? "active",
  contact_name: company.contact_name ?? company.settings?.contact_name ?? null,
  contact_email: company.contact_email ?? company.settings?.contact_email ?? null,
  contact_phone: company.contact_phone ?? company.settings?.contact_phone ?? null,
  address: company.address ?? company.settings?.address ?? null,
  counts: {
    users: company.counts?.users ?? 0,
    sites: company.counts?.sites ?? 0,
    devices: company.counts?.devices ?? 0,
  },
});

const readFunctionError = async (error: any) => {
  const response = error?.context;
  if (response && typeof response.clone === "function") {
    try {
      const body = await response.clone().json();
      return body?.error || body?.message || JSON.stringify(body);
    } catch {
      try {
        const text = await response.clone().text();
        if (text) return text;
      } catch {
        // Fall through to the generic Supabase error message.
      }
    }
  }

  return error?.message || "Platform company request failed";
};

const Companies = () => {
  const [companies, setCompanies] = useState<PlatformCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [accessError, setAccessError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [form, setForm] = useState(emptyForm);

  const invokePlatformCompanies = async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("platform-companies", { body });
    if (error) {
      const detail = await readFunctionError(error);
      console.error("[Companies] platform-companies invoke failed", {
        action: body.action,
        name: error.name,
        message: error.message,
        detail,
        context: error.context,
      });
      throw new Error(detail);
    }

    const succeeded = data?.ok === true || data?.success === true || Array.isArray(data?.companies) || !!data?.company || !!data?.deleted;
    if (!succeeded) {
      const detail = data?.error || data?.message || JSON.stringify(data ?? {});
      console.warn("[Companies] platform-companies rejected request", {
        action: body.action,
        detail,
        response: data,
      });
      throw new Error(detail || "Platform company request failed");
    }

    return data;
  };

  const loadCompanies = async () => {
    setLoading(true);
    setAccessError(null);
    try {
      const data = await invokePlatformCompanies({ action: "list" });
      setCompanies((data.companies ?? []).map(normalizeCompany));
      if (data.bootstrapped) toast.success("Platform owner access initialized for your account");
    } catch (error: any) {
      setAccessError(error?.message || "Could not load companies");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCompanies();
  }, []);

  const updateField = (key: keyof typeof emptyForm, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  };

  const openEdit = (company: PlatformCompany) => {
    setEditingId(company.id);
    setForm({
      ...emptyForm,
      company_id: company.id,
      name: company.name,
      domain: company.domain ?? "",
      contact_name: company.contact_name ?? "",
      contact_email: company.contact_email ?? "",
      contact_phone: company.contact_phone ?? "",
      address: company.address ?? "",
      status: company.status || "active",
    });
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm(emptyForm);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.error("Company name is required");
      return;
    }
    if (!editingId && !form.contact_email.trim()) {
      toast.error("Contact email is required");
      return;
    }

    setSaving(true);
    try {
      const action = editingId ? "update" : "create";
      const companyPayload = {
        name: form.name,
        domain: form.domain || null,
        settings: {
          status: form.status,
          contact_name: form.contact_name || null,
          contact_email: form.contact_email || null,
          contact_phone: form.contact_phone || null,
          address: form.address || null,
          admin_full_name: form.admin_full_name || null,
          admin_email: form.admin_email || form.contact_email || null,
        },
      };
      const payload = editingId
        ? { action, company: { id: editingId, ...companyPayload } }
        : { action, company: companyPayload };
      console.info("[Companies] create/update payload", payload);
      const data = await invokePlatformCompanies(payload);
      toast.success(editingId ? "Company updated" : "Company created");
      if (data.admin?.warning) toast.warning(`Admin invite warning: ${data.admin.warning}`);
      closeForm();
      await loadCompanies();
    } catch (error: any) {
      toast.error(error?.message || "Failed to save company");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (company: PlatformCompany) => {
    const confirmed = window.confirm(`Delete ${company.name}? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(company.id);
    try {
      await invokePlatformCompanies({ action: "delete", company: { id: company.id } });
      toast.success("Company deleted");
      if (editingId === company.id) closeForm();
      await loadCompanies();
    } catch (error: any) {
      toast.error(error?.message || "Failed to delete company");
    } finally {
      setDeletingId(null);
    }
  };

  const filteredCompanies = companies.filter((company) => {
    const haystack = [company.name, company.domain, company.contact_name, company.contact_email, company.status]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return haystack.includes(query.toLowerCase());
  });

  if (accessError) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Companies</h2>
          <p className="text-sm text-muted-foreground">MX Patrol owner company onboarding</p>
        </div>
        <div className="glass-card p-6">
          <div className="flex items-start gap-3">
            <Shield className="mt-1 h-5 w-5 text-warning" />
            <div className="space-y-2">
              <p className="font-semibold text-foreground">Platform admin access required</p>
              <p className="text-sm text-muted-foreground">{accessError}</p>
              <Button onClick={loadCompanies} variant="outline" size="sm">
                <RefreshCw className="mr-2 h-4 w-4" /> Retry
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Companies</h2>
          <p className="text-sm text-muted-foreground">Create and manage MX Patrol customer companies</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={loadCompanies} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> Add Company
          </Button>
        </div>
      </div>

      {showForm && (
        <div className="glass-card p-5 lg:p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h3 className="font-heading text-base font-semibold text-foreground">{editingId ? "Edit Company" : "Add Company"}</h3>
              <p className="text-sm text-muted-foreground">{editingId ? "Update company details and status" : "Create a customer company and invite its first admin"}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={closeForm}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <Separator className="mb-5 bg-border/30" />

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Company Name</Label>
              <Input value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="MonitorMax Security" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Domain</Label>
              <Input value={form.domain} onChange={(e) => updateField("domain", e.target.value)} placeholder="example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Status</Label>
              <Select value={form.status} onValueChange={(value) => updateField("status", value)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contact Person</Label>
              <Input value={form.contact_name} onChange={(e) => updateField("contact_name", e.target.value)} placeholder="Operations Manager" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contact Email</Label>
              <Input value={form.contact_email} onChange={(e) => updateField("contact_email", e.target.value)} placeholder="admin@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contact Phone</Label>
              <Input value={form.contact_phone} onChange={(e) => updateField("contact_phone", e.target.value)} placeholder="+27 ..." />
            </div>
            <div className="space-y-1.5 md:col-span-2 xl:col-span-3">
              <Label className="text-xs text-muted-foreground">Address</Label>
              <Input value={form.address} onChange={(e) => updateField("address", e.target.value)} placeholder="Company address" />
            </div>
            {!editingId && (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">First Admin Name</Label>
                  <Input value={form.admin_full_name} onChange={(e) => updateField("admin_full_name", e.target.value)} placeholder="Admin full name" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">First Admin Email</Label>
                  <Input value={form.admin_email} onChange={(e) => updateField("admin_email", e.target.value)} placeholder="admin@example.com" />
                </div>
              </>
            )}
          </div>

          <div className="mt-5 flex flex-col gap-2 sm:flex-row">
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
              {editingId ? "Save Company" : "Create Company"}
            </Button>
            <Button variant="outline" onClick={closeForm}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="glass-card p-5 lg:p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h3 className="font-heading text-sm font-semibold text-foreground">Customer Companies</h3>
              <p className="text-xs text-muted-foreground">{companies.length} compan{companies.length === 1 ? "y" : "ies"} on platform</p>
            </div>
          </div>
          <div className="relative sm:w-72">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search companies" className="pl-9" />
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCompanies.length === 0 ? (
          <div className="rounded-lg border border-border/30 py-12 text-center">
            <Building2 className="mx-auto mb-3 h-9 w-9 text-muted-foreground" />
            <p className="font-medium text-foreground">No companies found</p>
            <p className="text-sm text-muted-foreground">Add the first customer company to begin onboarding.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/30">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="bg-secondary/40 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Contact</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Users</th>
                  <th className="px-4 py-3 font-medium">Sites</th>
                  <th className="px-4 py-3 font-medium">Devices</th>
                  <th className="px-4 py-3 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filteredCompanies.map((company) => (
                  <tr key={company.id} className="bg-background/20">
                    <td className="px-4 py-3">
                      <p className="font-medium text-foreground">{company.name}</p>
                      <p className="text-xs text-muted-foreground">{company.domain || company.id.slice(0, 8)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-sm text-foreground">{company.contact_name || "-"}</p>
                      <p className="text-xs text-muted-foreground">{company.contact_email || "No email"}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={company.status === "active" ? "border-success/30 text-success" : "border-muted-foreground/30 text-muted-foreground"}>
                        {company.status === "active" ? "Active" : "Inactive"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-muted-foreground" />{company.counts.users}</span></td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-foreground" />{company.counts.sites}</span></td>
                    <td className="px-4 py-3"><span className="inline-flex items-center gap-1.5"><Radio className="h-3.5 w-3.5 text-muted-foreground" />{company.counts.devices}</span></td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => openEdit(company)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === company.id}
                          onClick={() => handleDelete(company)}
                        >
                          {deletingId === company.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default Companies;
