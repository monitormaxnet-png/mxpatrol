import { motion } from "framer-motion";
import { Brain, TrendingUp, TrendingDown, Minus } from "lucide-react";

const insights = [
  { label: "Zone C risk elevated", trend: "up", score: 87, detail: "3 missed checkpoints in last 24h" },
  { label: "Guard #12 performance drop", trend: "down", score: 62, detail: "Completion rate down 18% this week" },
  { label: "Building A coverage optimal", trend: "stable", score: 95, detail: "All checkpoints hit on schedule" },
];

const AIInsightsCard = () => {
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
        {insights.map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3">
            <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${
              item.trend === "up" ? "bg-destructive/10" : item.trend === "down" ? "bg-warning/10" : "bg-success/10"
            }`}>
              {item.trend === "up" ? (
                <TrendingUp className="h-4 w-4 text-destructive" />
              ) : item.trend === "down" ? (
                <TrendingDown className="h-4 w-4 text-warning" />
              ) : (
                <Minus className="h-4 w-4 text-success" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.detail}</p>
            </div>
            <div className="text-right">
              <p className={`font-heading text-lg font-bold ${
                item.score >= 80 ? (item.trend === "up" ? "text-destructive" : "text-success") : "text-warning"
              }`}>{item.score}</p>
              <p className="text-[10px] text-muted-foreground">risk</p>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
};

export default AIInsightsCard;
