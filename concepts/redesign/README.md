# trailmap redesign concepts

Static mockups with fake data. Nothing here is wired to the app, and every link
points at `#`; the markup is not meant to be copied into `app/` as is.

- `b-stepper-list.html`: the Fleet page redesign, and the preferred direction.
  The Fleet panels sit on top, then sessions grouped by repo and ordered by
  stage, each with a six-stage stepper. A card expands to its session log,
  message composer and details. A card flags what it needs from you (a
  question, a failed check, a Merge button) and shows its stage's progress. `?open=<id>` opens one card (`?open=s3`), and
  `?search=1` shows the ⌘K palette. It has a full-bleed layout below 700px.
- `c-soil-dark.html`: a dark variant. Sessions sit in a rail grouped by stage,
  next to a detail panel.

Shared pieces: `palette.css` (tokens, the stepper, the log), `common.js`
(render helpers and stage icons) and `data.js` (sessions and per-session logs).

## Screenshots

`shoot.mjs` writes every concept and state to `screenshots/` (gitignored, or
`SHOTS_DIR`) at 1440×900 and 390×844. At 390px it checks that `innerWidth` is
390 and `scrollWidth` does not exceed it in every state, and exits 1 if not.
The PR's copies live on the `screenshots/pr-136` branch, outside the diff.

trailmap does not install Playwright, so point the script at any copy of it,
with its Chromium installed (`npx playwright install chromium`):

    PLAYWRIGHT_PATH=/path/to/node_modules/playwright/index.mjs node concepts/redesign/shoot.mjs

The fonts load from Google Fonts. Offline, the pages fall back to system
fonts, and the screenshots will not match.
