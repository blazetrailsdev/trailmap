#!/usr/bin/env bash
# Deploy trailmap and PROVE the running container is the one just built.
#
# The failure this exists for: dokku's docker-local scheduler starts the new
# container before stopping the old, and for eleven merged PRs that start died
# on `Bind for 127.0.0.1:8080 failed: port is already allocated` — the fixed
# host-port publish, now replaced by the nginx block in nginx.conf.sigil. The
# build still succeeded and the image was still tagged, so the only visible
# symptom was a line in the middle of the push output, and the box quietly kept
# serving the first deploy's image.
#
# `GIT_REV` is worse than useless here: dokku sets it during the BUILD, so it
# reports the commit you just pushed whether or not the release replaced
# anything.
#
# The CONTAINER id is the honest witness, and the image id is not. A redeploy
# of an unchanged commit builds a byte-identical image, so an image-id
# comparison calls a perfectly good release a failure — which is exactly what
# it did on the first real redeploy this script was written for, reporting
# DEPLOY FAILED seconds after dokku had renamed the new container into place.
# Replacing the container is the property being checked, and only the container
# id changes every time that happens. The image is reported alongside it,
# because a new image behind an unreplaced container is the original failure.
#
# Runs on the box, as a user who can run dokku.
set -euo pipefail

APP="${TRAILMAP_APP:-trailmap}"
REMOTE="${TRAILMAP_REMOTE:-dokku}"
BRANCH="${TRAILMAP_BRANCH:-main}"
HOSTNAME_PUBLIC="${TRAILMAP_HOSTNAME:-trailmap.deanoftech.com}"
REGISTRY_IMAGE="${TRAILMAP_IMAGE:-ghcr.io/blazetrailsdev/trailmap}"
RAILS_REMOTE="${TRAILMAP_RAILS_REMOTE:-dokku-rails}"
RAILS_APP="${TRAILMAP_RAILS_APP:-trailmap-rails}"

# --from-image: deploy the image CI built and smoke-tested on main
# (.github/workflows/ci.yml, `image`), tagged with the commit, instead of
# building on the box. Without it, `git push` builds the Dockerfile here, which
# is the fallback when ghcr is unreachable or CI has not pushed the commit yet.
# --no-rails: skip redeploying the Rails twin afterwards.
fromImage=0
deployRails=1
for arg in "$@"; do
  case "$arg" in
    --from-image) fromImage=1 ;;
    --no-rails) deployRails=0 ;;
    *) echo "usage: $0 [--from-image] [--no-rails]" >&2; exit 2 ;;
  esac
done
started="$(date +%s)"

runningContainer() {
  docker inspect "$APP.web.1" --format '{{.Id}}' 2>/dev/null || true
}

runningImage() {
  docker inspect "$APP.web.1" --format '{{.Image}}' 2>/dev/null || true
}

gitRevNote=""
fail() {
  echo "DEPLOY FAILED: $*$gitRevNote" >&2
  exit 1
}

# A redeploy of the commit already deployed is a no-op for both `git push`
# ("Everything up-to-date") and `git:from-image` ("No changes detected"), so the
# container would never be replaced and the checks below would fail a good
# deploy. Rebuild instead.
alreadyAt() {
  [ "$(dokku config:get "$1" GIT_REV 2>/dev/null || true)" = "$2" ]
}

before="$(runningContainer)"
beforeImage="$(runningImage)"
echo "==> running container before: ${before:-<not running>}"
echo "==> running image before:     ${beforeImage:-<not running>}"

# The push exits non-zero even on a successful deploy: the uptime-monitor
# plugin runs last and cannot reach Uptime Kuma on this box. So the push's exit
# status is not the verdict — the checks below are — and it is captured rather
# than left to `set -e`.
# Both apps ship this one commit, origin's, whatever the local checkout holds.
git fetch origin "$BRANCH"
sha="$(git rev-parse "origin/$BRANCH")"
echo "==> deploying $sha"

pushStatus=0
if [ "$fromImage" = 1 ]; then
  docker pull "$REGISTRY_IMAGE:$sha" ||
    fail "$REGISTRY_IMAGE:$sha is not pullable. CI pushes it only after the
  image job passes on $BRANCH; wait for it, or deploy without --from-image."
  # The witness here is DEPLOYED_IMAGE, which the script sets only after a
  # from-image deploy has passed every check below; never GIT_REV, which is
  # set ahead of the release. Image ids cannot serve: git:from-image builds a
  # `FROM <image>` wrapper, so the running image is never the pulled one.
  # GIT_REV must agree too, so a deploy outside this script (a manual push of
  # another commit) makes the marker stale and the full from-image runs.
  if [ "$(dokku config:get "$APP" DEPLOYED_IMAGE 2>/dev/null || true)" = "$REGISTRY_IMAGE:$sha" ] &&
    alreadyAt "$APP" "$sha"; then
    echo "==> $APP already runs $REGISTRY_IMAGE:$sha; rebuilding it in place"
    dokku ps:rebuild "$APP" || pushStatus=$?
  else
    # git:from-image deploys from a synthetic commit, so GIT_REV would name that
    # rather than $sha; set it first so the release (and Sentry's `release`)
    # carries the trailmap commit, and put the old value back if it fails.
    oldRev="$(dokku config:get "$APP" GIT_REV 2>/dev/null || true)"
    dokku config:set --no-restart "$APP" GIT_REV="$sha"
    gitRevNote="
  NOTE: GIT_REV on $APP was set to $sha before the release, so it does not
  describe the container that is running; restore it with
  $(if [ -n "$oldRev" ]; then echo "dokku config:set --no-restart $APP GIT_REV=$oldRev"; else echo "dokku config:unset --no-restart $APP GIT_REV"; fi)"
    if ! dokku git:from-image "$APP" "$REGISTRY_IMAGE:$sha"; then
      pushStatus=1
      if [ -n "$oldRev" ]; then
        dokku config:set --no-restart "$APP" GIT_REV="$oldRev" && gitRevNote=""
      else
        dokku config:unset --no-restart "$APP" GIT_REV && gitRevNote=""
      fi
    fi
  fi
elif alreadyAt "$APP" "$sha"; then
  echo "==> $APP is already at $sha; rebuilding it in place"
  dokku ps:rebuild "$APP" || pushStatus=$?
else
  # Forced: a from-image deploy leaves that synthetic commit on dokku's trunk,
  # which a plain push would be refused as a non-fast-forward.
  git push "$REMOTE" "+$sha:refs/heads/trunk" || pushStatus=$?
fi
echo "==> deploy command exited $pushStatus (non-zero is expected; see docs/deploy.md)"

after="$(runningContainer)"
afterImage="$(runningImage)"
echo "==> running container after:  ${after:-<not running>}"
echo "==> running image after:      ${afterImage:-<not running>}"

[ -n "$after" ] || fail "no $APP.web.1 container is running after the push."

if [ -n "$before" ] && [ "$before" = "$after" ]; then
  fail "the release did not replace the running container — it is still
  $after. The build may well have succeeded; read the push output above for a
  failed release (a port collision, or a failed healthcheck). Do NOT trust
  \`dokku config:get $APP GIT_REV\`, which reports the built commit either way."
fi

if [ "$beforeImage" = "$afterImage" ]; then
  echo "==> image unchanged, which is expected when the commit is unchanged:
  the container was still replaced ($before -> $after)."
fi

# The stale-image failure, asserted directly rather than inferred from a
# before/after pair. For eleven merged PRs the box served the FIRST deploy's
# image while every later build was tagged `dokku/$APP:latest` and thrown away,
# because the release died on a port collision. What that looks like is exactly
# this: a running container whose image is not the one `latest` points at. A
# before/after comparison cannot see it — both reads return the same stale
# image and agree — so the tag is the witness, and it holds on every deploy
# rather than only across the one transition off that first image.
latestImage="$(docker inspect "dokku/$APP:latest" --format '{{.Id}}' 2>/dev/null || true)"
echo "==> dokku/$APP:latest is:      ${latestImage:-<no such image>}"
if [ -n "$latestImage" ] && [ "$latestImage" != "$afterImage" ]; then
  fail "the running container is on $afterImage, but dokku/$APP:latest is
  $latestImage. The build produced an image the release never started — the
  box is serving a STALE image. This is the failure that left eleven merged
  PRs unshipped; read the push output above for the release error."
fi

# The two audiences of the one listener, checked separately, because each has
# failed on its own: SSO has come off a redeploy on sibling apps, and the JSON
# API has been 404ed by forwarding headers added in front of it.
#
# Those assertions live in smoke-prod.sh now, as tiers 0 and 1, so that they
# also run between deploys (RFC 0143). The gate here is "tiers 0 and 1 pass":
# /up on loopback, /up/ready and its migration head, /stories/ready answering
# 200 rather than requireLoopback's 404, and the public vhost answering 30*.
# Each failure is printed there by name with what to do about it.
smoke="$(TRAILMAP_HOSTNAME="$HOSTNAME_PUBLIC" "$(dirname "$0")/smoke-prod.sh" --tier 0 --tier 1)" ||
  fail "the release is running and did not pass the smoke suite:
$smoke"
echo "$smoke"

# The box is the only machine with a btwhooks checkout, so it is the only place
# the vendored ringo snapshot can be checked for staleness (CI cannot see
# btwhooks at all). A warning, never a failure: bumping the pin is its own PR.
(cd "$(dirname "$0")/.." && pnpm ringo:pin) || true

# Recorded only now, after the checks: the next --from-image run trusts it.
if [ "$fromImage" = 1 ]; then
  dokku config:set --no-restart "$APP" DEPLOYED_IMAGE="$REGISTRY_IMAGE:$sha"
else
  dokku config:unset --no-restart "$APP" DEPLOYED_IMAGE >/dev/null 2>&1 || true
fi

echo "==> deployed: $before -> $after in $(( $(date +%s) - started ))s; smoke tiers 0 and 1 pass."

# The Rails twin follows every trailmap deploy, so the two cannot drift apart
# unnoticed (trailmap-rails once served a pre-RFC-0243 build for days and listed
# 0 audits against trailmap's 95). docs/deploy-rails.md has the app.
if [ "$deployRails" = 1 ]; then
  railsBefore="$(docker inspect "$RAILS_APP.web.1" --format '{{.Id}}' 2>/dev/null || true)"
  railsStatus=0
  if alreadyAt "$RAILS_APP" "$sha"; then
    echo "==> $RAILS_APP is already at $sha; rebuilding it in place"
    dokku ps:rebuild "$RAILS_APP" || railsStatus=$?
  else
    git push "$RAILS_REMOTE" "+$sha:refs/heads/trunk" || railsStatus=$?
  fi
  echo "==> $RAILS_APP deploy command exited $railsStatus (non-zero is expected; see docs/deploy.md)"
  railsAfter="$(docker inspect "$RAILS_APP.web.1" --format '{{.Id}}' 2>/dev/null || true)"
  [ -n "$railsAfter" ] && [ "$railsBefore" != "$railsAfter" ] ||
    fail "trailmap is deployed, but $RAILS_APP.web.1 was not replaced
  (${railsBefore:-<none>} -> ${railsAfter:-<none>}); the twin is stale. Read the
  push output above."
  railsImage="$(docker inspect "$RAILS_APP.web.1" --format '{{.Image}}')"
  railsLatest="$(docker inspect "dokku/$RAILS_APP:latest" --format '{{.Id}}' 2>/dev/null || true)"
  [ -z "$railsLatest" ] || [ "$railsLatest" = "$railsImage" ] ||
    fail "$RAILS_APP.web.1 runs $railsImage but dokku/$RAILS_APP:latest is
  $railsLatest: the twin is serving a STALE image."
  echo "==> $RAILS_APP redeployed at $sha: $railsBefore -> $railsAfter"
fi
