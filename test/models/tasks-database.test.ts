import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.ts";
import { RFC_STATUSES, Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";

/**
 * Spot-check the moved models against the LIVE database the CLI writes.
 *
 * Skipped unless `TASKS_DATABASE` points at a `tasks.db`. CI's `test` job has
 * none, so it skips there; the `gate` job ingests the content repo into one
 * and runs this file against it, which is why nothing here may depend on a
 * fact only the box's database holds. Locally:
 *
 *     TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db pnpm test
 */
const withLiveDatabase = hasTasksDatabase() ? describe : describe.skip;

withLiveDatabase("the live tasks database", () => {
  beforeAll(async () => {
    await Base.establishConnection(tasksDatabaseConfig());
    await loadModelSchemas();
  });

  it("reads RFCs the CLI wrote", async () => {
    const rfc = await Rfc.findBy({ id: "0136-trailmap" });
    expect(rfc).not.toBeNull();
    // Not its status: that is live data, and it moves (draft, active, closed).
    // What the CLI wrote and will not rewrite is which file the RFC came from.
    expect(RFC_STATUSES).toContain(rfc!.status);
    expect(rfc!.file_path).toBe("rfcs/0136-trailmap/README.md");
  });

  it("reads a story and traverses it back to its RFC", async () => {
    // Any story of the RFC, not one by name: a story can be renamed or
    // removed, and the traversal is what is under test.
    const story = await Story.findBy({ rfc_id: "0136-trailmap" });
    expect(story).not.toBeNull();
    expect(story!.rfc_id).toBe("0136-trailmap");
    const rfc = await story!.rfc;
    expect(rfc!.title).toBe((await Rfc.findBy({ id: "0136-trailmap" }))!.title);
  });

  it("counts the RFC's stories through the association", async () => {
    const rfc = await Rfc.findBy({ id: "0136-trailmap" });
    const viaAssociation = (await rfc!.stories.toArray()).map((s) => s.id).sort();
    const viaQuery = (await Story.where({ rfc_id: "0136-trailmap" }).toArray())
      .map((s) => s.id)
      .sort();
    expect(viaAssociation).toEqual(viaQuery);
    expect(viaAssociation.length).toBeGreaterThan(0);
  });
});
