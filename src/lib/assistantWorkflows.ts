/**
 * Web Management AI guided write workflows.
 *
 * Pure state machine: it collects and validates input, then produces the payload
 * for the CANONICAL management service (`management-actions` edge function which
 * calls `supabase/functions/_shared/management-actions.ts`) — the exact same
 * service the WhatsApp Management AI uses. No writes happen in this file.
 */

import {
  DATA_LOG_FIELD_TYPES,
  fieldTypeById,
  fieldTypeNeedsOptions,
  parseFieldOptions,
  pickFieldType,
} from './dataLogFieldTypes';

export type WorkflowId =
  | 'register_incident'
  | 'register_device'
  | 'register_checkpoint'
  | 'create_patrol'
  | 'create_route'
  | 'create_schedule';

export type WorkflowOption = { id: string; label: string };

export type WorkflowContext = {
  siteId: string | null;
  siteName: string;
  canManage: boolean;
  checkpoints: Array<{ id: string; name: string }>;
  routes: Array<{ id: string; name: string }>;
  forms: Array<{ id: string; name: string }>;
};

export type WorkflowState = { id: WorkflowId; stepIndex: number; data: Record<string, unknown> };

export type WorkflowPayload = { action: string; input: Record<string, unknown> };

export type WorkflowReply =
  | { kind: 'prompt'; title: string; lines: string[]; options?: WorkflowOption[]; state: WorkflowState }
  | { kind: 'confirm'; title: string; lines: string[]; state: WorkflowState; payload: WorkflowPayload }
  | { kind: 'cancelled'; title: string; lines: string[] }
  | { kind: 'denied'; title: string; lines: string[] }
  | { kind: 'error'; title: string; lines: string[]; options?: WorkflowOption[]; state: WorkflowState };

type ParseResult = { ok: true; patch: Record<string, unknown> } | { ok: false; error: string };

type StepDef = {
  key: string;
  title: string;
  prompt: (ctx: WorkflowContext, data: Record<string, unknown>) => string[];
  options?: (ctx: WorkflowContext, data: Record<string, unknown>) => WorkflowOption[];
  parse: (input: string, ctx: WorkflowContext, data: Record<string, unknown>) => ParseResult;
};

type WorkflowDef = {
  id: WorkflowId;
  title: string;
  action: string;
  /** Dynamic so flows (like the inline Data Log Form builder) can grow steps. */
  steps: (data: Record<string, unknown>, ctx: WorkflowContext) => StepDef[];
  summary: (data: Record<string, unknown>, ctx: WorkflowContext) => string[];
  payload: (data: Record<string, unknown>, ctx: WorkflowContext) => Record<string, unknown>;
};

const SEVERITIES: WorkflowOption[] = [
  { id: 'low', label: 'Minor' },
  { id: 'medium', label: 'Moderate' },
  { id: 'high', label: 'Serious' },
  { id: 'critical', label: 'Emergency' },
];

const DEVICE_TYPES: WorkflowOption[] = [
  { id: 'mobile', label: 'Mobile patrol device' },
  { id: 'pda', label: 'RG360 / PDA' },
  { id: 'nfc_reader', label: 'NFC reader' },
  { id: 'tablet', label: 'Tablet' },
];

const FREQUENCIES: WorkflowOption[] = [
  { id: 'daily', label: 'Every day' },
  { id: 'weekdays', label: 'Weekdays only' },
  { id: 'weekends', label: 'Weekends only' },
  { id: 'hourly', label: 'Every hour' },
  { id: 'once', label: 'Once' },
];

const CHECKLIST_FIELDS = [
  { label: 'Door locked?', field_type: 'yes_no', required: true, sequence_order: 1 },
  { label: 'Lights working?', field_type: 'yes_no', required: true, sequence_order: 2 },
  { label: 'Area clear?', field_type: 'pass_fail', required: true, sequence_order: 3 },
  { label: 'Notes', field_type: 'long_text', required: false, sequence_order: 4 },
];

function pickOption(input: string, options: WorkflowOption[]): WorkflowOption | null {
  const trimmed = input.trim();
  const index = Number(trimmed);
  if (Number.isInteger(index) && index >= 1 && index <= options.length) return options[index - 1];
  const lower = trimmed.toLowerCase();
  return options.find((option) => option.label.toLowerCase() === lower || option.id.toLowerCase() === lower) ?? null;
}

function textStep(key: string, title: string, prompt: string, opts: { min?: number; max?: number } = {}): StepDef {
  return {
    key,
    title,
    prompt: () => [prompt],
    parse: (input) => {
      const value = input.trim();
      if (value.length < (opts.min ?? 2)) return { ok: false, error: `Please provide at least ${opts.min ?? 2} characters.` };
      return { ok: true, patch: { [key]: value.slice(0, opts.max ?? 120) } };
    },
  };
}

function choiceStep(key: string, title: string, prompt: string, options: WorkflowOption[]): StepDef {
  return {
    key,
    title,
    prompt: () => [prompt],
    options: () => options,
    parse: (input) => {
      const option = pickOption(input, options);
      if (!option) return { ok: false, error: 'Reply with one of the numbers listed.' };
      return { ok: true, patch: { [key]: option.id, [`${key}_label`]: option.label } };
    },
  };
}

const WORKFLOWS: Record<WorkflowId, WorkflowDef> = {
  register_incident: {
    id: 'register_incident',
    title: 'REGISTER INCIDENT',
    action: 'create_incident',
    steps: [
      textStep('description', 'Incident detail', 'What happened? Describe the incident.', { min: 3, max: 1000 }),
      choiceStep('severity', 'Severity', 'How serious is it?', SEVERITIES),
    ],
    summary: (data, ctx) => [
      `Description: ${data.description}`,
      `Severity: ${data.severity_label}`,
      `Site: ${ctx.siteName}`,
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      description: data.description,
      title: String(data.description).slice(0, 80),
      severity: data.severity,
      source: 'web_management_ai',
    }),
  },

  register_device: {
    id: 'register_device',
    title: 'REGISTER DEVICE',
    action: 'register_device',
    steps: [
      textStep('device_name', 'Device name', 'What should this device be called?', { min: 2, max: 100 }),
      choiceStep('device_type', 'Device type', 'What kind of device is this?', DEVICE_TYPES),
      {
        key: 'pairing_code',
        title: 'Pairing code',
        prompt: () => [
          'Open MX Patrol on the physical patrol device. While it is unpaired it shows a pairing code.',
          'Send that code exactly as displayed (e.g. MX-48768).',
        ],
        parse: (input) => {
          const code = input.trim().toUpperCase().replace(/^MXP?[-\s]?/, '').replace(/[\s-]/g, '');
          if (!/^[A-Z0-9]{5,10}$/.test(code)) {
            return { ok: false, error: 'That does not look like a pairing code. Send the code shown on the MX Patrol device, e.g. MX-48768.' };
          }
          return { ok: true, patch: { pairing_code: code } };
        },
      },
    ],
    summary: (data, ctx) => [
      `Device Name: ${data.device_name}`,
      `Device Type: ${data.device_type_label}`,
      `Assigned Site: ${ctx.siteName}`,
      `Pairing Code: MX-${data.pairing_code}`,
      'This pairing code must match the code currently displayed on the physical MX Patrol device.',
      'Reply confirm to bind this physical device to the new device record, or cancel to discard.',
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      device_name: data.device_name,
      device_type: data.device_type,
      pairing_code: data.pairing_code,
      enrolled_via: 'web_management_ai',
    }),
  },


  register_checkpoint: {
    id: 'register_checkpoint',
    title: 'REGISTER CHECKPOINT',
    action: 'create_checkpoint',
    steps: [
      textStep('name', 'Checkpoint name', 'What should this checkpoint be called?', { min: 2, max: 80 }),
      textStep('location_note', 'Zone / location', 'Which zone or location is it in?', { min: 2, max: 120 }),
      {
        key: 'nfc_tag_id',
        title: 'NFC assignment',
        prompt: () => ['Send the NFC tag UID for this checkpoint, or reply *later* to register it with pending NFC assignment.'],
        parse: (input) => {
          const value = input.trim().toLowerCase();
          if (['later', 'skip', 'pending', 'none'].includes(value)) return { ok: true, patch: { nfc_tag_id: '' } };
          const uid = value.replace(/[^a-f0-9]/g, '');
          if (uid.length < 6) return { ok: false, error: 'That does not look like an NFC UID. Send the UID, or reply *later*.' };
          return { ok: true, patch: { nfc_tag_id: uid } };
        },
      },
      {
        key: 'data_log_choice',
        title: 'Data Log Form',
        prompt: () => ['Should this checkpoint collect data when scanned?'],
        options: (ctx) => [
          { id: 'none', label: 'No form' },
          ...ctx.forms.slice(0, 8).map((form) => ({ id: `form:${form.id}`, label: `Use ${form.name}` })),
          { id: 'new_checklist', label: 'Create a new checklist form' },
        ],
        parse: (input, ctx) => {
          const options = [
            { id: 'none', label: 'No form' },
            ...ctx.forms.slice(0, 8).map((form) => ({ id: `form:${form.id}`, label: `Use ${form.name}` })),
            { id: 'new_checklist', label: 'Create a new checklist form' },
          ];
          const option = pickOption(input, options);
          if (!option) return { ok: false, error: 'Reply with one of the numbers listed.' };
          return { ok: true, patch: { data_log_choice: option.id, data_log_label: option.label } };
        },
      },
    ],
    summary: (data, ctx) => [
      `Checkpoint: ${data.name}`,
      `Zone: ${data.location_note}`,
      `Site: ${ctx.siteName}`,
      `NFC: ${data.nfc_tag_id ? `assigned (${data.nfc_tag_id})` : 'pending assignment'}`,
      `Data Log Form: ${data.data_log_label}`,
    ],
    payload: (data, ctx) => {
      const choice = String(data.data_log_choice ?? 'none');
      const input: Record<string, unknown> = {
        site_id: ctx.siteId,
        name: data.name,
        location_note: data.location_note,
        nfc_tag_id: data.nfc_tag_id ?? '',
      };
      if (choice.startsWith('form:')) input.data_log_form_id = choice.slice(5);
      if (choice === 'new_checklist') {
        input.new_form = { name: `${data.name} Inspection`, form_type: 'checklist', fields: CHECKLIST_FIELDS };
      }
      return input;
    },
  },

  create_patrol: {
    id: 'create_patrol',
    title: 'CREATE PATROL TEMPLATE',
    action: 'create_patrol_template',
    steps: [
      textStep('name', 'Patrol name', 'What should this patrol be called?', { min: 2, max: 80 }),
      {
        key: 'expected_duration_minutes',
        title: 'Expected duration',
        prompt: () => ['How many minutes should one patrol take? e.g. 45'],
        parse: (input) => {
          const value = Number(input.trim());
          if (!Number.isFinite(value) || value < 5 || value > 1440) return { ok: false, error: 'Send a duration in minutes between 5 and 1440.' };
          return { ok: true, patch: { expected_duration_minutes: Math.round(value) } };
        },
      },
    ],
    summary: (data, ctx) => [`Patrol: ${data.name}`, `Expected duration: ${data.expected_duration_minutes} min`, `Site: ${ctx.siteName}`],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      name: data.name,
      expected_duration_minutes: data.expected_duration_minutes,
      description: 'Created by the Web Management AI',
    }),
  },

  create_route: {
    id: 'create_route',
    title: 'CREATE ROUTE',
    action: 'create_route',
    steps: [
      textStep('name', 'Route name', 'What should this route be called?', { min: 2, max: 80 }),
      {
        key: 'checkpoint_ids',
        title: 'Checkpoints',
        prompt: (ctx) => [
          'Which checkpoints does this route cover, in patrol order?',
          ...ctx.checkpoints.map((cp, index) => `${index + 1}. ${cp.name}`),
          'Reply with numbers in order, e.g. 2,1,4 — or *all*.',
        ],
        parse: (input, ctx) => {
          if (!ctx.checkpoints.length) return { ok: false, error: 'This site has no checkpoints yet. Register a checkpoint first.' };
          const trimmed = input.trim().toLowerCase();
          const selected = trimmed === 'all'
            ? ctx.checkpoints
            : trimmed
              .split(/[,\s]+/)
              .map((part) => Number(part))
              .filter((value) => Number.isInteger(value) && value >= 1 && value <= ctx.checkpoints.length)
              .map((value) => ctx.checkpoints[value - 1]);
          if (!selected.length) return { ok: false, error: 'Reply with checkpoint numbers in order, e.g. 2,1,4 — or *all*.' };
          return {
            ok: true,
            patch: { checkpoint_ids: selected.map((cp) => cp.id), checkpoint_names: selected.map((cp) => cp.name) },
          };
        },
      },
      choiceStep('enforce_sequence', 'Sequence enforcement', 'Must guards scan the checkpoints strictly in order?', [
        { id: 'no', label: 'Any order' },
        { id: 'yes', label: 'Strict order' },
      ]),
    ],
    summary: (data, ctx) => [
      `Route: ${data.name}`,
      `Site: ${ctx.siteName}`,
      `Order: ${(data.checkpoint_names as string[]).map((name, index) => `${index + 1}. ${name}`).join(' → ')}`,
      `Sequence: ${data.enforce_sequence_label}`,
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      name: data.name,
      checkpoint_ids: data.checkpoint_ids,
      enforce_sequence: data.enforce_sequence === 'yes',
    }),
  },

  create_schedule: {
    id: 'create_schedule',
    title: 'CREATE SCHEDULE',
    action: 'create_schedule',
    steps: [
      {
        key: 'route_id',
        title: 'Route',
        prompt: (ctx) => ['Which route should run on this schedule?', ...ctx.routes.map((route, index) => `${index + 1}. ${route.name}`)],
        options: (ctx) => ctx.routes.map((route) => ({ id: route.id, label: route.name })),
        parse: (input, ctx) => {
          if (!ctx.routes.length) return { ok: false, error: 'This site has no routes yet. Create a route first.' };
          const option = pickOption(input, ctx.routes.map((route) => ({ id: route.id, label: route.name })));
          if (!option) return { ok: false, error: 'Reply with one of the route numbers listed.' };
          return { ok: true, patch: { route_id: option.id, route_name: option.label } };
        },
      },
      choiceStep('frequency', 'Frequency', 'How often should it run?', FREQUENCIES),
      {
        key: 'start_time',
        title: 'Start time',
        prompt: () => ['What time should it start? 24-hour format, e.g. 22:00'],
        parse: (input) => {
          const match = input.trim().match(/^(\d{1,2})[:h.]?(\d{2})?$/);
          if (!match) return { ok: false, error: 'Send a time like 22:00.' };
          const hours = Math.min(Number(match[1]), 23).toString().padStart(2, '0');
          const minutes = Math.min(Number(match[2] ?? '0'), 59).toString().padStart(2, '0');
          return { ok: true, patch: { start_time: `${hours}:${minutes}` } };
        },
      },
    ],
    summary: (data, ctx) => [
      `Route: ${data.route_name}`,
      `Site: ${ctx.siteName}`,
      `Frequency: ${data.frequency_label}`,
      `Start time: ${data.start_time}`,
      'Sessions and session checkpoints are generated by the existing patrol pipeline.',
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      route_id: data.route_id,
      name: `${data.route_name} Schedule`,
      frequency: data.frequency,
      start_time: data.start_time,
    }),
  },
};

export const WORKFLOW_IDS = Object.keys(WORKFLOWS) as WorkflowId[];

export function isWorkflowAction(action: string): action is WorkflowId {
  return (WORKFLOW_IDS as string[]).includes(action);
}

export function workflowTitle(id: WorkflowId): string {
  return WORKFLOWS[id].title;
}

const CANCEL_WORDS = ['cancel', 'stop', 'exit', 'abort'];

function promptFor(def: WorkflowDef, state: WorkflowState, ctx: WorkflowContext, prefix: string[] = []): WorkflowReply {
  const step = def.steps[state.stepIndex];
  return {
    kind: 'prompt',
    title: `${def.title} — ${step.title}`,
    lines: [...prefix, ...step.prompt(ctx, state.data)],
    options: step.options?.(ctx, state.data),
    state,
  };
}

function confirmFor(def: WorkflowDef, state: WorkflowState, ctx: WorkflowContext): WorkflowReply {
  return {
    kind: 'confirm',
    title: `${def.title} — CONFIRM`,
    lines: [...def.summary(state.data, ctx), 'Reply *confirm* to save, or *cancel* to discard. Nothing is written until you confirm.'],
    state,
    payload: { action: def.action, input: def.payload(state.data, ctx) },
  };
}

export function startWorkflow(id: WorkflowId, ctx: WorkflowContext): WorkflowReply {
  const def = WORKFLOWS[id];
  if (!ctx.canManage) {
    return { kind: 'denied', title: 'MANAGEMENT ACCESS REQUIRED', lines: ['Your account does not have permission for management actions.'] };
  }
  if (!ctx.siteId) {
    return { kind: 'denied', title: def.title, lines: ['Choose an active site before creating records.'] };
  }
  const state: WorkflowState = { id, stepIndex: 0, data: {} };
  return promptFor(def, state, ctx, [`Site: ${ctx.siteName}`]);
}

export function advanceWorkflow(state: WorkflowState, rawInput: string, ctx: WorkflowContext): WorkflowReply {
  const def = WORKFLOWS[state.id];
  const input = rawInput.trim();

  if (CANCEL_WORDS.includes(input.toLowerCase())) {
    return { kind: 'cancelled', title: `${def.title} — CANCELLED`, lines: ['Nothing was saved. No partial record was created.'] };
  }
  if (!ctx.canManage) {
    return { kind: 'denied', title: 'MANAGEMENT ACCESS REQUIRED', lines: ['Your account does not have permission for management actions.'] };
  }
  if (!ctx.siteId) {
    return { kind: 'denied', title: def.title, lines: ['Choose an active site before creating records.'] };
  }

  const step = def.steps[state.stepIndex];
  const parsed = step.parse(input, ctx, state.data);
  if (!('patch' in parsed)) {
    return {
      kind: 'error',
      title: `${def.title} — ${step.title}`,
      lines: [parsed.error, ...step.prompt(ctx, state.data)],
      options: step.options?.(ctx, state.data),
      state,
    };
  }

  const next: WorkflowState = { ...state, stepIndex: state.stepIndex + 1, data: { ...state.data, ...parsed.patch } };
  if (next.stepIndex >= def.steps.length) return confirmFor(def, next, ctx);
  return promptFor(def, next, ctx);
}
