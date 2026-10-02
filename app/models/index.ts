import { registerModel } from "@blazetrails/activerecord";
import { Rfc } from "./rfc.js";
import { Story } from "./story.js";
import { StoryDep, StoryPackage, StoryPath, StoryRfcDep } from "./joins.js";
import { Event } from "./event.js";
import { Meta } from "./meta.js";
import { registerRfcAutoClose } from "./rfc-close.js";

// Association targets are named by STRING (`belongsTo("rfc")`,
// `hasMany("deps", { through: "storyDeps", source: "dependsOn" })`). Rails
// resolves those through constant autoloading; there is no autoloader here, so
// every model must be registered or resolution throws "uninitialized constant".
// Importing this barrel is what makes associations work — import it, not the
// individual model files, anywhere associations are traversed.
const MODELS = [Rfc, Story, StoryDep, StoryRfcDep, StoryPath, StoryPackage, Event, Meta];

registerModel(MODELS);

// Arms the RFC auto-close (see ./rfc-close.ts). Registered here rather than
// in story.ts so the rule can import the models it queries without an import
// cycle back through this barrel.
registerRfcAutoClose();

/**
 * Force every model's column information to load.
 *
 * `enum` resolves its storage type from the reflected column, and that
 * reflection is loaded lazily. Reaching a model for the FIRST time through an
 * association — `rfc.stories`, which is how a controller reads an RFC page —
 * builds it on a path that never loads columns, and the enum decorator then
 * throws "Undeclared attribute type for enum 'status' in Story". Touching
 * Story directly first happens to load the schema and hide it, so the failure
 * depends on which query a request ran first.
 *
 * Await this once after `establishConnection` and the order stops mattering.
 *
 * Each model is reset first — Rails' `reset_column_information`, the call its
 * docs give for "the schema under this model changed" — because a NEW
 * connection is exactly that, and trails' `loadSchema` does not notice on its
 * own: it returns early on a per-class "already loaded" flag that outlives
 * the connection it was loaded from. The new pool's schema cache then stays
 * cold, and a cold read of `primaryKey` answers the `id` convention, so an
 * insert into a table with no `id` column (the four join tables) asks SQLite
 * to `RETURNING "id"` and fails. The server connects once and never sees it;
 * the suite and the gates reconnect to a fresh database and do.
 */
export async function loadModelSchemas(): Promise<void> {
  await Promise.all(
    MODELS.map((model) => {
      model.resetColumnInformation();
      return model.loadSchema();
    }),
  );
}

export { Rfc, RFC_STATUSES, type RfcStatus } from "./rfc.js";
export { Story, STORY_STATUSES, RESOLVED_DEP_STATUSES, type StoryStatus } from "./story.js";
export { StoryDep, StoryRfcDep, StoryPath, StoryPackage } from "./joins.js";
export { Event } from "./event.js";
export { Meta } from "./meta.js";
