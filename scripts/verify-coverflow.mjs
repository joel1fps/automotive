import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const base = process.env.BASE_URL || 'http://localhost:3034';
const evidence = '../evidencias/versao-v9';
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch();
const errors = [], results = [];
try {
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.loader')).toHaveCount(0);
    const viewport = page.locator('.coverflow-viewport');
    await expect(async () => { await viewport.scrollIntoViewIfNeeded(); }).toPass({ timeout: 10000 });
    await expect(page.locator('.coverflow-card')).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Serviço anterior', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: 'Próximo serviço', exact: true }).click();
    await expect(page.locator('.coverflow-card').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(700);
    await viewport.focus(); await page.keyboard.press('ArrowRight');
    await expect(page.locator('.coverflow-card').nth(2)).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(700);
    await viewport.screenshot({ path: `${evidence}/coverflow-${width}.png` });
    const geometry = await page.locator('.coverflow-card').evaluateAll(nodes => nodes.map(n => { const m = new DOMMatrix(getComputedStyle(n).transform); return { a: m.a, m13: m.m13 }; }));
    expect(Math.abs(geometry[2].m13)).toBeLessThan(.01);
    expect(geometry[1].m13).toBeLessThan(0);
    expect(geometry[3].m13).toBeGreaterThan(0);
    const box = await viewport.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 170, box.y + box.height / 2, { steps: 14 }); await page.mouse.up();
    await page.waitForTimeout(900);
    const index = await page.locator('.coverflow-card').evaluateAll(nodes => nodes.findIndex(n => n.getAttribute('aria-pressed') === 'true'));
    expect(index).toBeGreaterThan(2);
    await viewport.focus(); await page.keyboard.press('End');
    await expect(page.getByRole('button', { name: 'Próximo serviço', exact: true })).toBeDisabled();
    await page.keyboard.press('Home'); await page.waitForTimeout(700);
    // Click the visible inner edge of the adjacent card, beyond the front card.
    const side = await page.locator('.coverflow-card').nth(1).boundingBox();
    await page.mouse.click(Math.min(box.x + box.width - 5, side.x + side.width - 10), side.y + side.height / 2);
    await expect(page.locator('.coverflow-card').nth(1)).toHaveAttribute('aria-pressed', 'true');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(async () => { await viewport.scrollIntoViewIfNeeded(); }).toPass({ timeout: 10000 });
    await page.getByRole('button', { name: 'Próximo serviço', exact: true }).click();
    await expect(page.locator('.coverflow-card').nth(1)).toHaveAttribute('aria-pressed', 'true');
    const rotations = await page.locator('.coverflow-card').evaluateAll(nodes => nodes.map(n => new DOMMatrix(getComputedStyle(n).transform).m13));
    expect(rotations.every(n => Math.abs(n) < .001)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    results.push({ width, arrows: true, keyboard: true, drag: true, sideClick: true, reducedMotion: true });
    await page.close();
  }
  expect(errors).toEqual([]);
  await writeFile(`${evidence}/coverflow-checks.json`, JSON.stringify({ results, errors }, null, 2));
  console.log('Coverflow: desktop/mobile, arrows, keyboard, drag, side click, reduced motion and no overflow passed.');
} finally { await browser.close(); }
