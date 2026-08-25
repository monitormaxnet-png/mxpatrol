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
  | 'create_schedule'
  | 'authorize_whatsapp'
  | 'revoke_whatsapp_access';

export type WorkflowOption = { id: string; label: string };

export type WorkflowContext = {
  siteId: string | null;
  siteName: string;
  canManage: boolean;
  checkpoints: Array<{ id: string; name: string }>;
  routes: Array<{ id: string; name: string }>;
  forms: Array<{ id: string; name: string; field_count?: number }>;
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

const YES_NO_OPTIONS: WorkflowOption[] = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

const WHATSAPP_ACCESS_OPTIONS: WorkflowOption[] = [
  { id: 'user', label: 'User Assistant' },
  { id: 'management', label: 'Management Assistant' },
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

/* ---------------------- checkpoint + data log form flow -------------------- */

export type DraftFormField = { label: string; field_type: string; required: boolean; options_json: string[]; sequence_order: number };

/** Rebuild the ordered field list from the per-field answers held in workflow data. */
export function collectDraftFields(data: Record<string, unknown>): DraftFormField[] {
  const fields: DraftFormField[] = [];
  for (let index = 0; ; index += 1) {
    const label = data[`f${index}_label`];
    const type = data[`f${index}_type`];
    if (typeof label !== 'string' || typeof type !== 'string') break;
    fields.push({
      label,
      field_type: type,
      required: data[`f${index}_required`] === 'yes',
      options_json: Array.isArray(data[`f${index}_options`]) ? (data[`f${index}_options`] as string[]) : [],
      sequence_order: fields.length + 1,
    });
  }
  return fields;
}

const FIELD_TYPE_LINES = DATA_LOG_FIELD_TYPES.map((type, index) => `${index + 1}. ${type.label}`);

function fieldLabelStep(index: number): StepDef {
  return {
    key: `f${index}_label`,
    title: `Field ${index + 1} label`,
    prompt: () => [`What should field ${index + 1} be called? e.g. Door locked?`],
    parse: (input) => {
      const value = input.trim();
      if (value.length < 2) return { ok: false, error: 'Field labels need at least 2 characters.' };
      return { ok: true, patch: { [`f${index}_label`]: value.slice(0, 120) } };
    },
  };
}

function fieldTypeStep(index: number): StepDef {
  return {
    key: `f${index}_type`,
    title: `Field ${index + 1} type`,
    prompt: (_ctx, data) => [`Field type for "${data[`f${index}_label`]}"?`, ...FIELD_TYPE_LINES],
    options: () => DATA_LOG_FIELD_TYPES.map((type) => ({ id: type.id, label: type.label })),
    parse: (input) => {
      const type = pickFieldType(input);
      if (!type) return { ok: false, error: 'Reply with one of the field type numbers listed.' };
      return { ok: true, patch: { [`f${index}_type`]: type.id } };
    },
  };
}

function fieldOptionsStep(index: number): StepDef {
  return {
    key: `f${index}_options`,
    title: `Field ${index + 1} options`,
    prompt: () => ['List the choices separated by commas, e.g. Clear, Minor issue, Escalate'],
    parse: (input) => {
      const options = parseFieldOptions(input);
      if (options.length < 2) return { ok: false, error: 'Provide at least two comma-separated options.' };
      return { ok: true, patch: { [`f${index}_options`]: options } };
    },
  };
}

function fieldRequiredStep(index: number): StepDef {
  const options: WorkflowOption[] = [{ id: 'yes', label: 'Required' }, { id: 'no', label: 'Optional' }];
  return {
    key: `f${index}_required`,
    title: `Field ${index + 1} required?`,
    prompt: (_ctx, data) => [`Is "${data[`f${index}_label`]}" required?`],
    options: () => options,
    parse: (input) => {
      const option = pickOption(input, options);
      if (!option) return { ok: false, error: 'Reply 1 for required or 2 for optional.' };
      return { ok: true, patch: { [`f${index}_required`]: option.id } };
    },
  };
}

function fieldMoreStep(index: number): StepDef {
  const options: WorkflowOption[] = [{ id: 'yes', label: 'Add another field' }, { id: 'no', label: 'Done, continue' }];
  return {
    key: `f${index}_more`,
    title: 'Add another field?',
    prompt: (_ctx, data) => [`${collectDraftFields(data).length} field(s) captured. Add another field?`],
    options: () => options,
    parse: (input) => {
      const option = pickOption(input, options);
      if (!option) return { ok: false, error: 'Reply 1 to add another field or 2 to continue.' };
      return { ok: true, patch: { [`f${index}_more`]: option.id } };
    },
  };
}

function dataLogChoiceOptions(ctx: WorkflowContext): WorkflowOption[] {
  return [
    { id: 'none', label: 'No Data Log Form' },
    ...(ctx.forms.length ? [{ id: 'existing', label: 'Choose an existing form' }] : []),
    { id: 'new_form', label: 'Create a new Data Log Form' },
  ];
}

function checkpointSteps(data: Record<string, unknown>, ctx: WorkflowContext): StepDef[] {
  const steps: StepDef[] = [
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
      options: (context) => dataLogChoiceOptions(context),
      parse: (input, context) => {
        const option = pickOption(input, dataLogChoiceOptions(context));
        if (!option) return { ok: false, error: 'Reply with one of the numbers listed.' };
        return { ok: true, patch: { data_log_choice: option.id, data_log_label: option.label } };
      },
    },
  ];

  const choice = data.data_log_choice;

  if (choice === 'existing') {
    steps.push({
      key: 'data_log_form_id',
      title: 'Select form',
      prompt: (context) => ['Which Data Log Form should be attached?', ...context.forms.map((form, index) => `${index + 1}. ${form.name}`)],
      options: (context) => context.forms.map((form) => ({ id: form.id, label: form.name })),
      parse: (input, context) => {
        if (!context.forms.length) return { ok: false, error: 'No Data Log Forms exist for this site yet.' };
        const option = pickOption(input, context.forms.map((form) => ({ id: form.id, label: form.name })));
        if (!option) return { ok: false, error: 'Reply with one of the form numbers listed.' };
        const selected = context.forms.find((form) => form.id === option.id);
        return {
          ok: true,
          patch: {
            data_log_form_id: option.id,
            data_log_form_name: option.label,
            data_log_form_field_count: (selected as { field_count?: number } | undefined)?.field_count ?? null,
          },
        };
      },
    });
  }

  if (choice === 'new_form') {
    steps.push(textStep('form_name', 'Form name', 'What should the new Data Log Form be called?', { min: 2, max: 120 }));
    if (typeof data.form_name === 'string') {
      for (let index = 0; ; index += 1) {
        steps.push(fieldLabelStep(index));
        if (typeof data[`f${index}_label`] !== 'string') break;
        steps.push(fieldTypeStep(index));
        const type = data[`f${index}_type`];
        if (typeof type !== 'string') break;
        if (fieldTypeNeedsOptions(type)) {
          steps.push(fieldOptionsStep(index));
          if (!Array.isArray(data[`f${index}_options`])) break;
        }
        steps.push(fieldRequiredStep(index));
        if (typeof data[`f${index}_required`] !== 'string') break;
        steps.push(fieldMoreStep(index));
        if (data[`f${index}_more`] !== 'yes') break;
      }
    }
  }

  return steps;
}

const WORKFLOWS: Record<WorkflowId, WorkflowDef> = {
  register_incident: {
    id: 'register_incident',
    title: 'REGISTER INCIDENT',
    action: 'create_incident',
    steps: () => [
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
    steps: () => [
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
    steps: (data, ctx) => checkpointSteps(data, ctx),
    summary: (data, ctx) => {
      const fields = collectDraftFields(data);
      const formLabel = data.data_log_choice === 'new_form'
        ? `${data.form_name} (new)`
        : String(data.data_log_form_name ?? 'None');
      return [
        `Checkpoint: ${data.name}`,
        `Zone / Location: ${data.location_note}`,
        `Site: ${ctx.siteName}`,
        `NFC: ${data.nfc_tag_id ? `assigned (${data.nfc_tag_id})` : 'pending'}`,
        `Data Log Form: ${formLabel}`,
        ...(data.data_log_choice === 'new_form'
          ? [
            `Fields: ${fields.length}`,
            ...fields.map((field, index) =>
              `  ${index + 1}. ${field.label} — ${fieldTypeById(field.field_type)?.label ?? field.field_type}` +
              `${field.required ? ' (required)' : ' (optional)'}` +
              `${field.options_json.length ? ` [${field.options_json.join(', ')}]` : ''}`),
          ]
          : data.data_log_form_id
            ? [`Fields: ${data.data_log_form_field_count ?? '—'}`]
            : []),
      ];
    },
    payload: (data, ctx) => {
      const input: Record<string, unknown> = {
        site_id: ctx.siteId,
        name: data.name,
        location_note: data.location_note,
        nfc_tag_id: data.nfc_tag_id ?? '',
      };
      if (data.data_log_choice === 'existing' && data.data_log_form_id) {
        input.data_log_form_id = data.data_log_form_id;
      }
      if (data.data_log_choice === 'new_form') {
        input.new_form = { name: data.form_name, fields: collectDraftFields(data) };
      }
      return input;
    },
  },

  create_patrol: {
    id: 'create_patrol',
    title: 'CREATE PATROL TEMPLATE',
    action: 'create_patrol_template',
    steps: () => [
      textStep('name', 'Patrol name', 'What should this patrol template be called?', { min: 2, max: 80 }),
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
      textStep('description', 'Description / purpose', 'What is the purpose of this patrol? e.g. Night perimeter inspection', { min: 3, max: 500 }),
      choiceStep('sequential_scanning', 'Sequential scanning', 'Should routes created from this template require checkpoint scans in order?', YES_NO_OPTIONS),
      choiceStep('offline_scans_allowed', 'Offline scans', 'Should offline scans be allowed and synced later when supported by the patrol device?', YES_NO_OPTIONS),
    ],
    summary: (data, ctx) => [
      `Patrol Name: ${data.name}`,
      `Site: ${ctx.siteName}`,
      `Expected Duration: ${data.expected_duration_minutes} min`,
      `Description: ${data.description}`,
      '',
      'Operational Rules:',
      '- Checkpoints required',
      `- Sequential scanning: ${data.sequential_scanning_label}`,
      `- Expected completion: ${data.expected_duration_minutes} min`,
      '- Missed checkpoints recorded',
      '- Late / incomplete tracking enabled',
      `- Offline scans allowed: ${data.offline_scans_allowed_label}`,
      '',
      'Route: Not assigned yet',
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      name: data.name,
      expected_duration_minutes: data.expected_duration_minutes,
      description: data.description,
      operational_rules: {
        checkpoints_required: true,
        sequential_scanning: data.sequential_scanning === 'yes',
        expected_duration_enforced: true,
        missed_checkpoints_recorded: true,
        late_start_tracking: true,
        incomplete_patrol_tracking: true,
        offline_scans_allowed: data.offline_scans_allowed === 'yes',
      },
    }),
  },
  create_route: {
    id: 'create_route',
    title: 'CREATE ROUTE',
    action: 'create_route',
    steps: () => [
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


  authorize_whatsapp: {
    id: 'authorize_whatsapp',
    title: 'AUTHORIZE WHATSAPP NUMBER',
    action: 'create_whatsapp_authorization',
    steps: () => [
      {
        key: 'target_user_id',
        title: 'MX Patrol user',
        prompt: (ctx) => ctx.users.length
          ? ['Who should receive WhatsApp access?', ...ctx.users.map((user, index) => String(index + 1) + '. ' + user.name + (user.role ? ' (' + user.role + ')' : '') + (user.phone ? ' - ' + user.phone : ''))]
          : ['Type the exact MX Patrol user full name. The backend will only authorize a user in your company.'],
        options: (ctx) => ctx.users.map((user) => ({ id: user.id, label: user.name })),
        parse: (input, ctx) => {
          if (!ctx.users.length) {
            const value = input.trim();
            if (value.length < 2) return { ok: false, error: 'Please provide the user full name.' };
            return { ok: true, patch: { target_user: value, display_name: value } };
          }
          const option = pickOption(input, ctx.users.map((user) => ({ id: user.id, label: user.name })));
          if (!option) return { ok: false, error: 'Reply with one of the user numbers listed.' };
          const user = ctx.users.find((row) => row.id === option.id);
          return { ok: true, patch: { target_user_id: option.id, target_user: option.label, display_name: option.label, user_phone: user?.phone ?? '' } };
        },
      },
      {
        key: 'phone',
        title: 'WhatsApp number',
        prompt: (_ctx, data) => ['WhatsApp number for ' + data.display_name + '? Include country code, e.g. +26771234567.'],
        parse: (input) => {
          const value = input.trim().replace(/^whatsapp:/i, '').replace(/[^+0-9]/g, '');
          const normalized = value.startsWith('+') ? value : '+' + value;
          if (!/^\+\d{7,15}$/.test(normalized)) return { ok: false, error: 'Send the WhatsApp number with country code, e.g. +26771234567.' };
          return { ok: true, patch: { phone: normalized } };
        },
      },
      choiceStep('access_type', 'Access type', 'Which assistant should this number use?', WHATSAPP_ACCESS_OPTIONS),
    ],
    summary: (data, ctx) => [
      'User: ' + data.display_name,
      'WhatsApp Number: ' + data.phone,
      'Access: ' + data.access_type_label,
      'Site: ' + ctx.siteName,
      '',
      'A link code will be created. Nothing is active until that person sends the code from the same WhatsApp number.',
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      target_user_id: data.target_user_id,
      target_user: data.target_user,
      display_name: data.display_name,
      phone: data.phone,
      access_type: data.access_type,
      created_via: 'web_management_ai',
    }),
  },

  revoke_whatsapp_access: {
    id: 'revoke_whatsapp_access',
    title: 'REVOKE WHATSAPP ACCESS',
    action: 'revoke_whatsapp_authorization',
    steps: () => [
      {
        key: 'authorization_id',
        title: 'Authorized number',
        prompt: (ctx) => ctx.whatsappAuthorizations.length
          ? ['Which WhatsApp authorization should be revoked?', ...ctx.whatsappAuthorizations.map((row, index) => String(index + 1) + '. ' + (row.display_name ?? 'Unknown') + ' - ' + (row.masked_phone ?? row.phone ?? 'Not linked') + ' (' + (row.status ?? 'unknown') + ')')]
          : ['No WhatsApp authorizations are loaded for this site.'],
        options: (ctx) => ctx.whatsappAuthorizations.map((row) => ({ id: row.id, label: (row.display_name ?? 'Unknown') + ' - ' + (row.masked_phone ?? row.phone ?? 'Not linked') })),
        parse: (input, ctx) => {
          if (!ctx.whatsappAuthorizations.length) return { ok: false, error: 'No WhatsApp authorizations are available to revoke.' };
          const option = pickOption(input, ctx.whatsappAuthorizations.map((row) => ({ id: row.id, label: (row.display_name ?? 'Unknown') + ' - ' + (row.masked_phone ?? row.phone ?? 'Not linked') })));
          if (!option) return { ok: false, error: 'Reply with one of the authorization numbers listed.' };
          return { ok: true, patch: { authorization_id: option.id, authorization_label: option.label } };
        },
      },
    ],
    summary: (data, ctx) => [
      'Authorization: ' + data.authorization_label,
      'Site: ' + ctx.siteName,
      'This will revoke WhatsApp access and clear the active WhatsApp session.',
    ],
    payload: (data, ctx) => ({
      site_id: ctx.siteId,
      authorization_id: data.authorization_id,
    }),
  },

  create_schedule: {
    id: 'create_schedule',
    title: 'CREATE SCHEDULE',
    action: 'create_schedule',
    steps: () => [
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
  const step = def.steps(state.data, ctx)[state.stepIndex];
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

  const step = def.steps(state.data, ctx)[state.stepIndex];
  if (!step) return confirmFor(def, state, ctx);
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
  if (next.stepIndex >= def.steps(next.data, ctx).length) return confirmFor(def, next, ctx);
  return promptFor(def, next, ctx);
}
