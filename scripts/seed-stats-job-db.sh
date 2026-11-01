#!/usr/bin/env bash
# Seed the stats job's database from the crontab's, once (docs/deploy.md).
#
#   scripts/seed-stats-job-db.sh <source stats.db> <target stats-job.db>
#
# `.backup` is consistent while the source is in WAL and being written. The
# stamp comes from db/stats-sync-migrate, so a later migration cannot leave a
# stale literal here: an unstamped file is one `db prepare` treats as
# uninitialized, and it loads db/statsSync_schema.ts with force: cascade, which
# DROPS every table in the copy.
#
# Refuses an existing target: rerunning overwrites whatever the job has written.
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <source stats.db> <target stats-job.db>" >&2
  exit 2
fi
source_db=$1
target_db=$2
migrations="$(cd "$(dirname "$0")/.." && pwd)/db/stats-sync-migrate"

if [ ! -f "$source_db" ]; then
  echo "no source database at $source_db" >&2
  exit 1
fi
if [ -e "$target_db" ]; then
  echo "refusing to overwrite $target_db: it may hold what the job has written" >&2
  exit 1
fi

values=$(find "$migrations" -maxdepth 1 -name '[0-9]*_*.ts' -printf '%f\n' \
  | sed -E "s/^([0-9]+)_.*/('\1')/" | sort | paste -sd, -)
if [ -z "$values" ]; then
  echo "no migrations in $migrations" >&2
  exit 1
fi

# Build beside the target and rename, so a failed stamp never leaves an
# unstamped file for `db prepare` to wipe.
partial="$target_db.partial"
trap 'rm -f "$partial"' EXIT
sqlite3 -readonly "$source_db" ".backup '$partial'"
sqlite3 "$partial" "CREATE TABLE schema_migrations (version varchar NOT NULL PRIMARY KEY);
  INSERT INTO schema_migrations VALUES $values;"
mv "$partial" "$target_db"
echo "seeded $target_db, stamped: $values"
