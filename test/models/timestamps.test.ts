import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "./schema.ts";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

interface TimestampedModel {
  timestampAttributesForUpdateInModel(): string[];
  allTimestampAttributesInModel(): string[];
}

describe("timestamp touch", () => {
  it("keeps a save off the date-only updated_on column", async () => {
    // `updated_on` is markdown's date-only `updated:` field. A full instant
    // written there makes the read-model build an Invalid Date, which takes
    // every verb down for everyone on the host.
    await Rfc.create({ id: "0136-trailmap", status: "active" });
    await Story.create({
      id: "s",
      rfc_id: "0136-trailmap",
      status: "ready",
      updated_on: "2026-08-28",
    });

    const story = await Story.findBy({ id: "s" });
    story!.status = "in-progress";
    await story!.save();

    const raw = (
      await (await Base.leaseConnection()).selectAll("SELECT updated_on, updated_at FROM stories WHERE id='s'")
    ).toArray();
    expect(raw[0].updated_on).toBe("2026-08-28");
    expect(String(raw[0].updated_at)).not.toBe("2026-08-28");
  });

  it("survives a schema reload on the real models", async () => {
    Story.reloadSchemaFromCache();
    await Story.loadSchema();

    // The resolved list is a cache the reload resets; it must be rebuilt
    // from the overridden statics, not the library's defaults.
    expect((Story as unknown as TimestampedModel).timestampAttributesForUpdateInModel()).toEqual([
      "updated_at",
    ]);
    expect((Rfc as unknown as TimestampedModel).allTimestampAttributesInModel()).toEqual([
      "created_at",
      "updated_at",
    ]);
  });
});
