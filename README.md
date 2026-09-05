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

## Running it

```sh
pnpm install
pnpm exec trails-tsc-views build --views app/views
pnpm exec tsx node_modules/@blazetrails/trailties/bin/trails.js server
```

## Deployment

trailmap is a dokku app: the dashboard on `trailmap.deanoftech.com` behind SSO,
the JSON API on loopback only. The procedure — including the `ps:stop` a fixed
port needs and the post-deploy SSO check — is in [docs/deploy.md](docs/deploy.md).

## CI

Every PR runs typecheck, the test suite, and a cold-start boot smoke test
(`scripts/smoke-boot.sh`): a clean `git archive` checkout, installed from the
vendored tarballs with no registry access, booted, and asked for a page.
