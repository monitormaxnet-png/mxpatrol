import { supabase } from "@/integrations/supabase/client";

export async function resolveSosAlert(alertId: string, siteId?: string | null) {
  const { data, error } = await supabase.functions.invoke("management-actions", {
    body: {
      action: "resolve_sos_alert",
      input: { alert_id: alertId, site_id: siteId ?? undefined, resolved_source: "web" },
    },
  });

  const payload = data as { ok?: boolean; error?: string; summary?: string } | null;
  if (error || !payload?.ok) throw new Error(payload?.error ?? error?.message ?? "SOS alert could not be resolved");
  return payload;
}
