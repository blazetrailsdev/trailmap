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
 */
export function tasksDatabaseConfig(): Record<string, unknown> | null {
  const database = env.TASKS_DATABASE;
  if (!database) return null;
  return { adapter: "sqlite3", database, pool: 1, readonly: true };
}
