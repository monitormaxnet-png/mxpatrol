import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type AppRole = "admin" | "supervisor" | "guard";

export function useUserRole() {
  const { user } = useAuth();

  const { data: role, isLoading } = useQuery({
    queryKey: ["user_role", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .single();

      if (error || !data) return "guard" as AppRole;
      return data.role as AppRole;
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });

  const isAdmin = role === "admin";
  const isSupervisor = role === "supervisor";
  const isGuard = role === "guard";
  const canManage = isAdmin || isSupervisor;

  return { role: role ?? ("guard" as AppRole), isLoading, isAdmin, isSupervisor, isGuard, canManage };
}
