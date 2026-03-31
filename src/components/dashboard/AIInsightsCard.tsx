import { useState } from "react";
import { motion } from "framer-motion";
import { Brain, TrendingUp, TrendingDown, Minus, Loader2, Zap, AlertTriangle, RefreshCw, WifiOff } from "lucide-react";
import { useAIInsights } from "@/hooks/useDashboardData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

type AnalysisError = {
  title: string;
  message: string;
  icon: "rate-limit" | "credits" | "network" | "generic";
  retryable: boolean;
};

function parseError(e: any): AnalysisError {
  const msg: string = e?.message || e?.error || "";

  if (msg.includes("Rate limit") || msg.includes("429"))
    return { title: "Rate limit reached", message: "Too many requests — please wait a minute and try again.", icon: "rate-limit", retryable: true };

  if (msg.includes("credits") || msg.includes("402"))
    return { title: "AI credits exhausted", message: "Your plan's AI credits have been used up. Contact your administrator.", icon: "credits", retryable: false };

  if (msg.includes("Failed to fetch") || msg.includes("NetworkError") || msg.includes("network"))
    return { title: "Connection error", message: "Unable to reach the analysis service. Check your internet connection and retry.", icon: "network", retryable: true };

  if (msg.includes("Unauthorized") || msg.includes("401"))
    return { title: "Session expired", message: "Please refresh the page or sign in again to continue.", icon: "generic", retryable: false };

  return { title: "Analysis failed", message: msg || "Something went wrong. Please try again later.", icon: "generic", retryable: true };
}

const ErrorIcon = ({ type }: { type: AnalysisError["icon"] }) => {
  switch (type) {
    case "rate-limit": return <RefreshCw className="h-5 w-5 text-warning" />;
    case "credits": return <AlertTriangle className="h-5 w-5 text-destructive" />;
    case "network": return <WifiOff className="h-5 w-5 text-muted-foreground" />;
    default: return <AlertTriangle className="h-5 w-5 text-destructive" />;
  }
};

const AIInsightsCard = () => {
  const { data: insights = [], isLoading, isError: fetchError, refetch } = useAIInsights();
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<AnalysisError | null>(null);
  const queryClient = useQueryClient();

  const runAnalysis = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("patrol-analysis");
      if (fnError) throw fnError;
      if (data?.error) throw new Error(data.error);
      toast.success(`AI generated ${data?.insights?.length || 0} new insights`);
      queryClient.invalidateQueries({ queryKey: ["ai_insights"] });
    } catch (e: any) {
      const parsed = parseError(e);
      setError(parsed);
      toast.error(parsed.title);
    } finally {
      setAnalyzing(false);
    }
  };

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
        <button
          onClick={runAnalysis}
          disabled={analyzing}
          className="ml-2 flex h-7 items-center gap-1.5 rounded-md bg-primary px-3 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
        >
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
          {analyzing ? "Analyzing…" : "Analyze"}
        </button>
      </div>

      <div className="divide-y divide-border/30">
        {/* Analysis error state */}
        {error && (
          <div className="px-5 py-5">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-4">
              <ErrorIcon type={error.icon} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground">{error.title}</p>
                <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{error.message}</p>
                {error.retryable && (
                  <button
                    onClick={() => { setError(null); runAnalysis(); }}
                    disabled={analyzing}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Try again
                  </button>
                )}
              </div>
              <button
                onClick={() => setError(null)}
                className="text-muted-foreground hover:text-foreground text-xs"
                aria-label="Dismiss error"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* Fetch error state */}
        {fetchError && !error && (
          <div className="px-5 py-6 text-center">
            <WifiOff className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
            <p className="text-sm font-medium text-foreground">Couldn't load insights</p>
            <p className="mt-1 text-xs text-muted-foreground">Check your connection and try again.</p>
            <button
              onClick={() => refetch()}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-medium text-foreground transition-colors hover:bg-accent"
            >
              <RefreshCw className="h-3 w-3" />
              Reload
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {/* Empty state */}
        {!isLoading && !fetchError && insights.length === 0 && !error && (
          <div className="px-5 py-8 text-center text-sm text-muted-foreground">
            No AI insights yet — click <strong>Analyze</strong> to generate them
          </div>
        )}

        {/* Insights list */}
        {insights.map((item) => {
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
