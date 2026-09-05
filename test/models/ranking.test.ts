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
  comparePriority,
  effectivePriority,
  isDepResolved,
  priorityContext,
  summarizeBundle,
} from "../../app/models/concerns/ranking.js";

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
    expect(index.stories.map((s) => s.id)).toEqual(["dependent", "base"]);
  });
});
