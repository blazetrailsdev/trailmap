import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "./schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import {
  CONTENT_REPO,
  eventsForRepo,
  prNumber,
  prRefsOf,
  storiesForRepo,
} from "../../app/models/concerns/repo-scope.js";

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
