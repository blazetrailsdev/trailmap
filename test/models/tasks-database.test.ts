import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";

/**
 * Spot-check the moved models against the LIVE database the CLI writes.
 *
 * Skipped unless `TASKS_DATABASE` points at a `tasks.db` — the file lives in
 * another repo's checkout, so CI has no copy of it and there is nothing here
 * worth faking. Run it as:
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
    expect(rfc!.status).toBe("active");
  });

  it("reads a story and traverses it back to its RFC", async () => {
    const story = await Story.findBy({ id: "move-task-models-into-trailmap" });
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
