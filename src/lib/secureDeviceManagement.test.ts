import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync('src/components/command-center/LiveSecureDeviceManagementPanel.tsx', 'utf8');
const edge = readFileSync('supabase/functions/secure-device-management/index.ts', 'utf8');
const shared = readFileSync('supabase/functions/_shared/secure-device-management.ts', 'utf8');
const whatsappViews = readFileSync('supabase/functions/whatsapp-webhook/lib/views.ts', 'utf8');
const whatsappFlows = readFileSync('supabase/functions/whatsapp-webhook/lib/flows.ts', 'utf8');
const whatsappIdentity = readFileSync('supabase/functions/whatsapp-webhook/lib/identity.ts', 'utf8');
const whatsappAsk = readFileSync('supabase/functions/whatsapp-webhook/lib/askmx.ts', 'utf8');

describe('secure patrol device management', () => {
  it('loads through the canonical secure-device-management edge function without the invalid user_roles company filter', () => {
    expect(edge).toContain('getSecureDeviceSummary');
    expect(edge).toContain('requestSecureDeviceCommand');
    expect(edge).toContain('.from("user_roles")');
    expect(edge).not.toContain('.eq("company_id", profile.company_id)');
  });

  it('does not make backend errors look like confirmed zero-count summaries', () => {
    expect(panel).toContain('Loading secure device status...');
    expect(panel).toContain('Secure device data could not load.');
    expect(panel).toContain('summaryQuery.isError');
    expect(panel).toContain("error ? '-' : value");
    expect(panel).not.toContain('summary?.total ?? 0');
  });

  it('renders real icon components and does not include the old svg label leak', () => {
    expect(panel).toContain('<Icon className=');
    expect(panel).not.toContain('Total Devicessvg');
    expect(panel).not.toContain('Secure Devicessvg');
    expect(panel).not.toContain('Attentionsvg');
  });

  it('selects visible device rows by stable key before enabling valid commands', () => {
    expect(panel).toContain("Selected: {activeDeviceName}");
    expect(panel).toContain('function deviceKey(device: SecureDeviceRow)');
    expect(panel).toContain('rows.find((row) => deviceKey(row) === selectedDevice)');
    expect(panel).toContain('setSelectedDevice(identifier)');
    expect(panel).toContain('aria-pressed={selected}');
    expect(panel).toContain('disabled={commandMutation.isPending || !canRunAction(action, activeDevice, isPlatformOwner)}');
    expect(panel).toContain('Device ID');
    expect(panel).toContain('compactId(device.id ?? device.device_identifier)');
    expect(panel).toContain('setPendingAction(action)');
    expect(panel).not.toContain('selectedDevice ?? rows[0]');
    expect(panel).not.toContain('row.device_identifier === selectedDevice');
  });

  it('uses canonical command queue and security event audit records', () => {
    expect(shared).toContain('.from("device_commands")');
    expect(shared).toContain('.from("device_security_events")');
    expect(shared).toContain('command_status');
    expect(shared).toContain('Device is revoked and cannot receive new secure commands');
  });

  it('adds owner-only kiosk controls without faking device state', () => {
    expect(shared).toContain('request_enable_kiosk_mode: "set_kiosk_mode"');
    expect(shared).toContain('request_disable_kiosk_mode: "set_kiosk_mode"');
    expect(shared).toContain('Platform owner access required for kiosk mode controls');
    expect(shared).toContain('Device Owner provisioning is not active');
    expect(shared).toContain('requested_kiosk_active');
    expect(shared).not.toContain('statusPatch.kiosk_active');
    expect(edge).toContain('.from("platform_admins")');
    expect(edge).toContain('canManageKiosk');
    expect(panel).toContain('usePlatformAdmin');
    expect(panel).toContain('filter(([action]) => !isKioskAction(action) || isPlatformOwner)');
    expect(shared).toContain('OWNER ACCESS REQUIRED: Only MX Patrol platform owners can access Secure Patrol Device Mode.');
    expect(edge).toContain('isSecureDeviceOwner(actor)');
    expect(edge).not.toContain('platformRole === "owner" || platformRole === "operator"');
    expect(whatsappIdentity).toContain('canManageSecureDevices: platformRole === "owner"');
    expect(whatsappViews).toContain('OWNER ACCESS REQUIRED');
    expect(whatsappFlows).toContain('OWNER ACCESS REQUIRED');
    expect(whatsappAsk).toContain('secure_devices');
    expect(panel).toContain('Current Kiosk Status');
  });

  it('keeps WhatsApp on the same secure-device backend and reports real command status', () => {
    expect(whatsappViews).toContain('getSecureDeviceSummary');
    expect(whatsappViews).not.toContain('request_device_integrity_check');
    expect(whatsappViews).toContain('request_integrity_check');
    expect(whatsappFlows).toContain('requestSecureDeviceCommand');
    expect(whatsappFlows).toContain('Command status: ');
  });

  it('renames unverifiable guarantees to factual controls', () => {
    expect(panel).toContain('Security controls');
    expect(panel).not.toContain('Security guarantees');
  });
});
