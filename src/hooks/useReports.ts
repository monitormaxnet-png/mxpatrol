import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useCompanyId } from "@/hooks/usePatrolScanData";

export type ReportJobStatus = "scheduled" | "pending" | "running" | "completed" | "failed";

export type ReportJob = {
  id: string;
  company_id: string;
  site_id: string | null;
  report_id: string | null;
  report_type: string;
  status: ReportJobStatus;
  date_range: string;
  scheduled_for: string | null;
  started_at: string | null;
  completed_at: string | null;
  failed_at: string | null;
  error_message: string | null;
  created_by: string | null;
  filters: unknown;
  metadata: unknown;
  created_at: string;
  updated_at: string;
  sites?: { name: string } | null;
  ai_reports?: { summary_text: string | null; generated_at: string | null } | null;
};

export function useReports() {
  const { data: companyId, isLoading: companyLoading, error: companyError } = useCompanyId();
  const reportsQuery = useQuery({
    queryKey: ["ai_reports", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_reports")
        .select("*")
        .eq("company_id", companyId!)
        .order("generated_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"ai_reports">[];
    },
    enabled: !!companyId,
  });

  return {
    ...reportsQuery,
    isLoading: companyLoading || reportsQuery.isLoading,
    error: companyError ?? reportsQuery.error,
  };
}

export function useReportJobs() {
  const { data: companyId, isLoading: companyLoading, error: companyError } = useCompanyId();
  const jobsQuery = useQuery({
    queryKey: ["report_jobs", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("report_jobs")
        .select("*, sites(name), ai_reports(summary_text, generated_at)")
        .eq("company_id", companyId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as ReportJob[];
    },
    enabled: !!companyId,
  });

  return {
    ...jobsQuery,
    isLoading: companyLoading || jobsQuery.isLoading,
    error: companyError ?? jobsQuery.error,
  };
}
