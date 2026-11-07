import { describe, expect, it } from 'vitest';
import { commitBulkRegistration, previewBulkRegistration } from '../../supabase/functions/_shared/bulk-registration';

const owner = { user_id: 'owner-1', company_id: null, isPlatformOwner: true, role: 'admin', canManage: true };
const manager = { user_id: 'manager-1', company_id: 'company-1', isPlatformOwner: false, role: 'admin', canManage: true };

function fakeClient(failTable?: string) {
  const records: Record<string, Record<string, any>[]> = { companies: [], sites: [], devices: [], checkpoints: [], guards: [], whatsapp_authorized_numbers: [], bulk_registration_jobs: [] };
  let inserts = 0;
  const client = {
    records,
    get inserts() { return inserts; },
    from(table: string) {
      let filters: Array<[string, unknown]> = [];
      const query: any = {
        select() { return query; },
        eq(column: string, value: unknown) { filters.push([column, value]); return query; },
        ilike(column: string, value: unknown) { filters.push([column, String(value).toLowerCase()]); return query; },
        limit() { return query; },
        async maybeSingle() {
          const row = records[table]?.find((candidate) => filters.every(([column, value]) => String(candidate[column]).toLowerCase() === String(value).toLowerCase()));
          return { data: row ?? null, error: null };
        },
        async single() { const result = await query.maybeSingle(); return result.data ? result : { data: null, error: { message: 'not found' } }; },
        insert(value: Record<string, any>) {
          if (table === failTable) return { error: { message: 'simulated insert failure' } };
          inserts += 1;
          const row = { id: `${table}-${inserts}`, result_rows: [], cursor: 0, ...value };
          records[table].push(row);
          return { select() { return { async single() { return { data: row, error: null }; } }; }, error: null };
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, any>) {
      if (name === 'lookup_bulk_registration_identifier') {
        const sources: Record<string, [string, string]> = {
          company_code: ['companies', 'registration_code'],
          site_code: ['sites', 'registration_code'],
          device_serial: ['devices', 'serial_number'],
          device_identity: ['devices', 'device_identifier'],
          checkpoint_nfc: ['checkpoints', 'nfc_tag_id'],
          guard_employee: ['guards', 'employee_number'],
        };
        const [table, column] = sources[args.p_kind];
        const row = records[table].find((candidate) =>
          (args.p_company_id == null || candidate.company_id === args.p_company_id)
          && String(candidate[column] ?? '').trim().toUpperCase() === String(args.p_value).trim().toUpperCase());
        return { data: row ?? null, error: null };
      }
      const job = records.bulk_registration_jobs.find((row) => row.id === args.p_job_id);
      if (!job) return { data: null, error: { message: 'missing job' } };
      if (job.user_id !== args.p_user_id || job.company_id !== args.p_company_id || job.is_platform_owner !== args.p_is_platform_owner) {
        return { data: null, error: { message: 'job context mismatch' } };
      }
      if (name === 'claim_bulk_registration_batch') {
        if (job.cursor >= job.rows.length) return { data: { done: true, results: job.result_rows }, error: null };
        if (job.status === 'processing') return { data: null, error: { message: 'already processing' } };
        job.status = 'processing';
        job.claim_token = 'claim-1';
        job.claimed_count = Math.min(40, job.rows.length - job.cursor);
        return { data: { done: false, cursor: job.cursor, claim_token: job.claim_token, rows: job.rows.slice(job.cursor, job.cursor + job.claimed_count) }, error: null };
      }
      if (job.status !== 'processing' || job.claim_token !== args.p_claim_token || job.cursor !== args.p_cursor) {
        return { data: null, error: { message: 'batch changed' } };
      }
      if (!Array.isArray(args.p_results) || args.p_results.length !== job.claimed_count) {
        return { data: null, error: { message: 'incomplete batch result' } };
      }
      job.cursor += job.claimed_count;
      job.result_rows.push(...args.p_results);
      job.status = job.cursor >= job.rows.length ? 'completed' : 'preview';
      job.claimed_count = 0;
      job.claim_token = null;
      return { data: { done: job.cursor >= job.rows.length, results: job.result_rows }, error: null };
    },
  };
  return client;
}

describe('server bulk registration', () => {
  it('only lets the platform owner create a company and safely retries', async () => {
    const client = fakeClient();
    const rows = [{ sheet: 'Companies', rowNumber: 2, values: { 'Company Code': 'ACME', 'Company Name': 'Acme Security' } }];
    const denied = await previewBulkRegistration(client, manager, rows);
    expect(denied.rows[0].status).toBe('invalid');
    const preview = await previewBulkRegistration(client, owner, rows);
    expect(preview.rows[0].status).toBe('ready');
    const first = await commitBulkRegistration(client, owner, preview.job_id);
    expect(first.results[0].message).toBe('Registered');
    expect(client.records.companies).toHaveLength(1);
    await commitBulkRegistration(client, owner, preview.job_id);
    expect(client.records.companies).toHaveLength(1);
  });

  it('creates device profiles unpaired and refuses cross-company references', async () => {
    const client = fakeClient();
    client.records.companies.push({ id: 'company-1', name: 'Acme', registration_code: 'ACME' });
    client.records.sites.push({ id: 'site-1', company_id: 'company-1', name: 'HQ', registration_code: 'HQ' });
    const rows = [{ sheet: 'Devices', rowNumber: 2, values: { 'Device Name': 'RG360-01', 'Device ID': 'rg360-01', 'Serial Number': 'serial-01', 'Company Code': 'ACME', 'Site Code': 'HQ' } }];
    const preview = await previewBulkRegistration(client, manager, rows);
    expect(preview.rows[0].status).toBe('ready');
    await commitBulkRegistration(client, manager, preview.job_id);
    expect(client.records.devices[0]).toMatchObject({ pairing_status: 'unpaired', status: 'offline', company_id: 'company-1' });
    expect(client.records.devices[0].pairing_code).toBeUndefined();
    const outsider = { ...manager, company_id: 'another-company' };
    const denied = await previewBulkRegistration(client, outsider, rows);
    expect(denied.rows[0].status).toBe('invalid');
  });

  it('resolves master workbook dependencies and keeps WhatsApp access pending', async () => {
    const client = fakeClient();
    const rows = [
      { sheet: 'Companies', rowNumber: 2, values: { 'Company Code': 'ACME', 'Company Name': 'Acme Security' } },
      { sheet: 'Sites', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Site Name': 'Head Office' } },
      { sheet: 'Checkpoints', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Checkpoint Name': 'Gate', 'NFC UID': 'TAG-01', Active: 'Yes', 'Datalog Enabled': 'No' } },
      { sheet: 'Guards', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Guard ID': 'G-01', 'Full Name': 'Test Guard' } },
      { sheet: 'WhatsApp Users', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', Name: 'Test Guard', 'Phone Number': '+26771123456', 'Requested Role': 'guard' } },
    ];
    const preview = await previewBulkRegistration(client, owner, rows);
    expect(preview.rows.every((row: { status: string }) => row.status === 'ready')).toBe(true);
    const result = await commitBulkRegistration(client, owner, preview.job_id);
    expect(result.results).toHaveLength(5);
    expect(result.results.every((row: { message: string }) => row.message === 'Registered')).toBe(true);
    expect(client.records.checkpoints[0].site_id).toBe(client.records.sites[0].id);
    expect(client.records.guards[0]).toMatchObject({ is_active: false, company_id: client.records.companies[0].id });
    expect(client.records.whatsapp_authorized_numbers[0]).toMatchObject({ status: 'pending', company_id: client.records.companies[0].id });
    expect(client.records.whatsapp_authorized_numbers[0].user_id).toBeUndefined();
    const retry = await previewBulkRegistration(client, owner, rows);
    expect(retry.rows.every((row: { status: string }) => row.status === 'existing')).toBe(true);
  });

  it('does not create dependent records after a site insert fails', async () => {
    const client = fakeClient('sites');
    const rows = [
      { sheet: 'Companies', rowNumber: 2, values: { 'Company Code': 'ACME', 'Company Name': 'Acme Security' } },
      { sheet: 'Sites', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Site Name': 'Head Office' } },
      { sheet: 'Devices', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Device Name': 'RG360', 'Device ID': 'rg360-01', 'Serial Number': 'serial-01' } },
    ];
    const preview = await previewBulkRegistration(client, owner, rows);
    const result = await commitBulkRegistration(client, owner, preview.job_id);
    expect(result.results.map((row: { message: string }) => row.message)).toEqual(['Registered', 'simulated insert failure', 'Site Code does not exist']);
    expect(client.records.sites).toHaveLength(0);
    expect(client.records.devices).toHaveLength(0);
  });

  it('matches identifiers with the same trimming and case rules as the indexes', async () => {
    const client = fakeClient();
    client.records.companies.push({ id: 'company-1', name: 'Acme', registration_code: ' acme ' });
    client.records.sites.push({ id: 'site-1', company_id: 'company-1', name: 'HQ', registration_code: ' hq ' });
    client.records.devices.push({ id: 'device-1', company_id: 'company-1', serial_number: ' serial-01 ', device_identifier: ' rg360-01 ' });
    const preview = await previewBulkRegistration(client, manager, [
      { sheet: 'Devices', rowNumber: 2, values: { 'Device Name': 'RG360', 'Device ID': 'RG360-01', 'Serial Number': 'SERIAL-01', 'Company Code': 'ACME', 'Site Code': 'HQ' } },
    ]);
    expect(preview.rows[0].status).toBe('existing');
    const result = await commitBulkRegistration(client, manager, preview.job_id);
    expect(result.results[0].status).toBe('existing');
    expect(client.records.devices).toHaveLength(1);
  });

  it('allows the same NFC UID in different companies', async () => {
    const client = fakeClient();
    client.records.companies.push({ id: 'company-1', name: 'Acme', registration_code: 'ACME' });
    client.records.companies.push({ id: 'company-2', name: 'Beta', registration_code: 'BETA' });
    client.records.sites.push({ id: 'site-1', company_id: 'company-1', name: 'HQ', registration_code: 'HQ' });
    client.records.sites.push({ id: 'site-2', company_id: 'company-2', name: 'HQ', registration_code: 'HQ' });
    const rows = ['ACME', 'BETA'].map((code, index) => ({
      sheet: 'Checkpoints', rowNumber: index + 2,
      values: { 'Company Code': code, 'Site Code': 'HQ', 'Checkpoint Name': 'Gate', 'NFC UID': 'TAG-01' },
    }));
    const preview = await previewBulkRegistration(client, owner, rows);
    expect(preview.rows.map((row: { status: string }) => row.status)).toEqual(['ready', 'ready']);
  });

  it('rejects changed tenant context, stale claims, and partial completion', async () => {
    const client = fakeClient();
    client.records.companies.push({ id: 'company-1', name: 'Acme', registration_code: 'ACME' });
    const rows = [{ sheet: 'Sites', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Site Name': 'Head Office' } }];
    const preview = await previewBulkRegistration(client, manager, rows);
    await expect(commitBulkRegistration(client, { ...manager, company_id: 'company-2' }, preview.job_id)).rejects.toThrow('Import preview not found');
    const context = { p_job_id: preview.job_id, p_user_id: manager.user_id,
      p_company_id: manager.company_id, p_is_platform_owner: false };
    const { data: claim } = await client.rpc('claim_bulk_registration_batch', { ...context, p_limit: 40 });
    const empty = await client.rpc('complete_bulk_registration_batch', { ...context,
      p_cursor: claim.cursor, p_claim_token: claim.claim_token, p_results: [] });
    expect(empty.error?.message).toBe('incomplete batch result');
    const stale = await client.rpc('complete_bulk_registration_batch', { ...context,
      p_cursor: claim.cursor, p_claim_token: 'stale', p_results: [{ status: 'ready' }] });
    expect(stale.error?.message).toBe('batch changed');
    expect(client.records.bulk_registration_jobs[0].cursor).toBe(0);
  });

  it('processes 41 rows as a 40-row batch followed by one row', async () => {
    const client = fakeClient();
    client.records.companies.push({ id: 'company-1', name: 'Acme', registration_code: 'ACME' });
    const rows = Array.from({ length: 41 }, (_, index) => ({
      sheet: 'Sites', rowNumber: index + 2,
      values: { 'Company Code': 'ACME', 'Site Code': `SITE-${index + 1}`, 'Site Name': `Site ${index + 1}` },
    }));
    const preview = await previewBulkRegistration(client, manager, rows);
    expect(preview.rows.every((row: { status: string }) => row.status === 'ready')).toBe(true);
    const first = await commitBulkRegistration(client, manager, preview.job_id);
    expect(first.done).toBe(false);
    expect(client.records.bulk_registration_jobs[0].cursor).toBe(40);
    const second = await commitBulkRegistration(client, manager, preview.job_id);
    expect(second.done).toBe(true);
    expect(second.results).toHaveLength(41);
    expect(client.records.sites).toHaveLength(41);
  });
});
