import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real React components, fictional responses, no Clerk or Atlas connection.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, '../evidencias/historico-devolucao');
const bundle = await build({ absWorkingDir: project,
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{LazyMotion,domAnimation}from'motion/react';import{ControlPanel}from'./src/components/admin-panels';
    import{OperationalActions,CouponIssuer}from'./src/components/management-actions';import{useResource}from'./src/lib/client-api';
    function Actions(){const{data,refresh}=useResource('/api/admin/queue?fixture=actions');return <>
      {data?.items.filter(a=>['arrived','ready','completed'].includes(a.status)).map(a=><section className="panel" aria-label={'Ações '+a.vehicle.plate} key={a._id}><h2>{a.vehicle.plate}</h2><OperationalActions appointment={a} refresh={refresh}/></section>)}
      <section className="panel" aria-label="Emissão de cortesia"><CouponIssuer refresh={()=>{}}/></section></>}
    createRoot(document.getElementById('fixture')).render(<LazyMotion features={domAnimation}><Actions/><ControlPanel/></LazyMotion>);`,
    loader: 'tsx', resolveDir: project, sourcefile: 'operational-history-fixture.tsx' },
  outfile: 'operational-history-fixture.js', bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env': '{"NODE_ENV":"production"}' }, logLevel: 'silent' });
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8')).replace(/^@import[^;]+;\s*/gm, '') + '\n' +
  bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automotive · histórico isolado</title><link rel="stylesheet" href="/fixture.css"><style>:root{--font-body:Arial,sans-serif;--font-heading:Arial,sans-serif}</style></head>
<body><div class="dashboard"><aside class="dash-sidebar"><strong>Automotive</strong></aside>
<main class="dash-main"><div class="dash-top"><h1>Histórico e devolução · dados fictícios</h1></div><div id="fixture"></div></main></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const files = { '/': ['text/html', html], '/fixture.css': ['text/css', css], '/fixture.js': ['text/javascript', bundle.outputFiles.find(file => file.path.endsWith('.js')).contents] };
  const file = files[request.url?.split('?')[0]];
  response.writeHead(file ? 200 : 404, { 'Content-Type': `${file?.[0] || 'text/plain'}; charset=utf-8` });response.end(file?.[1] || 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(chrome);executablePath = chrome; } catch { /* Use bundled Chromium. */ }
}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();page.setDefaultTimeout(5000);
await page.clock.setFixedTime(new Date('2026-10-04T15:00:00Z'));
const record = (id, status, plate, extra = {}) => ({ _id: id, status, guestName: 'Cliente fictício', guestPhone: '5585999123456',
  vehicle: { model: 'Onix de teste', plate, type: 'small' }, serviceName: 'Lavagem de teste', scheduledAt: '2026-10-03T14:00:00Z',
  arrivedAt: '2026-10-04T12:00:00Z', quotedPrice: 50, notes: '', flexibleSchedule: true, ...extra });
const records = [record('000000000000000000000201', 'arrived', 'ARR1A23'),
  record('000000000000000000000202', 'ready', 'RDY1A23', { readyAt: '2026-10-04T13:00:00Z' }),
  record('000000000000000000000203', 'completed', 'PAY1A23', { readyAt: '2026-10-04T13:00:00Z', completedAt: '2026-10-04T14:00:00Z', finalPrice: 50 }),
  record('000000000000000000000204', 'delivered', 'FIN1A23', { arrivedAt: '2026-10-03T12:00:00Z', readyAt: '2026-10-03T13:00:00Z', deliveredAt: '2026-10-04T14:00:00Z', finalPrice: 50 })];
const results = [], runtimeErrors = [], requests = [], mutations = [], couponRequests = [];
let returnFailures = 1, couponFailures = 1;
function selected(url) {
  const criterion = url.searchParams.get('criterion') || 'scheduled', date = url.searchParams.get('date') || '2026-10-04';
  if (url.searchParams.has('fixture')) return records;
  if (!url.searchParams.has('date') && !url.searchParams.has('from')) return records.filter(item => ['arrived', 'ready', 'completed'].includes(item.status));
  return records.filter(item => {
    const timestamp = criterion === 'delivered' ? item.deliveredAt || item.returnedAt : item[{ scheduled: 'scheduledAt', arrived: 'arrivedAt', ready: 'readyAt' }[criterion]];
    return timestamp && new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' }) === date;
  });
}
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), method: request.method() });
  let status = 200, body;
  if (url.pathname === '/api/admin/queue') {
    const items = selected(url), counts = {};for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
    body = { items, counts, total: items.length, page: 1, pages: items.length ? 1 : 0 };
  } else if (url.pathname === '/api/admin/control') {
    const items = selected(url);body = { total: items.length, periodReceivable: 50, physicalReceivable: 50, onSite: 3, entered: 3, inProgress: 0, waiting: 1, awaitingPayment: 1, awaitingPickup: 1 };
  } else if (url.pathname === '/api/admin/appointments') body = { items: [], total: 0, page: 1, pages: 0 };
  else if (url.pathname === '/api/admin/clients') body = { items: [{ _id: '000000000000000000000205', name: 'Cliente da cortesia', email: 'teste@example.test' }], total: 1, page: 1, pages: 1 };
  else if (url.pathname === '/api/admin/coupons' && request.method() === 'POST') {
    const input = request.postDataJSON();couponRequests.push(input);
    if (couponFailures-- > 0) { status = 503;body = { error: 'Resposta indisponível. Tente novamente.' }; }
    else body = { created: true };
  } else if (/\/api\/admin\/appointments\/[a-f\d]{24}$/.test(url.pathname) && request.method() === 'PATCH') {
    const input = request.postDataJSON();mutations.push(input);
    if (returnFailures-- > 0) { status = 403;body = { error: 'Sem autorização no fixture.' }; }
    else {
      const item = records.find(value => value._id === url.pathname.split('/').at(-1));
      item.status = 'returned';item.returnedAt = '2026-10-04T15:00:00Z';item.returnReason = input.reason;body = item;
    }
  } else throw new Error(`Rota inesperada: ${request.method()} ${url.pathname}`);
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  const arrived = page.getByRole('region', { name: 'Ações ARR1A23', exact: true });
  const paid = page.getByRole('region', { name: 'Ações PAY1A23', exact: true });
  await expect(arrived.getByRole('button', { name: 'Excluir agendamento', exact: true })).toBeDisabled();
  await expect(arrived.getByText('Veículo no local: registre a entrega ou devolução antes de excluir.', { exact: true })).toBeVisible();
  await expect(paid.getByRole('button', { name: 'Excluir agendamento', exact: true })).toBeDisabled();
  await expect(paid.getByRole('button', { name: 'Registrar devolução sem conclusão', exact: true })).toHaveCount(0);
  await expect(paid.getByRole('button', { name: 'Registrar entrega', exact: true })).toBeVisible();
  results.push({ test: 'physical-vehicle-cannot-be-deleted-and-paid-vehicle-requires-normal-delivery', passed: true });

  await arrived.getByRole('button', { name: 'Registrar devolução sem conclusão', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Registrar devolução sem conclusão', exact: true });
  await expect(dialog.getByRole('button', { name: 'Confirmar devolução', exact: true })).toBeDisabled();
  await dialog.getByRole('textbox', { name: 'Motivo da devolução', exact: true }).fill('     ');
  await expect(dialog.getByRole('button', { name: 'Confirmar devolução', exact: true })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Voltar', exact: true }).click();
  expect(mutations).toHaveLength(0);
  results.push({ test: 'return-requires-meaningful-reason-and-cancel-does-not-submit', passed: true });

  await arrived.getByRole('button', { name: 'Registrar devolução sem conclusão', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Motivo da devolução', exact: true }).fill(' Cliente retirou antes do serviço ');
  await dialog.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Sem autorização');
  await expect(dialog.getByRole('textbox', { name: 'Motivo da devolução', exact: true })).toHaveValue(' Cliente retirou antes do serviço ');
  await dialog.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(mutations).toEqual([{ action: 'return', reason: 'Cliente retirou antes do serviço' }, { action: 'return', reason: 'Cliente retirou antes do serviço' }]);
  await expect(arrived).toHaveCount(0);
  results.push({ test: 'return-failure-retains-dialog-and-retry-submits-only-action-and-trimmed-reason', passed: true });

  await page.getByRole('tab', { name: 'Por data', exact: true }).click();
  await page.getByRole('combobox', { name: 'Critério de data', exact: true }).selectOption('delivered');
  await expect(page.locator('[data-appointment-id="000000000000000000000201"]')).toBeVisible();
  await expect(page.locator('[data-appointment-id="000000000000000000000204"]')).toBeVisible();
  const returnedCard = page.locator('[data-appointment-id="000000000000000000000201"]');
  await returnedCard.getByRole('button', { name: /^Ver mais sobre o veículo/ }).click();
  await expect(returnedCard.getByText('Cliente retirou antes do serviço', { exact: false })).toBeVisible();
  const lastQueue = requests.filter(item => item.path === '/api/admin/queue' && item.params.criterion).at(-1);
  const lastSummary = requests.filter(item => item.path === '/api/admin/control').at(-1);
  expect(lastQueue.params.criterion).toBe('delivered');expect(lastSummary.params.criterion).toBe('delivered');
  results.push({ test: 'delivery-history-includes-actual-delivery-and-return-and-shares-criterion-with-counts', passed: true });

  await page.getByRole('combobox', { name: 'Critério de data', exact: true }).selectOption('ready');
  await expect(page.locator('[data-appointment-id="000000000000000000000202"]')).toBeVisible();
  await expect(page.locator('[data-appointment-id="000000000000000000000201"]')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Critério de data', exact: true }).selectOption('arrived');
  await expect(page.locator('[data-appointment-id="000000000000000000000201"]')).toBeVisible();
  await page.getByRole('tab', { name: 'Fila atual', exact: true }).click();
  await expect(page.locator('[data-appointment-id="000000000000000000000201"]')).toHaveCount(0);
  await expect(page.locator('[data-appointment-id="000000000000000000000202"]')).toBeVisible();
  results.push({ test: 'actual-ready-and-arrival-dates-filter-history-without-returned-vehicles-in-physical-queue', passed: true });

  const coupon = page.getByRole('region', { name: 'Emissão de cortesia', exact: true });
  await coupon.getByText('Criar cupom de lavagem grátis', { exact: true }).click();
  await coupon.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption('000000000000000000000205');
  await coupon.getByRole('textbox', { name: 'Modelo', exact: true }).fill('Onix');
  await coupon.getByRole('textbox', { name: 'Placa', exact: true }).fill('CPN1A23');
  await coupon.getByRole('textbox', { name: 'Motivo', exact: true }).fill('Cortesia fictícia autorizada');
  await coupon.getByRole('button', { name: /^Validade:/ }).click();
  await page.getByRole('dialog', { name: 'Calendário de Validade', exact: true }).locator('button[data-date="2026-10-05"]').click();
  await coupon.getByRole('button', { name: 'Criar cupom', exact: true }).click();
  await expect(coupon.getByText('Resposta indisponível. Tente novamente.', { exact: true })).toBeVisible();
  await coupon.getByRole('button', { name: 'Criar cupom', exact: true }).click();
  await expect(coupon.getByText('Cupom criado.', { exact: true })).toBeVisible();
  expect(couponRequests).toHaveLength(2);
  expect(couponRequests[0].requestId).toMatch(/^[a-f\d-]{36}$/i);
  expect(couponRequests[1]).toEqual(couponRequests[0]);
  results.push({ test: 'manual-coupon-retry-preserves-request-identity', passed: true });

  await page.getByRole('tab', { name: 'Por data', exact: true }).click();
  await page.getByRole('combobox', { name: 'Critério de data', exact: true }).selectOption('delivered');
  await page.screenshot({ path: path.join(evidence, 'historico-desktop-ficticio.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Critério de data', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'historico-mobile-ficticio.png'), fullPage: true });
  await page.getByRole('heading', { name: 'Fila e histórico de atendimentos', exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(evidence, 'historico-mobile-filtro-ficticio.png') });
  expect(runtimeErrors).toEqual([]);
  results.push({ test: 'history-selector-remains-usable-on-mobile-without-runtime-errors', passed: true });
} finally {
  await writeFile(path.join(evidence, 'operational-history-ui.json'), JSON.stringify({ results, runtimeErrors, mutations, couponRequests }, null, 2));
  await context.close();await browser.close();await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ passed: results.length, evidence, results }, null, 2));
