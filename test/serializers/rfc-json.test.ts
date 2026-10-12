/**
 * The RFC shape `index.json` carried. ringo unmarshals these rows into its
 * `rfc` struct, so the fields and their emptiness rules are a cross-repo
 * contract — which is what this pins.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, loadModelSchemas } from "../../app/models/index.js";
import { serializeRfc, serializeRfcs } from "../../app/serializers/rfc-json.js";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
});

describe("serializeRfc", () => {
  it("carries every field index.json carried, with the date columns at ISO midnight", async () => {
    const rfc = await Rfc.create({
      id: "0136-trailmap",
      title: "trailmap",
      status: "active",
      priority: 6,
      owner: "dean",
      created_on: "2026-08-25",
      updated_on: "2026-09-05",
      packages: ["activerecord","trailties"],
      clusters: ["api"],
      related_rfcs: ["0061-ci-failures"],
      file_path: "rfcs/0136-trailmap/README.md",
    });

    expect(serializeRfc(rfc)).toEqual({
      id: "0136-trailmap",
      title: "trailmap",
      status: "active",
      priority: 6,
      owner: "dean",
      created: "2026-08-25T00:00:00.000Z",
      updated: "2026-09-05T00:00:00.000Z",
      packages: ["activerecord", "trailties"],
      clusters: ["api"],
      superseded_by: null,
      related_rfcs: ["0061-ci-failures"],
      file_path: "rfcs/0136-trailmap/README.md",
    });
  });

  // The array columns are stored as TEXT by ingest. A consumer reading
  // `packages` expects a list, and an absent column has to read as an empty
  // list rather than null — the Go side ranges over it without a nil check.
  it("reads an absent or unparseable array column as an empty list", async () => {
    const rfc = await Rfc.create({ id: "0002-bare", status: "draft", packages: "not json" });

    expect(serializeRfc(rfc)).toMatchObject({
      packages: [],
      clusters: [],
      related_rfcs: [],
      title: null,
      priority: null,
      created: null,
      updated: null,
    });
  });

  it("serializes a list in the order it is given", async () => {
    const rfcs = await Rfc.where({ id: ["0136-trailmap", "0002-bare"] }).toArray();

    expect(serializeRfcs(rfcs).map((r) => r.id)).toEqual(rfcs.map((r) => r.id));
  });
});
