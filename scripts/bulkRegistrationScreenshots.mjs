import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import ExcelJS from 'exceljs';

const label = process.argv[2] ?? 'after';
const output = new URL('../artifacts/', import.meta.url);
await mkdir(output, { recursive: true });

const user = {
  id: '00000000-0000-4000-8000-000000000001',
  aud: 'authenticated', role: 'authenticated', email: 'preview@example.test',
  app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z',
};
const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: 4102444800, role: 'authenticated' })).toString('base64url')}.preview`;
const browser = await chromium.launch({ channel: 'msedge', headless: true });

try {
  for (const [name, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion: 'reduce', acceptDownloads: true });
    await context.addInitScript(({ token, user }) => {
      localStorage.setItem('sb-ksbfgwawfqamtofapdty-auth-token', JSON.stringify({
        access_token: token, refresh_token: 'preview', token_type: 'bearer',
        expires_in: 3600, expires_at: 4102444800, user,
      }));
    }, { token, user });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1') return route.continue();
      if (url.pathname.includes('/rest/v1/platform_admins')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ role: 'owner' }) });
      }
      if (url.pathname.includes('/auth/v1/user')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) });
      }
      if (url.pathname.endsWith('/functions/v1/management-actions')) {
        const rows = route.request().postDataJSON().input.rows;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
          job_id: 'local-preview-only',
          rows: rows.map((row, index) => ({ sheet: row.sheet, rowNumber: row.rowNumber,
            status: ['ready', 'existing', 'conflicting', 'invalid'][index],
            message: ['Ready to register', 'Already registered', 'Site code belongs to another site', 'Invalid site name'][index] })),
        }) });
      }
      if (url.hostname.endsWith('supabase.co')) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
      }
      return route.abort();
    });
    const page = await context.newPage();
    await page.goto('http://127.0.0.1:41732/bulk-registration', { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Bulk Registration' }).waitFor({ timeout: 20000 });
    await page.screenshot({ path: new URL(`bulk-registration-${label}-${name}.png`, output).pathname.slice(1), fullPage: true });
    console.log(`${name}: ${await page.title()} | ${await page.locator('.mx-bulk-registration').boundingBox().then((box) => Math.round(box?.height ?? 0))}px panel`);
    if (label === 'after') {
      if (name === 'desktop') {
        for (const choice of ['Master Workbook', 'Companies', 'Sites', 'Devices', 'Checkpoints', 'Guards', 'WhatsApp Users']) {
          const pending = page.waitForEvent('download');
          await page.getByRole('button', { name: choice, exact: true }).click();
          const download = await pending;
          const book = new ExcelJS.Workbook();
          await book.xlsx.readFile(await download.path());
          const expected = choice === 'Master Workbook' ? ['Companies', 'Sites', 'Devices', 'Checkpoints', 'Guards', 'WhatsApp Users'] : [choice];
          if (JSON.stringify(book.worksheets.map((sheet) => sheet.name)) !== JSON.stringify(expected)) {
            throw new Error(`${choice} download has unexpected worksheets`);
          }
        }
        console.log('desktop: all seven template buttons downloaded the correct workbook');
      }
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Sites');
      sheet.addRow(['Record ID', 'Site Code', 'Site Name', 'Company Code', 'Location', 'Address']);
      for (let index = 1; index <= 4; index++) sheet.addRow(['', `SITE-${index}`, `Site ${index}`, 'ACME', '', '']);
      await page.locator('#br-file').setInputFiles({ name: 'sample-sites.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()) });
      await page.getByText('4 rows', { exact: true }).waitFor();
      await page.getByRole('button', { name: 'Validate in Supabase' }).click();
      await page.getByText('4 rows checked').waitFor();
      const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('.br-page, .br-stage, .br-table-wrap, .br-table, .br-actions, main')]
          .map((element) => ({ name: element.className, width: Math.round(element.getBoundingClientRect().width), right: Math.round(element.getBoundingClientRect().right) })) }));
      console.log(`${name} widths: ${JSON.stringify(widths)}`);
      await page.screenshot({ path: new URL(`bulk-registration-after-preview-${name}.png`, output).pathname.slice(1), fullPage: true });
      console.log(`${name}: synthetic upload and mocked Supabase preview passed`);
    }
    await context.close();
  }
} finally {
  await browser.close();
}
