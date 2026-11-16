import { useEffect, useState } from 'react';
import { Check, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { createRegistrationTemplate, parseRegistrationWorkbook, REGISTRATION_SHEETS, validateRegistrationRows, type RegistrationPreviewRow, type RegistrationSheet } from '@/lib/bulkRegistrationWorkbook';

type ServerVerdict = { sheet: RegistrationSheet; rowNumber: number; status: 'ready' | 'existing' | 'invalid' | 'conflicting'; message: string };
const sheets = Object.keys(REGISTRATION_SHEETS) as RegistrationSheet[];

function VerdictSummary({ rows }: { rows: ServerVerdict[] }) {
  return <div className="br-summary" aria-label="Validation counts">
    {(['ready', 'existing', 'conflicting', 'invalid'] as const).map((status) =>
      <span key={status} data-status={status}><strong>{rows.filter((row) => row.status === status).length}</strong> {status}</span>
    )}
  </div>;
}

function VerdictTable({ rows }: { rows: ServerVerdict[] }) {
  return <div className="br-table-wrap"><table className="br-table">
    <thead><tr><th scope="col">Worksheet</th><th scope="col">Row</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
    <tbody>{rows.map((row) => <tr key={`${row.sheet}-${row.rowNumber}`}>
      <td>{row.sheet}</td><td>{row.rowNumber}</td>
      <td><span className="br-status" data-status={row.status}>{row.status}</span></td>
      <td>{row.message}</td>
    </tr>)}</tbody>
  </table></div>;
}

export default function BulkRegistration() {
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<RegistrationPreviewRow[]>([]);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [serverRows, setServerRows] = useState<ServerVerdict[]>([]);
  const [results, setResults] = useState<ServerVerdict[]>([]);
  const [busy, setBusy] = useState<'preview' | 'commit' | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!user) { setChecking(false); return; }
    Promise.all([
      supabase.from('platform_admins').select('role').eq('user_id', user.id).maybeSingle(),
      supabase.from('user_roles').select('role').eq('user_id', user.id),
    ]).then(([owner, roles]) => {
      setAuthorized(owner.data?.role === 'owner' || (roles.data ?? []).some(({ role }) => role === 'admin' || role === 'supervisor'));
    }).finally(() => setChecking(false));
  }, [user]);

  const download = async (sheet?: RegistrationSheet) => {
    try {
      const blob = await createRegistrationTemplate(sheet);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = sheet ? `mxpatrol-${sheet.toLowerCase().replaceAll(' ', '-')}-template.xlsx` : 'mxpatrol-master-registration.xlsx';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Template download failed'); }
  };

  const upload = async (file?: File) => {
    if (!file) return;
    setFileName(file.name);
    setError('');
    setRows([]);
    setJobId(null);
    setServerRows([]);
    setResults([]);
    setConfirmOpen(false);
    try {
      const parsed = await parseRegistrationWorkbook(file);
      if (!parsed.length) throw new Error('Workbook has no registration rows');
      if (parsed.length > 500) throw new Error(`Workbook has ${parsed.length} rows; the preview limit is 500`);
      setRows(validateRegistrationRows(parsed));
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Workbook could not be read'); }
  };

  const preview = async () => {
    setBusy('preview');
    setError('');
    setJobId(null);
    setServerRows([]);
    setResults([]);
    setConfirmOpen(false);
    try {
      const { data, error: requestError } = await supabase.functions.invoke('management-actions', { body: { action: 'bulk_registration_preview', input: { rows: rows.map(({ sheet, rowNumber, values }) => ({ sheet, rowNumber, values })) } } });
      if (requestError || !data?.job_id || !Array.isArray(data.rows)) throw new Error(data?.error || requestError?.message || 'Server validation failed');
      setJobId(data.job_id);
      setServerRows(data.rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Server validation failed'); }
    finally { setBusy(null); }
  };

  const confirm = async () => {
    if (!jobId || !confirmOpen) return;
    setConfirmOpen(false);
    setBusy('commit');
    setError('');
    try {
      let done = false;
      let processed = results.length;
      while (!done) {
        const { data, error: requestError } = await supabase.functions.invoke('management-actions', { body: { action: 'bulk_registration_commit', input: { job_id: jobId } } });
        if (requestError || !data) throw new Error(data?.error || requestError?.message || 'Batch registration failed');
        if (!Array.isArray(data.results) || typeof data.done !== 'boolean' || (!data.done && data.results.length <= processed)) {
          throw new Error('Unexpected batch response; registration status needs checking');
        }
        setResults(data.results);
        processed = data.results.length;
        done = data.done;
      }
      setJobId(null);
    } catch (reason) { setError(`Registration paused: ${reason instanceof Error ? reason.message : 'Batch registration failed'}. Review the results and continue this import job.`); }
    finally { setBusy(null); }
  };

  const downloadErrors = async () => {
    const failed = results.filter((row) => row.status === 'invalid' || row.status === 'conflicting');
    if (!failed.length) return;
    const ExcelJS = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Import Errors');
    sheet.addRow(['Category', 'Row', 'Status', 'Reason']);
    failed.forEach((row) => sheet.addRow([row.sheet, row.rowNumber, row.status, row.message]));
    const blob = new Blob([await workbook.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'mxpatrol-import-errors.xlsx';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (checking) return <p className="p-6">Checking access...</p>;
  if (!authorized) return <p className="p-6">Management access required.</p>;

  const readyCount = serverRows.filter((row) => row.status === 'ready').length;
  const registeredCount = results.filter((row) => row.message === 'Registered').length;
  const sheetCounts = sheets.map((sheet) => ({ sheet, count: rows.filter((row) => row.sheet === sheet).length })).filter(({ count }) => count > 0);

  return <div className="mx-bulk-registration br-page mx-auto max-w-6xl">
    <div className="br-heading"><h1>Bulk Registration</h1><p>MX Patrol management</p></div>

    <section className="br-stage" aria-labelledby="br-templates">
      <div className="br-stage-head"><span className="br-step">01</span><div><h2 id="br-templates">Download Template</h2><p>Choose a master workbook or a single category.</p></div></div>
      <div className="br-template-grid">
        <button type="button" onClick={() => download()} className="br-template-button br-template-master"><FileSpreadsheet size={17} aria-hidden="true" /> Master Workbook <Download size={15} aria-hidden="true" /></button>
        {sheets.map((sheet) => <button key={sheet} type="button" onClick={() => download(sheet)} className="br-template-button"><FileSpreadsheet size={16} aria-hidden="true" /> {sheet} <Download size={15} aria-hidden="true" /></button>)}
      </div>
    </section>

    <section className="br-stage" aria-labelledby="br-upload-title">
      <div className="br-stage-head"><span className="br-step">02</span><div><h2 id="br-upload-title">Upload Workbook</h2><p>.xlsx only, up to 500 registration rows.</p></div></div>
      <label className="br-upload" htmlFor="br-file"><Upload size={19} aria-hidden="true" /><span><strong>Choose workbook</strong><small>{fileName || 'No file selected'}</small></span></label>
      <input id="br-file" type="file" accept=".xlsx" className="sr-only" disabled={busy !== null} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }} />
      {rows.length > 0 && <div className="br-file-details"><span>{rows.length} rows</span><span>{sheetCounts.length} worksheets</span>{sheetCounts.map(({ sheet, count }) => <span key={sheet}>{sheet} {count}</span>)}</div>}
      {error && <p role="alert" className="br-alert">{error}</p>}
    </section>

    <section className="br-stage" aria-labelledby="br-validate-title">
      <div className="br-stage-head"><span className="br-step">03</span><div><h2 id="br-validate-title">Validate and Register</h2><p>Review locally, validate with Supabase, then confirm.</p></div></div>
      {rows.length === 0 ? <p className="br-empty">Upload a workbook to see its records.</p> : <>
        <div className="br-subhead"><h3>Workbook preview</h3><span>{rows.filter((row) => row.status === 'valid').length} valid, {rows.filter((row) => row.status === 'duplicate').length} duplicate, {rows.filter((row) => row.status === 'invalid').length} invalid</span></div>
        <div className="br-table-wrap"><table className="br-table">
          <thead><tr><th scope="col">Worksheet</th><th scope="col">Row</th><th scope="col">Status</th><th scope="col">Details</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={`${row.sheet}-${row.rowNumber}`}>
            <td>{row.sheet}</td><td>{row.rowNumber}</td>
            <td><span className="br-status" data-status={row.status}>{row.status === 'valid' ? 'Ready to validate' : row.status}</span></td>
            <td>{row.issues.join('; ') || (row.status === 'duplicate' ? 'Duplicate row in workbook' : Object.values(row.values).filter(Boolean).slice(0, 3).join(' / '))}</td>
          </tr>)}</tbody>
        </table></div>
        <div className="br-actions"><button type="button" disabled={busy !== null} onClick={preview} className="br-primary"><Check size={16} aria-hidden="true" />{busy === 'preview' ? 'Validating...' : serverRows.length ? 'Validate again' : 'Validate in Supabase'}</button><span>No records are saved during validation.</span></div>
      </>}

      {serverRows.length > 0 && <div className="br-subsection">
        <div className="br-subhead"><h3>Supabase validation</h3><span>{serverRows.length} rows checked</span></div>
        <VerdictSummary rows={serverRows} />
        <VerdictTable rows={serverRows} />
        {jobId && readyCount > 0 && <div className="br-actions"><button type="button" disabled={busy !== null} onClick={() => setConfirmOpen(true)} className="br-primary">{results.length ? 'Continue registration' : 'Review registration'}</button></div>}
      </div>}

      {confirmOpen && jobId && <div className="br-confirm" role="group" aria-label="Confirm registration">
        <div><strong>{results.length ? 'Continue this import?' : `Register ${readyCount} ready rows?`}</strong><p>Existing, conflicting and invalid rows will not be overwritten. Batches contain no more than 40 rows.</p></div>
        <div className="br-confirm-actions"><button type="button" onClick={() => setConfirmOpen(false)} className="br-secondary">Cancel</button><button type="button" disabled={busy !== null} onClick={confirm} className="br-primary">Confirm &amp; Register</button></div>
      </div>}

      {results.length > 0 && <div className="br-subsection" aria-live="polite">
        <div className="br-subhead"><h3>{jobId ? 'Partial registration results' : 'Registration results'}</h3><span>{results.length} of {rows.length} processed</span></div>
        <p className="br-result-line">{registeredCount} registered, {results.filter((row) => row.status === 'existing').length} existing, {results.filter((row) => row.status === 'invalid' || row.status === 'conflicting').length} failed.</p>
        <VerdictTable rows={results} />
        <p className="br-note">{results.filter((row) => row.message === 'Registered' && ['Devices', 'Guards', 'WhatsApp Users'].includes(row.sheet)).length} device, guard or WhatsApp profiles await their normal enrollment or verification steps.</p>
        {results.some((row) => row.status === 'invalid' || row.status === 'conflicting') && <button type="button" onClick={downloadErrors} className="br-secondary"><Download size={15} aria-hidden="true" /> Download error report</button>}
      </div>}
      {busy === 'commit' && <p className="br-note" role="status">Registering in batches of up to 40... {results.length} of {rows.length} processed.</p>}
    </section>
  </div>;
}
