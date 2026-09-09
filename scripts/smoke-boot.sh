#!/usr/bin/env bash
# Cold-start boot smoke test.
#
# Installs a clean checkout from the vendored tarballs, boots the server and
# requests a page. Three of the six framework bugs the boot probe found only
# appear from a cold start — a warm node_modules hides them — so this runs
# against `git archive` output, never the working tree's node_modules.
set -euo pipefail

repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

git -C "$repo" archive HEAD | tar -x -C "$work"

# Every @blazetrails/* dependency must resolve to a vendored tarball. If one
# ever resolves to a registry URL the install stops being deterministic — and
# in CI, where the framework is unpublished, it simply cannot be fetched.
if grep -n "@blazetrails" "$work/pnpm-lock.yaml" | grep -qE "registry|https?://"; then
  echo "smoke-boot: a @blazetrails dependency resolves to a registry" >&2
  grep -n "@blazetrails" "$work/pnpm-lock.yaml" | grep -E "registry|https?://" >&2
  exit 1
fi

cd "$work"
pnpm install --frozen-lockfile
pnpm exec trails-tsc-views build --views app/views

# A DATABASE, because the deployment has one and a boot without one is not the
# boot being smoke-tested. Until `config/initializers/tasks-database.ts` began
# refusing it, a database-less process came up, answered `/up` green and 500ed
# with `ConnectionNotDefined` on every page that reads a row — which is exactly
# what the deployed app did, unnoticed, because this probe asked for `/up` and
# `/` and neither reads a row.
#
# The rows are not the point here (the gate job is what runs against real
# content), so this is the schema and nothing else: trailmap owns the tasks
# migrations under db/migrate, so `db create` + `db migrate` produce a valid,
# empty tasks database to point TASKS_DATABASE at.
trails="node_modules/@blazetrails/trailties/bin/trails.js"
pnpm exec tsx "$trails" db create
pnpm exec tsx "$trails" db migrate
export TASKS_DATABASE="$work/storage/development.sqlite3"
export TASKS_DIR="$work"

port=8123
pnpm exec tsx "$trails" server -b 127.0.0.1 -p "$port" &
server=$!
# Wait for the server to actually exit before removing its tree. The Vite dev
# server writes into node_modules/.vite as it shuts down, so a `kill` followed
# straight by `rm -rf` loses the race and the script dies on "Directory not
# empty" AFTER every check has already passed — a green smoke test reported as
# a red job.
trap 'kill "$server" 2>/dev/null || true; wait "$server" 2>/dev/null || true; rm -rf "$work"' EXIT

for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/up" >/dev/null 2>&1; then
    break
  fi
  sleep 1
done

echo "smoke-boot: GET /up"
curl -fsS "http://127.0.0.1:$port/up" | grep -q '"status":"ok"'

echo "smoke-boot: GET /"
curl -fsS "http://127.0.0.1:$port/" | grep -qi "<html"

# A page that READS A ROW. `/up` and `/` touch no model, so neither notices a
# process with no database connection — the shape that served the deployed
# 500s. This one selects, and an empty list is a rendered page like any other.
echo "smoke-boot: GET /rfcs"
curl -fsS "http://127.0.0.1:$port/rfcs" | grep -qi "<html"

# THE INVERSE, and the regression for the deployed 500 (#20). The application
# must REFUSE to boot when no database is configured, rather than come up and
# 500 on the first page that reads a row.
#
# This is a process-level boot, not a call to the exported function: it runs
# `config/environment.ts`, so `Trails.initialize()` runs the
# `load_config_initializers` initializer (Rails' `engine.rb:644-648`) and
# imports `config/initializers/*` in sorted order. A unit test that imports
# the module has already run it, and would keep passing if the initializer
# stopped being LOADED at boot — which is the failure this asserts against.
#
# On the pre-fix initializer this step passes the boot and fails here, which is
# what makes it a regression rather than a restatement.
echo "smoke-boot: a boot with no TASKS_DATABASE must refuse"
if env -u TASKS_DATABASE -u TASKS_DIR pnpm exec tsx scripts/boot-probe.ts \
     > "$work/no-database-boot.log" 2>&1; then
  echo "smoke-boot: the application booted with no database configured" >&2
  echo "  It would answer /up green and 500 on every page that reads a row." >&2
  exit 1
fi
if ! grep -q "TASKS_DATABASE is not set" "$work/no-database-boot.log"; then
  echo "smoke-boot: the boot failed, but not for the missing database:" >&2
  tail -20 "$work/no-database-boot.log" >&2
  exit 1
fi

# And the positive half through the same path, so the probe is proven to be
# capable of booting at all — an always-failing probe would pass the check
# above for the wrong reason.
echo "smoke-boot: a boot WITH a database must succeed"
pnpm exec tsx scripts/boot-probe.ts | grep -q "boot-probe: booted"

echo "smoke-boot: ok"
