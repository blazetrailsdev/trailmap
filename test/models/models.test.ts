import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { migrateScratchDatabase } from "./schema.js";
import {
  Event,
  Meta,
  RESOLVED_DEP_STATUSES,
  RFC_STATUSES,
  Rfc,
  STORY_STATUSES,
  Story,
  StoryDep,
  StoryPackage,
  StoryPath,
  StoryRfcDep,
  loadModelSchemas,
} from "../../app/models/index.js";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({ id: "0061-ci-failures", status: "active", title: "CI failures" });
  await Rfc.create({ id: "0002-draft-rfc", status: "draft", title: "Draft" });

  await Story.create({ id: "base", rfc_id: "0061-ci-failures", status: "done", est_loc: 10 });
  await Story.create({ id: "dependent", rfc_id: "0061-ci-failures", status: "ready", est_loc: 20 });
  await Story.create({ id: "blocked-one", rfc_id: "0061-ci-failures", status: "ready" });
  await StoryDep.create({ story_id: "dependent", depends_on_id: "base" });
  await StoryPath.create({ story_id: "dependent", path: "packages/activerecord/src/relation.ts" });
  await StoryPackage.create({ story_id: "dependent", package: "activerecord" });
  await StoryRfcDep.create({ story_id: "dependent", rfc_id: "0002-draft-rfc" });
});

describe("models", () => {
  it("enum generates predicates and scopes", async () => {
    const s = await Story.findBy({ id: "base" });
    expect(s!.isDone()).toBe(true);
    expect(await Story.ready().count()).toBe(2);
  });

  it("generates a scope and a predicate for every status", async () => {
    const s = await Story.findBy({ id: "dependent" });
    expect(s!.isReady()).toBe(true);
    expect(s!.isDone()).toBe(false);
    expect(await Story.done().count()).toBe(1);
    expect(await Story.claimed().count()).toBe(0);
    expect(await Rfc.active().count()).toBe(1);
    expect(await Rfc.closed().count()).toBe(0);
  });

  it("stores the hyphenated enum value, not the camelCase label", async () => {
    const s = await Story.findBy({ id: "dependent" });
    s!.status = "in-progress";
    await s!.save();
    const raw = (
      await (await Base.leaseConnection()).selectAll("SELECT status FROM stories WHERE id='dependent'")
    ).toArray();
    expect(raw[0].status).toBe("in-progress");
    s!.status = "ready";
    await s!.save();
  });

  it("resolves belongsTo", async () => {
    const s = await Story.findBy({ id: "dependent" });
    const rfc = await s!.rfc;
    expect((rfc as Rfc).id).toBe("0061-ci-failures");
  });

  it("walks the self-referential has_many-through dep graph", async () => {
    const s = await Story.findBy({ id: "dependent" });
    const deps = await s!.deps.toArray();
    expect(deps.map((d) => d.id)).toEqual(["base"]);
    expect(deps[0].status).toBe("done");
  });

  it("walks hasMany paths", async () => {
    const s = await Story.findBy({ id: "dependent" });
    const paths = await s!.paths.toArray();
    expect(paths.map((p) => p.path)).toEqual(["packages/activerecord/src/relation.ts"]);
  });

  it("walks hasMany packages", async () => {
    const s = await Story.findBy({ id: "dependent" });
    const packages = await s!.packages.toArray();
    expect(packages.map((p) => p.package)).toEqual(["activerecord"]);
  });

  it("walks hasMany rfcDeps through the RFC-dep join", async () => {
    const s = await Story.findBy({ id: "dependent" });
    const rfcDeps = await s!.rfcDeps.toArray();
    expect(rfcDeps.map((r) => r.id)).toEqual(["0002-draft-rfc"]);
    expect(rfcDeps[0].isActive()).toBe(false);
  });

  it("walks an RFC back to its stories", async () => {
    const rfc = await Rfc.findBy({ id: "0061-ci-failures" });
    const stories = await rfc!.stories.toArray();
    expect(stories.map((s) => s.id).sort()).toEqual(["base", "blocked-one", "dependent"]);
  });

  it("resolves the atomic claim by affected-row count", async () => {
    const won = await Story.where({ id: "blocked-one", status: "ready" }).updateAll({
      status: "claimed",
      assignee: "agent-1",
    });
    const lost = await Story.where({ id: "blocked-one", status: "ready" }).updateAll({
      status: "claimed",
      assignee: "agent-2",
    });
    expect(won).toBe(1);
    expect(lost).toBe(0);
    const after = await Story.findBy({ id: "blocked-one" });
    expect(after!.assignee).toBe("agent-1");
  });

  it("round-trips meta watermarks", async () => {
    expect(await Meta.get("last_ingested_sha")).toBeNull();
    await Meta.set("last_ingested_sha", "abc123");
    expect(await Meta.get("last_ingested_sha")).toBe("abc123");
    await Meta.set("last_ingested_sha", "def456");
    expect(await Meta.get("last_ingested_sha")).toBe("def456");
    expect(await Meta.count()).toBe(1);
  });

  it("appends events", async () => {
    await Event.create({ at: new Date().toISOString(), verb: "done", story_id: "base", pr: "trails#7027" });
    expect(await Event.where({ verb: "done" }).count()).toBe(1);
  });

  it("carries the status constants across unchanged", () => {
    expect(STORY_STATUSES).toEqual([
      "draft",
      "ready",
      "claimed",
      "in-progress",
      "done",
      "blocked",
      "closed",
    ]);
    expect(RFC_STATUSES).toEqual(["draft", "active", "closed", "postponed", "superseded"]);
    // A closed story will never ship, but it will also never block.
    expect(RESOLVED_DEP_STATUSES).toEqual(["done", "closed"]);
  });
});

/**
 * The JSON-array columns are `serialize`d on `Rfc`. The tolerant arms are the
 * point: `ingest` writes text, and a reader that threw on a malformed value
 * would take a page down over a column nothing renders.
 */
describe("Rfc's serialized array columns", () => {
  // Raw SQL, as ingest writes it: `updateAll` would cast through the coder.
  async function stored(packages: string): Promise<string[]> {
    await Rfc.findOrCreateBy({ id: "0009-coded", status: "active" });
    (await Base.leaseConnection()).execute(
      `UPDATE rfcs SET packages = ${packages} WHERE id = '0009-coded'`,
    );
    return (await Rfc.findBy({ id: "0009-coded" }))!.packages;
  }

  it("decodes a stored JSON array", async () => {
    expect(await stored(`'["activerecord","trailties"]'`)).toEqual(["activerecord", "trailties"]);
  });

  it("reads an absent column as an empty list", async () => {
    expect(await stored("NULL")).toEqual([]);
    expect(await stored("''")).toEqual([]);
  });

  it("reads unparseable text, and valid JSON that is not an array, as empty", async () => {
    expect(await stored("'not json'")).toEqual([]);
    expect(await stored(`'{"a":1}'`)).toEqual([]);
  });

  it("writes an array as the text ingest writes, and does not dirty an unset one", async () => {
    const rfc = await Rfc.create({ id: "0010-written", status: "active", packages: ["a", "b"] });
    const raw = await (await Base.leaseConnection()).selectRows(
      "SELECT packages, clusters FROM rfcs WHERE id = '0010-written'",
    );
    expect(raw).toEqual([['["a","b"]', null]]);
    const reloaded = (await Rfc.findBy({ id: rfc.id }))!;
    expect(reloaded.isChanged).toBe(false);

    // Assigning null never reaches the coder's `dump`: the column goes NULL.
    await reloaded.update({ packages: null as unknown as string[] });
    expect(
      await (await Base.leaseConnection()).selectValue("SELECT packages FROM rfcs WHERE id = '0010-written'"),
    ).toBeNull();
  });
});
