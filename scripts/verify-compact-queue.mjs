import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real components and styles, fictional HTTP data. This fixture does not load
// credentials or connect to Clerk, MongoDB Atlas, or any other external service.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, '../evidencias/fila-compacta');
const bundle = await build({ absWorkingDir: project,
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';
    import{LazyMotion,domAnimation}from'motion/react';import{ControlPanel}from'./src/components/admin-panels';
    createRoot(document.getElementById('fixture')).render(<LazyMotion features={domAnimation}><ControlPanel/></LazyMotion>);`,
    loader: 'tsx', resolveDir: project, sourcefile: 'compact-queue-fixture.tsx' },
  outfile: 'compact-queue-fixture.js', bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env': '{"NODE_ENV":"production"}' }, logLevel: 'silent' });
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8')).replace(/^@import[^;]+;\s*/gm, '') + '\n' +
  bundle.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Automotive · fila compacta isolada</title><link rel="stylesheet" href="/fixture.css"><style>:root{--font-body:Arial,sans-serif;--font-heading:Arial,sans-serif}</style></head>
<body><div class="dashboard"><aside class="dash-sidebar"><strong>Automotive</strong></aside>
<main class="dash-main"><div class="dash-top"><h1>Fila compacta · dados fictícios</h1></div><div id="fixture"></div></main></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const files = { '/': ['text/html', html], '/fixture.css': ['text/css', css], '/fixture.js': ['text/javascript', bundle.outputFiles.find(file => file.path.endsWith('.js')).contents] };
  const file = files[request.url?.split('?')[0]];
  response.writeHead(file ? 200 : 404, { 'Content-Type': `${file?.[0] || 'text/plain'}; charset=utf-8` }); response.end(file?.[1] || 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(chrome); executablePath = chrome; } catch { /* Use bundled Chromium. */ }
}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(); page.setDefaultTimeout(5000);
await page.clock.install({ time: new Date('2026-10-04T15:00:00Z') });
const statuses = ['arrived', 'in_progress', 'ready', 'completed'];
const columnLabels = ['Aguardando', 'Em atendimento', 'Pronto para retirada', 'Pago / aguardando entrega'];
const id = number => number.toString(16).padStart(24, '0');
const iso = (date, minutes = 0) => new Date(+new Date(date) + minutes * 60000).toISOString();
const record = (number, status, extra = {}) => ({ _id: id(number), status,
  guestName: `Cliente fila ${String(number).padStart(3, '0')}`, guestPhone: '5585999123456',
  vehicle: { model: `Modelo ${number}`, plate: `CAR${String(number).padStart(4, '0')}`, type: 'small' },
  serviceName: 'Lavagem completa de teste', scheduledAt: iso('2026-10-03T12:00:00Z', number),
  arrivedAt: iso('2026-10-03T12:00:00Z', number), quotedPrice: 55,
  notes: `Observação exclusiva CAR${String(number).padStart(4, '0')}`, flexibleSchedule: true,
  estimatedCompletionAt: '2026-10-04T17:30:00Z',
  ...(status !== 'arrived' ? { startedAt: '2026-10-04T12:00:00Z' } : {}),
  ...(['ready', 'completed', 'delivered'].includes(status) ? { readyAt: '2026-10-04T12:30:00Z' } : {}),
  ...(status === 'completed' ? { completedAt: '2026-10-04T12:40:00Z', finalPrice: 55 } : {}),
  ...extra });
const physical = Array.from({ length: 32 }, (_, index) => record(index + 1, statuses[index % statuses.length]));
const terminalStatuses = ['delivered', 'cancelled', 'rejected', 'returned', 'pending', 'confirmed'];
const history = Array.from({ length: 173 }, (_, index) => record(index + 33, terminalStatuses[index % terminalStatuses.length], {
  scheduledAt: iso('2026-10-04T11:00:00Z', index), arrivedAt: '2026-10-04T11:00:00Z',
  deliveredAt: terminalStatuses[index % terminalStatuses.length] === 'delivered' ? iso('2026-10-04T11:00:00Z', index) : undefined,
  returnedAt: terminalStatuses[index % terminalStatuses.length] === 'returned' ? iso('2026-10-04T11:00:00Z', index) : undefined,
  guestName: `Cliente histórico ${String(index + 33).padStart(3, '0')}`,
}));
Object.assign(history.at(-1), { guestName: 'Cliente fora da primeira página', status: 'delivered',
  vehicle: { model: 'Celta distante', plate: 'DEE9Z99', type: 'small' }, deliveredAt: '2026-10-04T14:00:00Z' });
const records = [...physical, ...history];
const results = [], runtimeErrors = [], requests = [], mutations = [];
const localDay = timestamp => new Date(timestamp).toLocaleDateString('en-CA', { timeZone: 'America/Fortaleza' });
function selection(url) {
  const query = url.searchParams, criterion = query.get('criterion') || 'scheduled';
  records.filter(item => item.status === 'arrived').sort((first, second) => +new Date(first.arrivedAt) - +new Date(second.arrivedAt))
    .forEach((item, index) => { item.queuePosition = index + 1; });
  const physicalMode = !query.has('date') && !query.has('from');
  let items = physicalMode ? records.filter(item => statuses.includes(item.status)) : records.filter(item => {
    const timestamp = criterion === 'delivered' ? item.deliveredAt || item.returnedAt
      : item[{ scheduled: 'scheduledAt', arrived: 'arrivedAt', ready: 'readyAt' }[criterion]];
    if (!timestamp) return false;
    const date = localDay(timestamp), reference = query.get('date') || '2026-10-04';
    if (query.has('from')) return date >= query.get('from') && date <= query.get('to');
    const range = query.get('range') || 'day';
    if (range === 'month') return date.slice(0, 7) === reference.slice(0, 7);
    if (range === 'week') return date >= '2026-09-28' && date <= '2026-10-04';
    return date === reference;
  });
  const search = (query.get('search') || '').trim().toLocaleLowerCase('pt-BR');
  if (search) items = items.filter(item => `${item.vehicle.plate} ${item.userId?.name || item.guestName}`.toLocaleLowerCase('pt-BR').includes(search));
  if (query.get('status')) items = items.filter(item => item.status === query.get('status'));
  return items.sort((first, second) => +new Date(physicalMode ? first.arrivedAt : first.scheduledAt) - +new Date(physicalMode ? second.arrivedAt : second.scheduledAt));
}
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request(), url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  requests.push({ path: url.pathname, params: Object.fromEntries(url.searchParams), method: request.method() });
  let body;
  if (url.pathname === '/api/admin/queue') {
    const items = selection(url), counts = {}; for (const item of items) counts[item.status] = (counts[item.status] || 0) + 1;
    const pageNumber = Number(url.searchParams.get('page') || '1');
    body = url.searchParams.has('date') || url.searchParams.has('from')
      ? { items: items.slice((pageNumber - 1) * 100, pageNumber * 100), counts, total: items.length, page: pageNumber, pages: Math.ceil(items.length / 100) }
      : { items, counts, total: items.length };
  } else if (url.pathname === '/api/admin/control') {
    const items = selection(url);
    const receivable = entries => entries.filter(item => ['confirmed', 'arrived', 'in_progress', 'ready'].includes(item.status) && !item.couponId)
      .reduce((sum, item) => sum + (item.quotedPrice || 0), 0);
    body = { total: items.length, confirmed: items.filter(item => item.status === 'confirmed').length,
      completed: items.filter(item => ['completed', 'delivered'].includes(item.status)).length,
      periodReceivable: receivable(items), physicalReceivable: receivable(records.filter(item => statuses.includes(item.status))),
      onSite: records.filter(item => statuses.includes(item.status)).length, entered: 0,
      inProgress: records.filter(item => item.status === 'in_progress').length,
      waiting: records.filter(item => item.status === 'arrived').length,
      awaitingPayment: records.filter(item => item.status === 'ready').length,
      awaitingPickup: records.filter(item => item.status === 'completed').length };
  } else if (url.pathname === '/api/admin/appointments') {
    const items = records.filter(item => item.status === 'pending'); const pageNumber = Number(url.searchParams.get('page') || '1');
    body = { items: items.slice((pageNumber - 1) * 30, pageNumber * 30), total: items.length, page: pageNumber, pages: Math.ceil(items.length / 30) };
  } else if (/\/api\/admin\/appointments\/[a-f\d]{24}$/.test(url.pathname) && request.method() === 'PATCH') {
    const input = request.postDataJSON(); mutations.push(input);
    const item = records.find(value => value._id === url.pathname.split('/').at(-1));
    if (input.action !== 'start' || item.status !== 'arrived') throw new Error('Etapa inesperada no fixture isolado.');
    item.status = 'in_progress'; item.startedAt = '2026-10-04T15:00:00Z'; body = item;
  } else throw new Error(`Rota inesperada: ${request.method()} ${url.pathname}`);
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
const queueRequests = () => requests.filter(request => request.path === '/api/admin/queue');
const row = appointmentId => page.locator(`[data-appointment-id="${appointmentId}"]`);
const toggle = appointmentId => row(appointmentId).getByRole('button', { name: /^Ver (mais|menos) sobre o veículo/ });
async function closeExpanded() {
  const open = page.getByRole('button', { name: /^Ver menos sobre o veículo/ });
  if (await open.count()) await open.first().click();
}
async function changeSearch(value) {
  await page.getByRole('searchbox', { name: 'Buscar por placa ou cliente', exact: true }).fill(value);
  await page.clock.runFor(350);
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByRole('tab', { name: 'Fila atual', exact: true })).toHaveAttribute('aria-selected', 'true');
  expect(queueRequests().at(-1).params).toEqual({});
  await expect(page.locator('[data-queue-mode="physical"] [data-status]:visible')).toHaveCount(4);
  await expect(page.locator('.queue-card:visible')).toHaveCount(32);
  const columns = await page.locator('[data-queue-mode="physical"] [data-status]:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...columns) - Math.min(...columns)).toBeLessThan(2);
  for (const item of physical) {
    await expect(toggle(item._id)).toHaveAttribute('aria-expanded', 'false');
    await expect(row(item._id).getByRole('button', { name: 'Iniciar serviço', exact: true })).toHaveCount(0);
    await expect(row(item._id).getByText(item.notes, { exact: false })).not.toBeVisible();
  }
  results.push({ test: 'physical-default-32-cars-four-desktop-columns-compact-hidden-actions', passed: true });

  const firstId = id(1), secondId = id(5);
  await toggle(firstId).focus(); await page.keyboard.press('Enter');
  await expect(toggle(firstId)).toHaveAttribute('aria-expanded', 'true');
  const panelId = await toggle(firstId).getAttribute('aria-controls');
  expect(panelId).toBeTruthy(); await expect(page.locator(`[id="${panelId}"]`)).toBeVisible();
  await expect(row(firstId).getByRole('button', { name: 'Iniciar serviço', exact: true })).toBeVisible();
  await toggle(secondId).focus(); await page.keyboard.press('Space');
  await expect(toggle(secondId)).toHaveAttribute('aria-expanded', 'true');
  await expect(toggle(firstId)).toHaveAttribute('aria-expanded', 'false');
  await expect(row(firstId).getByRole('button', { name: 'Iniciar serviço', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Ver menos sobre o veículo/ })).toHaveCount(1);
  results.push({ test: 'keyboard-accordion-aria-controls-and-only-one-open', passed: true });

  const beforePoll = queueRequests().length;
  await page.clock.fastForward(31000);
  await expect.poll(() => queueRequests().length).toBeGreaterThan(beforePoll);
  await expect(toggle(secondId)).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('button', { name: /^Ver menos sobre o veículo/ })).toHaveCount(1);
  results.push({ test: 'poll-refresh-preserves-expanded-vehicle-with-unchanged-stage', passed: true });

  await toggle(firstId).click();
  await row(firstId).getByRole('button', { name: 'Iniciar serviço', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Em atendimento', exact: true }).locator(`[data-appointment-id="${firstId}"]`)).toBeVisible();
  await expect(toggle(firstId)).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('button', { name: /^Ver menos sobre o veículo/ })).toHaveCount(0);
  expect(mutations).toEqual([{ action: 'start' }]);
  results.push({ test: 'stage-action-moves-car-and-closes-its-details', passed: true });
  await page.screenshot({ path: path.join(evidence, 'fila-32-carros-desktop-ficticia.png'), fullPage: true });

  await page.setViewportSize({ width: 1201, height: 900 });
  await toggle(id(4)).click();
  const narrowDesktopColumns = await page.locator('[data-queue-mode="physical"] [data-status]:visible').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().top));
  expect(Math.max(...narrowDesktopColumns) - Math.min(...narrowDesktopColumns)).toBeLessThan(2);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'fila-1201-expandida-ficticia.png'), fullPage: true });
  await closeExpanded();
  results.push({ test: 'desktop-1201-four-columns-expanded-last-stage-fit', passed: true });

  await page.setViewportSize({ width: 1024, height: 900 });
  await toggle(id(4)).click();
  await expect(page.locator('[data-queue-mode="physical"] [data-status]:visible')).toHaveCount(4);
  const tabletColumns = await page.locator('[data-queue-mode="physical"] [data-status]:visible').evaluateAll(elements => elements.map(element => ({ top: element.getBoundingClientRect().top, left: element.getBoundingClientRect().left })));
  expect(Math.round(tabletColumns[0].top)).toBe(Math.round(tabletColumns[1].top));
  expect(tabletColumns[2].top).toBeGreaterThan(tabletColumns[0].top);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: path.join(evidence, 'fila-1024-expandida-ficticia.png'), fullPage: true });
  await closeExpanded();
  results.push({ test: 'tablet-1024-two-columns-with-expanded-payment-actions-fit', passed: true });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('combobox', { name: /^Etapa da fila/ })).toBeVisible();
    for (let index = 0; index < statuses.length; index += 1) {
      await page.getByRole('combobox', { name: /^Etapa da fila/ }).selectOption(statuses[index]);
      await expect(page.locator('[data-queue-mode="physical"] [data-status]:visible')).toHaveCount(1);
      await expect(page.getByRole('region', { name: columnLabels[index], exact: true })).toBeVisible();
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    await page.getByRole('combobox', { name: /^Etapa da fila/ }).selectOption('ready');
    await toggle(id(3)).click();
    await expect(row(id(3)).getByRole('button', { name: 'Registrar pagamento / concluir', exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await toggle(id(3)).click();
    await page.getByRole('combobox', { name: /^Etapa da fila/ }).selectOption('completed');
    await expect(page.getByRole('button', { name: /^Ver menos sobre o veículo/ })).toHaveCount(0);
    await page.screenshot({ path: path.join(evidence, `fila-mobile-${width}-ficticia.png`), fullPage: true });
    results.push({ test: `mobile-${width}-stage-selector-single-column-expanded-actions-fit`, passed: true });
  }
  await changeSearch('CAR0003');
  await expect.poll(() => queueRequests().at(-1).params).toEqual({ search: 'CAR0003' });
  await expect(page.getByRole('combobox', { name: /^Etapa da fila/ })).toHaveValue('ready');
  await expect(row(id(3))).toBeVisible();
  await expect(page.getByRole('region', { name: 'Pronto para retirada', exact: true })).toBeVisible();
  await expect(page.getByText('1 veículo encontrado na fila atual.', { exact: false })).toBeVisible();
  results.push({ test: 'mobile-physical-search-auto-selects-first-nonempty-stage', passed: true });
  await page.getByRole('button', { name: 'Limpar filtros', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1).params).toEqual({});

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: 'Por data', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Por data', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-queue-mode="physical"] [data-status]:visible')).toHaveCount(0);
  await expect.poll(() => queueRequests().at(-1).params).toEqual({ date: '2026-10-04', range: 'day', criterion: 'scheduled', page: '1' });
  await expect(page.getByText('Exibindo 1–100 de 173 registros encontrados.', { exact: true })).toBeVisible();
  await expect(row(id(205))).toHaveCount(0);
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1).params.page).toBe('2');
  await expect(row(id(205))).toBeVisible();
  results.push({ test: 'period-history-is-one-list-and-pages-full-results', passed: true });

  await changeSearch('fora da primeira página');
  await expect.poll(() => queueRequests().at(-1).params).toEqual({ date: '2026-10-04', range: 'day', criterion: 'scheduled', search: 'fora da primeira página', page: '1' });
  await expect(row(id(205))).toBeVisible();
  await expect(page.locator('[data-appointment-id]:visible')).toHaveCount(1);
  const summaryRequest = requests.filter(request => request.path === '/api/admin/control').at(-1);
  expect(summaryRequest.params.search).toBe('fora da primeira página');
  results.push({ test: 'search-finds-client-beyond-old-page-and-filters-counts-globally', passed: true });

  await changeSearch('');
  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(() => queueRequests().at(-1).params.page).toBe('2');
  await page.getByRole('combobox', { name: 'Status dos atendimentos', exact: true }).selectOption('delivered');
  await expect.poll(() => queueRequests().at(-1).params.page).toBe('1');
  expect(queueRequests().at(-1).params.status).toBe('delivered');
  expect(requests.filter(request => request.path === '/api/admin/control').at(-1).params.status).toBe('delivered');
  await changeSearch('DEE9Z99');
  await expect.poll(() => queueRequests().at(-1).params.search).toBe('DEE9Z99');
  await expect(row(id(205))).toBeVisible();
  await expect(toggle(id(205))).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.stat-card').filter({ has: page.getByText('Previsto a receber no período', { exact: true }) }).locator('strong')).toHaveText('R$ 0,00');
  await toggle(id(205)).click();
  await expect(row(id(205)).getByText('Entregue em', { exact: true })).toBeVisible();
  await closeExpanded();
  results.push({ test: 'status-and-plate-search-share-server-filters-reset-page-and-retain-readable-details', passed: true });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.getByRole('searchbox', { name: 'Buscar por placa ou cliente', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Status dos atendimentos', exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: /^Etapa da fila/ })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await toggle(id(205)).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `historico-mobile-${width}-ficticio.png`), fullPage: true });
    await closeExpanded();
    results.push({ test: `period-mobile-${width}-filters-list-and-expanded-history-fit`, passed: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path.join(evidence, 'historico-busca-desktop-ficticio.png'), fullPage: true });
  expect(runtimeErrors).toEqual([]);
  results.push({ test: 'no-browser-runtime-errors-or-external-service-requests', passed: true });
} finally {
  await writeFile(path.join(evidence, 'compact-queue-ui.json'), JSON.stringify({ isolatedFixture: true, results, runtimeErrors, requests, mutations }, null, 2));
  await context.close(); await browser.close(); await new Promise(resolve => server.close(resolve));
}
console.log(JSON.stringify({ passed: results.length, evidence, results }, null, 2));
