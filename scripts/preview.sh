#!/usr/bin/env bash
# A PR preview app: one dokku app per labelled PR, built from its head and
# serving COPIES of production's data. docs/deploy.md, "Preview apps", has the
# design; btwhooks runs this on a `preview` label, a push to a labelled PR, and
# the label coming off or the PR closing.
#
#   scripts/preview.sh up   <pr> <sha>    create or redeploy trailmap-pr-<pr>
#   scripts/preview.sh down <pr>          destroy it and its data copies
#
# Read-only by construction, never by trusting the PR's code:
#   - the hub is a dokku postgres service of its own, cloned from production's
#     with `postgres:export | postgres:import` at each deploy, so the release
#     task runs the PR's migrations against real data and production's hub is
#     only ever read by pg_dump;
#   - the SQLite databases are `.backup` copies taken at deploy time, private to
#     this preview, so a write lands in a file `down` deletes;
#   - the tasks checkout and the audits are mounted read-only;
#   - the clone's `settings` table is emptied after import: it is where an
#     operator points trailmap at something outside itself (today, ringo), and
#     every outbound call the application makes resolves through it;
#   - no mail, GitHub token or RINGO_BASE is configured, and the worker, which
#     alone runs jobs (and so mail), is scaled to 0.
#
# Runs on the box, as a user who can run dokku, from a checkout of the PR.
set -euo pipefail

# NOT configurable, unlike deploy.sh's TRAILMAP_APP: nginx.conf.sigil emits the
# loopback API for the app named exactly this, and a preview of any other name
# is told apart from production by that name alone.
PROD_APP=trailmap
PREVIEW_ROOT="${PREVIEW_ROOT:-$HOME/.trailmap-previews}"
DOMAIN_SUFFIX="${PREVIEW_DOMAIN_SUFFIX:-trailmap.deanoftech.com}"
DOKKU_HOST="${DOKKU_HOST:-dokku@localhost}"
PROD_HUB="${TRAILMAP_HUB:-trailmap-hub}"

die() { echo "PREVIEW FAILED: $*" >&2; exit 1; }

usage() { die "usage: $0 up <pr> <sha> | down <pr>"; }

[ $# -ge 2 ] || usage
cmd="$1" pr="$2"
[[ "$pr" =~ ^[0-9]+$ ]] || die "PR must be a number, got '$pr'"
app="$PROD_APP-pr-$pr"
data="$PREVIEW_ROOT/pr-$pr"
# The path reaches a sqlite dot-command and dokku's mount syntax, neither of
# which quotes: refuse what would need quoting rather than escape it.
[[ "$data" =~ ^[A-Za-z0-9_./-]+$ ]] || die "PREVIEW_ROOT must be a plain path, got '$PREVIEW_ROOT'"
hub="$app-hub"

prodConfig() { dokku config:get "$PROD_APP" "$1"; }

# `.backup` rather than `cp`: production's databases are live WAL files, and
# a copy of the main file alone can miss committed pages still in the WAL.
snapshot() {
  local from="$1" to="$2"
  [ -f "$from" ] || die "$from does not exist"
  mkdir -p "$(dirname "$to")"
  rm -f "$to" "$to-wal" "$to-shm"
  sqlite3 -readonly "$from" ".backup '$to'"
}

# Empty the clone's `settings`, the table that points trailmap outside itself.
scrubSettings() { echo "DELETE FROM settings;" | dokku postgres:connect "$hub"; }

up() {
  local sha="${1:-}"
  [ -n "$sha" ] || usage
  local tasksDb tasksDir statsDb statsSyncDb auditsDir
  tasksDb="$(prodConfig TASKS_DATABASE)"
  tasksDir="$(prodConfig TASKS_DIR)"
  statsDb="$(prodConfig STATS_DB || true)"
  statsSyncDb="$(prodConfig STATS_SYNC_DB || true)"
  auditsDir="$(prodConfig AUDITS_DIR || true)"

  echo "==> snapshotting production's databases into $data"
  snapshot "$tasksDb" "$data/tasks.db"
  [ -z "$statsDb" ] || snapshot "$statsDb" "$data/stats.db"
  [ -z "$statsSyncDb" ] || snapshot "$statsSyncDb" "$data/stats-sync.db"

  # A fresh clone on every deploy, so each push migrates from production's
  # schema rather than from the last push's, and a migration that only works
  # once is caught. Destroyed and re-created rather than imported over: an
  # import into a database that already holds the tables fails on them.
  echo "==> cloning $PROD_HUB into $hub"
  if dokku postgres:exists "$hub" 2>/dev/null; then
    # Stopped first, so the old container does not serve errors against a
    # database that is gone until the push replaces it.
    dokku ps:stop "$app" 2>/dev/null || true
    dokku postgres:unlink "$hub" "$app" 2>/dev/null || true
    dokku postgres:destroy "$hub" --force
  fi
  dokku postgres:create "$hub"
  dokku postgres:export "$PROD_HUB" | dokku postgres:import "$hub"
  scrubSettings

  if ! dokku apps:exists "$app" 2>/dev/null; then
    echo "==> creating $app"
    dokku apps:create "$app"
    dokku domains:set "$app" "pr-$pr.$DOMAIN_SUFFIX"
    dokku sso:protect "$app"
    dokku ps:set "$app" restart-policy no
    dokku config:set --no-restart "$app" SECRET_KEY_BASE="$(openssl rand -hex 64)"
  fi

  # Mounts are re-derived from production on EVERY up, so a preview follows a
  # moved checkout or audits directory instead of keeping the old path while
  # its environment names the new one.
  local -a mounts=(
    # The DIRECTORY, rw: SQLite needs its -wal and -shm beside the file. These
    # are the preview's own copies.
    "$data:$data"
    # The checkout, at the identical path production uses and READ-ONLY, so an
    # authoring or ingest commit (and so rfc-status's push) fails here.
    "$tasksDir:$tasksDir:ro"
  )
  local audits
  audits="$(dokku storage:list "$PROD_APP" | awk '$1 ~ /:\/audits(:ro)?$/ {print $1}')"
  [ -z "$audits" ] || mounts+=("${audits%:ro}:ro")
  local current m
  current="$(dokku storage:list "$app" | awk 'NR > 1 {print $1}')"
  while read -r m; do
    [ -z "$m" ] || dokku storage:unmount "$app" "$m"
  done <<<"$current"
  for m in "${mounts[@]}"; do dokku storage:mount "$app" "$m"; done

  local -a env=(
    NODE_ENV=production
    TRAILMAP_PREVIEW="$pr"
    TASKS_DIR="$tasksDir"
    TASKS_DATABASE="$data/tasks.db"
    AUTHELIA_DOMAIN="$(prodConfig AUTHELIA_DOMAIN || true)"
  )
  [ -z "$statsDb" ] || env+=(STATS_DB="$data/stats.db")
  [ -z "$statsSyncDb" ] || env+=(STATS_SYNC_DB="$data/stats-sync.db")
  [ -z "$auditsDir" ] || env+=(AUDITS_DIR="$auditsDir")
  dokku config:set --no-restart "$app" "${env[@]}"

  # Linked as production's is, under the same alias. `--no-restart`: the push
  # below starts the app, and its release task migrates this clone.
  dokku postgres:link "$hub" "$app" --alias HUB_DATABASE --no-restart

  echo "==> deploying $sha to $app"
  # Exit status is not the verdict, for the reason scripts/deploy.sh gives (the
  # uptime-monitor plugin fails last). The probe below is.
  git push --force "$DOKKU_HOST:$app" "$sha:refs/heads/trunk" || true
  dokku ps:scale "$app" web=1 worker=0

  # AGAIN, after the release task: the PR's own migrations ran on the clone in
  # between, and one that seeds a `settings` row (ringo_base, say) would re-arm
  # it. Setting caches a row for 10 s, so a freshly booted preview stops seeing
  # it within that. Then asserted, because a preview that still points outside
  # itself is stopped rather than left serving. (The preview is not on the
  # `fleet` network either, so `btwhooks.web` does not resolve from it.)
  scrubSettings
  local left
  left="$(echo "SELECT count(*) FROM settings;" | dokku postgres:connect "$hub" | awk '/^ *[0-9]+ *$/ {print $1; exit}')"
  if [ "$left" != "0" ]; then
    dokku ps:stop "$app" || true
    die "$hub still holds $left settings row(s) after the scrub; $app stopped"
  fi

  if ! dokku letsencrypt:active "$app" >/dev/null 2>&1; then
    dokku letsencrypt:enable "$app" || echo "==> WARNING: no TLS certificate for $app; is pr-$pr.$DOMAIN_SUFFIX in DNS?"
  fi

  local running
  running="$(docker inspect "$app.web.1" --format '{{.Config.Image}}' 2>/dev/null || true)"
  [ -n "$running" ] || die "no $app.web.1 container is running; read the push output above"
  local rev
  rev="$(dokku config:get "$app" GIT_REV || true)"
  [ "$rev" = "$sha" ] || die "$app reports GIT_REV $rev, not $sha"

  echo "==> preview: https://pr-$pr.$DOMAIN_SUFFIX ($app at $sha)"
}

down() {
  if dokku apps:exists "$app" 2>/dev/null; then
    dokku apps:destroy "$app" --force
  fi
  if dokku postgres:exists "$hub" 2>/dev/null; then
    dokku postgres:destroy "$hub" --force
  fi
  rm -rf "$data"
  echo "==> $app destroyed"
}

case "$cmd" in
  up) up "${3:-}" ;;
  down) down ;;
  *) usage ;;
esac
