import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import BulkRegistration from './BulkRegistration';

const { parseMock, invokeMock, access } = vi.hoisted(() => ({
  parseMock: vi.fn(),
  invokeMock: vi.fn(),
  access: { owner: true },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({ select: () => ({ eq: () => table === 'platform_admins'
      ? { maybeSingle: async () => ({ data: access.owner ? { role: 'owner' } : null }) }
      : Promise.resolve({ data: [] }) }) }),
    functions: { invoke: invokeMock },
  },
}));
vi.mock('@/lib/bulkRegistrationWorkbook', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/bulkRegistrationWorkbook')>(),
  parseRegistrationWorkbook: parseMock,
}));

const rows = (count: number) => Array.from({ length: count }, (_, index) => ({
  sheet: 'Sites' as const,
  rowNumber: index + 2,
  values: { 'Company Code': 'ACME', 'Site Code': `SITE-${index + 1}`, 'Site Name': `Site ${index + 1}` },
}));

async function upload(count: number) {
  parseMock.mockResolvedValue(rows(count));
  await act(async () => {
    fireEvent.change(document.getElementById('br-file') as HTMLInputElement, { target: { files: [new File(['test'], 'sites.xlsx')] } });
  });
  if (count <= 500) await screen.findByText(`${count} rows`);
}

beforeEach(() => {
  vi.clearAllMocks();
  access.owner = true;
});

describe('Bulk Registration workspace', () => {
  it('shows all template choices and refuses unauthorized access', async () => {
    const view = render(<BulkRegistration />);
    expect(await screen.findByRole('heading', { name: 'Download Template' })).toBeInTheDocument();
    for (const name of ['Master Workbook', 'Companies', 'Sites', 'Devices', 'Checkpoints', 'Guards', 'WhatsApp Users']) {
      expect(screen.getByRole('button', { name: new RegExp(name) })).toBeInTheDocument();
    }
    view.unmount();
    access.owner = false;
    render(<BulkRegistration />);
    expect(await screen.findByText('Management access required.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Validate in Supabase' })).not.toBeInTheDocument();
  });

  it('shows the filename and worksheet count, and enforces the 500-row preview limit', async () => {
    render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    await upload(2);
    expect(screen.getByText('sites.xlsx')).toBeInTheDocument();
    expect(screen.getByText('1 worksheets')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Validate in Supabase' })).toBeInTheDocument();
    await upload(501);
    expect(await screen.findByRole('alert')).toHaveTextContent('preview limit is 500');
    expect(screen.queryByRole('button', { name: 'Validate in Supabase' })).not.toBeInTheDocument();
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('warns before unloading an unfinished workbook', async () => {
    render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    await upload(1);
    const unload = new Event('beforeunload', { cancelable: true });
    expect(window.dispatchEvent(unload)).toBe(false);
    expect(unload.defaultPrevented).toBe(true);
  });

  it('requires confirmation and reports every row across two commit batches', async () => {
    const source = rows(41);
    const verdicts = source.map((row) => ({ sheet: row.sheet, rowNumber: row.rowNumber, status: 'ready', message: 'Ready' }));
    const results = verdicts.map((row, index) => index === 40
      ? { ...row, status: 'invalid', message: 'Simulated row failure' }
      : { ...row, message: 'Registered' });
    invokeMock.mockImplementation(async (_name, { body }) => body.action === 'bulk_registration_preview'
      ? { data: { job_id: 'job-1', rows: verdicts }, error: null }
      : { data: { done: ++commitCalls === 2, results: commitCalls === 1 ? results.slice(0, 40) : results }, error: null });
    let commitCalls = 0;
    render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    await upload(41);
    fireEvent.click(screen.getByRole('button', { name: 'Validate in Supabase' }));
    expect(await screen.findByText('41 rows checked')).toBeInTheDocument();
    expect(screen.getByLabelText('Validation counts')).toHaveTextContent('0 existing');
    fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
    expect(invokeMock.mock.calls.filter(([, request]) => request.body.action === 'bulk_registration_commit')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Confirm & Register' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Register' }));
    expect(await screen.findByText('41 of 41 processed')).toBeInTheDocument();
    expect(screen.getByText('40 registered, 0 existing, 1 failed.')).toBeInTheDocument();
    expect(screen.getByText('Simulated row failure')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Download error report' })).toBeInTheDocument();
    expect(commitCalls).toBe(2);
    expect(invokeMock.mock.calls[0][1].body.input.rows).toHaveLength(41);
  });

  it('keeps partial results and the same job available after a batch request fails', async () => {
    let commits = 0;
    const verdicts = rows(41).map((row) => ({ sheet: row.sheet, rowNumber: row.rowNumber, status: 'ready', message: 'Ready' }));
    invokeMock.mockImplementation(async (_name, { body }) => {
      if (body.action === 'bulk_registration_preview') return { data: { job_id: 'job-1', rows: verdicts }, error: null };
      commits += 1;
      if (commits === 2) return { data: null, error: { message: 'Network interrupted' } };
      return { data: { done: commits === 3, results: verdicts.slice(0, commits === 1 ? 40 : 41).map((row) => ({ ...row, message: 'Registered' })) }, error: null };
    });
    render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    await upload(41);
    fireEvent.click(screen.getByRole('button', { name: 'Validate in Supabase' }));
    await screen.findByText('41 rows checked');
    fireEvent.click(screen.getByRole('button', { name: 'Review registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Register' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Registration paused: Network interrupted');
    expect(screen.getByText('40 of 41 processed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Continue registration' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm & Register' }));
    await waitFor(() => expect(screen.getByText('41 of 41 processed')).toBeInTheDocument());
    expect(commits).toBe(3);
  });

  it('does not automatically register rows after a page remount', async () => {
    const verdict = { sheet: 'Sites', rowNumber: 2, status: 'ready', message: 'Ready' };
    invokeMock.mockResolvedValue({ data: { job_id: 'job-1', rows: [verdict] }, error: null });
    const view = render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    await upload(1);
    fireEvent.click(screen.getByRole('button', { name: 'Validate in Supabase' }));
    await screen.findByText('1 rows checked');
    view.unmount();
    render(<BulkRegistration />);
    await screen.findByRole('heading', { name: 'Upload Workbook' });
    expect(screen.queryByRole('button', { name: 'Confirm & Register' })).not.toBeInTheDocument();
    expect(invokeMock.mock.calls.filter(([, request]) => request.body.action === 'bulk_registration_commit')).toHaveLength(0);
  });
});
