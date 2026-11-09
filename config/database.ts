import { DatabaseConfigurations, type HashConfig } from "@blazetrails/activerecord";
import { env, getFs } from "@blazetrails/ruby-compat";
import { writeProtocol } from "./write-protocol.ts";

/**
 * `db/hub-migrate`, not `db/migrate`. See the note on the default export.
 *
 * Declared BEFORE that export: the entries below are built while this module
 * evaluates, so a `const` declared after them is still in its temporal dead
 * zone when `hubEntry()` runs, and `trails db` reports it as a database config
 * that will not load.
 */
export const HUB_MIGRATIONS_PATH = "db/hub-migrate";

/** `db/queue_migrate`, Rails' own name for Solid Queue's migrations. */
export const QUEUE_MIGRATIONS_PATH = "db/queue_migrate";

/** `db/stats-sync-migrate`: the stats sync's own schema history. */
export const STATS_SYNC_MIGRATIONS_PATH = "db/stats-sync-migrate";

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
 * `trails db:migrate` would otherwise try to run it against Postgres.
 * `pnpm db:migrate` — with NO `--database` flag — migrates both. That flag
 * loads `db/schema.ts` into whichever database it targets; docs/deploy.md and
 * CLAUDE.md both say never to pass it.
 *
 * The served environments' `primary` IS the CLI's live `tasks.db`
 * (`tasksEntry`), with `databaseTasks: false` so `trails db` never migrates,
 * creates or drops it. `test` keeps a scratch file `trails db` may build.
 */
const databaseConfigurations = {
  development: {
    primary: tasksEntry(),
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
    primary: tasksEntry(),
    hub: hubEntry(),
    queue: queueEntry("storage/production_queue.sqlite3"),
    statsSync: statsSyncDatabaseConfig(),
  },
};

export default databaseConfigurations;

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
 * at IMPORT time for every environment at once, and `trails db:migrate`
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
 * Solid Queue's database, in the shape Rails 8 generates: its own SQLite file
 * under `storage/`, its own `db/queue_migrate`, and its schema in
 * `db/queue_schema.ts`, which `trails db:prepare` loads into an empty file.
 * Production only, as in Rails: development and test run jobs inline or on the
 * test adapter, and only the `worker` process (Procfile) runs the supervisor.
 *
 * `storage/` is a dokku storage mount (docs/deploy.md), so the queue — the
 * recurring-execution rows that keep one 03:00 run from enqueuing twice, and
 * any failed execution waiting to be read — outlives a deploy.
 */
function queueEntry(database: string): Record<string, unknown> {
  return {
    adapter: "sqlite3",
    database,
    timeout: 5000,
    pragmas: { journal_mode: "wal" },
    migrationsPaths: QUEUE_MIGRATIONS_PATH,
  };
}

/**
 * What the stats sync writes (app/models/stats-sync). Unlike the read-only
 * `statsDatabaseConfig()`, trailmap owns this schema, so `trails db` migrates it
 * from `db/stats-sync-migrate`. Unset falls back to a file under `storage/`
 * rather than throwing: the models connect as they load, and the suite and the
 * web process load them without ever running the job.
 */
export function statsSyncDatabaseConfig(): Record<string, unknown> {
  return {
    adapter: "sqlite3",
    database: env.STATS_SYNC_DB || "storage/stats_sync.sqlite3",
    timeout: 5000,
    pragmas: { journal_mode: "wal" },
    migrationsPaths: STATS_SYNC_MIGRATIONS_PATH,
  };
}

/**
 * The hub connection, as `app/models/hub.ts` opens it.
 *
 * Separate from the entries above for the same reason `statsDatabaseConfig()`
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
 * The live CLI database, read-write: the served environments' `primary`.
 *
 * `databaseTasks: false` is Rails' `database_tasks: false`
 * (hash_config.rb `database_tasks?`): `trails db:migrate`, `create` and `drop`
 * skip it, because migrating or dropping the CLI's live file is exactly what
 * must not happen. The framework's `active_record.initialize_database`
 * initializer connects to it at boot, and an unset `TASKS_DATABASE` leaves no
 * database file, which fails that boot loudly rather than serving 500s.
 *
 * `readonly` came off when the mutation endpoints landed; `timeout` and the
 * journal mode are docs/write-protocol.md's. `pool: 1` serializes the mutation
 * verbs in the process, since SQLite takes one writer at a time.
 */
function tasksEntry(): Record<string, unknown> {
  return {
    adapter: "sqlite3",
    database: tasksDatabasePath(),
    pool: 1,
    timeout: writeProtocol.busyTimeoutMs,
    pragmas: { journal_mode: writeProtocol.journalMode },
    databaseTasks: false,
  };
}

/**
 * The resolved `primary` of an environment, as the framework reads it — for
 * scripts that connect without booting the application.
 */
export function primaryDatabaseConfig(envName = env.NODE_ENV ?? "development"): HashConfig {
  const config = new DatabaseConfigurations(databaseConfigurations).configsFor({
    envName,
    name: "primary",
    includeHidden: true,
  });
  if (!config) throw new Error(`config/database.ts has no primary database for ${envName}`);
  return config as HashConfig;
}

/** The path `TASKS_DATABASE` names, trimmed: the one read all three share. */
export function tasksDatabasePath(): string | undefined {
  return env.TASKS_DATABASE?.trim() || undefined;
}

/**
 * The trails stats database, read-only.
 *
 * A THIRD connection, and the third adapter in this process: the task domain
 * is better-sqlite3 (`tasksEntry`), the hub is PostgreSQL
 * (`hubDatabaseConfig`), and this one is `node-sqlite` — Node's built-in
 * `node:sqlite`, which trails registers under that adapter name. Two drivers
 * for one engine in one process is deliberate: nothing about this connection
 * needs better-sqlite3's native build, and running the second driver in an
 * application is the only way anyone finds out whether it works outside
 * trails' own suite.
 *
 * Unlike the served `primary` and the `hub` entry, this is NOT one of
 * the environment keys above. `trails db` must never migrate or drop it: it is
 * filled by `StatsSyncJob` (`stats-job.db`, beside ringo's `stats.db`), its
 * schema is the stats-sync migrations', and trailmap only reads it.
 *
 * `readonly: true` reaches the driver's open flag, so a write is refused by
 * SQLite itself rather than by a convention someone can forget. It is a
 * stronger guarantee than marking the models `readonly` and it costs nothing:
 * there is no trailmap code that should ever write here.
 *
 * WAL, and the cron writes while we read — so the busy timeout from
 * `docs/write-protocol.md` applies for the same reason it does on `tasks.db`.
 * Note that a read-only connection to a WAL database still needs to create the
 * `-shm` file, so the DIRECTORY has to be writable even though the file is not
 * written; ringo's README records the same requirement for its own mount.
 *
 * `pool: 1` because this answers one page. The rollup query reads 60k rows per
 * comparison table and there is no reason for two of them to be in flight.
 */
export function statsDatabaseConfig(): Record<string, unknown> {
  const database = env.STATS_DB;
  if (!database) {
    throw new Error(
      "STATS_DB is not set. Point it at the trails stats database " +
        "(~/github/blazetrailsdev/stats-job.db, the one StatsSyncJob fills).",
    );
  }
  return {
    adapter: "node-sqlite",
    database,
    readonly: true,
    pool: 1,
    timeout: writeProtocol.busyTimeoutMs,
  };
}

/** Whether `STATS_DB` names a database to read. */
export function hasStatsDatabase(): boolean {
  return Boolean(env.STATS_DB);
}

/** The file the connection opened: its path, and the path's `dev`/`ino` then. */
export interface TasksDatabaseIdentity {
  path: string;
  dev: number | undefined;
  ino: number;
}

let opened: TasksDatabaseIdentity | null = null;

/**
 * What `/up/ready` compares the path against, to see a file REPLACED under the
 * open connection (app/controllers/probes-controller.ts). Null when nothing
 * was recorded, which the probe reports as an existence-only check.
 */
export function tasksDatabaseIdentity(): TasksDatabaseIdentity | null {
  return opened;
}

/**
 * Recorded after boot (config/environment.ts), once the framework's schema
 * load has made SQLite open the file: `establishConnection` alone opens nothing, so a stat taken before
 * them would describe whatever was at the path, not what was opened. An
 * adapter that reports no `ino` records nothing.
 */
export async function recordTasksDatabaseIdentity(path: string): Promise<void> {
  const fs = getFs();
  // A process that never opened the file (`trails db` before it exists)
  // records nothing, and the probe falls back to existence.
  const stat = fs.stat && (await fs.exists(path)) ? await fs.stat(path) : null;
  opened = stat?.ino === undefined ? null : { path, dev: stat.dev, ino: stat.ino };
}

/** Drop the record, so the probe falls back to existence. For tests. */
export function forgetTasksDatabaseIdentity(): void {
  opened = null;
}
