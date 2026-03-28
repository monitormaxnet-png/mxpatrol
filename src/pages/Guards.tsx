import { useState } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { User, Star, Shield, MapPin, Plus, Loader2 } from "lucide-react";
import { useGuards } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

const statusColors: Record<string, string> = {
  active: "bg-success text-success-foreground",
  inactive: "bg-muted text-muted-foreground",
};

const Guards = () => {
  const { data: guards = [], isLoading } = useGuards();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ full_name: "", badge_number: "", phone: "" });

  const handleCreate = async () => {
    if (!form.full_name || !form.badge_number) {
      toast.error("Name and badge number are required");
      return;
    }

    setSaving(true);
    // Get user's company_id
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_id")
      .single();

    if (!profile?.company_id) {
      toast.error("No company associated with your account");
      setSaving(false);
      return;
    }

    const { error } = await supabase.from("guards").insert({
      company_id: profile.company_id,
      full_name: form.full_name,
      badge_number: form.badge_number,
      phone: form.phone || null,
    });

    setSaving(false);
    if (error) {
      toast.error("Failed to add guard: " + error.message);
    } else {
      toast.success("Guard added successfully");
      setForm({ full_name: "", badge_number: "", phone: "" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ["guards"] });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Guard Management</h2>
          <p className="text-sm text-muted-foreground">Track performance and real-time status of all guards</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <button className="flex h-9 w-fit items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90">
              <Plus className="h-4 w-4" />
              Add Guard
            </button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Guard</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div>
                <Label>Full Name</Label>
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} placeholder="John Doe" />
              </div>
              <div>
                <Label>Badge Number</Label>
                <Input value={form.badge_number} onChange={(e) => setForm({ ...form, badge_number: e.target.value })} placeholder="G-XX" />
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+1-555-0100" />
              </div>
              <Button onClick={handleCreate} disabled={saving} className="w-full">
                {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Add Guard
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {guards.map((guard, i) => (
          <motion.div
            key={guard.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.05 }}
            className="glass-card p-5"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
                  <User className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="font-heading text-sm font-semibold text-foreground">{guard.full_name}</p>
                  <p className="text-xs text-muted-foreground">{guard.badge_number}</p>
                </div>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${guard.is_active ? statusColors.active : statusColors.inactive}`}>
                {guard.is_active ? "Active" : "Inactive"}
              </span>
            </div>

            {guard.phone && (
              <div className="mt-3 text-xs text-muted-foreground">
                Phone: <span className="text-foreground">{guard.phone}</span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-4">
              <div className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 text-warning" />
                <span className="font-heading text-sm font-bold text-foreground">{guard.performance_score ?? 0}</span>
                <span className="text-[10px] text-muted-foreground">score</span>
              </div>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Guards;
