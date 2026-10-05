import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real React components and application CSS, isolated from Clerk and Atlas.
// All appointments, identities, dates and audit responses below are fictional.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, process.env.EVIDENCE_DIR || '../evidencias/calendario-exclusao');
const appointmentId = '000000000000000000000091';
const source = await build({
  absWorkingDir: project,
  stdin: {
    contents: `import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {DatePicker} from './src/components/ui/date-picker';
      import {DeleteAppointmentAction} from './src/components/appointment-delete';
      import {AuditPanel} from './src/components/audit-panel';
      import {Dialog} from './src/components/ui/dialog';
      import {Button} from './src/components/ui/button';
      function Fixture() {
        const [date,setDate]=useState('2026-10-06');
        const [limited,setLimited]=useState('2026-10-06');
        const [nested,setNested]=useState('');
        const [validated,setValidated]=useState(false);
        const [open,setOpen]=useState(false);
        const [refreshes,setRefreshes]=useState(0);
        const appointment={_id:'${appointmentId}',guestName:'Cliente fictício',
          vehicle:{model:'Onix de teste',plate:'TST1A23',type:'small'},serviceName:'Lavagem fictícia',
          scheduledAt:'2026-10-06T13:00:00.000Z',status:'confirmed',quotedPrice:50,notes:''};
        return <>
          <section className="panel"><h2>Calendário de agendamentos</h2>
            <div className="toolbar">
              <label>Data<DatePicker value={date} onChange={setDate} ariaLabel="Data dos agendamentos" /></label>
              <label>Data limitada<DatePicker value={limited} onChange={setLimited} min="2026-10-04" max="2026-10-12" ariaLabel="Data limitada" /></label>
              <label>Data desabilitada<DatePicker value="2026-10-06" onChange={()=>{}} disabled ariaLabel="Data desabilitada" /></label>
            </div><output aria-label="Data selecionada">{date}</output>
            <div className="form-actions"><Button onClick={()=>setOpen(true)}>Abrir formulário</Button></div>
          </section>
          <section className="panel"><h2>Agendamento fictício</h2><p>Cliente fictício · Onix de teste · TST1A23</p>
            <DeleteAppointmentAction appointment={appointment} refresh={()=>setRefreshes(value=>value+1)} />
            <output aria-label="Atualizações realizadas">{refreshes}</output>
          </section>
          <AuditPanel />
          <Dialog open={open} onOpenChange={setOpen} title="Criar agendamento fictício">
            <form onSubmit={event=>{event.preventDefault();setValidated(true)}}>
              <label>Data do agendamento<DatePicker value={nested} onChange={setNested} ariaLabel="Data no formulário" name="scheduledDate" required min="2026-10-01" max="2026-10-31" /></label>
              <Button type="submit">Validar formulário</Button>
              {validated && <output aria-label="Data válida">{nested}</output>}
            </form>
          </Dialog>
        </>;
      }
      createRoot(document.getElementById('fixture')).render(<Fixture />);`,
    loader: 'tsx', resolveDir: project, sourcefile: 'calendar-deletion-fixture.tsx',
  },
  outfile: 'calendar-deletion-fixture.js', bundle: true, write: false,
  format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'silent',
});
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8'))
  .replace(/^@import[^;]+;\s*/gm, '') + '\n' + source.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Automotive · testes isolados</title><link rel="stylesheet" href="/fixture.css">
  <style>:root{--font-body:Arial,sans-serif;--font-heading:Arial,sans-serif}</style></head>
  <body><div class="dashboard"><aside class="dash-sidebar"><strong>Automotive</strong>
  <nav><a href="#">Agendamentos</a><a href="#">Logs</a></nav></aside>
  <nav class="mobile-dash-nav" aria-label="Painel"><a href="#">Agendamentos</a><a href="#">Logs</a></nav>
  <main class="dash-main"><div class="dash-top"><div><h1>Agendamentos e logs</h1><p>Dados fictícios para teste.</p></div></div>
  <div id="fixture"></div></main></div><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const files = {
    '/': ['text/html; charset=utf-8', html], '/fixture.css': ['text/css; charset=utf-8', css],
    '/fixture.js': ['text/javascript; charset=utf-8', source.outputFiles.find(file => file.path.endsWith('.js')).contents],
  };
  const file = files[request.url?.split('?')[0]];
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
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage();
page.setDefaultTimeout(5000);
const results = [];
const runtimeErrors = [];
const deletionRequests = [];
const auditRequests = [];
let failNextDelete = false;
let delayDelete = false;
let releaseDelete;
let deleted = false;
let failAudit = false;
page.on('pageerror', error => runtimeErrors.push(error.message));
await page.route('**/*', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.origin !== base) return route.abort();
  if (!url.pathname.startsWith('/api/')) return route.continue();
  if (url.pathname === `/api/admin/appointments/${appointmentId}` && request.method() === 'DELETE') {
    deletionRequests.push(request.postDataJSON());
    if (delayDelete) await new Promise(resolve => { releaseDelete = resolve; });
    if (failNextDelete) {
      failNextDelete = false;
      return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Sua permissão administrativa foi revogada.' }) });
    }
    deleted = true;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: appointmentId, deleted: true, deletedAt: '2026-10-06T13:30:00.000Z', alreadyDeleted: false }) });
  }
  if (url.pathname === '/api/admin/audit') {
    auditRequests.push({ method: request.method(), params: Object.fromEntries(url.searchParams) });
    if (failAudit) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Acesso restrito aos administradores.' }) });
    const entries = deleted ? [{ _id: '000000000000000000000092', action: 'appointment_deleted',
      createdAt: '2026-10-06T13:30:00.000Z', adminClerkId: 'fixture-admin-readonly', actorName: 'Admin fictício',
      reason: deletionRequests.at(-1)?.reason, appointmentId, fromStatus: 'confirmed',
      details: { clientName: 'Cliente fictício', serviceName: 'Lavagem fictícia', vehicle: { model: 'Onix de teste', plate: 'TST1A23' },
        scheduledAt: '2026-10-06T13:00:00.000Z', quotedPrice: 50 } }] : [];
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: entries, page: Number(url.searchParams.get('page') || '1'), total: entries.length ? 31 : 0, pages: entries.length ? 2 : 0 }) });
  }
  throw new Error(`Requisição inesperada no teste isolado: ${request.method()} ${url.pathname}`);
});
const trigger = () => page.getByRole('button', { name: /^Data dos agendamentos:/ });
const calendar = () => page.getByRole('dialog', { name: 'Calendário de Data dos agendamentos', exact: true });
async function expectCompleteCalendar(popup) {
  await expect.poll(async () => (await popup.boundingBox())?.height || 0).toBeGreaterThanOrEqual(240);
  for (const date of ['2026-10-17', '2026-10-31']) {
    const day = popup.locator(`button[data-date="${date}"]`);
    await expect(day).toBeInViewport({ ratio: 1 });
    await expect.poll(async () => {
      const box = await popup.boundingBox(), cell = await day.boundingBox();
      return !!box && !!cell && cell.y >= box.y && cell.y + cell.height <= box.y + box.height - 8;
    }).toBe(true);
  }
}
async function expectReadableDialogHeader(dialog) {
  const title = dialog.locator('.dialog-head').getByRole('heading');
  const close = dialog.getByRole('button', { name: 'Fechar janela', exact: true });
  await expect(title).toBeInViewport({ ratio: 1 });
  await expect(close).toBeInViewport({ ratio: 1 });
  const headerBox = await dialog.locator('.dialog-head').boundingBox();
  const dialogBox = await dialog.boundingBox();
  const titleBox = await title.boundingBox();
  const closeBox = await close.boundingBox();
  for (const box of [titleBox, closeBox]) {
    expect(box.x).toBeGreaterThanOrEqual(headerBox.x - 1);
    expect(box.y).toBeGreaterThanOrEqual(headerBox.y - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(headerBox.x + headerBox.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
    expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
  }
  expect(closeBox.height).toBeGreaterThanOrEqual(40);
  expect(closeBox.width).toBeGreaterThanOrEqual(38);
  expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
}
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'Calendário de agendamentos' })).toBeVisible();
  await expect(page.locator('input[type="date"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Data desabilitada:/ })).toBeDisabled();
  await trigger().click();
  await expect(calendar().getByRole('heading', { name: 'outubro 2026' })).toBeVisible();
  expect(await calendar().getByRole('columnheader').allTextContents()).toEqual(['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']);
  await expect(calendar().locator('[aria-selected="true"] button[data-date="2026-10-06"]')).toBeVisible();
  expect(await calendar().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(255, 255, 255)');
  await expectCompleteCalendar(calendar());
  await expect.poll(async () => (await calendar().boundingBox())?.x || 0).toBeGreaterThanOrEqual(300);
  await page.screenshot({ path: path.join(evidence, 'calendario-desktop-ficticio.png') });
  await calendar().locator('button[data-date="2026-10-09"]').click();
  await expect(trigger()).toHaveAccessibleName('Data dos agendamentos: 09/10/2026');
  await expect(calendar()).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  results.push({ test: 'Portuguese-white-calendar-Sunday-first-selects-ISO-date', passed: true });

  await trigger().press('ArrowDown');
  await expect(calendar().locator('button[data-date="2026-10-09"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(calendar().locator('button[data-date="2026-10-10"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(calendar().locator('button[data-date="2026-10-17"]')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(calendar().locator('button[data-date="2026-10-11"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(calendar().locator('button[data-date="2026-10-17"]')).toBeFocused();
  await page.keyboard.press('PageDown');
  await expect(calendar().getByRole('heading', { name: 'novembro 2026' })).toBeVisible();
  await expect(calendar().locator('button[data-date="2026-11-17"]')).toBeFocused();
  await page.keyboard.press('PageUp');
  await expect(calendar().locator('button[data-date="2026-10-17"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(trigger()).toHaveAccessibleName('Data dos agendamentos: 17/10/2026');
  await expect(trigger()).toBeFocused();
  await trigger().click();
  await calendar().getByRole('button', { name: 'Próximo mês', exact: true }).click();
  await expect(calendar().getByRole('heading', { name: 'novembro 2026' })).toBeVisible();
  await calendar().getByRole('button', { name: 'Mês anterior', exact: true }).click();
  await expect(calendar().getByRole('heading', { name: 'outubro 2026' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(calendar()).toHaveCount(0);
  await expect(trigger()).toBeFocused();
  await expect(trigger()).toHaveAccessibleName('Data dos agendamentos: 17/10/2026');
  results.push({ test: 'keyboard-arrows-week-month-Enter-Escape-and-focus-restoration', passed: true });

  const bounded = page.getByRole('button', { name: /^Data limitada:/ });
  await bounded.click();
  const limitedCalendar = page.getByRole('dialog', { name: 'Calendário de Data limitada', exact: true });
  await expect(limitedCalendar.locator('button[data-date="2026-10-03"]')).toBeDisabled();
  await expect(limitedCalendar.locator('button[data-date="2026-10-13"]')).toBeDisabled();
  await expect(limitedCalendar.getByRole('button', { name: 'Mês anterior', exact: true })).toBeDisabled();
  await expect(limitedCalendar.getByRole('button', { name: 'Próximo mês', exact: true })).toBeDisabled();
  await page.keyboard.press('Home');
  await expect(limitedCalendar.locator('button[data-date="2026-10-04"]')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(limitedCalendar.locator('button[data-date="2026-10-04"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(bounded).toHaveAccessibleName('Data limitada: 04/10/2026');
  results.push({ test: 'min-max-disable-days-months-and-clamp-keyboard-navigation', passed: true });

  await trigger().click();
  await page.getByRole('heading', { name: 'Calendário de agendamentos', exact: true }).click();
  await expect(calendar()).toHaveCount(0);
  await page.getByRole('button', { name: 'Abrir formulário', exact: true }).click();
  const parentDialog = page.getByRole('dialog', { name: 'Criar agendamento fictício', exact: true });
  await expectReadableDialogHeader(parentDialog);
  await parentDialog.getByRole('button', { name: 'Validar formulário', exact: true }).click();
  const nestedCalendar = page.getByRole('dialog', { name: 'Calendário de Data no formulário', exact: true });
  await expect(nestedCalendar).toBeVisible();
  await expectCompleteCalendar(nestedCalendar);
  const nestedBox = await nestedCalendar.boundingBox();
  expect(nestedBox.x).toBeGreaterThanOrEqual(0);
  expect(nestedBox.y).toBeGreaterThanOrEqual(0);
  expect(nestedBox.x + nestedBox.width).toBeLessThanOrEqual(1440);
  expect(nestedBox.y + nestedBox.height).toBeLessThanOrEqual(1000);
  await nestedCalendar.locator('button[data-date="2026-10-07"]').click();
  await expect(parentDialog.getByRole('button', { name: 'Data no formulário: 07/10/2026', exact: true })).toBeFocused();
  await expect(parentDialog).toBeVisible();
  await parentDialog.getByRole('button', { name: 'Validar formulário', exact: true }).click();
  await expect(parentDialog.locator('output[aria-label="Data válida"]')).toHaveText('2026-10-07');
  await parentDialog.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  results.push({ test: 'outside-click-Radix-dialog-required-field-popup-bounds-and-focus', passed: true });

  await page.getByRole('button', { name: 'Excluir agendamento', exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Excluir agendamento', exact: true });
  const confirm = () => deletion.getByRole('button', { name: 'Confirmar exclusão', exact: true });
  await expect(deletion.getByText('Lavagem fictícia · Onix de teste · TST1A23', { exact: true })).toBeVisible();
  await expect(confirm()).toBeDisabled();
  await deletion.getByRole('textbox', { name: /^Motivo da exclusão/ }).fill('   ');
  await expect(confirm()).toBeDisabled();
  await deletion.getByRole('textbox', { name: /^Motivo da exclusão/ }).fill('abc');
  await expect(confirm()).toBeDisabled();
  await deletion.getByRole('textbox', { name: /^Motivo da exclusão/ }).fill('Agendamento fictício duplicado');
  await expect(confirm()).toBeEnabled();
  await deletion.getByRole('button', { name: 'Voltar', exact: true }).click();
  expect(deletionRequests).toHaveLength(0);
  await page.getByRole('button', { name: 'Excluir agendamento', exact: true }).click();
  await expect(deletion.getByRole('textbox', { name: /^Motivo da exclusão/ })).toHaveValue('');
  results.push({ test: 'deletion-needs-confirmation-and-trimmed-reason-cancel-does-not-call-API', passed: true });

  failNextDelete = true;
  await deletion.getByRole('textbox', { name: /^Motivo da exclusão/ }).fill('Motivo válido para a tentativa fictícia');
  await confirm().click();
  await expect(deletion.getByRole('alert')).toHaveText('Sua permissão administrativa foi revogada.');
  await expect(confirm()).toBeEnabled();
  await expect(page.locator('output[aria-label="Atualizações realizadas"]')).toHaveText('0');
  results.push({ test: 'server-denial-visible-without-closing-or-refreshing-and-retry-enabled', passed: true });

  await deletion.getByRole('textbox', { name: /^Motivo da exclusão/ }).fill('  Agendamento fictício duplicado  ');
  delayDelete = true;
  await confirm().click();
  await expect(deletion.getByRole('button', { name: 'Excluindo…', exact: true })).toBeDisabled();
  await expect(deletion.getByRole('textbox', { name: /^Motivo da exclusão/ })).toBeDisabled();
  await expect(deletion.getByRole('button', { name: 'Voltar', exact: true })).toBeDisabled();
  await expect.poll(() => deletionRequests.length).toBe(2);
  await deletion.getByRole('button', { name: 'Excluindo…', exact: true }).evaluate(element => element.click());
  expect(deletionRequests).toHaveLength(2);
  await deletion.getByRole('button', { name: 'Fechar janela', exact: true }).click();
  await expect(deletion).toBeVisible();
  delayDelete = false;
  releaseDelete();
  await expect(deletion).toHaveCount(0);
  await expect(page.locator('output[aria-label="Atualizações realizadas"]')).toHaveText('1');
  expect(deletionRequests.at(-1)).toEqual({ reason: 'Agendamento fictício duplicado' });
  await expect(page.getByRole('cell', { name: /Admin fictício/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Agendamento fictício duplicado/ })).toBeVisible();
  await expect(page.getByRole('cell', { name: /Agendamento excluído/ })).toBeVisible();
  results.push({ test: 'single-delete-request-lock-trimmed-payload-refresh-and-server-log', passed: true });

  await page.getByRole('button', { name: 'Próxima', exact: true }).click();
  await expect.poll(() => auditRequests.at(-1)?.params.page).toBe('2');
  await page.getByRole('combobox', { name: /^Ação registrada/ }).selectOption('');
  await expect.poll(() => auditRequests.at(-1)?.params).toEqual({ page: '1' });
  await page.getByRole('combobox', { name: /^Ação registrada/ }).selectOption('appointment_deleted');
  await expect.poll(() => auditRequests.at(-1)?.params).toEqual({ page: '1', action: 'appointment_deleted' });
  expect(auditRequests.every(request => request.method === 'GET')).toBe(true);
  await expect(page.getByRole('button', { name: /Excluir log|Editar log/ })).toHaveCount(0);
  failAudit = true;
  await page.getByRole('button', { name: 'Atualizar logs', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Acesso restrito aos administradores.');
  await expect(page.getByRole('cell', { name: /Admin fictício/ })).toHaveCount(0);
  failAudit = false;
  await page.getByRole('button', { name: 'Atualizar logs', exact: true }).click();
  await expect(page.getByRole('cell', { name: /Admin fictício/ })).toBeVisible();
  results.push({ test: 'logs-readonly-filter-pagination-denial-clears-data-and-retry-recovers', passed: true });
  await page.screenshot({ path: path.join(evidence, 'logs-desktop-ficticio.png'), fullPage: true });

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await trigger().scrollIntoViewIfNeeded();
    await trigger().click();
    await expect.poll(async () => {
      const bounds = await calendar().boundingBox();
      return !!bounds && bounds.x >= 0 && bounds.x + bounds.width <= width;
    }).toBe(true);
    await expectCompleteCalendar(calendar());
    const popupBox = await calendar().boundingBox();
    expect(popupBox.x).toBeGreaterThanOrEqual(0);
    expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(width);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `calendario-mobile-${width}-ficticio.png`), fullPage: true });
    await expectCompleteCalendar(calendar());
    await calendar().locator('button[data-date="2026-10-06"]').click();
    await page.getByRole('button', { name: 'Abrir formulário', exact: true }).click();
    await expectReadableDialogHeader(parentDialog);
    await parentDialog.getByRole('button', { name: /^Data no formulário:/ }).click();
    await expectCompleteCalendar(nestedCalendar);
    await page.screenshot({ path: path.join(evidence, `calendario-dialog-mobile-${width}-ficticio.png`) });
    await nestedCalendar.locator('button[data-date="2026-10-31"]').click();
    await expect(parentDialog.getByRole('button', { name: 'Data no formulário: 31/10/2026', exact: true })).toBeFocused();
    await parentDialog.getByRole('button', { name: 'Fechar janela', exact: true }).click();
    await page.getByRole('button', { name: 'Excluir agendamento', exact: true }).click();
    await expect(deletion).toBeVisible();
    await expectReadableDialogHeader(deletion);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: path.join(evidence, `exclusao-mobile-${width}-ficticio.png`), fullPage: true });
    await deletion.getByRole('button', { name: 'Voltar', exact: true }).click();
    results.push({ test: `mobile-${width}-calendar-dialog-and-logs-fit-viewport`, passed: true });
  }
  expect(runtimeErrors).toEqual([]);
  results.push({ test: 'no-browser-runtime-errors-or-external-service-requests', passed: true });
  console.log(`Calendário, exclusão e logs verificados: ${results.length} cenários isolados, apenas dados fictícios.`);
} finally {
  await writeFile(path.join(evidence, 'calendar-deletion-ui.json'), JSON.stringify({ isolatedFixture: true, results, runtimeErrors, deletionRequests, auditRequests }, null, 2));
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
