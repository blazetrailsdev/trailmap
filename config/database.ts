import { env } from "@blazetrails/ruby-compat";
import { writeProtocol } from "./write-protocol.js";

/**
 * `db/hub-migrate`, not `db/migrate`. See the note on the default export.
 *
 * Declared BEFORE that export: the entries below are built while this module
 * evaluates, so a `const` declared after them is still in its temporal dead
 * zone when `hubEntry()` runs, and `trails db` reports it as a database config
 * that will not load.
 */
export const HUB_MIGRATIONS_PATH = "db/hub-migrate";

/**
 * Rails' three-tier shape: each environment names its databases rather than
 * being one. `primary` is what it always was; `hub` is the second one, and it
 * is PostgreSQL — the owner/repository hierarchy lives there (app/models/hub.ts).
 *
 * Two adapters in one process is deliberate. trailmap is the proving ground for
 * trails, and every connection it had ever opened was sqlite3, so the vendored
 * PostgreSQL adapter had never been driven by an application.
 *
 * `hub` carries `migrationsPaths` because its migrations are NOT `db/migrate`:
 * that directory is the task domain's history, shared with the tasks CLI, and
 * `trails db migrate` would otherwise try to run it against Postgres.
 * `pnpm db:migrate` — with NO `--database` flag — migrates both. That flag
 * loads `db/schema.ts` into whichever database it targets; docs/deploy.md and
 * CLAUDE.md both say never to pass it.
 */
export default {
  development: {
    primary: {
      adapter: "sqlite3",
      database: "storage/development.sqlite3",
    },
    hub: hubEntry(),
  },
  test: {
    primary: {
      adapter: "sqlite3",
      database: "storage/test.sqlite3",
    },
    hub: hubEntry(),
  },
  production: {
    primary: {
      adapter: "sqlite3",
      database: "storage/production.sqlite3",
    },
    hub: hubEntry(),
  },
};

/**
 * The `hub` entry of a `config/database.ts` environment.
 *
 * `url` rather than a host/user/password spread, because that is the form
 * `dokku postgres:link` hands the app — one `HUB_DATABASE_URL` — and
 * `trails db` normalizes a URL into the adapter's own keys itself. The URL
 * carries a password, so it is only ever read from the environment; nothing
 * here or in `docs/deploy.md` holds one.
 *
 * Unset is left as `undefined` rather than throwing. These entries are built
 * at IMPORT time for every environment at once, and `trails db migrate`
 * (primary) must keep working on a machine that has no hub database — the
 * failure belongs where the hub connection is actually opened, which is
 * `hubDatabaseConfig()` below.
 */
function hubEntry(): Record<string, unknown> {
  return {
    adapter: "postgresql",
    url: env.HUB_DATABASE_URL,
    migrationsPaths: HUB_MIGRATIONS_PATH,
  };
}

/**
 * The hub connection, as `app/models/hub.ts` opens it.
 *
 * Separate from the entries above for the same reason `tasksDatabaseConfig()`
 * is: those are what `trails db` fans out over, and this is what the running
 * application connects with. They happen to name the same database.
 *
 * Throws rather than returning null when `HUB_DATABASE_URL` is unset, so a
 * caller that forgot `hasHubDatabase()` fails here instead of handing
 * `establishConnection` a config with no database in it and failing further in.
 */
export function hubDatabaseConfig(): Record<string, unknown> {
  const url = env.HUB_DATABASE_URL;
  if (!url) {
    throw new Error(
      "HUB_DATABASE_URL is not set. Point it at the hub Postgres database " +
        "(`dokku postgres:info trailmap-hub --dsn`); see docs/deploy.md.",
    );
  }
  return { adapter: "postgresql", url, migrationsPaths: HUB_MIGRATIONS_PATH };
}

/** Whether `HUB_DATABASE_URL` names a database to connect to. */
export function hasHubDatabase(): boolean {
  return Boolean(env.HUB_DATABASE_URL);
}

/**
 * The live CLI database, read-write.
 *
 * This is deliberately NOT one of the environment keys above: those are the
 * databases `trails db migrate` fans out over, and migrating or dropping the
 * CLI's live file is exactly what must not happen. It is a connection you opt
 * into by pointing `TASKS_DATABASE` at the file (`<tasks checkout>/.git/tasks.db`).
 *
 * `readonly` came off here when the mutation endpoints landed
 * (app/controllers/mutations-controller.ts): a read-only connection would
 * refuse the writes they exist to perform.
 *
 * That makes trailmap ABLE to write, not yet the only writer — the CLI still
 * opens this file until `move-the-tasks-cli-into-trailmap` turns it into an
 * HTTP client. The deployed mount is read-write and that sequencing is the
 * accepted guard until then; docs/deploy.md records the decision, and
 * docs/write-protocol.md the WAL + busy-timeout protocol `timeout` comes from.
 *
 * `pool: 1` is load-bearing now rather than incidental. SQLite takes one
 * writer at a time, and a single connection serializes the mutation verbs in
 * the process rather than letting concurrent requests race into
 * `SQLITE_BUSY`.
 *
 * Ask `hasTasksDatabase()` first. This throws rather than returning null when
 * `TASKS_DATABASE` is unset, so a caller that forgot the check fails at the
 * connection instead of handing `establishConnection` a nullish config and
 * failing somewhere further in.
 */
export function tasksDatabaseConfig(): Record<string, unknown> {
  const database = env.TASKS_DATABASE;
  if (!database) {
    throw new Error(
      "TASKS_DATABASE is not set. Point it at the CLI's tasks.db " +
        "(<tasks checkout>/.git/tasks.db) to read the live database.",
    );
  }
  return {
    adapter: "sqlite3",
    database,
    pool: 1,
    timeout: writeProtocol.busyTimeoutMs,
    pragmas: { journal_mode: writeProtocol.journalMode },
  };
}

/** Whether `TASKS_DATABASE` names a database to read. */
export function hasTasksDatabase(): boolean {
  return Boolean(env.TASKS_DATABASE);
}
