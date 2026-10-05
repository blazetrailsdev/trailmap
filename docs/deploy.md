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
dokku storage:mount trailmap \
  /home/dean/github/blazetrailsdev/tasks:/home/dean/github/blazetrailsdev/tasks

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
# there is no credentials file to fall back on. Without it
# `config/initializers/secret-key-base.ts` refuses the boot; before that
# initializer existed the container came up and never answered a request.
# Generate it once; changing it later invalidates signed cookies.
dokku config:set --no-restart trailmap SECRET_KEY_BASE="$(openssl rand -hex 64)"
dokku sso:protect trailmap
```

`app.json` declares the startup healthcheck dokku polls after a deploy
(`GET /up`, 12 attempts, 5s apart).

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

`scripts/deploy.sh` runs both of these itself and fails on either. By hand:

```sh
# SSO protection has come off a redeploy on sibling apps. Verify, and re-apply
# if the public hostname answers 200 instead of redirecting to auth.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H 'Host: trailmap.deanoftech.com' http://127.0.0.1/
# expected: 302 https://auth.deanoftech.com/?rd=https://trailmap.deanoftech.com/
dokku sso:protect trailmap   # only if it answered 200

curl -s http://127.0.0.1:8080/up             # expected: {"status":"ok"}
curl -s http://127.0.0.1:8080/stories/ready  # a guarded endpoint, see below
```

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
- **Vite's allowed hosts.** `trails server` mounts the Vite dev server in front
  of Rack even in the container, and Vite answers 403 to any `Host` it was not
  told about. The deployed hostname is listed in `vite.config.ts`; a new
  hostname has to be added there or the deploy fails its healthcheck.
- **Run as uid 1000.** A commit written as root leaves root-owned objects in
  the bind-mounted tasks checkout that the host's agents cannot then rewrite.
