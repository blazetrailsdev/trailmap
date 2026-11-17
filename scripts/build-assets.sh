#!/usr/bin/env bash
# Build the stylesheets and scripts production serves: `vite build`, the
# precompile.
#
# vite_rails' precompile: vite-plugin-ruby reads config/vite.json and writes
# digest-stamped files and `.vite/manifest.json` under public/vite, where the
# static middleware serves them with a year-long cache header
# (config/environments/production.ts). vite-trails' tag helpers read that
# manifest, which is how `viteStylesheetTag` and `viteAssetPath` link the
# stamped names. vite-plugin-ruby picks the config/vite.json section from
# RAILS_ENV, then RACK_ENV; both are set so an exported RAILS_ENV cannot win.
#
# One script, run by the Dockerfile and by scripts/smoke-boot.sh, so the boot CI
# tests is laid out exactly as the image is.
set -euo pipefail

cd "$(dirname "$0")/.."
RAILS_ENV=production RACK_ENV=production pnpm exec vite build --logLevel warn
