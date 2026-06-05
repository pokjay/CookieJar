#!/usr/bin/env bash
# Thin wrapper: run screenshot.js under a suitable node. screenshot.js itself
# auto-discovers the Playwright module + pre-installed browser, so no image
# paths are baked in here. Override only if discovery picks the wrong thing:
#   SCREENSHOT_NODE=/path/to/node            (node too old / not on PATH)
#   PLAYWRIGHT_BROWSERS_PATH=/path/to/browsers
#   SCREENSHOT_PLAYWRIGHT=/path/to/node_modules/playwright
#
#   Usage: run.sh <route> <output.png> [<route> <output.png> ...]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
NODE="${SCREENSHOT_NODE:-$(command -v node || true)}"
[ -n "$NODE" ] || NODE="$(command -v nodejs || echo node)"
exec "$NODE" "$HERE/screenshot.js" "$@"
