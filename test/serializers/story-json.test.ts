import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { getFsAsync, getPathAsync } from "@blazetrails/activesupport";
import { env } from "@blazetrails/activesupport/process-adapter";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.js";
import { migrateScratchDatabase } from "../models/schema.js";
import {
  Rfc,
  Story,
  StoryDep,
  StoryPackage,
  StoryPath,
  StoryRfcDep,
  loadModelSchemas,
} from "../../app/models/index.js";
import {
  effectiveStoryStatus,
  serializeStories,
  serializeStory,
  storyJsonContext,
} from "../../app/serializers/story-json.js";

describe("effectiveStoryStatus", () => {
  it("downgrades a ready story whose RFC is not active", () => {
    expect(effectiveStoryStatus("draft", "ready")).toBe("draft");
    expect(effectiveStoryStatus("closed", "ready")).toBe("draft");
    expect(effectiveStoryStatus(null, "ready")).toBe("draft");
  });

  it("passes every other status through as authored", () => {
    expect(effectiveStoryStatus("active", "ready")).toBe("ready");
    expect(effectiveStoryStatus("draft", "in-progress")).toBe("in-progress");
    expect(effectiveStoryStatus("closed", "done")).toBe("done");
    expect(effectiveStoryStatus("active", null)).toBeNull();
  });
});

describe("the serializer", () => {
  beforeAll(async () => {
    await migrateScratchDatabase();
    await loadModelSchemas();

    await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });
    await Rfc.create({ id: "0002-draft", status: "draft", title: "Draft" });

    await Story.create({
      id: "bare",
      rfc_id: "0136-trailmap",
      status: "ready",
      updated_on: "not-a-date",
    });
    await Story.create({
      id: "full",
      rfc_id: "0136-trailmap",
      status: "in-progress",
      title: "Serve the read verbs",
      cluster: "api",
      priority: 3,
      est_loc: 200,
      pr: 5,
      claim_at: "2026-09-05T12:00:00Z",
      assignee: "ringo",
      updated_on: "2026-09-05",
      file_path: "rfcs/0136-trailmap/stories/full.md",
    });
    await StoryDep.create({ story_id: "full", depends_on_id: "bare" });
    await StoryRfcDep.create({ story_id: "full", rfc_id: "0002-draft" });
    await StoryPath.create({ story_id: "full", path: "app/serializers/story-json.ts" });
    await StoryPackage.create({ story_id: "full", package: "trailmap" });
  });

  it("collects the join rows and RFC statuses one query per table", async () => {
    const context = await storyJsonContext();

    expect(context.rfcStatus.get("0136-trailmap")).toBe("active");
    expect(context.deps.get("full")).toEqual(["bare"]);
    expect(context.rfcDeps.get("full")).toEqual(["0002-draft"]);
    expect(context.paths.get("full")).toEqual(["app/serializers/story-json.ts"]);
    expect(context.packages.get("full")).toEqual(["trailmap"]);
  });

  it("renders every field readmodel.ts emits", async () => {
    const story = (await Story.findBy({ id: "full" }))!;

    expect(serializeStory(story, await storyJsonContext())).toEqual({
      id: "full",
      rfc: "0136-trailmap",
      title: "Serve the read verbs",
      status: "in-progress",
      raw_status: "in-progress",
      cluster: "api",
      packages: ["trailmap"],
      priority: 3,
      updated: "2026-09-05T00:00:00.000Z",
      deps: ["bare"],
      deps_rfc: ["0002-draft"],
      est_loc: 200,
      pr: 5,
      claim: "2026-09-05T12:00:00Z",
      assignee: "ringo",
      blocked_by: null,
      closed_reason: null,
      story_paths: ["app/serializers/story-json.ts"],
      file_path: "rfcs/0136-trailmap/stories/full.md",
    });
  });

  it("empties the list fields a story has no rows for", async () => {
    const [bare] = await serializeStories([(await Story.findBy({ id: "bare" }))!]);

    expect(bare.packages).toEqual([]);
    expect(bare.deps).toEqual([]);
    expect(bare.deps_rfc).toEqual([]);
    expect(bare.story_paths).toEqual([]);
    expect(bare.title).toBeNull();
    expect(bare.priority).toBeNull();
  });

  // ONE unparseable date used to take every verb down for everyone, because
  // the index is rebuilt on every read. Drop the field, not the response.
  it("drops a date it cannot parse rather than the whole response", async () => {
    const [bare] = await serializeStories([(await Story.findBy({ id: "bare" }))!]);

    expect(bare.updated).toBeNull();
  });

  it("serializes a whole list in the order it was handed", async () => {
    const rows = await serializeStories(await Story.listFiltered());

    // `listFiltered` hands over index.json order — prioritised first — and the
    // serializer preserves it rather than imposing one of its own.
    expect(rows.map((s) => s.id)).toEqual(["full", "bare"]);
  });
});

/**
 * The equivalence gate: serialize the WHOLE backlog and diff it against the
 * published `index.json`, which is what btwhooks' Go side and the CLI parse
 * today. Field-for-field equality over the full RFC set is the acceptance
 * criterion — a spot-check on a fixture would not catch a field that only ever
 * appears on a handful of the 7k real stories.
 *
 * Skipped unless `TASKS_DATABASE` points at a `tasks.db`: the file and the
 * `index.json` beside it live in another repo's checkout, so CI has no copy
 * and there is nothing here worth faking. Run it as:
 *
 *     TASKS_DATABASE=~/github/blazetrailsdev/tasks/.git/tasks.db pnpm test
 */
const withLiveDatabase = hasTasksDatabase() ? describe : describe.skip;

/** `<checkout>/.git/tasks.db` → `<checkout>/index.json`, the published copy. */
async function publishedIndexPath(): Promise<string> {
  const path = await getPathAsync();
  return path.join(path.dirname(path.dirname(String(env.TASKS_DATABASE))), "index.json");
}

withLiveDatabase("the published index.json", () => {
  let published: Record<string, unknown>[];

  beforeAll(async () => {
    await Base.establishConnection(tasksDatabaseConfig());
    await loadModelSchemas();
    const fs = await getFsAsync();
    const raw = await fs.readFile!(await publishedIndexPath(), "utf8");
    published = JSON.parse(raw as string).stories;
  });

  it("matches the serialized stories field for field", async () => {
    const serialized = await serializeStories(await Story.listFiltered());

    // Report the differing STORIES rather than dumping 7k rows: a real
    // regression is a field, and naming the ids that carry it is the
    // difference between a readable failure and an unreadable one. (The CLI
    // republishes index.json on every mutation, so a mismatch on a live
    // checkout can also just be a claim landing mid-run — the ids tell the two
    // apart at a glance.)
    const differing = serialized.filter(
      (story, i) => JSON.stringify(story) !== JSON.stringify(published[i]),
    );

    expect(differing).toEqual([]);
    expect(serialized).toHaveLength(published.length);
  });
});
