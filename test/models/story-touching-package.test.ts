import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "./schema.ts";
import { Story } from "../../app/models/story.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { StoryPackage } from "../../app/models/story-package.ts";
import { StoryPath } from "../../app/models/story-path.ts";
import { OPEN_STORY_STATUSES } from "../../app/models/concerns/ranking.ts";
import { effectiveStoryStatus } from "../../app/models/concerns/effective-status.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";

async function story(id: string, rfcId: string, paths: string[] = [], packages: string[] = []) {
  await Story.create({ id, rfc_id: rfcId, status: "ready" });
  for (const path of paths) await StoryPath.create({ story_id: id, path });
  for (const pkg of packages) await StoryPackage.create({ story_id: id, package: pkg });
}

const ids = (stories: Story[]) => stories.map((s) => s.id).sort();

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0001-wide", status: "active", packages: ["activerecord", "actionpack"] });
  await Rfc.create({ id: "0002-narrow", status: "active", packages: ["activerecord"] });
  await story("own", "0001-wide", ["packages/activerecord/src/base.ts"], ["activesupport"]);
  await story("pathed", "0001-wide", ["packages/actionpack/src/x.ts", "packages/actionpack/src/y.ts"]);
  await story("inherited", "0002-narrow");
  await story("non-package-path", "0002-narrow", ["scripts/y.ts"]);
  await story("bare-dir", "0001-wide", ["packages/actionview"]);
  await story("orphan", "0001-wide");
  await story("scripts-only", "0001-wide", ["scripts/z.ts"]);
  await Rfc.create({ id: "0003-shipped", status: "closed", packages: ["railties"] });
  await story("in-closed-rfc", "0003-shipped");
  await Story.create({ id: "finished", rfc_id: "0003-shipped", status: "done" });
});

describe("Story.touchingPackage", () => {
  it("matches a story's own packages, and an own list beats its paths", async () => {
    expect(ids(await Story.touchingPackage("activesupport"))).toEqual(["own"]);
  });

  it("falls back to a path under packages/<name>/, once per story", async () => {
    expect(ids(await Story.touchingPackage("actionpack"))).toEqual(["pathed"]);
  });

  it("does not read packages/<name> with no trailing slash as under it", async () => {
    expect(await Story.touchingPackage("actionview")).toEqual([]);
  });

  it("falls back to an RFC listing exactly that one package, past non-package paths", async () => {
    expect(ids(await Story.touchingPackage("activerecord"))).toEqual(["inherited", "non-package-path"]);
  });

  it("lists the stories no rule attributes", async () => {
    expect(ids(await Story.unattributed())).toEqual(["bare-dir", "orphan", "scripts-only"]);
  });
});

describe("Story.openCountsByPackage", () => {
  it("counts open stories per attributed package and the unattributed ones", async () => {
    const { byPackage, unattributed } = await Story.openCountsByPackage();
    expect(byPackage.get("activesupport")).toBe(1);
    expect(byPackage.get("actionpack")).toBe(1);
    expect(byPackage.get("activerecord")).toBe(2);
    expect(byPackage.get("railties")).toBe(1);
    expect(unattributed).toBe(3);
  });

  it("agrees with the open subset of touchingPackage and unattributed", async () => {
    const rfcStatus = new Map((await Rfc.all().toArray()).map((r) => [r.id, r.status]));
    const open = (stories: Story[]) =>
      stories.filter((s) => {
        const status = effectiveStoryStatus(rfcStatus.get(s.rfc_id), s.status);
        return status != null && OPEN_STORY_STATUSES.includes(status);
      }).length;
    const { byPackage, unattributed } = await Story.openCountsByPackage();
    for (const pkg of ["activesupport", "actionpack", "activerecord", "actionview", "railties"]) {
      expect(byPackage.get(pkg) ?? 0).toBe(open(await Story.touchingPackage(pkg)));
    }
    expect(unattributed).toBe(open(await Story.unattributed()));
  });
});
