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
    expect(source).toContain("from('alerts').select('*').eq('company_id', companyId)");
  });
});



