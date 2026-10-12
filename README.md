# trailmap

The task domain — RFCs, stories, the ready queue — as a trails application.

Today that domain is implemented three times: ActiveRecord models and ranking
functions in the `tasks` CLI, a republished `index.json` / `events.json`, and a
hand-written Go read model in ringo that "must reproduce `readmodel.ts`
exactly". trailmap gives it one home: an app that owns `tasks.db` and serves
both the dashboard HTML and a JSON API, with the CLI and ringo as clients.

Design and rollout live in [RFC 0136](https://ringo.deanoftech.com/rfc/0136-trailmap)
(`blazetrailsdev/tasks`, `rfcs/0136-trailmap/`).

## Status

Skeleton only. `trails new` output plus vendored framework packages, with a
root route rendering through a `.tse` template — enough to prove the stack
boots end to end. No models, no API, no pages yet.

## Two databases, two adapters

trailmap serves from two databases, and they are not the same kind:

| | `primary` | `hub` |
| --- | --- | --- |
| Adapter | sqlite3 | **postgresql** |
| Holds | the task domain — RFCs, stories, events | the owner/repository hierarchy |
| Pointed at by | `TASKS_DATABASE` (the CLI's live file) | `HUB_DATABASE_URL` |
| Migrations | `db/migrate` | `db/hub-migrate` |
| Schema | `db/schema.ts` | `db/hub_schema.ts` |
| Base class | `ActiveRecord::Base` | `Hub` (`app/models/hub.ts`) |

The hub is where `/:owner`, `/:owner/:repo` and the eight tabs under a
repository come from — the GitHub-shaped hierarchy, which deliberately deviates
from ringo, whose pages keep serving unchanged. It is also what moved
`FLEET_REPO_PATHS` and friends out of the environment and into records that can
be validated, associated and shown on a page.

**Why two adapters rather than two SQLite files.** trailmap is the proving
ground for trails, and the yield is framework API exercised. Every connection
it had ever opened was sqlite3, so the PostgreSQL adapter the vendored
`activerecord` ships had never been driven by an application. It found three
defects in its first afternoon; `docs/deploy.md` has the one that matters
operationally.

Nothing joins across the two: a query that spans them is two queries and a join
in TypeScript. Where a repo page needs both — every tab does — the repo scope is
a `where` on a string the task domain already carries, and
`app/models/concerns/repo-scope.ts` is the one place that decides it.

Set both up with:

```sh
dokku postgres:create trailmap-hub-dev                    # once, on the box

# `--dsn` names the service by its DOCKER hostname, which only resolves on the
# network the service shares with a container — not from a host checkout. Swap
# in the address the host can reach.
HUB_DEV_URL="$(dokku postgres:info trailmap-hub-dev --dsn \
  | sed "s|@dokku-postgres-trailmap-hub-dev:|@$(dokku postgres:info trailmap-hub-dev --internal-ip):|")"

HUB_DATABASE_URL="$HUB_DEV_URL" pnpm db:migrate
HUB_DATABASE_URL="$HUB_DEV_URL" pnpm db:seed
```

`pnpm db:migrate` with no `--database` flag migrates both. Do not pass one —
`docs/deploy.md` explains what `--database hub` does to a fresh database.

That is the DEVELOPMENT recipe, and it is host-side on purpose. Production is
neither: `pnpm` is not in the runtime image and the hub is migrated by a dokku
`predeploy` script. See `docs/deploy.md`.

## Requirements

**Node 24 or newer.** `@blazetrails/rack` uses duplicate named capture groups
(ES2025), which throw a `SyntaxError` at import time on Node 20 and 22.

**A Postgres database for the hub.** The suite's hub tests skip, loudly, without
`HUB_TEST_DATABASE_URL`; a booting process refuses to start without
`HUB_DATABASE_URL`.

## Framework packages are vendored, not installed

`@blazetrails/*` is unpublished, so trailmap consumes immutable tarballs packed
from a pinned trails commit:

- `vendor/*.tgz` — the packed packages, committed.
- `vendor/TRAILS_PIN` — the trails commit they were built from.
- `pnpm-workspace.yaml` — `overrides` mapping every `@blazetrails/*` to its
  tarball. These live here rather than in `package.json` because pnpm 11 only
  honours the workspace-file form.

Bumping the framework is deliberate and revertible:

```sh
./scripts/vendor-trails.sh ~/github/blazetrailsdev/trails HEAD
pnpm install
```

## A framework bug gets fixed in trails, never patched here

trailmap is the first real application built on trails, so it finds framework
bugs — that is part of what it is for. **Every one of them gets fixed in
trails.** Do not work around it in `app/`, `config/`, or a `lib/` shim, and do
not edit anything under `vendor/`.

The reason is not purity. A workaround here fixes it for exactly one
application and leaves it broken for the next one, for the generator's own
output, and for the framework's test suite — where a passing test is the only
thing that keeps it fixed. It also silently becomes permanent: the workaround
still works after the framework is fixed, so nothing ever prompts anyone to
delete it, and trailmap slowly stops being an honest test of trails.

The loop:

1. **Reproduce it against the framework**, not against trailmap. A failing test
   in the trails package that owns the behaviour is the artifact — it is what
   makes the fix reviewable and what stops the bug coming back.
2. **Fix it in trails and get that PR merged.** Deviations from Rails are cited
   at the call site there; trails' CLAUDE.md has the rules.
3. **Re-vendor**, with `scripts/vendor-trails.sh`, in a PR of its own so the
   bump is revertible on its own.
4. **Delete the workaround**, if a temporary one was ever agreed.

If trailmap is blocked while the framework PR is in review, say so and stop —
an agreed, commented, temporary workaround with a story tracking its removal is
a decision to take deliberately, not a default. Shipping the app is not worth
laundering a framework bug into application code.

`app/helpers` was the case that set this rule: helper modules were unreachable
from views, and the first attempt patched around it in trailmap's own
`ApplicationController` (#9, closed). The real defects were three, all in
trails — an ancestor link that was invisible to enumeration, a helper glob
written in Ruby's file spelling rather than TypeScript's, and an
`app/helpers` config path nothing ever read.

## Running it

```sh
pnpm install
pnpm exec trails-tsc-views build --views app/views
TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
TASKS_DIR=~/github/blazetrailsdev/tasks \
HUB_DATABASE_URL="$(dokku postgres:info trailmap-hub-dev --dsn)" \
  bin/trails server
```

Both database variables are required: each one's initializer refuses to boot
without it rather than serving pages that 500 on their first row.

## Deployment

trailmap is a dokku app: the dashboard on `trailmap.deanoftech.com` behind SSO,
the JSON API on loopback only. Deploy with `./scripts/deploy.sh` on the box,
which pushes and then proves the running container was actually replaced — the
push's own exit status cannot say so. The procedure and the post-deploy checks
are in [docs/deploy.md](docs/deploy.md).

## The loopback API and nginx

The app serves two audiences from one listener (RFC 0136): the dashboard on
`trailmap.deanoftech.com` behind Authelia, and the JSON API on
`127.0.0.1:8080` with no SSO, for the `tasks` CLI and ringo.

`nginx.conf.sigil` in this repo is how that works. It is dokku's stock template
copied verbatim, plus one appended `server` block listening on `127.0.0.1:8080`
that proxies to the same upstream and — deliberately — does **not** include
`nginx.conf.d/*.conf`. That include is where the Authelia `auth_request` lives,
so leaving it out is what makes the API unauthenticated; a port added to
dokku's ports map instead would land in the SSO'd block and answer the CLI with
a 302 to the login page.

It replaces a `-p 127.0.0.1:8080:8080` docker option that bought the same
bypass by skipping nginx. That option also made the app **undeployable**: dokku
starts the new container before stopping the old, and two containers cannot
hold one host port, so every release after the first died on
`Bind for 127.0.0.1:8080 failed: port is already allocated` — which is why the
box served the first deploy's image while eleven PRs sat merged. nginx has no
such conflict; it re-points at the new container each deploy.

Two consequences worth keeping in mind:

- **The block sets no `X-Forwarded-*` headers**, deliberately. `requireLoopback`
  refuses any request carrying proxy provenance, so adding one 404s the whole
  JSON API for the CLI and ringo while the dashboard keeps working.
  `scripts/check-nginx-sigil.sh` fails CI on it.
- **The block has no authentication at all.** Its unreachability from off-box
  is the whole of its security, so the `listen` address must stay `127.0.0.1`.
- **The template is a copy**, so a dokku upgrade can change the original
  underneath it. On upgrade, diff it against
  `/var/lib/dokku/plugins/available/nginx-vhosts/templates/nginx.conf.sigil`
  and re-apply the appended block.

## CI

Every PR runs typecheck, the test suite, the recorded show-page snapshot
(`pnpm gate:snapshot`, below), and a cold-start boot smoke test
(`scripts/smoke-boot.sh`): a clean `git archive` checkout, installed from the
vendored tarballs with no registry access, booted, and asked for a page.

It also runs **the gate** (`pnpm gate`, `scripts/equivalence.ts`): trailmap's
ready queue is a rewrite of the CLI's ranking functions, so every PR proves the
two produce the same `ready`, `next-bundle` and `list` output — byte for byte,
over one snapshot of one database. Run it against the live database with:

```sh
TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db pnpm gate
```

A difference is a defect in the port, not a variance to tolerate.

## The show-page gate

`pnpm gate` covers the ready queue. The show pages have their own, and it is
**not** a CI job: `pnpm gate:pages` (`scripts/page-equivalence.ts`) asks BOTH
ringo and trailmap for `/rfc/<id>` and `/story/<id>` for every id in the
database and compares the title, status, ordered story list with the status
each row wears, the done count and the story page's ordered dep lists.
The two render deliberately different markup — the status vocabulary, the
GitHub restyle, ringo's action sidebar — so it compares the extracted VALUES,
never the HTML.

CI cannot run it: ringo serves from a checkout and a database that exist only
on the box. Run it there, against a trailmap booted on the same data:

```sh
TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
TASKS_DIR=~/github/blazetrailsdev/tasks pnpm dev            # in one shell

TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
RINGO_BASE=http://$(docker inspect -f \
  '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' btwhooks.web.1):8080 \
TRAILMAP_BASE=http://127.0.0.1:3001 pnpm gate:pages
```

It fetches every page on both sides and takes about ten minutes over the live
database. `RINGO_BASE` has to reach ringo *without* SSO — `ringo.deanoftech.com` answers
a 302 to the login page, which the gate reports as such rather than diffing a
redirect. Every difference lands in `tmp/page-equivalence-problems.txt`; the
terminal shows the first twenty.

It has a deadline, and a quieter one than "cannot run". Once
`land-the-ringo-read-model-deletion` moves ringo's `loadIndex` onto trailmap's
own API, ringo's show pages render from data trailmap produced — and this gate
keeps running and keeps reporting EQUIVALENT while comparing trailmap against
itself. It goes circular, not red. A green check that proves nothing looks
exactly like one that proves something, so the window in which it is an
independent check closes the moment that story lands.

One divergence is expected and is counted rather than failed: ringo serves its
story show page through the BACKLOG's query, which hides every story under a
closed RFC, so a permalink to finished work 404s there and renders here.

## The recorded show-page snapshot, and when to re-record it

`pnpm gate:snapshot` (`scripts/gate-page-snapshot.ts`) is the CI half, and it
exists because of that deadline. `pnpm gate:pages --record` captured what
ringo's pages SAY — extracted facts, never HTML — for all 8,953 pages while
ringo still had its own read model, and this replays them:

```sh
pnpm gate:snapshot              # no ringo, no database, no tasks checkout
pnpm gate:snapshot --self-test  # proves it still goes red on a difference
```

Two files are written by one pass and belong together:

| file | what it holds |
| --- | --- |
| `test/fixtures/ringo-show-pages.ndjson` | ringo's facts, one page per line |
| `test/fixtures/ringo-show-pages-rows.ndjson` | the database rows they were rendered from |

The rows travel with the facts because this database never stands still. It is
under continuous agent traffic — a story moved `claimed` to `in-progress`
between the first recording and the first replay — and ingesting the tasks
content tree does not close the gap either: a tree ingested at the recording's
own commit still got 47 RFC-page facts wrong, because `status`, `assignee` and
`pr` are database-owned and reach git only when `tasks export` runs, and
because a first ingest closes an RFC whose stories are all done while an
incremental one never did. With the rows pinned, what CI proves is what the
four defects the live gate found were all about: how trailmap ORDERS, RANKS and
LABELS a fixed set of rows.

**Re-recording is deliberate, and a diff to either file is reviewed as a change
to what the pages say.** It is legitimate in exactly two cases:

- **A show page's markup changed on trailmap's side** in a way the extractors
  in `scripts/page-extract.ts` read — a class rename, a moved badge. Fix the
  extractor first; re-record only if the page now states something new.
- **A deliberate change to what a show page says** — a new fact on the page, a
  status vocabulary change. Say in the PR body which pages changed and why,
  and expect the diff to be read.

It is NOT legitimate to re-record because the gate went red and the fixture is
what stands between you and a green check. That is the defect the gate exists
to find. Re-recording also needs ringo's own read model still standing: the
recorder refuses to write anything unless the run it rides along with is
equivalent, and after `land-the-ringo-read-model-deletion` an equivalent run no
longer proves anything, so the fixture cannot honestly be regenerated at all.

## The two ringo gates in CI

The show-page gate above cannot run in CI. These two can, because they do not
need ringo RUNNING — they run ringo's code.

`pnpm gate` holds the ready queue against the CLI. Two more hold the ported
LIST pages and the markdown renderer against ringo itself, in the same CI job:

```sh
TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
  TASKS_CLI=~/github/blazetrailsdev/tasks pnpm gate:lists
TASKS_DIR=~/github/blazetrailsdev/tasks pnpm gate:markdown
```

- **`gate:lists`** paints `/rfcs` and `/backlog` twice, per tab, over one
  snapshot: once by ringo's own browser scripts and once by trailmap's
  controllers, then compares membership, order, every tab count and what each
  row SAYS — the queue position, the effective priority and packages with
  their inherited marks, est-loc, icebox, cluster, PR and assignee. Not the
  markup — #7 gave trailmap its own status vocabulary and its tabs are links,
  and neither is a defect — so the row values come out of each side's own
  markup through `scripts/page-extract.ts`, as on the show pages.
- **`gate:markdown`** renders every RFC and story body in the tasks tree
  through `app/helpers/markdown-helper.ts` and through ringo's
  `core/markdown.go`, and diffs. The one tolerated difference is `&#34;`
  against `&quot;` — Go's spelling of the same character — which the gate
  normalizes rather than forcing either side to change.

Both take `--self-test`, which perturbs one side and expects the gate to go
red; CI runs those too, so a gate that stopped looking cannot pass quietly.
`gate:lists --self-test=values` perturbs a row's inherited-priority mark
instead of dropping a row, which is what proves the value comparison — and not
just the membership one — still bites.

ringo (`deanmarano/btwhooks`) has no remote for CI to clone, so its code is
**vendored** rather than checked out: `vendor/ringo/` holds the two page
scripts and ringo's `core` Go package (`vendor/ringo/go`), verbatim, at the
commit in `vendor/ringo/PIN` (`SHA256` records what was taken). `core` is the
part of ringo that is pure computation — the markdown renderer, the pane
terminal replay, the RFC story tally — and ringo keeps it standard-library
only so it can be lifted out whole. Regenerate with

```sh
./scripts/vendor-ringo.sh ~/github/deanmarano/btwebooks HEAD
```

in a PR of its own, exactly as with the trails tarballs: a gate that goes red
on a bump must be revertible without taking application work with it. Both
gates verify `SHA256` before they diff anything, so a hand-edit to the snapshot
fails loudly instead of quietly making ringo agree with us.

The snapshot also carries **`vendor/ringo/core.wasm`**: that same `core`
package compiled for WASI, committed so the image needs no Go toolchain. It is
there so trailmap can RUN a ringo renderer instead of porting it and gating the
port — one implementation cannot drift from itself. Because the binary is what
would execute, `SHA256` is not enough for it: `scripts/build-ringo-wasm.sh
--check` rebuilds it from `vendor/ringo/go` with the Go release in
`vendor/ringo/go/.go-version` and compares bytes, and CI runs that on every PR.

`lib/ringo-core.ts` is the way in: `runRingoCore(args, stdin)` runs the module
in-process and returns its stdout, and `renderPaneLog(bytes)` is ringo's pane
terminal replay on top of it. A call blocks the event loop while it runs —
the file's header has the measured cost — so a caller serving requests must
bound its input.

`SHA256` catches an edited snapshot; it cannot catch a STALE one, where the
files are untouched and ringo has moved on — both gates then pass, green,
against a copy of the old ringo. **The alarm for that lives on the box**:
`pnpm ringo:pin` compares `vendor/ringo/PIN` against btwhooks' HEAD and names
both, and `scripts/deploy.sh` runs it on every deploy. It cannot be a CI job —
CI has no btwhooks checkout, which is why the snapshot is vendored — and it
warns rather than failing, because a bump is its own PR and a stale pin is a
prompt.

```sh
pnpm ringo:pin                       # ~/github/deanmarano/btwebooks
pnpm ringo:pin --src /path/to/btwebooks
```

Preflight scans the PR body and every commit message on the PR for Claude
attribution — the `Co-Authored-By: Claude` trailer, a "Generated with Claude
Code" line, an `@anthropic.com` address — and fails on a hit, because
squash-merge folds branch-commit trailers into `main` where the body check
cannot see them. It is scoped to `deanmarano`-authored PRs and ported from
trails' job of the same name, `scripts/ci/gh-api-retry.sh` included: without
that retry a GitHub 5xx reds a step whose name is the only thing the checks UI
shows, so an API blip reads as an attribution violation.

## The show pages need the markdown, not just the database

`/rfc/<id>` and `/story/<id>` render the document behind the record's
`file_path`. `ingest` stores that path and leaves the body in the tasks
checkout, so serving the pages needs the checkout as well as the database:

```sh
TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db \
TASKS_DIR=~/github/blazetrailsdev/tasks pnpm dev
```

`TASKS_DIR` is optional — with it unset the checkout is derived from
`TASKS_DATABASE`, which points inside it (`<checkout>/.git/tasks.db`). Set it
when the two are not arranged that way. When neither names a checkout the
pages still render their metadata and say, in place of the document, why they
could not read it.
