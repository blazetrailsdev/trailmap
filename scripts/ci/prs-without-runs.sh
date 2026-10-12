#!/usr/bin/env bash
# Print the number of every open PR whose head commit has had no workflow run
# and no check for longer than MINUTES (default 10).
#
#   REPO=owner/repo ./scripts/ci/prs-without-runs.sh
#
# A PR with no checks looks exactly like one whose checks have not started,
# and the review flow waits on a green that then never comes. On 2026-10-05
# GitHub delivered the `opened` event for #34 and #35 late (the run history is
# in the PR that added this script); nothing here can prevent that, so this
# notices it.
set -euo pipefail

: "${REPO:?REPO is not set}"
cutoff="$(date -u -d "${MINUTES:-10} minutes ago" +%Y-%m-%dT%H:%M:%SZ)"

# The head commit's date as well as the PR's: a push restarts the wait.
gh api --paginate "repos/$REPO/pulls?state=open&per_page=100" \
  --jq '.[] | "\(.number) \(.head.sha) \(.created_at)"' |
while read -r number sha created; do
  [[ "$created" < "$cutoff" ]] || continue
  pushed="$(gh api "repos/$REPO/commits/$sha" --jq '.commit.committer.date')"
  [[ "$pushed" < "$cutoff" ]] || continue
  runs="$(gh api "repos/$REPO/actions/runs?head_sha=$sha&per_page=1" --jq '.total_count')"
  checks="$(gh api "repos/$REPO/commits/$sha/check-runs?per_page=1" --jq '.total_count')"
  if [ "$runs" -eq 0 ] && [ "$checks" -eq 0 ]; then echo "$number"; fi
done
