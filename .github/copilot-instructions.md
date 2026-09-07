# Instructions for AI coding agents

This repo's conventions live in [`CLAUDE.md`](../CLAUDE.md) and
[`README.md`](../README.md). **Read `CLAUDE.md` first** — it is the guide, and
this file only exists so agents that don't look for it still find it.

The rules that most often bite an outside contributor or reviewer:

- **A framework bug gets fixed in trails, never patched here.** trailmap is an
  application built on trails; if a fix would be identical in any other trails
  app, or reaches into framework internals, it belongs in
  `blazetrailsdev/trails` with a test there — not in `app/`, `config/`, or a
  `lib/` shim. See `CLAUDE.md` for the reproduce → fix → re-vendor loop.
- **Never edit anything under `vendor/`.** Those `@blazetrails/*` tarballs are
  build output, and the vendored snapshot can lag trails `main` — read
  `node_modules/@blazetrails/*` when behaviour surprises you.
- **Story state is database-owned.** `status`, `pr`, `claim`, `assignee`,
  `blocked-by`, `closed-reason` change only through a `pnpm tasks` verb. Hand
  editing them in markdown is silently ignored and fails CI.
- Conventional Commits. Open PRs as draft. No `Co-Authored-By` trailer and no
  "Generated with Claude Code" line in commits, PRs, issues, or comments.

There is no Rails-port fidelity suite here — that is trails. Deployment,
CI, and nginx/Dokku config are judged against the upstream templates and this
repo's own deploy docs and tests.
