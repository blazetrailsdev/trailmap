import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "./schema.ts";
import { Story } from "../../app/models/story.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { StoryPackage } from "../../app/models/story-package.ts";
import { StoryPath } from "../../app/models/story-path.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({
    id: "0001-wide",
    status: "active",
    packages: ["activerecord", "actionpack"],
  });
  await Rfc.create({
    id: "0002-narrow",
    status: "active",
    packages: ["activerecord"],
  });
  await Story.create({ id: "own", rfc_id: "0001-wide", status: "ready" });
  await StoryPackage.create({ story_id: "own", package: "activesupport" });
  await StoryPath.create({
    story_id: "own",
    path: "packages/activerecord/src/base.ts",
  });
  await Story.create({ id: "pathed", rfc_id: "0001-wide", status: "ready" });
  await StoryPath.create({
    story_id: "pathed",
    path: "packages/actionpack/src/x.ts",
  });
  await StoryPath.create({ story_id: "pathed", path: "scripts/y.ts" });
  await Story.create({
    id: "inherited",
    rfc_id: "0002-narrow",
    status: "ready",
  });
  await Story.create({ id: "orphan", rfc_id: "0001-wide", status: "ready" });
});

describe("Story.touchingPackage", () => {
  it("matches a story's own packages, and an own list beats its paths", async () => {
    expect(
      (await Story.touchingPackage("activesupport")).map((s) => s.id),
    ).toEqual(["own"]);
  });

  it("falls back to a path under packages/<name>/", async () => {
    expect(
      (await Story.touchingPackage("actionpack")).map((s) => s.id),
    ).toEqual(["pathed"]);
  });

  it("falls back to an RFC listing exactly that one package", async () => {
    expect(
      (await Story.touchingPackage("activerecord")).map((s) => s.id),
    ).toEqual(["inherited"]);
  });

  it("lists the stories no rule attributes", async () => {
    expect((await Story.unattributed()).map((s) => s.id)).toEqual(["orphan"]);
  });
});
