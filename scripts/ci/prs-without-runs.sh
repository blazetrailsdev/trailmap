#!/usr/bin/env bash
# Print the number of every open PR whose head commit has had no workflow run
# and no check for longer than MINUTES (default 10).
#
#   REPO=owner/repo ./scripts/ci/prs-without-runs.sh             # list them
#   REPO=owner/repo ./scripts/ci/prs-without-runs.sh --comment   # and say so, once, then fail
#   ./scripts/ci/prs-without-runs.sh --self-test
#
# A PR with no checks looks exactly like one whose checks have not started,
# and the review flow waits on a green that then never comes. On 2026-10-05
# GitHub delivered the `opened` event for #34 and #35 late (the run history is
# in the PR that added this script); nothing here can prevent that, so this
# notices it.
#
# `--comment` is what pr-watchdog.yml runs. It lives here rather than in the
# workflow so that `--self-test` — a canned `gh` first on PATH, as
# smoke-prod.sh does with `curl` — holds the comment, its once-only marker and
# the failing exit in CI. A scheduled workflow only runs from `main`, so
# nothing else exercises them before they are needed.
set -euo pipefail

MARKER='pr-watchdog:no-run'

stuckPrs() {
  : "${REPO:?REPO is not set}"
  local cutoff
  cutoff="$(date -u -d "${MINUTES:-10} minutes ago" +%Y-%m-%dT%H:%M:%SZ)"

  # The head commit's date as well as the PR's: a push restarts the wait. Drafts
  # count, because CI runs on them. A fork's PR does not: this token cannot
  # comment on it.
  gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" \
    --jq '.[] | select(.head.repo.full_name == .base.repo.full_name)
          | "\(.number) \(.head.sha) \(.created_at)"' |
  while read -r number sha created; do
    [[ "$created" < "$cutoff" ]] || continue
    pushed="$(gh api "repos/$REPO/commits/$sha" --jq '.commit.committer.date')"
    [[ "$pushed" < "$cutoff" ]] || continue
    runs="$(gh api "repos/$REPO/actions/runs?head_sha=$sha&per_page=1" --jq '.total_count')"
    checks="$(gh api "repos/$REPO/commits/$sha/check-runs?per_page=1" --jq '.total_count')"
    if [ "$runs" -eq 0 ] && [ "$checks" -eq 0 ]; then echo "$number"; fi
  done
}

commentOnce() {
  local stuck
  stuck="$(stuckPrs)"
  [ -n "$stuck" ] || { echo "Every open PR has a run."; return 0; }
  for number in $stuck; do
    echo "::error::#$number has had no CI run for ten minutes."
    # Said once: the marker is how the next tick knows it already has.
    if ! gh pr view "$number" --repo "$REPO" --json comments --jq '.comments[].body' | grep -q "$MARKER"; then
      gh pr comment "$number" --repo "$REPO" --body "<!-- $MARKER -->
CI has not started on this pull request ten minutes after its last push, and it will not show a result until it does. Close and reopen it, or push an empty commit, to start it."
    fi
  done
  return 1
}

# ── self-test ──────────────────────────────────────────────────────────────
#
# The canned `gh` answers from $WATCHDOG_FAKE: `pulls` is the open-PR list,
# `runs.<sha>` the run count for a head, and every `gh pr comment` appends its
# body to `comments.<n>`, which `gh pr view` reads back — so two ticks see each
# other's comments the way they would on GitHub.
selfTest() {
  local fake out status selfFailed=0
  fake="$(mktemp -d)"
  trap 'rm -rf "$fake"' RETURN
  mkdir -p "$fake/bin"
  cat >"$fake/bin/gh" <<'GH'
#!/usr/bin/env bash
f="$WATCHDOG_FAKE"
case "$1 $2" in
  "api --paginate") cat "$f/pulls" ;;
  "api repos/"*)
    case "$2" in
      */commits/*/check-runs*) echo 0 ;;
      */commits/*) echo 2020-01-01T00:00:00Z ;;
      */actions/runs*) sha="${2#*head_sha=}"; cat "$f/runs.${sha%%&*}" 2>/dev/null || echo 0 ;;
    esac ;;
  "pr view") cat "$f/comments.$3" 2>/dev/null || true ;;
  "pr comment") shift 2; n="$1"; while [ "$1" != --body ]; do shift; done
    printf '%s\n' "$2" >>"$f/comments.$n" ;;
  *) echo "canned gh: unexpected $*" >&2; exit 1 ;;
esac
GH
  chmod +x "$fake/bin/gh"

  # tick <args> — one run of this script as a child; sets $out and $status.
  tick() {
    status=0
    out="$(env PATH="$fake/bin:$PATH" WATCHDOG_FAKE="$fake" REPO=o/r "$0" "$@" 2>/dev/null)" || status=$?
  }
  check() {
    if [ "$2" = "$3" ]; then echo "self-test ok: $1"; else
      echo "self-test FAILED: $1 — got [$2], want [$3]" >&2
      selfFailed=1
    fi
  }

  # Every PR is a day old by the canned dates; #7 has a run, #8 has none.
  printf '7 aaa 2020-01-01T00:00:00Z\n8 bbb 2020-01-01T00:00:00Z\n' >"$fake/pulls"
  echo 1 >"$fake/runs.aaa"

  echo 1 >"$fake/runs.bbb"
  tick --comment
  check "no stuck PR passes" "$status:$(ls "$fake" | grep -c '^comments' || true)" "0:0"

  rm "$fake/runs.bbb"
  tick
  check "the list names the PR whose head has no run" "$status:$out" "0:8"
  tick --comment
  check "a stuck PR fails the tick" "$status" "1"
  tick --comment
  check "and the second tick fails too" "$status" "1"
  check "the PR is commented on exactly once across two ticks" \
    "$(grep -c "$MARKER" "$fake/comments.8")" "1"
  check "the PR that has a run is left alone" "$([ -e "$fake/comments.7" ] && echo yes || echo no)" "no"

  [ "$selfFailed" -eq 0 ] || return 1
  echo "self-test passed"
}

case "${1:-}" in
  --self-test) selfTest ;;
  --comment) commentOnce ;;
  "") stuckPrs ;;
  *) echo "usage: $0 [--comment | --self-test]" >&2; exit 2 ;;
esac
