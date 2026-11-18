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
#   - the hub is production's Postgres through a role that can only SELECT
#     (PREVIEW_HUB_DATABASE_URL; docs/deploy.md has the one-time grant);
#   - the SQLite databases are `.backup` copies taken at deploy time, private to
#     this preview, so a write lands in a file `down` deletes;
#   - the tasks checkout and the audits are mounted read-only;
#   - no mail, GitHub token or ringo address is configured, and the release
#     task, the worker and the fleet relay are off (TRAILMAP_PREVIEW).
#
# Runs on the box, as a user who can run dokku, from a checkout of the PR.
set -euo pipefail

PROD_APP="${TRAILMAP_APP:-trailmap}"
PREVIEW_ROOT="${PREVIEW_ROOT:-$HOME/.trailmap-previews}"
DOMAIN_SUFFIX="${PREVIEW_DOMAIN_SUFFIX:-trailmap.deanoftech.com}"
DOKKU_HOST="${DOKKU_HOST:-dokku@localhost}"
PREVIEW_NETWORK="${PREVIEW_NETWORK:-trailmap-previews}"

die() { echo "PREVIEW FAILED: $*" >&2; exit 1; }

usage() { die "usage: $0 up <pr> <sha> | down <pr>"; }

[ $# -ge 2 ] || usage
cmd="$1" pr="$2"
[[ "$pr" =~ ^[0-9]+$ ]] || die "PR must be a number, got '$pr'"
app="$PROD_APP-pr-$pr"
data="$PREVIEW_ROOT/pr-$pr"

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

up() {
  local sha="${1:-}"
  [ -n "$sha" ] || usage
  local hubUrl="${PREVIEW_HUB_DATABASE_URL:-}"
  [ -n "$hubUrl" ] || die "PREVIEW_HUB_DATABASE_URL is not set: the read-only hub role's URL (docs/deploy.md)"

  local tasksDb tasksDir statsDb statsSyncDb auditsDir
  tasksDb="$(prodConfig TASKS_DATABASE)"
  tasksDir="$(prodConfig TASKS_DIR)"
  statsDb="$(prodConfig STATS_DB || true)"
  statsSyncDb="$(prodConfig STATS_SYNC_DB || true)"
  auditsDir="$(prodConfig AUDITS_DIR || true)"

  echo "==> snapshotting production's databases into $data"
  snapshot "$tasksDb" "$data/tasks.db"
  [ -z "$statsDb" ] || snapshot "$statsDb" "$data/stats.db"
  [ -z "$statsSyncDb" ] || snapshot "$statsSyncDb" "$data/stats-job.db"

  if ! dokku apps:exists "$app" 2>/dev/null; then
    echo "==> creating $app"
    dokku apps:create "$app"
    dokku domains:set "$app" "pr-$pr.$DOMAIN_SUFFIX"
    dokku sso:protect "$app"
    # The DIRECTORY, rw: SQLite needs its -wal and -shm beside the file. These
    # are the preview's own copies.
    dokku storage:mount "$app" "$data:$data"
    # The checkout, at the identical path production uses and READ-ONLY, so an
    # authoring or ingest commit from the preview fails instead of landing.
    dokku storage:mount "$app" "$tasksDir:$tasksDir:ro"
    # The audits, mounted exactly as production mounts them (already :ro).
    dokku storage:list "$PROD_APP" --format json 2>/dev/null |
      grep -o '"[^"]*:/audits:ro"' | tr -d '"' |
      while read -r m; do dokku storage:mount "$app" "$m"; done || true
    dokku ps:set "$app" restart-policy no
    dokku config:set --no-restart "$app" SECRET_KEY_BASE="$(openssl rand -hex 64)"
  fi

  local -a env=(
    NODE_ENV=production
    TRAILMAP_PREVIEW="$pr"
    TASKS_DIR="$tasksDir"
    TASKS_DATABASE="$data/tasks.db"
    HUB_DATABASE_URL="$hubUrl"
    AUTHELIA_DOMAIN="$(prodConfig AUTHELIA_DOMAIN || true)"
  )
  [ -z "$statsDb" ] || env+=(STATS_DB="$data/stats.db")
  [ -z "$statsSyncDb" ] || env+=(STATS_SYNC_DB="$data/stats-job.db")
  [ -z "$auditsDir" ] || env+=(AUDITS_DIR="$auditsDir")
  dokku config:set --no-restart "$app" "${env[@]}"

  # Production reaches the hub through `postgres:link`, which would also hand
  # this app the owner's credentials. A preview instead joins the network the
  # service is attached to once (docs/deploy.md), where its name resolves.
  dokku network:set "$app" attach-post-create "$PREVIEW_NETWORK"

  echo "==> deploying $sha to $app"
  # Exit status is not the verdict, for the reason scripts/deploy.sh gives (the
  # uptime-monitor plugin fails last). The probe below is.
  git push --force "$DOKKU_HOST:$app" "$sha:refs/heads/trunk" || true
  dokku ps:scale "$app" web=1 worker=0

  if ! dokku letsencrypt:active "$app" >/dev/null 2>&1; then
    dokku letsencrypt:enable "$app" || echo "==> WARNING: no TLS certificate for $app; is pr-$pr.$DOMAIN_SUFFIX in DNS?"
  fi

  local running
  running="$(docker inspect "$app.web.1" --format '{{.Config.Image}}' 2>/dev/null || true)"
  [ -n "$running" ] || die "no $app.web.1 container is running; read the push output above"
  local rev
  rev="$(dokku config:get "$app" GIT_REV || true)"
  [ "$rev" = "$sha" ] || die "$app reports GIT_REV $rev, not $sha"

  # A migration in the PR has not run anywhere a preview can see, so a page
  # that reads its column will 500. Say so instead of leaving it to be found.
  if git diff --name-only "origin/main...$sha" -- db/migrate db/hub-migrate 2>/dev/null | grep -q .; then
    echo "==> WARNING: this PR adds migrations; the preview serves production's schema, without them."
  fi

  echo "==> preview: https://pr-$pr.$DOMAIN_SUFFIX ($app at $sha)"
}

down() {
  if dokku apps:exists "$app" 2>/dev/null; then
    dokku apps:destroy "$app" --force
  fi
  rm -rf "$data"
  echo "==> $app destroyed"
}

case "$cmd" in
  up) up "${3:-}" ;;
  down) down ;;
  *) usage ;;
esac
