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
 * The live CLI database, read-only.
 *
 * trailmap does not own `tasks.db` yet — the CLI in `blazetrailsdev/tasks`
 * still writes it — so this is deliberately NOT one of the environment keys
 * above: those are the databases `trails db migrate` fans out over, and
 * migrating or dropping the CLI's live file is exactly what must not happen.
 * It is a connection you opt into by pointing `TASKS_DATABASE` at the file
 * (`<tasks checkout>/.git/tasks.db`).
 *
 * `readonly` is the enforcement, not a convention: the models moved here
 * unchanged, callbacks and all, and a stray save against the live database
 * would be a cross-repo write from an application that is only supposed to
 * read. Read via the process adapter rather than `process.env` — nothing in
 * trailmap touches `process` directly.
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
  return { adapter: "sqlite3", database, pool: 1, readonly: true };
}

/** Whether `TASKS_DATABASE` names a database to read. */
export function hasTasksDatabase(): boolean {
  return Boolean(env.TASKS_DATABASE);
}
