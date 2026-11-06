import { assertCanManage, assertPlatformOwner, ManagementActionError, type ManagementActor } from './management-actions.ts';

type Client = any;
type Sheet = 'Companies' | 'Sites' | 'Devices' | 'Checkpoints' | 'Guards' | 'WhatsApp Users';
type Row = { sheet: Sheet; rowNumber: number; values: Record<string, string> };
type Verdict = { sheet: Sheet; rowNumber: number; status: 'ready' | 'existing' | 'invalid' | 'conflicting'; message: string };
const order: Sheet[] = ['Companies', 'Sites', 'Devices', 'Checkpoints', 'Guards', 'WhatsApp Users'];
const fields: Record<Sheet, string[]> = {
  Companies: ['Company Code', 'Company Name'],
  Sites: ['Site Code', 'Site Name', 'Company Code'],
  Devices: ['Device Name', 'Device ID', 'Serial Number', 'Company Code', 'Site Code'],
  Checkpoints: ['Checkpoint Name', 'NFC UID', 'Company Code', 'Site Code'],
  Guards: ['Guard ID', 'Full Name', 'Company Code', 'Site Code'],
  'WhatsApp Users': ['Name', 'Phone Number', 'Company Code', 'Site Code', 'Requested Role'],
};
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const upper = (value: unknown) => clean(value).toUpperCase();
export const escapeIlikeLiteral = (value: string) => value.replace(/[\\%_]/g, '\\$&');
// Keep in sync with the scanner's normalizeNfcUid in src/lib/nfcUid.ts.
export const normalizeBulkNfcUid = (value: unknown) => clean(value).replace(/[\s:.-]/g, '').toLowerCase();
const authorize = (actor: ManagementActor) => {
  if (!actor.user_id) throw new ManagementActionError('Authenticated user required', 401);
  if (actor.isPlatformOwner && actor.user_id) return;
  assertCanManage(actor);
};
const rowKeys = (row: Row) => {
  const v = row.values ?? {};
  const company = upper(v['Company Code']);
  const site = upper(v['Site Code']);
  if (row.sheet === 'Companies') return [`company:${company}`];
  if (row.sheet === 'Sites') return [`site:${company}:${site}`];
  if (row.sheet === 'Devices') return [`device-serial:${upper(v['Serial Number'])}`, `device-id:${company}:${upper(v['Device ID'])}`];
  if (row.sheet === 'Checkpoints') return [`checkpoint:${company}:${normalizeBulkNfcUid(v['NFC UID'])}`];
  if (row.sheet === 'Guards') return [`guard:${company}:${upper(v['Employee Number'] || v['Guard ID'])}`];
  return [`whatsapp:${upper(v['Phone Number'])}`];
};

function validate(row: Row, actor: ManagementActor): string | null {
  if (!order.includes(row.sheet) || !row.values || typeof row.values !== 'object') return 'Unsupported registration category';
  if (!Number.isInteger(row.rowNumber) || row.rowNumber < 2) return 'Invalid spreadsheet row';
  if (fields[row.sheet].some((key) => !clean(row.values[key]))) return 'Required field is missing';
  if (Object.values(row.values).some((value) => typeof value !== 'string' || value.length > 250)) return 'Field exceeds 250 characters';
  if (!/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(upper(row.values['Company Code']))) return 'Company Code must be 2 to 40 letters, digits, underscores or hyphens';
  if (row.sheet !== 'Companies' && !/^[A-Z0-9][A-Z0-9_-]{1,39}$/.test(upper(row.values['Site Code']))) return 'Site Code must be 2 to 40 letters, digits, underscores or hyphens';
  if (row.sheet === 'Companies' && !actor.isPlatformOwner) return 'Only the platform owner may register companies';
  if (row.sheet === 'WhatsApp Users') {
    if (!/^\+[1-9]\d{7,14}$/.test(clean(row.values['Phone Number']))) return 'Phone number must be international format';
    if (!['user', 'guard', 'supervisor', 'admin'].includes(clean(row.values['Requested Role']).toLowerCase())) return 'Invalid requested role';
  }
  if (row.sheet === 'Checkpoints' && !['', 'yes', 'no', 'true', 'false'].includes(clean(row.values.Active).toLowerCase())) return 'Active must be Yes or No';
  if (row.sheet === 'Checkpoints' && !['', 'yes', 'no', 'true', 'false'].includes(clean(row.values['Datalog Enabled']).toLowerCase())) return 'Datalog Enabled must be Yes or No';
  if (row.sheet === 'Checkpoints' && !/^[a-z0-9]+$/.test(normalizeBulkNfcUid(row.values['NFC UID']))) return 'NFC UID must contain letters or digits';
  return null;
}

async function one(query: any): Promise<any> {
  const { data, error } = await query.maybeSingle();
  if (error) throw new ManagementActionError(error.message, 500);
  return data;
}

async function identifier(client: Client, kind: string, value: string, companyId: string | null = null): Promise<any> {
  const { data, error } = await client.rpc('lookup_bulk_registration_identifier', {
    p_kind: kind, p_value: value, p_company_id: companyId,
  });
  if (error) throw new ManagementActionError(error.message, 500);
  return data;
}

async function companyFor(client: Client, actor: ManagementActor, row: Row): Promise<any> {
  const code = upper(row.values['Company Code']);
  const company = await identifier(client, 'company_code', code);
  if (!company) return null;
  if (!actor.isPlatformOwner && company.id !== actor.company_id) throw new ManagementActionError('Company is outside your access', 403);
  return company;
}

async function siteFor(client: Client, companyId: string, row: Row): Promise<any> {
  return identifier(client, 'site_code', upper(row.values['Site Code']), companyId);
}

async function assess(client: Client, actor: ManagementActor, row: Row, plannedCompanies: Set<string>, plannedSites: Set<string>): Promise<Verdict> {
  const fail = validate(row, actor);
  const base = { sheet: row.sheet, rowNumber: row.rowNumber };
  if (fail) return { ...base, status: 'invalid', message: fail };
  const v = row.values;
  if (row.sheet === 'Companies') {
    const code = upper(v['Company Code']);
    const byCode = await identifier(client, 'company_code', code);
    if (byCode) return { ...base, status: byCode.name.toLowerCase() === clean(v['Company Name']).toLowerCase() ? 'existing' : 'conflicting', message: `Company code belongs to ${byCode.name}` };
    const byName = await one(client.from('companies').select('id, name').ilike('name', escapeIlikeLiteral(clean(v['Company Name']))).limit(1));
    return byName ? { ...base, status: 'conflicting', message: 'Company name already exists under another code' } : { ...base, status: 'ready', message: 'Create company' };
  }
  let company: any;
  try { company = await companyFor(client, actor, row); }
  catch (error) { return { ...base, status: 'invalid', message: error instanceof Error ? error.message : 'Company access denied' }; }
  const companyCode = upper(v['Company Code']);
  if (!company && !plannedCompanies.has(companyCode)) return { ...base, status: 'invalid', message: 'Company Code does not exist' };
  if (row.sheet === 'Sites') {
    if (!company) return { ...base, status: 'ready', message: 'Create site after company' };
    const existing = await siteFor(client, company.id, row);
    if (existing) return { ...base, status: existing.name.toLowerCase() === clean(v['Site Name']).toLowerCase() ? 'existing' : 'conflicting', message: `Site code belongs to ${existing.name}` };
    const byName = await one(client.from('sites').select('id').eq('company_id', company.id).ilike('name', escapeIlikeLiteral(clean(v['Site Name']))).limit(1));
    return byName ? { ...base, status: 'conflicting', message: 'Site name already exists under another code' } : { ...base, status: 'ready', message: 'Create site' };
  }
  const site = company ? await siteFor(client, company.id, row) : null;
  if (!site && !plannedSites.has(`${companyCode}:${upper(v['Site Code'])}`)) return { ...base, status: 'invalid', message: 'Site Code does not exist' };
  if (row.sheet === 'Devices') {
    const serial = await identifier(client, 'device_serial', clean(v['Serial Number']));
    const identity = company ? await identifier(client, 'device_identity', clean(v['Device ID']), company.id) : null;
    if ((serial && serial.company_id !== company?.id) || (identity && identity.company_id !== company?.id)) return { ...base, status: 'conflicting', message: 'Device identity belongs to another company' };
    if (serial && identity && serial.id !== identity.id) return { ...base, status: 'conflicting', message: 'Serial number and device ID belong to different records' };
    if ((serial && !identity) || (identity && !serial)) return { ...base, status: 'conflicting', message: 'Device identity is already registered with different details' };
    return { ...base, status: serial || identity ? 'existing' : 'ready', message: serial || identity ? 'Device profile already exists' : 'Create unpaired device profile' };
  }
  if (row.sheet === 'Checkpoints') {
    const tag = company ? await identifier(client, 'checkpoint_nfc', normalizeBulkNfcUid(v['NFC UID']), company.id) : null;
    if (tag) return { ...base, status: tag.company_id === company?.id && tag.site_id === site?.id && tag.name.toLowerCase() === clean(v['Checkpoint Name']).toLowerCase() ? 'existing' : 'conflicting', message: 'NFC UID is already assigned' };
    return { ...base, status: 'ready', message: 'Create checkpoint; pending scans remain pending' };
  }
  if (row.sheet === 'Guards') {
    const number = upper(v['Employee Number'] || v['Guard ID']);
    const guard = company ? await identifier(client, 'guard_employee', number, company.id) : null;
    if (guard && guard.full_name.toLowerCase() !== clean(v['Full Name']).toLowerCase()) return { ...base, status: 'conflicting', message: 'Employee number belongs to a different guard' };
    return { ...base, status: guard ? 'existing' : 'ready', message: guard ? 'Guard already exists' : 'Create guard profile without biometric enrollment' };
  }
  const phone = await one(client.from('whatsapp_authorized_numbers').select('id, company_id').eq('phone', clean(v['Phone Number'])));
  return { ...base, status: phone ? phone.company_id === company?.id ? 'existing' : 'conflicting' : 'ready', message: phone ? 'Phone already registered' : 'Create pending, unverified phone profile' };
}

export async function previewBulkRegistration(client: Client, actor: ManagementActor, raw: unknown) {
  authorize(actor);
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 500) throw new ManagementActionError('Upload 1 to 500 rows per preview');
  const rows: Row[] = raw.map((entry) => ({ sheet: entry?.sheet, rowNumber: entry?.rowNumber, values: entry?.values }));
  rows.sort((a, b) => order.indexOf(a.sheet) - order.indexOf(b.sheet) || a.rowNumber - b.rowNumber);
  const plannedCompanies = new Set<string>();
  const plannedSites = new Set<string>();
  const seen = new Set<string>();
  const verdicts: Verdict[] = [];
  for (const row of rows) {
    const keys = rowKeys(row);
    if (keys.some((key) => seen.has(key))) { verdicts.push({ sheet: row.sheet, rowNumber: row.rowNumber, status: 'conflicting', message: 'Duplicate row in workbook' }); continue; }
    keys.forEach((key) => seen.add(key));
    const verdict = await assess(client, actor, row, plannedCompanies, plannedSites);
    verdicts.push(verdict);
    if (verdict.status === 'ready' || verdict.status === 'existing') {
      if (row.sheet === 'Companies') plannedCompanies.add(upper(row.values['Company Code']));
      if (row.sheet === 'Sites') plannedSites.add(`${upper(row.values['Company Code'])}:${upper(row.values['Site Code'])}`);
    }
  }
  const { data, error } = await client.from('bulk_registration_jobs').insert({
    user_id: actor.user_id, company_id: actor.company_id,
    is_platform_owner: actor.isPlatformOwner === true, rows,
  }).select('id').single();
  if (error) throw new ManagementActionError(error.message, 500);
  return { job_id: data.id, rows: verdicts };
}

export async function commitBulkRegistration(client: Client, actor: ManagementActor, jobId: string) {
  authorize(actor);
  const { data: job, error: jobError } = await client.from('bulk_registration_jobs').select('id, user_id, company_id, is_platform_owner, expires_at').eq('id', jobId).eq('user_id', actor.user_id).single();
  if (jobError || !job || job.company_id !== actor.company_id || job.is_platform_owner !== (actor.isPlatformOwner === true)) {
    throw new ManagementActionError('Import preview not found for your account', 404);
  }
  const context = { p_job_id: jobId, p_user_id: actor.user_id,
    p_company_id: actor.company_id, p_is_platform_owner: actor.isPlatformOwner === true };
  const { data: claim, error: claimError } = await client.rpc('claim_bulk_registration_batch', { ...context, p_limit: 40 });
  if (claimError) throw new ManagementActionError(claimError.message, 409);
  if (claim.done) return claim;
  if (!claim.claim_token || !Array.isArray(claim.rows) || claim.rows.length < 1 || claim.rows.length > 40) {
    throw new ManagementActionError('Invalid import batch claim', 500);
  }
  const results: Verdict[] = [];
  for (const row of claim.rows as Row[]) {
    try {
      const verdict = await assess(client, actor, row, new Set(), new Set());
      if (verdict.status !== 'ready') { results.push(verdict); continue; }
      const v = row.values;
      if (row.sheet === 'Companies') {
        assertPlatformOwner(actor);
        const { error } = await client.from('companies').insert({ name: clean(v['Company Name']), registration_code: upper(v['Company Code']), settings: { status: 'inactive', contact_name: clean(v['Contact Person']), contact_phone: clean(v.Phone), contact_email: clean(v.Email), address: clean(v.Address), created_via: 'bulk_registration' } });
        if (error) throw error;
      } else {
        const company = await companyFor(client, actor, row);
        if (!company) throw new Error('Company dependency was not created');
        if (row.sheet === 'Sites') {
          const { error } = await client.from('sites').insert({ company_id: company.id, registration_code: upper(v['Site Code']), name: clean(v['Site Name']), address: clean(v.Address), status: 'inactive' });
          if (error) throw error;
        } else {
          const site = await siteFor(client, company.id, row);
          if (!site) throw new Error('Site dependency was not created');
          const insert = row.sheet === 'Devices'
            ? { table: 'devices', values: { company_id: company.id, site_id: site.id, device_name: clean(v['Device Name']), device_identifier: clean(v['Device ID']), serial_number: clean(v['Serial Number']), status: 'offline', pairing_status: 'unpaired' } }
            : row.sheet === 'Checkpoints'
            ? { table: 'checkpoints', values: { company_id: company.id, site_id: site.id, name: clean(v['Checkpoint Name']), nfc_tag_id: normalizeBulkNfcUid(v['NFC UID']), location_note: clean(v.Zone), status: ['no', 'false'].includes(clean(v.Active).toLowerCase()) ? 'inactive' : 'active', data_log_enabled: ['yes', 'true'].includes(clean(v['Datalog Enabled']).toLowerCase()) } }
            : row.sheet === 'Guards'
            ? { table: 'guards', values: { company_id: company.id, site_id: site.id, badge_number: clean(v['Guard ID']), employee_number: upper(v['Employee Number'] || v['Guard ID']), full_name: clean(v['Full Name']), phone: clean(v.Phone) || null, is_active: false } }
            : { table: 'whatsapp_authorized_numbers', values: { company_id: company.id, phone: clean(v['Phone Number']), display_name: clean(v.Name), status: 'pending', allowed_site_ids: [site.id], metadata: { requested_role: clean(v['Requested Role']), created_via: 'bulk_registration', verification_required: true } } };
          const { error } = await client.from(insert.table).insert(insert.values);
          if (error) throw error;
        }
      }
      results.push({ sheet: row.sheet, rowNumber: row.rowNumber, status: 'ready', message: 'Registered' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        try {
          const existing = await assess(client, actor, row, new Set(), new Set());
          if (existing.status === 'existing') { results.push(existing); continue; }
        } catch { /* Preserve the original database error below. */ }
      }
      const message = error && typeof error === 'object' && 'message' in error ? String(error.message) : 'Registration failed';
      results.push({ sheet: row.sheet, rowNumber: row.rowNumber, status: 'invalid', message });
    }
  }
  const { data, error } = await client.rpc('complete_bulk_registration_batch', {
    ...context, p_cursor: claim.cursor, p_claim_token: claim.claim_token, p_results: results,
  });
  if (error) throw new ManagementActionError(error.message, 500);
  return data;
}
