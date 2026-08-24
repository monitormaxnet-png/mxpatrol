// deno-lint-ignore no-explicit-any
type SupabaseClient = any;
import type { Identity, Role } from "./types.ts";

export type IdentityResult =
  | { kind: "authorized"; identity: Identity }
  | { kind: "linked"; identity: Identity }
  | { kind: "unknown" };

const LINK_CODE_PATTERN = /^[A-Z0-9]{6,10}$/;

async function buildIdentity(client: SupabaseClient, row: Record<string, any>): Promise<Identity> {
  let role: Role = "guard";
  if (row.user_id) {
    const { data } = await client.from("user_roles").select("role").eq("user_id", row.user_id);
    const names = (data ?? []).map((entry: Record<string, any>) => String(entry.role));
    if (names.includes("admin")) role = "admin";
    else if (names.includes("supervisor")) role = "supervisor";
    else if (names.includes("guard")) role = "guard";
  }
  return {
    id: row.id,
    phone: row.phone,
    company_id: row.company_id,
    user_id: row.user_id ?? null,
    guard_id: row.guard_id ?? null,
    display_name: row.display_name ?? null,
    role,
    allowed_site_ids: Array.isArray(row.allowed_site_ids) ? row.allowed_site_ids : [],
    canSetup: role === "admin",
    canManage: role === "admin" || role === "supervisor",
    canAcknowledge: role === "admin" || role === "supervisor",

  };
}

/**
 * Resolves the WhatsApp sender to an MX Patrol user. Falls back to consuming a
 * self-serve link code when the number is not authorized yet.
 */
export async function resolveIdentity(
  client: SupabaseClient,
  phone: string,
  body: string,
): Promise<IdentityResult> {
  const { data: existing } = await client
    .from("whatsapp_authorized_numbers")
    .select("id, company_id, user_id, guard_id, phone, display_name, allowed_site_ids, status")
    .eq("phone", phone)
    .maybeSingle();

  if (existing && existing.status === "active") {
    await client
      .from("whatsapp_authorized_numbers")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);
    return { kind: "authorized", identity: await buildIdentity(client, existing) };
  }

  const candidate = body.trim().toUpperCase().replace(/[\s-]/g, "");
  if (LINK_CODE_PATTERN.test(candidate)) {
    const { data: pending } = await client
      .from("whatsapp_authorized_numbers")
      .select("id, company_id, user_id, guard_id, display_name, allowed_site_ids, link_code_expires_at, status")
      .eq("link_code", candidate)
      .maybeSingle();

    const notExpired = pending?.link_code_expires_at
      ? new Date(pending.link_code_expires_at).getTime() > Date.now()
      : true;

    if (pending && pending.status !== "revoked" && notExpired) {
      const { data: updated } = await client
        .from("whatsapp_authorized_numbers")
        .update({
          phone,
          status: "active",
          link_code: null,
          link_code_expires_at: null,
          linked_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", pending.id)
        .select("id, company_id, user_id, guard_id, phone, display_name, allowed_site_ids")
        .maybeSingle();
      if (updated) return { kind: "linked", identity: await buildIdentity(client, updated) };
    }
  }

  return { kind: "unknown" };
}

/** Sites this identity may act on. */
export async function allowedSites(client: SupabaseClient, identity: Identity) {
  let query = client
    .from("sites")
    .select("id, name")
    .eq("company_id", identity.company_id)
    .order("name");
  if (identity.allowed_site_ids.length) query = query.in("id", identity.allowed_site_ids);
  const { data } = await query;
  return data ?? [];
}
