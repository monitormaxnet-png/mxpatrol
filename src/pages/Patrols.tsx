import { useState } from "react";
import { motion } from "framer-motion";
import { MapPin, Clock, CheckCircle2, Play, Loader2, Plus, Square, XCircle, ShieldCheck } from "lucide-react";
import { usePatrols, useGuards } from "@/hooks/useDashboardData";
import { useUserRole } from "@/hooks/useUserRole";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDistanceToNow } from "date-fns";

const statusConfig: Record<string, { color: string; bg: string; label: string }> = {
  in_progress: { color: "text-success", bg: "bg-success/10", label: "Active" },
  missed: { color: "text-destructive", bg: "bg-destructive/10", label: "Missed" },
  completed: { color: "text-primary", bg: "bg-primary/10", label: "Completed" },
  scheduled: { color: "text-muted-foreground", bg: "bg-muted", label: "Scheduled" },
};

const Patrols = () => {
  const { data: patrols = [], isLoading } = usePatrols();
  const { data: guards = [] } = useGuards();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const updatePatrolStatus = async (id: string, status: string, extra: Record<string, unknown> = {}) => {
    setActionLoading(id);
    const { error } = await supabase.from("patrols").update({ status, ...extra } as any).eq("id", id);
    setActionLoading(null);
    if (error) toast.error("Failed: " + error.message);
    else {
      toast.success(`Patrol ${status.replace("_", " ")}`);
      queryClient.invalidateQueries({ queryKey: ["patrols"] });
    }
  };
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", guard_id: "", duration: "480", verification_level: "standard" });

  const handleCreate = async () => {
    if (!form.name) { toast.error("Patrol name is required"); return; }
    setSaving(true);

    const { data: profile } = await supabase.from("profiles").select("company_id").single();
    if (!profile?.company_id) { toast.error("No company associated"); setSaving(false); return; }

    const { error } = await supabase.from("patrols").insert({
      company_id: profile.company_id,
      name: form.name,
      description: form.description || null,
      guard_id: form.guard_id || null,
      expected_duration_minutes: parseInt(form.duration) || 480,
      status: "scheduled",
      verification_level: form.verification_level,
    });

    setSaving(false);
    if (error) { toast.error("Failed to create patrol: " + error.message); }
    else {
      toast.success("Patrol created");
      setForm({ name: "", description: "", guard_id: "", duration: "480", verification_level: "standard" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["patrols"] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Patrol Management</h2>
          <p className="text-sm text-muted-foreground">Monitor and manage all active patrol routes</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="flex h-9 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              New Patrol
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Patrol</DialogTitle></DialogHeader>
            <div className="space-y-4 pt-2">
              <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Building A — Night Shift" /></div>
              <div><Label>Description (optional)</Label><Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div>
                <Label>Assign Guard</Label>
                <Select value={form.guard_id} onValueChange={(v) => setForm({ ...form, guard_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Select guard" /></SelectTrigger>
                  <SelectContent>
                    {guards.filter(g => g.is_active).map(g => (
                      <SelectItem key={g.id} value={g.id}>{g.full_name} ({g.badge_number})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div><Label>Duration (minutes)</Label><Input type="number" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} /></div>
              <div>
                <Label>Verification Level</Label>
                <Select value={form.verification_level} onValueChange={(v) => setForm({ ...form, verification_level: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard (NFC + GPS)</SelectItem>
                    <SelectItem value="enhanced">Enhanced (NFC + GPS + Face ID)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-[10px] text-muted-foreground mt-1">Enhanced requires guards to verify identity via facial recognition</p>
              </div>
              <Button onClick={handleCreate} disabled={saving} className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Create Patrol
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && <div className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>}

      <div className="space-y-3">
        {patrols.map((patrol, i) => {
          const status = statusConfig[patrol.status] || statusConfig.scheduled;
          return (
            <motion.div key={patrol.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }} className="glass-card p-4 lg:p-5">
              <div className="flex items-center gap-3 lg:gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 lg:h-10 lg:w-10">
                  <MapPin className="h-4 w-4 text-primary lg:h-5 lg:w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-heading text-sm font-semibold text-foreground">{patrol.name}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.bg} ${status.color}`}>{status.label}</span>
                    {(patrol as any).verification_level === "enhanced" && (
                      <span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
                        <ShieldCheck className="h-2.5 w-2.5" />Face ID
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {patrol.guards?.full_name ? `Guard: ${patrol.guards.full_name}` : "Unassigned"} · {formatDistanceToNow(new Date(patrol.updated_at), { addSuffix: true })}
                  </p>
                </div>
              </div>
              {patrol.description && (
                <p className="mt-2 pl-12 text-xs text-muted-foreground lg:pl-14">{patrol.description}</p>
              )}
              <div className="mt-3 flex flex-wrap items-center gap-4 pl-12 lg:pl-14">
                {patrol.expected_duration_minutes && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />{patrol.expected_duration_minutes} min
                  </div>
                )}
                {patrol.started_at && (
                  <div className="text-xs text-muted-foreground">
                    Started {formatDistanceToNow(new Date(patrol.started_at), { addSuffix: true })}
                  </div>
                )}
                {canManage && (
                  <div className="flex items-center gap-2 ml-auto">
                    {patrol.status === "scheduled" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={actionLoading === patrol.id} onClick={() => updatePatrolStatus(patrol.id, "in_progress", { started_at: new Date().toISOString() })}>
                        {actionLoading === patrol.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Start
                      </Button>
                    )}
                    {patrol.status === "in_progress" && (
                      <Button size="sm" variant="outline" className="h-7 text-xs gap-1" disabled={actionLoading === patrol.id} onClick={() => updatePatrolStatus(patrol.id, "completed", { completed_at: new Date().toISOString() })}>
                        {actionLoading === patrol.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />} Complete
                      </Button>
                    )}
                    {(patrol.status === "scheduled" || patrol.status === "in_progress") && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs gap-1 text-destructive hover:text-destructive" disabled={actionLoading === patrol.id} onClick={() => updatePatrolStatus(patrol.id, "missed")}>
                        <XCircle className="h-3 w-3" /> Miss
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Patrols;
