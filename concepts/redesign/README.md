# trailmap redesign concepts

Static mockups with fake data. Nothing here is wired to the app, and every link
points at `#`; the markup is not meant to be copied into `app/` as is.

- `b-stepper-list.html`: the Fleet page redesign, and the preferred direction.
  The Fleet panels sit on top, then sessions grouped by repo and ordered by
  stage, each with a six-stage stepper. A card expands to its session log,
  message composer and details. `?open=<id>` opens one card (`?open=s3`), and
  `?search=1` shows the ⌘K palette. It has a full-bleed layout below 700px.
- `c-soil-dark.html`: a dark variant. Sessions sit in a rail grouped by stage,
  next to a detail panel.

Shared pieces: `palette.css` (tokens, the stepper, the log), `common.js`
(render helpers and stage icons) and `data.js` (sessions and per-session logs).

## Screenshots

`shoot.mjs` regenerates `screenshots/` at 1440×900 and 390×844. trailmap does
not install Playwright, so point the script at any copy of the package:

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs node concepts/redesign/shoot.mjs

Playwright's Chromium must already be installed (`npx playwright install chromium`).
