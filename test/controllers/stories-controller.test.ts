import { beforeAll, describe, expect, it, vi } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, Story, StoryDep, StoryPath, loadModelSchemas } from "../../app/models/index.js";
import { StoriesController } from "../../app/controllers/stories-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/** Every request the API is meant to answer arrives on loopback. */
const LOOPBACK = { Host: "127.0.0.1" };

function testCase(headers: Record<string, string> = LOOPBACK): Promise<ActionController.TestCase> {
  return controllerTestCase(StoriesController, headers);
}

async function getJson(
  action: string,
  options: { params?: Record<string, unknown>; headers?: Record<string, string> } = {},
): Promise<{ status: number; body: any }> {
  const tc = await testCase({ ...LOOPBACK, ...(options.headers ?? {}) });
  await tc.get(action, { params: options.params });
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });
  await Rfc.create({ id: "0002-draft", status: "draft", title: "Draft" });

  await Story.create({
    id: "dependent",
    rfc_id: "0136-trailmap",
    status: "ready",
    est_loc: 200,
    cluster: "api",
  });
  await Story.create({
    id: "unblocked",
    rfc_id: "0136-trailmap",
    status: "ready",
    est_loc: 50,
    cluster: "api",
  });
  // `ready` under a DRAFT RFC: never claimable, and reported as `draft`.
  await Story.create({ id: "shadowed", rfc_id: "0002-draft", status: "ready", est_loc: 10 });
  // Created LAST: the RFC auto-closes when its every story is done, so a
  // `done` story must not be the only one on the RFC when it is written.
  await Story.create({
    id: "base",
    rfc_id: "0136-trailmap",
    status: "done",
    est_loc: 40,
    cluster: "api",
    updated_on: "2026-08-28",
    file_path: "rfcs/0136-trailmap/stories/base.md",
  });
  await StoryDep.create({ story_id: "dependent", depends_on_id: "base" });
  await StoryPath.create({ story_id: "dependent", path: "app/controllers/stories-controller.ts" });
});

describe("StoriesController", () => {
  it("serves the ready queue as JSON", async () => {
    const { status, body } = await getJson("ready");

    expect(status).toBe(200);
    expect(body.map((s: any) => s.id)).toEqual(["dependent", "unblocked"]);
  });

  it("scopes the ready queue to an RFC", async () => {
    const { body } = await getJson("ready", { params: { rfc: "0002-draft" } });

    expect(body).toEqual([]);
  });

  it("serves next-bundle as the object the spawn loop unmarshals", async () => {
    const { body } = await getJson("nextBundle", { params: { "max-loc": "60" } });

    expect(body.stories.map((s: any) => s.id)).toEqual(["unblocked"]);
    expect(body.bundle_total_loc).toBe(50);
    expect(body.max_loc).toBe(60);
    expect(body.lead_exceeds_budget).toBe(false);
    expect(body.empty_reason).toBeNull();
  });

  it("says why next-bundle came back empty", async () => {
    const { body } = await getJson("nextBundle", { params: { "max-loc": "5" } });

    expect(body.stories).toEqual([]);
    expect(body.empty_reason).toBe("none-within-budget");
  });

  it("defaults next-bundle to the CLI's budget", async () => {
    const { body } = await getJson("nextBundle");

    expect(body.max_loc).toBe(250);
  });

  it("lists every story, in index.json order", async () => {
    const { body } = await getJson("index");

    expect(body.map((s: any) => s.id)).toEqual(["base", "dependent", "shadowed", "unblocked"]);
  });

  it("filters the list by status, RFC and cluster", async () => {
    expect((await getJson("index", { params: { status: "done" } })).body).toHaveLength(1);
    expect((await getJson("index", { params: { rfc: "0002-draft" } })).body).toHaveLength(1);
    expect((await getJson("index", { params: { cluster: "api" } })).body).toHaveLength(3);
  });

  it("shows one story as a bare object", async () => {
    const { status, body } = await getJson("show", { params: { id: "base" } });

    expect(status).toBe(200);
    expect(body.id).toBe("base");
    expect(body.file_path).toBe("rfcs/0136-trailmap/stories/base.md");
    expect(body.updated).toBe("2026-08-28T00:00:00.000Z");
  });

  it("answers 404 for a story that does not exist", async () => {
    const { status, body } = await getJson("show", { params: { id: "nope" } });

    expect(status).toBe(404);
    expect(body).toEqual({ error: 'story "nope" not found' });
  });

  it("downgrades a ready story under a non-active RFC, keeping the authored value", async () => {
    const { body } = await getJson("show", { params: { id: "shadowed" } });

    expect(body.status).toBe("draft");
    expect(body.raw_status).toBe("ready");
  });

  it("finds the stories touching a path", async () => {
    const { body } = await getJson("touching", {
      params: { path: "app/controllers/stories-controller.ts" },
    });

    expect(body.map((s: any) => s.id)).toEqual(["dependent"]);
  });

  // The CLI refuses this outright (`if (!pos[0]) return usage()`), and the
  // substring tier matches every path against "", so defaulting would hand
  // back the whole open backlog dressed as a search result.
  it("refuses a touching request with no path", async () => {
    const { status, body } = await getJson("touching");

    expect(status).toBe(400);
    expect(body).toEqual({ error: "touching requires a path" });
  });

  // The queue and the serializer read the SAME snapshot: scanning the join
  // tables twice per request is what `rankingIndex` exists to avoid.
  it("loads one ranking index per request", async () => {
    const rankingIndex = vi.spyOn(Story, "rankingIndex");

    await getJson("ready");
    expect(rankingIndex).toHaveBeenCalledTimes(1);

    // next-bundle is the one that asks the models twice — for the bundle and
    // then for why it was empty — and both reads share the one snapshot.
    rankingIndex.mockClear();
    await getJson("nextBundle", { params: { "max-loc": "5" } });
    expect(rankingIndex).toHaveBeenCalledTimes(1);

    rankingIndex.mockRestore();
  });

  it("answers JSON to a client that sends no Accept header", async () => {
    const tc = await testCase();
    await tc.get("ready");

    expect(tc.response.status).toBe(200);
    expect(Array.isArray(JSON.parse(tc.response.body))).toBe(true);
  });

  // Rails' `negotiate_mime` over the one type on offer: `*/*` anywhere in the
  // list takes it, a type RANGE that covers JSON takes it, and a q-value orders
  // the client's types without removing one.
  it.each([
    ["text/html, */*"],
    ["application/*"],
    ["text/html;q=0.9, application/json;q=0.5"],
  ])("answers JSON to Accept: %s", async (accept) => {
    const { status, body } = await getJson("ready", { headers: { Accept: accept } });

    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it("declines a browser asking these actions for HTML", async () => {
    const { status, body } = await getJson("ready", { headers: { Accept: "text/html" } });

    expect(status).toBe(406);
    expect(body).toEqual({ error: "not_acceptable" });
  });

  it("is not reachable from the public hostname", async () => {
    const tc = await testCase({ Host: "trailmap.deanoftech.com", "X-Forwarded-For": "203.0.113.7" });
    await tc.get("ready");

    expect(tc.response.status).toBe(404);
    expect(JSON.parse(tc.response.body)).toEqual({ error: "not_found" });
  });
});
