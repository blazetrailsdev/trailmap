/**
 * The mutation verbs, moved off the CLI's src/verbs.ts and onto the model.
 *
 * Each guard here corresponds to a rule that was load-bearing in the CLI — a
 * lost claim race, a half-claimed bundle, a half-cleared row — so the guards
 * are what these tests are for, not the happy paths.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { VerbExit } from "../../app/models/verb-exit.js";

vi.spyOn(console, "log").mockImplementation(() => {});

beforeEach(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "Trailmap" });
  await Story.create({ id: "s1", rfc_id: "0136-trailmap", status: "ready", est_loc: 10 });
  await Story.create({ id: "s2", rfc_id: "0136-trailmap", status: "ready", est_loc: 20 });
});

const find = async (id: string): Promise<Story> => (await Story.findBy({ id }))!;

describe("claim", () => {
  it("wins once and reports the loser as a benign conflict, not an error", async () => {
    await Story.claimAll(["s1"], "agent-a");
    await expect(Story.claimAll(["s1"], "agent-b")).rejects.toMatchObject({ code: 2 });
    const s = await find("s1");
    expect(s.assignee).toBe("agent-a");
    expect(s.status).toBe("claimed");
  });

  it("treats re-claiming what we already hold as success", async () => {
    await Story.claimAll(["s1"], "agent-a");
    await expect(Story.claimAll(["s1"], "agent-a")).resolves.toEqual(["claimed s1 as agent-a"]);
  });

  it("is all-or-nothing: one taken id refuses the whole batch", async () => {
    await Story.claimAll(["s2"], "other");
    await expect(Story.claimAll(["s1", "s2"], "agent-a")).rejects.toBeInstanceOf(VerbExit);
    // s1 must NOT have been claimed — a half-claimed bundle strands stories as
    // `claimed` with nobody behind them, invisible to both the queue and the
    // merge sweep.
    expect((await find("s1")).status).toBe("ready");
  });

  it("records exactly one claim event for one successful claim", async () => {
    await Story.claimAll(["s1"], "agent-a");
    expect(await Event.where({ story_id: "s1", verb: "claim" }).count()).toBe(1);
  });

  it("refuses an unknown id", async () => {
    await expect(Story.claimAll(["nope"], "agent-a")).rejects.toMatchObject({
      code: 1,
      message: "story not found: nope",
    });
  });
});

describe("release", () => {
  it("returns a claimed story to ready and clears the holder", async () => {
    await Story.claimAll(["s1"], "agent-a");
    await Story.releaseAll(["s1"]);
    const s = await find("s1");
    expect(s.status).toBe("ready");
    expect(s.assignee).toBeNull();
    expect(s.claim_at).toBeNull();
  });

  it("refuses a story that is not claimed", async () => {
    await expect(Story.releaseAll(["s1"])).rejects.toMatchObject({
      code: 2,
      message: "s1 is ready, not claimed — nothing to release",
    });
  });
});

describe("markTracking", () => {
  it("stamps the PR and self-claims an unclaimed in-progress story", async () => {
    await Story.markTrackingAll(["s1"], "in-progress", "trails#42");
    const s = await find("s1");
    expect(s.status).toBe("in-progress");
    expect(s.pr).toBe("trails#42");
    expect(s.claim_at).not.toBeNull();
    expect(s.assignee).toBe("s1");
  });

  it("skips an id already at this status and pr rather than aborting the rest", async () => {
    await Story.markTrackingAll(["s1"], "done", "trails#7");
    expect(await Story.markTrackingAll(["s1", "s2"], "done", "trails#7")).toEqual([
      "done s1 (already, skipped)",
      "done s2 trails#7",
    ]);
    // The skip is what keeps a second `done` from doubling the event log.
    expect(await Event.where({ story_id: "s1", verb: "done" }).count()).toBe(1);
  });
});

describe("block", () => {
  it("records the reason on the row and in the event", async () => {
    await (await find("s1")).block("waiting on the API cutover");
    const s = await find("s1");
    expect(s.status).toBe("blocked");
    expect(s.blocked_by).toBe("waiting on the API cutover");
    const event = await Event.findBy({ story_id: "s1", verb: "block" });
    expect(event!.detail).toBe(JSON.stringify({ note: "waiting on the API cutover" }));
  });
});

describe("close", () => {
  it("requires a reason", async () => {
    await expect((await find("s1")).close("  ")).rejects.toMatchObject({
      code: 1,
      message: "close requires a reason",
    });
  });

  it("no-ops on an already-closed story", async () => {
    await (await find("s1")).close("superseded");
    expect(await (await find("s1")).close("superseded")).toBe("closed s1 (already, skipped)");
    expect(await Event.where({ story_id: "s1", verb: "close" }).count()).toBe(1);
  });

  it("clears the fields the old status owned", async () => {
    await (await find("s1")).block("stuck");
    await (await find("s1")).close("abandoned");
    const s = await find("s1");
    expect(s.closed_reason).toBe("abandoned");
    // A `blocked_by` surviving onto a closed story contradicts the row.
    expect(s.blocked_by).toBeNull();
  });
});

describe("statusSet", () => {
  it("clears a stale claim when moving to ready", async () => {
    await Story.claimAll(["s1"], "agent-a");
    await (await find("s1")).statusSet("ready");
    const s = await find("s1");
    expect(s.assignee).toBeNull();
    expect(s.pr).toBeNull();
    expect(await Event.where({ story_id: "s1", verb: "status" }).count()).toBe(1);
  });
});

describe("setPriority", () => {
  it("sets and clears the priority, recording each as an event", async () => {
    await (await find("s1")).setPriority(1);
    expect((await find("s1")).priority).toBe(1);
    await (await find("s1")).setPriority(null);
    expect((await find("s1")).priority).toBeNull();
    expect(await Event.where({ story_id: "s1", verb: "priority" }).count()).toBe(2);
  });
});

describe("recordSpawn", () => {
  it("records provenance without touching story state", async () => {
    await Story.recordSpawn(["s1"], "loop", { branch: "b", pane: "p" });
    const event = await Event.findBy({ story_id: "s1", verb: "spawn" });
    expect(event!.actor).toBe("loop");
    expect((await find("s1")).status).toBe("ready");
  });

  it("records an RFC-scoped dispatch against the rfc", async () => {
    await Story.recordSpawn([], "refine", { rfc: "0136-trailmap" });
    const event = await Event.findBy({ verb: "spawn" });
    expect(event!.rfc_id).toBe("0136-trailmap");
    expect(event!.story_id).toBeNull();
  });
});
