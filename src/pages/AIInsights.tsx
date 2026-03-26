import { motion } from "framer-motion";
import { Brain, TrendingUp, Shield, Users, Target, Zap, BarChart3 } from "lucide-react";

const riskZones = [
  { zone: "Zone C — Parking Lot", risk: 87, trend: "rising", detail: "3 missed checkpoints, 2 incidents" },
  { zone: "Zone A — Main Gate", risk: 42, trend: "stable", detail: "Normal patrol activity" },
  { zone: "Zone B — Perimeter", risk: 65, trend: "declining", detail: "1 delayed patrol, coverage improving" },
  { zone: "Building A", risk: 15, trend: "stable", detail: "Optimal coverage maintained" },
];

const guardRankings = [
  { rank: 1, name: "Sam Wilson", score: 96, trend: "+2" },
  { rank: 2, name: "John Doe", score: 94, trend: "+1" },
  { rank: 3, name: "Nina Patel", score: 91, trend: "0" },
  { rank: 4, name: "Maria Santos", score: 88, trend: "-1" },
  { rank: 5, name: "Chris Lee", score: 85, trend: "+3" },
];

const predictions = [
  { label: "Missed checkpoint probability (next 4h)", value: "23%", icon: Target },
  { label: "Predicted high-risk window", value: "02:00–04:00", icon: Zap },
  { label: "Recommended additional coverage", value: "Zone C", icon: Shield },
];

const AIInsights = () => {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 glow-primary">
          <Brain className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h2 className="font-heading text-2xl font-bold text-foreground">AI Intelligence</h2>
          <p className="text-sm text-muted-foreground">Predictive analytics, risk assessment, and performance insights</p>
        </div>
      </div>

      {/* Predictions */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {predictions.map((pred, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            className="glass-card glow-primary p-5"
          >
            <pred.icon className="h-5 w-5 text-primary" />
            <p className="mt-3 font-heading text-2xl font-bold text-foreground">{pred.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{pred.label}</p>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Risk Heatmap */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Risk Assessment</h3>
          </div>
          <div className="divide-y divide-border/30">
            {riskZones.map((zone, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className="flex items-center gap-4 px-5 py-4"
              >
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">{zone.zone}</p>
                  <p className="text-xs text-muted-foreground">{zone.detail}</p>
                </div>
                <div className="w-24">
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full ${
                        zone.risk >= 70 ? "bg-destructive" : zone.risk >= 40 ? "bg-warning" : "bg-success"
                      }`}
                      style={{ width: `${zone.risk}%` }}
                    />
                  </div>
                </div>
                <span className={`font-heading text-lg font-bold ${
                  zone.risk >= 70 ? "text-destructive" : zone.risk >= 40 ? "text-warning" : "text-success"
                }`}>{zone.risk}</span>
              </motion.div>
            ))}
          </div>
        </div>

        {/* Guard Rankings */}
        <div className="glass-card">
          <div className="flex items-center gap-2 border-b border-border/50 px-5 py-4">
            <BarChart3 className="h-4 w-4 text-primary" />
            <h3 className="font-heading text-sm font-semibold text-foreground">Guard Performance Rankings</h3>
          </div>
          <div className="divide-y divide-border/30">
            {guardRankings.map((guard, i) => (
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
                </div>
                <span className={`text-xs ${
                  guard.trend.startsWith("+") ? "text-success" : guard.trend.startsWith("-") ? "text-destructive" : "text-muted-foreground"
                }`}>{guard.trend}</span>
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
