import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useCompanyId } from "@/hooks/usePatrolScanData";

type AnyRow = Record<string, any>;

const db = supabase as any;

export type PatrolTemplateRow = AnyRow;
export type PatrolRouteRow = AnyRow;
export type PatrolScheduleRow = AnyRow;
export type PatrolSessionRow = AnyRow;
export type PatrolSessionCheckpointRow = AnyRow;

export function usePatrolTemplates(siteId = "all") {
  const { data: companyId } = useCompanyId();
  return useQuery({
    queryKey: ["patrol_templates", companyId, siteId],
    enabled: !!companyId,
    queryFn: async () => {
      let query = db.from("patrol_templates").select("*, sites(name), patrol_routes(id, name)").eq("company_id", companyId).order("created_at", { ascending: false });
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolTemplateRow[];
    },
  });
}

export function usePatrolRoutes(siteId = "all") {
  const { data: companyId } = useCompanyId();
  return useQuery({
    queryKey: ["patrol_routes", companyId, siteId],
    enabled: !!companyId,
    queryFn: async () => {
      let query = db.from("patrol_routes").select("*, sites(name), patrol_route_checkpoints(id, sequence_order, checkpoint_id, checkpoints(id, name, nfc_tag_id))").eq("company_id", companyId).order("created_at", { ascending: false });
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolRouteRow[];
    },
  });
}

export function usePatrolSchedules(siteId = "all") {
  const { data: companyId } = useCompanyId();
  return useQuery({
    queryKey: ["patrol_schedules", companyId, siteId],
    enabled: !!companyId,
    queryFn: async () => {
      let query = db.from("patrol_schedules").select("*, sites(name), patrol_templates(id, name), patrol_routes(id, name)").eq("company_id", companyId).order("next_run_at", { ascending: true });
      if (siteId !== "all") query = query.eq("site_id", siteId);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PatrolScheduleRow[];
    },
  });
}

export function usePatrolSessions(limit = 100, siteId = "all", statuses?: string[]) {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();
  const statusKey = statuses?.join(",") ?? "all";

  const query = useQuery({
    queryKey: ["patrol_sessions", companyId, siteId, statusKey, limit],
    enabled: !!companyId,
    queryFn: async () => {
      let request = db
        .from("patrol_sessions")
        .select("*, sites(name), patrol_templates(id, name), patrol_routes(id, name), patrol_schedules(id, name), patrol_session_checkpoints(id, checkpoint_id, sequence_order:scheduled_order, scanned_at, status, checkpoints(id, name, nfc_tag_id))")
        .eq("company_id", companyId)
        .order("scheduled_start", { ascending: false })
        .limit(limit);
      if (siteId !== "all") request = request.eq("site_id", siteId);
      if (statuses?.length) request = request.in("status", statuses);
      const { data, error } = await request;
      if (error) throw error;
      return (data ?? []) as PatrolSessionRow[];
    },
  });

  useEffect(() => {
    if (!companyId) return;
    const channel = supabase
      .channel(`patrol-sessions-${companyId}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "patrol_sessions", filter: `company_id=eq.${companyId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["patrol_sessions", companyId] });
        queryClient.invalidateQueries({ queryKey: ["reports_session_metrics", companyId] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "patrol_session_checkpoints", filter: `company_id=eq.${companyId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ["patrol_sessions", companyId] });
      })
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR") console.warn("[PatrolSessions] Realtime channel failed");
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [companyId, queryClient]);

  return query;
}

export type CreatePatrolRouteInput = {
  name: string;
  description?: string | null;
  site_id?: string | null;
  template_id?: string | null;
  status?: "active" | "paused" | "archived";
  checkpoints: Array<{
    checkpoint_id: string;
    sequence_order: number;
    expected_offset_minutes?: number | null;
    is_required?: boolean;
  }>;
};

export function useCreatePatrolRoute() {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();

  return useMutation({
    mutationFn: async (route: CreatePatrolRouteInput) => {
      const { data, error } = await supabase.functions.invoke("scheduled-patrols", {
        body: { action: "create_route", route },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to create patrol route");
      return data.result?.route ?? data.route;
    },
    onSuccess: () => {
      toast.success("Patrol route created");
      queryClient.invalidateQueries({ queryKey: ["patrol_routes", companyId] });
      queryClient.invalidateQueries({ queryKey: ["patrol_templates", companyId] });
      queryClient.invalidateQueries({ queryKey: ["patrol_schedules", companyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create patrol route"),
  });
}
export function useGeneratePatrolSessions() {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("scheduled-patrols", {
        body: { action: "generate_sessions", until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to generate patrol sessions");
      return (data.result?.generated ?? data.generated ?? 0) as number;
    },
    onSuccess: (count) => {
      toast.success(`Generated ${count ?? 0} patrol session${count === 1 ? "" : "s"}`);
      queryClient.invalidateQueries({ queryKey: ["patrol_sessions", companyId] });
      queryClient.invalidateQueries({ queryKey: ["patrol_schedules", companyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to generate patrol sessions"),
  });
}

export type CreatePatrolTemplateInput = {
  name: string;
  description?: string | null;
  site_id?: string | null;
  status?: "active" | "paused" | "archived";
  expected_duration_minutes?: number;
};

export function useCreatePatrolTemplate() {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();

  return useMutation({
    mutationFn: async (template: CreatePatrolTemplateInput) => {
      const { data, error } = await supabase.functions.invoke("scheduled-patrols", {
        body: { action: "create_template", template },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to create patrol template");
      return data.result?.template ?? data.template;
    },
    onSuccess: () => {
      toast.success("Patrol template created");
      queryClient.invalidateQueries({ queryKey: ["patrol_templates", companyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create patrol template"),
  });
}

export type CreatePatrolScheduleInput = {
  name: string;
  route_id: string;
  site_id?: string | null;
  template_id?: string | null;
  frequency_type?: "hourly" | "daily" | "weekly" | "custom" | "every_n_minutes" | "every_n_hours";
  interval_value?: number;
  start_time?: string | null;
  end_time?: string | null;
  days_of_week?: number[];
  timezone?: string;
  status?: "active" | "paused" | "archived";
  grace_start_minutes?: number;
  grace_completion_minutes?: number;
  device_identifier?: string | null;
};

export function useCreatePatrolSchedule() {
  const queryClient = useQueryClient();
  const { data: companyId } = useCompanyId();

  return useMutation({
    mutationFn: async (schedule: CreatePatrolScheduleInput) => {
      const { data, error } = await supabase.functions.invoke("scheduled-patrols", {
        body: { action: "create_schedule", schedule },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Failed to create patrol schedule");
      return data.result?.schedule ?? data.schedule;
    },
    onSuccess: () => {
      toast.success("Patrol schedule created");
      queryClient.invalidateQueries({ queryKey: ["patrol_schedules", companyId] });
      queryClient.invalidateQueries({ queryKey: ["patrol_sessions", companyId] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to create patrol schedule"),
  });
}

export function patrolSessionProgress(session: PatrolSessionRow) {
  const completed = Number(session.checkpoint_completed ?? session.completed_required_count ?? 0);
  const total = Number(session.checkpoint_total ?? session.total_required_count ?? 0);
  const percent = Number(session.progress_percent ?? session.progress ?? (total ? Math.round((completed / total) * 100) : 0));
  return { completed, total, percent };
}

export function patrolSessionLabel(session: PatrolSessionRow) {
  return session.patrol_templates?.name ?? session.patrol_routes?.name ?? session.patrol_schedules?.name ?? "Scheduled patrol";
}
