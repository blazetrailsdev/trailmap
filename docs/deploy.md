# Deploying trailmap

trailmap runs as a dokku app on the same box as ringo/btwhooks and the agent
fleet. One container, one HTTP listener on `:8080`, two audiences:

| Audience | Route | Auth |
| --- | --- | --- |
| The dashboard | `https://trailmap.deanoftech.com`, via dokku's nginx | SSO (authelia) |
| The JSON API | `http://127.0.0.1:8080`, via the published loopback port | none — unreachable off-box |

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

# The JSON API's loopback listener. This fixed port is why a redeploy needs
# `ps:stop` first (see below).
dokku docker-options:add trailmap deploy "-p 127.0.0.1:8080:8080"

# The RFC's availability decision rests on this: the fleet stops when trailmap
# is down, and the mitigation is that it comes back by itself.
dokku ps:set trailmap restart-policy on-failure:10

dokku config:set --no-restart trailmap NODE_ENV=production
dokku sso:protect trailmap
```

`app.json` declares the startup healthcheck dokku polls after a deploy
(`GET /up`, 12 attempts, 5s apart).

## Deploying

```sh
git remote add dokku dokku@localhost:trailmap   # once
dokku ps:stop trailmap                          # release 127.0.0.1:8080
git push dokku main:trunk
```

The push exits non-zero even on a successful deploy: the uptime-monitor plugin
runs last and cannot reach Uptime Kuma on this box. Judge the deploy by the
`Healthcheck succeeded name='boot'` and `Renaming container` lines above it.

`ps:stop` is not optional. The container holds a fixed host port, so a rolling
deploy fails with `Bind for 127.0.0.1:8080 failed: port is already allocated`
and the new container never starts.

### After every deploy

```sh
# SSO protection has come off a redeploy on sibling apps. Verify, and re-apply
# if the public hostname answers 200 instead of redirecting to auth.
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  -H 'Host: trailmap.deanoftech.com' http://127.0.0.1/
# expected: 302 https://auth.deanoftech.com/?rd=https://trailmap.deanoftech.com/
dokku sso:protect trailmap   # only if it answered 200

curl -s http://127.0.0.1:8080/up   # expected: {"status":"ok"}
```

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
