#!/usr/bin/env bash
# Build the stylesheets and scripts production serves: `vite build`, the
# precompile `trails new` generates (vite.config.ts has the inputs).
#
# Production mounts no Vite: the framework mounts it only in development, and
# NODE_ENV=production is honoured. So the assets have to exist under
# public/assets, where the static middleware looks, and under digest-stamped
# names only: production serves them with a year-long cache header
# (config/environments/production.ts), so a fixed name would hide a deploy's
# change behind a cached old file. `vite build` empties public/assets first,
# writes the stamped files and `.vite/manifest.json`, and trails'
# `computeAssetPath` reads that manifest at boot, which is how
# `stylesheetLinkTag` and `javascriptPath` link the stamped names.
#
# One script, run by the Dockerfile and by scripts/smoke-boot.sh, so the boot CI
# tests is laid out exactly as the image is.
set -euo pipefail

cd "$(dirname "$0")/.."
pnpm exec vite build --logLevel warn
