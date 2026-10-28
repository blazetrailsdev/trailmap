#!/usr/bin/env bash
# track-trails.sh — follow trails main, without ever proposing a trails that
# breaks trailmap.
#
# The tasks CLI's tracker (blazetrailsdev/tasks scripts/track-trails.sh) is the
# model; the argument here is weaker. A broken trails wedges trailmap's deploy,
# not the fleet's ability to dispatch the agent who would fix it, so this is
# ordinary CD: keep a red trails main out of anything that deploys.
#
#   1. Build trails at <ref> in a tracking clone of our own — never an agent's
#      checkout, which is dirty and on some branch.
#   2. Vendor it into a SCRATCH worktree of trailmap main, install, and run
#      `pnpm smoke` (boot, migrate, render pages through the .tse pipeline, one
#      JSON endpoint). A red trails dies here, having touched nothing.
#   3. Promote: commit the bump on its own branch and open it as a draft PR.
#      CLAUDE.md makes a bump its own PR, so CI and review stand between it and
#      the deployed checkout; reverting that one commit is the rollback.
#
# The smoke is run as `bash scripts/smoke-boot.sh`, which is what `pnpm smoke`
# names: `pnpm run` puts node's own bin directory first on PATH, and on a host
# where that holds a different pnpm the smoke's install would run under it.
#
# A failure exits non-zero with the log path and a ready-to-file story body —
# a trails gap trailmap hits is supposed to become a story against trails.
#
# Usage:  scripts/track-trails.sh [<ref>]      (default origin/main)
#         TRAILS_TRACK_DRY_RUN=1 ...           verify only, open no PR
# Env:    TRAILS_TRACK_CACHE (default ~/.cache/trailmap-trails-tracker),
#         TRAILS_REMOTE, and the HUB_DATABASE_URL `pnpm smoke` needs.
# Cron:   17 */6 * * *  cd <checkout> && scripts/track-trails.sh >>~/.cache/trailmap-trails-tracker/cron.log 2>&1
set -euo pipefail

REF="${1:-origin/main}"
CACHE="${TRAILS_TRACK_CACHE:-$HOME/.cache/trailmap-trails-tracker}"
REMOTE="${TRAILS_REMOTE:-git@github.com:blazetrailsdev/trails.git}"
CLONE="$CACHE/trails"
SCRATCH="$CACHE/trailmap-candidate"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

say() { printf '==> %s\n' "$*"; }

fail() {
  local stage="$1" log="$2" body="$CACHE/story-body.md"
  cat > "$body" <<BODY
## Context

\`scripts/track-trails.sh\` refused to bump trailmap's \`vendor/TRAILS_PIN\` past
**${SHA}**: the candidate failed at stage \`${stage}\`. Nothing deployed was
touched; the pin stays where it is until this is fixed.

Full log: \`${log}\`

## Acceptance criteria

- The trails-side breakage is fixed in trails, or filed as a story there.
- \`pnpm smoke\` passes in trailmap against trails ${SHA:0:9} or later.
BODY
  printf '\n  ✗ trails tracking FAILED at %s against trails %s\n    log:  %s\n    body: %s\n\n' \
    "$stage" "${SHA:0:9}" "$log" "$body" >&2
  exit 1
}

mkdir -p "$CACHE"
[ -d "$CLONE/.git" ] || git clone --quiet "$REMOTE" "$CLONE"
git -C "$CLONE" fetch --quiet origin main
SHA="$(git -C "$CLONE" rev-parse "$REF")"
git -C "$HERE" fetch --quiet origin main
PIN="$(git -C "$HERE" show origin/main:vendor/TRAILS_PIN)"
if [ "$SHA" = "$PIN" ]; then
  say "trailmap main already pins ${SHA:0:9}"
  exit 0
fi
BRANCH="chore/track-trails-${SHA:0:9}"
if git -C "$HERE" ls-remote --exit-code --heads origin "$BRANCH" >/dev/null 2>&1; then
  say "$BRANCH is already proposed"
  exit 0
fi

LOG="$CACHE/track-$(date -u +%Y%m%dT%H%M%SZ).log"
say "trails $REF = ${SHA:0:9}, pinned ${PIN:0:9}; log: $LOG"

# vendor-trails.sh packs the WORKING TREE and refuses a ref HEAD is not on, so
# the clone is put exactly on the commit: detached, reset, cleaned.
git -C "$CLONE" checkout --quiet --detach "$SHA"
git -C "$CLONE" reset --quiet --hard "$SHA"
git -C "$CLONE" clean -qxfd -e node_modules
( cd "$CLONE" && pnpm install --frozen-lockfile && pnpm build ) >>"$LOG" 2>&1 || fail trails-build "$LOG"

git -C "$HERE" worktree remove --force "$SCRATCH" >/dev/null 2>&1 || true
rm -rf "$SCRATCH"
git -C "$HERE" worktree add --quiet -b "$BRANCH" "$SCRATCH" origin/main
# The branch outlives the worktree only once it has been pushed.
cleanup() {
  git -C "$HERE" worktree remove --force "$SCRATCH" >/dev/null 2>&1 || true
  [ -n "${PUSHED:-}" ] || git -C "$HERE" branch -D "$BRANCH" >/dev/null 2>&1 || true
}
trap cleanup EXIT

{
  "$SCRATCH/scripts/vendor-trails.sh" "$CLONE" "$SHA" \
    && ( cd "$SCRATCH" && pnpm install --prefer-offline && pnpm build && bash scripts/smoke-boot.sh )
} >>"$LOG" 2>&1 || fail candidate-smoke "$LOG"
say "candidate passed"

if [ -n "${TRAILS_TRACK_DRY_RUN:-}" ]; then
  say "dry run — no PR opened"
  exit 0
fi

git -C "$SCRATCH" add vendor package.json pnpm-lock.yaml
git -C "$SCRATCH" commit --quiet -m "chore(vendor): track trails ${SHA:0:9}

Verified by \`pnpm smoke\` in a scratch worktree by scripts/track-trails.sh.
Revert this commit to return to ${PIN:0:9}."
git -C "$SCRATCH" push --quiet origin "HEAD:refs/heads/$BRANCH"
PUSHED=1
( cd "$SCRATCH" && gh pr create --draft --head "$BRANCH" --base main \
    --title "chore(vendor): track trails ${SHA:0:9}" \
    --body "Automatic bump from ${PIN:0:9} to ${SHA:0:9}, verified by \`pnpm smoke\` in a scratch worktree. Nothing else is in this PR, so reverting it returns to the previous pin." )
say "proposed trails ${SHA:0:9} (was ${PIN:0:9})"
