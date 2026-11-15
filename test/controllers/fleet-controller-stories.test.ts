/**
 * `FleetController#stories`: the dashboard's read of the tasks database (RFC
 * 0232). Every story a PR closes, of any status; a spawn's story and the stage
 * its agent reported; and the palette's search.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc } from "../../app/models/rfc.ts";
import { Story } from "../../app/models/story.ts";
import { loadModelSchemas } from "../../lib/model-schemas.ts";
import { FleetController } from "../../app/controllers/fleet-controller.ts";
import { FLEET_STORIES_MAX_HITS, FleetStories, storiesForIds, storiesForPrs, storiesMatching } from "../../app/models/concerns/fleet-stories.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0188-mailer", status: "active", title: "Mailer" });
  await Story.create({ id: "preview-interceptors", rfc_id: "0188-mailer", status: "in-progress", pr: "trails#9958", title: "Preview interceptors" });
  await Story.create({ id: "interceptor-string-arm", rfc_id: "0188-mailer", status: "in-progress", pr: "trails#9958", title: "String arm" });
  await Story.create({ id: "delivery-class-names", rfc_id: "0188-mailer", status: "done", pr: "trails#9811", title: "Class names" });
  await Story.create({ id: "drafting-alone", rfc_id: "0188-mailer", status: "claimed", title: "Interceptor docs", stage: "self" });
  for (let i = 0; i < FLEET_STORIES_MAX_HITS + 5; i++) {
    await Story.create({ id: `bulk-${String(i).padStart(2, "0")}`, rfc_id: "0188-mailer", status: "ready", title: `Bulk ${i}` });
  }
});

async function get(params: Record<string, unknown>): Promise<{ status: number; body: string; json: () => unknown }> {
  const tc = await controllerTestCase(FleetController);
  await tc.get("stories", { params });
  const { status, body } = tc.response;
  return { status, body, json: () => JSON.parse(body) };
}

describe("FleetController#stories, by PR", () => {
  it("answers every story a PR closes, by id, with title, status and RFC", async () => {
    const answer = (await get({ pr: ["trails#9958"] })).json() as Record<string, Array<Record<string, unknown>>>;

    expect(answer["trails#9958"]!.map((s) => s.id)).toEqual(["interceptor-string-arm", "preview-interceptors"]);
    expect(answer["trails#9958"]![1]).toEqual({
      id: "preview-interceptors", title: "Preview interceptors", status: "in-progress", rfc: "0188-mailer", stage: null,
    });
  });

  it("answers a done story too, so a merged session keeps its stories", async () => {
    const answer = (await get({ pr: ["trails#9811"] })).json() as Record<string, Array<{ status: string }>>;

    expect(answer["trails#9811"]).toHaveLength(1);
    expect(answer["trails#9811"]![0]!.status).toBe("done");
  });

  it("answers an empty list for a ref nothing names, and several refs at once", async () => {
    const answer = (await get({ pr: ["trails#1", "trails#9811"] })).json() as Record<string, unknown[]>;

    expect(answer["trails#1"]).toEqual([]);
    expect(answer["trails#9811"]).toHaveLength(1);
  });

  it("refuses more than a hundred refs", async () => {
    const refs = Array.from({ length: 101 }, (_, i) => `trails#${i + 1}`);
    const response = await get({ pr: refs });

    expect(response.status).toBe(400);
    expect(response.body).toContain("100");
  });

  it("takes a hundred refs", async () => {
    expect((await get({ pr: Array.from({ length: 100 }, (_, i) => `trails#${i + 1}`) })).status).toBe(200);
  });

  it("refuses something that is not a PR ref", async () => {
    expect((await get({ pr: ["trails 9958"] })).status).toBe(400);
  });
});

describe("FleetController#stories, by story", () => {
  it("answers a spawn's story with the stage its agent reported", async () => {
    const answer = (await get({ story: ["drafting-alone", "no-such-story"] })).json() as Record<string, Array<{ stage: string }>>;

    expect(answer["drafting-alone"]![0]!.stage).toBe("self");
    expect(answer["no-such-story"]).toEqual([]);
  });
});

describe("FleetController#stories, searched", () => {
  it("matches id and title, an id match first", async () => {
    const answer = (await get({ q: "interceptor" })).json() as Array<{ id: string }>;

    expect(answer.map((s) => s.id)).toEqual(["interceptor-string-arm", "preview-interceptors", "drafting-alone"]);
  });

  it("answers at most twenty", async () => {
    expect((await get({ q: "bulk" })).json()).toHaveLength(FLEET_STORIES_MAX_HITS);
  });

  it("answers nothing for a phrase too short to search", async () => {
    expect((await get({ q: "b" })).json()).toEqual([]);
  });
});

describe("FleetStories, directly", () => {
  it("answers each read without a request", async () => {
    expect((await storiesForPrs(["trails#9811"]))["trails#9811"]!.map((s) => s.id)).toEqual(["delivery-class-names"]);
    expect(await storiesForPrs([])).toEqual({});
    expect((await storiesForIds(["drafting-alone"]))["drafting-alone"]!.stage).toBe("self");
    expect(await storiesForIds(["nope"])).toEqual({ nope: null });
    expect((await storiesMatching("class names")).map((s) => s.id)).toEqual(["delivery-class-names"]);
    expect(FleetStories.storiesMatching).toBe(storiesMatching);
  });
});
