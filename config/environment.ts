import { env } from "@blazetrails/ruby-compat";
import { Trails } from "@blazetrails/trailties";

// Load the trails application.
import "./application.ts";

Trails.autoloaders.each((loader) => {
  loader.importer = (url) => import(url);
});

// development's and production's primary IS the tasks database. Without
// TASKS_DATABASE the framework's initialize_database fails with "No database
// file specified", which names neither the variable nor the fix, so every
// command that boots (db:migrate included) is refused here first.
const envName = env.NODE_ENV ?? "development";
if ((envName === "development" || envName === "production") && !env.TASKS_DATABASE?.trim()) {
  throw new Error(
    `TASKS_DATABASE is not set: ${envName}'s primary database is the tasks CLI's ` +
      "SQLite file. Point it at a tasks.db (a copy is fine for development); see README.",
  );
}

// Initialize the trails application.
const application = await Trails.initialize();

// The framework connected the task domain from config/database.ts. Two things
// remain here: warming the models' columns, because a cold model reached
// through an association first still selects no columns on the vendored
// trails (test/models/schema-loading.test.ts), and recording the file that
// opened, for `/up/ready` to notice it replaced underneath.
// Imported only now: loading a model before `initialize` applies the framework
// defaults would build it without them (belongs_to required, for one).
const { recordTasksDatabaseIdentity, tasksDatabasePath } = await import("./database.ts");
const tasksDatabase = tasksDatabasePath();
if (tasksDatabase) {
  const { loadModelSchemas } = await import("../lib/model-schemas.ts");
  await loadModelSchemas();
  const { loadAttachedModelSchemas } = await import("../lib/attached-model-schemas.ts");
  await loadAttachedModelSchemas();
  await recordTasksDatabaseIdentity(tasksDatabase);
}

export default application;
