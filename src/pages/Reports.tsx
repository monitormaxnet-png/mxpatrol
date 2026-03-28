import { useState } from "react";
import { motion } from "framer-motion";
import { FileText, Clock, Loader2, ChevronDown, ChevronUp, Zap, BarChart3 } from "lucide-react";
import { useReports } from "@/hooks/useReports";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, format } from "date-fns";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const reportTypeLabels: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
};

const Reports = () => {
  const { data: reports = [], isLoading } = useReports();
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState(false);
  const [reportType, setReportType] = useState("daily");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-report", {
        body: { report_type: reportType },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Report generated successfully");
      queryClient.invalidateQueries({ queryKey: ["ai_reports"] });
    } catch (e: any) {
      toast.error(e.message || "Failed to generate report");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="font-heading text-xl font-bold text-foreground lg:text-2xl">Reports</h2>
          <p className="text-sm text-muted-foreground">AI-generated patrol and security reports</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={reportType} onValueChange={setReportType}>
            <SelectTrigger className="w-[120px] h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily</SelectItem>
              <SelectItem value="weekly">Weekly</SelectItem>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {generating ? "Generating…" : "Generate Report"}
          </button>
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      )}

      {!isLoading && reports.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-muted-foreground">
          No reports yet — click <strong>Generate Report</strong> to create your first AI-powered report
        </div>
      )}

      <div className="space-y-3">
        {reports.map((report, i) => {
          const data = report.data as Record<string, unknown> | null;
          const title = (data?.title as string) || `${reportTypeLabels[report.report_type] || report.report_type} Report`;
          const sections = (data?.sections as Array<{ heading: string; content: string }>) || [];
          const recommendations = (data?.recommendations as string[]) || [];
          const stats = data?.stats as Record<string, number> | undefined;
          const isExpanded = expandedId === report.id;

          return (
            <motion.div
              key={report.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card overflow-hidden"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : report.id)}
                className="flex w-full items-center gap-4 p-4 text-left transition-colors hover:bg-muted/30 lg:p-5"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <FileText className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-heading text-sm font-semibold text-foreground">{title}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                    <span className="rounded bg-muted px-1.5 py-0.5 capitalize">{reportTypeLabels[report.report_type] || report.report_type}</span>
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {format(new Date(report.generated_at), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                </div>
                {isExpanded ? <ChevronUp className="h-5 w-5 text-muted-foreground" /> : <ChevronDown className="h-5 w-5 text-muted-foreground" />}
              </button>

              {isExpanded && (
                <div className="border-t border-border/30 px-5 py-4 space-y-4">
                  {/* Stats */}
                  {stats && (
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {[
                        { label: "Patrols", value: stats.total_patrols },
                        { label: "Completion", value: `${stats.completion_rate}%` },
                        { label: "Incidents", value: stats.total_incidents },
                        { label: "Scans", value: stats.total_scans },
                        { label: "Avg Score", value: stats.avg_guard_score },
                      ].map((s) => (
                        <div key={s.label} className="rounded-lg bg-muted/50 p-3 text-center">
                          <p className="font-heading text-lg font-bold text-foreground">{s.value}</p>
                          <p className="text-[10px] text-muted-foreground">{s.label}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Summary */}
                  {report.summary_text && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Executive Summary</h4>
                      <p className="text-sm text-foreground leading-relaxed">{report.summary_text}</p>
                    </div>
                  )}

                  {/* Sections */}
                  {sections.map((section, idx) => (
                    <div key={idx}>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">{section.heading}</h4>
                      <p className="text-sm text-foreground leading-relaxed">{section.content}</p>
                    </div>
                  ))}

                  {/* Recommendations */}
                  {recommendations.length > 0 && (
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recommendations</h4>
                      <ul className="space-y-1.5">
                        {recommendations.map((rec, idx) => (
                          <li key={idx} className="flex items-start gap-2 text-sm text-foreground">
                            <BarChart3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                            {rec}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

export default Reports;
