import ExcelJS from 'exceljs';

export const REGISTRATION_SHEETS = {
  Companies: ['Record ID', 'Company Code', 'Company Name', 'Contact Person', 'Phone', 'Email', 'Address'],
  Sites: ['Record ID', 'Site Code', 'Site Name', 'Company Code', 'Location', 'Address'],
  Devices: ['Record ID', 'Device Name', 'Device ID', 'Serial Number', 'Company Code', 'Site Code', 'Status'],
  Checkpoints: ['Record ID', 'Checkpoint Name', 'NFC UID', 'Company Code', 'Site Code', 'Zone', 'Active', 'Datalog Enabled'],
  Guards: ['Record ID', 'Guard ID', 'Full Name', 'Employee Number', 'Phone', 'Company Code', 'Site Code', 'Employment Status'],
  'WhatsApp Users': ['Record ID', 'Name', 'Phone Number', 'Company Code', 'Site Code', 'Requested Role'],
} as const;

export type RegistrationSheet = keyof typeof REGISTRATION_SHEETS;
export type RegistrationRow = { sheet: RegistrationSheet; rowNumber: number; values: Record<string, string> };
export type RegistrationPreviewRow = RegistrationRow & { status: 'valid' | 'invalid' | 'duplicate'; issues: string[] };

const REQUIRED: Record<RegistrationSheet, string[]> = {
  Companies: ['Company Code', 'Company Name'],
  Sites: ['Site Code', 'Site Name', 'Company Code'],
  Devices: ['Device Name', 'Device ID', 'Serial Number', 'Company Code', 'Site Code'],
  Checkpoints: ['Checkpoint Name', 'NFC UID', 'Company Code', 'Site Code'],
  Guards: ['Guard ID', 'Full Name', 'Company Code', 'Site Code'],
  'WhatsApp Users': ['Name', 'Phone Number', 'Company Code', 'Site Code', 'Requested Role'],
};

export function validateRegistrationRows(rows: RegistrationRow[]): RegistrationPreviewRow[] {
  const seen = new Set<string>();
  const uniqueKey = (row: RegistrationRow) => {
    const v = row.values;
    if (row.sheet === 'Companies') return v['Company Code'];
    if (row.sheet === 'Sites') return `${v['Company Code']}:${v['Site Code']}`;
    if (row.sheet === 'Devices') return v['Serial Number'];
    if (row.sheet === 'Checkpoints') return `${v['Company Code']}:${v['NFC UID']}`;
    if (row.sheet === 'Guards') return `${v['Company Code']}:${v['Guard ID']}`;
    return v['Phone Number'];
  };
  return rows.map((row) => {
    const issues = REQUIRED[row.sheet].filter((field) => !row.values[field]).map((field) => `${field} is required`);
    const v = row.values;
    if (row.sheet === 'WhatsApp Users') {
      if (!/^\+[1-9]\d{7,14}$/.test(v['Phone Number'])) issues.push('Phone Number must be in international format');
      if (!['user', 'guard', 'supervisor', 'admin'].includes(v['Requested Role'].toLowerCase())) issues.push('Requested Role is invalid');
    }
    if (row.sheet === 'Checkpoints' && !['yes', 'no', 'true', 'false', ''].includes(v['Datalog Enabled'].toLowerCase())) issues.push('Datalog Enabled must be Yes or No');
    const key = `${row.sheet}:${uniqueKey(row).toLowerCase()}`;
    const duplicate = seen.has(key);
    seen.add(key);
    return { ...row, issues, status: issues.length ? 'invalid' : duplicate ? 'duplicate' : 'valid' };
  });
}

function textCell(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value && typeof value === 'object' && 'formula' in value) throw new Error(`Formula in ${cell.address} is not allowed`);
  if (value && typeof value === 'object' && 'text' in value) return String(value.text).trim();
  return value == null ? '' : String(value).trim();
}

export async function createRegistrationTemplate(sheet?: RegistrationSheet): Promise<Blob> {
  const workbook = new ExcelJS.Workbook();
  for (const [name, headers] of Object.entries(REGISTRATION_SHEETS)) {
    if (sheet && sheet !== name) continue;
    const worksheet = workbook.addWorksheet(name);
    worksheet.addRow(headers);
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF10243A' } };
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.columns = headers.map((header) => ({ key: header, width: Math.max(18, header.length + 4) }));
    worksheet.autoFilter = { from: 'A1', to: `${worksheet.getColumn(headers.length).letter}1` };
    for (let row = 2; row <= 101; row++) {
      for (let col = 1; col <= headers.length; col++) worksheet.getCell(row, col).numFmt = '@';
    }
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export async function parseRegistrationWorkbook(file: File): Promise<RegistrationRow[]> {
  if (file.size > 10 * 1024 * 1024) throw new Error('Workbook exceeds the 10 MB limit');
  if (!/\.xlsx$/i.test(file.name)) throw new Error('Choose an .xlsx workbook');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const rows: RegistrationRow[] = [];
  for (const worksheet of workbook.worksheets) {
    const sheet = worksheet.name as RegistrationSheet;
    const headers = REGISTRATION_SHEETS[sheet];
    if (!headers) throw new Error(`Unknown worksheet: ${worksheet.name}`);
    if (headers.some((header, index) => textCell(worksheet.getCell(1, index + 1)) !== header)) {
      throw new Error(`Unexpected columns in ${sheet}`);
    }
    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = Object.fromEntries(headers.map((header, index) => [header, textCell(row.getCell(index + 1))]));
      if (Object.values(values).some(Boolean)) rows.push({ sheet, rowNumber, values });
      if (rows.length > 5000) throw new Error('Workbook exceeds the 5,000 row limit');
    });
  }
  if (!workbook.worksheets.length) throw new Error('Workbook has no registration worksheets');
  return rows;
}
