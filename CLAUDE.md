# trailmap — Claude guide

The task domain as a trails application. Project overview, the vendoring
mechanics, deployment and CI live in [README.md](README.md).

## A framework bug gets fixed in trails, never patched here

trailmap is the first real application built on trails, so it finds framework
bugs. **Every one of them gets fixed in trails**, in the package that owns the
behaviour, with a test there. Do not work around it in `app/`, `config/`, or a
`lib/` shim, and never edit anything under `vendor/` — those tarballs are build
output.

A workaround here fixes it for one application and leaves it broken for the
next one, for `trails new`'s own output, and for the framework's test suite,
where a passing test is the only thing that keeps it fixed. It also becomes
permanent by default: it keeps working after trails is fixed, so nothing
prompts anyone to remove it.

README's "A framework bug gets fixed in trails, never patched here" has the
loop — reproduce in trails, fix and merge there, re-vendor in its own PR,
delete the workaround. If that blocks the story you claimed, say so and stop.
An agreed temporary workaround, commented, with a story tracking its removal,
is a decision to take deliberately and never a default.

Telling the two apart is usually easy: if the fix would be identical in any
other trails app, or if it reaches into framework internals — a `private` field,
a monkey-patch, a re-implementation of something a `@blazetrails/*` package
already exports — it is a framework bug wearing an application costume.

## Framework packages are vendored

`@blazetrails/*` resolves to committed tarballs, not a registry — see README.
Two things follow:

- **The vendored build is a snapshot, and it can be behind trails `main` by
  more than you expect.** `vendor/TRAILS_PIN` records the commit, but trust it
  only as far as you have checked it: as of #9 the tarballs carried an
  `ActionView::Base.withHelpers` that the pinned commit does not have. When
  behaviour surprises you, read the code in `node_modules/@blazetrails/*`,
  which is what actually runs, and compare it against the trails checkout
  before concluding anything about "the framework".
- **Bumping is its own PR.** `scripts/vendor-trails.sh <trails-checkout> <ref>`
  then `pnpm install`, and nothing else in the same change, so a regression can
  be reverted without taking application work with it.

## Conventions

- camelCase, everywhere. No `snake_case` identifiers.
- Conventional Commits. No `Co-Authored-By` trailer, no "Generated with Claude
  Code" line.
- Open PRs as draft.
- Tests live in `test/`, mirroring `app/`. Run them with `pnpm test`;
  `pnpm build` is the typecheck.
- **`pnpm gate` is a merge condition, not a formality.** trailmap's ready queue
  is a rewrite of the CLI's ranking functions, and the gate proves the two
  produce byte-identical output over one database. A difference is a defect in
  the port, not a variance to tolerate.
- Views are `.tse` templates under `app/views`, compiled by
  `pnpm exec trails-tsc-views build --views app/views`. Rebuild after editing
  one; a stale build is a confusing failure.

## Story state lives in a database

Story _state_ — `status`, `pr`, `claim`, `assignee`, `blocked-by`,
`closed-reason` — lives in the tasks SQLite database and changes only through a
`pnpm tasks` verb (`claim`, `in-progress --pr N`, `done --pr N`, `block`,
`close`). Editing those fields in a story's markdown does nothing: ingest skips
them by design, and the tasks repo's CI fails the PR.

Story _prose_ — title, `est-loc`, `deps`, acceptance criteria — is the
opposite: edit the file and open a PR.
