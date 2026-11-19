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
# The box's house pattern, <app>.<global vhost>: the dokku dns plugin creates
# that Route53 record itself when the app is created, so a preview needs no
# wildcard record and no DNS call of its own to get one.
domain="$app.deanoftech.com"

prodConfig() { dokku config:get "$PROD_APP" "$1"; }

# A copy-on-write clone (`cp --reflink`) taken while holding production's
# write lock: milliseconds and almost no disk for an 8.9 GB file, where
# `.backup` read every page. The lock is what makes it consistent: in WAL mode
# commits append to the -wal and checkpoints are run by committing writers, so
# with the write lock held neither file moves while both are cloned.
# BEGIN IMMEDIATE only takes the lock and ROLLBACK releases it; nothing is
# written to production, and its writers wait (busy_timeout) for the moment
# the clone takes. The clone's WAL is then checkpointed INTO THE CLONE. Off a
# reflink filesystem it falls back to `.backup`.
snapshot() {
  local from="$1" to="$2"
  [ -f "$from" ] || die "$from does not exist"
  mkdir -p "$(dirname "$to")"
  rm -f "$to" "$to-wal" "$to-shm" "$to.cloned"
  sqlite3 "$from" <<SQL >/dev/null
.timeout 15000
BEGIN IMMEDIATE;
.shell cp --reflink=always '$from' '$to' && { [ ! -f '$from-wal' ] || cp --reflink=always '$from-wal' '$to-wal'; } && touch '$to.cloned'
ROLLBACK;
SQL
  if [ -f "$to.cloned" ]; then
    rm -f "$to.cloned"
    sqlite3 "$to" "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null || die "the clone of $from will not open"
  else
    echo "==> no reflink clone of $from; copying it with .backup"
    rm -f "$to" "$to-wal" "$to-shm"
    sqlite3 -readonly "$from" ".backup '$to'"
  fi
}

# Empty the clone's `settings`, the table that points trailmap outside itself.
scrubSettings() { echo "DELETE FROM settings;" | dokku postgres:connect "$hub"; }

# What decides whether a preview's data is re-copied from production: a
# migration directory at this sha, by git tree id, one key per copy. The hub
# (with tasks.db, copied with it so the two stay from one moment) is keyed on
# db/hub-migrate; the stats database on db/stats-sync-migrate, so a PR that
# changes one never re-copies the other. Unchanged, the preview
# keeps its data (and whatever a reviewer did to it); changed, it starts again
# from production's, so the PR's migrations run on real data and never on
# the half-migrated result of an earlier push.
#
# These are the directories the release task (`db:prepare`) migrates INTO A
# COPY. `db/migrate` is not one of them: the task domain's `primary` is
# `databaseTasks: false` (config/database.ts, Rails' `database_tasks: false`),
# so `db:prepare` never touches tasks.db; that history belongs to the tasks
# CLI. The queue database is container-local, so each container builds its own.
migrationsKey() { echo "$1=$(git rev-parse --verify --quiet "$2:$1" || echo none)"; }

# THE PORT MAP, pinned on every up. A new app built from a Dockerfile that
# EXPOSEs 8080 gets dokku's default `http:8080:8080`, which renders
# `listen 8080` on every interface, and that collides with production's
# `127.0.0.1:8080` loopback API. nginx then refuses its next reload or
# restart, and production goes down. That happened, from this script, before
# this pin existed. Pinned BEFORE the push, and refused if it did not take,
# so the deploy that would render the bad listener never starts.
pinPorts() {
  local -a want=(http:80:8080)
  if dokku letsencrypt:active "$app" >/dev/null 2>&1; then want+=(https:443:8080); fi
  dokku ports:set "$app" "${want[@]}"
  local got
  got="$(dokku ports:report "$app" --ports-map)"
  [ "$(echo "$got" | tr ' ' '\n' | sort | xargs)" = "$(printf '%s\n' "${want[@]}" | sort | xargs)" ] ||
    die "$app's port map is '$got', not '${want[*]}'; refusing to deploy"
}

# After the deploy: the preview's rendered nginx config listens on 80 and 443
# only, nginx logged no [emerg] since this run started (a failed reload keeps
# the OLD config serving, so a working page proves nothing), and production's
# loopback listener is still there. Any miss tears the preview down, which
# removes its config, and fails loudly.
assertNginx() {
  local since="$1" bad="" listens emerg
  listens="$(dokku nginx:show-config "$app" | awk '$1 == "listen" {print $2}' | tr -d ';')"
  while read -r l; do
    [ -z "$l" ] && continue
    case "${l##*:}" in 80|443) ;; *) bad+="listens on $l; " ;; esac
  done <<<"$listens"
  # Fails CLOSED: a log this user cannot read is a failed check, not a pass.
  # The previous file is read too, in case the log rotated during the run.
  local log="/var/log/nginx/error.log"
  if [ ! -r "$log" ]; then
    bad+="cannot read $log (the deploying user must be in group adm); "
  else
    emerg="$(cat "$log.1" "$log" 2>/dev/null | awk -v since="$since" '($1 " " $2) >= since && /\[emerg\]/')"
    [ -z "$emerg" ] || bad+="nginx logged: $(echo "$emerg" | tail -1); "
  fi
  ss -ltn | awk '{print $4}' | grep -qx '127.0.0.1:8080' || bad+="production's 127.0.0.1:8080 listener is gone; "
  if [ -n "$bad" ]; then
    echo "==> NGINX CHECK FAILED: $bad" >&2
    echo "==> tearing $app down so its config cannot break production's" >&2
    down
    die "nginx check failed for $app: $bad check production now: scripts/smoke-prod.sh --tier 0 --tier 1"
  fi
}

# A deploy whose client went away is NOT over: killing `git push` (btwhooks
# kills a run that a newer push supersedes) leaves dokku's build running on
# the server, holding the app's lock, and it would go on to release. Tested:
# the build kept going until `builds:cancel` killed it, and the old container
# served throughout. Nothing else deploys a preview, and btwhooks runs one at a
# time per PR, so a build still running here is a superseded one. Cancelling
# it even mid-release is safe: the data keys are gone (see the push below), so
# this run re-copies whatever it touched. A no-op when nothing is running.
cancelStale() {
  if dokku apps:exists "$app" 2>/dev/null; then dokku builds:cancel "$app"; fi
}

up() {
  cancelStale
  local sha="${1:-}"
  [ -n "$sha" ] || usage
  local since
  since="$(date '+%Y/%m/%d %H:%M:%S')"
  local tasksDb tasksDir statsDb statsSyncDb auditsDir
  tasksDb="$(prodConfig TASKS_DATABASE)"
  tasksDir="$(prodConfig TASKS_DIR)"
  statsDb="$(prodConfig STATS_DB || true)"
  statsSyncDb="$(prodConfig STATS_SYNC_DB || true)"
  auditsDir="$(prodConfig AUDITS_DIR || true)"

  local hubKey statsKey hubRefresh="" statsRefresh=""
  hubKey="$(migrationsKey db/hub-migrate "$sha")"
  statsKey="$(migrationsKey db/stats-sync-migrate "$sha")"
  if ! dokku postgres:exists "$hub" 2>/dev/null || [ ! -f "$data/tasks.db" ]; then
    hubRefresh="no copy yet"
  elif [ ! -f "$data/hub.key" ]; then
    hubRefresh="the last run did not finish"
  elif [ "$(cat "$data/hub.key")" != "$hubKey" ]; then
    hubRefresh="hub migrations changed"
  fi
  if [ -n "$statsDb$statsSyncDb" ]; then
    if [ ! -f "$data/stats.db" ]; then
      statsRefresh="no copy yet"
    elif [ ! -f "$data/stats.key" ]; then
      statsRefresh="the last run did not finish"
    elif [ "$(cat "$data/stats.key")" != "$statsKey" ]; then
      statsRefresh="stats migrations changed"
    fi
  fi

  if [ -n "$hubRefresh$statsRefresh" ] && dokku apps:exists "$app" 2>/dev/null; then
    # Stopped first, so the old container does not serve errors against
    # databases that are being replaced until the push replaces it.
    dokku ps:stop "$app" || true
  fi
  if [ -n "$statsRefresh" ]; then
    echo "==> copying production's stats ($statsRefresh)"
    rm -f "$data/stats.key" "$data/migrations.key" "$data/stats-sync.db" "$data/stats-sync.db-wal" "$data/stats-sync.db-shm"
    # Production points STATS_DB and STATS_SYNC_DB at ONE file, and the
    # preview gets one copy for both, as production has. Two copies doubled
    # the copy and let the two settings drift apart, which production cannot.
    snapshot "${statsDb:-$statsSyncDb}" "$data/stats.db"
    if [ -n "$statsDb" ] && [ -n "$statsSyncDb" ] && [ "$statsDb" != "$statsSyncDb" ]; then
      snapshot "$statsSyncDb" "$data/stats-sync.db"
    fi
  elif [ -n "$statsDb$statsSyncDb" ]; then
    echo "==> keeping $app's stats: their migrations are unchanged"
  fi
  if [ -n "$hubRefresh" ]; then
    echo "==> copying production's hub and tasks ($hubRefresh)"
    rm -f "$data/hub.key" "$data/migrations.key"
    snapshot "$tasksDb" "$data/tasks.db"
    # Destroyed and re-created rather than imported over: an import into a
    # database that already holds the tables fails on them.
    if dokku postgres:exists "$hub" 2>/dev/null; then
      dokku postgres:unlink "$hub" "$app" 2>/dev/null || true
      dokku postgres:destroy "$hub" --force
    fi
    dokku postgres:create "$hub"
    dokku postgres:export "$PROD_HUB" | dokku postgres:import "$hub"
    scrubSettings
  else
    echo "==> keeping $app's hub and tasks: their migrations are unchanged"
  fi

  if ! dokku apps:exists "$app" 2>/dev/null; then
    echo "==> creating $app"
    dokku apps:create "$app"
    # Set explicitly so the name never depends on the global vhost, and so the
    # dns plugin's domain-add trigger drops any deletion still queued for this
    # name by an earlier `down` of the same PR.
    dokku domains:set "$app" "$domain"
    dokku sso:protect "$app"
    dokku ps:set "$app" restart-policy no
    dokku config:set --no-restart "$app" SECRET_KEY_BASE="$(openssl rand -hex 64)"
  fi
  pinPorts

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
  if [ -f "$data/stats-sync.db" ]; then
    env+=(STATS_SYNC_DB="$data/stats-sync.db")
  elif [ -n "$statsSyncDb" ]; then
    env+=(STATS_SYNC_DB="$data/stats.db")
  fi
  [ -z "$auditsDir" ] || env+=(AUDITS_DIR="$auditsDir")
  dokku config:set --no-restart "$app" "${env[@]}"

  # Linked as production's is, under the same alias. `--no-restart`: the push
  # below starts the app, and its release task migrates this clone.
  if ! dokku postgres:linked "$hub" "$app" >/dev/null 2>&1; then
    dokku postgres:link "$hub" "$app" --alias HUB_DATABASE --no-restart
  fi

  # The keys go BEFORE the push and come back only after a verified deploy,
  # so a run that dies or is cancelled from here on (see cancelStale) leaves
  # the next run to re-copy, never to reuse a copy that a half-run release
  # task may have migrated part-way.
  rm -f "$data/hub.key" "$data/stats.key"
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
    dokku letsencrypt:enable "$app" || echo "==> WARNING: no TLS certificate for $app; does $domain resolve?"
  fi
  # Re-pinned: a certificate adds https:443, and nothing the plugin does may
  # leave any other mapping behind.
  pinPorts
  assertNginx "$since"

  local running
  running="$(docker inspect "$app.web.1" --format '{{.Config.Image}}' 2>/dev/null || true)"
  [ -n "$running" ] || die "no $app.web.1 container is running; read the push output above"
  local rev
  rev="$(dokku config:get "$app" GIT_REV || true)"
  [ "$rev" = "$sha" ] || die "$app reports GIT_REV $rev, not $sha"

  echo "$hubKey" >"$data/hub.key"
  [ -z "$statsDb$statsSyncDb" ] || echo "$statsKey" >"$data/stats.key"
  echo "==> preview: https://$domain ($app at $sha)"
}

down() {
  cancelStale
  if dokku apps:exists "$app" 2>/dev/null; then
    dokku apps:destroy "$app" --force
  fi
  # The dns plugin only QUEUES a destroyed app's record for deletion, and
  # `dns:sync:deletions --force` would also delete every other app's queued
  # record. Delete this one record by name instead.
  if dokku dns:records:get "$domain" A >/dev/null 2>&1; then
    dokku dns:records:delete "$domain" A --force
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
