#!/usr/bin/env bash
# Run PENDING hub migrations through the release command, in the built image.
#
#   docker build -t trailmap:ci . && ./scripts/smoke-hub-migrate.sh trailmap:ci origin/main
#
# smoke-image.sh prepares an EMPTY hub, which db:prepare fills by loading
# db/hub_schema.ts: no migration runs at all. trailmap#180's migration failed
# every deploy's release task while CI was green, because only the real runner
# re-establishes Base on the hub (DatabaseTasks.withTemporaryPool) and its unit
# test called up() directly. This puts the hub where production's is, one or
# more migrations behind, and runs `bin/trails db:prepare` as dokku does.
#
# The hub starts just below the earliest hub migration this branch adds or
# changes against <base>, or below the latest one when it touches none, so at
# least one real migration always runs over a hub that already has tables.
set -euo pipefail

image="${1:?usage: smoke-hub-migrate.sh <image> <base-ref>}"
base="${2:?usage: smoke-hub-migrate.sh <image> <base-ref>}"
name="trailmap-hubmig-$$"
data="$(mktemp -d)"
chmod 777 "$data"
cleanup() {
  docker rm -f "$name-pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  docker run --rm -v "$data":/data "$image" sh -c 'rm -rf /data/*' >/dev/null 2>&1 || true
  rmdir "$data" 2>/dev/null || true
}
trap cleanup EXIT

versions=$(ls db/hub-migrate | sed -n 's/^\([0-9]\{14\}\)_.*/\1/p' | sort)
changed=$(git diff --name-only "$(git merge-base "$base" HEAD)" HEAD -- db/hub-migrate \
  | sed -n 's|^db/hub-migrate/\([0-9]\{14\}\)_.*|\1|p' | sort | head -1)
first="${changed:-$(echo "$versions" | tail -1)}"
start=$(echo "$versions" | awk -v f="$first" '$1 < f' | tail -1)
if [ -z "$start" ]; then
  echo "smoke-hub-migrate: no hub migration precedes $first; nothing to start from" >&2
  exit 1
fi
echo "smoke-hub-migrate: hub at $start, pending from $first"

docker network create "$name" >/dev/null
docker run -d --name "$name-pg" --network "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=trailmap_hub postgres:18 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$name-pg" pg_isready -q -h 127.0.0.1; then break; fi
  sleep 1
done
# The test environment's step below migrates a hub too; give it its own.
docker exec "$name-pg" psql -q -U postgres -c 'create database trailmap_hub_scratch'

run=(docker run --rm --network "$name" -v "$data":/data
  -e "HUB_DATABASE_URL=postgres://postgres:postgres@$name-pg:5432/trailmap_hub"
  -e TASKS_DATABASE=/data/tasks.db -e TASKS_DIR=/data
  -e SECRET_KEY_BASE=smoke-hub-migrate-not-a-secret)

# The tasks database, shaped as the CLI's: the task domain's schema, as
# smoke-image.sh hands it over.
"${run[@]}" -e NODE_ENV=test \
  -e "HUB_DATABASE_URL=postgres://postgres:postgres@$name-pg:5432/trailmap_hub_scratch" "$image" sh -c 'bin/trails db:migrate && cp storage/test.sqlite3 /data/tasks.db'

# The hub as production's stood before this branch: migrated, not loaded, by
# the image with only the migrations up to $start. Not `VERSION=`: with more
# than one database it names the one migration to run, not a target. And an
# empty schema_migrations first, or db:migrate takes the hub for a fresh one
# and loads db/hub_schema.ts, which is HEAD's.
before="$(mktemp -d)"
for v in $(echo "$versions" | awk -v s="$start" '$1 <= s'); do cp db/hub-migrate/"$v"_* "$before"/; done
chmod -R a+rX "$before"
docker exec "$name-pg" psql -q -U postgres -d trailmap_hub -c \
  'create table schema_migrations (version character varying primary key)'
"${run[@]}" -e NODE_ENV=production -v "$before":/app/db/hub-migrate:ro "$image" bin/trails db:migrate
rm -rf "$before"

was=$(docker exec "$name-pg" psql -U postgres -d trailmap_hub -tAc 'select max(version) from schema_migrations')
if [ "$was" != "$start" ]; then
  echo "smoke-hub-migrate: the hub is at $was, not $start, before the release command" >&2
  exit 1
fi
echo "smoke-hub-migrate: the release command over that hub"
"${run[@]}" -e NODE_ENV=production "$image" bin/trails db:prepare

at=$(docker exec "$name-pg" psql -U postgres -d trailmap_hub -tAc 'select max(version) from schema_migrations')
want=$(echo "$versions" | tail -1)
if [ "$at" != "$want" ]; then
  echo "smoke-hub-migrate: the hub is at $at after db:prepare, not $want" >&2
  exit 1
fi
echo "smoke-hub-migrate: ok, $start -> $at"
