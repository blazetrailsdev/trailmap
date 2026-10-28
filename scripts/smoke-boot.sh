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
# empty tasks database to point TASKS_DATABASE at. They run in the TEST
# environment, whose primary is a plain scratch database: the served
# environments will name `env.TASKS_DATABASE` with `databaseTasks: false`, and
# `db migrate` skips such a database by design, so a recipe that relied on
# them would build nothing.
#
# `db migrate` with no `--database` migrates BOTH of the environment's
# databases (config/database.ts): the SQLite primary below, and the `hub`
# Postgres one when HUB_DATABASE_URL is set, which it is in CI because
# `config/initializers/hub-database.ts` refuses to boot without it. That is
# also why there is no `--database` flag here — see the note on the CI step
# that prepares the hub schema.
trails="bin/trails"
NODE_ENV=test "$trails" db create
NODE_ENV=test "$trails" db migrate
export TASKS_DATABASE="$work/storage/test.sqlite3"
export TASKS_DIR="$work"

# PRODUCTION, laid out as the image is. The Dockerfile sets NODE_ENV=production
# and the framework honours it, so a boot in the default environment tests a
# server the deployment never runs: development mounts Vite, which serves
# `app/assets` off disk and needs no secret. Two deploys failed behind a green
# run of this script for exactly that reason — a container that hung on every
# request for want of `secret_key_base`, then pages with no stylesheet.
./scripts/build-assets.sh
export NODE_ENV=production
export SECRET_KEY_BASE=smoke-boot-not-a-secret

port=8123
"$trails" server -b 127.0.0.1 -p "$port" &
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
curl -fsS -o /dev/null "http://127.0.0.1:$port/up"

echo "smoke-boot: GET /"
curl -fsS "http://127.0.0.1:$port/" | grep -qi "<html"

# A page that READS A ROW. `/up` and `/` touch no model, so neither notices a
# process with no database connection — the shape that served the deployed
# 500s. This one selects, and an empty list is a rendered page like any other.
echo "smoke-boot: GET /rfcs"
curl -fsS "http://127.0.0.1:$port/rfcs" > "$work/rfcs.html"
grep -qi "<html" "$work/rfcs.html"

# Every asset the page asks for, fetched. A page whose stylesheet 404s still
# answers 200 with a body full of HTML, which is how the unstyled site passed.
echo "smoke-boot: the assets /rfcs links"
assets="$({ grep -oE '(href|src)="/assets/[^"]+"' "$work/rfcs.html" || true; } | cut -d'"' -f2 | sort -u)"
if [ -z "$assets" ]; then
  echo "smoke-boot: /rfcs links no asset, so this check is testing nothing" >&2
  exit 1
fi
for asset in $assets; do
  echo "smoke-boot: GET $asset"
  curl -fsS -o /dev/null "http://127.0.0.1:$port$asset"
done

# The links are digest-stamped, and only that makes the year-long cache header
# production sends safe: a deploy's changed file must arrive under a new name.
echo "smoke-boot: the linked assets are digested and cached"
for asset in $assets; do
  if ! [[ "$asset" =~ -[A-Za-z0-9_-]{8}\.(css|js)$ ]]; then
    echo "smoke-boot: $asset is linked under an undigested name" >&2
    exit 1
  fi
  if ! curl -fsS -D - -o /dev/null "http://127.0.0.1:$port$asset" | grep -qi '^cache-control: public, max-age=31556952'; then
    echo "smoke-boot: $asset is served without the long cache header" >&2
    exit 1
  fi
done

# EVERY built asset, byte for byte. A 200 is not the file: the framework once
# served any static file holding a non-ASCII byte re-encoded and cut off at the
# original length, and the fleet page's script answered 200 for days while
# failing to parse. Fixed in trails#8634 and vendored. Every file, not only the
# linked ones: `fleet-format.js` is reached by an `import` inside
# `dashboard.js`, which no page links.
#
# The assets hold non-ASCII characters on purpose (the pane dots, an em dash,
# the worker emoji), so this is a test of the framework and not of the files:
# were they pure ASCII it would pass over the bug it exists to catch. The
# check below fails if that ever becomes true again.
echo "smoke-boot: every built asset arrives intact"
checked=0
while IFS= read -r file; do
  asset="/assets/${file#public/assets/}"
  curl -fsS -o "$work/served-asset" "http://127.0.0.1:$port$asset"
  if ! cmp -s "$file" "$work/served-asset"; then
    echo "smoke-boot: $asset was not served as built:" >&2
    echo "  $(wc -c < "$file") bytes on disk, $(wc -c < "$work/served-asset") served" >&2
    cmp "$file" "$work/served-asset" >&2 || true
    exit 1
  fi
  checked=$((checked + 1))
done < <(find public/assets -type f ! -name '.gitkeep' ! -path '*/.vite/*' | sort)
if [ "$checked" -eq 0 ]; then
  echo "smoke-boot: no built asset to check, so this check is testing nothing" >&2
  exit 1
fi
if ! LC_ALL=C grep -rq $'[\x80-\xff]' public/assets; then
  echo "smoke-boot: no built asset holds a non-ASCII byte, so a server that" >&2
  echo "  corrupts them would pass the comparison above" >&2
  exit 1
fi
echo "smoke-boot: $checked assets intact"

# THE INVERSE, and the regression for the deployed 500 (#20). The application
# must REFUSE to boot when no database is configured, rather than come up and
# 500 on the first page that reads a row.
#
# This is a process-level boot, not a call to the exported function: it runs
# `config.ts`, so `Trails.initialize()` imports `config/initializers/*` in
# sorted order (Rails' `engine.rb:644-648`) and `loadServer()` then runs the
# `server` blocks they registered (trails#9375). A unit test that calls the
# function directly would keep passing if the initializer stopped being LOADED
# at boot, or stopped registering the check — the failures this asserts
# against.
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
# Two messages say the same thing: the initializer's own, and the one the
# framework's `active_record.initialize_database` raises first once the served
# environments name `env.TASKS_DATABASE`.
if ! grep -qE "TASKS_DATABASE is not set|No database file specified" "$work/no-database-boot.log"; then
  echo "smoke-boot: the boot failed, but not for the missing database:" >&2
  tail -20 "$work/no-database-boot.log" >&2
  exit 1
fi

# FORGERY PROTECTION on the fleet page's controls. `/fleet/control/*` forwards
# to ringo, which can merge pull requests, with nothing but the viewer's
# session to say who is asking. What stops another site posting to it is the
# framework's forgery protection, switched on at boot by the 8.0 defaults
# (`config/application.ts`). That switch is not something a controller test can
# see, so it is asserted here, on the boot the deployment runs.
#
# No ringo is configured in this boot, so a request that gets PAST the
# protection is answered 503 by the action itself; one that does not is a 422.
echo "smoke-boot: a control POST without the page's token must be refused"
jar="$work/cookies"
curl -fsS -c "$jar" "http://127.0.0.1:$port/dashboard" > "$work/dashboard.html"
token="$({ grep -oE '<meta name="csrf-token" content="[^"]+"' "$work/dashboard.html" || true; } | cut -d'"' -f4)"
if [ -z "$token" ]; then
  echo "smoke-boot: /dashboard carries no CSRF token for its controls" >&2
  exit 1
fi
control() {
  curl -s -o /dev/null -w '%{http_code}' -b "$jar" -X POST \
    -H 'Content-Type: application/json' -d '{}' "$@" \
    "http://127.0.0.1:$port/fleet/control/merge-pr"
}
expect_status() {
  if [ "$2" != "$3" ]; then
    echo "smoke-boot: $1: expected $2, got $3" >&2
    exit 1
  fi
}
expect_status "a control POST with no token" 422 "$(control)"
expect_status "a control POST with the token from another origin" 422 \
  "$(control -H "X-CSRF-Token: $token" -H 'Origin: https://evil.example')"
expect_status "a control POST with the token from this origin" 503 \
  "$(control -H "X-CSRF-Token: $token" -H "Origin: http://127.0.0.1:$port")"

# THE SOCKET'S ORIGIN CHECK, as the deployment sees it. `/fleet/socket` refuses
# a handshake whose `Origin` is not this site's base URL. Behind nginx the
# request arrives as plain HTTP for the public HTTPS hostname, so that
# comparison is only right if the framework builds the base URL from `Host`
# and `X-Forwarded-Proto`. If it did not, every real handshake would be a 404
# and the page would sit empty with nothing to say why.
#
# No ringo is configured here, so a handshake that PASSES the check is answered
# 503 by the next line of the action; one that fails it is a 404.
echo "smoke-boot: the socket accepts its own origin behind a TLS proxy, and no other"
socket_status() {
  curl -s -o /dev/null -w '%{http_code}' \
    -H 'Host: trailmap.example' -H 'X-Forwarded-Proto: https' "$@" \
    "http://127.0.0.1:$port/fleet/socket"
}
expect_status "a handshake from the site's own https origin" 503 \
  "$(socket_status -H 'Origin: https://trailmap.example')"
expect_status "a handshake from another origin" 404 \
  "$(socket_status -H 'Origin: https://evil.example')"
expect_status "a handshake naming the http form of the origin" 404 \
  "$(socket_status -H 'Origin: http://trailmap.example')"
expect_status "a handshake with no origin" 404 "$(socket_status)"

# THE PANE PAGE and the relay it polls. A production boot that 500s on either
# would otherwise pass: nothing above asks for them.
echo "smoke-boot: /panes/<n> renders, and refuses what is not a pane number"
page_status() {
  curl -s -o "$work/page.html" -w '%{http_code}' "http://127.0.0.1:$port$1"
}
expect_status "/panes/42" 200 "$(page_status /panes/42)"
if ! grep -q 'data-screen-path="/fleet/pane/42/screen"' "$work/page.html"; then
  echo "smoke-boot: /panes/42 does not name its screen relay" >&2
  exit 1
fi
expect_status "/panes/4x" 404 "$(page_status /panes/4x)"
expect_status "/fleet/pane/4x/screen" 400 "$(page_status /fleet/pane/4x/screen)"

# ONE JSON ENDPOINT: the API ringo and the CLI read, over the migrated database.
echo "smoke-boot: GET /stories.json"
expect_status "/stories.json" 200 "$(page_status /stories.json)"
if ! node -e 'if (!Array.isArray(JSON.parse(require("fs").readFileSync(0, "utf8")))) throw 0' < "$work/page.html"; then
  echo "smoke-boot: /stories.json is not a JSON array" >&2
  exit 1
fi

# THE SECRET. A production process with no `secret_key_base` must never look
# healthy, because a healthy answer is what lets dokku swap it in.
#
# Nothing in this application enforces that, on purpose. The framework reads
# the secret while building each request and raises; what the server does with
# that raise is the framework's to get right (today `Handler.Node` answers
# nothing at all — trails story
# `node-handler-leaves-the-request-open-when-the-app-raises` — where Rails'
# servers answer 500). Either is unhealthy, so this asserts the outcome and
# not the mechanism: it passes on the hang and will pass on the 500.
echo "smoke-boot: a production server with no SECRET_KEY_BASE must not answer /up"
nosecret_port=8124
env -u SECRET_KEY_BASE -u SECRET_KEY_BASE_DUMMY \
  "$trails" server -b 127.0.0.1 -p "$nosecret_port" > "$work/no-secret.log" 2>&1 &
nosecret=$!
trap 'kill "$server" "$nosecret" 2>/dev/null || true; wait "$server" "$nosecret" 2>/dev/null || true; rm -rf "$work"' EXIT
# A process that has EXITED is not a server that failed to answer. It is
# acceptable only if it says the secret is why (a framework that refuses the
# boot outright is as unhealthy as one that hangs); a crash for any other
# reason — an import error, the port in use — would otherwise pass the `curl`
# below for the wrong reason.
nosecret_died() {
  if grep -q "secret_key_base" "$work/no-secret.log"; then
    echo "smoke-boot: it refused to start, naming the secret"
    return 0
  fi
  echo "smoke-boot: the server with no secret died, and not for the secret:" >&2
  tail -20 "$work/no-secret.log" >&2
  exit 1
}

# Wait until it is LISTENING, which the server says itself once the socket is
# bound ("=> Trails application starting ..."). Its own word, not a probe of
# the port: something else answering on the port would satisfy a probe, and
# this server would be dead of EADDRINUSE behind it. So "did not answer" below
# means the request reached THIS server and went unanswered or was refused.
listening=""
for _ in $(seq 1 60); do
  if grep -q "Trails application starting" "$work/no-secret.log"; then listening=1; break; fi
  if ! kill -0 "$nosecret" 2>/dev/null; then nosecret_died; listening=refused; break; fi
  sleep 1
done
if [ -z "$listening" ]; then
  echo "smoke-boot: the server with no secret never started listening:" >&2
  tail -20 "$work/no-secret.log" >&2
  exit 1
fi
if [ "$listening" != refused ] && curl -fsS -o /dev/null -m 5 "http://127.0.0.1:$nosecret_port/up"; then
  echo "smoke-boot: production answered /up green with no secret_key_base" >&2
  echo "  dokku would deploy it, and every signed cookie would be unverifiable." >&2
  exit 1
fi
# It did not answer green. If answering KILLED it, that has to be for the
# secret too: a crash on the first request for another reason is no evidence
# about the secret.
if [ "$listening" != refused ] && ! kill -0 "$nosecret" 2>/dev/null; then nosecret_died; fi
kill "$nosecret" 2>/dev/null || true

# And the positive half through the same path, so the probe is proven to be
# capable of booting at all — an always-failing probe would pass the check
# above for the wrong reason.
echo "smoke-boot: a boot WITH a database must succeed"
pnpm exec tsx scripts/boot-probe.ts | grep -q "boot-probe: booted"

echo "smoke-boot: ok"
