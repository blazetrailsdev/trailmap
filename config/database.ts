import { env } from "@blazetrails/activesupport/process-adapter";

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
 * `readonly` came off here when the mutation endpoints landed: trailmap is now
 * the SOLE WRITER of `tasks.db` (app/controllers/mutations-controller.ts), and
 * a read-only connection would refuse the writes it exists to perform. The
 * guard it used to provide — nothing else may write this file — moved from the
 * connection flag to the deployment: one process, one writer, and the CLI
 * posting to the API instead of opening the file.
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
  return { adapter: "sqlite3", database, pool: 1 };
}

/** Whether `TASKS_DATABASE` names a database to read. */
export function hasTasksDatabase(): boolean {
  return Boolean(env.TASKS_DATABASE);
}
