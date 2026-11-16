#!/usr/bin/env bash
# Generate the favicon set, and the copy of the header mark the pages link,
# from the one checked-in vector, app/assets/images/mark.svg, into both apps'
# public/ directories, so the two cannot drift. Needs ImageMagick (`convert`).
# Run it after editing the SVG and commit what it writes.
set -euo pipefail

cd "$(dirname "$0")/.."
src=app/assets/images/mark.svg
for out in public rails/public; do
  cp "$src" "$out/mark.svg"
  # The raster set is drawn light-scheme, on white with a margin, as a tab shows it.
  draw() { convert -background white -density 1200 "$src" -resize "$(($1 * 3 / 4))x$(($1 * 3 / 4))" -gravity center -extent "$1x$1" "$2"; }
  draw 512 "$out/icon.png"
  draw 180 "$out/apple-touch-icon.png"
  draw 32 "$out/favicon-32x32.png"
  draw 16 "$out/favicon-16x16.png"
  convert "$out/favicon-16x16.png" "$out/favicon-32x32.png" <(draw 48 png:-) "$out/favicon.ico"
done
