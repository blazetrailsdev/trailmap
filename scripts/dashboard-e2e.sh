#!/usr/bin/env bash
#
# Boots what scripts/dashboard-e2e.ts drives: trailmap, pointed at the ringo
# that script plays, and a headless Chrome. Like any boot, trailmap needs
# a hub Postgres; the task database is a scratch file. CI names its service in
# HUB_DATABASE_URL. Left unset, as on a laptop, this starts a Postgres of its
# own in Docker, on a port Docker picks, migrates it, and removes it on exit:
# it never borrows whatever Postgres happens to be listening.
#
# A PRODUCTION boot, as scripts/smoke-boot.sh's is: the development server
# never answers the `/fleet/socket` upgrade, so the page would draw no rows.
set -euo pipefail

cd "$(dirname "$0")/.."
work="$(mktemp -d)"
ringo="${E2E_RINGO_PORT:-8141}" app="${E2E_APP_PORT:-8142}" cdp="${E2E_CDP_PORT:-9342}"
chrome="${CHROME_BIN:-$(command -v google-chrome || command -v chromium || command -v chromium-browser || true)}"
[ -n "$chrome" ] || { echo "dashboard-e2e: no Chrome on PATH (set CHROME_BIN)" >&2; exit 1; }

hubContainer=""
if [ -z "${HUB_DATABASE_URL:-}" ]; then
  command -v docker >/dev/null || {
    echo "dashboard-e2e: HUB_DATABASE_URL is unset and there is no docker to start a throwaway hub Postgres; set HUB_DATABASE_URL to a hub database you can migrate" >&2
    exit 1
  }
  hubContainer="$(docker run -d --rm -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=trailmap_hub -p 127.0.0.1::5432 postgres:16)"
  trap 'docker rm -f "$hubContainer" >/dev/null 2>&1 || true' EXIT
  # Each wait gives up after 60s: a container that exits is removed (--rm), and
  # every later `docker exec` fails, which would otherwise spin forever.
  hubWait() {
    for _ in $(seq 120); do "$@" >/dev/null 2>&1 && return 0; sleep 0.5; done
    echo "dashboard-e2e: the throwaway hub Postgres never came up" >&2
    docker logs "$hubContainer" 2>&1 | tail -n 20 >&2 || true
    exit 1
  }
  hubWait docker exec "$hubContainer" pg_isready -q -U postgres
  # pg_isready answers before the init scripts' restart; a query proves the server is up for good.
  hubWait docker exec "$hubContainer" psql -U postgres -d trailmap_hub -qc "select 1"
  export HUB_DATABASE_URL="postgres://postgres:e2e@$(docker port "$hubContainer" 5432/tcp | head -n 1)/trailmap_hub"
  NODE_ENV=test TASKS_DATABASE="$work/migrate.db" pnpm db:migrate >/dev/null
fi

# The views build boots the app, and sqlite3 refuses to start with no file.
TASKS_DATABASE="${TASKS_DATABASE:-$work/views-build.db}" pnpm exec trails-tsc-views build --views app/views
# public/vite is what this run builds, and a build left behind makes the
# layout link digested names, which the controller tests do not expect. So the
# trap removes it again, unless it was already there before the run.
hadAssets=0
[ -e public/vite ] && hadAssets=1
./scripts/build-assets.sh

# Each in a session of its own, so the trap can take the whole process group:
# pnpm, tsx and node under the server, Chrome's renderers under the browser.
# TERM first, then KILL whatever is left, so nothing this starts outlives the
# step, on success or failure; a straggler holding the job's output open once
# kept the job "in progress" for 25 minutes after the script had passed.
pids=()
cleanup() {
  for pid in "${pids[@]}"; do kill -TERM -- "-$pid" 2>/dev/null || true; done
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    alive=0
    for pid in "${pids[@]}"; do kill -0 -- "-$pid" 2>/dev/null && alive=1; done
    [ "$alive" = 0 ] && break
    sleep 0.5
  done
  for pid in "${pids[@]}"; do kill -KILL -- "-$pid" 2>/dev/null || true; done
  wait 2>/dev/null || true
  rm -rf "$work" || true
  [ -z "$hubContainer" ] || docker rm -f "$hubContainer" >/dev/null 2>&1 || true
  [ "$hadAssets" = 1 ] || rm -rf public/vite || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM

NODE_ENV=production SECRET_KEY_BASE=dashboard-e2e-not-a-secret \
  RINGO_BASE="http://127.0.0.1:$ringo" FLEET_REPO_PATHS="o/r=/w/r" TASKS_DATABASE="$work/tasks.sqlite3" \
  setsid bin/trails server -b 127.0.0.1 -p "$app" >"$work/server.log" 2>&1 &
pids+=($!)
# `--disable-dev-shm-usage`: a CI runner's /dev/shm is small enough to crash Chrome at start.
setsid "$chrome" --headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage --remote-debugging-port="$cdp" \
  --user-data-dir="$work/chrome" about:blank >"$work/chrome.log" 2>&1 &
pids+=($!)

E2E_RINGO_PORT="$ringo" E2E_APP="http://127.0.0.1:$app" E2E_CDP="http://127.0.0.1:$cdp" \
  pnpm exec tsx scripts/dashboard-e2e.ts || { tail -n 20 "$work/server.log" "$work/chrome.log" >&2; exit 1; }
