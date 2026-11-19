import { Attachment } from "@blazetrails/activestorage/attachment";
import { Blob } from "@blazetrails/activestorage/blob";
import { Audit } from "../app/models/audit.ts";
import { Refinement } from "../app/models/refinement.ts";

/**
 * The task-domain models that attach, and Active Storage's own, warmed after
 * `Trails.initialize` by config/environment.ts. Not in lib/model-schemas,
 * because config/initializers/hub-database.ts imports that during the
 * initializers, before `active_storage.attached` has given `Base`
 * `hasOneAttached`: story blob-import-before-attached-model-initializer.
 */
export const ATTACHED_MODELS = [Audit, Refinement, Blob, Attachment];

export async function loadAttachedModelSchemas(): Promise<void> {
  await Promise.all(ATTACHED_MODELS.map((model) => model.loadSchema()));
}
