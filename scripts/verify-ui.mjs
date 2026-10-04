import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:3025';
const evidence = path.resolve('../evidencias/ativacao-vercel');
const expectedExtras = [
  ['extra-0', 'Higienização completa'],
  ['extra-1', 'Higienização de motor'],
  ['extra-2', 'Hidratação de bancos de couro'],
  ['extra-3', 'Revitalização de farol'],
  ['extra-4', 'Polimento técnico e comercial'],
  ['extra-5', 'Vitrificação'],
  ['extra-6', 'Película (linha Window Blue)'],
  ['extra-7', 'PPF'],
  ['extra-8', 'Dedetização automotiva'],
  ['oxi-sanitizacao', 'Oxi-sanitização com ozônio'],
  ['moto', 'Lavagem de moto'],
];
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
const results = [];
const errors = [];
const assertFits = async (page) => {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
};
try {
  for (const width of [320, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push({ width, error: error.message }));
    page.on('response', response => { if (response.url().startsWith(base) && response.status() >= 500) errors.push({ width, url: response.url(), status: response.status() }); });
    for (const route of ['/', '/servicos', '/galeria', '/contato', '/privacidade', '/entrar']) {
      const response = await page.goto(base + route, { waitUntil: 'networkidle' });
      expect(response.status()).toBe(200);
      await assertFits(page);
      if (route === '/') {
        await expect(page.locator('video[src]')).toHaveCount(0);
        await expect(page.locator('video[poster]')).toHaveCount(0);
      }
      if (route === '/servicos') {
        await expect(page.locator('.ticker-group[data-copy="false"]')).toContainText('R$ 150,00');
        await expect(page.locator('.ticker-group[data-copy="false"]')).toContainText('A partir de R$ 25,00');
        for (const [type, amounts] of [['Carro pequeno', [30, 50, 60]], ['SUV', [40, 65, 75]], ['Caminhonete', [50, 80, 90]]]) {
          await page.getByRole('tab', { name: type, exact: true }).click();
          for (let i = 0; i < amounts.length; i++) await expect(page.locator('.price-card .price').nth(i)).toContainText(String(amounts[i]));
        }
        const extraCards = page.locator('.ticker-group[data-copy="false"] .extra-card');
        await expect(extraCards).toHaveCount(expectedExtras.length);
        await expect(page.locator('.ticker-group[data-copy="false"] a')).toHaveCount(expectedExtras.length * 2);
        for (const [index, [slug, name]] of expectedExtras.entries()) {
          const card = extraCards.nth(index);
          await expect(card.getByRole('heading', { level: 3 })).toHaveText(name);
          await expect(card.locator('a')).toHaveCount(2);
          const booking = card.getByRole('link', { name: 'Solicitar agendamento', exact: true });
          const bookingUrl = new URL(await booking.getAttribute('href'), base);
          expect(bookingUrl.origin).toBe(new URL(base).origin);
          expect(bookingUrl.pathname).toBe('/cliente/agendar');
          expect(Object.fromEntries(bookingUrl.searchParams)).toEqual({
            servico: slug,
            ...(slug === 'moto' ? { veiculo: 'moto' } : {}),
          });
          const whatsapp = card.getByRole('link', { name: 'Consultar pelo WhatsApp', exact: true });
          const whatsappUrl = new URL(await whatsapp.getAttribute('href'));
          expect(whatsappUrl.origin).toBe('https://wa.me');
          expect(whatsappUrl.pathname).toBe('/5586998469155');
          expect(Object.fromEntries(whatsappUrl.searchParams)).toEqual({
            text: `Olá! Gostaria de consultar disponibilidade e orçamento para ${name}.`,
          });
          await expect(whatsapp).toHaveAttribute('target', '_blank');
          await expect(whatsapp).toHaveAttribute('rel', 'noreferrer');
        }
      }
      if (route === '/contato') {
        await expect(page.locator('.contact-hours')).toContainText('Segunda a sábado, das 8h às 17h');
        await expect(page.getByRole('button', { name: 'Carregar mapa' })).toBeVisible();
        await expect(page.locator('iframe')).toHaveCount(0);
      }
      if (route === '/galeria') {
        await expect(page.locator('.comparison-images img').nth(1)).toHaveAttribute('alt', /^Antes:/);
        await expect(page.locator('.comparison-images img').nth(1)).toHaveAttribute('src', /foto-20/);
        await expect(page.locator('.headlight-frame')).toHaveCount(2);
        await expect(page.locator('.headlight-frame img').first()).toHaveAttribute('src', '/gallery/foto-08.webp');
        await expect(page.locator('img[src*="farol-antes"], img[src*="farol-depois"]')).toHaveCount(0);
        await page.locator('.comparison-pair').scrollIntoViewIfNeeded();
        await page.locator('#galeria').screenshot({ path: path.join(evidence, `comparacoes-${width}.png`) });
      }
      await expect(page.locator('.extra-card .lucide-sparkles')).toHaveCount(0);
      if (route === '/entrar') await expect(page.getByRole('link', { name: 'Agendar pelo WhatsApp' })).toHaveAttribute('href', /wa\.me\/5586998469155/);
      if (route === '/' && width < 768) {
        await page.getByRole('button', { name: 'Abrir menu' }).click();
        await expect(page.getByRole('navigation', { name: 'Menu mobile' })).toBeVisible();
        await page.getByRole('button', { name: 'Fechar menu' }).click();
        await expect(page.getByRole('navigation', { name: 'Menu mobile' })).toHaveCount(0);
      }
      results.push({ width, route, status: 'passed' });
    }
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('#videos').scrollIntoViewIfNeeded();
    await expect(page.locator('video[src]')).toHaveCount(0);
    const viewport = page.locator('.reels-viewport');
    await page.getByRole('button', { name: 'Ver próximos vídeos' }).click();
    expect(await viewport.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Ver vídeos anteriores' }).click();
    await page.getByRole('button', { name: 'Reproduzir vídeo: Devolvemos o brilho ao seu carro', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Pausar vídeo: Devolvemos o brilho ao seu carro', exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Pausar vídeo: Devolvemos o brilho ao seu carro', exact: true }).click();
    await expect(page.locator('video').first()).toHaveJSProperty('paused', true);
    await page.evaluate(async () => {
      for (let y = 0; y < document.documentElement.scrollHeight; y += 650) { window.scrollTo(0, y); await new Promise(resolve => setTimeout(resolve, 30)); }
      window.scrollTo(0, 0);
    });
    await page.waitForTimeout(500);
    const broken = await page.locator('img').evaluateAll(nodes => nodes.filter(n => n.complete && !n.naturalWidth).map(n => n.src));
    expect(broken).toEqual([]);
    await assertFits(page);
    if (width === 390 || width === 1440) await page.screenshot({ path: path.join(evidence, `home-${width}.png`), fullPage: true });
    if (width === 390) {
      await page.goto(base + '/galeria', { waitUntil: 'networkidle' });
      const slider = page.getByRole('slider').first();
      await slider.focus();
      const before = await slider.inputValue();
      await page.keyboard.press('ArrowRight');
      expect(Number(await slider.inputValue())).toBeGreaterThan(Number(before));
      await page.screenshot({ path: path.join(evidence, 'galeria-mobile.png'), fullPage: true });
      await page.goto(base + '/contato', { waitUntil: 'networkidle' });
      await page.screenshot({ path: path.join(evidence, 'contato-mobile.png'), fullPage: true });
      await page.route('https://maps.google.com/**', route => route.abort());
      await page.getByRole('button', { name: 'Carregar mapa' }).click();
      await expect(page.locator('iframe')).toHaveAttribute('src', /maps\.google\.com\/maps\?q=/);
    }
    await context.close();
    console.log(`Interface ${width}px: rotas, preços, contato, navegação de vídeos e movimento reduzido aprovados.`);
  }
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push({ error: error.message }));
  await page.goto(base);
  await expect(page.locator('.loader')).toHaveCount(0, { timeout: 5000 });
  await page.locator('#videos').scrollIntoViewIfNeeded();
  await expect(page.locator('video[src]').first()).toBeVisible();
  const privateResponse = await page.request.get(base + '/api/admin/transactions');
  expect(privateResponse.status()).toBe(503);
  await page.goto(base + '/admin');
  expect(new URL(page.url()).pathname).toBe('/entrar');
  await context.close();
  expect(errors).toEqual([]);
  await writeFile(path.join(evidence, 'browser-checks.json'), JSON.stringify({ checkedAt: new Date().toISOString(), base, results, checks: ['prices', 'eleven-extra-services', 'extra-booking-links', 'extra-whatsapp-links', 'mobile-menu', 'horizontal-overflow', 'reduced-motion', 'manual-video-play-pause', 'video-navigation', 'gallery-keyboard', 'map-on-demand', 'auth-fallback', 'admin-protection'], errors }, null, 2));
  console.log('Interface aprovada; evidências salvas em ' + evidence);
} finally { await browser.close(); }
