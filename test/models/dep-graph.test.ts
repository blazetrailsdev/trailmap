import { beforeAll, describe, expect, it } from "vitest";
import { Notifications } from "@blazetrails/activesupport";
import { migrateScratchDatabase } from "./schema.ts";
import { Rfc, Story, StoryDep, loadModelSchemas } from "../../app/models/index.ts";
import { depGraphFor } from "../../app/models/concerns/dep-graph.ts";

async function chain(...ids: string[]): Promise<void> {
  for (let i = 0; i + 1 < ids.length; i += 1) {
    await new StoryDep({ story_id: ids[i], depends_on_id: ids[i + 1] }).save({ validate: false });
  }
}

async function queriesFor(id: string): Promise<number> {
  let queries = 0;
  const subscriber = Notifications.subscribe("sql.active_record", () => queries++);
  try {
    await depGraphFor(id);
  } finally {
    Notifications.unsubscribe(subscriber);
  }
  return queries;
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({ id: "active", status: "active", title: "Active" });
  await Rfc.create({ id: "drafted", status: "draft", title: "Drafted" });
  const story = (id: string, status: string, rfc = "active") =>
    Story.create({ id, rfc_id: rfc, status, title: `Title of ${id}` });

  // top → middle → bottom, and `held` is a ready story under a draft RFC.
  await story("top", "ready");
  await story("middle", "in-progress");
  await story("bottom", "done");
  await story("held", "ready", "drafted");
  await chain("top", "middle", "bottom");
  await chain("middle", "held");
  await chain("top", "vanished");

  // A cycle, which ingest refuses and a hand-edited database can still hold.
  for (const id of ["loop-a", "loop-b", "loop-c"]) await story(id, "ready");
  await chain("loop-a", "loop-b", "loop-c", "loop-a");

  // One story with a single dep, and one with eight on the same level.
  await story("narrow", "ready");
  await story("wide", "ready");
  await story("narrow-dep", "done");
  await chain("narrow", "narrow-dep");
  for (let n = 0; n < 8; n += 1) {
    await story(`wide-dep-${n}`, "done");
    await chain("wide", `wide-dep-${n}`);
  }
});

describe("depGraphFor", () => {
  it("lists what blocks a story transitively, nearest first, with how each was reached", async () => {
    const { blockedBy, cyclic } = await depGraphFor("top");

    expect(blockedBy.map((n) => [n.id, n.depth, n.via])).toEqual([
      ["middle", 1, null],
      ["vanished", 1, null],
      ["bottom", 2, "middle"],
      ["held", 2, "middle"],
    ]);
    expect(cyclic).toBe(false);
  });

  it("lists what a story blocks transitively", async () => {
    const { blocks, blockedBy } = await depGraphFor("bottom");

    expect(blocks.map((n) => [n.id, n.depth, n.via])).toEqual([
      ["middle", 1, null],
      ["top", 2, "middle"],
    ]);
    expect(blockedBy).toEqual([]);
  });

  it("gives each node its effective status, and an unknown story none", async () => {
    const { blockedBy } = await depGraphFor("top");
    const status = new Map(blockedBy.map((n) => [n.id, n.status]));

    expect(status.get("middle")).toBe("in-progress");
    expect(status.get("bottom")).toBe("done");
    // `ready` under a draft RFC gates for as long as the RFC is a draft.
    expect(status.get("held")).toBe("draft");
    expect(status.get("vanished")).toBe("");
    expect(blockedBy.find((n) => n.id === "bottom")?.title).toBe("Title of bottom");
  });

  it("walks a cycle once and stops, in both directions", async () => {
    const { blockedBy, blocks, cyclic } = await depGraphFor("loop-a");

    expect(blockedBy.map((n) => n.id)).toEqual(["loop-b", "loop-c"]);
    expect(blocks.map((n) => n.id)).toEqual(["loop-c", "loop-b"]);
    expect(cyclic).toBe(true);
  });

  it("costs the same queries for eight deps on a level as for one", async () => {
    expect(await queriesFor("wide")).toBe(await queriesFor("narrow"));
  });
});
