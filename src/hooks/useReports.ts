import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { Tables } from "@/integrations/supabase/types";

export function useReports() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["ai_reports"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ai_reports")
        .select("*")
        .order("generated_at", { ascending: false });
      if (error) throw error;
      return data as Tables<"ai_reports">[];
    },
    enabled: !!user,
  });
}
