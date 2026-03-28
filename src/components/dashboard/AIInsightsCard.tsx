import { motion } from "framer-motion";
import { Brain, TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";
import { useAIInsights } from "@/hooks/useDashboardData";

const AIInsightsCard = () => {
  const { data: insights = [], isLoading } = useAIInsights();

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-card glow-primary"
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
        <Brain className="h-4 w-4 text-primary" />
        <h3 className="font-heading text-sm font-semibold text-foreground">AI Insights</h3>
        <span className="ml-auto rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">Live</span>
      </div>
      <div className="divide-y divide-border/30">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {!isLoading && insights.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No AI insights yet — they'll appear after patrol data is analyzed
          </div>
        )}
        {insights.map((item, i) => {
          const data = item.data as Record<string, unknown> | null;
          const score = (data?.score as number) ?? 0;
          const trend = (data?.trend as string) ?? "stable";

          return (
            <div key={item.id} className="flex items-center gap-3 px-5 py-3">
              <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                trend === "up" ? "bg-destructive/10" : trend === "down" ? "bg-warning/10" : "bg-success/10"
              }`}>
                {trend === "up" ? (
                  <TrendingUp className="h-4 w-4 text-destructive" />
                ) : trend === "down" ? (
                  <TrendingDown className="h-4 w-4 text-warning" />
                ) : (
                  <Minus className="h-4 w-4 text-success" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground">{item.type}</p>
                <p className="text-xs text-muted-foreground">{item.summary || "No details"}</p>
              </div>
              {score > 0 && (
                <div className="text-right">
                  <p className={`font-heading text-lg font-bold ${
                    score >= 80 ? (trend === "up" ? "text-destructive" : "text-success") : "text-warning"
                  }`}>{score}</p>
                  <p className="text-[10px] text-muted-foreground">risk</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </motion.div>
  );
};

export default AIInsightsCard;
