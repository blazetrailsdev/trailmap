import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { getFsAsync, getPathAsync } from "@blazetrails/activesupport";
import { env } from "@blazetrails/activesupport/process-adapter";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.js";
import { Story, loadModelSchemas } from "../../app/models/index.js";
import { serializeStories } from "../../app/serializers/story-json.js";

/**
 * The equivalence gate: serialize the WHOLE backlog and diff it against the
 * published `index.json`, which is what btwhooks' Go side and the CLI parse
 * today. Field-for-field equality over the full RFC set is the acceptance
 * criterion — a spot-check on a fixture would not catch a field that only ever
 * appears on a handful of the 7k real stories.
 *
 * Skipped unless `TASKS_DATABASE` points at a `tasks.db`: the file and the
 * `index.json` beside it live in another repo's checkout, so CI has no copy
 * and there is nothing here worth faking. Run it as:
 *
 *     TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db pnpm test
 */
const withLiveDatabase = hasTasksDatabase() ? describe : describe.skip;

/** `<checkout>/.git/tasks.db` → `<checkout>/index.json`, the published copy. */
async function publishedIndexPath(): Promise<string> {
  const path = await getPathAsync();
  return path.join(path.dirname(path.dirname(String(env.TASKS_DATABASE))), "index.json");
}

withLiveDatabase("the published index.json", () => {
  let published: Record<string, unknown>[];

  beforeAll(async () => {
    await Base.establishConnection(tasksDatabaseConfig());
    await loadModelSchemas();
    const fs = await getFsAsync();
    const raw = await fs.readFile!(await publishedIndexPath(), "utf8");
    published = JSON.parse(raw as string).stories;
  });

  it("matches the serialized stories field for field", async () => {
    const serialized = await serializeStories(await Story.listFiltered());

    expect(serialized).toEqual(published);
  });
});
