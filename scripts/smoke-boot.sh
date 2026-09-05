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

port=8123
pnpm exec tsx node_modules/@blazetrails/trailties/bin/trails.js server \
  -b 127.0.0.1 -p "$port" &
server=$!
trap 'kill "$server" 2>/dev/null || true; rm -rf "$work"' EXIT

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

echo "smoke-boot: ok"
