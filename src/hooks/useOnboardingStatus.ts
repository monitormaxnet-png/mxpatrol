import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useUserRole } from "@/hooks/useUserRole";

export function useOnboardingStatus() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["profile_onboarding", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user!.id)
        .single();
      if (error) return { onboarding_completed: true };
      return data;
    },
    enabled: !!user && isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const needsOnboarding = isAdmin && profile?.onboarding_completed === false;

  const completeOnboarding = async () => {
    if (!user) return;
    await supabase
      .from("profiles")
      .update({ onboarding_completed: true } as any)
      .eq("id", user.id);
  };

  return { needsOnboarding, isLoading, completeOnboarding };
}
