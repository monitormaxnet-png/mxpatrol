// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

import type { Identity, Role } from "./types.ts";
import { normalizeWhatsAppPhone } from "../../_shared/management-actions.ts";

export type IdentityResult =
  | { kind: "authorized"; identity: Identity }
  | { kind: "linked"; identity: Identity }
  | { kind: "unknown" };

function linkCodeCandidates(body: string): string[] {
  const compact = body.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const suffix = compact.startsWith("MXWA") ? compact.slice(4) : compact;

  if (!/^[A-Z0-9]{6,10}$/.test(suffix)) return [];

  return ["MX-WA-" + suffix, suffix];
}

async function buildIdentity(
  client: SupabaseClient,
  row: Record<string, any>,
): Promise<Identity> {
  let role: Role = "guard";
  let platformRole: string | null = null;

  if (row.user_id) {
    const { data } = await client
      .from("user_roles")
      .select("role")
      .eq("user_id", row.user_id);

    const names = (data ?? []).map((entry: Record<string, any>) =>
      String(entry.role)
    );

    if (names.includes("admin")) role = "admin";
    else if (names.includes("supervisor")) role = "supervisor";
    else if (names.includes("guard")) role = "guard";

    const { data: platformRows, error: platformError } = await client
      .from("platform_admins")
      .select("role")
      .eq("user_id", row.user_id)
      .limit(1);

    if (platformError) throw platformError;

    platformRole = platformRows?.[0]?.role
      ? String(platformRows[0].role)
      : null;
  }

  return {
    id: row.id,
    phone: row.phone,
    company_id: row.company_id,
    user_id: row.user_id ?? null,
    guard_id: row.guard_id ?? null,
    display_name: row.display_name ?? null,
    role,
    allowed_site_ids: Array.isArray(row.allowed_site_ids)
      ? row.allowed_site_ids
      : [],
    canSetup: role === "admin",
    canManage: role === "admin" || role === "supervisor",

    // MX Patrol platform-owner-only security permissions
    canManageKiosk: platformRole === "owner",
    canManageSecureDevices: platformRole === "owner",

    platformRole,
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
    .select(
      "id, company_id, user_id, guard_id, phone, display_name, allowed_site_ids, status",
    )
    .eq("phone", phone)
    .maybeSingle();

  if (existing && existing.status === "active") {
    await client
      .from("whatsapp_authorized_numbers")
      .update({ last_seen_at: new Date().toISOString() })
      .eq("id", existing.id);

    return {
      kind: "authorized",
      identity: await buildIdentity(client, existing),
    };
  }

  const candidates = linkCodeCandidates(body);

  if (candidates.length) {
    const { data: pending } = await client
      .from("whatsapp_authorized_numbers")
      .select(
        "id, company_id, user_id, guard_id, phone, display_name, allowed_site_ids, link_code, link_code_expires_at, status",
      )
      .in("link_code", candidates)
      .eq("status", "pending")
      .maybeSingle();

    const notExpired = pending?.link_code_expires_at
      ? new Date(pending.link_code_expires_at).getTime() > Date.now()
      : false;

    const intendedPhone = normalizeWhatsAppPhone(pending?.phone);

    if (pending && notExpired && (!intendedPhone || intendedPhone === phone)) {
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
        .eq("status", "pending")
        .eq("link_code", pending.link_code)
        .select(
          "id, company_id, user_id, guard_id, phone, display_name, allowed_site_ids",
        )
        .maybeSingle();

      if (updated) {
        return {
          kind: "linked",
          identity: await buildIdentity(client, updated),
        };
      }
    }
  }

  return { kind: "unknown" };
}

/** Sites this identity may act on. */
export async function allowedSites(
  client: SupabaseClient,
  identity: Identity,
) {
  let query = client
    .from("sites")
    .select("id, name")
    .eq("company_id", identity.company_id)
    .order("name");

  if (identity.allowed_site_ids.length) {
    query = query.in("id", identity.allowed_site_ids);
  }

  const { data } = await query;

  return data ?? [];
}