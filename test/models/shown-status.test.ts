/** The display rule beside `effectiveStoryStatus`, in each of its three forms. */
import { beforeAll, describe, expect, it } from "vitest";
import { Rfc, Story, StoryDep, StoryRfcDep, loadModelSchemas } from "../../app/models/index.ts";
import { shownStoryStatus } from "../../app/models/concerns/effective-status.ts";
import { depHeldIn, isDepHeld, type RankingIndex, type RankedStory } from "../../app/models/concerns/ranking.ts";
import { migrateScratchDatabase } from "./schema.ts";

describe("shownStoryStatus", () => {
  it("shows a dep-held ready story as blocked, and nothing else", () => {
    expect(shownStoryStatus("active", "ready", true)).toBe("blocked");
    expect(shownStoryStatus("active", "ready", false)).toBe("ready");
    expect(shownStoryStatus("draft", "ready", true)).toBe("draft");
    expect(shownStoryStatus("active", "in-progress", true)).toBe("in-progress");
  });
});

describe("isDepHeld", () => {
  const deps = new Map([["s", ["d"]]]);
  const rfcDeps = new Map([["r", ["0001"]]]);
  it("holds on a story dep neither done nor closed, and on an RFC dep not closed", () => {
    const none = () => undefined;
    expect(isDepHeld("s", deps, rfcDeps, () => "ready", none)).toBe(true);
    expect(isDepHeld("s", deps, rfcDeps, () => "done", none)).toBe(false);
    expect(isDepHeld("s", deps, rfcDeps, () => "closed", none)).toBe(false);
    expect(isDepHeld("r", deps, rfcDeps, none, () => "active")).toBe(true);
    expect(isDepHeld("r", deps, rfcDeps, none, () => "closed")).toBe(false);
    expect(isDepHeld("free", deps, rfcDeps, none, none)).toBe(false);
  });
});

describe("depHeldIn", () => {
  it("names every story of a snapshot that waits on a dep", () => {
    const index = {
      stories: [
        { id: "a", rfc_id: "x", status: "ready" },
        { id: "b", rfc_id: "x", status: "ready" },
        { id: "c", rfc_id: "x", status: "done" },
      ],
      deps: new Map([["a", ["b"]], ["b", ["c"]]]),
      rfcDeps: new Map(),
      rfcStatus: new Map([["x", "active"]]),
    } as unknown as RankingIndex<RankedStory>;
    expect([...depHeldIn(index)]).toEqual(["a"]);
  });
});

describe("Story.depHeldIds", () => {
  beforeAll(async () => {
    await migrateScratchDatabase();
    await loadModelSchemas();
    await Rfc.create({ id: "0001-open", status: "active" });
    await Rfc.create({ id: "0002-shut", status: "closed" });
    await Story.create({ id: "dep-open", rfc_id: "0001-open", status: "ready" });
    await Story.create({ id: "dep-done", rfc_id: "0001-open", status: "done" });
    await Story.create({ id: "waits", rfc_id: "0001-open", status: "ready" });
    await Story.create({ id: "clear", rfc_id: "0001-open", status: "ready" });
    await Story.create({ id: "waits-rfc", rfc_id: "0001-open", status: "ready" });
    await StoryDep.create({ story_id: "waits", depends_on_id: "dep-open" });
    await StoryDep.create({ story_id: "clear", depends_on_id: "dep-done" });
    await StoryRfcDep.create({ story_id: "waits-rfc", rfc_id: "0001-open" });
    await StoryRfcDep.create({ story_id: "clear", rfc_id: "0002-shut" });
  });

  it("answers the held ones among the ids given, or across every story", async () => {
    expect([...(await Story.depHeldIds(["waits", "clear"]))]).toEqual(["waits"]);
    expect([...(await Story.depHeldIds())].sort()).toEqual(["waits", "waits-rfc"]);
    expect((await Story.depHeldIds([])).size).toBe(0);
  });
});
