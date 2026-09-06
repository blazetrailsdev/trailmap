#!/usr/bin/env bash
# Guard nginx.conf.sigil against the two patterns the dokku sso plugin matches
# on. Both failures are silent and both take SSO off the public dashboard, so
# they cannot be left to review.
#
# The plugin's nginx-pre-reload hook re-injects Authelia's auth directives into
# the generated config on every nginx reload. It does that with two crude text
# matchers over the WHOLE file, neither of which knows what an nginx comment is:
#
#   1. A skip test: if the auth_request directive naming the Authelia endpoint
#      already appears anywhere, the hook assumes the template configured auth
#      itself and injects nothing — anywhere. A comment quoting that directive
#      to explain it therefore disables protection for the entire app. This
#      happened: the public dashboard served unauthenticated after a deploy.
#   2. An injection address: a sed match for a root-prefix location block, after
#      which the directives are inserted. A comment containing that text gets
#      the directives injected after the COMMENT, at server level, which puts
#      the loopback API behind SSO.
#
# So: describe those mechanisms in this file's comments, never spell them.
set -euo pipefail

SIGIL="$(dirname "$0")/../nginx.conf.sigil"
status=0

if grep -n 'auth_request /authelia-auth\|auth_request /outpost' "$SIGIL"; then
  echo "error: nginx.conf.sigil names the sso plugin's marker directive (lines above)." >&2
  echo "       The plugin greps for it and skips ALL injection when found, which serves" >&2
  echo "       the public dashboard with no authentication. Describe it, do not spell it." >&2
  status=1
fi

# The stock template's own root locations are expected; this counts them and
# fails on any beyond them, which is the loopback block having used the form the
# injector matches instead of the prefix form.
expected=3
found=$(grep -cE 'location[[:space:]]*/[[:space:]]*\{' "$SIGIL" || true)
if [ "$found" -ne "$expected" ]; then
  echo "error: expected $expected injector-visible root locations in nginx.conf.sigil, found $found." >&2
  echo "       The loopback API block must use the prefix form so the sso plugin cannot" >&2
  echo "       inject auth directives into it; a comment must not spell the pattern either." >&2
  grep -nE 'location[[:space:]]*/[[:space:]]*\{' "$SIGIL" >&2
  status=1
fi

[ "$status" -eq 0 ] && echo "nginx.conf.sigil: sso plugin patterns clean."
exit "$status"
