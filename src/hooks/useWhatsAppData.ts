import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export const useWhatsAppConversations = () => {
  return useQuery({
    queryKey: ["whatsapp-conversations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*, guards(full_name, badge_number)")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });
};

export const useWhatsAppMessages = (conversationId: string | null) => {
  return useQuery({
    queryKey: ["whatsapp-messages", conversationId],
    queryFn: async () => {
      if (!conversationId) return [];
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!conversationId,
  });
};

export const useWhatsAppRealtimeSubscription = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("whatsapp-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "whatsapp_messages" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["whatsapp-messages"] });
          queryClient.invalidateQueries({ queryKey: ["whatsapp-conversations"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
};
