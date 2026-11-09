#!/usr/bin/env bash
# Row-by-row comparison of the stats job's database with the crontab's, for the
# trial before stats-sync-cron-cutover (docs/deploy.md, "Compare before cutover").
#
#   scripts/compare-stats-dbs.sh <crontab stats.db> <job stats-job.db> [table...]
#
# For every table both files hold, over the columns both hold except `id` (each
# file numbers its own rows): the row counts, and how many rows each holds that
# the other does not. Read-only on both. Tables named after the two files are
# skipped: name the log tables, which are gigabytes, to compare the rest quickly.
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <crontab stats.db> <job stats-job.db> [skip-table...]" >&2
  exit 2
fi
cron_db=$1
job_db=$2
shift 2
skip=" $* "

q() { sqlite3 -readonly "file:$cron_db?mode=ro" "ATTACH 'file:$job_db?mode=ro' AS j; $1"; }
cols() { q "SELECT name FROM pragma_table_info('$2', '$1') ORDER BY cid"; }

printf '%-28s %10s %10s %10s %10s\n' table crontab job crontab-only job-only
for t in $(q "SELECT name FROM main.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
              INTERSECT SELECT name FROM j.sqlite_master WHERE type = 'table' ORDER BY 1"); do
  case "$skip" in *" $t "*) continue ;; esac
  shared=$(comm -12 <(cols main "$t" | sort) <(cols j "$t" | sort) | grep -vx id | sed 's/.*/"&"/' | paste -sd,)
  printf '%-28s %10s %10s %10s %10s\n' "$t" \
    "$(q "SELECT count(*) FROM main.\"$t\"")" "$(q "SELECT count(*) FROM j.\"$t\"")" \
    "$(q "SELECT count(*) FROM (SELECT $shared FROM main.\"$t\" EXCEPT SELECT $shared FROM j.\"$t\")")" \
    "$(q "SELECT count(*) FROM (SELECT $shared FROM j.\"$t\" EXCEPT SELECT $shared FROM main.\"$t\")")"
done
