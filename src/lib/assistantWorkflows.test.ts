import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { advanceWorkflow, startWorkflow, type WorkflowContext, type WorkflowReply } from './assistantWorkflows';

const ctx: WorkflowContext = {
  siteId: 'site-1',
  siteName: 'Northgate Mall',
  canManage: true,
  checkpoints: [
    { id: 'cp-1', name: 'Main Gate' },
    { id: 'cp-2', name: 'Loading Bay' },
    { id: 'cp-3', name: 'Roof Access' },
  ],
  routes: [{ id: 'route-1', name: 'Night Route' }],
  forms: [{ id: 'form-1', name: 'Gate Inspection' }],
};

function run(id: Parameters<typeof startWorkflow>[0], inputs: string[], context = ctx): WorkflowReply {
  let reply = startWorkflow(id, context);
  for (const input of inputs) {
    if (reply.kind !== 'prompt' && reply.kind !== 'error') break;
    reply = advanceWorkflow(reply.state, input, context);
  }
  return reply;
}

describe('management workflows require authorization and site scope', () => {
  it('denies workflows for non-management roles', () => {
    const reply = startWorkflow('register_incident', { ...ctx, canManage: false });
    expect(reply.kind).toBe('denied');
  });

  it('denies a management write typed directly by a user without an active site', () => {
    const reply = startWorkflow('register_checkpoint', { ...ctx, siteId: null });
    expect(reply.kind).toBe('denied');
  });

  it('blocks mid-flow when permission is lost', () => {
    const started = startWorkflow('register_incident', ctx);
    expect(started.kind).toBe('prompt');
    if (started.kind !== 'prompt') return;
    expect(advanceWorkflow(started.state, 'Broken window', { ...ctx, canManage: false }).kind).toBe('denied');
  });
});

describe('confirmation gating', () => {
  it('never writes before confirmation and cancel leaves no payload', () => {
    const reply = run('register_incident', ['Fence cut at east wall']);
    expect(reply.kind).toBe('prompt');
    if (reply.kind !== 'prompt') return;
    const cancelled = advanceWorkflow(reply.state, 'cancel', ctx);
    expect(cancelled.kind).toBe('cancelled');
    expect(cancelled.lines.join(' ')).toMatch(/no partial record/i);
  });

  it('reaches a confirm step with the canonical incident payload', () => {
    const reply = run('register_incident', ['Fence cut at east wall', '4']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('create_incident');
    expect(reply.payload.input).toMatchObject({ site_id: 'site-1', severity: 'critical', description: 'Fence cut at east wall' });
    expect(reply.lines.join(' ')).toContain('Northgate Mall');
  });
});

describe('canonical payloads per workflow', () => {
  it('device registration binds the code already shown on the physical device', () => {
    const reply = run('register_device', ['Gate Tablet', '2', 'MX-48768']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('register_device');
    expect(reply.payload.input).toMatchObject({ site_id: 'site-1', device_name: 'Gate Tablet', device_type: 'pda', pairing_code: '48768' });
    const text = reply.lines.join(' ');
    expect(text).toContain('Pairing Code: MX-48768');
    expect(text).toContain('must match the code currently displayed on the physical MX Patrol device');
    expect(text).toContain('Reply confirm to bind this physical device');
  });

  it('rejects malformed pairing codes and never generates one', () => {
    const bad = run('register_device', ['Gate Tablet', '2', 'ab']);
    expect(bad.kind).toBe('error');
    const ok = run('register_device', ['Gate Tablet', '2', 'MX-48768']);
    if (ok.kind !== 'confirm') throw new Error('expected confirm');
    expect(JSON.stringify(ok.payload.input)).not.toMatch(/generated/i);
  });

  it('checkpoint registration supports pending NFC assignment and existing data log forms', () => {
    const reply = run('register_checkpoint', ['Server Room', 'Basement', 'later', '2', '1']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('create_checkpoint');
    expect(reply.payload.input).toMatchObject({ site_id: 'site-1', name: 'Server Room', nfc_tag_id: '', data_log_form_id: 'form-1' });
  });

  it('checkpoint registration can attach a new checklist form', () => {
    const reply = run('register_checkpoint', [
      'Roof Hatch', 'Roof', '04a2b3c4d5',
      '3',                 // create a new Data Log Form
      'Roof Inspection',   // form name
      'Door locked?',      // field 1 label
      '3',                 // field type: Yes / No
      '1',                 // required
      '2',                 // done adding fields
    ]);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.input.nfc_tag_id).toBe('04a2b3c4d5');
    const newForm = reply.payload.input.new_form as any;
    expect(newForm.name).toBe('Roof Inspection');
    expect(newForm.form_type).toBe('checklist');
    expect(newForm.fields).toHaveLength(1);
    expect(newForm.fields[0]).toMatchObject({ label: 'Door locked?', required: true, sequence_order: 1 });
  });

  it('route creation preserves the scanned checkpoint order', () => {
    const reply = run('create_route', ['Perimeter Loop', '3,1,2', '2']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('create_route');
    expect(reply.payload.input.checkpoint_ids).toEqual(['cp-3', 'cp-1', 'cp-2']);
    expect(reply.payload.input.enforce_sequence).toBe(true);
  });

  it('schedule creation binds an existing site route and start time', () => {
    const reply = run('create_schedule', ['1', '1', '22:00']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('create_schedule');
    expect(reply.payload.input).toMatchObject({ route_id: 'route-1', frequency: 'daily', start_time: '22:00', site_id: 'site-1' });
  });

  it('patrol template creation validates duration', () => {
    const bad = run('create_patrol', ['Night Patrol', '2']);
    expect(bad.kind).toBe('error');
    const reply = run('create_patrol', ['Night Patrol', '45']);
    expect(reply.kind).toBe('confirm');
    if (reply.kind !== 'confirm') return;
    expect(reply.payload.action).toBe('create_patrol_template');
    expect(reply.payload.input.expected_duration_minutes).toBe(45);
  });

  it('rejects routes when the active site has no checkpoints', () => {
    const reply = run('create_route', ['Empty Route', 'all'], { ...ctx, checkpoints: [] });
    expect(reply.kind).toBe('error');
  });
});

describe('shared canonical backend service', () => {
  const shared = readFileSync('supabase/functions/_shared/management-actions.ts', 'utf8');
  const whatsapp = readFileSync('supabase/functions/whatsapp-webhook/lib/flows.ts', 'utf8');
  const web = readFileSync('supabase/functions/management-actions/index.ts', 'utf8');

  it('exposes one dispatcher used by both assistants', () => {
    expect(shared).toContain('export async function runManagementAction');
    expect(whatsapp).toContain('runManagementAction');
    expect(web).toContain('runManagementAction');
  });

  it('keeps WhatsApp flows free of duplicated management inserts', () => {
    expect(whatsapp).not.toMatch(/from\("incidents"\)\s*\.insert/);
    expect(whatsapp).not.toMatch(/from\("checkpoints"\)\s*\.insert/);
    expect(whatsapp).not.toMatch(/from\("patrol_routes"\)/);
    expect(whatsapp).not.toMatch(/from\("patrol_schedules"\)/);
    expect(whatsapp).not.toMatch(/from\("data_log_forms"\)\s*\.insert/);
  });

  it('never generates a pairing code during management device registration', () => {
    expect(shared).toContain('export async function registerDevice');
    expect(shared).toMatch(/device_pairing_requests/);
    expect(shared.split('export async function registerDevice')[1].split('function devicePairedResult')[0]).not.toContain('generatePairingCode(');
    expect(whatsapp).toContain('"register_device"');
    expect(whatsapp).toContain('REGISTER DEVICE — CONFIRM');
  });

  it('enforces permission, site scope and canonical ordering server-side', () => {
    expect(shared).toContain('assertCanManage');
    expect(shared).toContain('resolveSite');
    expect(shared).toContain('sequence_order');
    expect(shared).toMatch(/duplicate: true/);
  });
});
