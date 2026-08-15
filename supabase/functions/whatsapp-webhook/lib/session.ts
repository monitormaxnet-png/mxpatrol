import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.100.1";
import type { Identity, SessionRow } from "./types.ts";

const SESSION_TTL_MINUTES = 120;

function expiry(): string {
  return new Date(Date.now() + SESSION_TTL_MINUTES * 60_000).toISOString();
}

export async function loadSession(
  client: SupabaseClient,
  identity: Identity,
): Promise<SessionRow> {
  const { data: existing } = await client
    .from("whatsapp_sessions")
    .select("*")
    .eq("phone", identity.phone)
    .maybeSingle();

  const now = new Date().toISOString();

  if (existing) {
    const stale = existing.expires_at && new Date(existing.expires_at).getTime() < Date.now();
    const patch: Record<string, unknown> = {
      last_inbound_at: now,
      expires_at: expiry(),
      company_id: identity.company_id,
      user_id: identity.user_id,
      authorized_number_id: identity.id,
    };
    if (stale) {
      patch.current_flow = null;
      patch.current_step = null;
      patch.temporary_data = {};
    }
    const { data: updated } = await client
      .from("whatsapp_sessions")
      .update(patch)
      .eq("id", existing.id)
      .select("*")
      .maybeSingle();
    return (updated ?? existing) as SessionRow;
  }

  const { data: created, error } = await client
    .from("whatsapp_sessions")
    .insert({
      phone: identity.phone,
      company_id: identity.company_id,
      user_id: identity.user_id,
      authorized_number_id: identity.id,
      expires_at: expiry(),
    })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return created as SessionRow;
}

export async function patchSession(
  client: SupabaseClient,
  session: SessionRow,
  patch: Partial<SessionRow> & { temporary_data?: Record<string, unknown> },
): Promise<SessionRow> {
  const next = { ...patch, expires_at: expiry() } as Record<string, unknown>;
  const { data, error } = await client
    .from("whatsapp_sessions")
    .update(next)
    .eq("id", session.id)
    .select("*")
    .maybeSingle();
  if (error) {
    console.error("[WA] session update failed:", error.message);
    return { ...session, ...patch } as SessionRow;
  }
  return (data ?? session) as SessionRow;
}

export async function clearFlow(client: SupabaseClient, session: SessionRow): Promise<SessionRow> {
  return await patchSession(client, session, {
    current_flow: null,
    current_step: null,
    temporary_data: {},
  });
}
