#!/usr/bin/env bash
# Boot the CookieJar stack WITHOUT Docker (no daemon in the sandbox) so it can be
# screenshotted. Starts FastAPI (mock data) on :8083 and Next.js dev on :3000.
#
#   Usage:  source .claude/skills/screenshot-app/scripts/serve.sh   # exports vars, starts servers
#   Stop:   screenshot_app_stop
#
# Leaves API_SECRET unset so the backend's X-API-Secret middleware is a no-op and
# the frontend proxy doesn't need to send the header.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/../../../.." && pwd)"
BACKEND_PORT="${BACKEND_PORT:-8083}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
export SCREENSHOT_PASSWORD="${SCREENSHOT_PASSWORD:-test}"
export SCREENSHOT_BASE_URL="http://localhost:${FRONTEND_PORT}"

screenshot_app_stop() {
  # IMPORTANT: a naive `pkill -f "uvicorn backend.main"` also matches the shell
  # running this script (its command line contains that string) and kills it.
  # Match the actual child processes and exclude this shell ($$) and its parent.
  local pat
  for pat in "uvicorn backend.main:app" "frontend/node_modules/.bin/next" "next-server"; do
    pgrep -f "$pat" 2>/dev/null | grep -vx "$$" | grep -vx "${PPID:-0}" | xargs -r kill 2>/dev/null || true
  done
  echo "stopped backend + frontend"
}

# Kill any stale instances first so the frontend binds :3000 instead of falling
# back to :3001 (which would break the NEXTAUTH_URL the cookie is scoped to).
screenshot_app_stop >/dev/null 2>&1 || true
sleep 1

echo "→ backend (FastAPI, mock data) on :${BACKEND_PORT}"
( cd "$REPO_ROOT" && USE_MOCK_DATA=true uv run uvicorn backend.main:app \
    --host 127.0.0.1 --port "$BACKEND_PORT" >/tmp/cj-backend.log 2>&1 & )

# Next dev needs node_modules. Lockfile is out of sync in CI (missing next-themes),
# so use a plain install that won't fail on the lock mismatch.
if [ ! -d "$REPO_ROOT/frontend/node_modules/next" ]; then
  echo "→ installing frontend deps (npm install --no-save)"
  ( cd "$REPO_ROOT/frontend" && npm install --no-save --no-audit --no-fund >/tmp/cj-npm.log 2>&1 )
fi

echo "→ frontend (Next.js dev) on :${FRONTEND_PORT}"
( cd "$REPO_ROOT/frontend" && \
    BACKEND_URL="http://127.0.0.1:${BACKEND_PORT}" \
    NEXTAUTH_SECRET="screenshot-secret-please-ignore" \
    AUTH_PASSWORD="$SCREENSHOT_PASSWORD" \
    NEXTAUTH_URL="$SCREENSHOT_BASE_URL" \
    nohup npm run dev >/tmp/cj-frontend.log 2>&1 & )

echo -n "→ waiting for app"
for _ in $(seq 1 60); do
  if curl -sf "http://127.0.0.1:${BACKEND_PORT}/health" >/dev/null 2>&1 \
     && curl -sf -o /dev/null "$SCREENSHOT_BASE_URL/login" 2>/dev/null; then
    echo " ✓ ready at $SCREENSHOT_BASE_URL  (password: $SCREENSHOT_PASSWORD)"
    return 0 2>/dev/null || exit 0
  fi
  echo -n "."; sleep 1
done
echo " ✗ timed out — see /tmp/cj-backend.log and /tmp/cj-frontend.log"
return 1 2>/dev/null || exit 1
