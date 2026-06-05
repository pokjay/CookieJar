#!/usr/bin/env node
/*
 * Log into CookieJar and screenshot one or more routes.
 *
 *   PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /opt/node22/bin/node \
 *     .claude/skills/screenshot-app/scripts/screenshot.js \
 *     /manual-transactions /tmp/manual.png  /transactions /tmp/txns.png
 *
 * Args are (route, output-path) pairs. Env:
 *   SCREENSHOT_BASE_URL   default http://localhost:3000
 *   SCREENSHOT_PASSWORD   default test
 *
 * Why the odd node/browser paths: Playwright's browser CDN is NOT in the
 * sandbox network allowlist (`playwright install` fails with 403 "Host not in
 * allowlist"). A matching Chromium is already baked into the image at
 * /opt/pw-browsers, driven by the global playwright at /opt/node22. Use those.
 */
const BASE = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.SCREENSHOT_PASSWORD || 'test';

// Resolve the global playwright module that matches the pre-installed browser.
let chromium;
for (const p of [
  '/opt/node22/lib/node_modules/playwright',
  'playwright',
  '/usr/local/lib/node_modules/playwright',
]) {
  try { ({ chromium } = require(p)); break; } catch { /* try next */ }
}
if (!chromium) {
  console.error('Could not load the global "playwright" module. Find it with:\n' +
    '  find / -path "*/node_modules/playwright/index.js" 2>/dev/null');
  process.exit(1);
}
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  // The pre-installed browsers live here; without this Playwright looks in ~/.cache and fails.
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/opt/pw-browsers';
}

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('Usage: screenshot.js <route> <output.png> [<route> <output.png> ...]');
  process.exit(1);
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();

  // Shared-password login (next-auth). Session cookie persists for the context.
  await page.goto(`${BASE}/login`);
  await page.locator('[name="password"]').fill(PASSWORD);
  await page.locator('[type="submit"]').click();
  await page.waitForURL(`${BASE}/`);

  for (let i = 0; i < pairs.length; i += 2) {
    const route = pairs[i].startsWith('/') ? pairs[i] : `/${pairs[i]}`;
    const out = pairs[i + 1];
    await page.goto(`${BASE}${route}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`✓ ${route} → ${out}`);
  }

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
