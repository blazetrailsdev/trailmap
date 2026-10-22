/**
 * The ready queue, moved off the CLI's src/ranking.ts and onto the model.
 *
 * These assert the ported contract itself — the two claimability gates, the
 * priority ordering, and the knapsack's budget semantics — because the whole
 * point of moving the queue verbatim is that it cannot silently reorder
 * anyone's work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Rfc, Story, StoryDep, StoryPath, StoryRfcDep, loadModelSchemas } from "../../app/models/index.js";
import {
  bestBundle,
  claimableIn,
  comparePriority,
  effectivePriority,
  isDepResolved,
  listFilteredIn,
  priorityContext,
  summarizeBundle,
} from "../../app/models/concerns/ranking.js";

import { serializeStories } from "../../app/serializers/story-json.js";

// The RFC auto-close rule reports on stdout; the assertions read rows.
vi.spyOn(console, "log").mockImplementation(() => {});

/** Seed a status without going through a save — see rfc-close.test.ts. */
async function seed(id: string, rfcId: string, status: string, attrs: object = {}): Promise<void> {
  await Story.create({ id, rfc_id: rfcId, status: "draft", ...attrs });
  await Story.where({ id }).updateAll({ status });
}

beforeEach(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "Trailmap" });
  await Rfc.create({ id: "0002-draft", status: "draft", title: "Draft" });
});

describe("Story.claimable", () => {
  it("returns ready stories under an active RFC", async () => {
    await seed("a", "0136-trailmap", "ready");
    await seed("b", "0136-trailmap", "draft");
    expect((await Story.claimable()).map((s) => s.id)).toEqual(["a"]);
  });

  it("is distinct from the enum-generated Story.ready() scope", async () => {
    // A `ready` story under a non-active RFC: `ready` yes, claimable no.
    // Conflating the two would hand agents unclaimable stories.
    await seed("stale", "0002-draft", "ready");
    expect(await Story.ready().count()).toBe(1);
    expect(await Story.claimable()).toEqual([]);
  });

  it("excludes a story whose dep is neither done nor closed", async () => {
    await seed("base", "0136-trailmap", "in-progress");
    await seed("dependent", "0136-trailmap", "ready");
    await StoryDep.create({ story_id: "dependent", depends_on_id: "base" });
    expect(await Story.claimable()).toEqual([]);

    // A closed dep resolves it: a closed story will never ship, but it will
    // also never block.
    await Story.where({ id: "base" }).updateAll({ status: "closed" });
    expect((await Story.claimable()).map((s) => s.id)).toEqual(["dependent"]);
  });

  it("excludes a story whose RFC dep is still open", async () => {
    await seed("waits", "0136-trailmap", "ready");
    await StoryRfcDep.create({ story_id: "waits", rfc_id: "0002-draft" });
    expect(await Story.claimable()).toEqual([]);
    await Rfc.where({ id: "0002-draft" }).updateAll({ status: "closed" });
    expect((await Story.claimable()).map((s) => s.id)).toEqual(["waits"]);
  });

  it("orders by priority: lower N first, unprioritised last, ties in index order", async () => {
    await seed("none-one", "0136-trailmap", "ready");
    await seed("p2", "0136-trailmap", "ready", { priority: 2 });
    await seed("none-two", "0136-trailmap", "ready");
    await seed("p1", "0136-trailmap", "ready", { priority: 1 });
    expect((await Story.claimable()).map((s) => s.id)).toEqual([
      "p1",
      "p2",
      "none-one",
      "none-two",
    ]);
  });

  it("scopes to one RFC when asked", async () => {
    await Rfc.create({ id: "0137-other", status: "active", title: "Other" });
    await seed("here", "0136-trailmap", "ready");
    await seed("there", "0137-other", "ready");
    expect((await Story.claimable({ rfc: "0137-other" })).map((s) => s.id)).toEqual(["there"]);
  });
});

describe("Story.rankingOutline", () => {
  // The backlog ranks from the outline and the agents claim from the index.
  // If the two could order the queue differently the page would advertise a
  // pick order nothing follows.
  it("ranks the queue exactly as the index of records does", async () => {
    await seed("none-one", "0136-trailmap", "ready");
    await seed("p2", "0136-trailmap", "ready", { priority: 2 });
    await seed("p1", "0136-trailmap", "ready", { priority: 1 });
    await seed("base", "0136-trailmap", "in-progress");
    await seed("blocked-by-dep", "0136-trailmap", "ready", { priority: 0 });
    await StoryDep.create({ story_id: "blocked-by-dep", depends_on_id: "base" });
    await seed("waits", "0136-trailmap", "ready");
    await StoryRfcDep.create({ story_id: "waits", rfc_id: "0002-draft" });
    await seed("under-draft", "0002-draft", "ready");

    const [index, outline] = [await Story.rankingIndex(), await Story.rankingOutline()];

    expect(claimableIn(outline).map((s) => s.id)).toEqual(["p1", "p2", "none-one"]);
    expect(claimableIn(outline).map((s) => s.id)).toEqual(claimableIn(index).map((s) => s.id));
    expect(outline.stories).toEqual(
      index.stories.map((s) => ({
        id: s.id,
        rfc_id: s.rfc_id,
        status: s.status,
        priority: s.priority,
      })),
    );
    expect(outline.deps).toEqual(index.deps);
    expect(outline.rfcDeps).toEqual(index.rfcDeps);
  });

  it("builds no Story", async () => {
    await seed("one", "0136-trailmap", "ready");
    const built = vi.spyOn(Story, "_loadFromSql");
    try {
      await Story.rankingOutline();
      expect(built).not.toHaveBeenCalled();
    } finally {
      built.mockRestore();
    }
  });
});

// The JSON read endpoints. Each has to answer exactly as the index of records
// does, which is what "byte-identical" rests on, without building it.
describe("Story.readyQueue and Story.bundle", () => {
  it("answers the queue and the bundle as the index of records does, with records for the answered rows alone", async () => {
    await seed("lead", "0136-trailmap", "ready", { cluster: "c1", est_loc: 50, priority: 1 });
    await seed("mate", "0136-trailmap", "ready", { cluster: "c1", est_loc: 100 });
    await seed("other", "0136-trailmap", "ready", { cluster: "c2", est_loc: 10 });
    await seed("base", "0136-trailmap", "in-progress", { cluster: "c1", est_loc: 10 });
    await seed("held", "0136-trailmap", "ready", { cluster: "c1", est_loc: 20 });
    await StoryDep.create({ story_id: "held", depends_on_id: "base" });
    await seed("under-draft", "0002-draft", "ready", { cluster: "c1", est_loc: 30 });

    const full = await Story.rankingIndex();
    const attrs = (stories: Story[]) => stories.map((s) => s.attributes);

    const queue = await Story.readyQueue();
    expect(attrs(queue.stories)).toEqual(attrs(await Story.claimable({ index: full })));
    expect(queue.stories.every((s) => s instanceof Story)).toBe(true);

    const bundle = await Story.bundle({ maxLoc: 700 });
    expect(attrs(bundle.stories)).toEqual(attrs(await Story.nextBundle({ index: full, maxLoc: 700 })));
    expect(bundle.stories.map((s) => s.id)).toEqual(["lead", "mate"]);
    expect(bundle.stories.every((s) => s instanceof Story)).toBe(true);
    expect(bundle.emptyReason).toBeNull();
  });

  it("scopes the queue to an RFC, and names why a bundle came back empty", async () => {
    await seed("ours", "0136-trailmap", "ready", { cluster: "c1", est_loc: 50 });
    await seed("theirs", "0004-other", "ready", { cluster: "c1", est_loc: 50 });
    await Rfc.create({ id: "0004-other", status: "active", title: "Other" });

    expect((await Story.readyQueue({ rfc: "0136-trailmap" })).stories.map((s) => s.id)).toEqual(["ours"]);
    expect((await Story.bundle({ maxLoc: 10 })).emptyReason).toBe("none-within-budget");
    expect((await Story.bundle({ maxLoc: 700, cluster: "nope" })).emptyReason).toBe("no-matching-stories");
  });

  it("serves no story that stopped being claimable, or was deleted, between its two reads", async () => {
    await seed("taken", "0136-trailmap", "ready");
    await seed("gone", "0136-trailmap", "ready");
    await seed("stays", "0136-trailmap", "ready");
    const where = Story.where.bind(Story);
    const race = vi.spyOn(Story, "where").mockImplementation(((...args: Parameters<typeof Story.where>) => {
      race.mockRestore();
      return { toArray: async () => {
        await Story.where({ id: "taken" }).updateAll({ status: "claimed" });
        await Story.where({ id: "gone" }).deleteAll();
        return where(...args).toArray();
      } };
    }) as never);

    expect((await Story.readyQueue()).stories.map((s) => s.id)).toEqual(["stays"]);
  });
});

describe("Story.rankingRows", () => {
  it("serializes every story as the index of records does, and builds no Story", async () => {
    await seed("full", "0136-trailmap", "claimed", {
      title: "T", cluster: "c1", est_loc: 50, priority: 1, pr: "trailmap#7", assignee: "a",
      claim_at: "2026-09-01T00:00:00Z", updated_on: "2026-09-01", file_path: "rfcs/x.md",
    });
    await seed("bare", "0002-draft", "ready");
    await StoryPath.create({ story_id: "full", path: "app/x.ts" });
    const full = await Story.rankingIndex();
    const built = vi.spyOn(Story, "_loadFromSql");
    try {
      const rows = await Story.rankingRows();

      expect(built).not.toHaveBeenCalled();
      // Rows are plain objects, so a reader on this path that called a record
      // method would throw here: the filter and the serializer both run.
      expect(rows.stories.some((row) => row instanceof Story)).toBe(false);
      expect(listFilteredIn(rows, { status: "claimed" }).map((s) => s.id)).toEqual(["full"]);
      expect(JSON.stringify(serializeStories(rows.stories, rows))).toBe(
        JSON.stringify(serializeStories(full.stories, full)),
      );
    } finally {
      built.mockRestore();
    }
  });
});

describe("Story.nextBundle", () => {
  it("packs the highest-value same-cluster bundle within the budget", async () => {
    await seed("x", "0136-trailmap", "ready", { cluster: "c1", est_loc: 300 });
    await seed("y", "0136-trailmap", "ready", { cluster: "c1", est_loc: 400 });
    await seed("z", "0136-trailmap", "ready", { cluster: "c2", est_loc: 100 });
    const bundle = await Story.nextBundle({ maxLoc: 700 });
    expect(bundle.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("leads with the highest-priority story even when it fills the budget worse", async () => {
    await seed("lead", "0136-trailmap", "ready", { cluster: "c1", est_loc: 50, priority: 1 });
    await seed("fat", "0136-trailmap", "ready", { cluster: "c2", est_loc: 600 });
    await seed("mate", "0136-trailmap", "ready", { cluster: "c1", est_loc: 100 });
    expect((await Story.nextBundle({ maxLoc: 700 })).map((s) => s.id)).toEqual(["lead", "mate"]);
  });

  it("excludes stories with no estimate from the unprioritised knapsack", async () => {
    await seed("sized", "0136-trailmap", "ready", { cluster: "c1", est_loc: 100 });
    await seed("unsized", "0136-trailmap", "ready", { cluster: "c1" });
    expect((await Story.nextBundle({ maxLoc: 700 })).map((s) => s.id)).toEqual(["sized"]);
  });

  it("reports why an empty bundle is empty", async () => {
    expect(await Story.emptyBundleReason({})).toBe("no-matching-stories");
    await seed("big", "0136-trailmap", "ready", { est_loc: 900 });
    expect(await Story.emptyBundleReason({})).toBe("none-within-budget");
  });
});

describe("Story.touching", () => {
  it("prefers an exact path hit over the looser tiers", async () => {
    await seed("exact", "0136-trailmap", "ready");
    await seed("under", "0136-trailmap", "ready");
    await StoryPath.create({ story_id: "exact", path: "app/models/story.ts" });
    await StoryPath.create({ story_id: "under", path: "app/models/rfc.ts" });
    expect((await Story.touching("app/models/story.ts")).map((s) => s.id)).toEqual(["exact"]);
    expect((await Story.touching("app/models")).map((s) => s.id)).toEqual(["exact", "under"]);
  });

  it("skips terminal stories unless asked for all", async () => {
    await seed("shipped", "0136-trailmap", "done");
    await StoryPath.create({ story_id: "shipped", path: "app/models/story.ts" });
    expect(await Story.touching("app/models/story.ts")).toEqual([]);
    expect((await Story.touching("app/models/story.ts", { all: true })).map((s) => s.id)).toEqual([
      "shipped",
    ]);
  });
});

describe("Story.listFiltered", () => {
  it("filters by rfc, status and cluster", async () => {
    await seed("one", "0136-trailmap", "ready", { cluster: "c1" });
    await seed("two", "0136-trailmap", "draft", { cluster: "c1" });
    expect((await Story.listFiltered({ status: "ready" })).map((s) => s.id)).toEqual(["one"]);
    expect((await Story.listFiltered({ cluster: "c1" })).length).toBe(2);
    expect(await Story.listFiltered({ rfc: "0002-draft" })).toEqual([]);
  });
});

describe("the pure ranking helpers", () => {
  it("treats done and closed — and nothing else — as a resolved dep", () => {
    expect(isDepResolved("done")).toBe(true);
    expect(isDepResolved("closed")).toBe(true);
    expect(isDepResolved("in-progress")).toBe(false);
    expect(isDepResolved(null)).toBe(false);
  });

  it("falls back from the story's priority to its RFC's, then to Infinity", async () => {
    await Rfc.where({ id: "0136-trailmap" }).updateAll({ priority: 5 });
    await seed("own", "0136-trailmap", "ready", { priority: 1 });
    await seed("inherited", "0136-trailmap", "ready");
    await seed("neither", "0002-draft", "ready");
    const index = await Story.rankingIndex();
    const by = (id: string): Story => index.stories.find((s) => s.id === id)!;
    expect(effectivePriority(by("own"), index.rfcPriority)).toBe(1);
    expect(effectivePriority(by("inherited"), index.rfcPriority)).toBe(5);
    expect(effectivePriority(by("neither"), index.rfcPriority)).toBe(Infinity);
  });

  it("breaks a same-RFC-priority tie by which RFC has less left to do", async () => {
    await Rfc.create({ id: "0137-other", status: "active", title: "Other", priority: 3 });
    await Rfc.where({ id: "0136-trailmap" }).updateAll({ priority: 2 });
    await seed("busy", "0136-trailmap", "ready");
    await seed("busy-two", "0136-trailmap", "ready");
    await seed("borrowed", "0137-other", "ready", { priority: 2 });
    const index = await Story.rankingIndex();
    const ctx = priorityContext(index);
    const by = (id: string): Story => index.stories.find((s) => s.id === id)!;
    // Equal EFFECTIVE priority but different RFC priorities: the tie-break is
    // about how much of one prioritised RFC is left, so it must not fire here.
    expect(comparePriority(by("busy"), by("borrowed"), ctx)).toBe(0);

    // Now both RFCs are priority 2, so the one with fewer stories left wins.
    await Rfc.where({ id: "0137-other" }).updateAll({ priority: 2 });
    const ctx2 = priorityContext(await Story.rankingIndex());
    expect(comparePriority(by("busy"), by("borrowed"), ctx2)).toBeGreaterThan(0);
  });

  it("packs the knapsack to the best total within the budget", async () => {
    await seed("a", "0136-trailmap", "ready", { est_loc: 300 });
    await seed("b", "0136-trailmap", "ready", { est_loc: 400 });
    await seed("c", "0136-trailmap", "ready", { est_loc: 500 });
    const items = (await Story.rankingIndex()).stories;
    expect(bestBundle(items, 700).map((s) => s.id)).toEqual(["a", "b"]);
    expect(bestBundle(items, 0)).toEqual([]);
    expect(bestBundle([], 700)).toEqual([]);
  });

  it("totals a bundle and flags one that overruns its budget", async () => {
    await seed("only", "0136-trailmap", "ready", { est_loc: 900 });
    const rows = (await Story.rankingIndex()).stories;
    expect(summarizeBundle(rows, 700)).toEqual({ total: 900, leadExceedsBudget: true });
    expect(summarizeBundle(rows, 900).leadExceedsBudget).toBe(false);
  });
});

describe("the parent-RFC status override in list", () => {
  it("filters on the effective status, so an unclaimable ready story lists as draft", async () => {
    await seed("stale", "0002-draft", "ready");
    expect((await Story.listFiltered({ status: "ready" })).map((s) => s.id)).toEqual([]);
    expect((await Story.listFiltered({ status: "draft" })).map((s) => s.id)).toEqual(["stale"]);
  });
});

describe("Story.rankingIndex", () => {
  it("collects the association rows the queue reads into maps", async () => {
    await seed("dependent", "0136-trailmap", "ready");
    await seed("base", "0136-trailmap", "done");
    await StoryDep.create({ story_id: "dependent", depends_on_id: "base" });
    await StoryRfcDep.create({ story_id: "dependent", rfc_id: "0002-draft" });
    await StoryPath.create({ story_id: "dependent", path: "app/models/story.ts" });
    const index = await Story.rankingIndex();
    expect(index.deps.get("dependent")).toEqual(["base"]);
    expect(index.rfcDeps.get("dependent")).toEqual(["0002-draft"]);
    expect(index.paths.get("dependent")).toEqual(["app/models/story.ts"]);
    expect(index.rfcStatus.get("0002-draft")).toBe("draft");
    // (priority, id), matching the order the CLI's index.json is sorted into —
    // not insertion order.
    expect(index.stories.map((s) => s.id)).toEqual(["base", "dependent"]);
  });

  it("sorts stories by priority then id, the way the CLI's index is sorted", async () => {
    await seed("zebra", "0136-trailmap", "ready");
    await seed("alpha", "0136-trailmap", "ready");
    await seed("urgent", "0136-trailmap", "ready", { priority: 1 });
    const index = await Story.rankingIndex();
    expect(index.stories.map((s) => s.id)).toEqual(["urgent", "alpha", "zebra"]);
  });
});
