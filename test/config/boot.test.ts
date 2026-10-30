import { describe, expect, it } from "vitest";
import { Rfc, Story } from "../../app/models/index.ts";
import { migrateScratchDatabase } from "../models/schema.ts";
import { loadModelSchemas } from "../../app/models/index.ts";

describe("the suite boots the application", () => {
  it("requires belongs_to by default", async () => {
    await migrateScratchDatabase();
    await loadModelSchemas();
    const story = new Story({ id: "orphan", rfc_id: "0000-none", status: "draft" });
    expect(await story.save()).toBe(false);
    await Rfc.create({ id: "0000-none", status: "active", title: "T" });
    expect(await new Story({ id: "kept", rfc_id: "0000-none", status: "draft" }).save()).toBe(true);
  });
});
