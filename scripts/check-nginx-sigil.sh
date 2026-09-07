#!/usr/bin/env bash
# Guard nginx.conf.sigil against the two ways a COMMENT in it can silently
# disable Authelia on the public dashboard. Both have happened; see PR #14.
#
# The sso plugin re-injects Authelia's auth directives into the generated nginx
# config on every reload, so protection is automatic and `sso:protect` is not a
# deploy step. The hook is /var/lib/dokku/plugins/available/sso/nginx-pre-reload
# on this box, and it uses two text matchers over the WHOLE generated file,
# neither of which knows what an nginx comment is:
#
#   1. A skip test, nginx-pre-reload:72 —
#        if grep -q 'auth_request /authelia-...|auth_request /outpost' "$NGINX_CONF"
#      — when it matches, the hook injects nothing ANYWHERE, assuming a custom
#      template configured auth itself. A comment quoting the directive reads
#      the same to grep as a real one, so it turns protection off for the whole
#      app. That is how the public dashboard came to be served unauthenticated.
#   2. An injection address, nginx-pre-reload:86 — a sed match for a root-prefix
#      location line, after which the directives are inserted. A comment
#      containing that text gets them injected after the COMMENT, at server
#      level, which puts the loopback API behind SSO.
#
# Rule 1 below is deliberately BROADER than the hook's current pattern: this
# template has no legitimate reason to contain the directive at all, and a
# superset keeps the guard honest if the plugin ever changes which endpoint it
# names. Rule 2 is structural rather than a count, so re-vendoring dokku's stock
# template on upgrade cannot silently break it. Rule 3, added with the fixed
# host port's removal, is a different hazard in the same section: a real
# directive rather than a comment, breaking the API rather than the dashboard.
set -euo pipefail

SIGIL="${SIGIL_PATH:-$(dirname "$0")/../nginx.conf.sigil}"

# The appended section starts here; everything above is dokku's stock template,
# whose own root locations are the intended injection targets.
LOOPBACK_MARKER='# ---- The loopback JSON API'

check() {
  local sigil="$1" status=0

  if grep -n 'auth_request' "$sigil"; then
    echo "error: nginx.conf.sigil names auth_request (lines above)." >&2
    echo "       The sso plugin greps the generated config for its auth directive and" >&2
    echo "       skips ALL injection when it matches — including a match inside a comment," >&2
    echo "       which serves the public dashboard unauthenticated. Describe it, never spell it." >&2
    status=1
  fi

  local marker_line
  marker_line=$(grep -n "$LOOPBACK_MARKER" "$sigil" | head -1 | cut -d: -f1 || true)
  if [ -z "$marker_line" ]; then
    echo "error: cannot find the loopback section marker ($LOOPBACK_MARKER) in $sigil." >&2
    echo "       This guard splits the file there; update the marker with the template." >&2
    return 1
  fi

  # Below the marker is our own block. Nothing there may match the injector's
  # address: not the location line (it must use the prefix form, which the
  # address does not match) and not a comment describing it.
  if tail -n "+$marker_line" "$sigil" | grep -nE 'location[[:space:]]*/[[:space:]]*\{'; then
    echo "error: the loopback section contains a line the sso plugin's injector matches" >&2
    echo "       (lines above, relative to the marker at line $marker_line)." >&2
    echo "       The API block must use the ^~ prefix form, and no comment may spell the" >&2
    echo "       pattern, or the unauthenticated API ends up behind SSO." >&2
    status=1
  fi

  # Rule 3: the loopback block must add no forwarding headers. `requireLoopback`
  # refuses any request carrying proxy provenance, so an `X-Forwarded-*` set
  # here 404s the whole JSON API — the CLI and ringo — while the public vhost
  # keeps working, which reads as "the API was deleted" rather than as an nginx
  # change. That is not a comment hazard like rules 1 and 2; it is a live
  # directive hazard, and it is checked here because the same section is the
  # only place it can appear.
  if tail -n "+$marker_line" "$sigil" | grep -niE '^[^#]*proxy_set_header[[:space:]]+X-Forwarded'; then
    echo "error: the loopback section sets an X-Forwarded-* header (lines above," >&2
    echo "       relative to the marker at line $marker_line)." >&2
    echo "       requireLoopback refuses any request carrying proxy provenance, so this" >&2
    echo "       turns the entire JSON API into a 404 for the CLI and ringo." >&2
    status=1
  fi

  return "$status"
}

# --self-test plants each regression in a copy and asserts the guard catches it,
# so the claim "this actually detects both" is checked by CI on every push
# rather than asserted in a PR description that no longer exists after merge.
if [ "${1:-}" = "--self-test" ]; then
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT
  fail=0

  for probe in 'auth_request /authelia-auth;' 'location / {'; do
    cp "$SIGIL" "$tmp/sigil"
    printf '  # a comment mentioning %s in passing\n' "$probe" >>"$tmp/sigil"
    if check "$tmp/sigil" >/dev/null 2>&1; then
      echo "self-test FAILED: a comment containing '$probe' was not caught" >&2
      fail=1
    else
      echo "self-test ok: '$probe' in a comment is caught"
    fi
  done

  # Rule 3's probe is a real directive, not a comment: the header only breaks
  # the API when nginx actually sends it, and the block's own explanation of
  # why it must not is a comment that has to keep passing.
  cp "$SIGIL" "$tmp/sigil"
  printf '    proxy_set_header X-Forwarded-For $remote_addr;\n' >>"$tmp/sigil"
  if check "$tmp/sigil" >/dev/null 2>&1; then
    echo "self-test FAILED: an X-Forwarded-For in the loopback block was not caught" >&2
    fail=1
  else
    echo "self-test ok: an X-Forwarded-* in the loopback block is caught"
  fi

  if ! check "$SIGIL" >/dev/null 2>&1; then
    echo "self-test FAILED: the committed template does not pass its own guard" >&2
    fail=1
  else
    echo "self-test ok: the committed template passes"
  fi
  exit "$fail"
fi

check "$SIGIL"
echo "nginx.conf.sigil: sso plugin patterns clean."
