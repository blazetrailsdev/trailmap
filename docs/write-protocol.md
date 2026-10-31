# The shared-SQLite write protocol

trailmap and ringo open one SQLite file. The rule that keeps that safe is
**one writer per table, not per file**: no table ever has two writers, which is
what "one writer" was protecting in the first place. The values below live in
`config/write-protocol.ts`, and `test/config/write-protocol.test.ts` fails when
anything here stops being true.

## Connection settings

| Setting | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | Readers never block the writer and the writer never blocks readers, so a page render cannot stall a webhook write. The trails SQLite adapter sets it on every writable connection. |
| `busy_timeout` | `5000` ms | Every write is one short transaction (a verb, a webhook row). Five seconds is far above a real write and well under the proxy's request timeout. |

trailmap takes both from `tasksDatabaseConfig()` (`pragmas.journal_mode`, and
`timeout:`, the adapter's spelling of `busy_timeout`). `journal_mode` is a property of the file, so
trailmap's writable connection sets it for everyone.

ringo is Go in another repository and cannot import the constant. Instead,
`scripts/vendor-ringo.sh` vendors every ringo Go file that opens a handle,
executes a statement or spells a SQL write
(today `webhook/tasksdb.go` and `webhook/parity.go`) into `vendor/ringo/db/`,
and the test requires each DSN there to carry:

```text
_pragma=busy_timeout(5000)
```

and, while ringo owns no table, `mode=ro` as well. Both sites open
`file:<path>?mode=ro&_pragma=busy_timeout(5000)` at the vendored pin. A ringo
change is caught when the pin is bumped, which `pnpm ringo:pin` flags on the
box.

## Table ownership

The other process may **read** every table.

| Table | Owner (sole writer) |
| --- | --- |
| `rfcs` | trailmap |
| `stories` | trailmap |
| `story_deps` | trailmap |
| `story_rfc_deps` | trailmap |
| `story_packages` | trailmap |
| `story_paths` | trailmap |
| `events` | trailmap |
| `meta` | trailmap |
| `pr_states` | ringo |

`pr_states` is ringo's PR tracker, the first of its JSON state files moved
here (`tracker-state.json`). Each RFC 0136 phase-B migration story that moves one of
ringo's JSON state files adds its table here, as `ringo`, in the same PR that
adds its migration.

## Migrations

Every table's migration — ringo's included — lives in trailmap's `db/migrate`.
One schema authority: a fleet-state column is added exactly the way a story
column is. ringo never runs DDL.

## Enforcement

`test/config/write-protocol.test.ts` fails when:

- a table in `db/schema.ts` has no owner in `tableOwners`;
- a trailmap model maps a table not owned by trailmap;
- ringo's vendored database code (`vendor/ringo/db`) carries an `INSERT`,
  `UPDATE`, `DELETE` or `REPLACE` against a trailmap-owned table;
- a ringo `sql.Open` cannot be parsed, lacks the busy timeout, or is writable while ringo owns
  no table;
- trailmap's connection drifts from the constants.

Its boundary is the vendored pin: ringo has no remote CI can check out, so a
ringo commit is checked when it is vendored, not when it is written.

## When the database is locked or migrating

ringo must not drop a webhook event because trailmap is busy or redeploying.

- **Locked** (`SQLITE_BUSY` after the 5s timeout): ringo must acknowledge the
  delivery only after the row is committed. Until then the event stays in an
  in-memory ingest queue and ringo retries the write with backoff (1s, doubling,
  capped at 30s) — never discarded.
- **Migrating**: a redeploy does not migrate the live file on boot; migrations
  are applied deliberately, as their own step, and SQLite DDL takes the same
  write lock, so ringo sees it as a lock and retries as above. A write that
  fails for a schema reason (`no such column`) is retried the same way rather
  than dropped, since the migration that adds the column is the one running.
- **ringo restarting while events are queued**: GitHub redelivers anything that
  was not acknowledged, which is why the acknowledgement follows the commit.

ringo implements this in `vendor/ringo/db/taskswrite.go`, vendored at ringo pin
`bd783e9` (`webhook/taskswrite.go` in ringo's own source, btwhooks `0eeb2e1`):
`tasksWriter.Commit` queues a transaction and returns once it is committed,
retrying `SQLITE_BUSY`, `SQLITE_LOCKED` and the schema errors (`no such column`,
`no such table`, `has no column named`) on that backoff, and `AckAfterCommit`
answers 503 for a delivery whose row is not yet on disk. A write whose sender
gave up stays queued and still commits, so GitHub's redelivery finds the row
there: **a write must be idempotent, keyed by the delivery id.** Its test holds
an exclusive lock past the real busy timeout and finds the event written after
release.

It has no caller yet, and deliberately no `sql.Open`: the writable DSN is
`tasksWriteDSN` (`file:<path>?mode=rw&_pragma=busy_timeout(5000)`), and the
story that gives ringo its first table opens it in the same change that adds
the table to `tableOwners`, which is when the test below starts allowing a
writable handle.
