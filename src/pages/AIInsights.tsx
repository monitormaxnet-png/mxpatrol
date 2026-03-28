import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, TrendingUp, TrendingDown, Minus, Shield, Target, Zap, BarChart3, Loader2, Filter } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import type { Tables } from "@/integrations/supabase/types";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "hsl(var(--destructive))",
  high: "hsl(var(--warning))",
  medium: "hsl(346 77% 50%)",
  low: "hsl(var(--success))",
};

const AIInsights = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [analyzing, setAnalyzing] = useState(false);
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const { data: insights = [], isLoading } = useQuery({
    queryKey: ["ai_insights_full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_insights")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as Tables<"ai_insights">[];
    },
    enabled: !!user,
  });

  const { data: guardScores = [] } = useQuery({
    queryKey: ["guard_scores_top"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("guard_scores")
        .select("*, guards(full_name)")
        .order("overall_score", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const runAnalysis = async () => {
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("patrol-analysis");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`AI generated ${data?.insights?.length || 0} new insights`);
      queryClient.invalidateQueries({ queryKey: ["ai_insights_full"] });
      queryClient.invalidateQueries({ queryKey: ["ai_insights"] });
    } catch (e: any) {
      toast.error(e.message || "Analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  // Derive unique types for filter
  const insightTypes = ["all", ...new Set(insights.map((i) => i.type))];

  const filtered = typeFilter === "all" ? insights : insights.filter((i) => i.type === typeFilter);

  // Severity distribution for pie chart
  const severityCounts = insights.reduce<Record<string, number>>((acc, i) => {
    const sev = i.severity || "low";
    acc[sev] = (acc[sev] || 0) + 1;
    return acc;
  }, {});
  const pieData = Object.entries(severityCounts).map(([name, value]) => ({ name, value }));

  // Type distribution for bar chart
  const typeCounts = insights.reduce<Record<string, number>>((acc, i) => {
    acc[i.type] = (acc[i.type] || 0) + 1;
    return acc;
  }, {});
  const barData = Object.entries(typeCounts).map(([type, count]) => ({ type, count }));

  // Guard rankings from scores
  const rankings = guardScores.map((s: any, i: number) => ({
    rank: i + 1,
    name: s.guards?.full_name || "Unknown",
    score: Number(s.overall_score) || 0,
    completion: Number(s.completion_score) || 0,
    punctuality: Number(s.punctuality_score) || 0,
  }));

  // Summary stats
  const criticalCount = insights.filter((i) => i.severity === "critical" || i.severity === "high").length;
  const totalInsights = insights.length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 glow-primary">
            <Brain className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h2 className="font-heading text-2xl font-bold text-foreground">AI Intelligence</h2>
            <p className="text-sm text-muted-foreground">Predictive analytics, risk assessment & performance</p>
          </div>
        </div>
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          {analyzing ? "Analyzing…" : "Run Analysis"}
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          { label: "Total Insights", value: totalInsights, icon: Target, color: "text-primary" },
          { label: "High/Critical Alerts", value: criticalCount, icon: Shield, color: "text-destructive" },
          { label: "Guard Rankings", value: rankings.length, icon: BarChart3, color: "text-success" },
        ].map((stat, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card p-5"
          >
            <stat.icon className={`h-5 w-5 ${stat.color}`} />
            <p className="mt-3 font-heading text-2xl font-bold text-foreground">{stat.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{stat.label}</p>
          </motion.div>
        ))}
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Severity Pie */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <Shield className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Severity Distribution</h3>
          </div>
          <div className="p-4">
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={({ name, value }) => `${name}: ${value}`}>
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={SEVERITY_COLORS[entry.name] || "hsl(var(--muted))"} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data — run analysis first</p>
            )}
          </div>
        </div>

        {/* Type Bar */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Insights by Type</h3>
          </div>
          <div className="p-4">
            {barData.length > 0 ? (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={barData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="type" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <YAxis tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">No data — run analysis first</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Insights Feed */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Risk Insights</h3>
            <div className="ml-auto flex items-center gap-1">
              <Filter className="h-3 w-3 text-muted-foreground" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="rounded bg-muted px-2 py-1 text-xs text-foreground outline-none"
              >
                {insightTypes.map((t) => (
                  <option key={t} value={t}>{t === "all" ? "All Types" : t}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="divide-y divide-border/30 max-h-[400px] overflow-y-auto">
            {isLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}
            {!isLoading && filtered.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No insights yet — click <strong>Run Analysis</strong>
              </p>
            )}
            {filtered.map((item) => {
              const data = item.data as Record<string, unknown> | null;
              const score = (data?.score as number) ?? 0;
              const trend = (data?.trend as string) ?? "stable";

              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    trend === "up" ? "bg-destructive/10" : trend === "down" ? "bg-warning/10" : "bg-success/10"
                  }`}>
                    {trend === "up" ? <TrendingUp className="h-4 w-4 text-destructive" /> :
                     trend === "down" ? <TrendingDown className="h-4 w-4 text-warning" /> :
                     <Minus className="h-4 w-4 text-success" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.type}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.summary || "No details"}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                    item.severity === "critical" ? "bg-destructive/10 text-destructive" :
                    item.severity === "high" ? "bg-warning/10 text-warning" :
                    "bg-muted text-muted-foreground"
                  }`}>{item.severity}</span>
                  {score > 0 && (
                    <span className="font-heading text-lg font-bold text-primary">{score}</span>
                  )}
                </motion.div>
              );
            })}
          </div>
        </div>

        {/* Guard Rankings */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Guard Performance Rankings</h3>
          </div>
          <div className="divide-y divide-border/30">
            {rankings.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No performance data available</p>
            )}
            {rankings.map((guard, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 px-5 py-3"
              >
                <span className={`flex h-7 w-7 items-center justify-center rounded-full font-heading text-sm font-bold ${
                  i === 0 ? "bg-warning/20 text-warning" : i === 1 ? "bg-muted text-muted-foreground" : "bg-muted/50 text-muted-foreground"
                }`}>
                  {guard.rank}
                </span>
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{guard.name}</p>
                  <p className="text-xs text-muted-foreground">
                    Completion: {guard.completion} · Punctuality: {guard.punctuality}
                  </p>
                </div>
                <span className="font-heading text-lg font-bold text-primary">{guard.score}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default AIInsights;
