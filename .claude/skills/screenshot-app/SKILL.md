---
name: screenshot-app
description: "Use when asked to screenshot, visually check, or see the CookieJar app running in the Claude Code web/sandbox environment, where Docker (make dev / make e2e) is unavailable. Boots FastAPI + Next.js directly and drives the pre-installed Chromium with Playwright."
triggers:
  - screenshot
  - screen.?shot
  - visual.?check
  - visual.?test
  - see.?the.?app
  - show.?me.?the.?(app|ui|page|screen)
  - capture.?the.?(app|ui|page|screen)
  - what.?does.?it.?look.?like
---

# Screenshot the App (no Docker)

The CookieJar sandbox (Claude Code on the web) has **no Docker daemon**, so
`make dev` / `make e2e` / `make e2e-up` all fail. This skill boots the two
servers directly and screenshots routes by driving the **pre-installed**
Chromium — `npx playwright install` is blocked by the network allowlist.

## TL;DR

```bash
# 1. Start backend (mock data, :8083) + frontend (Next.js dev, :3000).
source .claude/skills/screenshot-app/scripts/serve.sh

# 2. Log in and screenshot any routes (route + output-path pairs).
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers /opt/node22/bin/node \
  .claude/skills/screenshot-app/scripts/screenshot.js \
  /manual-transactions /tmp/manual.png  /transactions /tmp/txns.png

# 3. View with the Read tool, send with SendUserFile, then stop the servers.
screenshot_app_stop
```

Then `Read` the PNGs to confirm they rendered, and `SendUserFile` to share them.

## Why the unusual paths (the two gotchas)

1. **No Docker.** Run the stack from source instead:
   - Backend: `USE_MOCK_DATA=true uv run uvicorn backend.main:app --port 8083`
   - Frontend: `cd frontend && npm run dev` (Next dev, port 3000)
   - Leave `API_SECRET` **unset** → the backend's `X-API-Secret` middleware
     (`backend/main.py`) becomes a no-op and the `/api/*` proxy
     (`frontend/src/app/api/[...proxy]/route.ts`) doesn't need the header.
   - `next dev` needs `node_modules`; the committed lockfile is out of sync
     (missing `next-themes`), so `npm ci` fails — use `npm install --no-save`.
   - `serve.sh` does all of the above and waits until both are reachable.

2. **Playwright browser CDN is blocked.** `playwright install chromium` fails
   with `403 Host not in allowlist`. A matching browser is already in the image:
   - Browsers: `/opt/pw-browsers` (set `PLAYWRIGHT_BROWSERS_PATH` to it)
   - Global playwright module + node: `/opt/node22/lib/node_modules/playwright`,
     run with `/opt/node22/bin/node`
   - Do **not** `require('@playwright/test')` from `e2e/node_modules` — that
     version expects a browser build the sandbox doesn't have.
   - `screenshot.js` resolves these automatically.

## Auth

next-auth shared-password login. `serve.sh` sets `AUTH_PASSWORD=test` (override
with `SCREENSHOT_PASSWORD=…` before sourcing). `screenshot.js` logs in by filling
`[name="password"]`, clicking `[type="submit"]`, and waiting for `/`.

## Interactive flows (expand a section, upload a CSV, toggle a cell)

For anything beyond "open route → capture", copy `screenshot.js` to `/tmp` and
add page steps after login. The preview table exposes
`data-testid="preview-row-<i>"` and `data-testid="preview-cell-<col>"`; CSV is
uploaded via `input[type="file"].setInputFiles({ name, mimeType, buffer })`.
Example (CSV import with a per-row edit):

```js
await page.getByRole('button', { name: /csv import/i }).click();
await page.locator('input[type="file"]').setInputFiles({
  name: 'demo.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV),
});
await page.locator('text=/^\\d+ rows$/').waitFor();
await page.getByTestId('preview-row-2')
  .getByTestId('preview-cell-show_in_transactions')
  .locator('input').first().uncheck();
await page.screenshot({ path: '/tmp/csv.png', fullPage: true });
```

## Files

- `scripts/serve.sh` — boots backend + frontend, exports `SCREENSHOT_BASE_URL` /
  `SCREENSHOT_PASSWORD`, defines `screenshot_app_stop`. **Must be `source`d.**
- `scripts/screenshot.js` — logs in, screenshots `(route, output)` arg pairs.

## Troubleshooting

- **Login loops / lands back on `/login`:** password mismatch — match
  `SCREENSHOT_PASSWORD` (serve.sh) and the `screenshot.js` password.
- **Blank / error page:** backend not up. Check `/tmp/cj-backend.log` and
  `curl http://127.0.0.1:8083/health`.
- **`browserType.launch: Executable doesn't exist`:** `PLAYWRIGHT_BROWSERS_PATH`
  isn't `/opt/pw-browsers`, or the global playwright version drifted from the
  installed browser build — list `/opt/pw-browsers` and use the playwright whose
  version matches (`cat /opt/node22/lib/node_modules/playwright/package.json`).
- **Ports busy:** `screenshot_app_stop`, or override `BACKEND_PORT` /
  `FRONTEND_PORT` before sourcing (also update `NEXTAUTH_URL` expectations).
