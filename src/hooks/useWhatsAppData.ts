import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

export type AuthorizedNumberRow = {
  id: string;
  company_id: string | null;
  user_id: string | null;
  guard_id: string | null;
  phone: string | null;
  display_name: string | null;
  status: string;
  link_code: string | null;
  link_code_expires_at: string | null;
  allowed_site_ids: string[];
  linked_at: string | null;
  last_seen_at: string | null;
  created_at: string;
};

export const useWhatsAppAuthorizedNumbers = () => {
  return useQuery({
    queryKey: ["whatsapp-authorized-numbers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_authorized_numbers")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as AuthorizedNumberRow[];
    },
  });
};

const generateLinkCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let index = 0; index < 6; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `MX-${code}`;
};

export const useAuthorizeWhatsAppNumber = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { phone?: string; displayName: string; mode: "direct" | "link_code" }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("You must be signed in.");

      const { data: profile } = await supabase
        .from("profiles")
        .select("company_id")
        .eq("id", userId)
        .maybeSingle();
      if (!profile?.company_id) throw new Error("No company found for your profile.");

      const phone = input.phone?.replace(/[^\d+]/g, "") ?? null;
      if (input.mode === "direct" && (!phone || phone.length < 8)) {
        throw new Error("Enter a valid phone number in international format, e.g. +27821234567.");
      }

      const payload = {
        company_id: profile.company_id,
        display_name: input.displayName.trim() || null,
        authorized_by: userId,
        phone: input.mode === "direct" ? phone : null,
        status: input.mode === "direct" ? "active" : "pending",
        linked_at: input.mode === "direct" ? new Date().toISOString() : null,
        link_code: input.mode === "link_code" ? generateLinkCode() : null,
        link_code_expires_at:
          input.mode === "link_code" ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
      };

      const { data, error } = await supabase
        .from("whatsapp_authorized_numbers")
        .insert(payload)
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data as AuthorizedNumberRow;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-authorized-numbers"] }),
  });
};

export const useUpdateWhatsAppNumber = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; status: string }) => {
      const { error } = await supabase
        .from("whatsapp_authorized_numbers")
        .update({ status: input.status })
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-authorized-numbers"] }),
  });
};

export const useRemoveWhatsAppNumber = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("whatsapp_authorized_numbers").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["whatsapp-authorized-numbers"] }),
  });
};
