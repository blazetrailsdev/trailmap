import { describe, expect, it } from "vitest";
import { Rfc } from "../../app/models/rfc.ts";
import { Story } from "../../app/models/story.ts";

describe("loadModelSchemas", () => {
  it("lets an association be the first thing that touches a model", async () => {
    const rfc = await Rfc.findBy({ id: "0136-trailmap" });

    // Story has not been queried directly in this worker. Without the warm-up
    // this throws "Undeclared attribute type for enum 'status' in Story".
    expect((await rfc!.stories.toArray()).map((s) => s.id).sort()).toEqual(["shipped", "stuck", "working"]);

    await Story.create({ id: "s", rfc_id: "0136-trailmap", status: "ready" });
    const reloaded = await Rfc.findBy({ id: "0136-trailmap" });
    expect((await reloaded!.stories.toArray()).map((s) => s.id).sort()).toEqual(["s", "shipped", "stuck", "working"]);
  });
});
