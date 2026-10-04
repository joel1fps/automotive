import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Run against an already configured server. Never reads environment files,
// submits authentication forms, creates accounts, or sends recovery emails.
const base = (process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const evidence = path.resolve(process.env.EVIDENCE_DIR || '../evidencias/clerk-setup');
const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  try { await access(chrome); executablePath = chrome; } catch { /* Use Playwright's browser. */ }
}
await mkdir(evidence, { recursive: true });

const results = [];
const runtimeErrors = [];
const networkIssues = [];
const safeMessage = value => String(value)
  .replace(/\b(?:pk|sk)_(?:test|live)_[A-Za-z0-9_-]+\b/g, '[REDACTED_KEY]')
  .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_TOKEN]');
const publicUrl = value => {
  try { const url = new URL(value); return url.origin + url.pathname; }
  catch { return '[invalid URL]'; }
};
let browser;
let startup = true;

async function check(name, page, run, details = {}) {
  try {
    const extra = await run();
    results.push({ name, ...details, status: 'passed', ...(extra || {}) });
    console.log(`PASS ${name}${details.width ? ` (${details.width}px)` : ''}`);
  } catch (error) {
    results.push({ name, ...details, status: 'failed', error: safeMessage(error.message) });
    console.error(`FAIL ${name}${details.width ? ` (${details.width}px)` : ''}: ${safeMessage(error.message)}`);
    if (page && !page.isClosed()) {
      const file = `${name}-${details.width || 'default'}-failed.png`;
      await page.screenshot({ path: path.join(evidence, file) }).catch(() => {});
    }
  }
}

async function newPage(width) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(60000);
  page.on('pageerror', error => runtimeErrors.push({ width, route: publicUrl(page.url()), error: safeMessage(error.message) }));
  page.on('requestfailed', request => networkIssues.push({ width, url: publicUrl(request.url()), error: safeMessage(request.failure()?.errorText) }));
  page.on('response', response => {
    if (response.status() >= 500) networkIssues.push({ width, url: publicUrl(response.url()), status: response.status() });
  });
  return { context, page };
}

async function navigate(page, route) {
  const response = await page.goto(base + route, { waitUntil: 'domcontentloaded' });
  expect(response?.status()).toBe(200);
}

async function clerkReady(page) {
  try {
    await page.waitForFunction(() => window.Clerk?.loaded === true, null, { timeout: 45000 });
  } catch {
    throw new Error('O SDK real do Clerk não carregou em 45 segundos. Confira as requisições públicas e a configuração da instância.');
  }
}

async function assertFits(page) {
  const dimensions = await page.evaluate(() => ({ width: window.innerWidth, content: document.documentElement.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.width + 1);
  return dimensions;
}

try {
  const available = await fetch(base, { signal: AbortSignal.timeout(60000) });
  expect(available.status).toBe(200);
  browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
  startup = false;
  for (const width of [320, 390, 851, 900, 1100, 1440]) {
    const { context, page } = await newPage(width);
    await check('public-auth-navigation', page, async () => {
      await navigate(page, '/');
      await clerkReady(page);
      const mobile = width <= 850;
      if (mobile) await page.getByRole('button', { name: 'Abrir menu', exact: true }).click();
      const navigation = page.getByRole('navigation', { name: mobile ? 'Menu mobile' : 'Menu principal', exact: true });
      const signIn = navigation.getByRole('link', { name: 'Entrar', exact: true });
      const signUp = navigation.getByRole('link', { name: 'Criar conta', exact: true });
      await expect(signIn).toBeVisible();
      await expect(signIn).toHaveAttribute('href', '/entrar');
      await expect(signUp).toBeVisible();
      await expect(signUp).toHaveAttribute('href', '/cadastro');
      await expect(navigation.getByRole('link', { name: 'Minha conta', exact: true })).toHaveCount(0);
      const dimensions = await assertFits(page);
      await page.screenshot({ path: path.join(evidence, `home-${width}.png`) });
      if (mobile) {
        await signIn.click();
        await expect(page).toHaveURL(new RegExp('/entrar(?:[/?#]|$)'), { timeout: 30000 });
        await expect(page.getByRole('navigation', { name: 'Menu mobile', exact: true })).toHaveCount(0);
      }
      return { dimensions, clerkLoaded: true };
    }, { width });
    await context.close();
  }

  for (const width of [390, 1440]) {
    const { context, page } = await newPage(width);
    await check('sign-in-form', page, async () => {
      await navigate(page, '/entrar');
      await clerkReady(page);
      const form = page.locator('.cl-signIn-root');
      await expect(form).toBeVisible();
      await expect(form.locator('input[name="identifier"], input[name="emailAddress"], input[type="email"]').first()).toBeVisible();
      const dimensions = await assertFits(page);
      await page.screenshot({ path: path.join(evidence, `entrar-${width}.png`) });
      return { dimensions, clerkLoaded: true };
    }, { width });
    await check('sign-in-google', page, async () => {
      await expect(page.locator('.cl-signIn-root').getByRole('button', { name: /Google/i })).toBeVisible({ timeout: 5000 });
      return { googleAvailable: true };
    }, { width });

    await check('sign-up-consent-and-form', page, async () => {
      await navigate(page, '/cadastro');
      await clerkReady(page);
      const consent = page.getByRole('checkbox');
      await expect(consent).toBeVisible();
      await expect(consent).not.toBeChecked();
      await expect(page.locator('.cl-signUp-root')).toHaveCount(0);
      await page.screenshot({ path: path.join(evidence, `cadastro-consentimento-${width}.png`) });
      // The gate unmounts the checkbox immediately after accepting it.
      await consent.click();
      const form = page.locator('.cl-signUp-root');
      await expect(form).toBeVisible();
      await expect(form.locator('input[name="emailAddress"], input[type="email"]').first()).toBeVisible();
      const dimensions = await assertFits(page);
      await page.screenshot({ path: path.join(evidence, `cadastro-${width}.png`) });
      return { dimensions, clerkLoaded: true, consentRequired: true };
    }, { width });
    await check('sign-up-google', page, async () => {
      await expect(page.locator('.cl-signUp-root').getByRole('button', { name: /Google/i })).toBeVisible({ timeout: 5000 });
      return { googleAvailable: true };
    }, { width });

    await check('password-recovery-form', page, async () => {
      await navigate(page, '/recuperar-senha');
      await clerkReady(page);
      await expect(page.getByRole('heading', { name: 'Recuperar senha', exact: true })).toBeVisible();
      const email = page.getByRole('textbox', { name: 'Seu e-mail', exact: true });
      await expect(email).toBeVisible();
      await expect(email).toHaveAttribute('type', 'email');
      await expect(page.getByRole('button', { name: 'Enviar código', exact: true })).toBeEnabled();
      const dimensions = await assertFits(page);
      await page.screenshot({ path: path.join(evidence, `recuperar-senha-${width}.png`) });
      return { dimensions, noEmailSent: true };
    }, { width });

    await check('admin-api-requires-session', page, async () => {
      const response = await page.request.get(base + '/api/admin/transactions');
      expect(response.status()).toBe(401);
      return { httpStatus: response.status() };
    }, { width });
    await check('admin-page-requires-session', page, async () => {
      await page.goto(base + '/admin', { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(new RegExp('/entrar(?:[/?#]|$)'), { timeout: 30000 });
      return { redirectedTo: new URL(page.url()).pathname };
    }, { width });
    await context.close();
  }
  await check('no-browser-runtime-errors', null, async () => { expect(runtimeErrors).toEqual([]); });
} catch (error) {
  results.push({ name: startup ? 'server-or-browser-startup' : 'browser-session', status: 'failed', error: safeMessage(error.message) });
  console.error(safeMessage(error.message));
} finally {
  if (browser) await browser.close();
  const failed = results.filter(result => result.status === 'failed').length;
  await writeFile(path.join(evidence, 'browser-checks.json'), JSON.stringify({
    checkedAt: new Date().toISOString(), base, mode: 'real-clerk-development',
    passed: results.length - failed, failed, results, runtimeErrors, networkIssues,
    constraints: ['no-auth-form-submission', 'no-account-created', 'no-recovery-email-sent', 'no-env-file-access'],
  }, null, 2));
  console.log(`Clerk: ${results.length - failed} checks passed, ${failed} failed. Evidence: ${evidence}`);
  process.exitCode = failed ? 1 : 0;
}
