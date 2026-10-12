#!/usr/bin/env bash
# Runs one tier of the production smoke suite from the host crontab, and writes
# what happened where ringo's /crons page reads it (RFC 0143).
#
#   scripts/smoke-cron.sh <tier>
#   scripts/smoke-cron.sh --crontab     the entries to install, for this checkout
#   scripts/smoke-cron.sh --self-test
#
# The suite cannot be scheduled from GitHub Actions — the API binds to loopback
# — and trailmap has no scheduler of its own yet (story
# move-the-smoke-schedule-into-trailmap). Cron is the cheap home until it does.
#
# Three things a bare crontab line would get wrong:
#
#   Overlap.  A tier that outlives its cadence would be started again on top of
#             itself, and a hung one would stack up for as long as it hung. Each
#             tier is given less time than its cadence and killed at the end of
#             it, and takes a lock first: a run that finds the lock held writes
#             that it was skipped and leaves.
#   Silence.  Cron's only report is mail. Every run appends a block to a log
#             ringo parses, so a red tier is a red row on /crons.
#   Whose environment.  Cron's PATH is not an agent's, and tier 2 exists to
#             stand where an agent stands. The suite is run by the login shell,
#             which is what a tmux pane gives an agent.
#
# A block is everything from one header to the next:
#
#   === 2026-10-12T09:30:00-04:00 ===
#   PASS<TAB>tier0.up-loopback<TAB>/up 200
#   [smoke-cron] exit=0 duration=1s
#
# and a skipped run's block holds `[smoke-cron] skipped: …` and no exit line.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
SUITE="${TRAILMAP_SMOKE_SUITE:-$here/smoke-prod.sh}"
LOG_DIR="${TRAILMAP_SMOKE_LOG_DIR:-$HOME/github/blazetrailsdev}"
LOGIN_SHELL="${TRAILMAP_SMOKE_SHELL:-$(getent passwd "$(id -un)" | cut -d: -f7)}"
# The log is append-only and tier 0 adds 2880 blocks a day. Past the high mark
# it is cut back to its newest half; ringo reads only the tail either way.
LOG_MAX_BYTES="${TRAILMAP_SMOKE_LOG_MAX_BYTES:-2097152}"

# cadence <tier> — seconds between runs. The schedule in --crontab and the
# budget below are both derived from it, so they cannot disagree.
cadence() {
  case "$1" in
    0) echo 30 ;;
    1) echo 60 ;;
    2) echo 300 ;;
    *) return 1 ;;
  esac
}

crontab() {
  cat <<CRON
# trailmap production smoke (RFC 0143). Tier 0 is every 30s, and cron counts in
# minutes, so it has two entries half a minute apart. TRAILMAP_URL is set here
# only until agents get it from their own shell (RFC 0136 phase G).
* * * * * $here/smoke-cron.sh 0
* * * * * sleep 30; $here/smoke-cron.sh 0
* * * * * $here/smoke-cron.sh 1
*/5 * * * * TRAILMAP_URL=${TRAILMAP_URL:-http://127.0.0.1:8080} $here/smoke-cron.sh 2
CRON
}

run() {
  local tier="$1" seconds
  seconds="$(cadence "$tier")" || { echo "error: no tier '$tier' is scheduled; 0, 1 or 2" >&2; exit 2; }
  # Ten seconds short of the cadence, so the run it would collide with finds
  # the lock already released rather than racing the kill.
  local budget="${TRAILMAP_SMOKE_BUDGET:-$((seconds - 10))}"
  local log="$LOG_DIR/smoke-tier$tier.log" block
  block="$(mktemp)"
  trap 'rm -f "$block"' EXIT

  exec 9>"$LOG_DIR/smoke-tier$tier.lock"
  printf '=== %s ===\n' "$(date -Iseconds)" >"$block"
  if ! flock -n 9; then
    echo "[smoke-cron] skipped: the last tier $tier run is still going" >>"$block"
    cat "$block" >>"$log"
    exit 0
  fi

  # One request may not take the whole budget, or the first hung assertion
  # would be the only one the run reports. The lock is closed for the suite: a
  # child that outlived the kill must not go on holding it.
  local started=$SECONDS code=0
  TRAILMAP_SMOKE_TIMEOUT="${TRAILMAP_SMOKE_TIMEOUT:-$((budget / 2))}" \
    timeout -k 5 "$budget" "$LOGIN_SHELL" -lc "exec '$SUITE' --tier $tier" >>"$block" 2>&1 9>&- || code=$?
  [ "$code" != 124 ] || echo "[smoke-cron] killed: tier $tier ran past its ${budget}s budget" >>"$block"
  echo "[smoke-cron] exit=$code duration=$((SECONDS - started))s" >>"$block"

  cat "$block" >>"$log"
  if [ "$(stat -c %s "$log")" -gt "$LOG_MAX_BYTES" ]; then
    # From the first header in the kept half, so the log never opens mid-block.
    tail -c "$((LOG_MAX_BYTES / 2))" "$log" | sed -n '/^=== [0-9T:+-]*Z\{0,1\} ===$/,$p' >"$block"
    cat "$block" >"$log"
  fi
  exit "$code"
}

# ── self-test ──────────────────────────────────────────────────────────────
#
# This script is run again AS A CHILD against a suite that passes, fails or
# hangs on demand, so what is exercised is the real lock, the real kill and
# the real log.

# expect <label> <want exit> <text the newest block must hold> [<env> ...]
expect() {
  local label="$1" want="$2" text="$3" status=0
  shift 3
  env TRAILMAP_SMOKE_SUITE="$fake/suite" TRAILMAP_SMOKE_LOG_DIR="$fake" TRAILMAP_SMOKE_SHELL=/bin/sh \
    "$@" "$0" 0 >"$fake/out" 2>&1 || status=$?
  local newest
  newest="$(awk '/^=== .* ===$/ { block = "" } { block = block $0 "\n" } END { printf "%s", block }' "$fake/smoke-tier0.log")"
  if [ "$status" != "$want" ] || [[ "$newest" != *"$text"* ]] || [ -s "$fake/out" ]; then
    echo "self-test FAILED: $label — exit $status (want $want), printed [$(cat "$fake/out")], newest block:" >&2
    echo "$newest" >&2
    selfFailed=1
  else
    echo "self-test ok: $label"
  fi
}

selfTest() {
  fake="$(mktemp -d)"
  trap 'rm -rf "$fake"' EXIT
  selfFailed=0
  cat >"$fake/suite" <<'SUITE'
#!/usr/bin/env bash
# SMOKE_FAKE_SLEEP holds the run open; SMOKE_FAKE_FAIL fails its one assertion.
sleep "${SMOKE_FAKE_SLEEP:-0}"
if [ -n "${SMOKE_FAKE_FAIL:-}" ]; then
  printf 'FAIL\ttier0.up-loopback\t/up answered 502, not 200\n'
  echo "SMOKE FAILED [tier0.up-loopback]: the loopback listener answered 502" >&2
  exit 1
fi
printf 'PASS\ttier0.up-loopback\t/up 200\n'
SUITE
  chmod +x "$fake/suite"

  expect "a passing tier is logged with its assertions and exit 0" 0 \
    $'PASS\ttier0.up-loopback\t/up 200\n[smoke-cron] exit=0'
  expect "a failing tier is logged with what failed, and exits non-zero" 1 \
    $'SMOKE FAILED [tier0.up-loopback]: the loopback listener answered 502\n[smoke-cron] exit=1' \
    SMOKE_FAKE_FAIL=1
  expect "a hung tier is killed at its budget and logged as killed" 124 \
    $'[smoke-cron] killed: tier 0 ran past its 1s budget\n[smoke-cron] exit=124' \
    SMOKE_FAKE_SLEEP=30 TRAILMAP_SMOKE_BUDGET=1

  # The overlap itself: a run holding the lock, and a second started under it.
  env TRAILMAP_SMOKE_SUITE="$fake/suite" TRAILMAP_SMOKE_LOG_DIR="$fake" TRAILMAP_SMOKE_SHELL=/bin/sh \
    SMOKE_FAKE_SLEEP=3 "$0" 0 &
  sleep 1
  expect "a tier started under a running one is skipped, not stacked" 0 \
    "[smoke-cron] skipped: the last tier 0 run is still going"
  wait
  expect "the lock is released when the run that held it ends" 0 "[smoke-cron] exit=0"

  local before
  before="$(grep -c '^=== ' "$fake/smoke-tier0.log")"
  expect "a log past its size is cut back to whole blocks" 0 "[smoke-cron] exit=0" \
    TRAILMAP_SMOKE_LOG_MAX_BYTES=200
  if [ "$(grep -c '^=== ' "$fake/smoke-tier0.log")" -ge "$before" ] ||
    [[ "$(head -n 1 "$fake/smoke-tier0.log")" != "=== "* ]]; then
    echo "self-test FAILED: the cut log does not open on a header, or was not cut" >&2
    selfFailed=1
  fi

  # The entries are derived, so hold what they derive to: tier 0 twice a
  # minute, tiers 1 and 2 on their cadence, each naming this script.
  local entries
  entries="$("$0" --crontab | grep -v '^#')"
  if [ "$(printf '%s\n' "$entries" | wc -l)" = 4 ] &&
    [ "$(printf '%s\n' "$entries" | grep -c "^\* \* \* \* \* \(sleep 30; \)\{0,1\}$here/smoke-cron.sh 0\$")" = 2 ] &&
    printf '%s\n' "$entries" | grep -q "^\* \* \* \* \* $here/smoke-cron.sh 1\$" &&
    printf '%s\n' "$entries" | grep -q "^\*/5 \* \* \* \* TRAILMAP_URL=[^ ]* $here/smoke-cron.sh 2\$"; then
    echo "self-test ok: --crontab prints tier 0 twice a minute, tier 1 every minute, tier 2 every 5"
  else
    echo "self-test FAILED: --crontab printed:" >&2
    echo "$entries" >&2
    selfFailed=1
  fi

  if "$0" 3 >/dev/null 2>&1; then
    echo "self-test FAILED: an unscheduled tier exited 0" >&2
    selfFailed=1
  else
    echo "self-test ok: an unscheduled tier is refused"
  fi
  exit "$selfFailed"
}

case "${1:-}" in
  --self-test) selfTest ;;
  --crontab) crontab ;;
  [0-9]) run "$1" ;;
  *) echo "usage: scripts/smoke-cron.sh <tier> | --crontab | --self-test" >&2; exit 2 ;;
esac
