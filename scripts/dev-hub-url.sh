#!/usr/bin/env bash
# Print a host-reachable URL for the dev hub Postgres (trailmap-hub-dev).
#
# `dokku postgres:info --dsn` names the host `dokku-postgres-trailmap-hub-dev`,
# which resolves only inside dokku's docker network. This swaps it for the
# container's IP, which the host can reach, so a host boot and the hub tests
# connect without `dokku postgres:expose` publishing the port.
#
#   scripts/dev-hub-url.sh          the dev hub (HUB_DATABASE_URL)
#   scripts/dev-hub-url.sh --test   a `trailmap_hub_test` database beside it
#                                   (HUB_TEST_DATABASE_URL), created if missing
set -euo pipefail
service=trailmap-hub-dev
dsn="$(dokku postgres:info "$service" --dsn)"
ip="$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' "dokku.postgres.$service")"
url="$(sed -E "s#@[^:/]+:#@${ip}:#" <<<"$dsn")"
if [[ "${1:-}" == "--test" ]]; then
  if ! dokku postgres:connect "$service" <<<"SELECT 1 FROM pg_database WHERE datname = 'trailmap_hub_test'" | grep -q 1; then
    dokku postgres:connect "$service" <<<"CREATE DATABASE trailmap_hub_test" >/dev/null
  fi
  url="${url%/*}/trailmap_hub_test"
fi
printf '%s\n' "$url"
