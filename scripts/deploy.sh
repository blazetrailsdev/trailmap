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

runningContainer() {
  docker inspect "$APP.web.1" --format '{{.Id}}' 2>/dev/null || true
}

runningImage() {
  docker inspect "$APP.web.1" --format '{{.Image}}' 2>/dev/null || true
}

fail() {
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

before="$(runningContainer)"
beforeImage="$(runningImage)"
echo "==> running container before: ${before:-<not running>}"
echo "==> running image before:     ${beforeImage:-<not running>}"

# The push exits non-zero even on a successful deploy: the uptime-monitor
# plugin runs last and cannot reach Uptime Kuma on this box. So the push's exit
# status is not the verdict — the checks below are — and it is captured rather
# than left to `set -e`.
pushStatus=0
git push "$REMOTE" "$BRANCH:trunk" || pushStatus=$?
echo "==> push exited $pushStatus (non-zero is expected; see docs/deploy.md)"

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
upStatus=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/up || true)
[ "$upStatus" = "200" ] ||
  fail "the loopback listener answered $upStatus for /up, not 200. The app is
  not reachable on 127.0.0.1:8080 at all; see the loopback block in
  nginx.conf.sigil."

# /up is UNGUARDED, so a 200 there says nothing about the thing that has
# actually broken twice: nginx setting X-Forwarded-* in front of the loopback
# block, which `requireLoopback` treats as disqualifying and answers 404 to.
# Only a guarded endpoint can prove that, so one is asked for by name.
apiStatus=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/stories/ready || true)
[ "$apiStatus" != "404" ] ||
  fail "the loopback API answered 404 for /stories/ready. That is
  requireLoopback refusing the request because it arrived carrying proxy
  provenance — nginx is setting X-Forwarded-For or X-Forwarded-Proto in front
  of the loopback \`server\` block; see nginx.conf.sigil."
[ "$apiStatus" = "200" ] || echo "==> WARNING: /stories/ready answered
  $apiStatus. It is past requireLoopback — a 404 would mean it was not — so the
  loopback bypass is intact, but the endpoint is not serving. A 500 here is
  \`ConnectionNotDefined\`: the release has no TASKS_DATABASE and no mount for
  the CLI's tasks.db, so every database-backed endpoint fails. Story
  \`mount-the-tasks-database-into-the-release\` closes this, and tightens this
  check to require 200." >&2

publicStatus=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Host: $HOSTNAME_PUBLIC" http://127.0.0.1/ || true)
case "$publicStatus" in
  30*) ;;
  *) fail "the public hostname answered $publicStatus instead of redirecting to
  auth — the dashboard is being served without SSO. Re-apply with
  \`dokku sso:protect $APP\` and find out why the injection did not run." ;;
esac

# The box is the only machine with a btwhooks checkout, so it is the only place
# the vendored ringo snapshot can be checked for staleness (CI cannot see
# btwhooks at all). A warning, never a failure: bumping the pin is its own PR.
(cd "$(dirname "$0")/.." && pnpm ringo:pin) || true

echo "==> deployed: $before -> $after; /up 200, /stories/ready $apiStatus, public vhost $publicStatus."
