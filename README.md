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
the JSON API on loopback only. The procedure — including the `ps:stop` a fixed
port needs and the post-deploy SSO check — is in [docs/deploy.md](docs/deploy.md).

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
