import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type Site = {
  id: string;
  company_id: string;
  name: string;
  address: string | null;
  gps_lat: number | null;
  gps_lng: number | null;
  status: string;
  created_at: string;
};

export function useSites() {
  const { user } = useAuth();
  const { data: companyId } = useQuery({
    queryKey: ["sites_company_id", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", user!.id)
        .single();
      if (error) throw error;
      return data.company_id as string | null;
    },
    enabled: !!user,
  });

  return useQuery({
    queryKey: ["sites", companyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("sites" as never)
        .select("id, company_id, name, address, gps_lat, gps_lng, status, created_at")
        .eq("company_id", companyId!)
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as Site[];
    },
    enabled: !!companyId,
  });
}

export function getSiteName(siteId: string | null | undefined, sites: Site[]) {
  if (!siteId) return "Unassigned";
  return sites.find((site) => site.id === siteId)?.name ?? "Unknown site";
}
