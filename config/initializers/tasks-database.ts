import { Base } from "@blazetrails/activerecord";
import { hasTasksDatabase, tasksDatabaseConfig } from "../database.js";
import { loadModelSchemas } from "../../app/models/index.js";

/**
 * Point the models at the CLI's live `tasks.db` when `TASKS_DATABASE` names
 * one.
 *
 * trailmap IS the writer now (see config/database.ts and the mutation
 * endpoints). This connection replaces the environment database the trailtie
 * established, because `storage/<env>.sqlite3` holds an empty schema and
 * answering the read verbs from it would serve an empty backlog instead of
 * failing loudly. Initializers load in sorted order, so this file's name is
 * what puts it after the rest.
 *
 * Schemas load here too, so the first request is not the one that discovers an
 * enum resolving against unreflected columns (see `loadModelSchemas`).
 *
 * The work happens at import time because that is the whole contract for a
 * `config/initializers` file — `loadConfigInitializer` imports the module and
 * calls nothing. The named export exists for the test.
 */
export async function connectToTasksDatabase(): Promise<void> {
  if (!hasTasksDatabase()) return;
  await Base.establishConnection(tasksDatabaseConfig());
  await loadModelSchemas();
}

await connectToTasksDatabase();
