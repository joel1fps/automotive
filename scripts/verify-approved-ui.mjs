import { build } from 'esbuild';
import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Real components, entirely fictional HTTP responses; never calls Clerk/Atlas.
const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = path.resolve(project, '../evidencias/correcoes-aprovadas');
const source = await build({ absWorkingDir: project, stdin: {
  contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
    import {LazyMotion,domAnimation} from 'motion/react';import {BookingForm} from './src/components/booking-form';
    import {Clients} from './src/components/admin-panels';import {TrackingDetails} from './src/components/tracking-admin';
    import {Appointments} from './src/components/appointments-panel';
    function Fixture(){const[view,setView]=useState('admin');const appointment={_id:'000000000000000000000203',guestName:'Cliente fictício',
      vehicle:{model:'Onix fictício',plate:'TST1A23',type:'small'},serviceName:'Lavagem fictícia',status:'confirmed',
      flexibleSchedule:true,scheduledAt:'2026-10-05T14:00:00.000Z',quotedPrice:50,notes:''};
      return <><nav className="row-actions">{['admin','client','clients','tracking','calendar','history'].map(screen=>
        <button className="button secondary" key={screen} onClick={()=>setView(screen)}>Tela {screen}</button>)}</nav>
        <section className="panel" key={view}>{view==='admin'?<BookingForm admin/>:view==='client'?<BookingForm/>:
        view==='clients'?<Clients/>:view==='tracking'?<TrackingDetails appointment={appointment}/>:
        <Appointments admin={view==='calendar'}/>}</section></>}
    createRoot(document.getElementById('fixture')).render(<LazyMotion features={domAnimation}><Fixture/></LazyMotion>);`,
  loader: 'tsx', resolveDir: project, sourcefile: 'approved-ui-fixture.tsx' },
  outfile: 'approved-ui-fixture.js', bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
  define: { 'process.env': '{"NODE_ENV":"production"}' }, logLevel: 'silent' });
const css = (await readFile(path.join(project, 'src/app/globals.css'), 'utf8')).replace(/^@import[^;]+;\s*/gm, '') + '\n' +
  source.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Automotive · correções aprovadas</title><link rel="stylesheet" href="/fixture.css"><style>:root{--font-body:Arial,sans-serif;--font-heading:Arial,sans-serif}</style></head>
  <body><main class="dash-main"><h1>Verificação com dados fictícios</h1><div id="fixture"></div></main><script src="/fixture.js"></script></body></html>`;
const server = createServer((request, response) => {
  const files = { '/': ['text/html', html], '/fixture.css': ['text/css', css], '/fixture.js': ['text/javascript', source.outputFiles.find(file => file.path.endsWith('.js')).contents] };
  const file = files[request.url?.split('?')[0]];response.writeHead(file ? 200 : 404, { 'Content-Type': `${file?.[0] || 'text/plain'}; charset=utf-8` });response.end(file?.[1] || 'Not found');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {const candidate = 'C:/Program Files/Google/Chrome/Application/chrome.exe';try {await access(candidate);executablePath=candidate;} catch {}}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
page.setDefaultTimeout(5000);await page.clock.setFixedTime(new Date('2026-10-04T15:00:00Z'));
const results=[],errors=[],requests=[],bookings=[];
const clients = [
  {_id:'000000000000000000000201',clerkId:'fixture-client-a',name:'Cliente A',email:'a@example.invalid',phone:'5585999121111',vehicles:[],loyaltyCount:0,totalWashes:0},
  {_id:'000000000000000000000202',clerkId:'fixture-client-b',name:'Cliente B',email:'b@example.invalid',phone:'5585999122222',vehicles:[],loyaltyCount:0,totalWashes:0},
];
let failBooking=false,delaySave=false,releaseSave,trackingError=false,historyReady=false;
let tracking={active:false,url:null,estimatedCompletionAt:'2026-10-05T15:00:00.000Z',generatedAt:null,revokedAt:null};
page.on('pageerror',error=>errors.push(error.message));
await page.route('**/*',async route=>{
  const request=route.request(),url=new URL(request.url());if(url.origin!==base)return route.abort();
  if(!url.pathname.startsWith('/api/'))return route.continue();
  requests.push({path:url.pathname,method:request.method(),params:Object.fromEntries(url.searchParams)});
  let body;
  if(url.pathname==='/api/services')body=[{_id:'000000000000000000000204',name:'Lavagem fictícia',slug:'simples',category:'wash',prices:{small:50,suv:60,pickup:70},countsForLoyalty:true,active:true}];
  else if(url.pathname==='/api/loyalty/me')body={vehicles:[],loyaltyCount:0,totalWashes:0,coupons:[
    {_id:'000000000000000000000205',status:'available',vehiclePlate:'TST1A23',vehicleType:'small',expiresAt:'2026-10-06T02:59:59.000Z'},
    {_id:'000000000000000000000206',status:'available',vehiclePlate:'TST1A23',vehicleType:'small',expiresAt:'2026-10-31T02:59:59.000Z'},
  ]};
  else if(url.pathname==='/api/admin/clients') {const search=(url.searchParams.get('search')||'').toLowerCase();const items=clients.filter(client=>client.name.toLowerCase().includes(search));body={items,total:items.length,pages:1,page:1};}
  else if(/^\/api\/admin\/clients\/[a-f\d]{24}$/.test(url.pathname)){
    const client=clients.find(item=>url.pathname.endsWith(item._id));
    if(request.method()==='PATCH'){if(delaySave)await new Promise(resolve=>{releaseSave=resolve;});client.phone='5585999125555';body=client;}
    else body={client,appointments:[],audit:[]};
  } else if(url.pathname==='/api/admin/appointments/calendar')body={days:[{date:'2026-10-05',total:41},{date:'2026-10-10',total:100}],total:141};
  else if(url.pathname==='/api/admin/appointments'&&request.method()==='GET')body={items:[{_id:'000000000000000000000203',guestName:'Cliente fictício',vehicle:{model:'Onix fictício',plate:'TST1A23',type:'small'},serviceName:'Lavagem fictícia',status:'confirmed',scheduledAt:'2026-10-05T14:00:00.000Z',quotedPrice:50,notes:''}],total:41,pages:2,page:1};
  else if(['/api/admin/appointments','/api/appointments'].includes(url.pathname)&&request.method()==='POST'){
    bookings.push(request.postDataJSON());if(failBooking){failBooking=false;return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Resposta temporária indisponível. Tente novamente.'})});}body={created:true};
  } else if(url.pathname.endsWith('/tracking')){
    if(request.method()==='POST')tracking={...tracking,active:true,url:'/acompanhar/token-um',generatedAt:'2026-10-04T15:00:00.000Z'};
    if(trackingError)return route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Consulta temporariamente indisponível.'})});body=tracking;
  } else if(url.pathname==='/api/appointments/me')body={items:[{_id:'000000000000000000000203',vehicle:{model:'Onix fictício',plate:'TST1A23',type:'small'},serviceName:'Lavagem fictícia',status:historyReady?'ready':'confirmed',scheduledAt:'2026-10-05T14:00:00.000Z',quotedPrice:50,notes:''}],total:1,page:1,pages:1};
  else throw new Error(`Rota inesperada ${request.method()} ${url.pathname}`);
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
});
async function chooseDate(label,value){
  await page.getByRole('button',{name:new RegExp(`^${label}:`)}).click();const dialog=page.getByRole('dialog',{name:`Calendário de ${label}`,exact:true});
  const months=['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
  const target=Number(value.slice(0,4))*12+Number(value.slice(5,7))-1;
  for(let steps=0;steps<24;steps++){const[month,year]=(await dialog.getByRole('heading').textContent()).trim().split(' ');const current=Number(year)*12+months.indexOf(month);if(current===target)break;await dialog.getByRole('button',{name:current>target?'Mês anterior':'Próximo mês',exact:true}).click();}
  await dialog.locator(`button[data-date="${value}"]`).click();
}
try {
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('combobox',{name:/^Cliente cadastrado/}).selectOption(clients[0]._id);
  await page.getByRole('textbox',{name:/^Buscar cliente/}).fill('Cliente B');
  await expect(page.getByRole('combobox',{name:/^Cliente cadastrado/})).toHaveValue('');
  await expect(page.getByRole('textbox',{name:/^Nome do cliente avulso/})).toBeVisible();
  await expect(page.getByRole('option',{name:'Cliente B',exact:true})).toHaveCount(1);
  await page.getByRole('combobox',{name:/^Cliente cadastrado/}).selectOption(clients[1]._id);
  await page.getByRole('combobox',{name:/^Serviço/}).selectOption('000000000000000000000204');
  await page.getByRole('textbox',{name:/^Modelo do veículo/}).fill('Onix fictício');await page.getByRole('textbox',{name:/^Placa/}).fill('TST1A23');
  await chooseDate('Data do agendamento','2026-10-05');await page.getByRole('textbox',{name:'Horário desejado',exact:true}).fill('11:00');
  await page.getByRole('button',{name:'Criar agendamento',exact:true}).click();expect(bookings).toHaveLength(0);
  await page.getByRole('textbox',{name:'Horário previsto de entrega',exact:true}).fill('12:00');
  await page.getByRole('button',{name:'Criar agendamento',exact:true}).click();await expect(page.getByRole('heading',{name:'Agendamento criado',exact:true})).toBeVisible();
  expect(bookings[0].userId).toBe(clients[1]._id);expect(bookings[0].estimatedCompletionAt).toBe('2026-10-05T15:00:00.000Z');
  results.push({test:'new-client-search-clears-stale-identity-and-manual-confirmation-needs-ETA',passed:true});

  await page.getByRole('button',{name:'Tela client',exact:true}).click();
  await page.getByRole('combobox',{name:/^Serviço/}).selectOption('000000000000000000000204');
  await page.getByRole('textbox',{name:/^Modelo do veículo/}).fill('Onix fictício');await page.getByRole('textbox',{name:/^Placa/}).fill('TST1A23');
  await chooseDate('Data do agendamento','2026-10-05');await page.getByRole('textbox',{name:'Horário desejado',exact:true}).fill('11:00');
  await page.getByRole('combobox',{name:/^Cupom para este veículo/}).selectOption('000000000000000000000205');
  await chooseDate('Data do agendamento','2026-10-07');
  await expect(page.getByRole('combobox',{name:/^Cupom para este veículo/})).toHaveValue('');
  await expect(page.getByRole('option',{name:/vence 05\/10\/2026/})).toHaveCount(0);
  await page.getByRole('checkbox').check();failBooking=true;
  await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Resposta temporária indisponível. Tente novamente.');
  const firstRetry=bookings.at(-1).requestId;
  failBooking=true;await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Resposta temporária indisponível. Tente novamente.');
  expect(bookings.at(-1).requestId).toBe(firstRetry);
  await page.getByRole('textbox',{name:/^Observações/}).fill('Detalhe alterado após uma tentativa sem resposta.');
  failBooking=true;await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Resposta temporária indisponível. Tente novamente.');
  const changedRetry=bookings.at(-1).requestId;expect(changedRetry).not.toBe(firstRetry);
  await page.getByRole('button',{name:'Solicitar agendamento',exact:true}).click();await expect(page.getByRole('heading',{name:'Solicitação enviada',exact:true})).toBeVisible();
  expect(bookings.at(-1).requestId).toBe(changedRetry);expect(changedRetry).toMatch(/^[\da-f-]{36}$/i);
  expect(bookings.at(-1).couponId).toBeUndefined();
  results.push({test:'coupon-validity-follows-requested-date-and-network-retry-reuses-request-identity',passed:true});

  await page.getByRole('button',{name:'Tela clients',exact:true}).click();await page.getByRole('button',{name:'Ver cliente',exact:true}).nth(0).click();
  const clientDialog=page.getByRole('dialog',{name:'Cliente A',exact:true});await clientDialog.getByRole('textbox',{name:/^Telefone/}).fill('(85) 99912-5555');
  delaySave=true;await clientDialog.getByRole('button',{name:'Salvar dados do cliente',exact:true}).click();
  await expect(clientDialog.getByRole('textbox',{name:/^Telefone/})).toBeDisabled();
  await clientDialog.getByRole('button',{name:'Fechar janela',exact:true}).click();await expect(clientDialog).toBeVisible();
  await expect.poll(()=>!!releaseSave).toBe(true);delaySave=false;releaseSave();
  await expect(clientDialog.getByRole('textbox',{name:/^Telefone/})).toHaveValue('5585999125555');
  await expect(clientDialog.getByRole('textbox',{name:/^Telefone/})).toBeEnabled();
  await clientDialog.getByRole('button',{name:'Fechar janela',exact:true}).click();await page.getByRole('button',{name:'Ver cliente',exact:true}).nth(1).click();
  const secondDialog=page.getByRole('dialog',{name:'Cliente B',exact:true});await expect(secondDialog.getByRole('textbox',{name:/^Telefone/})).toHaveValue('5585999122222');
  await secondDialog.getByRole('button',{name:'Fechar janela',exact:true}).click();
  results.push({test:'client-save-locks-close-and-fields-normalizes-response-and-keeps-other-client-unchanged',passed:true});

  await page.getByRole('button',{name:'Tela tracking',exact:true}).click();await page.getByRole('button',{name:'Detalhes / acompanhamento',exact:true}).click();
  const detail=page.getByRole('dialog',{name:'Detalhes do atendimento',exact:true});await detail.getByRole('button',{name:'Gerar link de acompanhamento',exact:true}).click();
  await expect(detail.getByRole('textbox',{name:/^Link de acompanhamento/})).toHaveValue(`${base}/acompanhar/token-um`);
  tracking={...tracking,url:'/acompanhar/token-dois',estimatedCompletionAt:'2026-10-05T16:00:00.000Z'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(detail.getByRole('textbox',{name:/^Link de acompanhamento/})).toHaveValue(`${base}/acompanhar/token-dois`);
  await expect(detail.getByRole('textbox',{name:'Hora prevista de entrega',exact:true})).toHaveValue('13:00');
  tracking={...tracking,url:null,active:false,revokedAt:'2026-10-04T15:10:00.000Z'};await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(detail.getByText('O link anterior foi revogado.',{exact:true})).toBeVisible();await expect(detail.getByRole('textbox',{name:/^Link de acompanhamento/})).toHaveCount(0);
  trackingError=true;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await expect(detail.getByRole('alert')).toHaveText('Consulta temporariamente indisponível.');trackingError=false;
  await detail.getByRole('button',{name:'Fechar janela',exact:true}).click();
  results.push({test:'tracking-mutation-does-not-mask-new-link-ETA-revocation-or-server-read-errors',passed:true});

  await page.getByRole('button',{name:'Tela calendar',exact:true}).click();await page.getByRole('combobox',{name:/^Período/}).selectOption('month');
  await page.getByRole('combobox',{name:/^Visualização/}).selectOption('calendar');
  await expect(page.getByRole('button',{name:'Ver agendamentos de 10/10/2026: 100 registros',exact:true})).toBeVisible();
  await expect(page.getByText('141 registros no período completo. Selecione um dia para consultar e gerenciar os atendimentos.',{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(evidence,'calendario-periodo-completo-ficticio.png'),fullPage:true});
  await page.getByRole('button',{name:'Ver agendamentos de 05/10/2026: 41 registros',exact:true}).click();
  await expect(page.getByRole('combobox',{name:/^Visualização/})).toHaveValue('list');await expect(page.getByRole('combobox',{name:/^Período/})).toHaveValue('day');
  await expect(page.getByRole('button',{name:'Data dos agendamentos: 05/10/2026',exact:true})).toBeVisible();
  expect(requests.filter(request=>request.path==='/api/admin/appointments').at(-1).params).toEqual({page:'1',status:'',date:'2026-10-05',range:'day'});
  results.push({test:'calendar-uses-complete-period-counts-and-day-click-opens-paginated-daily-management',passed:true});

  await page.getByRole('button',{name:'Tela history',exact:true}).click();await expect(page.getByText('Confirmado',{exact:true})).toBeVisible();
  historyReady=true;await expect(page.getByText('Pronto · pagamento pendente',{exact:true})).toBeVisible({timeout:35000});
  results.push({test:'authenticated-history-updates-in-active-window-without-manual-reload',passed:true});
  expect(errors).toEqual([]);results.push({test:'no-browser-runtime-errors-or-real-service-requests',passed:true});
  console.log(`Correções aprovadas de interface: ${results.length} cenários isolados passaram.`);
} finally {
  await writeFile(path.join(evidence,'approved-ui.json'),JSON.stringify({isolatedFixture:true,results,errors,requests,bookings},null,2));
  await browser.close();await new Promise(resolve=>server.close(resolve));
}
