import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Production components against fictional HTTP responses. No Clerk/Atlas writes.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, '../evidencias/horarios-fila');
const source = await build({ absWorkingDir: project,
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
    import {LazyMotion,domAnimation} from 'motion/react';
    import {ControlPanel} from './src/components/admin-panels';
    import {BookingForm} from './src/components/booking-form';
    createRoot(document.getElementById('fixture')).render(<LazyMotion features={domAnimation}>
      <ControlPanel/><section className="panel" aria-label="Solicitação de horário"><h2>Solicitar horário livre</h2><BookingForm/></section>
    </LazyMotion>);`, loader: 'tsx', resolveDir: project, sourcefile: 'flexible-queue-fixture.tsx' },
  outfile: 'flexible-queue-fixture.js', bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env': '{"NODE_ENV":"production"}' }, logLevel: 'silent' });
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8')).replace(/^@import[^;]+;\s*/gm, '') + '\n' +
  source.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Automotive · horários e fila isolados</title><link rel="stylesheet" href="/fixture.css">
  <style>:root{--font-body:Arial,sans-serif;--font-heading:Arial,sans-serif}</style></head>
  <body><div class="dashboard"><aside class="dash-sidebar"><strong>Automotive</strong></aside><main class="dash-main">
  <div class="dash-top"><h1>Controle · dados fictícios</h1></div><div id="fixture"></div></main></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const files = { '/': ['text/html', html], '/fixture.css': ['text/css', css],
    '/fixture.js': ['text/javascript', source.outputFiles.find(file => file.path.endsWith('.js')).contents] };
  const file = files[request.url?.split('?')[0]];
  response.writeHead(file ? 200 : 404, { 'Content-Type': `${file?.[0] || 'text/plain'}; charset=utf-8` });response.end(file?.[1] || 'Not found');
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();page.setDefaultTimeout(5000);
await page.clock.setFixedTime(new Date('2026-10-04T15:00:00Z'));
const results = [], runtimeErrors = [], requests = [], mutations = [];
const appointmentId = '000000000000000000000101';
const appointment = { _id: appointmentId, guestName: 'Cliente do futuro', guestPhone: '5585999123456',
  vehicle: { model: 'Onix futuro', plate: 'FUT1A23', type: 'small' }, serviceName: 'Lavagem futura',
  scheduledAt: '2026-10-06T02:17:00.000Z', status: 'pending', quotedPrice: 50, notes: '' };
const backlog = { ...appointment, _id: '000000000000000000000102', status: 'arrived', guestName: 'Cliente anterior',
  vehicle: { ...appointment.vehicle, plate: 'OLD1A23' }, scheduledAt: '2026-10-03T12:00:00.000Z', arrivedAt: '2026-10-03T12:01:00.000Z', queuePosition: 1 };
const delivered = { ...appointment, _id: '000000000000000000000103', status: 'delivered',
  vehicle: { ...appointment.vehicle, plate: 'FIN1A23' }, scheduledAt: '2026-10-04T12:00:00.000Z', deliveredAt: '2026-10-04T14:00:00.000Z' };
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ path: url.pathname, method: request.method(), params: Object.fromEntries(url.searchParams) });
  let body;
  if (url.pathname === '/api/services') body = [{ _id: '000000000000000000000104', name: 'Lavagem futura', slug: 'simples', category: 'wash',
    prices: { small: 50, suv: 60, pickup: 70 }, countsForLoyalty: true, active: true }];
  else if (url.pathname === '/api/loyalty/me') body = { coupons: [], vehicles: [], loyaltyCount: 0, totalWashes: 0 };
  else if (url.pathname === '/api/admin/control') body = { total: 1, confirmed: appointment.status === 'confirmed' ? 1 : 0,
    completed: 0, receivable: 50, periodReceivable: 50, physicalReceivable: 50, onSite: 1, entered: 0, inProgress: 0, ready: 0, waiting: 1, awaitingPayment: 0, awaitingPickup: 0 };
  else if (url.pathname === '/api/admin/queue') {
    if (!url.searchParams.has('date') && !url.searchParams.has('from')) body = { items: [backlog], total: 1 };
    else {
      const date = url.searchParams.get('date'), range = url.searchParams.get('range');
      const items = range === 'month' || range === 'week' || url.searchParams.has('from') ? [appointment, delivered, backlog]
        : date === '2026-10-05' ? [appointment] : date === '2026-10-04' ? [delivered] : [];
      const counts = {};for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
      body = { items, total: range === 'month' ? 205 : items.length, counts,
        page: Number(url.searchParams.get('page') || '1'), pages: range === 'month' ? 3 : 1 };
    }
  } else if (url.pathname === '/api/admin/appointments') body = { items: appointment.status === 'pending' ? [appointment] : [], total: appointment.status === 'pending' ? 1 : 0, page: 1, pages: 1 };
  else if (url.pathname === `/api/admin/appointments/${appointmentId}` && request.method() === 'PATCH') {
    const input = request.postDataJSON();mutations.push(input);
    if (input.action === 'confirm') { appointment.status = 'confirmed';appointment.estimatedCompletionAt = input.estimatedCompletionAt; }
    else if (input.action === 'reschedule') { appointment.scheduledAt = input.scheduledAt;appointment.estimatedCompletionAt = input.estimatedCompletionAt; }
    body = appointment;
  } else if (url.pathname === '/api/appointments' && request.method() === 'POST') {
    mutations.push(request.postDataJSON());body = { created: true };
  } else throw new Error(`Rota inesperada no fixture: ${request.method()} ${url.pathname}`);
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
async function chooseDate(label, value) {
  await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
  const dialog = page.getByRole('dialog', { name: `Calendário de ${label}`, exact: true });
  const target = Number(value.slice(0, 4)) * 12 + Number(value.slice(5, 7)) - 1;
  const months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  for (let steps = 0; steps < 24; steps += 1) {
    const [month, year] = (await dialog.getByRole('heading').textContent()).trim().split(' ');
    const current = Number(year) * 12 + months.indexOf(month);
    if (current === target) break;
    await dialog.getByRole('button', { name: current > target ? 'Mês anterior' : 'Próximo mês', exact: true }).click();
  }
  await dialog.locator(`button[data-date="${value}"]`).click();
}
const queueRequests = () => requests.filter(request => request.path === '/api/admin/queue');
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tab', { name: 'Fila atual', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Por data', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Por data', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-appointment-id="000000000000000000000103"]')).toBeVisible();
  await page.getByRole('button', { name: 'Amanhã', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Data da fila: 05/10/2026', exact: true })).toBeVisible();
  const card = () => page.locator(`[data-appointment-id="${appointmentId}"]`);
  await expect(card()).toBeVisible();
  await card().getByRole('button', { name: /^Ver mais sobre o veículo/ }).click();
  await expect(card().getByRole('button', { name: 'Aprovar', exact: true })).toBeVisible();
  results.push({ test: 'future-date-pending-request-visible-in-period-queue', passed: true });

  await card().getByRole('button', { name: 'Aprovar', exact: true }).click();
  const approval = page.getByRole('dialog', { name: 'Aprovar agendamento', exact: true });
  await approval.getByRole('button', { name: 'Aprovar agendamento', exact: true }).click();
  expect(mutations).toHaveLength(0);
  await approval.getByRole('textbox', { name: 'Horário previsto de entrega', exact: true }).fill('22:00');
  await approval.getByRole('button', { name: 'Aprovar agendamento', exact: true }).click();
  await expect(approval.getByRole('alert')).toContainText('igual ou posterior ao horário do agendamento');
  expect(mutations).toHaveLength(0);
  await chooseDate('Data prevista de entrega', '2026-10-06');
  await approval.getByRole('textbox', { name: 'Horário previsto de entrega', exact: true }).fill('01:30');
  await approval.getByRole('button', { name: 'Aprovar agendamento', exact: true }).click();
  await expect(approval).toHaveCount(0);
  expect(mutations[0]).toEqual({ action: 'confirm', estimatedCompletionAt: '2026-10-06T04:30:00.000Z' });
  await expect(card().getByText('Confirmado', { exact: true })).toBeVisible();
  await card().getByRole('button', { name: /^Ver mais sobre o veículo/ }).click();
  await expect(card().getByText('Previsão de entrega', { exact: true })).toBeVisible();
  await expect(card().getByText('06/10/2026, 01:30', { exact: true })).toBeVisible();
  results.push({ test: 'approval-requires-valid-ETA-converts-Fortaleza-and-remains-visible-after-approval', passed: true });

  await page.getByRole('button', { name: 'Mês atual', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1)?.params).toEqual({ date: '2026-10-01', range: 'month', criterion: 'scheduled', page: '1' });
  await expect(page.getByText('Exibindo 1–100 de 205 registros encontrados.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1)?.params.page).toBe('2');
  await expect(page.getByText('Exibindo 101–200 de 205 registros encontrados.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Próximo mês', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1)?.params).toEqual({ date: '2026-11-01', range: 'month', criterion: 'scheduled', page: '1' });
  await page.getByRole('combobox', { name: /^Período/ }).selectOption('week');
  await expect.poll(() => queueRequests().at(-1)?.params.range).toBe('week');
  await page.getByRole('combobox', { name: /^Período/ }).selectOption('custom');
  await chooseDate('Data inicial da fila', '2026-10-05');
  await chooseDate('Data final da fila', '2026-10-31');
  await expect.poll(() => queueRequests().at(-1)?.params).toEqual({ from: '2026-10-05', to: '2026-10-31', criterion: 'scheduled', page: '1' });
  results.push({ test: 'day-week-month-custom-period-quick-navigation-and-complete-pagination', passed: true });

  await page.getByRole('tab', { name: 'Fila atual', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1)?.params).toEqual({});
  await expect(page.locator(`[data-appointment-id="${backlog._id}"]`)).toBeVisible();
  await expect(page.getByText('#1 na fila', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Por data', exact: true }).click();
  await page.getByRole('button', { name: 'Amanhã', exact: true }).click();
  results.push({ test: 'physical-queue-retains-previous-days-and-FIFO-independent-of-date-filters', passed: true });

  await card().getByRole('button', { name: /^Ver mais sobre o veículo/ }).click();
  await card().getByRole('button', { name: 'Reagendar', exact: true }).click();
  const reschedule = page.getByRole('dialog', { name: 'Reagendar', exact: true });
  await chooseDate('Nova data', '2026-10-07');
  await reschedule.getByRole('textbox', { name: 'Novo horário desejado', exact: true }).fill('23:17');
  await chooseDate('Data prevista de entrega', '2026-10-08');
  await reschedule.getByRole('textbox', { name: 'Horário previsto de entrega', exact: true }).fill('01:30');
  await reschedule.getByRole('button', { name: 'Confirmar ação', exact: true }).click();
  await expect(reschedule).toHaveCount(0);
  expect(mutations[1]).toEqual({ action: 'reschedule', scheduledAt: '2026-10-08T02:17:00.000Z', estimatedCompletionAt: '2026-10-08T04:30:00.000Z' });
  results.push({ test: 'confirmed-reschedule-allows-any-minute-and-updates-ETA-together', passed: true });

  const booking = page.getByRole('region', { name: 'Solicitação de horário', exact: true });
  await booking.getByRole('combobox', { name: /^Serviço/ }).selectOption('000000000000000000000104');
  await booking.getByRole('textbox', { name: /^Modelo do veículo/ }).fill('Onix pedido noturno');
  await booking.getByRole('textbox', { name: /^Placa/ }).fill('NIT1A23');
  await chooseDate('Data do agendamento', '2026-10-05');
  await booking.getByRole('textbox', { name: 'Horário desejado', exact: true }).fill('23:17');
  await booking.getByRole('checkbox').check();
  await booking.getByRole('button', { name: 'Solicitar agendamento', exact: true }).click();
  await expect(booking.getByRole('heading', { name: 'Solicitação enviada', exact: true })).toBeVisible();
  expect(mutations[2].scheduledAt).toBe('2026-10-06T02:17:00.000Z');
  expect(mutations[2].vehicle.plate).toBe('NIT1A23');
  expect(mutations[2].consent).toBe(true);
  expect(requests.some(request => request.path === '/api/slots')).toBe(false);
  results.push({ test: 'client-requests-23h17-on-selected-day-without-slot-grid-or-opening-hours', passed: true });

  await page.getByRole('button', { name: 'Mês atual', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'fila-mensal-desktop-ficticia.png'), fullPage: true });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.getByRole('button', { name: 'Data da fila: 01/10/2026', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(evidence, `fila-mobile-${width}-ficticia.png`), fullPage: true });
    results.push({ test: `mobile-${width}-fits-viewport`, passed: true });
  }
  expect(runtimeErrors).toEqual([]);
  results.push({ test: 'no-browser-runtime-errors-or-external-service-writes', passed: true });
  console.log(`Horários livres, aprovação e fila: ${results.length} cenários isolados aprovados.`);
} finally {
  await writeFile(path.join(evidence, 'flexible-queue-ui.json'), JSON.stringify({ isolatedFixture: true, results, runtimeErrors, requests, mutations }, null, 2));
  await browser.close();await new Promise(resolve => server.close(resolve));
}
