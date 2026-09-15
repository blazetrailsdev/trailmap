import { env } from "@blazetrails/activesupport/process-adapter";
import { writeProtocol } from "./write-protocol.js";

export default {
  development: {
    adapter: "sqlite3",
    database: "storage/development.sqlite3",
  },
  test: {
    adapter: "sqlite3",
    database: "storage/test.sqlite3",
  },
  production: {
    adapter: "sqlite3",
    database: "storage/production.sqlite3",
  },
};

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
