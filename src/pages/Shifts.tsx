import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Clock, Trash2, Edit2 } from "lucide-react";
import { motion } from "framer-motion";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_ABBR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

type Shift = {
  id: string;
  guard_id: string;
  company_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_recurring: boolean;
  specific_date: string | null;
  notes: string | null;
  created_at: string;
  guards?: { full_name: string; badge_number: string } | null;
};

const defaultForm = {
  guard_id: "",
  day_of_week: 1,
  start_time: "08:00",
  end_time: "16:00",
  is_recurring: true,
  specific_date: "",
  notes: "",
};

const Shifts = () => {
  const { user } = useAuth();
  const { role } = useUserRole();
  const queryClient = useQueryClient();
  const canManage = role === "admin" || role === "supervisor";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null>(null);
  const [form, setForm] = useState(defaultForm);
  const [selectedDay, setSelectedDay] = useState<number | null>(null);

  const { data: shifts = [], isLoading } = useQuery({
    queryKey: ["shifts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shifts")
        .select("*, guards(full_name, badge_number)")
        .order("day_of_week")
        .order("start_time");
      if (error) throw error;
      return data as Shift[];
    },
    enabled: !!user,
  });

  const { data: guards = [] } = useQuery({
    queryKey: ["guards"],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("id, full_name, badge_number").eq("is_active", true).order("full_name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const getCompanyId = async () => {
    const { data } = await supabase.from("profiles").select("company_id").eq("id", user!.id).single();
    return data?.company_id;
  };

  const saveMutation = useMutation({
    mutationFn: async (values: typeof form) => {
      const company_id = await getCompanyId();
      if (!company_id) throw new Error("No company");
      const payload = {
        guard_id: values.guard_id,
        company_id,
        day_of_week: values.day_of_week,
        start_time: values.start_time,
        end_time: values.end_time,
        is_recurring: values.is_recurring,
        specific_date: values.specific_date || null,
        notes: values.notes || null,
      };
      if (editingShift) {
        const { error } = await supabase.from("shifts").update(payload).eq("id", editingShift.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("shifts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast.success(editingShift ? "Shift updated" : "Shift created");
      resetForm();
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shifts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["shifts"] });
      toast.success("Shift deleted");
    },
    onError: (e) => toast.error(e.message),
  });

  const resetForm = () => {
    setForm(defaultForm);
    setEditingShift(null);
    setDialogOpen(false);
  };

  const openEdit = (shift: Shift) => {
    setEditingShift(shift);
    setForm({
      guard_id: shift.guard_id,
      day_of_week: shift.day_of_week,
      start_time: shift.start_time.slice(0, 5),
      end_time: shift.end_time.slice(0, 5),
      is_recurring: shift.is_recurring,
      specific_date: shift.specific_date || "",
      notes: shift.notes || "",
    });
    setDialogOpen(true);
  };

  const filteredShifts = selectedDay !== null ? shifts.filter((s) => s.day_of_week === selectedDay) : shifts;

  // Group shifts by day
  const shiftsByDay: Record<number, Shift[]> = {};
  for (let d = 0; d < 7; d++) shiftsByDay[d] = [];
  filteredShifts.forEach((s) => shiftsByDay[s.day_of_week]?.push(s));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">Shift Scheduling</h2>
          <p className="text-sm text-muted-foreground">Manage guard shifts and recurring weekly patterns</p>
        </div>
        {canManage && (
          <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetForm(); setDialogOpen(o); }}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" /> New Shift
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>{editingShift ? "Edit Shift" : "Create Shift"}</DialogTitle>
              </DialogHeader>
              <form
                onSubmit={(e) => { e.preventDefault(); saveMutation.mutate(form); }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label>Guard</Label>
                  <Select value={form.guard_id} onValueChange={(v) => setForm({ ...form, guard_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Select guard" /></SelectTrigger>
                    <SelectContent>
                      {guards.map((g) => (
                        <SelectItem key={g.id} value={g.id}>{g.full_name} ({g.badge_number})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Day of Week</Label>
                  <Select value={String(form.day_of_week)} onValueChange={(v) => setForm({ ...form, day_of_week: Number(v) })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {DAYS.map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Start Time</Label>
                    <Input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>End Time</Label>
                    <Input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Switch checked={form.is_recurring} onCheckedChange={(v) => setForm({ ...form, is_recurring: v })} />
                  <Label>Recurring weekly</Label>
                </div>
                {!form.is_recurring && (
                  <div className="space-y-2">
                    <Label>Specific Date</Label>
                    <Input type="date" value={form.specific_date} onChange={(e) => setForm({ ...form, specific_date: e.target.value })} />
                  </div>
                )}
                <div className="space-y-2">
                  <Label>Notes (optional)</Label>
                  <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Shift notes..." rows={2} />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={resetForm}>Cancel</Button>
                  <Button type="submit" disabled={!form.guard_id || saveMutation.isPending}>
                    {saveMutation.isPending ? "Saving..." : editingShift ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* Day filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        <Button
          size="sm"
          variant={selectedDay === null ? "default" : "outline"}
          onClick={() => setSelectedDay(null)}
          className="shrink-0"
        >
          All
        </Button>
        {DAYS.map((d, i) => (
          <Button
            key={i}
            size="sm"
            variant={selectedDay === i ? "default" : "outline"}
            onClick={() => setSelectedDay(i)}
            className="shrink-0"
          >
            <span className="hidden sm:inline">{d}</span>
            <span className="sm:hidden">{DAY_ABBR[i]}</span>
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="glass-card animate-pulse p-5 h-32" />
          ))}
        </div>
      ) : filteredShifts.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center py-16 text-center">
          <Clock className="mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-muted-foreground">No shifts scheduled{selectedDay !== null ? ` for ${DAYS[selectedDay]}` : ""}</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(selectedDay !== null ? [selectedDay] : [0, 1, 2, 3, 4, 5, 6])
            .filter((d) => shiftsByDay[d].length > 0)
            .map((day) => (
              <div key={day}>
                <h3 className="mb-3 font-heading text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                  {DAYS[day]}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {shiftsByDay[day].map((shift, idx) => (
                    <motion.div
                      key={shift.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.05 }}
                      className="glass-card group relative p-4"
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <p className="font-heading text-sm font-semibold text-foreground">
                          {shift.guards?.full_name || "Unassigned"}
                        </p>
                        {canManage && (
                          <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button onClick={() => openEdit(shift)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => deleteMutation.mutate(shift.id)} className="rounded p-1 text-muted-foreground hover:bg-destructive/20 hover:text-destructive">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Clock className="h-3.5 w-3.5" />
                        <span>{shift.start_time.slice(0, 5)} – {shift.end_time.slice(0, 5)}</span>
                      </div>
                      {shift.guards?.badge_number && (
                        <p className="mt-1 text-xs text-muted-foreground">Badge: {shift.guards.badge_number}</p>
                      )}
                      <div className="mt-2 flex items-center gap-2">
                        <Badge variant={shift.is_recurring ? "default" : "secondary"} className="text-[10px]">
                          {shift.is_recurring ? "Recurring" : shift.specific_date || "One-time"}
                        </Badge>
                      </div>
                      {shift.notes && (
                        <p className="mt-2 text-xs text-muted-foreground/70 line-clamp-2">{shift.notes}</p>
                      )}
                    </motion.div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
};

export default Shifts;
