import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createRegistrationTemplate, parseRegistrationWorkbook, REGISTRATION_SHEETS, validateRegistrationRows } from './bulkRegistrationWorkbook';

describe('registration workbooks', () => {
  it('creates all six template sheets with the expected headers', async () => {
    const blob = await createRegistrationTemplate();
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await blob.arrayBuffer());
    expect(book.worksheets.map((sheet) => sheet.name)).toEqual(Object.keys(REGISTRATION_SHEETS));
    for (const sheet of book.worksheets) {
      const headers = REGISTRATION_SHEETS[sheet.name as keyof typeof REGISTRATION_SHEETS];
      expect(headers.map((_, index) => sheet.getCell(1, index + 1).value)).toEqual([...headers]);
    }
  });

  it('creates each category template with only its own headings', async () => {
    for (const name of Object.keys(REGISTRATION_SHEETS) as Array<keyof typeof REGISTRATION_SHEETS>) {
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await (await createRegistrationTemplate(name)).arrayBuffer());
      expect(book.worksheets.map((sheet) => sheet.name)).toEqual([name]);
      expect(REGISTRATION_SHEETS[name].map((_, index) => book.worksheets[0].getCell(1, index + 1).value)).toEqual([...REGISTRATION_SHEETS[name]]);
    }
  });

  it('rejects formula cells', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Companies');
    sheet.addRow(REGISTRATION_SHEETS.Companies);
    sheet.addRow(['', 'ACME', { formula: '1+1', result: 2 }, '', '', '', '']);
    const file = new File([await book.xlsx.writeBuffer()], 'companies.xlsx');
    await expect(parseRegistrationWorkbook(file)).rejects.toThrow('Formula');
  });

  it('parses an uploaded workbook with the original worksheet names and row numbers', async () => {
    const book = new ExcelJS.Workbook();
    const companies = book.addWorksheet('Companies');
    companies.addRow(REGISTRATION_SHEETS.Companies);
    companies.addRow(['', 'ACME', 'Acme Security', '', '', '', '']);
    const sites = book.addWorksheet('Sites');
    sites.addRow(REGISTRATION_SHEETS.Sites);
    sites.addRow(['', 'HQ', 'Head Office', 'ACME', '', '']);
    const file = new File([await book.xlsx.writeBuffer()], 'registration.xlsx');
    const rows = await parseRegistrationWorkbook(file);
    expect(rows.map(({ sheet, rowNumber }) => ({ sheet, rowNumber }))).toEqual([
      { sheet: 'Companies', rowNumber: 2 }, { sheet: 'Sites', rowNumber: 2 },
    ]);
    expect(validateRegistrationRows(rows).map(({ status }) => status)).toEqual(['valid', 'valid']);
  });

  it('finds duplicates and invalid phone numbers without approving privileged roles', () => {
    const rows = validateRegistrationRows([
      { sheet: 'Companies', rowNumber: 2, values: { 'Company Code': 'ACME', 'Company Name': 'Acme' } },
      { sheet: 'Companies', rowNumber: 3, values: { 'Company Code': 'ACME', 'Company Name': 'Acme 2' } },
      { sheet: 'WhatsApp Users', rowNumber: 2, values: { Name: 'Test', 'Phone Number': '123', 'Company Code': 'ACME', 'Site Code': 'HQ', 'Requested Role': 'owner' } },
    ]);
    expect(rows.map((row) => row.status)).toEqual(['valid', 'duplicate', 'invalid']);
    expect(rows[2].issues).toContain('Requested Role is invalid');
  });

  it('normalizes checkpoint UIDs and matches device and guard duplicate keys to the server', () => {
    const rows = validateRegistrationRows([
      { sheet: 'Checkpoints', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Checkpoint Name': 'Gate', 'NFC UID': '04:A1-B2', 'Datalog Enabled': '' } },
      { sheet: 'Checkpoints', rowNumber: 3, values: { 'Company Code': 'acme', 'Site Code': 'HQ', 'Checkpoint Name': 'Other Gate', 'NFC UID': '04 a1.b2', 'Datalog Enabled': '' } },
      { sheet: 'Checkpoints', rowNumber: 4, values: { 'Company Code': 'BETA', 'Site Code': 'HQ', 'Checkpoint Name': 'Gate', 'NFC UID': '04a1b2', 'Datalog Enabled': '' } },
      { sheet: 'Devices', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Device Name': 'RG', 'Device ID': 'RG-01', 'Serial Number': 'SN-01' } },
      { sheet: 'Devices', rowNumber: 3, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Device Name': 'RG 2', 'Device ID': 'rg-01', 'Serial Number': 'SN-02' } },
      { sheet: 'Guards', rowNumber: 2, values: { 'Company Code': 'ACME', 'Site Code': 'HQ', 'Full Name': 'Guard One', 'Guard ID': 'G-01', 'Employee Number': 'EMP-01' } },
      { sheet: 'Guards', rowNumber: 3, values: { 'Company Code': 'acme', 'Site Code': 'HQ', 'Full Name': 'Guard Two', 'Guard ID': 'G-02', 'Employee Number': 'emp-01' } },
    ]);
    expect(rows.map((row) => row.status)).toEqual(['valid', 'duplicate', 'valid', 'valid', 'duplicate', 'valid', 'duplicate']);
  });
});
