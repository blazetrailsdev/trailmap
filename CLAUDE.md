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

## Two databases, and which one a model is on

The task domain is SQLite (`ActiveRecord::Base`, the CLI's live `tasks.db`) and
the owner/repository hierarchy is **Postgres**, under `Hub`
(`app/models/hub.ts`). README has the table. Three things follow:

- **A new model picks a base class, and that is a design decision.** `Hub` for
  anything about owners, repositories or settings; `Base` for the task domain.
  Getting it wrong is not a type error — it is a model that silently queries
  the other database and fails on "no such table".
- **Nothing joins across them, and nothing can.** A page that needs both does
  two queries. The repo scope is a `where` on a string the task domain already
  carries, and `app/models/concerns/repo-scope.ts` is the only place that
  decides which repository a story belongs to. Do not re-derive that rule in a
  controller.
- **`db/migrate` is the task domain's history, `db/hub-migrate` the hub's**, and
  `pnpm db:migrate` with no `--database` flag runs both. **Never pass
  `--database hub`**: it loads `db/schema.ts` into Postgres. docs/deploy.md has
  the why; it is a trails defect, not a rule of this repo.

## Conventions

- camelCase, everywhere. No `snake_case` identifiers.
- **`app/views/` directories are kebab-case, like everything else**:
  `RfcPagesController` renders `app/views/rfc-pages/show` with no `template:`
  argument. Never add one. The spelling is the framework's own since
  trails#8670: a controller's view directory is its path in kebab-case, and
  `trails g controller` writes that directory. trailmap carries no override for
  it. Never override `controllerPath` for this: it also names the controller in
  routes, where a hyphen is illegal, and that makes every page controller
  untestable through `ActionController::TestCase`.
  `test/views/view-directory-names.test.ts` holds the rule.
- **`abstractClass` is ASSIGNED in a static block, never a class field.**
  `static abstractClass = true` shadows the library's accessor with an own data
  property, and a static data property is inherited — so every subclass reads
  `true` and `create()` raises "X is an abstract class". `app/models/hub.ts`
  has the long version.
- **Never name a model method `set<Attribute>`.** trails answers the writer
  `priority=` with a `setPriority` method when one exists, so a method by that
  name IS the attribute's setter and runs on every `new`, `create` and `update`
  that passes the attribute. The verbs are `statusSet` and `prioritySet`.
- Conventional Commits. No `Co-Authored-By` trailer, no "Generated with Claude
  Code" line.
- Open PRs as draft.
- **Every PR body carries screenshots of the pages it touches**, always — not
  only when the change is a visual one. trailmap serves pages people read; CI
  proves the code is correct, and only a picture proves the page is usable to
  a reviewer who cannot run it against the live database. Boot against the
  live tasks database, shoot every page and tab the PR changes, push the PNGs
  to a `screenshots/pr-<N>` branch (as #11 and #15 do) so binaries stay out of
  the reviewable diff, and embed them with
  `<img src=".../blob/screenshots/pr-<N>/<file>.png?raw=1" width="100%">`.
- **A phone-width shot needs a real 390px viewport.** `google-chrome
  --headless=new --window-size=390,...` lays the page out wider and crops the
  capture, so every page looks like it overflows (#36's 390px shot is that
  artefact). Use the playwright build:
  `~/.cache/ms-playwright/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell --no-sandbox --window-size=390,1400 --screenshot=<file>.png <url>`.
  `--no-sandbox` is required on the box: Ubuntu's AppArmor restricts
  unprivileged user namespaces, so without it the shell aborts with
  `No usable sandbox!` and writes no file.
  Check it before believing a picture: the page's `innerWidth` must be 390
  (`--dump-dom` of a page that prints it, or `Runtime.evaluate` over
  `--remote-debugging-port`), and an overflow is real only if
  `document.documentElement.scrollWidth` exceeds it.
- Tests live in `test/`, mirroring `app/`. Run them with `pnpm test`;
  `pnpm build` is the typecheck.
- **`pnpm gate` is a merge condition, not a formality.** trailmap's ready queue
  is a rewrite of the CLI's ranking functions, and the gate proves the two
  produce byte-identical output over one database. A difference is a defect in
  the port, not a variance to tolerate.
- Views are `.tse` templates under `app/views`, compiled by
  `pnpm views` (app views and test fixtures). Rebuild after editing one; a
  stale build is a confusing failure. It boots the initializers, so it needs
  both database variables; it is deliberately not a `prepare` hook, so
  `pnpm install` never needs a database.

## Story state lives in a database

Story _state_ — `status`, `pr`, `claim`, `assignee`, `blocked-by`,
`closed-reason` — lives in the tasks SQLite database and changes only through a
`pnpm tasks` verb (`claim`, `in-progress --pr repo#N`, `done --pr repo#N` —
e.g. `--pr trailmap#22`; a bare number is refused — `block`, `close`). Editing those fields in a story's markdown does nothing: ingest skips
them by design, and the tasks repo's CI fails the PR.

Story _prose_ — title, `est-loc`, `deps`, acceptance criteria — is the
opposite: edit the file and open a PR.
