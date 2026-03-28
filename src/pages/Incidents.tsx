import { useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, FileText, Clock, MapPin, ChevronRight, Plus, Loader2 } from "lucide-react";
import { useIncidents, useGuards } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const severityColors: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/20",
  high: "bg-destructive/10 text-destructive border-destructive/20",
  medium: "bg-warning/10 text-warning border-warning/20",
  low: "bg-muted text-muted-foreground border-border",
};

const Incidents = () => {
  const { data: incidents = [], isLoading } = useIncidents();
  const { data: guards = [] } = useGuards();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", severity: "medium" as string, guard_id: "" });

  const handleCreate = async () => {
    if (!form.title) { toast.error("Title is required"); return; }
    setSaving(true);

    const { data: profile } = await supabase.from("profiles").select("company_id").single();
    if (!profile?.company_id) { toast.error("No company associated"); setSaving(false); return; }

    const { error } = await supabase.from("incidents").insert({
      company_id: profile.company_id,
      title: form.title,
      description: form.description || null,
      severity: form.severity as "low" | "medium" | "high" | "critical",
      guard_id: form.guard_id || null,
    });

    setSaving(false);
    if (error) { toast.error("Failed to report incident: " + error.message); }
    else {
      toast.success("Incident reported");
      setForm({ title: "", description: "", severity: "medium", guard_id: "" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["incidents"] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Incident Reports</h2>
          <p className="text-sm text-muted-foreground">AI-analyzed security incidents with severity classification</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="flex h-9 w-fit items-center gap-2 rounded-lg bg-destructive px-4 text-sm font-medium text-destructive-foreground hover:bg-destructive/90">
              <AlertTriangle className="h-4 w-4" />
              Report Incident
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div><Label>Title</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Brief description" /></div>
              <div><Label>Description</Label><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Full details..." /></div>
              <div>
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
              <div>
                <Label>Reporting Guard</Label>
                <Select value={form.guard_id} onValueChange={(v) => setForm({ ...form, guard_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select guard" /></SelectTrigger>
                  <SelectContent>
                    {guards.map(g => <SelectItem key={g.id} value={g.id}>{g.full_name}</SelectItem>)}
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

      {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      <div className="space-y-3">
        {incidents.map((incident, i) => (
          <motion.div key={incident.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass-card p-4 lg:p-5">
            <div className="flex items-start gap-4">
              <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border ${severityColors[incident.severity]}`}>
                <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-sm font-semibold text-foreground">{incident.title}</p>
                  <span className={`text-[10px] font-medium uppercase ${incident.resolved ? "text-success" : "text-destructive"}`}>
                    {incident.resolved ? "Resolved" : "Open"}
                  </span>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{incident.severity}</span>
                  <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatDistanceToNow(new Date(incident.created_at), { addSuffix: true })}</span>
                  {incident.guards?.full_name && <span>Guard: {incident.guards.full_name}</span>}
                </div>
                {incident.ai_classification && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-1.5">
                    <FileText className="h-3 w-3 text-primary" />
                    <span className="text-xs text-primary">AI: {incident.ai_classification} — {incident.ai_suggested_action}</span>
                  </div>
                )}
              </div>
              <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Incidents;
