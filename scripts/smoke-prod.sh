#!/usr/bin/env bash
# The production smoke suite: the assertions that can only be made against the
# running application, on the box, as tiers (RFC 0143).
#
#   scripts/smoke-prod.sh --tier N [--tier M ...]
#   scripts/smoke-prod.sh --self-test
#
#   0  liveness    /up on loopback
#   1  readiness   /up/ready, both migration heads, the loopback API, the public vhost
#   2  read smoke  every read verb and page, by shape rather than by status,
#                  and the installed `tasks` binary from an agent's worktree
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
# Seconds from the start by which the suite must have finished, when whoever
# runs it will kill it (scripts/smoke-cron.sh). Unset, there is no deadline.
DEADLINE="${TRAILMAP_SMOKE_DEADLINE:-}"
LATE="not run: the suite's ${DEADLINE}s deadline had passed"
# The canary's worktree: made once with `scripts/start-worktree.sh smoke-canary`,
# so it has the path and the `tasks` link every agent's worktree has.
WORKTREE="${TRAILMAP_SMOKE_WORKTREE:-$HOME/github/blazetrailsdev/worktrees/smoke-canary}"

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

# allowance — sets $allowed, the seconds the next call may take: $TIMEOUT, or
# what is left before the deadline when that is less. False when nothing is
# left, and the caller then fails BY NAME instead of making the call: a hung
# verb costs its own allowance, not the rows of every assertion after it.
allowance() {
  allowed="$TIMEOUT"
  [ -n "$DEADLINE" ] || return 0
  [ "$((DEADLINE - SECONDS))" -ge "$allowed" ] || allowed="$((DEADLINE - SECONDS))"
  [ "$allowed" -gt 0 ]
}

# fetch <url> [<Host header>] — the body lands in $work/body, and $status and
# $contentType are set. A request that never connected reads as status 000,
# and so does one there was no time left to make, which also sets $late.
fetch() {
  local out
  # Cleared first: a request that never connected writes no body, and the last
  # request's body must not be read as this one's.
  rm -f "$work/body"
  late="" status=000 contentType=""
  allowance || { late=1; return; }
  out=$(curl -s -m "$allowed" -o "$work/body" -w '%{http_code} %{content_type}' \
    ${2:+-H "Host: $2"} "$1") || true
  status="${out%% *}"
  contentType="${out#* }"
  [ -n "$status" ] || status=000
}

# json <name> <path> <jq filter> — 200, and a body the filter answers `true` for.
json() {
  fetch "$LOOPBACK$2"
  if [ -n "$late" ]; then
    fail "$1" "$LATE"
  elif [ "$status" != "200" ]; then
    fail "$1" "$2 answered $status, not 200"
  elif [ "$(jq -r "$3" "$work/body" 2>/dev/null)" != "true" ]; then
    fail "$1" "$2 answered 200 without the expected shape" \
      "$2 answered 200, but its body does not satisfy: $3"
  else
    pass "$1" "$2 200"
  fi
}

# page <name> <path> <heading> [<id>] [<marker>] — 200, HTML, inside the
# layout, with its heading. A show page's heading is its title, which this
# cannot know, so it is recognised by the id it was asked for, in the element
# the show views render it in. Anywhere in the body would not do: the
# not-found view echoes the id too, and a short id turns up in prose and links.
# A hub page has no id element; `<marker>` is the literal markup only that
# page draws (its active tab, or the owner's login in the subhead).
page() {
  fetch "$LOOPBACK$2"
  if [ -n "$late" ]; then
    fail "$1" "$LATE"
  elif [ "$status" != "200" ]; then
    fail "$1" "$2 answered $status, not 200"
  elif [[ "$contentType" != text/html* ]]; then
    fail "$1" "$2 answered ${contentType:-no content type}, not text/html"
  elif ! grep -q '<main class="site-main">' "$work/body"; then
    fail "$1" "$2 rendered outside the layout"
  elif ! grep -Eq "<h1[^>]*>$3" "$work/body"; then
    fail "$1" "$2 rendered without its heading" "$2 has no <h1> starting \"$3\""
  elif [ -n "${4:-}" ] && ! grep -Fq "<span class=\"id\">$4</span>" "$work/body"; then
    fail "$1" "$2 rendered without naming $4 as its id"
  elif [ -n "${5:-}" ] && ! grep -Fq "$5" "$work/body"; then
    fail "$1" "$2 rendered without its marker" "$2 has no $5"
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
  # reports the same six rows either way.
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
  # The hub's head, from the same body. A `skipped` check is a FAIL here:
  # production cannot boot without HUB_DATABASE_URL, so a deployment answering
  # that it has no hub is not the deployment this script was pointed at.
  if [ "$hasJq" = 0 ]; then
    fail tier1.hub-migration-head "not read: jq is not on PATH"
  elif [ "$(jq -r '.checks.hub_migrations | (.ok == true and .skipped == null)' "$work/body" 2>/dev/null)" = "true" ]; then
    pass tier1.hub-migration-head "hub schema_migrations at $(jq -r '.checks.hub_migrations.actual' "$work/body")"
  else
    fail tier1.hub-migration-head \
      "$(jq -r '.checks.hub_migrations | .error // .skipped // "/up/ready reported no hub_migrations check"' "$work/body" 2>/dev/null || echo "/up/ready answered no JSON")"
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
  # This USED TO accept either shape, because an unset STATS_DB is a supported
  # deployment and answers `{"error": …}`. That is true of the application and
  # was the wrong call for THIS suite: `{"error": …}` is an object of length 1,
  # so the loose check passed while the page was dark in production for every
  # deploy since it shipped. smoke-prod is the production suite for one named
  # app (see APP and TRAILMAP_HOSTNAME above), and that app is meant to serve
  # this page — so it asserts the page is served, and a deployment that
  # deliberately runs without stats is one that does not run tier 2.
  #
  # A served endpoint names at least one run it can chart and one package to
  # chart it for. `series` need only be PRESENT: this asks with no `packages=`,
  # and empty series is the correct answer to that.
  json tier2.graphs-parity-data "/graphs/parity/data" \
    '(has("error") | not) and (.metrics | type == "array" and length > 0)
     and (.packages | type == "array" and length > 0) and has("series")'

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

  tier2Hub

  tier2Cli "$stories" "$id"
}

# cli <name> <jq filter> <verb> [<arg> ...] — the installed binary, run where an
# agent runs it, exiting 0 with a stdout the filter answers `true` for. `where`
# is the one verb whose stdout is not JSON, so it alone is read raw (`-Rs`, the
# whole stdout as one string); every other verb has to print JSON to pass.
#
# Stdout goes to a FILE. Through a pipe the CLI loses everything past 64KiB
# (story tasks-cli-json-truncates-through-a-pipe), and that is a bug with a
# story, not a deployment fault this suite should be red about every 5 minutes.
cli() {
  local name="$1" filter="$2" code=0 how=-r
  shift 2
  [ "$1" != where ] || how=-Rsr
  if [ -n "$cliSkip" ]; then
    fail "$name" "not run: $cliSkip"
    return
  fi
  allowance || { fail "$name" "$LATE"; return; }
  (cd "$WORKTREE" && timeout "$allowed" tasks "$@") >"$work/stdout" 2>"$work/stderr" || code=$?
  if [ "$code" != 0 ]; then
    fail "$name" "tasks $* exited $code" \
      "\`tasks $*\` exited $code from $WORKTREE: $(tail -n 3 "$work/stderr" | tr '\n' ' ')"
  elif [ "$(jq "$how" "$filter" "$work/stdout" 2>/dev/null)" != "true" ]; then
    fail "$name" "tasks $* exited 0 without the expected stdout" \
      "\`tasks $*\` exited 0, but its stdout does not satisfy: $filter"
  else
    pass "$name" "tasks $* ok"
  fi
}

# readyDiffers — sets $differs to why `tasks ready --json` and /stories/ready do
# not name the same stories in the same order, or to nothing when they do.
#
# Every way of not having an answer is a reason of its own. Comparing two
# `jq ... 2>/dev/null` outputs was not: a CLI that exited non-zero and an API
# body that was not an array both printed nothing, and nothing equals nothing.
readyDiffers() {
  local code=0 cliIds apiIds
  local ids='if type == "array" and all(.[]; type == "object" and (.id | type) == "string") then [.[].id] else error("not ids") end'
  allowance || { differs="$LATE"; return; }
  (cd "$WORKTREE" && timeout "$allowed" tasks ready --json) >"$work/stdout" 2>/dev/null || code=$?
  fetch "$LOOPBACK/stories/ready"
  if [ "$code" != 0 ]; then
    differs="tasks ready --json exited $code"
  elif [ "$status" != "200" ]; then
    differs="/stories/ready answered $status, not 200"
  elif ! cliIds="$(jq -c "$ids" "$work/stdout" 2>/dev/null)"; then
    differs="tasks ready --json did not print an array of stories with ids"
  elif ! apiIds="$(jq -c "$ids" "$work/body" 2>/dev/null)"; then
    differs="/stories/ready did not answer an array of stories with ids"
  elif [ "$cliIds" != "$apiIds" ]; then
    differs="$DIFFERENT"
  else
    differs=""
  fi
}
DIFFERENT="tasks ready --json and /stories/ready name different stories"

# What breaks for an agent is not the endpoint. It is TRAILMAP_URL, PATH, where
# the binary was installed and which checkout it resolves — none of which a
# `curl` from here can see, because this script is not standing where an agent
# stands. So this half runs the binary an agent would find, from a worktree of
# the shape an agent is given, and reads its stdout (RFC 0143).
#
# The three things it stands on each have a row of their own, and a verb that
# could not be run says which of them was missing rather than failing blind.
tier2Cli() {
  local stories="$1" id="$2"
  cliSkip=""

  if [ -z "${TRAILMAP_URL:-}" ]; then
    fail tier2.cli-trailmap-url "TRAILMAP_URL is not set" \
      "TRAILMAP_URL is not set in the canary's environment. It is how the CLI
  finds the application once it is an HTTP client (RFC 0136 phase G); set it
  where agents get theirs, and in the crontab that runs this suite."
  else
    fetch "$TRAILMAP_URL/up"
    if [ "$status" = "200" ]; then
      pass tier2.cli-trailmap-url "TRAILMAP_URL $TRAILMAP_URL answers /up"
    else
      fail tier2.cli-trailmap-url "TRAILMAP_URL $TRAILMAP_URL answered $status for /up, not 200" \
        "TRAILMAP_URL is $TRAILMAP_URL, and /up there answered $status. The
  variable names somewhere the application is not."
    fi
  fi

  # A linked worktree: `.git` is a file there and a directory in a checkout.
  if [ -f "$WORKTREE/.git" ] && [ -e "$WORKTREE/tasks" ]; then
    pass tier2.cli-worktree "$WORKTREE"
  else
    fail tier2.cli-worktree "$WORKTREE is not a worktree with a tasks checkout" \
      "$WORKTREE is not a linked git worktree holding a \`tasks\` link.
  Make it with \`scripts/start-worktree.sh ${WORKTREE##*/}\`, or name another
  with TRAILMAP_SMOKE_WORKTREE."
    cliSkip="no worktree at $WORKTREE"
  fi

  local bin
  bin="$(command -v tasks)"
  if [ -z "$bin" ]; then
    fail tier2.cli-binary "tasks is not on PATH" \
      "no \`tasks\` on PATH ($PATH). An agent's first verb fails the same
  way; reinstall it with the tasks checkout's scripts/install-bin.sh."
    cliSkip="${cliSkip:-tasks is not on PATH}"
  else
    pass tier2.cli-binary "$bin"
  fi

  # Found is not resolved: the link in ~/.local/bin has pointed at a checkout
  # with no node_modules, and a binary run from a worktree has answered for
  # the canonical checkout. `where` prints what it resolved.
  local want
  want="$(realpath "$WORKTREE/tasks" 2>/dev/null)"
  cli tier2.cli-where \
    "(split(\"\n\")[0] | ltrimstr(\"tasks dir:\") | ltrimstr(\" \")) as \$dir | \$dir == \"$WORKTREE/tasks\" or \$dir == \"$want\"" \
    where
  cli tier2.cli-ready "$stories" ready --json
  # Phase G's own verification, run continuously: the verb prints what the API
  # answers. Ids in queue order are the part the spawn loop acts on. A
  # DIFFERENCE is asked about twice before it is believed, because a claim
  # landing between the two reads is one too; a side with no answer is not.
  if [ -z "$cliSkip" ]; then
    readyDiffers
    [ "$differs" != "$DIFFERENT" ] || readyDiffers
    if [ -z "$differs" ]; then
      pass tier2.cli-ready-matches-api "tasks ready --json names the stories /stories/ready does"
    elif [ "$differs" != "$DIFFERENT" ]; then
      fail tier2.cli-ready-matches-api "$differs"
    else
      fail tier2.cli-ready-matches-api "$DIFFERENT" \
        "\`tasks ready --json\` and $LOOPBACK/stories/ready named different
  stories, twice. The CLI and the application are not reading one queue."
    fi
  else
    fail tier2.cli-ready-matches-api "not run: $cliSkip"
  fi
  cli tier2.cli-next-bundle \
    "(.stories | $stories) and has(\"bundle_total_loc\") and has(\"max_loc\")" next-bundle --json
  cli tier2.cli-list "$stories" list --status ready --json
  if [ -n "$id" ]; then
    cli tier2.cli-show ".id == \"$id\" and has(\"rfc\") and has(\"status\")" show "$id"
  else
    fail tier2.cli-show "no story id to ask for: /stories named none"
  fi
}

# The pages under the GitHub-shaped hierarchy, the only ones served from the
# hub (Postgres) database: with it down, these are what go red. The owner and
# repository are SMOKE_OWNER and SMOKE_REPO, by default blazetrailsdev/trailmap,
# a repository the hub always carries.
#
# `/panes/:id` stays out of the tier: the page is drawn for any numeric id
# without asking anything (its screen is polled from the browser through
# `/fleet/pane/:id/screen`), so a 200 for it proves nothing, and the screen
# relay needs a live tmux pane that a scheduled run cannot count on.
tier2Hub() {
  local owner="${SMOKE_OWNER:-blazetrailsdev}" repo="${SMOKE_REPO:-trailmap}"
  local nwo="$owner/$repo" tab
  page tier2.page-owner "/$owner" "" "" "<code>$owner</code>"
  page tier2.page-repo "/$nwo" "" "" "<a class=\"tab active\" href=\"/$nwo\">"
  for tab in issues pulls projects actions wiki pulse settings; do
    page "tier2.page-repo-$tab" "/$nwo/$tab" "" "" "<a class=\"tab active\" href=\"/$nwo/$tab\">"
  done
}

# ── self-test ──────────────────────────────────────────────────────────────
#
# A canned `curl` goes first on PATH and this script is run again AS A CHILD,
# so what is exercised is the real argument parsing, the real exit status and
# the real output — not functions called from inside a harness.

# expect <label> <tier> <want exit> <name that must FAIL, or ""> [<env> ...]
expect() {
  local out status=0 label="$1" tier="$2" want="$3" names="$4"
  shift 4
  out="$(env PATH="$fake/bin:${basePath:-$PATH}" SMOKE_FAKE="$fake" TRAILMAP_URL="${cannedUrl-http://127.0.0.1:8080}" \
    TRAILMAP_SMOKE_WORKTREE="$fake/worktree" "$@" "$0" --tier "$tier" 2>/dev/null)" || status=$?
  set -- "$label" "$tier" "$want" "$names"
  local failing; failing="$(printf '%s\n' "$out" | awk -F'\t' '$1 == "FAIL" { print $2 }' | paste -sd, -)"
  if [ "$status" != "$3" ] || [ "$failing" != "$4" ]; then
    echo "self-test FAILED: $1 — exit $status (want $3), failing [$failing] (want [$4])" >&2
    selfFailed=1
  else
    echo "self-test ok: $1"
  fi
}

# cliCan <verb> <stdout> — what the canned `tasks` prints for one verb.
cliCan() { printf '%s\n' "$2" >"$fake/tasks.$1"; }

# can <key> <status> <content type> <body> — one canned response. The key is
# the URL path with `/` as `_`, and `public` for the request carrying a Host.
can() { printf '%s %s\n' "$2" "$3" >"$fake/$1.head"; printf '%s' "$4" >"$fake/$1.body"; }

healthy() {
  rm -f "$fake"/tasks.*.exit "$fake/tasks.hang"
  local s='{"id":"story-a","rfc":"rfc-r","status":"ready","raw_status":"ready","deps":[]}'
  local html='<main class="site-main"><h1 class="page-title">'
  # A parity endpoint that is actually serving: the picker names a run and a
  # package. This fixture used to be `{"error":"STATS_DB is not set"}` — the
  # answer a deployment with no stats database gives — so "healthy" asserted
  # the page was allowed to be dark.
  local parity='{"metrics_selected":["api"],"gaps_by_metric":{"api":["missing"]},'
  parity+='"metrics":[{"key":"api","label":"api:compare","gaps":["missing"]}],'
  parity+='"packages":["activerecord"],"unknown_packages":[],"max_packages":8,"series":[]}'
  can _up 200 text/html '<!DOCTYPE html><html><body style="background-color: green"></body></html>'
  can _up_ready 200 application/json '{"status":"ok","failing":[],"checks":{"migrations":{"ok":true,"expected":7,"actual":7},"hub_migrations":{"ok":true,"expected":6,"actual":6}}}'
  can public 302 text/html ''
  can _stories 200 application/json "[$s]"
  can _stories_ready 200 application/json "[$s]"
  can _stories_next-bundle 200 application/json "{\"stories\":[$s],\"bundle_total_loc\":1,\"max_loc\":2}"
  can _stories_touching 200 application/json '[]'
  can _stories_story-a 200 application/json "$s"
  can _index 200 application/json "{\"rfcs\":[{\"id\":\"rfc-r\",\"status\":\"active\"}],\"stories\":[$s]}"
  can _events 200 application/json '{"events":[{"at":"t","verb":"claim","story":"a"}]}'
  can _graphs_parity_data 200 application/json "$parity"
  can _ 200 text/html "${html}trailmap</h1>"
  can _dashboard 200 text/html "${html}Fleet</h1>"
  can _rfcs 200 text/html "${html}RFCs</h1>"
  can _backlog 200 text/html "${html}Backlog</h1>"
  can _graphs_parity 200 text/html "${html}Parity over time</h1>"
  can _story_story-a 200 text/html "${html}A story</h1><span class=\"id\">story-a</span>"
  can _rfc_rfc-r 200 text/html "${html}An RFC</h1><span class=\"id\">rfc-r</span>"
  local nwo=blazetrailsdev/trailmap tab
  can _blazetrailsdev 200 text/html "${html}Dean</h1><code>blazetrailsdev</code>"
  can _blazetrailsdev_trailmap 200 text/html "${html}</h1><a class=\"tab active\" href=\"/$nwo\">"
  for tab in issues pulls projects actions wiki pulse settings; do
    can "_blazetrailsdev_trailmap_$tab" 200 text/html "${html}</h1><a class=\"tab active\" href=\"/$nwo/$tab\">"
  done
  cliCan where "tasks dir: $fake/worktree/tasks"
  cliCan ready "[$s]"
  cliCan next-bundle "{\"stories\":[$s],\"bundle_total_loc\":1,\"max_loc\":2}"
  cliCan list "[$s]"
  cliCan show "$s"
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
  cat >"$fake/bin/tasks" <<'TASKS'
#!/usr/bin/env bash
# Answers from $SMOKE_FAKE/tasks.<verb>; a verb with nothing canned fails the
# way the real one does. `tasks.<verb>.exit` is the status to leave with after
# printing, and `tasks.hang` makes every verb hang.
[ ! -e "$SMOKE_FAKE/tasks.hang" ] || exec sleep 60
[ -f "$SMOKE_FAKE/tasks.$1" ] || { echo "error: unknown command \"$1\"" >&2; exit 1; }
cat "$SMOKE_FAKE/tasks.$1"
exit "$(cat "$SMOKE_FAKE/tasks.$1.exit" 2>/dev/null || echo 0)"
TASKS
  chmod +x "$fake/bin/curl" "$fake/bin/tasks"
  mkdir -p "$fake/worktree/tasks"
  echo "gitdir: /nowhere" >"$fake/worktree/.git"

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
  can _up_ready 503 application/json '{"status":"unready","failing":["migrations"],"checks":{"migrations":{"ok":false,"expected":7,"actual":6,"error":"schema_migrations is at 6, and db/migrate expects 7: a migration did not run"},"hub_migrations":{"ok":true,"expected":6,"actual":6}}}'
  expect "a migration that did not run is named" 1 1 tier1.up-ready,tier1.migration-head

  healthy
  can _up_ready 503 application/json '{"status":"unready","failing":["hub_migrations"],"checks":{"migrations":{"ok":true,"expected":7,"actual":7},"hub_migrations":{"ok":false,"expected":6,"actual":5,"error":"schema_migrations is at 5, and db/hub-migrate expects 6: a migration did not run"}}}'
  expect "a hub migration that did not run is named" 1 1 tier1.up-ready,tier1.hub-migration-head

  healthy
  can _up_ready 200 application/json '{"status":"ok","failing":[],"checks":{"migrations":{"ok":true,"expected":7,"actual":7},"hub_migrations":{"ok":true,"skipped":"HUB_DATABASE_URL is not set"}}}'
  expect "a deployment with no hub is not passed" 1 1 tier1.hub-migration-head

  healthy
  can _up_ready 503 application/json '{"status":"unready","failing":["checkout"],"checks":{"migrations":{"ok":true,"expected":7,"actual":7},"hub_migrations":{"ok":true,"expected":6,"actual":6}}}'
  expect "an unready probe with the head in place fails only the probe" 1 1 tier1.up-ready

  healthy
  can _stories_ready 200 application/json '{"error":"ranking failed"}'
  # The CLI still names the queue, so the two no longer agree either.
  expect "a read verb answering 200 with the wrong shape is caught" 2 1 \
    tier2.stories-ready,tier2.cli-ready-matches-api

  healthy
  can _graphs_parity_data 200 application/json '{"error":"STATS_DB is not set"}'
  expect "a parity endpoint with no stats database is caught" 2 1 \
    tier2.graphs-parity-data

  healthy
  can _graphs_parity_data 200 application/json \
    '{"metrics":[],"packages":[],"series":[],"max_packages":8}'
  expect "a parity endpoint with a stats database it cannot chart is caught" 2 1 \
    tier2.graphs-parity-data

  healthy
  can _backlog 200 text/html '<main class="site-main"><h1>Something went wrong</h1>'
  expect "a page answering 200 without its heading is caught" 2 1 tier2.page-backlog

  healthy
  can _story_story-a 200 text/html '<main class="site-main"><h1>Not found</h1><p>No story in the index has the id <code>story-a</code>.</p>'
  expect "a show page answering 200 for something else is caught" 2 1 tier2.page-story

  healthy
  can _blazetrailsdev_trailmap_pulls 200 text/html \
    '<main class="site-main"><h1></h1><a class="tab active" href="/blazetrailsdev/trailmap/issues">'
  expect "a hub tab answering 200 as another tab is caught" 2 1 tier2.page-repo-pulls

  # The hub database stopped: every page under /:owner 500s, and nothing else.
  healthy
  local hubRows=tier2.page-owner,tier2.page-repo tab
  can _blazetrailsdev 500 text/html 'relation "repositories" does not exist'
  can _blazetrailsdev_trailmap 500 text/html ''
  for tab in issues pulls projects actions wiki pulse settings; do
    can "_blazetrailsdev_trailmap_$tab" 500 text/html ''
    hubRows+=",tier2.page-repo-$tab"
  done
  expect "a stopped hub database fails tier 2 naming the hub pages" 2 1 "$hubRows"

  local cliRows=tier2.cli-where,tier2.cli-ready,tier2.cli-ready-matches-api,tier2.cli-next-bundle,tier2.cli-list,tier2.cli-show

  healthy
  cannedUrl=""
  expect "an unset TRAILMAP_URL is named, and the verbs still run" 2 1 tier2.cli-trailmap-url
  unset cannedUrl

  healthy
  cannedUrl="http://127.0.0.1:1/nowhere"
  expect "a TRAILMAP_URL naming somewhere else is named" 2 1 tier2.cli-trailmap-url
  unset cannedUrl

  healthy
  cliCan where "tasks dir: /home/dean/github/blazetrailsdev/tasks"
  expect "a binary answering for the canonical checkout is caught" 2 1 tier2.cli-where

  healthy
  cliCan ready '[]'
  expect "a CLI naming a different queue from the API is caught" 2 1 tier2.cli-ready-matches-api

  # The three ways the comparison used to pass with a side that had no answer:
  # each of these leaves the OTHER side saying exactly what a healthy one does.
  healthy
  echo 3 >"$fake/tasks.ready.exit"
  expect "a CLI that names the queue and exits non-zero does not match the API" 2 1 \
    tier2.cli-ready,tier2.cli-ready-matches-api

  healthy
  can _stories_ready 500 application/json "$(cat "$fake/_stories_ready.body")"
  expect "an API that names the queue under a 500 does not match the CLI" 2 1 \
    tier2.stories-ready,tier2.cli-ready-matches-api

  healthy
  cliCan ready '{"error":"ranking failed"}'
  can _stories_ready 200 application/json '{"error":"ranking failed"}'
  expect "two sides that are both not a list of stories do not match" 2 1 \
    tier2.stories-ready,tier2.cli-ready,tier2.cli-ready-matches-api

  # A hung binary under a deadline: each verb costs its own allowance, the ones
  # there was no time for fail by name, and the suite is out before the kill.
  healthy
  touch "$fake/tasks.hang"
  local hungAt=$SECONDS
  expect "a hung tasks still gets a row for every verb, inside the deadline" 2 1 "$cliRows" \
    TRAILMAP_SMOKE_TIMEOUT=1 TRAILMAP_SMOKE_DEADLINE=4
  if [ "$((SECONDS - hungAt))" -gt 6 ]; then
    echo "self-test FAILED: the hung run took $((SECONDS - hungAt))s against a 4s deadline" >&2
    selfFailed=1
  fi

  healthy
  cliCan next-bundle 'no ready stories'
  expect "a verb exiting 0 with the wrong stdout is caught" 2 1 tier2.cli-next-bundle

  healthy
  rm "$fake/tasks.show"
  expect "a verb exiting non-zero is caught" 2 1 tier2.cli-show

  healthy
  rm "$fake/worktree/.git"
  expect "a missing worktree is named apart from the verbs it stopped" 2 1 \
    "tier2.cli-worktree,$cliRows"
  echo "gitdir: /nowhere" >"$fake/worktree/.git"

  # No `tasks` anywhere on PATH, the same way the jq case below gets no jq.
  healthy
  mkdir -p "$fake/notasks"
  for tool in bash mktemp rm cat grep jq timeout realpath tail tr; do
    ln -sf "$(command -v "$tool")" "$fake/notasks/$tool"
  done
  mv "$fake/bin/tasks" "$fake/tasks.bin"
  basePath="$fake/notasks"
  expect "a missing binary is named apart from the verbs it stopped" 2 1 \
    "tier2.cli-binary,$cliRows"
  unset basePath
  mv "$fake/tasks.bin" "$fake/bin/tasks"

  # A PATH holding what the script needs and no jq, rather than a flag the
  # script reads: the guard is `command -v`, so that is what has to miss.
  healthy
  mkdir -p "$fake/nojq"
  for tool in bash mktemp rm cat grep; do ln -sf "$(command -v "$tool")" "$fake/nojq/$tool"; done
  basePath="$fake/nojq"
  expect "a host without jq fails by name and still runs the status assertions" 1 1 \
    tier1.jq-installed,tier1.migration-head,tier1.hub-migration-head
  can public 200 text/html ''
  expect "a host without jq still names a dashboard served without SSO" 1 1 \
    tier1.jq-installed,tier1.migration-head,tier1.hub-migration-head,tier1.public-vhost-redirects
  unset basePath

  rm -f "$fake"/*.head "$fake"/*.body
  cat >"$fake/bin/curl" <<'CURL'
#!/usr/bin/env bash
# Nothing is listening: no body written, curl's own status 000, exit 7.
echo "000 "
exit 7
CURL
  expect "a host where nothing answers fails every tier 1 assertion, reading no stale body" 1 1 \
    tier1.up-ready,tier1.migration-head,tier1.hub-migration-head,tier1.loopback-api-not-refused,tier1.loopback-api-serving,tier1.public-vhost-redirects

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
