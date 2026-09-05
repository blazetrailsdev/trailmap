import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";

/**
 * Its own file on purpose: column information is cached per model class, so
 * the "first touch is an association" ordering only exists in a worker where
 * nothing has queried Story yet.
 */
beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

describe("loadModelSchemas", () => {
  it("lets an association be the first thing that touches a model", async () => {
    await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });
    const rfc = await Rfc.findBy({ id: "0136-trailmap" });

    // Story has not been queried directly in this worker. Without the warm-up
    // this throws "Undeclared attribute type for enum 'status' in Story".
    expect(await rfc!.stories.toArray()).toEqual([]);

    await Story.create({ id: "s", rfc_id: "0136-trailmap", status: "ready" });
    const reloaded = await Rfc.findBy({ id: "0136-trailmap" });
    expect((await reloaded!.stories.toArray()).map((s) => s.id)).toEqual(["s"]);
  });
});
