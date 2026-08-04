import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export function usePlatformAdmin() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery({
    queryKey: ["platform-admin", user?.id],
    enabled: !!user,
    retry: false,
    queryFn: async () => {
      const { data, error } = await (supabase.from("platform_admins" as never) as any)
        .select("role")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (error) {
        console.error("[PlatformAdmin] platform_admins lookup failed", {
          userId: user!.id,
          email: user!.email,
          error,
        });
      }

      if (!error && data?.role) {
        return { isPlatformAdmin: true, role: data.role as string };
      }

      console.warn("[PlatformAdmin] current user is not in platform_admins", {
        userId: user!.id,
        email: user!.email,
      });

      return { isPlatformAdmin: false, role: null as string | null };
    },
  });

  return {
    isPlatformAdmin: data?.isPlatformAdmin ?? false,
    platformRole: data?.role ?? null,
    isLoading,
  };
}
