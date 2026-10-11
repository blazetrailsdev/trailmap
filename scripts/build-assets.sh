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
