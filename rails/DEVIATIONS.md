# Where the trails app and the Rails app differ

Each entry is somewhere the two apps cannot be written the same way, or a
defect that porting the app turned up. ../CLAUDE.md, "`rails/` is the same site
in Rails", says what this file is for. An entry is one of three kinds:

- **trails**: trails behaves differently from Rails 8.0.2. A trails story to
  file, or one already filed.
- **app**: a defect in trailmap itself, which both frameworks reproduce.
- **language**: JavaScript and Ruby differ, and the port has to bridge it to
  produce the same output. These are permanent, and each has one helper.

`script/tandem` is the check: every path it compares must answer identically,
apart from the differences it lists in `INTENDED`.

## Found by the port (open)

### trails: `config.x` reads empty in the development server

`config/application.ts` sets `config.x.tasks.dir = env.TASKS_DIR` in the
application class's static block. Booting through `config/environment` in a
plain `tsx` process keeps the value. Under `bin/trails server` (development,
Vite, reloading on), requests read it as unset, although the process
environment carries `TASKS_DIR`. Every page then says "TASKS_DIR names no tasks
checkout", `/up/ready` fails `checkout` and `git_identity`, and search matches
titles only. Production hides the problem, because `TASKS_DATABASE` there ends
in `.git/tasks.db` and `tasksContentDir()` derives the checkout from it.

Reproduced 2026-10-26 with `TASKS_DIR` set and a `TASKS_DATABASE` that is not
`<checkout>/.git/tasks.db`. Root cause not verified. A second module instance
of the application under Vite's SSR graph is the first suspect.

### trails: a production-mode server never answered a request

`NODE_ENV=production bin/trails server -p 4101` against the same databases
logged that it was listening, then held every connection open without
answering, `/up` included. Seen once, locally, and not investigated. The
deployed image builds its assets first (`scripts/build-assets.sh`), which this
run skipped, so that is the first thing to rule out.

### app: every mutation verb refuses a request outside `test`

`ApiController` does not opt out of forgery protection, and the 8.0 defaults
turn it on. So `POST /stories/claim` from the CLI (JSON, no session, no token)
answers "Can't verify CSRF token authenticity" in development and production.
Both frameworks agree on this. The TypeScript suite does not hit it by
default, because `config/environments/test.ts` disables forgery protection,
as Rails' test environment does. It has not
mattered yet only because the CLI still writes `tasks.db` directly. The Rails
app declares `skip_forgery_protection` in `ApiController`, which is what a
Rails JSON API inside a full app does.

### trails: a concern's `before_action` method cannot be private

`LoopbackOnly` here is a concern whose `require_loopback` is `private`, and
`before_action :require_loopback` names it. trails' `beforeAction` takes no
method name (`before-action-does-not-accept-a-method-name`, RFC 0141), and
`actionMethods` counts every public prototype method as an action, so
`app/controllers/concerns/loopback-only.ts` registers the guard as a block
and keeps it off the class.

## trails differs from Rails

- **Connections.** trails opens each database from an initializer with
  `establishConnection`, because `connectsTo` resolves against
  `Base.configurations`, which trails registers only for `trails db` commands
  (`app/models/hub.ts`). Rails declares all three in `config/database.yml` and
  uses `connects_to`. `database_tasks: false` keeps `db:migrate` off the live
  tasks database and the stats database. The TypeScript app gets the same
  effect by leaving those two out of its environment config.
- **View directories and partial names.** trails spells a controller's view
  directory in kebab-case (`rfc-pages/`, trails#8670) and allows hyphens in
  partial names (`shared/_status-badge`). Rails requires a partial name to be a
  Ruby identifier, so it uses `rfc_pages/` and `shared/_status_badge`.
- **Helpers in views.** `.tse` templates cannot import, and `app/helpers` did
  not reach views in the vendored trails. So the TypeScript controllers render
  markdown and pass it in, and `_status-state` repeats `statusWord`. The ERB
  templates call helpers directly.
- **Locals and instance variables.** trails renders with explicit `locals`;
  the Rails controllers set instance variables, as Rails apps do.
- **Flat repo-tab controllers.** trails needs `RepoIssuesController` flat,
  because `controllerPath()` comes from the class name, which carries no
  module, so a namespaced controller routes under one name and looks up views
  under another. Rails would naturally use `Repos::IssuesController` with a
  `module:` scope. The Rails app keeps them flat so the two route tables
  correspond line for line.
- **`:owner` in routes.** trails writes `this.get("/:owner")` because a bare
  `":owner"` is read as a Symbol (trails#8875). Rails writes `get ":owner"`.
- **Assets.** trails serves through Vite: source paths in development, a
  manifest in production. Rails uses Propshaft, which fingerprints in every
  environment, plus an import map so the shared ES modules' relative imports
  (`./fleet-format.js`) resolve to fingerprinted files. The JS, CSS and
  vendored ringo files are the same bytes: `app/javascript/*.js`,
  `app/assets/stylesheets/application.css` and `vendor/ringo/*` are symlinks
  into the TypeScript app.

## JavaScript and Ruby differ (bridged on purpose)

- **Sort stability.** `Array#sort` is stable and Ruby's `sort` is not. Every
  port of a JS comparator sort goes through `StableSort.sort`. Without it the
  ready queue reorders ties and `pnpm gate` would fail.
- **Collation.** `String#localeCompare` is ICU collation, and `String#<=>` is
  byte order. They disagree on punctuation (`a_b` < `a-b`) and case (`a` <
  `B` < `b`). `LocaleCompare.compare` reproduces ICU's order for ASCII and for
  accented Latin letters, and `test/models/rules_test.rb` pins it against
  Node's output. Code that compares bytes in the TypeScript app (`<`, which is
  ringo's Go order) stays `<=>` here.
- **Number printing.** JavaScript prints `50`, and Ruby prints `50.0`.
  `js_num` (views) and `ParityJson.js_number` (JSON) print a whole float as an
  integer.
- **Truthiness.** `0` and `""` are falsy in JavaScript and truthy in Ruby. A
  `.tse` `if (row.estLoc)` becomes `if row.est_loc.to_i != 0`, and a string
  test becomes `.present?`.
- **Rounding.** `Math.round` rounds half toward +Infinity, and Ruby's `round`
  rounds half away from zero. `RfcProgress.js_round`.
- **Node's error text.** A missing document's message is Node's (`ENOENT: no
  such file or directory, open '…'`). `Document.node_style_message` spells
  Ruby's `Errno::ENOENT` the same way.

## Environment

- **Gem versions** match what trails vendors (`trails/vendor/<gem>/v*`): rails
  8.0.2, rack 3.1.14, minitest 5.27.0, rack-session 2.1.0, rack-test 2.2.0,
  i18n 1.14.8, rails-dom-testing 2.2.0, pg 1.5.9, bcrypt 3.1.20, msgpack 1.8.0.
  pg 1.5.9 builds from source, so it needs libpq headers (`libpq-dev`).
  `json` is held below 3, which dropped a keyword Active Support 8.0.2 passes.

### language: twin-diff body differences left on purpose (trailmap#84 report)

Each of these is ranked by twin-diff and is the same behaviour spelled the way
each language spells it; the rest of that report's list was converged.

- `Story.record_spawn`: Ruby takes `branch:`/`pane:`/`rfc:` keywords, the
  TypeScript one options object. Both write the same `detail` JSON and the
  same columns.
- `Story.find_all_or_raise` / `findAllOrThrow`: both collect EVERY missing id
  into one `VerbExit` (`ids - found` against a `Set` filter); only the name
  differs, `raise` being Ruby's verb and `throw` JavaScript's.
- `ReadModelsController#index`: `RfcJson.serialize_all` / `StoryJson.serialize_all`
  are a module per serializer; the TypeScript serializers are free functions
  (`serializeRfcs`, `serializeStories`) in one module. Same JSON.
- `views/home/index`: the empty-hub note names each app's own seed command,
  `bin/rails db:seed` and `pnpm db:seed`.
- `lib/ringo_core.rb`: ringo's `core.wasm` runs under the `wasmtime` gem, where
  `lib/ringo-core.ts` answers WASI's sixteen imports itself. Same module, same
  bytes in and out; only the host differs.
- `RfcStatus.git` / `rfc-status.ts`'s `git`: Ruby's `Open3.capture2e` takes
  an argv, so git's arguments go straight to it; ruby-compat's takes only a
  command line, so the TypeScript one passes each argument as a shell
  variable and quotes the reference. Same git commands.
- `RfcPagesController#move`: `status` is the action's name in ringo's route
  and here it is `move` on both sides; in trails an action called `status`
  shadows the controller's own response-status reader.
- `RfcPagesController#move` / `#ready_drafts`: a CLI refusal (`VerbExit` exit 1)
  answers 422 on both sides, where ringo answers 500 with the CLI's stderr
  (btwebooks `webhook/rfcs.go:1217`, `:1311`). It follows
  `MutationsController`'s mapping (exit 1 → 422, otherwise 409): a refusal is
  an answer, not a server error. The 409s for an unoffered move and for no
  drafts are ringo's (`rfcs.go:1208`, `:1305`).
