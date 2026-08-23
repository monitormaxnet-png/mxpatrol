export type Option = { id: string; label: string };

export type OutMessage = {
  title?: string;
  lines: string[];
  options?: Option[];
  footer?: string;
};

export type Role = "admin" | "supervisor" | "guard";

export type Identity = {
  id: string;
  phone: string;
  company_id: string;
  user_id: string | null;
  guard_id: string | null;
  display_name: string | null;
  role: Role;
  allowed_site_ids: string[];
  canManage: boolean;
  canSetup: boolean;
  canAcknowledge: boolean;


};

export type SessionRow = {
  id: string;
  phone: string;
  company_id: string | null;
  user_id: string | null;
  authorized_number_id: string | null;
  current_flow: string | null;
  current_step: string | null;
  temporary_data: Record<string, unknown>;
  current_site_id: string | null;
  current_site_name: string | null;
  site_scope: string;
  last_menu: string | null;
};

export type SiteRow = { id: string; name: string };

export function normalizePhone(raw: string): string {
  const cleaned = (raw || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, "").trim();
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

export function greeting(now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone: "Africa/Johannesburg" }).format(now),
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins === 1) return "1 min ago";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
