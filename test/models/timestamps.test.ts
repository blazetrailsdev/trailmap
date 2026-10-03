import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "./schema.js";
import { pinTimestampColumns } from "../../app/models/timestamps.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

interface PinnedModel {
  _timestampAttributesForCreateInModel: string[];
  _timestampAttributesForUpdateInModel: string[];
  _allTimestampAttributesInModel: string[];
  reloadSchemaFromCache?: () => void;
}

describe("pinTimestampColumns", () => {
  it("reports the pinned columns", () => {
    const model = {} as PinnedModel;
    pinTimestampColumns(model, { create: ["created_at", "updated_at"], update: ["updated_at"] });

    expect(model._timestampAttributesForCreateInModel).toEqual(["created_at", "updated_at"]);
    expect(model._timestampAttributesForUpdateInModel).toEqual(["updated_at"]);
    expect(model._allTimestampAttributesInModel).toEqual(["created_at", "updated_at"]);
  });

  it("accepts and ignores the library's cache reset", () => {
    // The whole point of the accessor: `reloadSchemaFromCache` nils these
    // whenever column information is loaded, and a plain assignment therefore
    // survives only until the first schema load.
    const model = {} as PinnedModel;
    pinTimestampColumns(model, { create: ["created_at"], update: ["updated_at"] });

    (model as unknown as Record<string, unknown>)._timestampAttributesForUpdateInModel = null;

    expect(model._timestampAttributesForUpdateInModel).toEqual(["updated_at"]);
  });

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

    // The cache is library-internal, so it is not on the public class type.
    expect((Story as unknown as PinnedModel)._timestampAttributesForUpdateInModel).toEqual([
      "updated_at",
    ]);
    expect((Rfc as unknown as PinnedModel)._timestampAttributesForUpdateInModel).toEqual([
      "updated_at",
    ]);
  });
});
