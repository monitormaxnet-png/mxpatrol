import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panel = readFileSync('src/components/command-center/LiveSecureDeviceManagementPanel.tsx', 'utf8');
const edge = readFileSync('supabase/functions/secure-device-management/index.ts', 'utf8');
const shared = readFileSync('supabase/functions/_shared/secure-device-management.ts', 'utf8');
const whatsappViews = readFileSync('supabase/functions/whatsapp-webhook/lib/views.ts', 'utf8');
const whatsappFlows = readFileSync('supabase/functions/whatsapp-webhook/lib/flows.ts', 'utf8');

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
    expect(panel).toContain('disabled={commandMutation.isPending || !canRunAction(action, activeDevice)}');
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
