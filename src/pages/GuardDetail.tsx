import { useParams, Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";
import { motion } from "framer-motion";
import { ArrowLeft, User, Star, Scan, MapPin, Clock, Loader2, CheckCircle2, AlertTriangle, Power } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useState } from "react";
import { formatDistanceToNow, format } from "date-fns";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const GuardDetail = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { canManage } = useUserRole();
  const queryClient = useQueryClient();
  const [toggling, setToggling] = useState(false);

  const toggleActive = async () => {
    if (!guard) return;
    setToggling(true);
    const { error } = await supabase.from("guards").update({ is_active: !guard.is_active }).eq("id", guard.id);
    setToggling(false);
    if (error) toast.error("Failed: " + error.message);
    else {
      toast.success(guard.is_active ? "Guard deactivated" : "Guard activated");
      queryClient.invalidateQueries({ queryKey: ["guard", id] });
      queryClient.invalidateQueries({ queryKey: ["guards"] });
    }
  };

  const { data: guard, isLoading: loadingGuard } = useQuery({
    queryKey: ["guard", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("guards").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  const { data: scans = [] } = useQuery({
    queryKey: ["guard_scans", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("scan_logs")
        .select("*, checkpoints(name)")
        .eq("guard_id", id!)
        .order("scanned_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  const { data: patrols = [] } = useQuery({
    queryKey: ["guard_patrols", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("patrols")
        .select("*")
        .eq("guard_id", id!)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  const { data: scores = [] } = useQuery({
    queryKey: ["guard_scores", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guard_scores")
        .select("*")
        .eq("guard_id", id!)
        .order("period_start", { ascending: true })
        .limit(12);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!id,
  });

  if (loadingGuard) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!guard) {
    return (
      <div className="space-y-4">
        <Link to="/guards" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> Back to Guards
        </Link>
        <p className="text-muted-foreground">Guard not found</p>
      </div>
    );
  }

  const chartData = scores.map((s) => ({
    period: format(new Date(s.period_start), "MMM d"),
    overall: Number(s.overall_score) || 0,
    completion: Number(s.completion_score) || 0,
    punctuality: Number(s.punctuality_score) || 0,
  }));

  const completedPatrols = patrols.filter((p) => p.status === "completed").length;
  const totalPatrols = patrols.length;

  const statusConfig: Record<string, { color: string; label: string }> = {
    scheduled: { color: "text-muted-foreground", label: "Scheduled" },
    in_progress: { color: "text-success", label: "Active" },
    completed: { color: "text-primary", label: "Completed" },
    missed: { color: "text-destructive", label: "Missed" },
  };

  return (
    <div className="space-y-6">
      <Link to="/guards" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to Guards
      </Link>

      {/* Header */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass-card p-5 lg:p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
            <User className="h-7 w-7 text-primary" />
          </div>
          <div className="flex-1">
            <h2 className="font-heading text-xl font-bold text-foreground">{guard.full_name}</h2>
            <p className="text-sm text-muted-foreground">Badge: {guard.badge_number} · {guard.phone || "No phone"}</p>
          </div>
          <div className="text-right">
            <div className="flex items-center gap-1">
              <Star className="h-5 w-5 text-warning" />
              <span className="font-heading text-2xl font-bold text-foreground">{guard.performance_score ?? 0}</span>
            </div>
            <p className="text-xs text-muted-foreground">Performance</p>
          </div>
        </div>

        {/* Quick stats */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="font-heading text-lg font-bold text-foreground">{totalPatrols}</p>
            <p className="text-[10px] text-muted-foreground">Patrols</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="font-heading text-lg font-bold text-foreground">{completedPatrols}</p>
            <p className="text-[10px] text-muted-foreground">Completed</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="font-heading text-lg font-bold text-foreground">{scans.length}</p>
            <p className="text-[10px] text-muted-foreground">Scans</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className={`font-heading text-lg font-bold ${guard.is_active ? "text-success" : "text-muted-foreground"}`}>
              {guard.is_active ? "Active" : "Inactive"}
            </p>
            <p className="text-[10px] text-muted-foreground">Status</p>
          </div>
        </div>
      </motion.div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Performance Chart */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-4">Performance History</h3>
          {chartData.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No performance data yet</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="period" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                />
                <Bar dataKey="overall" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} name="Overall" />
                <Bar dataKey="completion" fill="hsl(var(--success))" radius={[4, 4, 0, 0]} name="Completion" />
                <Bar dataKey="punctuality" fill="hsl(var(--warning))" radius={[4, 4, 0, 0]} name="Punctuality" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </motion.div>

        {/* Patrol Timeline */}
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }} className="glass-card p-5">
          <h3 className="font-heading text-sm font-semibold text-foreground mb-4">Patrol Timeline</h3>
          <div className="max-h-[260px] overflow-auto space-y-2">
            {patrols.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No patrols assigned</p>}
            {patrols.map((patrol) => {
              const status = statusConfig[patrol.status] || statusConfig.scheduled;
              return (
                <div key={patrol.id} className="flex items-center gap-3 rounded-lg border border-border/30 p-3">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{patrol.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(patrol.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium ${status.color}`}>{status.label}</span>
                </div>
              );
            })}
          </div>
        </motion.div>
      </div>

      {/* Scan History */}
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }} className="glass-card p-5">
        <h3 className="font-heading text-sm font-semibold text-foreground mb-4">NFC Scan Log</h3>
        <div className="max-h-[300px] overflow-auto divide-y divide-border/30">
          {scans.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">No scans recorded</p>}
          {scans.map((scan) => (
            <div key={scan.id} className="flex items-center gap-3 py-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Scan className="h-3.5 w-3.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{scan.checkpoints?.name || "Unknown checkpoint"}</p>
                <p className="text-xs text-muted-foreground">
                  {format(new Date(scan.scanned_at), "MMM d, yyyy HH:mm:ss")}
                </p>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {formatDistanceToNow(new Date(scan.scanned_at), { addSuffix: true })}
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
};

export default GuardDetail;
