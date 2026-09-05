/**
 * The semantic half of validation, moved off the content repo's lint scripts.
 *
 * These assert the two things the split has to preserve: the rules still fire,
 * and they fire with the SAME MESSAGES validate-lib.mjs produced — a content
 * author should not be able to tell which half rejected them. They also pin the
 * `ingest` scoping, because a semantic rule leaking onto the mutation path
 * would let one bad row block every verb that touches it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Rfc, Story, StoryDep, StoryRfcDep, loadModelSchemas } from "../../app/models/index.js";
import { effectiveStoryStatus } from "../../app/models/concerns/effective-status.js";
import {
  MAX_EST_LOC,
  checkDepGraph,
  closedRfcErrors,
  depGraphMessages,
  estLocErrors,
  isTerminalStatus,
  lifecycleErrors,
} from "../../app/models/concerns/semantic-validation.js";

// The RFC auto-close rule reports on stdout; the assertions read rows.
vi.spyOn(console, "log").mockImplementation(() => {});

/** Seed a status without going through a save — see rfc-close.test.ts. */
async function seed(id: string, rfcId: string, status: string, attrs: object = {}): Promise<void> {
  await Story.create({ id, rfc_id: rfcId, status: "draft", ...attrs });
  await Story.where({ id }).updateAll({ status, ...attrs });
}

beforeEach(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "Trailmap" });
});

describe("effectiveStoryStatus", () => {
  it("downgrades a ready story under a non-active RFC, and nothing else", () => {
    expect(effectiveStoryStatus("draft", "ready")).toBe("draft");
    expect(effectiveStoryStatus(null, "ready")).toBe("draft");
    expect(effectiveStoryStatus("active", "ready")).toBe("ready");
    expect(effectiveStoryStatus("closed", "done")).toBe("done");
  });
});

describe("the pure rule functions", () => {
  /** A story-shaped record, without a save: these read fields, not rows. */
  const story = (attrs: object): Story => ({ status: "draft", ...attrs }) as unknown as Story;

  it("treats done and closed — and nothing else — as terminal", () => {
    expect(isTerminalStatus("done")).toBe(true);
    expect(isTerminalStatus("closed")).toBe(true);
    expect(isTerminalStatus("blocked")).toBe(false);
    expect(isTerminalStatus(null)).toBe(false);
  });

  it("reports every lifecycle violation on one story, not just the first", () => {
    expect(lifecycleErrors(story({ status: "in-progress", closed_reason: "oops" }))).toEqual([
      `status: in-progress requires a claim timestamp`,
      `status: in-progress requires an assignee`,
      `status: in-progress requires a pr`,
      `closed-reason is set but status is "in-progress" — only closed stories carry closed-reason`,
    ]);
  });

  it("shape-constrains neither done nor a story that satisfies its status", () => {
    expect(lifecycleErrors(story({ status: "done" }))).toEqual([]);
    expect(lifecycleErrors(story({ status: "blocked", blocked_by: "waiting on #1" }))).toEqual([]);
  });

  it("checks the est-loc ceiling only while the story still has to ship", () => {
    expect(estLocErrors(story({ status: "ready", est_loc: MAX_EST_LOC }))).toEqual([]);
    expect(estLocErrors(story({ status: "ready", est_loc: null }))).toEqual([]);
    expect(estLocErrors(story({ status: "closed", est_loc: 9000 }))).toEqual([]);
    expect(estLocErrors(story({ status: "ready", est_loc: 9000 }))).toEqual([
      `est-loc 9000 exceeds the ${MAX_EST_LOC} LOC per-PR ceiling`,
    ]);
  });

  it("says nothing about an RFC that is not closed", () => {
    const rfc = { id: "0136-trailmap", status: "active" } as unknown as Rfc;
    expect(closedRfcErrors(rfc, [story({ id: "open", status: "ready" })])).toEqual([]);
  });
});

describe("story lifecycle validations", () => {
  it("rejects a ready story that still carries a claim", async () => {
    await seed("s", "0136-trailmap", "ready", { assignee: "someone" });
    const story = (await Story.findBy({ id: "s" }))!;
    expect(await story.validate("ingest")).toBe(false);
    expect(story.errors.fullMessages).toContain(
      `status: ready must have null assignee (got "someone")`,
    );
  });

  it("rejects blocked-by on a story that is not blocked", async () => {
    await seed("s", "0136-trailmap", "done", { blocked_by: "waiting" });
    const story = (await Story.findBy({ id: "s" }))!;
    expect(await story.validate("ingest")).toBe(false);
    expect(story.errors.fullMessages).toContain(
      `blocked-by is set but status is "done" — only blocked stories carry blocked-by`,
    );
  });

  it("rejects an est-loc above the per-PR ceiling", async () => {
    await seed("s", "0136-trailmap", "ready", { est_loc: MAX_EST_LOC + 1 });
    const story = (await Story.findBy({ id: "s" }))!;
    expect(await story.validate("ingest")).toBe(false);
    expect(story.errors.fullMessages).toContain(
      `est-loc ${MAX_EST_LOC + 1} exceeds the ${MAX_EST_LOC} LOC per-PR ceiling`,
    );
  });

  it("leaves a terminal story's historical estimate alone", async () => {
    await seed("s", "0136-trailmap", "done", { est_loc: 9000 });
    expect(await (await Story.findBy({ id: "s" }))!.validate("ingest")).toBe(true);
  });

  it("does not run on the mutation path, so a bad row stays fixable", async () => {
    // A `ready` story holding a stale pr is exactly what the verbs exist to
    // repair; a save-time semantic validation would refuse the repair.
    await seed("s", "0136-trailmap", "ready", { pr: 7 });
    const story = (await Story.findBy({ id: "s" }))!;
    expect(await story.validate("ingest")).toBe(false);
    await story.statusSet("draft");
    expect((await Story.findBy({ id: "s" }))!.pr).toBeNull();
  });
});

describe("Rfc closed-with-open-story validation", () => {
  it("refuses a closed RFC that still holds an unfinished story", async () => {
    await Rfc.create({ id: "0099-old", status: "closed", title: "Old" });
    await seed("open", "0099-old", "ready");
    const rfc = (await Rfc.findBy({ id: "0099-old" }))!;
    expect(await rfc.validate("ingest")).toBe(false);
    expect(rfc.errors.fullMessages).toContain(
      `status: closed but story "open" is "ready", not done or closed`,
    );
  });
});

describe("checkDepGraph", () => {
  const graph = (edges: Record<string, string[]>, rfcEdges: Record<string, string[]> = {}) => ({
    storyIds: new Set(Object.keys(edges)),
    rfcIds: new Set(["0136-trailmap"]),
    depsOf: (id: string) => edges[id] ?? [],
    depsRfcOf: (id: string) => rfcEdges[id] ?? [],
    seeds: Object.keys(edges),
  });

  it("reports a dep that names no story", () => {
    const messages = depGraphMessages(checkDepGraph(graph({ a: ["ghost"] })));
    expect(messages).toEqual([`dep "ghost" does not exist`]);
  });

  it("reports a cycle by its path", () => {
    const messages = depGraphMessages(checkDepGraph(graph({ a: ["b"], b: ["a"] })));
    expect(messages).toEqual([`dep cycle detected: a → b → a`]);
  });

  it("accepts an acyclic graph", () => {
    expect(depGraphMessages(checkDepGraph(graph({ a: ["b"], b: ["c"], c: [] })))).toEqual([]);
  });
});

describe("Story.semanticErrors", () => {
  it("collects per-row, graph and RFC-lifecycle violations together", async () => {
    await seed("good", "0136-trailmap", "draft");
    await seed("bad", "0136-trailmap", "ready", { assignee: "someone" });
    await StoryDep.create({ story_id: "good", depends_on_id: "ghost" });
    await StoryRfcDep.create({ story_id: "good", rfc_id: "0000-nope" });
    await Rfc.create({ id: "0099-old", status: "closed", title: "Old" });
    await seed("stranded", "0099-old", "ready");

    const errors = await Story.semanticErrors();
    expect(errors).toContain(`status: ready must have null assignee (got "someone")`);
    expect(errors).toContain(`dep "ghost" does not exist`);
    expect(errors).toContain(`deps-rfc "0000-nope" does not exist`);
    expect(errors).toContain(`status: closed but story "stranded" is "ready", not done or closed`);
  });

  it("is empty for content that satisfies every semantic rule", async () => {
    await seed("a", "0136-trailmap", "draft");
    await seed("b", "0136-trailmap", "ready");
    await StoryDep.create({ story_id: "b", depends_on_id: "a" });
    expect(await Story.semanticErrors()).toEqual([]);
  });
});
