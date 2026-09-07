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

## Requirements

**Node 24 or newer.** `@blazetrails/rack` uses duplicate named capture groups
(ES2025), which throw a `SyntaxError` at import time on Node 20 and 22.

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
pnpm exec tsx node_modules/@blazetrails/trailties/bin/trails.js server
```

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

Every PR runs typecheck, the test suite, and a cold-start boot smoke test
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

It has a deadline. Once ringo's read model is deleted there is no reference
implementation left and the gate cannot run at all, so it has to be run — and
its findings fixed — before that lands.

One divergence is expected and is counted rather than failed: ringo serves its
story show page through the BACKLOG's query, which hides every story under a
closed RFC, so a permalink to finished work 404s there and renders here.

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
  controllers, then compares membership, order and every tab count. Not the
  markup — #7 gave trailmap its own status vocabulary and its tabs are links,
  and neither is a defect.
- **`gate:markdown`** renders every RFC and story body in the tasks tree
  through `app/helpers/markdown-helper.ts` and through ringo's
  `webhook/markdown.go`, and diffs. The one tolerated difference is `&#34;`
  against `&quot;` — Go's spelling of the same character — which the gate
  normalizes rather than forcing either side to change.

Both take `--self-test`, which perturbs one side and expects the gate to go
red; CI runs those too, so a gate that stopped looking cannot pass quietly.

ringo (`deanmarano/btwhooks`) has no remote for CI to clone, so its code is
**vendored** rather than checked out: `vendor/ringo/` holds the two page
scripts and the two Go functions, verbatim, at the commit in `vendor/ringo/PIN`
(`SHA256` records what was taken). Regenerate with

```sh
./scripts/vendor-ringo.sh ~/github/deanmarano/btwebooks HEAD
```

in a PR of its own, exactly as with the trails tarballs: a gate that goes red
on a bump must be revertible without taking application work with it. Both
gates verify `SHA256` before they diff anything, so a hand-edit to the snapshot
fails loudly instead of quietly making ringo agree with us.

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
