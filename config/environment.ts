import { Trails } from "@blazetrails/trailties";

// Load the trails application.
import "./application.ts";

Trails.autoloaders.each((loader) => {
  loader.importer = (url) => import(url);
});

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
  await recordTasksDatabaseIdentity(tasksDatabase);
}

export default application;
