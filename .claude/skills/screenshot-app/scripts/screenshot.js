#!/usr/bin/env node
/*
 * Log into CookieJar and screenshot one or more routes.
 *
 *   node .claude/skills/screenshot-app/scripts/screenshot.js \
 *     /manual-transactions /tmp/manual.png  /transactions /tmp/txns.png
 *
 * Args are (route, output-path) pairs. Env:
 *   SCREENSHOT_BASE_URL       default http://localhost:3000
 *   SCREENSHOT_PASSWORD       default test
 *   PLAYWRIGHT_BROWSERS_PATH  optional override (else auto-discovered)
 *   SCREENSHOT_PLAYWRIGHT     optional path to a playwright package dir to force
 *
 * Two things are auto-discovered instead of hard-coded, because their locations
 * are properties of the sandbox image and may move:
 *   1. The Playwright *browsers* directory — Playwright's browser CDN is blocked
 *      by the network allowlist (`playwright install` → 403), so we must reuse a
 *      browser already baked into the image.
 *   2. A Playwright *module* whose expected Chromium build actually exists in (1)
 *      — version drift between an installed module and the on-disk browser is the
 *      usual failure, so we match them up by revision.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const BASE = process.env.SCREENSHOT_BASE_URL || 'http://localhost:3000';
const PASSWORD = process.env.SCREENSHOT_PASSWORD || 'test';

function dirHasChromium(dir) {
  try { return fs.readdirSync(dir).some((n) => /^chromium(_headless_shell)?-\d+$/.test(n)); }
  catch { return false; }
}

// 1. Locate the directory that holds the pre-installed browser builds.
function findBrowsersPath() {
  const candidates = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    path.join(os.homedir(), '.cache/ms-playwright'),
    '/ms-playwright',
    '/root/.cache/ms-playwright',
  ].filter(Boolean);
  for (const c of candidates) if (dirHasChromium(c)) return c;
  try {
    const found = execSync(
      "find /opt \"$HOME/.cache\" /root /usr/lib /ms-playwright -maxdepth 5 -type d " +
      "\\( -name 'chromium-*' -o -name 'chromium_headless_shell-*' \\) 2>/dev/null | head -1",
      { encoding: 'utf8', shell: '/bin/bash' },
    ).trim();
    if (found) return path.dirname(found);
  } catch { /* ignore */ }
  return null;
}

// The chromium build dir name (e.g. "chromium-1194") a given playwright module expects.
// browsers.json isn't exposed via package "exports", so resolve playwright-core's
// package.json and read the sibling file directly.
function expectedChromiumDir(pwDir) {
  try {
    const pkg = require.resolve('playwright-core/package.json', { paths: [pwDir] });
    const bj = path.join(path.dirname(pkg), 'browsers.json');
    const json = JSON.parse(fs.readFileSync(bj, 'utf8'));
    const chromium = json.browsers.find((b) => b.name === 'chromium');
    return chromium ? `chromium-${chromium.revision}` : null;
  } catch { return null; }
}

// 2. Pick a playwright module whose expected Chromium build is present on disk.
function findPlaywright(browsersPath) {
  const candidates = [
    process.env.SCREENSHOT_PLAYWRIGHT,
    '/opt/node22/lib/node_modules/playwright',
    path.join(__dirname, '../../../../e2e/node_modules/playwright'),
    '/usr/local/lib/node_modules/playwright',
  ].filter(Boolean);
  try {
    const root = execSync('npm root -g 2>/dev/null', { encoding: 'utf8' }).trim();
    if (root) candidates.push(path.join(root, 'playwright'));
  } catch { /* ignore */ }
  try {
    const more = execSync(
      "find /opt /usr/local/lib /usr/lib \"$HOME\" -maxdepth 8 -type d -path '*/node_modules/playwright' 2>/dev/null",
      { encoding: 'utf8', shell: '/bin/bash' },
    ).trim().split('\n').filter(Boolean);
    candidates.push(...more);
  } catch { /* ignore */ }

  const seen = new Set();
  let firstLoadable = null;
  for (const dir of candidates) {
    if (seen.has(dir) || !fs.existsSync(dir)) continue;
    seen.add(dir);
    let mod;
    try { mod = require(dir); } catch { continue; }
    if (!firstLoadable) firstLoadable = { dir, mod };
    const want = expectedChromiumDir(dir);
    if (want && browsersPath && fs.existsSync(path.join(browsersPath, want))) {
      return { dir, mod, matched: true };
    }
  }
  return firstLoadable ? { ...firstLoadable, matched: false } : null;
}

const browsersPath = findBrowsersPath();
if (browsersPath && !process.env.PLAYWRIGHT_BROWSERS_PATH) {
  process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;
}
const pw = findPlaywright(browsersPath);
if (!pw) {
  console.error('Could not find a usable "playwright" module. Locate one with:\n' +
    "  find / -maxdepth 8 -type d -path '*/node_modules/playwright' 2>/dev/null\n" +
    'and pass it via SCREENSHOT_PLAYWRIGHT=…');
  process.exit(1);
}
console.error(`playwright: ${pw.dir}${pw.matched ? '' : ' (no matching browser build found — launch may fail)'}`);
console.error(`browsers:   ${process.env.PLAYWRIGHT_BROWSERS_PATH || '(default)'}`);
const { chromium } = pw.mod;

const pairs = process.argv.slice(2);
if (pairs.length === 0 || pairs.length % 2 !== 0) {
  console.error('Usage: screenshot.js <route> <output.png> [<route> <output.png> ...]');
  process.exit(1);
}

// Shared-password login (next-auth). The form's submit runs signIn() in a client
// component, so a click before React hydrates does a native GET (?password=…) and
// never navigates — hence the hydration wait + retry loop.
async function login(page) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' });
    await page.locator('[name="password"]').waitFor();
    await page.waitForTimeout(800); // let the client component hydrate
    await page.locator('[name="password"]').fill(PASSWORD);
    await Promise.all([
      page.waitForURL(`${BASE}/`, { timeout: 8000 }).catch(() => {}),
      page.getByRole('button', { name: /sign in/i }).click(),
    ]);
    if (new URL(page.url()).pathname === '/') return;
    if (await page.getByText(/incorrect password/i).isVisible().catch(() => false)) {
      throw new Error(`login failed: incorrect password (SCREENSHOT_PASSWORD="${PASSWORD}")`);
    }
  }
  throw new Error('login did not navigate to / after 4 attempts (hydration/timeout?)');
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
  const page = await ctx.newPage();

  await login(page);

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
