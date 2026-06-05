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
#    Must be `source`d — it exports SCREENSHOT_* and defines screenshot_app_stop.
source .claude/skills/screenshot-app/scripts/serve.sh

# 2. Log in and screenshot any routes (route + output-path pairs).
#    run.sh + screenshot.js auto-discover node, the Playwright module, and the
#    pre-installed browser — no image paths are hard-coded in the command.
.claude/skills/screenshot-app/scripts/run.sh \
  /manual-transactions /tmp/manual.png  /transactions /tmp/txns.png

# 3. View with the Read tool, send with SendUserFile, then stop the servers.
screenshot_app_stop
```

Then `Read` the PNGs to confirm they rendered, and `SendUserFile` to share them.

## Why this is needed (the gotchas)

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
   with `403 Host not in allowlist`, so a browser already baked into the image
   must be reused. `screenshot.js` **auto-discovers** this instead of hard-coding
   paths (they're image properties and may move):
   - It finds the browsers dir by scanning known locations
     (`PLAYWRIGHT_BROWSERS_PATH`, `/opt/pw-browsers`, `~/.cache/ms-playwright`, …)
     then a bounded `find` for a `chromium-*` build.
   - It picks a Playwright **module whose expected Chromium revision actually
     exists on disk** (the `e2e/node_modules` copy often expects a build the
     sandbox doesn't have — version drift is the usual failure).
   - Override discovery if needed: `PLAYWRIGHT_BROWSERS_PATH=…`,
     `SCREENSHOT_PLAYWRIGHT=/path/to/node_modules/playwright`,
     `SCREENSHOT_NODE=/path/to/node`.
   - On this image today discovery resolves to `/opt/pw-browsers` +
     `/opt/node22/lib/node_modules/playwright` — informational only; don't bake
     these in.

3. **Don't `pkill -f` on a pattern your own shell's command line contains** (e.g.
   `uvicorn backend.main`) — it matches and kills the controlling shell. The stop
   helper greps out `$$`/`$PPID`; keep that if you edit it.

## Auth

next-auth shared-password login. `serve.sh` sets `AUTH_PASSWORD=test` (override
with `SCREENSHOT_PASSWORD=…` before sourcing). `screenshot.js` fills
`[name="password"]`, clicks the **Sign in** button, and waits for `/`. The login
is a client component that runs `signIn()` on submit, so a click before React
hydrates does a native GET and never navigates — the script waits for hydration
and retries, so don't "simplify" that away.

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

- `scripts/serve.sh` — kills stale instances, boots backend + frontend, exports
  `SCREENSHOT_BASE_URL` / `SCREENSHOT_PASSWORD`, defines `screenshot_app_stop`.
  **Must be `source`d.**
- `scripts/run.sh` — thin wrapper that runs `screenshot.js` under a discovered
  node. This is the command to call; pass `(route, output)` pairs.
- `scripts/screenshot.js` — auto-discovers Playwright + browser, logs in, and
  screenshots `(route, output)` arg pairs. Copy to `/tmp` and extend for
  interactive flows (see above).

## Troubleshooting

- **Login loops / lands back on `/login`:** password mismatch — match
  `SCREENSHOT_PASSWORD` (serve.sh) and the `screenshot.js` password.
- **Blank / error page:** backend not up. Check `/tmp/cj-backend.log` and
  `curl http://127.0.0.1:8083/health`.
- **`browserType.launch: Executable doesn't exist`:** discovery picked a
  Playwright module whose Chromium build isn't on disk. `screenshot.js` prints the
  module + browsers dir it chose — find the installed build and the matching
  module and pass them explicitly:
  ```bash
  find / -maxdepth 6 -type d -name 'chromium-*' 2>/dev/null            # browsers
  find / -maxdepth 8 -type d -path '*/node_modules/playwright' 2>/dev/null  # modules
  PLAYWRIGHT_BROWSERS_PATH=<dir> SCREENSHOT_PLAYWRIGHT=<dir> .../run.sh /route /out.png
  ```
- **Ports busy:** `screenshot_app_stop`, or override `BACKEND_PORT` /
  `FRONTEND_PORT` before sourcing (also update `NEXTAUTH_URL` expectations).
