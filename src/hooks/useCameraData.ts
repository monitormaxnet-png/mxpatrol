import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";
import { toast } from "sonner";

export interface Camera {
  id: string;
  company_id: string;
  checkpoint_id: string | null;
  name: string;
  stream_url: string;
  ip_address: string | null;
  location: string | null;
  location_lat: number | null;
  location_lng: number | null;
  camera_type: string;
  status: string;
  is_recording: boolean;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  checkpoints?: { name: string } | null;
}

export interface CameraEvent {
  id: string;
  camera_id: string;
  company_id: string;
  event_type: string;
  severity: string;
  description: string | null;
  thumbnail_url: string | null;
  clip_url: string | null;
  metadata: Record<string, unknown>;
  detected_at: string;
  created_at: string;
  cameras?: { name: string } | null;
}

export function useCameras() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["cameras"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("cameras")
        .select("*, checkpoints(name)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Camera[];
    },
    enabled: !!user,
  });
}

export function useCameraEvents(cameraId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["camera_events", cameraId],
    queryFn: async () => {
      let query = supabase
        .from("camera_events")
        .select("*, cameras(name)")
        .order("detected_at", { ascending: false })
        .limit(50);
      if (cameraId) query = query.eq("camera_id", cameraId);
      const { data, error } = await query;
      if (error) throw error;
      return data as CameraEvent[];
    },
    enabled: !!user,
  });
}

export function useAddCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (camera: {
      name: string;
      stream_url: string;
      ip_address?: string;
      location?: string;
      location_lat?: number;
      location_lng?: number;
      camera_type?: string;
      checkpoint_id?: string;
      company_id: string;
    }) => {
      const { data, error } = await supabase.from("cameras").insert(camera).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      toast.success("Camera added successfully");
    },
    onError: (e) => toast.error(`Failed to add camera: ${e.message}`),
  });
}

export function useUpdateCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: unknown }) => {
      const { data, error } = await supabase.from("cameras").update(updates).eq("id", id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      toast.success("Camera updated");
    },
    onError: (e) => toast.error(`Failed to update camera: ${e.message}`),
  });
}

export function useDeleteCamera() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("cameras").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cameras"] });
      toast.success("Camera deleted");
    },
    onError: (e) => toast.error(`Failed to delete camera: ${e.message}`),
  });
}

export function useCameraRealtimeSubscription() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("camera-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "cameras" }, () => {
        queryClient.invalidateQueries({ queryKey: ["cameras"] });
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "camera_events" }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ["camera_events"] });
        const evt = payload.new as CameraEvent;
        const critical = ["intrusion", "motion_restricted", "suspicious_behavior"];
        if (critical.includes(evt.event_type)) {
          toast.error(`📹 ${evt.event_type.replace(/_/g, " ").toUpperCase()} detected`, {
            description: evt.description || "Check camera feed immediately",
            duration: 10000,
          });
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);
}
