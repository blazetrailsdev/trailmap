# trailmap redesign concepts

Static mockups with fake data. Nothing here is wired to the app, and every link
points at `#`; the markup is not meant to be copied into `app/` as is.

- `b-stepper-list.html`: the dashboard, redesigned from the Fleet page, with no
  page title. The Usage and Loop panels sit on top; the CI fixer is a marked,
  labeled session row, first in its repo. Below the panels come the sessions,
  grouped by repo and ordered by stage, each with a six-stage stepper. A card
  expands to its session log, message composer and details. A session's
  question is answered in its own row (options, or a free answer); a row also
  flags a failed check, offers Merge and shows its stage's progress. A session
  whose agent is idle short of the next stage is stalled: its row shows the
  evidence and one button that prods it on ("Mark it ready?"); `?filter=needs`
  keeps only those cards. `?open=<id>` opens one card (`?open=s3`), and
  `?search=1` shows the ⌘K palette. It has a full-bleed layout below 700px. ⌘K
  is the only shortcut, and it means search: Broadcast and Spawn are buttons
  with no key of their own, and are also rows in the palette. No key is wired
  in the mockup, ⌘K included.

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
