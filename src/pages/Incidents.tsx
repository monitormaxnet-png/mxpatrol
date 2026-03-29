import { useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle, FileText, Clock, ChevronRight, Loader2, CheckCircle2,
  Filter, Search, X,
} from "lucide-react";
import { useIncidents, useGuards } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useUserRole } from "@/hooks/useUserRole";

const severityColors: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  low: "bg-muted text-muted-foreground border-border",
};

const severityBadge: Record<string, string> = {
  critical: "bg-destructive text-destructive-foreground",
  high: "bg-destructive/80 text-destructive-foreground",
  medium: "bg-warning text-warning-foreground",
  low: "bg-muted text-muted-foreground",
};

type IncidentRow = ReturnType<typeof useIncidents>["data"] extends (infer T)[] | undefined ? T : never;

const Incidents = () => {
  const { data: incidents = [], isLoading } = useIncidents();
  const { data: guards = [] } = useGuards();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selected, setSelected] = useState<IncidentRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);

  // Filters
  const [filterSeverity, setFilterSeverity] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [form, setForm] = useState({ title: "", description: "", severity: "medium", guard_id: "" });

  const filtered = incidents.filter((inc: any) => {
    if (filterSeverity !== "all" && inc.severity !== filterSeverity) return false;
    if (filterStatus === "open" && inc.resolved) return false;
    if (filterStatus === "resolved" && !inc.resolved) return false;
    if (searchQuery && !inc.title.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: incidents.length,
    open: incidents.filter((i: any) => !i.resolved).length,
    critical: incidents.filter((i: any) => i.severity === "critical" && !i.resolved).length,
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setSaving(true);
    const { data: profile } = await supabase.from("profiles").select("company_id").single();
    if (!profile?.company_id) { toast.error("No company associated"); setSaving(false); return; }

    const { error } = await supabase.from("incidents").insert({
      company_id: profile.company_id,
      title: form.title.trim(),
      description: form.description.trim() || null,
      severity: form.severity as "low" | "medium" | "high" | "critical",
      guard_id: form.guard_id || null,
    });

    setSaving(false);
    if (error) { toast.error("Failed: " + error.message); }
    else {
      toast.success("Incident reported");
      setForm({ title: "", description: "", severity: "medium", guard_id: "" });
      setCreateOpen(false);
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    }
  };

  const handleResolve = async (id: string) => {
    setResolving(true);
    const { error } = await supabase.from("incidents").update({ resolved: true, resolved_at: new Date().toISOString() }).eq("id", id);
    setResolving(false);
    if (error) { toast.error("Failed to resolve"); }
    else {
      toast.success("Incident resolved");
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    }
  };

  const handleReopen = async (id: string) => {
    setResolving(true);
    const { error } = await supabase.from("incidents").update({ resolved: false, resolved_at: null }).eq("id", id);
    setResolving(false);
    if (error) { toast.error("Failed to reopen"); }
    else {
      toast.success("Incident reopened");
      setDetailOpen(false);
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Incident Reports</h2>
          <p className="text-sm text-muted-foreground">
            {stats.open} open · {stats.critical > 0 && <span className="text-destructive font-medium">{stats.critical} critical · </span>}{stats.total} total
          </p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button variant="destructive" size="sm" className="w-fit">
              <AlertTriangle className="mr-2 h-4 w-4" />Report Incident
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Brief description" maxLength={200} />
              </div>
              <div className="space-y-1.5">
                <Label>Description</Label>
                <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Full details..." rows={3} maxLength={2000} />
              </div>
              <div className="space-y-1.5">
                <Label>Severity</Label>
                <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="critical">Critical</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reporting Guard</Label>
                <Select value={form.guard_id} onValueChange={(v) => setForm({ ...form, guard_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select guard" /></SelectTrigger>
                  <SelectContent>
                    {guards.map((g) => <SelectItem key={g.id} value={g.id}>{g.full_name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <Button onClick={handleCreate} disabled={saving} variant="destructive" className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Report Incident
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search incidents..."
            className="pl-9 h-9"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <Select value={filterSeverity} onValueChange={setFilterSeverity}>
          <SelectTrigger className="h-9 w-[130px]">
            <Filter className="mr-1 h-3 w-3" /><SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severity</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="low">Low</SelectItem>
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {/* Empty */}
      {!isLoading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <AlertTriangle className="mb-3 h-10 w-10 opacity-20" />
          <p className="text-sm">{incidents.length === 0 ? "No incidents reported yet" : "No incidents match filters"}</p>
        </div>
      )}

      {/* List */}
      <div className="space-y-3">
        {filtered.map((incident: any, i: number) => (
          <motion.div
            key={incident.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
            className="glass-card cursor-pointer p-4 transition-colors hover:bg-muted/30"
            onClick={() => { setSelected(incident); setDetailOpen(true); }}
          >
            <div className="flex items-start gap-3">
              <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${severityColors[incident.severity]}`}>
                {incident.resolved ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-sm font-semibold text-foreground truncate">{incident.title}</p>
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${severityBadge[incident.severity]}`}>
                    {incident.severity}
                  </Badge>
                  <span className={`text-[10px] font-medium ${incident.resolved ? "text-success" : "text-destructive"}`}>
                    {incident.resolved ? "Resolved" : "Open"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {formatDistanceToNow(new Date(incident.created_at), { addSuffix: true })}
                  </span>
                  {incident.guards?.full_name && <span>{incident.guards.full_name}</span>}
                </div>
                {incident.ai_classification && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/5 px-2.5 py-1">
                    <FileText className="h-3 w-3 text-primary" />
                    <span className="text-xs text-primary truncate">AI: {incident.ai_classification}</span>
                  </div>
                )}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </div>
          </motion.div>
        ))}
      </div>

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  {(selected as any).title}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4 pt-2">
                <div className="flex flex-wrap gap-2">
                  <Badge className={severityBadge[(selected as any).severity]}>{(selected as any).severity}</Badge>
                  <Badge variant="outline">{(selected as any).resolved ? "Resolved" : "Open"}</Badge>
                </div>

                {(selected as any).description && (
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Description</Label>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{(selected as any).description}</p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Reported</p>
                    <p className="text-foreground">{format(new Date((selected as any).created_at), "PPp")}</p>
                  </div>
                  {(selected as any).resolved_at && (
                    <div>
                      <p className="text-xs text-muted-foreground">Resolved</p>
                      <p className="text-foreground">{format(new Date((selected as any).resolved_at), "PPp")}</p>
                    </div>
                  )}
                  {(selected as any).guards?.full_name && (
                    <div>
                      <p className="text-xs text-muted-foreground">Guard</p>
                      <p className="text-foreground">{(selected as any).guards.full_name} ({(selected as any).guards.badge_number})</p>
                    </div>
                  )}
                </div>

                {(selected as any).ai_classification && (
                  <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1">
                    <p className="text-xs font-medium text-primary">AI Classification</p>
                    <p className="text-sm text-foreground">{(selected as any).ai_classification}</p>
                    {(selected as any).ai_suggested_action && (
                      <>
                        <p className="text-xs font-medium text-primary mt-2">Suggested Action</p>
                        <p className="text-sm text-foreground">{(selected as any).ai_suggested_action}</p>
                      </>
                    )}
                  </div>
                )}

                {canManage && (
                  <div className="flex gap-2 pt-2">
                    {!(selected as any).resolved ? (
                      <Button onClick={() => handleResolve((selected as any).id)} disabled={resolving} className="flex-1" variant="default">
                        {resolving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        <CheckCircle2 className="mr-2 h-4 w-4" />Mark Resolved
                      </Button>
                    ) : (
                      <Button onClick={() => handleReopen((selected as any).id)} disabled={resolving} className="flex-1" variant="outline">
                        {resolving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Reopen Incident
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Incidents;
