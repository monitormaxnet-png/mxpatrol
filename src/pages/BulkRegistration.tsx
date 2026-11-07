import { useEffect, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { createRegistrationTemplate, parseRegistrationWorkbook, REGISTRATION_SHEETS, validateRegistrationRows, type RegistrationPreviewRow, type RegistrationSheet } from '@/lib/bulkRegistrationWorkbook';

type ServerVerdict = { sheet: RegistrationSheet; rowNumber: number; status: 'ready' | 'existing' | 'invalid' | 'conflicting'; message: string };

export default function BulkRegistration() {
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState(false);
  const [checking, setChecking] = useState(true);
  const [rows, setRows] = useState<RegistrationPreviewRow[]>([]);
  const [error, setError] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [serverRows, setServerRows] = useState<ServerVerdict[]>([]);
  const [results, setResults] = useState<ServerVerdict[]>([]);
  const [busy, setBusy] = useState(false);

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
    setError('');
    setRows([]);
    setJobId(null);
    setServerRows([]);
    setResults([]);
    try { setRows(validateRegistrationRows(await parseRegistrationWorkbook(file))); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Workbook could not be read'); }
  };

  const preview = async () => {
    setBusy(true);
    setError('');
    try {
      const { data, error: requestError } = await supabase.functions.invoke('management-actions', { body: { action: 'bulk_registration_preview', input: { rows: rows.map(({ sheet, rowNumber, values }) => ({ sheet, rowNumber, values })) } } });
      if (requestError || !data?.job_id) throw new Error(data?.error || requestError?.message || 'Server validation failed');
      setJobId(data.job_id);
      setServerRows(data.rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Server validation failed'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!jobId || !window.confirm('Register all ready rows shown in the server preview?')) return;
    setBusy(true);
    setError('');
    try {
      let done = false;
      while (!done) {
        const { data, error: requestError } = await supabase.functions.invoke('management-actions', { body: { action: 'bulk_registration_commit', input: { job_id: jobId } } });
        if (requestError || !data) throw new Error(data?.error || requestError?.message || 'Batch registration failed');
        setResults(data.results);
        done = data.done === true;
      }
      setJobId(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Batch registration failed'); }
    finally { setBusy(false); }
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

  return <main className="mx-auto max-w-6xl space-y-5 p-6 text-foreground">
    <header><h1 className="text-2xl font-bold">Bulk Registration</h1><p className="text-sm text-muted-foreground">Download a template and review registration data before import.</p></header>
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => download()} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm"><Download size={16} /> Master workbook</button>
      {(Object.keys(REGISTRATION_SHEETS) as RegistrationSheet[]).map((sheet) => <button key={sheet} type="button" onClick={() => download(sheet)} className="inline-flex items-center gap-2 rounded border px-3 py-2 text-sm"><Download size={16} /> {sheet}</button>)}
    </div>
    <label className="flex cursor-pointer items-center gap-2 rounded border border-dashed p-5 text-sm"><Upload size={18} /> Upload .xlsx for local preview (maximum 500 rows for registration)<input type="file" accept=".xlsx" className="sr-only" onChange={(event) => upload(event.target.files?.[0])} /></label>
    {error && <p role="alert" className="text-red-400">{error}</p>}
    {rows.length > 0 && <section className="space-y-3"><h2 className="font-semibold">Preview ({rows.length} rows)</h2><p className="text-sm text-amber-300">Review the workbook, then validate it against Supabase. No records are saved until confirmation.</p>
      <button type="button" disabled={busy} onClick={preview} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">{busy ? 'Working...' : 'Validate in Supabase'}</button>
      <div className="max-h-[60vh] overflow-auto rounded border"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Sheet</th><th className="p-2">Row</th><th className="p-2">Status</th><th className="p-2">Details</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.sheet}-${row.rowNumber}`} className="border-t"><td className="p-2">{row.sheet}</td><td className="p-2">{row.rowNumber}</td><td className="p-2">{row.status}</td><td className="p-2">{row.issues.join('; ') || Object.values(row.values).filter(Boolean).slice(0, 3).join(' / ')}</td></tr>)}</tbody></table></div>
    </section>}
    {serverRows.length > 0 && <section className="space-y-3"><h2 className="font-semibold">Supabase validation</h2><p className="text-sm">{serverRows.filter((row) => row.status === 'ready').length} ready, {serverRows.filter((row) => row.status === 'existing').length} already registered, {serverRows.filter((row) => row.status === 'conflicting' || row.status === 'invalid').length} need correction.</p>
      <div className="max-h-64 overflow-auto rounded border">{serverRows.map((row) => <p key={`${row.sheet}-${row.rowNumber}`} className="border-b px-3 py-2 text-sm">{row.sheet} row {row.rowNumber}: <b>{row.status}</b> - {row.message}</p>)}</div>
      {jobId && <button type="button" disabled={busy || !serverRows.some((row) => row.status === 'ready')} onClick={confirm} className="rounded bg-emerald-700 px-3 py-2 text-sm text-white disabled:opacity-50">Confirm & Register</button>}
    </section>}
    {results.length > 0 && <section className="space-y-2"><h2 className="font-semibold">Registration results</h2><p className="text-sm">{results.length} processed, {results.filter((row) => row.message === 'Registered').length} registered, {results.filter((row) => row.status === 'existing').length} already existing, {results.filter((row) => row.status === 'invalid' || row.status === 'conflicting').length} failed.</p>
      <p className="text-sm text-amber-300">{results.filter((row) => row.message === 'Registered' && ['Devices', 'Guards', 'WhatsApp Users'].includes(row.sheet)).length} device, guard or WhatsApp profiles await their normal enrollment or verification steps.</p>
      {results.some((row) => row.status === 'invalid' || row.status === 'conflicting') && <button type="button" onClick={downloadErrors} className="rounded border px-3 py-2 text-sm">Download error report</button>}
    </section>}
  </main>;
}
