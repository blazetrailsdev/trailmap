import { beforeAll, describe, expect, it } from "vitest";
import { Notifications } from "@blazetrails/activesupport";
import { migrateScratchDatabase } from "./schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import {
  CONTENT_REPO,
  eventsForRepo,
  inChunks,
  openCountsByRepo,
  pathsForStories,
  prNumber,
  prRefsOf,
  storiesForRepo,
  storyForRepo,
} from "../../app/models/concerns/repo-scope.js";
import { StoryPath } from "../../app/models/joins.js";

/**
 * The rule that decides which repository a story belongs to.
 *
 * It needs no hub database — it reads the TASK domain, and the repository is
 * a string on `stories.pr`. That is the whole subtlety the repo pages rest on,
 * so it is tested here on its own rather than only through the eight
 * controllers that call it.
 */
beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });
  await Story.create({
    id: "shipped-in-trails",
    rfc_id: "0136-trailmap",
    status: "done",
    title: "Shipped",
    pr: "trails#7228",
  });
  await Story.create({
    id: "second-on-the-same-pr",
    rfc_id: "0136-trailmap",
    status: "done",
    pr: "trails#7228",
  });
  await Story.create({
    id: "newer-in-trails",
    rfc_id: "0136-trailmap",
    status: "in-progress",
    pr: "trails#8000",
  });
  await Story.create({
    id: "shipped-in-trailmap",
    rfc_id: "0136-trailmap",
    status: "done",
    pr: "trailmap#15",
  });
  await Story.create({ id: "unshipped", rfc_id: "0136-trailmap", status: "ready" });

  // `my_repo` is a legal repository name and `_` is a LIKE wildcard. The decoy
  // is what an unescaped pattern matches instead.
  await Story.create({
    id: "in-my-repo",
    rfc_id: "0136-trailmap",
    status: "ready",
    pr: "my_repo#1",
  });
  await Story.create({
    id: "in-the-decoy",
    rfc_id: "0136-trailmap",
    status: "ready",
    pr: "myXrepo#1",
  });

  await StoryPath.create({ story_id: "shipped-in-trails", path: "packages/activerecord/a.ts" });
  await StoryPath.create({ story_id: "shipped-in-trails", path: "packages/actionpack/b.ts" });
  await StoryPath.create({ story_id: "newer-in-trails", path: "scripts/c.ts" });

  await Event.create({
    at: "2020-01-01T00:00:00Z",
    verb: "done",
    story_id: "shipped-in-trails",
    pr: "trails#7228",
    actor: "agent",
  });
  await Event.create({
    at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    verb: "claim",
    story_id: "newer-in-trails",
    actor: "agent",
  });
  await Event.create({
    at: new Date(Date.now() - 1 * 86_400_000).toISOString(),
    verb: "in-progress",
    story_id: "shipped-in-trailmap",
    actor: "agent",
  });
});

describe("storiesForRepo", () => {
  it("scopes a story to the repository its PR targets", async () => {
    const trails = await storiesForRepo("trails");

    expect(trails.map((story) => story.id).sort()).toEqual([
      "newer-in-trails",
      "second-on-the-same-pr",
      "shipped-in-trails",
    ]);
  });

  it("gives the content repo the stories with no PR as well as its own", async () => {
    const tasks = await storiesForRepo(CONTENT_REPO);

    // An unshipped story has not landed anywhere, and dropping it would make
    // the whole ready queue invisible from every repository page.
    expect(tasks.map((story) => story.id)).toContain("unshipped");
  });

  it("does not give an ordinary repository the unshipped stories", async () => {
    const trailmap = await storiesForRepo("trailmap");

    expect(trailmap.map((story) => story.id)).toEqual(["shipped-in-trailmap"]);
  });

  it("does not match a repository whose name is a prefix of another's", async () => {
    // `trails#7228` must not be scoped to `trail`: the `#` is part of the
    // pattern for exactly this reason.
    expect(await storiesForRepo("trail")).toEqual([]);
  });

  it("is empty for a repository nothing has shipped to", async () => {
    expect(await storiesForRepo("ringo")).toEqual([]);
  });

  it("plucks the fields the pages read, rather than loading records", async () => {
    const [story] = await storiesForRepo("trailmap");

    expect(story).toEqual({
      id: "shipped-in-trailmap",
      rfc_id: "0136-trailmap",
      status: "done",
      pr: "trailmap#15",
      title: null,
      assignee: null,
      priority: null,
      est_loc: null,
    });
  });
});

describe("storiesForRepo, on a name holding a LIKE wildcard", () => {
  it("matches the repository and not the pattern it would otherwise be", async () => {
    // Unescaped, `my_repo#%` matches `myXrepo#1` too — `_` is "any character".
    const scoped = await storiesForRepo("my_repo");

    expect(scoped.map((story) => story.id)).toEqual(["in-my-repo"]);
  });

  it("does not let the decoy claim the wildcard name's stories either", async () => {
    expect((await storiesForRepo("myXrepo")).map((story) => story.id)).toEqual([
      "in-the-decoy",
    ]);
  });
});

describe("storyForRepo", () => {
  it("is the story, when it belongs to the repository", async () => {
    const story = await storyForRepo("trails", "shipped-in-trails");

    expect(story?.id).toBe("shipped-in-trails");
  });

  it("is null for a story that belongs to ANOTHER repository", async () => {
    // The whole point: `/blazetrailsdev/trails/issues/shipped-in-trailmap`
    // must 404 rather than render another repo's story under this one's URL.
    expect(await storyForRepo("trails", "shipped-in-trailmap")).toBeNull();
  });

  it("gives the content repo a story with no PR, as the list does", async () => {
    expect((await storyForRepo(CONTENT_REPO, "unshipped"))?.id).toBe("unshipped");
    expect(await storyForRepo("trails", "unshipped")).toBeNull();
  });

  it("is null for an id nothing carries, and for an empty id", async () => {
    expect(await storyForRepo("trails", "no-such-story")).toBeNull();
    expect(await storyForRepo("trails", "")).toBeNull();
  });
});

describe("openCountsByRepo", () => {
  // `ringo` has no stories at all.
  const REPOS = ["trails", "trailmap", "ringo", "my_repo", CONTENT_REPO];

  it("counts everything that is not done or closed", async () => {
    // `trails` has one done, one done-on-the-same-PR and one in-progress.
    expect((await openCountsByRepo(["trails"])).get("trails")).toBe(1);
  });

  it("agrees with filtering each repository's list, unattributed stories included", async () => {
    const counts = await openCountsByRepo(REPOS);
    for (const repo of REPOS) {
      const scoped = await storiesForRepo(repo);
      const open = scoped.filter((s) => s.status !== "done" && s.status !== "closed");

      expect([repo, counts.get(repo)]).toEqual([repo, open.length]);
    }
    expect(counts.get(CONTENT_REPO)).toBeGreaterThan(0);
  });

  it("reads 0 for a repository with no stories, rather than leaving it out", async () => {
    expect([...(await openCountsByRepo(["ringo", "nothing"]))]).toEqual([["ringo", 0], ["nothing", 0]]);
  });

  it("issues one query however many repositories are asked for", async () => {
    let queries = 0;
    const subscriber = Notifications.subscribe("sql.active_record", () => queries++);
    try {
      await openCountsByRepo(REPOS);
    } finally {
      Notifications.unsubscribe(subscriber);
    }
    expect(queries).toBe(1);
  });
});

describe("pathsForStories", () => {
  it("is every path the scope's stories cite", async () => {
    const paths = await pathsForStories(await storiesForRepo("trails"));

    expect([...paths].sort()).toEqual([
      "packages/actionpack/b.ts",
      "packages/activerecord/a.ts",
      "scripts/c.ts",
    ]);
  });

  it("is empty for a scope with no stories, rather than binding nothing", async () => {
    expect(await pathsForStories([])).toEqual([]);
  });

  it("keeps every chunk's rows, including the last and the shortest", async () => {
    // What chunking can actually get WRONG is dropping rows at a boundary, so
    // that is what this pins: ids either side of one, and a trailing chunk of
    // a single id. It does not assert an error without chunking — this SQLite
    // accepts 32,766 binds, so 2,100 in one statement would simply work (see
    // BIND_CHUNK, which says why the guard is kept anyway).
    // `insertAll`, not 2,101 `create`s: one statement rather than one round
    // trip each, which is the difference between this case taking 20ms and
    // timing out when the suite runs its files in parallel.
    await Story.insertAll(
      Array.from({ length: 2101 }, (_, i) => ({
        id: `bulk-${i}`,
        rfc_id: "0136-trailmap",
        status: "ready",
        pr: "bulk#1",
      })),
    );
    for (const id of ["bulk-0", "bulk-899", "bulk-900", "bulk-1800", "bulk-2100"]) {
      await StoryPath.create({ story_id: id, path: `bulk/${id}.ts` });
    }

    const scoped = await storiesForRepo("bulk");
    expect(scoped.length).toBe(2101);

    const paths = await pathsForStories(scoped);
    expect([...paths].sort()).toEqual([
      "bulk/bulk-0.ts",
      "bulk/bulk-1800.ts",
      "bulk/bulk-2100.ts",
      "bulk/bulk-899.ts",
      "bulk/bulk-900.ts",
    ]);
  });

  it("splits at the chunk size, with the remainder last", () => {
    const ids = Array.from({ length: 2101 }, (_, i) => i);
    const chunks = inChunks(ids);

    expect(chunks.map((chunk) => chunk.length)).toEqual([900, 900, 301]);
    expect(chunks.flat()).toEqual(ids);
  });

  it("is one chunk below the limit, and none for nothing", () => {
    expect(inChunks([1, 2, 3]).map((c) => c.length)).toEqual([3]);
    expect(inChunks([])).toEqual([]);
  });
});

describe("prRefsOf", () => {
  it("is each distinct ref once, highest number first", async () => {
    expect(prRefsOf(await storiesForRepo("trails"))).toEqual(["trails#8000", "trails#7228"]);
  });

  it("ignores a story with no PR", async () => {
    expect(prRefsOf(await storiesForRepo(CONTENT_REPO))).toEqual([]);
  });
});

describe("prNumber", () => {
  it("reads the number after the hash", () => {
    expect(prNumber("trails#7228")).toBe(7228);
  });

  it("is zero for anything that is not a ref, so a sort cannot throw", () => {
    expect(prNumber("7228")).toBe(0);
    expect(prNumber("trails#")).toBe(0);
    expect(prNumber("trails#abc")).toBe(0);
    expect(prNumber("")).toBe(0);
  });
});

describe("eventsForRepo", () => {
  it("is the repo's own events, newest first", async () => {
    const events = await eventsForRepo(await storiesForRepo("trails"), 30, 100);

    expect(events.map((event) => event.story_id)).toEqual(["newer-in-trails"]);
  });

  it("is bounded by the window, not by the scope's story ids", async () => {
    // The 2020 event belongs to `trails` and is outside 30 days. Scoping by
    // `story_id IN (…)` instead would return it — and would be a query with
    // nine thousand binds on the real database.
    const wide = await eventsForRepo(await storiesForRepo("trails"), 365 * 20, 100);

    expect(wide.map((event) => event.story_id)).toEqual([
      "newer-in-trails",
      "shipped-in-trails",
    ]);
  });

  it("stops at the limit", async () => {
    expect(await eventsForRepo(await storiesForRepo("trails"), 365 * 20, 1)).toHaveLength(1);
  });

  it("leaves another repository's events out", async () => {
    const events = await eventsForRepo(await storiesForRepo("trailmap"), 30, 100);

    expect(events.map((event) => event.story_id)).toEqual(["shipped-in-trailmap"]);
  });

  it("is empty for an empty scope, without querying", async () => {
    expect(await eventsForRepo([], 30, 100)).toEqual([]);
  });
});
