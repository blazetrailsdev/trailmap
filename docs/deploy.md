# Deploying trailmap

trailmap runs as a dokku app on the same box as ringo/btwhooks and the agent
fleet. One container, one HTTP listener on `:8080`, two audiences:

| Audience | Route | Auth |
| --- | --- | --- |
| The dashboard | `https://trailmap.deanoftech.com`, via dokku's nginx | SSO (authelia) |
| The JSON API | `http://127.0.0.1:8080`, via nginx's loopback server block | none — unreachable off-box |

The API is refused on the public hostname twice over: nginx puts SSO in front
of it, and `requireLoopback`
(`app/controllers/concerns/loopback-only.ts`) rejects any request carrying
proxy provenance, so a future SSO bypass rule cannot accidentally expose it.

## First-time setup

```sh
dokku apps:create trailmap
dokku domains:set trailmap trailmap.deanoftech.com

# Authoring and ingest commit into the tasks checkout from inside the
# container, so the mount is writable and at the identical host path — the
# database and the repo must look the same from in and out of the container.
# It is the PARENT directory, not `tasks/` alone: one mount serves the tasks
# checkout and `tasks.db` beside it, and `stats.db` with its WAL sidecars
# ("The stats database" below has why a sidecar-bearing database needs its
# directory). An app set up before trailmap#71 also carries a tasks-only mount
# nested inside this one; it is redundant, and
#   dokku storage:unmount trailmap \
#     /home/dean/github/blazetrailsdev/tasks:/home/dean/github/blazetrailsdev/tasks
# removes it. `dokku storage:list trailmap` should name only this directory and
# `/audits`.
dokku storage:mount trailmap \
  /home/dean/github/blazetrailsdev:/home/dean/github/blazetrailsdev

# The JSON API's loopback listener is nginx's, from this repo's
# `nginx.conf.sigil` — there is no dokku port map entry and no docker publish
# to add. (An app created before this fix carries the old
# `-p 127.0.0.1:8080:8080` publish, which is what made it undeployable; remove
# it once with
#   dokku docker-options:remove trailmap deploy "-p 127.0.0.1:8080:8080"
# and confirm with `dokku docker-options:report trailmap`.)

# The RFC's availability decision rests on this: the fleet stops when trailmap
# is down, and the mitigation is that it comes back by itself.
dokku ps:set trailmap restart-policy on-failure:10

# The database and the checkout, at the identical host path the mount uses.
# NOT optional: nothing else in the boot path establishes a connection, so a
# container without TASKS_DATABASE comes up, answers /up green, and 500s with
# `ConnectionNotDefined` on every page that reads a row. Since
# `config/initializers/tasks-database.ts` began refusing that boot, the missing
# variable is a container that will not start instead.
dokku config:set --no-restart trailmap NODE_ENV=production \
  TASKS_DATABASE=/home/dean/github/blazetrailsdev/tasks/.git/tasks.db \
  TASKS_DIR=/home/dean/github/blazetrailsdev/tasks

# Also NOT optional. Production reads `secret_key_base` from this variable and
# there is no credentials file to fall back on. Without it the container never
# answers `/up` green, so the health check fails and dokku keeps the previous
# release. Generate it once; changing it later
# invalidates signed cookies.
dokku config:set --no-restart trailmap SECRET_KEY_BASE="$(openssl rand -hex 64)"

# The fleet page's data. trailmap relays ringo's event stream and forwards the
# page's controls, so the trailmap CONTAINER has to reach ringo's. They share a
# docker network for that, on which each is addressable by name whatever its
# container IP is this deploy. Without RINGO_BASE the fleet page loads and
# says it has no fleet data; nothing else is affected.
dokku network:create fleet
dokku network:set trailmap attach-post-deploy fleet
dokku network:set btwhooks attach-post-deploy fleet   # then restart btwhooks once
dokku config:set --no-restart trailmap RINGO_BASE=http://btwhooks.web:8080
dokku sso:protect trailmap

# THE HUB DATABASE. The owner/repository hierarchy (`/:owner`,
# `/:owner/:repo` and its eight tabs) lives in Postgres, not in the tasks
# SQLite file — see `config/database.ts` and `app/models/hub.ts`. A dokku
# postgres service, linked under an ALIAS: trailmap has no primary Postgres,
# so the stock `DATABASE_URL` name would read as if it did.
#
# Linking restarts the app, so do it when a restart is acceptable (or add
# `--no-restart` and deploy afterwards).
dokku postgres:create trailmap-hub
dokku postgres:link trailmap-hub trailmap --alias HUB_DATABASE   # → HUB_DATABASE_URL

# Then the schema and the seed rows, IN THE APP CONTAINER — see "Migrating the
# hub" below for why it cannot be run from a host checkout. NO `--database hub`.
# After this first time, deploys migrate the hub themselves (Procfile release).
dokku run trailmap bin/trails db migrate
dokku run trailmap bin/trails db seed
```

`HUB_DATABASE_URL` is as NOT optional as `TASKS_DATABASE`:
`config/initializers/hub-database.ts` refuses to boot without it, for the
reason that initializer records — a container that comes up without a
connection answers `/up` green and 500s on the first page that reads a row.

## The hub database

| | |
| --- | --- |
| Service | `dokku postgres:create trailmap-hub`, linked as `HUB_DATABASE` |
| Schema | `db/hub-migrate/*`, dumped to `db/hub_schema.ts` |
| Tables | `owners`, `repositories`, `repository_settings`, `settings` |
| Backups | `dokku postgres:export trailmap-hub > hub.dump` |

**Back it up.** Everything in the tasks database is reconstructible from the
content tree in git (`tasks ingest`); nothing in the hub is. The repository
rows can be re-seeded from `FLEET_REPO_PATHS`
(`Repository.importFleetRepos`), but the feature switches and the
application settings someone turned off by hand exist only here.

A second service for development is the same two commands with a different
name (`trailmap-hub-dev`), and `dokku postgres:info <service> --internal-ip`
is how a process on the box reaches it without exposing a port.

### Migrating the hub

**Deploys do this.** The `Procfile` declares a `release` task that runs
`db migrate` in a container built from the new image, before it serves
traffic, so a release that adds a hub table migrates on the way in. A failed
release task fails the deploy and leaves the running containers alone, so a
hub that cannot be migrated never gets a container serving pages against it.

`release` rather than `app.json`'s `scripts.dokku.predeploy`, which also
works: a predeploy container is COMMITTED back into the built image — that is
what it is for — and `db migrate` rewrites `db/schema.ts` and
`db/hub_schema.ts` as it runs, so every release would bake a schema dump into
the image. A release container's changes are discarded, which is why dokku's
deployment-tasks page names it for migrations.

To run it by hand — the first deploy, or a repair:

```sh
dokku run trailmap bin/trails db migrate   # both databases
```

**Not `pnpm db:migrate`, and not from a host checkout.** Both halves of the
obvious recipe are wrong here, and each fails differently:

- **`pnpm` is not in the runtime image.** The Dockerfile enables it with
  `corepack enable pnpm` in the BUILD stage only, and corepack's shims live
  outside `/app`, which is all the final stage copies. `dokku run trailmap
  pnpm db:migrate` therefore hands `pnpm` to the image's `node` entrypoint as
  a script path and dies with `Cannot find module '/app/pnpm'`. Call the
  binary the way `CMD` does instead.
- **The hub's hostname does not resolve on the host.** `dokku postgres:info
  trailmap-hub --dsn` prints `@dokku-postgres-trailmap-hub:5432`, a name that
  exists only on the docker network the service and the app share. A host
  checkout with that URL in its environment cannot connect at all. (For local
  work against the dev service, `dokku postgres:info <service> --internal-ip`
  gives an address the host can reach.)

Seeds are NOT part of the release task: they are first-time setup, and
`db/seeds.ts` is idempotent, so running it again is harmless.

It used to print its output TWICE, because `trails db seed` loaded the file
once per configured database. trails#8768 fixed that — Rails loads
`db/seeds.rb` once, through the seed loader — so one run is now one load. The
`db reset` and `db setup` paths always seeded once, since both narrow to
`--database primary` before fanning out.

**Never `pnpm exec trails db migrate --database hub`.** That flag narrows the
registered database configurations to the one targeted, and
`DatabaseConfigurations#isPrimary` answers "the first registered config" for
any name that is not literally `primary` — so the hub becomes primary for every
schema question inside the command, and a FRESH hub database gets `db/schema.ts`
— the task domain's SQLite schema — loaded into it. Observed: `stories`,
`rfcs`, `events` and the join tables created in Postgres, with
`schema_migrations` holding only the dump's version.

It is a trails defect, tracked upstream, and it is also why nothing in this
repository passes `--database`: the unflagged command registers both
configurations and is correct, and it is what a Rails user would run anyway.

`app.json` declares the startup healthcheck dokku polls after a deploy
(`GET /up`, 12 attempts, 5s apart); the `Procfile` declares the release task
above and the `web` process.

`web` is in the Procfile even though the Dockerfile's `CMD` says the same
thing. A Procfile takes precedence over `CMD` for the process types it names,
and dokku's process docs warn that an app whose Procfile declares no `web` has
"the process count for every process type set to zero" under
`ps:scale --clear`. The duplication is one line and removes the question;
the two have to be kept in step, and both say so.

The healthcheck alone cannot catch an unmigrated hub — `/up` reads no row, so
a container with `HUB_DATABASE_URL` set and no tables answers it green and
then 500s with `relation "repositories" does not exist` on `/dashboard` and
every page under `/:owner`. That is what the release task is for; it is the
reason this is a deploy step and not a runbook entry.

## Who the viewer is

`sso:protect` is also trailmap's only notion of a viewer. Authelia's proxy sets
`Remote-User` on every request it lets through, and trailmap reads it as an
`Owner` login (`app/controllers/concerns/viewer.ts`). That is what a `private`
repository is enforced against: its tabs 404, and its row is left off the owner
page, for anyone who is not its owner or a `repository_collaborators` row.

So before a repository is made private, the person who should still see it
needs an `owners` row whose `login` is their Authelia username, and — unless
that row owns the repository — a collaborator row. Loopback carries no
`Remote-User` and is anonymous: the CLI, ringo and the smoke suite see public
repositories only. With SSO off, so is everyone.

## The stats database

`/graphs/parity` charts the trails port's convergence out of the stats database
the nightly stats-sync cron fills (ringo's `/crons`). trailmap only ever READS
it: `statsDatabaseConfig()` in `config/database.ts` opens it `readonly: true`,
which SQLite enforces at the driver.

**`STATS_DB` is OPTIONAL**, and that is the one way it differs from
`TASKS_DATABASE` and `HUB_DATABASE_URL`. Those two back every page, so
`config/initializers/*.ts` refuse to boot without them. This one backs a single
page, on a multi-gigabyte host file most deployments do not have, so
`config/initializers/stats-database.ts` skips the connection and the page says
the source is missing. Every other page is unaffected. A deployment with no
stats database is supported, not broken.

To serve the page, its directory must be in the container, and named:

```sh
# The DIRECTORY, not the file, and writable. SQLite finds `stats.db-wal` and
# `stats.db-shm` by path, beside the database, and a READ-ONLY connection to a
# WAL database still maps the `-shm` — so the directory it lives in has to be
# writable even though trailmap never writes the database itself.
#
# Mounting the file alone does not work (the sidecars are not in the mount, and
# the mount breaks if the writer ever replaces the inode), and neither does
# linking it into a tidier directory: a symlink is resolved inside the
# CONTAINER's mount namespace, where the target path does not exist, and a hard
# link gives readers their own `-shm` while the writer uses the original, which
# is two shm files for one WAL database.
#
# It is the parent-directory mount from "First-time setup" — already in place
# there, so there is nothing more to mount; this is all the stats database adds.
dokku config:set --no-restart trailmap \
  STATS_DB=/home/dean/github/blazetrailsdev/stats.db
```

A narrower alternative, if mounting the whole directory is unwanted: move
`stats.db` and its two sidecars into a directory of their own with the cron
stopped, mount only that, and point ringo at it with its own `STATS_DB`
(`statsDBPath()` in `webhook/parity.go` defaults to
`$HOME/github/blazetrailsdev/stats.db` and reads the override). Tidier, at the
cost of touching ringo's cron.

`scripts/smoke-prod.sh` tier 2 asserts the endpoint is actually serving —
`tier2.graphs-parity-data` requires the payload to name at least one run and one
package, because the no-stats answer is `{"error": …}`, which satisfies a looser
"is an object" check and let the page be dark in production unnoticed.

## Deploying

```sh
git remote add dokku dokku@localhost:trailmap   # once
./scripts/deploy.sh
```

The app deploys while it is running — no `ps:stop`, no downtime. nginx holds
`127.0.0.1:8080`, not the container, so dokku's zero-downtime release (new
container up, then old one down) has nothing to collide over; nginx re-points
at the new container's IP on reload.

**Use the script rather than a bare `git push dokku main:trunk`.** The push
exits non-zero even on a successful deploy — the uptime-monitor plugin runs
last and cannot reach Uptime Kuma on this box — so its exit status says
nothing, and a failed RELEASE after a successful BUILD leaves the old container
serving with no other outward sign. `scripts/deploy.sh` reads the running
container's id before and after and fails loudly when it did not change.

**`GIT_REV` does not tell you what is running.** dokku sets it during the
build, so `dokku config:get trailmap GIT_REV` reports the commit you pushed
whether or not the release replaced anything.

**The CONTAINER id is the witness, not the image id.** A redeploy of an
unchanged commit builds a byte-identical image, so an image-id comparison calls
a perfectly good release a failure. That is not hypothetical: the first real
redeploy this script was written for printed `DEPLOY FAILED` seconds after
dokku had renamed the new container into place. Replacing the container is the
property being checked, and only the container id changes every time that
happens:

```sh
docker inspect trailmap.web.1 --format '{{.Id}}'     # changes on every release
docker inspect trailmap.web.1 --format '{{.Image}}'  # changes only on a new build
```

A new image behind an unreplaced container is the original port-collision
failure, so the script prints both and says when the image is unchanged.

**The stale-image check is against the tag, not against the previous read.**
For eleven merged PRs the box served the first deploy's image while every later
build was tagged `dokku/trailmap:latest` and thrown away. A before/after
comparison cannot see that state — both reads return the same stale image and
agree — so what the script asserts is that the running container's image *is*
the one the tag points at:

```sh
docker inspect trailmap.web.1 --format '{{.Image}}'
docker inspect dokku/trailmap:latest --format '{{.Id}}'   # must be equal
```

That holds on every deploy rather than only across the one transition off the
PR #1 image, and it is the property that transition was evidence of.

### After every deploy

`scripts/deploy.sh` gates on `scripts/smoke-prod.sh --tier 0 --tier 1` and fails
on any assertion in either. The suite is the same one that runs between
deploys, so the deploy gate and the schedule cannot drift apart:

```sh
./scripts/smoke-prod.sh --tier 0   # /up on loopback
./scripts/smoke-prod.sh --tier 1   # /up/ready, both migration heads, the loopback API, the public vhost
./scripts/smoke-prod.sh --tier 2   # every read verb and page, by shape, and the tasks CLI
```

### Between deploys

Tiers 0 to 2 run from the host crontab, every 30 seconds, every minute and
every 5 minutes. `scripts/smoke-cron.sh <tier>` is what cron runs: it takes a
per-tier lock, so a slow tier is skipped rather than stacked; tells the suite
its deadline (`TRAILMAP_SMOKE_DEADLINE`, five seconds before the kill), so a
hung verb costs one allowance and everything it left no time for fails by name;
kills a tier ten seconds short of its cadence if it runs on anyway; and appends
each run to
`~/github/blazetrailsdev/smoke-tier<N>.log`, which ringo reads into three rows
on `/crons`. A red row there is the report. Cron's own is mail nobody reads.

```sh
./scripts/start-worktree.sh smoke-canary   # once: the worktree tier 2 runs the CLI from
./scripts/smoke-cron.sh --crontab          # the four entries; add them with `crontab -e`
```

Install them from the main checkout, so the entries name a path that outlives
any worktree. Tier 2's half of this is the `tasks` binary, run from
`smoke-canary` by the login shell, because what breaks for an agent is `PATH`,
the installed link and `TRAILMAP_URL` rather than the endpoint. Each has its own
assertion (`tier2.cli-binary`, `tier2.cli-worktree`, `tier2.cli-trailmap-url`),
and a verb one of them stopped says which. The crontab entry sets
`TRAILMAP_URL` until agents get it from their shell (RFC 0136 phase G); delete
it from the entry then, so the canary reads the value an agent reads.

The schedule moves into trailmap with its own scheduler (story
`move-the-smoke-schedule-into-trailmap`).

Each assertion prints `PASS` or `FAIL`, a stable name
(`tier1.public-vhost-redirects`) and a detail, tab-separated; the name is the
key and is never renamed. `tier1.migration-head` is `/up/ready`'s `migrations`
check: it compares the `schema_migrations` head against the last version under
`db/migrate` in the running image and names both when they differ.
`tier1.hub-migration-head` is the same for the hub: `/up/ready`'s
`hub_migrations` check, Postgres's `schema_migrations` against
`db/hub-migrate`. Without `HUB_DATABASE_URL` the check answers `skipped` (green)
rather than raising — only a test process can serve without one, since the hub
initializer refuses to boot — and the smoke assertion fails a `skipped` answer,
so production can never pass it that way.

`/up/ready`'s `database` check also goes red when the file at `TASKS_DATABASE`
is no longer the file the connection opened (a restore or `cutover-import.sh`
put another one there): the boot records the path's `dev`/`ino`, and each probe
compares. Where no identity could be recorded it falls back to existence and
says so in `identity`.

**A database that is AHEAD fails the deploy too, and that is intended.** The
tasks CLI migrates the same `tasks.db`, so the head can move without a trailmap
release. The release just deployed is then reading columns it was not written
for, which is the failure the check exists to catch, and a deploy that reports
success over it would be the silent case again. The message says which side is
behind ("the database is ahead of this release"); the fix is to deploy a
trailmap that carries the migration, not to re-run the deploy.

Tiers 1 and 2 need `jq` on the box. A host without it fails
`tier1.jq-installed` by name rather than a probe assertion.

By hand:

```sh
# SSO protection has come off a redeploy on sibling apps. Verify, and re-apply
# if the public hostname answers 200 instead of redirecting to auth.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H 'Host: trailmap.deanoftech.com' http://127.0.0.1/
# expected: 302 https://auth.deanoftech.com/?rd=https://trailmap.deanoftech.com/
dokku sso:protect trailmap   # only if it answered 200

curl -s http://127.0.0.1:8080/up             # expected: 200 (the framework's green page)
curl -s http://127.0.0.1:8080/stories/ready  # a guarded endpoint, see below

# Readiness: 200 with every check named, or 503 with `failing` naming the red
# ones — the database opens, it holds stories, the tasks checkout is writable
# and git has an identity there. Loopback-only, like the rest of the API.
curl -s http://127.0.0.1:8080/up/ready | jq
# The domain itself: a real ready queue, its row count and latency. Expensive
# by design — for the canary, never for a supervisor. While it ranks, every
# other request (`/up/ready` included) waits about its `latency_ms`; they are
# delayed, not failed, so give a `/up/ready` poller a timeout above one `deep`.
# Overlapping calls share one ranking, and past 5s it answers 503 — see below.
curl -s http://127.0.0.1:8080/up/deep | jq
```

### What bounds `/up/deep`

Measured on 2026-10-12 against the live database (12,682 stories, 144 in the
queue): one ranking takes 0.7s warm and 1.1–1.3s cold, of which about 0.53s is
one query, loading every story as a record, and 0.1s is the other five. A
timer started beside it did not fire once: SQLite is synchronous here, so the
ranking's `await`s never return to the event loop.

- **One ranking at a time.** A `deep` that arrives while one is in flight
  awaits that run and answers with its result. Eight overlapping canaries used
  to hold `/up/ready` for 8.4s; they now cost one ranking.
- **A 5s bound** (`ProbesController.deepTimeoutMs`): about four times the
  slowest ranking measured, and SQLite's busy timeout, so a locked database
  and a slow ranking are red at the same moment. Past it `deep` answers 503
  with `"error": "timeout: the ready queue took longer than 5000ms"`.
- **What the bound cannot do** is interrupt the ranking. Nothing in the
  process runs while it does, the timer included, so a ranking that takes 8s
  is answered at 8s — red, and naming the timeout, but late. A caller that
  must not wait sets its own `curl -m`.

The ranking does NOT yield between its six queries, and that was decided
rather than left: three quarters of the time is the single story load, so
yielding between queries would still stall everything for half a second at a
stretch. The cheaper ranking is the one `/backlog` already uses, from plucked columns
(`Story.rankingOutline`, 0.1s for the same six queries).

`deep`, `GET /stories/ready` and `next-bundle` now rank over plucked columns
(`Story.readyQueue` and `Story.bundle`, which add `est_loc` and `cluster` to
the outline for the packing) and load records only for the rows they answer
with. Measured on 2026-10-21 against a snapshot of the live database (13,698
stories, 275 in the queue), warm, with the same rows answered:

| path | stall |
| --- | --- |
| `rankingIndex` (every story a record), before | 0.73–0.94s |
| `readyQueue`, after | 0.14–0.15s |
| `bundle --max-loc 250`, after | 0.12–0.14s |

`pnpm gate` is byte-identical over the same snapshot.

`/up` is UNGUARDED, so a 200 from it proves only that the listener is up. The
thing that has broken twice is `requireLoopback` refusing a request that
arrived carrying proxy provenance, and only a guarded endpoint can show that —
which is why the script asks for `/stories/ready` by name and fails on a 404
from it.

**The release's database.** `/stories/ready` must answer 200, and the script
fails otherwise. A 500 there is `ConnectionNotDefined` or a missing file: the
release lost its mount or its `TASKS_DATABASE`. The configuration that closed
`mount-the-tasks-database-into-the-release`, as the box reports it:

```sh
dokku storage:report trailmap
#   host path:      /home/dean/github/blazetrailsdev/tasks
#   container path: /home/dean/github/blazetrailsdev/tasks
#   readonly:       false
dokku config:show trailmap
#   TASKS_DATABASE: /home/dean/github/blazetrailsdev/tasks/.git/tasks.db
#   TASKS_DIR:      /home/dean/github/blazetrailsdev/tasks
```

The container runs as uid/gid 1000, the host owner of `tasks.db`, so the bind
mount is writable with no permission work. `TASKS_DIR` is needed as well as
`TASKS_DATABASE`: the show pages read each document's markdown off disk.

`/audits` reads ringo's audits directory, read-only. Mount it and name it:

```sh
dokku storage:mount trailmap \
  /home/dean/.btwhooks/data/github/blazetrailsdev/trails/audits:/audits:ro
dokku config:set trailmap AUDITS_DIR=/audits
```

Unset, `/audits` renders and says there is no directory to list.

`/deploys/log` reads each run's log from ringo's pane-log directory (`<data dir>/sessions/panes`), read-only,
so a log reads with ringo down. The capture is the `pipe-pane` file ringo's
`DeployRun.LogFile` names; trailmap reads its base name, raw or as the `.gz`
ringo's sweep leaves, so every run already finished is readable as it stands —
there is nothing to backfill. Mount it and name it:

```sh
dokku storage:mount trailmap /home/dean/.btwhooks/data/sessions/panes:/deploy-logs:ro
dokku config:set trailmap DEPLOY_LOGS_DIR=/deploy-logs
```

Unset, the log is relayed from ringo as before. The run HISTORY is still
ringo's until `move-deploys-and-sweeps-into-the-database`; the row is what
names the file.

**Decided: the mount is read-write.** Authoring and ingest commit into the
checkout from inside the container, and the mutation endpoints exist to write.
The CLI still opens the same file, so the guard against two writers is
sequencing (below), accepted until `move-the-tasks-cli-into-trailmap` makes
trailmap the only writer of the task tables. Both writers use WAL and a shared
busy timeout — see [write-protocol.md](write-protocol.md).

A 404 from the loopback API — rather than a connection refused — means the
request reached the app with `X-Forwarded-*` headers on it and `requireLoopback`
refused it. nginx's loopback server block must set none: read the block in
`nginx.conf.sigil`, whose guard (`scripts/check-nginx-sigil.sh`) fails CI on a
reintroduced forwarding header.

## trailmap as the sole writer

The mutation endpoints (`POST /stories/claim` and its eight siblings) make
trailmap ABLE to write: `config/database.ts` no longer asks for a read-only
connection, and `pool: 1` serializes the verbs in-process so concurrent
requests cannot race into `SQLITE_BUSY`.

It is not yet the ONLY writer. The `tasks` CLI still opens the file directly;
it becomes an HTTP client in `move-the-tasks-cli-into-trailmap`, which deps on
this story precisely because the endpoints have to exist first. Until that
lands the two writers do not actually overlap — nothing posts to these
endpoints yet — but the guarantee is a sequencing promise, not a property of
this change, and treating it as already true is how you end up with two live
writers on a WAL database.

The RFC accepts what that costs: with the CLI behind the API, trailmap being
down stops the fleet. The mitigation is the restart policy and the healthcheck
above, NOT a second write path — a fallback that opened the file directly would
resurrect the second read model this RFC exists to delete.

```sh
# The write path, end to end. `record-spawn` is the safe probe: it appends an
# `events` row and moves no story state.
curl -sS -X POST http://127.0.0.1:8080/stories/record-spawn \
  -H 'Content-Type: application/json' \
  -d '{"rfc":"0136-trailmap","source":"deploy-probe"}'
# expected: {"ok":true,"lines":["recorded spawn (deploy-probe) for rfc 0136-trailmap"]}
```

## Verifying the pieces

```sh
# The tasks checkout is writable, as uid 1000, with the expected identity.
dokku enter trailmap web -- sh -lc \
  'cd /home/dean/github/blazetrailsdev/tasks && git commit-tree -m probe $(git rev-parse HEAD^{tree}) | xargs git cat-file commit | head -3'

# The app comes back by itself after a crash. A `docker kill` does NOT prove
# this — dockerd treats it as an intentional stop and skips the restart policy
# — so signal the process from the host's PID namespace instead.
kill -9 "$(docker inspect -f '{{.State.Pid}}' "$(docker ps -q --filter name=trailmap.web.1)")"
```

## Gotchas found the hard way

- **Node 24 or newer.** `@blazetrails/rack` uses duplicate named capture groups
  (ES2025); on Node 20 and 22 it throws a `SyntaxError` at import. `ARG
  NODE_VERSION` in the `Dockerfile`, `.node-version` and CI all say the same
  version.
- **Run as uid 1000.** A commit written as root leaves root-owned objects in
  the bind-mounted tasks checkout that the host's agents cannot then rewrite.

## The Solid Queue worker

The `worker` process (`bin/jobs`) runs config/queue.yml and the recurring
schedule in config/recurring.yml. Its queue is a SQLite database in
`/app/storage`, created by the release task's `db prepare`.

```sh
# Owned by uid 1000, the container's user, and mounted before the first deploy
# so the release container can create the database.
sudo mkdir -p /var/lib/dokku/data/storage/trailmap-queue
sudo chown 1000:1000 /var/lib/dokku/data/storage/trailmap-queue
dokku storage:mount trailmap /var/lib/dokku/data/storage/trailmap-queue:/app/storage

dokku config:set --no-restart trailmap \
  GH_TOKEN=<token with read access to blazetrailsdev/trails> \
  STATS_SYNC_DB=/home/dean/github/blazetrailsdev/stats-job.db \
  STATS_SYNC_LOG=/home/dean/github/blazetrailsdev/stats-sync-job.log
dokku ps:scale trailmap worker=1
```

The release task migrates that file from `db/stats-sync-migrate`, so it exists
before the job first runs.

`StatsSyncJob` runs at 03:00 America/Detroit, three hours ahead of the crontab
so the two do not draw on the same GitHub API budget at once. During the trial it writes
`stats-job.db` beside the crontab's `stats.db`, and its own log, so the crontab
keeps running and neither can hide a gap in the other. Each run ends in a
`[cron-wrapper] ok` line or a `[cron-wrapper] stats sync failed ...` line. Once
the trial holds up, remove the crontab entry and point `STATS_SYNC_DB` and
`STATS_SYNC_LOG` at the real files.
