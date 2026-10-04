import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL || 'http://localhost:3032';
const evidence = '../evidencias/versao-v7';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const errors = [];
const results = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base + '/servicos', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.loader')).toHaveCount(0);
    await page.route('**/contato?*', async route => {
      await new Promise(resolve => setTimeout(resolve, 650));
      await route.continue();
    });
    const link = page.getByRole('link', { name: 'Conversar sobre serviços especiais' });
    await link.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.curtainFrames = [];
      window.recordCurtains = true;
      const frame = () => {
        const overlay = document.querySelector('.curtain-overlay');
        const left = document.querySelector('.curtain-door-left');
        const right = document.querySelector('.curtain-door-right');
        window.curtainFrames.push({ time: performance.now(), path: location.pathname, phase: overlay.dataset.phase,
          left: getComputedStyle(left).transform, right: getComputedStyle(right).transform });
        if (window.recordCurtains) requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
    await link.click();
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'covering');
    expect(new URL(page.url()).pathname).toBe('/servicos');
    // A synthetic repeat also must be ignored, beyond pointer interception/inert.
    await page.evaluate(() => document.querySelector('a[href="/galeria"]').click());
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'covered');
    await page.screenshot({ path: `${evidence}/covered-${width}.png` });
    await expect(page).toHaveURL(base + '/contato');
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'idle');
    const frames = await page.evaluate(() => { window.recordCurtains = false; return window.curtainFrames; });
    const firstNew = frames.find(f => f.path === '/contato');
    expect(firstNew).toBeTruthy();
    expect(firstNew.left).toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(firstNew.right).toBe('matrix(1, 0, 0, 1, 0, 0)');
    expect(frames.some(f => f.path === '/galeria')).toBe(false);
    await page.screenshot({ path: `${evidence}/revealed-${width}.png` });
    // Confirm the same provider survives navigation and server redirects.
    await page.getByRole('link', { name: 'Solicitar agendamento' }).first().click();
    await expect(page).toHaveURL(/\/entrar/);
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'idle');
    await page.getByRole('link', { name: 'Voltar ao site', exact: true }).click();
    await expect(page).toHaveURL(base + '/');
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'idle');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('link', { name: 'Serviços e preços', exact: true }).first().click();
    await expect(page).toHaveURL(base + '/servicos');
    await expect(page.locator('.curtain-overlay')).toHaveAttribute('data-phase', 'idle');
    expect(await page.locator('.page-transition-content').getAttribute('inert')).toBeNull();
    results.push({ width, passed: true, frames });
    await page.close();
  }
  expect(errors).toEqual([]);
  await writeFile(`${evidence}/curtains-checks.json`, JSON.stringify({ results, errors }, null, 2));
  console.log('Curtains: desktop/mobile, slow route, no premature reveal, duplicate click, redirect, repeated navigation and reduced motion passed.');
} finally { await browser.close(); }
