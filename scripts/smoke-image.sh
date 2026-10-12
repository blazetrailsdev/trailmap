#!/usr/bin/env bash
# Boot the BUILT IMAGE and ask it for a page.
#
#   docker build -t trailmap:ci . && ./scripts/smoke-image.sh trailmap:ci
#
# smoke-boot.sh proves the checkout boots. This proves the image does: a file
# `.dockerignore` kept out of the build context, a step that differs between
# the build stage and the runtime stage, a CMD that no longer starts — each
# passes every other job and fails the deploy. Both failed deploys of
# 2026-10-03 were found that way.
#
# It runs what dokku runs, in dokku's order: the Procfile's release command,
# then the image's own CMD. Everything is on a network of its own, with its own
# Postgres, and the application is reached through a published port — so
# nothing here can be answered by another trailmap already on the host.
set -euo pipefail

image="${1:?usage: smoke-image.sh <image>}"
port="${SMOKE_IMAGE_PORT:-18080}"
name="trailmap-smoke-$$"
data="$(mktemp -d)"
# The container runs as uid 1000 (see the Dockerfile); the runner may not.
chmod 777 "$data"
cleanup() {
  docker rm -f "$name" "$name-pg" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  # The database files are the container user's, so the container removes them.
  docker run --rm -v "$data":/data "$image" sh -c 'rm -rf /data/*' >/dev/null 2>&1 || true
  rmdir "$data" 2>/dev/null || true
}
trap cleanup EXIT

docker network create "$name" >/dev/null
docker run -d --name "$name-pg" --network "$name" \
  -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=trailmap_hub postgres:18 >/dev/null
for _ in $(seq 1 60); do
  if docker exec "$name-pg" pg_isready -q -h 127.0.0.1; then break; fi
  sleep 1
done

run=(docker run --network "$name" -v "$data":/data
  -e "HUB_DATABASE_URL=postgres://postgres:postgres@$name-pg:5432/trailmap_hub"
  -e TASKS_DATABASE=/data/tasks.db -e TASKS_DIR=/data
  -e SECRET_KEY_BASE=smoke-image-not-a-secret)

# The release command migrates the hub and the image's own primary. The tasks
# database is the CLI's in deployment and nothing here creates one, so the
# freshly migrated primary — the same schema, empty — is handed over as it, as
# smoke-boot.sh does.
echo "smoke-image: the release command migrates both databases"
"${run[@]}" --rm "$image" sh -c \
  'bin/trails db migrate && rm -f /data/tasks.db* && cp storage/production.sqlite3 /data/tasks.db'

echo "smoke-image: the image's own CMD"
"${run[@]}" -d --name "$name" -p "127.0.0.1:$port:8080" "$image" >/dev/null
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/up" >/dev/null 2>&1; then break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$name")" != true ]; then break; fi
  sleep 1
done
fail() {
  echo "smoke-image: $1" >&2
  docker logs --tail 40 "$name" >&2 || true
  exit 1
}

echo "smoke-image: GET /up"
curl -fsS "http://127.0.0.1:$port/up" | grep -q '"status":"ok"' || fail "/up is not green"

# The stylesheet the page links, from the runtime stage's own public/.
echo "smoke-image: GET /rfcs and its stylesheet"
page="$(curl -fsS "http://127.0.0.1:$port/rfcs")" || fail "/rfcs did not answer 200"
sheet="$(grep -oE 'href="/assets/[^"]+\.css"' <<<"$page" | head -1 | cut -d'"' -f2)"
[ -n "$sheet" ] || fail "/rfcs links no stylesheet"
curl -fsS -o /dev/null "http://127.0.0.1:$port$sheet" || fail "$sheet did not answer 200"

# A stop has to reach the server. The CMD is `bin/trails`, a wrapper around
# it, and PID 1: one that does not hand SIGTERM on is killed at the timeout
# instead, which is every deploy retiring its old container the hard way.
echo "smoke-image: docker stop is a clean exit, not a kill"
[ "$(docker inspect -f '{{.State.Running}}' "$name")" = true ] || fail "the server is no longer running"
started=$SECONDS
docker stop -t 30 "$name" >/dev/null
[ $((SECONDS - started)) -lt 15 ] || fail "the container ignored SIGTERM for $((SECONDS - started))s"

echo "smoke-image: ok"
