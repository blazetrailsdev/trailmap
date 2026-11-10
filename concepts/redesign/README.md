# trailmap redesign concepts

Static mockups with fake data (`data.js`). Nothing here is wired to the app.
Open any `.html` file directly in a browser; `?open=s3` shows the expanded state.

- `a-pipeline.html` — kanban board, one column per stage; a card opens a log drawer.
- `b-stepper-list.html` — session list, each row carrying a six-step stepper; a row expands inline.
- `c-soil-dark.html` — dark "soil" variant: stage-grouped rail plus a detail panel.

`shoot.mjs` regenerates `screenshots/` with Playwright.
