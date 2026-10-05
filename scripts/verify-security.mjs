import { chromium } from 'playwright';
import { expect } from '@playwright/test';
import { access, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Read-only, anonymous verification against the application's production build.
// No user cookies, credentials, account creation or external messages are used.
const base = (process.env.BASE_URL || 'http://localhost:3025').replace(/\/$/, '');
const evidence = path.resolve(process.env.EVIDENCE_DIR || '../evidencias/seguranca');
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath && process.platform === 'win32') {
  const chrome = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  try { await access(chrome); executablePath = chrome; } catch { /* Use bundled Chromium. */ }
}
await mkdir(evidence, { recursive: true });
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const results = [];
const runtimeErrors = [];
const violations = [];
page.on('pageerror', error => runtimeErrors.push(error.name));
await page.addInitScript(() => {
  window.__securityPolicyViolations = [];
  document.addEventListener('securitypolicyviolation', event => window.__securityPolicyViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
});
try {
  const response = await page.goto(base, { waitUntil: 'networkidle' });
  expect(response.status()).toBe(200);
  const headers = await response.allHeaders();
  const policy = headers['content-security-policy'] || '';
  expect(policy).toMatch(/script-src[^;]*'nonce-[^']+'[^;]*'strict-dynamic'/);
  expect(policy.split(';').find(value => value.trim().startsWith('script-src'))).not.toMatch(/unsafe-inline|unsafe-eval/);
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['x-frame-options']).toBe('DENY');
  expect(headers['x-powered-by']).toBeUndefined();
  expect(await page.title()).toBe('Automotive');
  const nonce = policy.match(/'nonce-([^']+)'/)[1];
  // Dynamically loaded descendants may rely on strict-dynamic. Scripts emitted
  // in the HTML itself must carry the response's nonce.
  const scriptTags = (await response.text()).match(/<script\b[^>]*>/g) || [];
  expect(scriptTags.length).toBeGreaterThan(0);
  expect(scriptTags.every(tag => tag.match(/\bnonce="([^"]+)"/)?.[1] === nonce)).toBe(true);
  expect(await page.evaluate(() => window.__securityPolicyViolations)).toEqual([]);
  results.push({ test: 'production-headers-and-nonced-scripts', passed: true });

  // Simulate an attacker inserting markup into the HTML, not DevTools code
  // execution (which is deliberately outside CSP's protection boundary).
  const attackPage = await context.newPage();
  await attackPage.addInitScript(() => {
    window.__securityPolicyViolations = [];
    document.addEventListener('securitypolicyviolation', event => window.__securityPolicyViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));
  });
  const attackUrl = `${base}/?security-smoke=injected-parser-script`;
  await attackPage.route(attackUrl, async route => {
    const original = await route.fetch();
    const html = (await original.text()).replace('</head>', '<script>window.__injectedSecurityScript = true;</script></head>');
    await route.fulfill({ response: original, body: html });
  });
  await attackPage.goto(attackUrl, { waitUntil: 'networkidle' });
  expect(await attackPage.evaluate(() => window.__injectedSecurityScript === true)).toBe(false);
  results.push({ test: 'injected-inline-script-blocked-by-csp', passed: true });
  violations.push(...await attackPage.evaluate(() => window.__securityPolicyViolations));
  expect(violations.some(event => event.directive === 'script-src-elem' && event.blocked === 'inline')).toBe(true);
  await attackPage.close();

  await page.goto(`${base}/entrar`, { waitUntil: 'networkidle' });
  await expect(page.locator('input[type="email"], input[name="identifier"]')).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole('button', { name: /Google/i })).toBeVisible();
  const loginViolations = await page.evaluate(() => window.__securityPolicyViolations);
  expect(loginViolations).toEqual([]);
  results.push({ test: 'clerk-login-renders-under-csp', passed: true });
  await page.screenshot({ path: path.join(evidence, 'login-producao.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  results.push({ test: 'mobile-login-fits-viewport', passed: true });

  for (const route of ['/api/admin/clients', '/api/admin/queue', '/api/admin/finance/export']) {
    const apiResponse = await context.request.get(`${base}${route}`, { headers: { 'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy' } });
    expect(apiResponse.status()).toBe(401);
    expect((await apiResponse.json()).error).toBeTruthy();
    results.push({ test: `anonymous-administrative-denied:${route}`, passed: true });
  }
  const crossSite = await context.request.patch(`${base}/api/profile/me`, { headers: { Origin: 'https://attacker.example', 'Sec-Fetch-Site': 'cross-site' }, data: { role: 'admin' } });
  expect(crossSite.status()).toBe(403);
  results.push({ test: 'cross-site-mutation-denied', passed: true });
  const webhook = await context.request.post(`${base}/api/webhooks/clerk`, { data: { type: 'user.updated', data: { public_metadata: { role: 'admin' } } } });
  expect([400, 503]).toContain(webhook.status());
  results.push({ test: 'unsigned-clerk-webhook-denied', passed: true });
  for (const route of ['/constructor', '/__proto__']) {
    expect((await context.request.get(`${base}${route}`)).status()).toBe(404);
  }
  results.push({ test: 'inherited-public-route-keys-denied', passed: true });
  const second = await context.request.get(base);
  expect(second.headers()['content-security-policy'].match(/'nonce-([^']+)'/)[1]).not.toBe(nonce);
  results.push({ test: 'fresh-nonce-on-each-request', passed: true });
  expect(runtimeErrors).toEqual([]);
  console.log(`Verificação de segurança aprovada: ${results.length} cenários no build de produção.`);
} finally {
  await page.screenshot({ path: path.join(evidence, 'ultima-tela-mobile.png'), fullPage: true }).catch(() => {});
  // Do not store session tokens, raw authentication errors or full response bodies.
  await writeFile(path.join(evidence, 'security-smoke.json'), JSON.stringify({ results, runtimeErrors, violations }, null, 2));
  await browser.close();
}
