import { beforeAll, describe, expect, it } from "vitest";
import { Base } from "@blazetrails/activerecord";
import { env, getFs, getPath } from "@blazetrails/ruby-compat";
import { hasTasksDatabase, tasksDatabaseConfig } from "../../config/database.ts";
import { migrateScratchDatabase } from "../models/schema.ts";
import {
  Rfc,
  Story,
  StoryDep,
  StoryPackage,
  StoryPath,
  StoryRfcDep,
  loadModelSchemas,
} from "../../app/models/index.ts";
import { serializeStories, serializeStory } from "../../app/serializers/story-json.ts";

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
      pr: "trails#5",
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

  // The context IS `Story.rankingIndex()` — the snapshot the read verbs
  // already load — so the serializer adds no queries of its own.
  it("reads its packages, deps and paths out of the ranking index", async () => {
    const index = await Story.rankingIndex();

    expect(index.rfcStatus.get("0136-trailmap")).toBe("active");
    expect(index.deps.get("full")).toEqual(["bare"]);
    expect(index.rfcDeps.get("full")).toEqual(["0002-draft"]);
    expect(index.paths.get("full")).toEqual(["app/serializers/story-json.ts"]);
    expect(index.packages.get("full")).toEqual(["trailmap"]);
  });

  it("renders every field readmodel.ts emits", async () => {
    const story = (await Story.findBy({ id: "full" }))!;

    expect(serializeStory(story, await Story.rankingIndex())).toEqual({
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
      pr: "trails#5",
      claim: "2026-09-05T12:00:00Z",
      assignee: "ringo",
      blocked_by: null,
      closed_reason: null,
      story_paths: ["app/serializers/story-json.ts"],
      file_path: "rfcs/0136-trailmap/stories/full.md",
    });
  });

  it("empties the list fields a story has no rows for", async () => {
    const [bare] = serializeStories(
      [(await Story.findBy({ id: "bare" }))!],
      await Story.rankingIndex(),
    );

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
    const [bare] = serializeStories(
      [(await Story.findBy({ id: "bare" }))!],
      await Story.rankingIndex(),
    );

    expect(bare.updated).toBeNull();
  });

  it("serializes a whole list in the order it was handed", async () => {
    const index = await Story.rankingIndex();
    const rows = serializeStories(await Story.listFiltered({ index }), index);

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
  const path = getPath();
  return path.join(path.dirname(path.dirname(String(env.TASKS_DATABASE))), "index.json");
}

withLiveDatabase("the published index.json", () => {
  beforeAll(async () => {
    await Base.establishConnection(tasksDatabaseConfig());
    await loadModelSchemas();
  });

  async function readPublished(): Promise<string> {
    const fs = getFs();
    return String(await fs.readFile!(await publishedIndexPath(), "utf8"));
  }

  it("matches the serialized stories field for field", async (ctx) => {
    // Read the file, serialize, read it AGAIN. The CLI republishes index.json
    // on every mutation, so on a live checkout another agent's claim landing
    // mid-run rewrites the very file under comparison — and that is a race in
    // the fixture, not a regression in the serializer. A second read that
    // differs proves it, and the pass is retried against the new file rather
    // than reported as a failure.
    for (let attempt = 0; attempt < 3; attempt++) {
      const before = await readPublished();
      const index = await Story.rankingIndex();
      const serialized = serializeStories(await Story.listFiltered({ index }), index);
      if ((await readPublished()) !== before) continue;

      const published: Record<string, unknown>[] = JSON.parse(before).stories;
      // Report the differing STORIES rather than dumping 7k rows: a real
      // regression is one field, and naming the ids that carry it is the
      // difference between a readable failure and an unreadable one.
      const differing = serialized.filter(
        (story, i) => JSON.stringify(story) !== JSON.stringify(published[i]),
      );

      expect(differing).toEqual([]);
      expect(serialized).toHaveLength(published.length);
      return;
    }
    ctx.skip("index.json was republished under every attempt — the backlog is busy");
  });
});
