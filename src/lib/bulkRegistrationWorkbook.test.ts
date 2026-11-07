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

  it('rejects formula cells', async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet('Companies');
    sheet.addRow(REGISTRATION_SHEETS.Companies);
    sheet.addRow(['', 'ACME', { formula: '1+1', result: 2 }, '', '', '', '']);
    const file = new File([await book.xlsx.writeBuffer()], 'companies.xlsx');
    await expect(parseRegistrationWorkbook(file)).rejects.toThrow('Formula');
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
});
