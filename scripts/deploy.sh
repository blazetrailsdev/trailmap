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
# anything. The image id of the running container is the only honest witness,
# so this script reads it before and after and fails loudly when it did not
# change.
#
# Runs on the box, as a user who can run dokku.
set -euo pipefail

APP="${TRAILMAP_APP:-trailmap}"
REMOTE="${TRAILMAP_REMOTE:-dokku}"
BRANCH="${TRAILMAP_BRANCH:-main}"
HOSTNAME_PUBLIC="${TRAILMAP_HOSTNAME:-trailmap.deanoftech.com}"

runningImage() {
  docker inspect "$APP.web.1" --format '{{.Image}}' 2>/dev/null || true
}

fail() {
  echo "DEPLOY FAILED: $*" >&2
  exit 1
}

before="$(runningImage)"
echo "==> running image before: ${before:-<not running>}"

# The push exits non-zero even on a successful deploy: the uptime-monitor
# plugin runs last and cannot reach Uptime Kuma on this box. So the push's exit
# status is not the verdict — the checks below are — and it is captured rather
# than left to `set -e`.
pushStatus=0
git push "$REMOTE" "$BRANCH:trunk" || pushStatus=$?
echo "==> push exited $pushStatus (non-zero is expected; see docs/deploy.md)"

after="$(runningImage)"
echo "==> running image after:  ${after:-<not running>}"

[ -n "$after" ] || fail "no $APP.web.1 container is running after the push."

if [ -n "$before" ] && [ "$before" = "$after" ]; then
  fail "the release did not replace the running container — it is still on
  $after. The build may well have succeeded; read the push output above for a
  failed release (a port collision, or a failed healthcheck). Do NOT trust
  \`dokku config:get $APP GIT_REV\`, which reports the built commit either way."
fi

# The two audiences of the one listener, checked separately, because each has
# failed on its own: SSO has come off a redeploy on sibling apps, and the JSON
# API has been 404ed by forwarding headers added in front of it.
apiStatus=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/up || true)
[ "$apiStatus" = "200" ] ||
  fail "the loopback API answered $apiStatus, not 200. A 404 here means the
  request reached the app carrying X-Forwarded-* headers and requireLoopback
  refused it; see the loopback block in nginx.conf.sigil."

publicStatus=$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Host: $HOSTNAME_PUBLIC" http://127.0.0.1/ || true)
case "$publicStatus" in
  30*) ;;
  *) fail "the public hostname answered $publicStatus instead of redirecting to
  auth — the dashboard is being served without SSO. Re-apply with
  \`dokku sso:protect $APP\` and find out why the injection did not run." ;;
esac

echo "==> deployed: $before -> $after; loopback API 200, public vhost $publicStatus."
