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
