import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Isolated component verification. The real FinancePanel and its React hooks
// run against fictional responses; this never connects to Clerk or MongoDB.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, process.env.EVIDENCE_DIR || '../evidencias/exportacao-excel');
const source = await build({
  absWorkingDir: project,
  stdin: {
    contents: `import React from 'react';
      import {createRoot} from 'react-dom/client';
      import {FinancePanel} from './src/components/finance-panel';
      createRoot(document.getElementById('fixture')).render(<FinancePanel />);`,
    loader: 'tsx',
    resolveDir: project,
    sourcefile: 'finance-export-fixture.tsx',
  },
  bundle: true,
  write: false,
  outfile: 'finance-export-fixture.js',
  format: 'iife',
  platform: 'browser',
  jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'silent',
});
// Use the application's layout rules. Font/Tailwind imports are omitted in
// this fixture; it makes no third-party requests and uses the declared fallback.
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8'))
  .replace(/^@import[^;]+;\s*/gm, '') + '\n' +
  ':root { --font-body: Arial; --font-heading: Impact; }\n' +
  source.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Automotive · teste isolado de exportação</title><link rel="stylesheet" href="/fixture.css"></head>
  <body><div class="dashboard"><aside class="dash-sidebar"><strong>Automotive</strong>
    <nav><a href="#">Financeiro</a></nav></aside>
  <nav class="mobile-dash-nav" aria-label="Painel"><a href="#">Financeiro</a></nav>
  <main class="dash-main"><div class="dash-top"><div><h1>Financeiro</h1><p>Dados fictícios para teste.</p></div></div>
  <div id="fixture"></div></main></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const resource = request.url?.split('?')[0];
  const files = { '/': ['text/html; charset=utf-8', html], '/fixture.css': ['text/css; charset=utf-8', css], '/fixture.js': ['text/javascript; charset=utf-8', source.outputFiles.find(file => file.path.endsWith('.js')).contents] };
  const file = files[resource];
  response.writeHead(file ? 200 : 404, { 'Content-Type': file?.[0] || 'text/plain', 'Cache-Control': 'no-store' });
  response.end(file?.[1] || 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(chrome); executablePath = chrome; } catch { /* Bundled Chromium. */ }
}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
const page = await context.newPage();
const results = [];
const runtimeErrors = [];
const exports = [];
let failNextExport = false;
let releaseExport;
let delayedExport = false;
const corrections = [];
const manualEntries = [];
const serviceRequests = [];
let failNextCorrection = false;
let failNextManual = false;
let receiptNet = 50.25;
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  if (url.pathname.endsWith('/correction')) {
    const input = route.request().postDataJSON(); corrections.push(input);
    if (failNextCorrection) { failNextCorrection = false; return route.abort('failed'); }
    receiptNet = input.action === 'refund' ? 0 : input.correctedAmount;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ netAmount: receiptNet }) });
  }
  if (url.pathname === '/api/admin/transactions' && route.request().method() === 'POST') {
    manualEntries.push(route.request().postDataJSON());
    if (failNextManual) { failNextManual = false; return route.abort('failed'); }
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ _id: 'fictional-manual' }) });
  }
  if (url.pathname === '/api/admin/clients') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], page: 1, pages: 0, total: 0 }) });
  if (url.pathname === '/api/admin/service-report') {
    serviceRequests.push(Object.fromEntries(url.searchParams));
    const delivered = url.searchParams.get('criterion') === 'delivered';
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      page: 1, total: 1, pages: 1, summary: { count: 1, paid: delivered ? 1 : 0, unpaid: delivered ? 0 : 1, totalValue: 55, totalReceived: delivered ? 55 : 0 },
      items: [{ _id: 'fictional-service', clientName: delivered ? 'Cliente com retirada registrada' : 'Cliente aguardando retirada', serviceName: 'Lavagem de teste',
        category: 'wash', vehicleModel: 'Celta', vehiclePlate: 'DEF2A34', status: delivered ? 'delivered' : 'ready', value: 55, quotedPrice: 55,
        finalPrice: delivered ? 55 : null, received: delivered ? 55 : 0, balance: delivered ? 0 : 55, paymentStatus: delivered ? 'paid' : 'unpaid', deleted: false,
        scheduledAt: '2026-10-01T11:00:00.000Z', readyAt: '2026-10-01T13:00:00.000Z',
        ...(delivered ? { completedAt: '2026-10-01T13:10:00.000Z', deliveredAt: '2026-10-01T13:15:00.000Z' } : {}) }],
    }) });
  }
  if (url.pathname === '/api/admin/finance/export') {
    exports.push(Object.fromEntries(url.searchParams));
    if (delayedExport) await new Promise(resolve => { releaseExport = resolve; });
    if (failNextExport) {
      failNextExport = false;
      return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'Limite temporário de exportação. Tente novamente.' }) });
    }
    const name = url.searchParams.get('report') === 'complete' ? 'completo' : 'faturamento';
    return route.fulfill({ status: 200,
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="automotive-${name}.xlsx"` },
      body: 'fictional-xlsx-download',
    });
  }
  const body = url.pathname.endsWith('/summary')
    ? { total: 50.25, count: 1, average: 50.25, previousTotal: 25, comparison: 101,
      byDay: [{ name: '2026-10-01', value: 50.25 }], byService: [{ name: 'Lavagem de teste', value: 50.25 }], byPayment: [{ name: 'pix', value: 50.25 }] }
    : { page: Number(url.searchParams.get('page') || '1'), total: 31, pages: 2,
      items: [{ _id: 'fictional-entry', date: '2026-10-02T01:30:00.000Z', description: 'Lavagem de teste', category: 'wash', amount: 50.25,
        paymentMethod: 'pix', clientName: 'Cliente de teste', source: 'appointment', appointmentId: '000000000000000000000001',
        vehiclePlate: 'ABC1D23', vehicleModel: 'Onix de teste', serviceName: 'Lavagem de teste', netAmount: receiptNet, corrected: receiptNet !== 50.25 }] };
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
async function exportAndCheck(type, expected) {
  const before = exports.length;
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: type === 'complete' ? 'Excel completo' : 'Excel de faturamento', exact: true }).click();
  const download = await event;
  expect(exports).toHaveLength(before + 1);
  expect(exports.at(-1)).toEqual({ ...expected, report: type, format: 'xlsx' });
  expect(download.suggestedFilename()).toBe(`automotive-${type === 'complete' ? 'completo' : 'faturamento'}.xlsx`);
  expect(await download.failure()).toBeNull();
  return download;
}
async function chooseDate(label, value) {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  const dialog = page.getByRole('dialog', { name: `Calendário de ${label}`, exact: true });
  const target = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  for (let steps = 0; steps < 24; steps += 1) {
    const heading = await dialog.getByRole('heading').textContent();
    const [month, year] = heading.trim().split(' ');
    const current = Number(year) * 12 + months.indexOf(month);
    if (current === target) break;
    await dialog.getByRole('button', { name: current > target ? 'Mês anterior' : 'Próximo mês', exact: true }).click();
  }
  await dialog.locator(`button[data-date="${value}"]`).click();
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Recebimentos', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Cliente de teste' })).toBeVisible();
  await chooseDate('Data de referência', '2026-10-01');
  for (const range of ['day', 'week', 'month']) {
    await page.getByRole('combobox', { name: /^Período/ }).selectOption(range);
    await exportAndCheck('receipts', { range, date: '2026-10-01' });
    results.push({ test: `revenue-Excel-${range}-uses-current-reference`, passed: true });
  }
  await page.getByLabel('Categoria', { exact: true }).fill('wash');
  await page.getByLabel('Pagamento').selectOption('pix');
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await exportAndCheck('receipts', { range: 'month', date: '2026-10-01', category: 'wash', paymentMethod: 'pix' });
  results.push({ test: 'revenue-retains-category-payment-and-exports-beyond-pagination', passed: true });
  await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', paymentMethod: 'pix', criterion: 'scheduled' });
  await expect(page.getByRole('button', { name: /XML/ })).toHaveCount(0);
  results.push({ test: 'distinct-complete-Excel-download-without-XML-button', passed: true });
  await page.getByRole('combobox', { name: /^Período/ }).selectOption('custom');
  await chooseDate('Data inicial do período', '2026-09-10');
  await chooseDate('Data final do período', '2026-10-01');
  await exportAndCheck('complete', { from: '2026-09-10', to: '2026-10-01', category: 'wash', paymentMethod: 'pix', criterion: 'scheduled' });
  results.push({ test: 'complete-custom-period-retains-both-bounds', passed: true });

  delayedExport = true;
  const countBefore = exports.length;
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel de faturamento', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Exportando faturamento…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Excel completo', exact: true })).toBeDisabled();
  await expect.poll(() => exports.length).toBe(countBefore + 1);
  await page.getByRole('button', { name: 'Excel completo', exact: true }).evaluate(button => button.click());
  expect(exports).toHaveLength(countBefore + 1);
  delayedExport = false;
  releaseExport();
  await pending;
  await expect(page.getByRole('button', { name: 'Excel de faturamento', exact: true })).toBeEnabled();
  results.push({ test: 'simultaneous-downloads-blocked-and-controls-recover', passed: true });

  failNextExport = true;
  await page.getByRole('button', { name: 'Excel completo', exact: true }).click();
  await expect(page.getByText('Limite temporário de exportação. Tente novamente.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Excel completo', exact: true })).toBeEnabled();
  await exportAndCheck('complete', { from: '2026-09-10', to: '2026-10-01', category: 'wash', paymentMethod: 'pix', criterion: 'scheduled' });
  await expect(page.getByText('Limite temporário de exportação. Tente novamente.', { exact: true })).toHaveCount(0);
  results.push({ test: 'export-error-shown-and-retry-recovers', passed: true });

  await page.getByRole('button', { name: 'Corrigir valor', exact: true }).click();
  const correctionDialog = page.getByRole('dialog', { name: 'Corrigir valor recebido', exact: true });
  await expect(correctionDialog.getByRole('button', { name: 'Confirmar correção' })).toBeDisabled();
  await correctionDialog.getByLabel('Valor total correto recebido (R$)').fill('30');
  await correctionDialog.getByLabel('Motivo do ajuste').fill('Valor cobrado incorretamente');
  failNextCorrection = true;
  await correctionDialog.getByRole('button', { name: 'Confirmar correção' }).click();
  await expect(correctionDialog.getByRole('alert')).toBeVisible();
  await correctionDialog.getByRole('button', { name: 'Confirmar correção' }).click();
  await expect(correctionDialog).toHaveCount(0);
  expect(corrections).toHaveLength(2);
  expect(corrections[0]).toEqual(corrections[1]);
  expect(corrections[1]).toMatchObject({ action: 'correct', correctedAmount: 30, reason: 'Valor cobrado incorretamente' });
  expect(corrections[1].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  await expect(page.getByText('Líquido atual: R$ 30,00')).toBeVisible();
  results.push({ test: 'correction-requires-reason-and-retries-network-failure-with-same-UUID', passed: true });
  await page.getByRole('button', { name: 'Estornar', exact: true }).click();
  const refundDialog = page.getByRole('dialog', { name: 'Estornar pagamento', exact: true });
  await expect(refundDialog.getByText(/líquido atual: R\$\s*30,00/)).toBeVisible();
  await refundDialog.getByLabel('Motivo do ajuste').fill('Pagamento devolvido ao cliente');
  await refundDialog.getByRole('button', { name: 'Confirmar estorno' }).click();
  await expect(refundDialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Estornar', exact: true })).toBeDisabled();
  expect(corrections.at(-1).action).toBe('refund');
  expect(corrections.at(-1).requestId).not.toBe(corrections[0].requestId);
  results.push({ test: 'refund-confirms-current-net-and-blocks-second-refund-after-full-refund', passed: true });

  await page.getByRole('button', { name: 'Lançamento avulso', exact: true }).click();
  const manualDialog = page.getByRole('dialog', { name: 'Novo lançamento avulso', exact: true });
  await manualDialog.getByLabel('Descrição', { exact: true }).fill('Serviço avulso fictício');
  await manualDialog.getByLabel('Categoria', { exact: true }).fill('wash');
  await manualDialog.getByLabel('Valor (R$)', { exact: true }).fill('25');
  failNextManual = true;
  await manualDialog.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
  await expect(manualDialog.locator('.alert-error')).toBeVisible();
  await manualDialog.getByRole('button', { name: 'Registrar entrada', exact: true }).click();
  await expect(manualDialog).toHaveCount(0);
  expect(manualEntries).toHaveLength(2); expect(manualEntries[0]).toEqual(manualEntries[1]);
  expect(manualEntries[0].requestId).toMatch(/^[0-9a-f-]{36}$/i);
  results.push({ test: 'manual-entry-keeps-UUID-and-payload-after-network-error', passed: true });

  await page.getByRole('combobox', { name: /^Período/ }).selectOption('month');
  await page.screenshot({ path: path.join(evidence, 'financeiro-desktop-ficticio.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect.poll(() => page.evaluate(() => [...document.querySelectorAll('.chart-box')].every(box =>
      box.querySelector('.recharts-wrapper').getBoundingClientRect().width <= box.getBoundingClientRect().width + 1))).toBe(true);
    await page.getByRole('button', { name: 'Excel de faturamento', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Excel de faturamento', exact: true })).toBeVisible();
    await exportAndCheck('receipts', { range: 'month', date: '2026-10-01', category: 'wash', paymentMethod: 'pix' });
    await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', paymentMethod: 'pix', criterion: 'scheduled' });
    await page.screenshot({ path: path.join(evidence, `financeiro-mobile-${width}-ficticio.png`), fullPage: true });
    results.push({ test: `mobile-${width}-fits-viewport-and-downloads-both-Excel-reports`, passed: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('combobox', { name: /^Relatório/ }).selectOption('services');
  await expect(page.getByRole('heading', { name: 'Serviços realizados', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pagamento pendente', exact: true })).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Pagamento/ })).toHaveCount(0);
  await expect.poll(() => serviceRequests.at(-1)?.criterion).toBe('ready');
  expect(serviceRequests.at(-1)).not.toHaveProperty('paymentMethod');
  await page.locator('.finance-exports summary').click();
  await page.getByRole('combobox', { name: 'Data dos veículos no Excel completo', exact: true }).selectOption('arrived');
  await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', criterion: 'arrived' });
  await page.getByRole('combobox', { name: 'Data dos veículos no Excel completo', exact: true }).selectOption('ready');
  await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', criterion: 'ready' });
  await exportAndCheck('receipts', { range: 'month', date: '2026-10-01', category: 'wash' });
  results.push({ test: 'both-reports-remain-distinct-in-services-view-with-independent-vehicle-date-filter', passed: true });
  await page.getByRole('combobox', { name: /^Considerar a data de/ }).selectOption('delivered');
  await expect.poll(() => serviceRequests.at(-1)?.criterion).toBe('delivered');
  await expect(page.getByRole('heading', { name: 'Veículos entregues no período', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'Pago', exact: true })).toBeVisible();
  await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', criterion: 'ready' });
  await page.getByRole('combobox', { name: 'Data dos veículos no Excel completo', exact: true }).selectOption('delivered');
  await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', criterion: 'delivered' });
  results.push({ test: 'delivery-criterion-refetches-and-Excel-vehicle-filter-remains-explicit', passed: true });
  await page.screenshot({ path: path.join(evidence, 'servicos-desktop-ficticio.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await exportAndCheck('complete', { range: 'month', date: '2026-10-01', category: 'wash', criterion: 'delivered' });
    await page.screenshot({ path: path.join(evidence, `servicos-mobile-${width}-ficticio.png`), fullPage: true });
    results.push({ test: `performed-services-mobile-${width}-fits-and-exports`, passed: true });
  }
  expect(runtimeErrors).toEqual([]);
  results.push({ test: 'no-browser-runtime-errors', passed: true });
  console.log(`Exportação verificada no componente real: ${results.length} cenários isolados, apenas dados fictícios.`);
} finally {
  await writeFile(path.join(evidence, 'finance-export-ui.json'), JSON.stringify({ isolatedFixture: true, results, runtimeErrors }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
