#!/usr/bin/env bash
# Put the stylesheet and scripts where production serves them.
#
# Production mounts no Vite: the framework mounts it only in development, and
# NODE_ENV=production is honoured. The layout links
# /assets/stylesheets/application.css and the dashboard its scripts, so they
# have to exist under public/, where the static middleware looks. The files are
# plain CSS and JS whose only import is the relative `./fleet-format.js`, which
# is copied beside its importer, so a copy is the whole precompile.
#
# One script, run by the Dockerfile and by scripts/smoke-boot.sh, so the boot CI
# tests is laid out exactly as the image is.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p public/assets
cp -r app/assets/. public/assets/

# ringo's parity chart engine, from the pinned snapshot rather than from
# app/assets, because it is GENERATED (scripts/vendor-ringo.sh) and
# vendor/ringo is where this repo keeps vendored ringo code under its PIN and
# SHA256 manifest. Copied rather than committed under app/assets so there is
# one copy to go stale, and served as real files rather than inlined because
# trailmap's pages carry no inline JavaScript.
mkdir -p public/assets/stylesheets public/assets/javascripts
cp vendor/ringo/parity.css public/assets/stylesheets/ringo-parity.css
cp vendor/ringo/parity-draw.js public/assets/javascripts/ringo-parity.js

# Digest-stamp every asset, so production can serve them under a year-long
# cache header (config/environments/production.ts): a deploy's changed file is
# a new name, never a stale cached one. The names go in the manifest trails'
# `computeAssetPath` reads, so `stylesheetLinkTag` and `javascriptPath` link
# them. A script's relative imports are rewritten to the digested names first,
# so a changed fleet-format.js also renames every script that imports it:
# a file is stamped only once everything it imports has been.
mkdir -p public/assets/.vite
declare -A digested=()
pending="$(cd public/assets && find stylesheets javascripts -type f \( -name '*.css' -o -name '*.js' \) ! -name '*-????????????????.*' | sort)"
while [ -n "$pending" ]; do
  left=""
  for logical in $pending; do
    file="public/assets/$logical" ready=1
    for dep in $(grep -oE "from \"\./[^\"]+\"" "$file" | cut -d'"' -f2 | cut -c3- || true); do
      depLogical="$(dirname "$logical")/$dep"
      if [ -z "${digested[$depLogical]:-}" ]; then ready=0; break; fi
      sed -i "s|from \"\./$dep\"|from \"./$(basename "${digested[$depLogical]}")\"|" "$file"
    done
    if [ "$ready" = 0 ]; then left+="$logical"$'\n'; continue; fi
    hash="$(sha256sum "$file" | cut -c1-16)"
    stamped="${logical%.*}-$hash.${logical##*.}"
    cp "$file" "public/assets/$stamped"
    digested[$logical]="$stamped"
  done
  [ "$left" != "$pending" ] || { echo "build-assets: unresolved imports in: $left" >&2; exit 1; }
  pending="${left%$'\n'}"
done
{
  echo "{"
  first=1
  for logical in $(printf '%s\n' "${!digested[@]}" | sort); do
    [ "$first" = 1 ] || echo ","
    first=0
    printf '  "%s": { "file": "%s" }' "$logical" "${digested[$logical]}"
  done
  echo
  echo "}"
} > public/assets/.vite/manifest.json
