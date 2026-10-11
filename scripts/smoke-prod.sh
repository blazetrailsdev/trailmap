#!/usr/bin/env bash
# The production smoke suite: the assertions that can only be made against the
# running application, on the box, as tiers (RFC 0143).
#
#   scripts/smoke-prod.sh --tier N [--tier M ...]
#   scripts/smoke-prod.sh --self-test
#
#   0  liveness    /up on loopback
#   1  readiness   /up/ready, the migration head, the loopback API, the public vhost
#   2  read smoke  every read verb and page, by shape rather than by status
#
# Tiers 3 through 5 are later stories. `scripts/deploy.sh` gates on 0 and 1.
#
# Every assertion prints one tab-separated line on stdout:
#
#   PASS|FAIL <TAB> <name> <TAB> <detail>
#
# The NAME is the stable key (`tier1.public-vhost-redirects`): the results table
# will be keyed on it, so the detail can be reworded freely and a name is never
# renamed or reused. The prose a person needs to act on a failure goes to
# stderr.
#
# A tier runs ALL of its assertions and exits non-zero if any failed, rather
# than stopping at the first: a scheduled run wants a row per assertion, and
# two things broken at once are both worth knowing about.
#
# It cannot run in CI — the API binds to loopback — so `--self-test` is what CI
# runs: it puts a canned `curl` on PATH, and proves that each tier passes
# against a healthy application and that each regression fails BY NAME.
set -uo pipefail

APP="${TRAILMAP_APP:-trailmap}"
LOOPBACK="${TRAILMAP_LOOPBACK:-http://127.0.0.1:8080}"
PUBLIC_ORIGIN="${TRAILMAP_PUBLIC_ORIGIN:-http://127.0.0.1}"
HOSTNAME_PUBLIC="${TRAILMAP_HOSTNAME:-trailmap.deanoftech.com}"
TIMEOUT="${TRAILMAP_SMOKE_TIMEOUT:-30}"

failed=0
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

pass() { printf 'PASS\t%s\t%s\n' "$1" "$2"; }

# fail <name> <detail> [<what to do about it>]
fail() {
  printf 'FAIL\t%s\t%s\n' "$1" "$2"
  echo "SMOKE FAILED [$1]: ${3:-$2}" >&2
  failed=1
}

# fetch <url> [<Host header>] — the body lands in $work/body, and $status and
# $contentType are set. A request that never connected reads as status 000.
fetch() {
  local out
  # Cleared first: a request that never connected writes no body, and the last
  # request's body must not be read as this one's.
  rm -f "$work/body"
  out=$(curl -s -m "$TIMEOUT" -o "$work/body" -w '%{http_code} %{content_type}' \
    ${2:+-H "Host: $2"} "$1") || true
  status="${out%% *}"
  contentType="${out#* }"
  [ -n "$status" ] || status=000
}

# json <name> <path> <jq filter> — 200, and a body the filter answers `true` for.
json() {
  fetch "$LOOPBACK$2"
  if [ "$status" != "200" ]; then
    fail "$1" "$2 answered $status, not 200"
  elif [ "$(jq -r "$3" "$work/body" 2>/dev/null)" != "true" ]; then
    fail "$1" "$2 answered 200 without the expected shape" \
      "$2 answered 200, but its body does not satisfy: $3"
  else
    pass "$1" "$2 200"
  fi
}

# page <name> <path> <heading> [<id>] — 200, HTML, inside the layout, with its
# heading. A show page's heading is its title, which this cannot know, so it
# is recognised by the id it was asked for appearing in the body instead.
page() {
  fetch "$LOOPBACK$2"
  if [ "$status" != "200" ]; then
    fail "$1" "$2 answered $status, not 200"
  elif [[ "$contentType" != text/html* ]]; then
    fail "$1" "$2 answered ${contentType:-no content type}, not text/html"
  elif ! grep -q '<main class="site-main">' "$work/body"; then
    fail "$1" "$2 rendered outside the layout"
  elif ! grep -Eq "<h1[^>]*>$3" "$work/body"; then
    fail "$1" "$2 rendered without its heading" "$2 has no <h1> starting \"$3\""
  elif [ -n "${4:-}" ] && ! grep -Fq "$4" "$work/body"; then
    fail "$1" "$2 rendered without naming $4"
  else
    pass "$1" "$2 200"
  fi
}

tier0() {
  fetch "$LOOPBACK/up"
  if [ "$status" = "200" ]; then
    pass tier0.up-loopback "/up 200"
  else
    fail tier0.up-loopback "/up answered $status, not 200" \
      "the loopback listener answered $status for /up, not 200. The app is
  not reachable on ${LOOPBACK#http://} at all; see the loopback block in
  nginx.conf.sigil."
  fi
}

tier1() {
  # deploy.sh gates on this tier and needed no jq before it did. Only the
  # migration head needs it, so a host without one fails that by name and
  # still runs the four assertions that are a status code — a scheduled run
  # reports the same five rows either way.
  local hasJq=1
  command -v jq >/dev/null || { hasJq=0; fail tier1.jq-installed "jq is not on PATH"; }
  # One request, two assertions: the migration head is the check /up/ready
  # exists for (RFC 0143), so it has a row of its own rather than being one
  # name in a list of failing checks.
  fetch "$LOOPBACK/up/ready"
  if [ "$status" = "200" ]; then
    pass tier1.up-ready "/up/ready 200"
  else
    fail tier1.up-ready "/up/ready answered $status, not 200" \
      "/up/ready answered $status. Failing checks: $(jq -c '.failing' "$work/body" 2>/dev/null || echo unreadable). $(cat "$work/body" 2>/dev/null)"
  fi
  if [ "$hasJq" = 0 ]; then
    fail tier1.migration-head "not read: jq is not on PATH"
  elif [ "$(jq -r '.checks.migrations.ok' "$work/body" 2>/dev/null)" = "true" ]; then
    pass tier1.migration-head "schema_migrations at $(jq -r '.checks.migrations.actual' "$work/body")"
  else
    fail tier1.migration-head \
      "$(jq -r '.checks.migrations.error // "/up/ready reported no migrations check"' "$work/body" 2>/dev/null || echo "/up/ready answered no JSON")"
  fi

  # /up is UNGUARDED, so a 200 there says nothing about the thing that has
  # actually broken twice: nginx setting X-Forwarded-* in front of the loopback
  # block, which `requireLoopback` treats as disqualifying and answers 404 to.
  # Only a guarded endpoint can prove that, so one is asked for by name.
  fetch "$LOOPBACK/stories/ready"
  if [ "$status" = "000" ]; then
    # Nothing answered, so nothing was shown about the guard either way. A
    # PASS here would be a row saying the API was not refused.
    fail tier1.loopback-api-not-refused "/stories/ready did not answer"
  elif [ "$status" = "404" ]; then
    fail tier1.loopback-api-not-refused "/stories/ready answered 404" \
      "the loopback API answered 404 for /stories/ready. That is
  requireLoopback refusing the request because it arrived carrying proxy
  provenance — nginx is setting X-Forwarded-For or X-Forwarded-Proto in front
  of the loopback \`server\` block; see nginx.conf.sigil."
  else
    pass tier1.loopback-api-not-refused "/stories/ready $status"
  fi
  if [ "$status" = "200" ]; then
    pass tier1.loopback-api-serving "/stories/ready 200"
  else
    fail tier1.loopback-api-serving "/stories/ready answered $status, not 200" \
      "/stories/ready answered $status, not 200. It is past
  requireLoopback — a 404 would mean it was not — but the endpoint is not
  serving. A 500 is the release without its database: check
  \`dokku storage:report $APP\` for the tasks checkout mount and
  \`dokku config:show $APP\` for TASKS_DATABASE and TASKS_DIR; see
  docs/deploy.md."
  fi

  fetch "$PUBLIC_ORIGIN/" "$HOSTNAME_PUBLIC"
  case "$status" in
    30*) pass tier1.public-vhost-redirects "$HOSTNAME_PUBLIC $status" ;;
    000) fail tier1.public-vhost-redirects "$HOSTNAME_PUBLIC did not answer" \
      "nothing answered for $HOSTNAME_PUBLIC on ${PUBLIC_ORIGIN#http://}. That is nginx
  down or not listening, and says nothing about SSO either way." ;;
    *) fail tier1.public-vhost-redirects "$HOSTNAME_PUBLIC answered $status, not 30*" \
      "the public hostname answered $status instead of redirecting to
  auth — the dashboard is being served without SSO. Re-apply with
  \`dokku sso:protect $APP\` and find out why the injection did not run." ;;
  esac
}

# The shapes are the ones the readers depend on: the CLI prints `show` as a
# bare object and every list verb as an array, ringo unmarshals `/index` and
# `/events` whole. A story is recognised by the keys the ranking and the CLI
# both read, not by all nineteen — adding a field must not turn this red.
tier2() {
  command -v jq >/dev/null || { fail tier2.jq-installed "jq is not on PATH"; return; }
  local story='(has("id") and has("rfc") and has("status") and has("raw_status") and has("deps"))'
  local stories="(type == \"array\" and all(.[]; $story))"

  json tier2.stories "/stories" "$stories and length > 0"
  local id; id="$(jq -r '.[0].id // empty' "$work/body" 2>/dev/null)"
  json tier2.stories-ready "/stories/ready" "$stories"
  json tier2.stories-next-bundle "/stories/next-bundle" \
    "(.stories | $stories) and has(\"bundle_total_loc\") and has(\"max_loc\")"
  json tier2.stories-touching "/stories/touching?path=packages" "$stories"
  json tier2.index "/index" \
    '(.rfcs | type == "array" and length > 0 and all(.[]; has("id") and has("status"))) and (.stories | type == "array" and length > 0)'
  local rfc; rfc="$(jq -r '.rfcs[0].id // empty' "$work/body" 2>/dev/null)"
  json tier2.events "/events" \
    '.events | type == "array" and all(.[]; has("at") and has("verb") and has("story"))'
  # 200 with an `error` key is this endpoint's answer for an unset STATS_DB,
  # which is a supported deployment — either shape, but one of the two.
  json tier2.graphs-parity-data "/graphs/parity/data" 'type == "object" and length > 0'

  if [ -n "$id" ]; then
    json tier2.stories-show "/stories/$id" "$story and .id == \"$id\""
    page tier2.page-story "/story/$id" "" "$id"
  else
    fail tier2.stories-show "no story id to ask for: /stories named none"
    fail tier2.page-story "no story id to ask for: /stories named none"
  fi
  if [ -n "$rfc" ]; then
    page tier2.page-rfc "/rfc/$rfc" "" "$rfc"
  else
    fail tier2.page-rfc "no rfc id to ask for: /index named none"
  fi

  page tier2.page-home "/" "trailmap"
  page tier2.page-dashboard "/dashboard" "Fleet"
  page tier2.page-rfcs "/rfcs" "RFCs"
  page tier2.page-backlog "/backlog" "Backlog"
  page tier2.page-graphs-parity "/graphs/parity" "Parity over time"
}

# ── self-test ──────────────────────────────────────────────────────────────
#
# A canned `curl` goes first on PATH and this script is run again AS A CHILD,
# so what is exercised is the real argument parsing, the real exit status and
# the real output — not functions called from inside a harness.

# expect <label> <tier> <want exit> <name that must FAIL, or "">
expect() {
  local out status=0
  out="$(PATH="$fake/bin:${basePath:-$PATH}" SMOKE_FAKE="$fake" "$0" --tier "$2" 2>/dev/null)" || status=$?
  local failing; failing="$(printf '%s\n' "$out" | awk -F'\t' '$1 == "FAIL" { print $2 }' | paste -sd, -)"
  if [ "$status" != "$3" ] || [ "$failing" != "$4" ]; then
    echo "self-test FAILED: $1 — exit $status (want $3), failing [$failing] (want [$4])" >&2
    selfFailed=1
  else
    echo "self-test ok: $1"
  fi
}

# can <key> <status> <content type> <body> — one canned response. The key is
# the URL path with `/` as `_`, and `public` for the request carrying a Host.
can() { printf '%s %s\n' "$2" "$3" >"$fake/$1.head"; printf '%s' "$4" >"$fake/$1.body"; }

healthy() {
  local s='{"id":"story-a","rfc":"rfc-r","status":"ready","raw_status":"ready","deps":[]}'
  local html='<main class="site-main"><h1 class="page-title">'
  can _up 200 application/json '{"status":"ok"}'
  can _up_ready 200 application/json '{"status":"ok","failing":[],"checks":{"migrations":{"ok":true,"expected":7,"actual":7}}}'
  can public 302 text/html ''
  can _stories 200 application/json "[$s]"
  can _stories_ready 200 application/json "[$s]"
  can _stories_next-bundle 200 application/json "{\"stories\":[$s],\"bundle_total_loc\":1,\"max_loc\":2}"
  can _stories_touching 200 application/json '[]'
  can _stories_story-a 200 application/json "$s"
  can _index 200 application/json "{\"rfcs\":[{\"id\":\"rfc-r\",\"status\":\"active\"}],\"stories\":[$s]}"
  can _events 200 application/json '{"events":[{"at":"t","verb":"claim","story":"a"}]}'
  can _graphs_parity_data 200 application/json '{"error":"STATS_DB is not set"}'
  can _ 200 text/html "${html}trailmap</h1>"
  can _dashboard 200 text/html "${html}Fleet</h1>"
  can _rfcs 200 text/html "${html}RFCs</h1>"
  can _backlog 200 text/html "${html}Backlog</h1>"
  can _graphs_parity 200 text/html "${html}Parity over time</h1>"
  can _story_story-a 200 text/html "${html}A story</h1><code>story-a</code>"
  can _rfc_rfc-r 200 text/html "${html}An RFC</h1><code>rfc-r</code>"
}

selfTest() {
  fake="$work/fake"
  selfFailed=0
  mkdir -p "$fake/bin"
  cat >"$fake/bin/curl" <<'CURL'
#!/usr/bin/env bash
# Answers from $SMOKE_FAKE/<key>.{head,body}; an unknown key is a 404.
out=/dev/null key=
while [ $# -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift ;;
    -H) key=public; shift ;;
    -m | -w) shift ;;
    http*) url="${1#*://*/}"; [ "$url" != "$1" ] || url=; url="/${url%%\?*}" ;;
  esac
  shift
done
[ -n "$key" ] || key="${url//\//_}"
if [ -f "$SMOKE_FAKE/$key.head" ]; then
  cat "$SMOKE_FAKE/$key.body" >"$out"
  cat "$SMOKE_FAKE/$key.head"
else
  printf '{"error":"not_found"}' >"$out"
  echo "404 application/json"
fi
CURL
  chmod +x "$fake/bin/curl"

  healthy
  expect "a healthy application passes tier 0" 0 0 ""
  expect "a healthy application passes tier 1" 1 0 ""
  expect "a healthy application passes tier 2" 2 0 ""

  can _up 502 text/html ''
  expect "a dead listener fails tier 0" 0 1 tier0.up-loopback

  healthy
  can public 200 text/html '<h1>Fleet</h1>'
  expect "a dashboard served without SSO is named" 1 1 tier1.public-vhost-redirects

  healthy
  can _stories_ready 404 application/json '{"error":"not_found"}'
  expect "forwarding headers in front of the loopback API are named" 1 1 \
    tier1.loopback-api-not-refused,tier1.loopback-api-serving

  healthy
  can _stories_ready 500 text/html ''
  expect "an API past the guard and not serving is named apart from a refusal" 1 1 \
    tier1.loopback-api-serving

  healthy
  can _up_ready 503 application/json '{"status":"unready","failing":["migrations"],"checks":{"migrations":{"ok":false,"expected":7,"actual":6,"error":"schema_migrations is at 6, and db/migrate expects 7: a migration did not run"}}}'
  expect "a migration that did not run is named" 1 1 tier1.up-ready,tier1.migration-head

  healthy
  can _up_ready 503 application/json '{"status":"unready","failing":["checkout"],"checks":{"migrations":{"ok":true,"expected":7,"actual":7}}}'
  expect "an unready probe with the head in place fails only the probe" 1 1 tier1.up-ready

  healthy
  can _stories_ready 200 application/json '{"error":"ranking failed"}'
  expect "a read verb answering 200 with the wrong shape is caught" 2 1 tier2.stories-ready

  healthy
  can _backlog 200 text/html '<main class="site-main"><h1>Something went wrong</h1>'
  expect "a page answering 200 without its heading is caught" 2 1 tier2.page-backlog

  healthy
  can _story_story-a 200 text/html '<main class="site-main"><h1>Not found</h1>'
  expect "a show page answering 200 for something else is caught" 2 1 tier2.page-story

  # A PATH holding what the script needs and no jq, rather than a flag the
  # script reads: the guard is `command -v`, so that is what has to miss.
  healthy
  mkdir -p "$fake/nojq"
  for tool in bash mktemp rm cat grep; do ln -sf "$(command -v "$tool")" "$fake/nojq/$tool"; done
  basePath="$fake/nojq"
  expect "a host without jq fails by name and still runs the status assertions" 1 1 \
    tier1.jq-installed,tier1.migration-head
  can public 200 text/html ''
  expect "a host without jq still names a dashboard served without SSO" 1 1 \
    tier1.jq-installed,tier1.migration-head,tier1.public-vhost-redirects
  unset basePath

  rm -f "$fake"/*.head "$fake"/*.body
  cat >"$fake/bin/curl" <<'CURL'
#!/usr/bin/env bash
# Nothing is listening: no body written, curl's own status 000, exit 7.
echo "000 "
exit 7
CURL
  expect "a host where nothing answers fails every tier 1 assertion, reading no stale body" 1 1 \
    tier1.up-ready,tier1.migration-head,tier1.loopback-api-not-refused,tier1.loopback-api-serving,tier1.public-vhost-redirects

  if "$0" --tier 9 >/dev/null 2>&1; then
    echo "self-test FAILED: an unknown tier exited 0" >&2
    selfFailed=1
  else
    echo "self-test ok: an unknown tier is refused"
  fi
  exit "$selfFailed"
}

tiers=()
while [ $# -gt 0 ]; do
  case "$1" in
    --self-test) selfTest ;;
    --tier)
      case "${2:-}" in
        0 | 1 | 2) tiers+=("$2") ;;
        *) echo "error: --tier takes 0, 1 or 2; got '${2:-}'" >&2; exit 2 ;;
      esac
      shift
      ;;
    *) echo "usage: scripts/smoke-prod.sh --tier N [--tier M ...] | --self-test" >&2; exit 2 ;;
  esac
  shift
done
[ "${#tiers[@]}" -gt 0 ] || { echo "usage: scripts/smoke-prod.sh --tier N [--tier M ...] | --self-test" >&2; exit 2; }

for tier in "${tiers[@]}"; do "tier$tier"; done
exit "$failed"
