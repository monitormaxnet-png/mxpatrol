import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

describe("remaining partial item regressions", () => {
  it("keeps company registration and SOS resolution server-authorized", () => {
    const source = read("supabase/functions/_shared/management-actions.ts");
    expect(source).toContain("export async function createCompany");
    expect(source).toMatch(/createCompany[\s\S]*assertPlatformOwner\(actor\)/);
    expect(source).toContain('"resolve_sos_alert"');
    expect(source).toMatch(/resolveSosAlert[\s\S]*assertCanManage\(actor\)/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*\.eq\("company_id", actor\.company_id\)/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*\.eq\("type", "panic_button"\)/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*resolveSite\(client, actor, requestedSiteId\)/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*SOS alert belongs to another site/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*resolved_by: actor\.user_id \?\? null/);
    expect(source).toMatch(/resolveSosAlert[\s\S]*supervisor_user_id: actor\.user_id \?\? null/);
  });

  it("does not resolve SOS alerts with direct browser table updates", () => {
    const files = [
      "src/components/feedback/SystemFeedbackOverlay.tsx",
      "src/components/dashboard/AlertsFeed.tsx",
    ];
    for (const file of files) {
      const source = read(file);
      expect(source).toContain("resolveSosAlert");
      expect(source).not.toMatch(/from\("alerts"\)\.update\(\{ is_read: true \}/);
    }
  });

  it("queues offline datalog responses with the original scan client id", () => {
    const scanner = read("src/pages/NFCScanner.tsx");
    const queue = read("src/hooks/useOfflineScanQueue.ts");
    const deviceScan = read("supabase/functions/device-scan/index.ts");
    expect(scanner).toContain("data_log_enabled");
    expect(scanner).toContain("offline-simple-");
    expect(queue).toContain("data_log_responses");
    expect(deviceScan).toContain("submitInlineDataLog");
    expect(deviceScan).toContain("submit_data_log_submission");
  });


  it("exposes SOS resolution and siren controls in the main dashboard alerts panel", () => {
    const source = read("src/components/dashboard/AlertsFeed.tsx");
    expect(source).toContain("Resolve SOS");
    expect(source).toContain("Acknowledge");
    expect(source).toContain("Enable SOS Sound");
    expect(source).toContain("startSosSiren");
    expect(source).toContain("stopSosSiren");
    expect(source).toContain("seenSosIdsRef");
    expect(source).toContain("resolveSosAlert(alert.id, alert.site_id ?? null)");
    expect(source).toContain("Management access required");
  });

  it("persists SOS alerts with site context and maps alert locations", () => {
    const migration = read("supabase/migrations/20260923133000_alerts_site_context_for_sos.sql");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS site_id");
    expect(migration).toContain("idx_alerts_active_sos_site");

    const deviceSos = read("supabase/functions/device-sos/index.ts");
    expect(deviceSos).toContain("site_id: device.site_id ?? null");
    expect(deviceSos).toContain("location_lat: lat");
    expect(deviceSos).toContain("session_id: sessionId");

    const hardware = read("src/components/devices/HardwareSosListener.tsx");
    expect(hardware).toContain('supabase.functions.invoke("device-sos"');
    expect(hardware).not.toContain('from("alerts").insert');

    const map = read("src/components/dashboard/LiveMap.tsx");
    expect(map).toContain("siteName: alert.sites?.name");
    expect(map).toContain("checkpointName: alert.checkpoints?.name");
    expect(map).toContain("patrolName: alert.patrol_sessions?.patrol_routes?.name");
    expect(map).toContain("Status: ${alert.status}");
  });

  it("keeps Command Center SOS alerts scoped to the selected site", () => {
    const source = read("src/pages/CommandCenter.tsx");
    expect(source).toContain(".eq('site_id', siteId).order('created_at'");
    expect(source).toContain("if (row.site_id) return row.site_id === selectedSiteId;");
    expect(source).toContain("if (row.checkpoint_id) return siteCheckpointIdSet.has(row.checkpoint_id);");
    expect(source).toContain("return false;");
    expect(source).toContain('.select("id, session_id, status, scheduled_at, scheduled_order, checkpoint_name_snapshot, scanned_at, checkpoints(name)")');
    expect(source).toContain('.in("session_id", livePatrolIds)');
  });

  it("does not stop the SOS siren while another SOS remains unacknowledged", () => {
    const source = read("src/components/dashboard/AlertsFeed.tsx");
    expect(source).toContain("unacknowledgedSosAlerts.filter((alert: any) => alert.id !== alertId).length === 0");
    expect(source).not.toContain("setAcknowledgedSosIds((current) => new Set(current).add(alertId));\r\n    stopSosSiren();");
  });
  it("exposes SOS resolution and WhatsApp management in Command Center UI", () => {
    const source = read("src/pages/CommandCenter.tsx");
    expect(source).toContain("function SosResolutionPanel");
    expect(source).toContain("<DashboardPanel title='SOS Alerts'");
    expect(source).toContain("note={sosAlertCount ? 'Action required' : 'All clear'}");
    expect(source).toContain("Acknowledge != Resolve");
    expect(source).toContain("Resolve SOS");
    expect(source).toContain("Acknowledge");
    expect(source).toContain("Enable SOS Sound");
    expect(source).toContain("startSosSiren");
    expect(source).toContain("stopSosSiren");
    expect(source).toContain("seenSosIdsRef");
    expect(source).toContain("resolveSosAlert(alert.id, selectedSiteId)");
    expect(source).toContain("Management access required");
    expect(source).toContain("WhatsApp Access Management");
    expect(source).toContain("command_center_screen");
    expect(source).toContain("from('alerts').select('*, sites(name), checkpoints(name), patrol_sessions(status, patrol_routes(name), patrol_templates(name))')");
  });

  it("persists per-user dashboard activity acknowledgements", () => {
    const migration = read("supabase/migrations/20260924093000_user_activity_acknowledgements.sql");
    expect(migration).toContain("create table if not exists public.user_activity_acknowledgements");
    expect(migration).toContain("unique (user_id, company_id, site_id, activity_type)");
    expect(migration).toContain("activity_type in ('scans', 'photos', 'datalog', 'sos', 'recordings')");
    expect(migration).toContain("alter table public.user_activity_acknowledgements enable row level security");
    expect(migration).toContain("user_id = auth.uid()");
    expect(migration).toContain("from public.platform_admins pa");
  });

  it("shows and acknowledges unseen activity counts on the Command Center dashboard", () => {
    const source = read("src/pages/CommandCenter.tsx");
    expect(source).toContain("dashboard_activity_acknowledgements");
    expect(source).toContain("user_activity_acknowledgements");
    expect(source).toContain("incident_report_photos");
    expect(source).toContain("activityUnseen('scans')");
    expect(source).toContain("activityUnseen('photos')");
    expect(source).toContain("activityUnseen('datalog')");
    expect(source).toContain("activityUnseen('sos')");
    expect(source).toContain("activityUnseen('recordings')");
    expect(source).toContain("Site Activity - Today");
    expect(source).toContain("New activity - click to view");
    expect(source).toContain("const activityUnseen = (activityType: ActivityType) => isNewerThanAck(");
    expect(source).toContain("acknowledgeActivity(activityType)");
  });
});








