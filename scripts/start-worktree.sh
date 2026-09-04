#!/usr/bin/env bash
# start-worktree.sh — spin up a fresh trailmap worktree ready to develop in.
#
# Usage: scripts/start-worktree.sh <name>
#
#   1. Creates $WORKTREES_ROOT/<name> on a new branch <name> off origin/main.
#   2. Links .claude config (skills + per-machine permissions) from main.
#   3. Runs `pnpm install`.
#   4. Provisions a per-worktree tasks checkout and puts `tasks` on PATH.
#
# Deliberately close to trails' script of the same name, because ringo invokes
# both the same way: `env WORKTREES_ROOT=<root> scripts/start-worktree.sh <slug>`
# and then cd's into "$WORKTREES_ROOT/<slug>". The contract is the path, so the
# path has to be derived identically.
#
# What this does NOT do, unlike trails': symlink fetched upstream Ruby sources.
# trailmap has no parity suite. Its equivalent — the vendored @blazetrails/*
# tarballs under vendor/ — is tracked in git, so a worktree checkout already has
# them and `pnpm install` resolves the file: overrides in pnpm-workspace.yaml
# without any cross-worktree linking.
set -euo pipefail

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "usage: scripts/start-worktree.sh <name>" >&2
  exit 2
fi

NAME="$1"
case "$NAME" in
  */*|.|..) echo "error: <name> must be a bare directory name" >&2; exit 2 ;;
esac

# Invoked from a child worktree, `--show-toplevel` returns the child (whose
# .git is a file, not a dir). Use --git-common-dir to find the shared gitdir
# and walk up one to get the main repo. Same derivation as trails'.
GIT_COMMON_DIR="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --git-common-dir)"
case "$GIT_COMMON_DIR" in
  /*) MAIN_GIT_DIR="$GIT_COMMON_DIR" ;;
  *)  MAIN_GIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && cd "$(dirname "$GIT_COMMON_DIR")" && pwd)/$(basename "$GIT_COMMON_DIR")" ;;
esac
MAIN_REPO="$(dirname "$MAIN_GIT_DIR")"

WORKTREES_ROOT="${WORKTREES_ROOT:-$HOME/github/blazetrailsdev/worktrees}"
TARGET="$WORKTREES_ROOT/$NAME"

if [[ -e "$TARGET" ]]; then
  echo "error: target already exists: $TARGET" >&2
  exit 1
fi

echo "==> Fetching origin/main at $MAIN_REPO"
# Serialize fetch + worktree add across concurrent spawns: git's ref locks and
# the packed-refs file both fail loudly when two runs race. 60s timeout so a
# crashed prior run doesn't wedge future spawns.
exec 9>"$MAIN_GIT_DIR/start-worktree.lock"
if ! flock -w 60 9; then
  echo "error: timed out waiting for the start-worktree lock" >&2
  exit 1
fi
git -C "$MAIN_REPO" fetch origin --prune

mkdir -p "$WORKTREES_ROOT"

# Branch off origin/main, not local main: the main checkout's branch may lag,
# and an ff-merge there breaks on a dirty tree or colliding untracked files.
echo "==> Creating worktree at $TARGET on new branch '$NAME' from origin/main"
git -C "$MAIN_REPO" worktree add -b "$NAME" "$TARGET" origin/main
flock -u 9
exec 9>&-

# Tear down a half-created worktree if anything below fails, so a re-run after
# fixing the cause doesn't hit "target already exists". Cleared on success.
WORKTREE_CREATED=1
cleanup_partial_worktree() {
  if [[ "${WORKTREE_CREATED:-0}" != 1 ]]; then return; fi
  echo "==> Removing partial worktree $TARGET" >&2
  if ! git -C "$MAIN_REPO" worktree remove --force "$TARGET" 2>/dev/null; then
    echo "    git worktree remove failed; falling back to rm -rf + git worktree prune" >&2
    rm -rf "$TARGET"
    git -C "$MAIN_REPO" worktree prune 2>/dev/null || true
  fi
  git -C "$MAIN_REPO" branch -D "$NAME" 2>/dev/null || true
}
trap cleanup_partial_worktree EXIT

echo "==> Linking .claude config from main worktree (skills + per-machine permissions)"
if [[ -e "$MAIN_REPO/.claude/skills" ]]; then
  mkdir -p "$TARGET/.claude"
  rm -rf "$TARGET/.claude/skills"
  ln -s "$MAIN_REPO/.claude/skills" "$TARGET/.claude/skills"
  echo "    linked .claude/skills -> $MAIN_REPO/.claude/skills"
else
  echo "    skip .claude/skills (not present in main worktree)"
fi
# settings.local.json is copied, not symlinked: claude resolves it via realpath
# and a symlink has been observed to yield a session with no permissions.
if [[ -e "$MAIN_REPO/.claude/settings.local.json" ]]; then
  mkdir -p "$TARGET/.claude"
  cp "$MAIN_REPO/.claude/settings.local.json" "$TARGET/.claude/settings.local.json"
  echo "    copied .claude/settings.local.json"
else
  echo "    skip .claude/settings.local.json (not present in main worktree)"
fi

echo "==> Running pnpm install"
( cd "$TARGET" && pnpm install )

WORKTREE_CREATED=0  # success — disable EXIT-trap cleanup

# Per-worktree tasks checkout, so concurrent agents never race a shared one.
# Best-effort throughout: on any failure the agent degrades to the canonical
# checkout, which is what bin/tasks falls back to anyway.
TASKS_CANONICAL="$HOME/github/blazetrailsdev/tasks"
TASKS_WORKTREES_ROOT="${TASKS_WORKTREES_ROOT:-$(dirname "$WORKTREES_ROOT")/tasks-worktrees}"
TASKS_WT="$TASKS_WORKTREES_ROOT/$NAME"

(
  echo "==> Provisioning per-worktree tasks checkout at $TASKS_WT"
  if [[ ! -e "$TASKS_CANONICAL/.git" ]]; then
    echo "    skip — canonical tasks repo not found at $TASKS_CANONICAL" >&2
    exit 0
  fi
  mkdir -p "$TASKS_WORKTREES_ROOT"
  # Branch tasks-<NAME> tracks origin/main; `push HEAD:main` from it always
  # lands on origin/main regardless of the branch name.
  if ! git -C "$TASKS_CANONICAL" worktree add -b "tasks-$NAME" "$TASKS_WT" origin/main 2>/dev/null; then
    echo "    warning: git worktree add for tasks failed (branch tasks-$NAME may already exist)" >&2
    exit 0
  fi
  # node_modules are required: the tasks pre-commit hook runs build-index /
  # validate / markdownlint, and a missing node_modules crashes it, leaving a
  # stale index and failing CI. Remove a broken worktree rather than use it.
  echo "==> Installing tasks worktree dependencies"
  if ! ( cd "$TASKS_WT" && pnpm install ); then
    echo "    warning: pnpm install failed — removing tasks worktree, falling back to canonical" >&2
    git -C "$TASKS_CANONICAL" worktree remove --force "$TASKS_WT" 2>/dev/null || true
    exit 0
  fi
  ln -s "$TASKS_WT" "$TARGET/tasks"
  echo "    linked tasks -> $TASKS_WT"
) || echo "    warning: tasks worktree provisioning failed — falling back to canonical $TASKS_CANONICAL" >&2

# Put `tasks` on PATH. Targets the CANONICAL checkout's bin/tasks — a
# worktree's would dangle once that worktree is removed.
if [[ -x "$TASKS_CANONICAL/scripts/install-bin.sh" ]]; then
  "$TASKS_CANONICAL/scripts/install-bin.sh" || true
fi

echo
echo "Done. New worktree:"
echo "  $TARGET"
echo "  branch: $NAME (push with: git push -u origin $NAME)"
