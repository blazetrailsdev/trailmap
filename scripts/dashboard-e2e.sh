#!/usr/bin/env bash
#
# Boots what scripts/dashboard-e2e.ts drives: trailmap, pointed at the ringo
# that script plays, and a headless Chrome. Like any boot, trailmap needs
# HUB_DATABASE_URL naming a migrated hub; the task database is a scratch file.
#
# A PRODUCTION boot, as scripts/smoke-boot.sh's is: the development server
# never answers the `/fleet/socket` upgrade, so the page would draw no rows.
set -euo pipefail

cd "$(dirname "$0")/.."
work="$(mktemp -d)"
ringo="${E2E_RINGO_PORT:-8141}" app="${E2E_APP_PORT:-8142}" cdp="${E2E_CDP_PORT:-9342}"
chrome="${CHROME_BIN:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$chrome" ] || { echo "dashboard-e2e: no Chrome on PATH (set CHROME_BIN)" >&2; exit 1; }

pnpm exec trails-tsc-views build --views app/views
./scripts/build-assets.sh

# Each in a session of its own, so the trap can take the whole process group.
NODE_ENV=production SECRET_KEY_BASE=dashboard-e2e-not-a-secret \
  RINGO_BASE="http://127.0.0.1:$ringo" TASKS_DATABASE="$work/tasks.sqlite3" \
  setsid pnpm exec tsx node_modules/@blazetrails/trailties/bin/trails.js server -b 127.0.0.1 -p "$app" >"$work/server.log" 2>&1 &
server=$!
# `--disable-dev-shm-usage`: a CI runner's /dev/shm is small enough to crash Chrome at start.
setsid "$chrome" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port="$cdp" \
  --user-data-dir="$work/chrome" about:blank >"$work/chrome.log" 2>&1 &
trap 'kill -- "-$server" "-$!" 2>/dev/null || true; wait 2>/dev/null || true; rm -rf "$work" || true' EXIT

E2E_RINGO_PORT="$ringo" E2E_APP="http://127.0.0.1:$app" E2E_CDP="http://127.0.0.1:$cdp" \
  pnpm exec tsx scripts/dashboard-e2e.ts || { tail -20 "$work/server.log" "$work/chrome.log" >&2; exit 1; }
