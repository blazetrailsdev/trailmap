/**
 * The whole-read-model endpoints, which exist to replace ringo's own copy of
 * this data (webhook/tasksdb.go). What matters is that the shapes and the
 * ORDER match what `index.json` and `events.json` carried, because the Go
 * structs that parsed those files are reused verbatim against these responses.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.js";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { ReadModelsController } from "../../app/controllers/read-models-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

async function get(
  action: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const tc = await controllerTestCase(ReadModelsController, { Host: "127.0.0.1", ...headers });
  await tc.get(action);
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    priority: 1,
    created_on: "2026-08-25",
    updated_on: "2026-09-05",
    packages: ["activerecord"],
    clusters: [],
    related_rfcs: ["0061-ci-failures"],
    file_path: "rfcs/0136-trailmap/README.md",
  });
  await Rfc.create({ id: "0002-draft", status: "draft", title: "Draft" });

  await Story.create({ id: "later", rfc_id: "0136-trailmap", status: "ready", priority: 9 });
  await Story.create({ id: "sooner", rfc_id: "0136-trailmap", status: "ready", priority: 2 });
  // `ready` under a DRAFT RFC: the parent-RFC override reports it as `draft`.
  await Story.create({ id: "shadowed", rfc_id: "0002-draft", status: "ready" });

  await Event.create({ at: "2026-09-01T00:00:00Z", verb: "claim", story_id: "sooner" });
  // Same `at` as the claim: `at` is only second-resolution, so a burst of
  // verbs inside one second is ordered by `id` or not at all.
  await Event.create({ at: "2026-09-01T00:00:00Z", verb: "in-progress", story_id: "sooner" });
  await Event.create({ at: "2026-09-02T00:00:00Z", verb: "done", story_id: "sooner", pr: "trails#5" });
});

describe("ReadModelsController", () => {
  // The spawn loop consumes this order as the ready-queue ranking, so it is
  // part of the answer, not a presentation detail.
  it("orders RFCs by id and stories by (priority, id)", async () => {
    const { status, body } = await get("index");

    expect(status).toBe(200);
    expect(body.rfcs.map((r: any) => r.id)).toEqual(["0002-draft", "0136-trailmap"]);
    expect(body.stories.map((s: any) => s.id)).toEqual(["sooner", "later", "shadowed"]);
  });

  it("carries the RFC fields index.json carried, with its JSON columns parsed", async () => {
    const { body } = await get("index");
    const rfc = body.rfcs.find((r: any) => r.id === "0136-trailmap");

    expect(rfc).toEqual({
      id: "0136-trailmap",
      title: "trailmap",
      status: "active",
      priority: 1,
      owner: null,
      created: "2026-08-25T00:00:00.000Z",
      updated: "2026-09-05T00:00:00.000Z",
      packages: ["activerecord"],
      clusters: [],
      superseded_by: null,
      related_rfcs: ["0061-ci-failures"],
      file_path: "rfcs/0136-trailmap/README.md",
    });
  });

  it("applies the parent-RFC status override the index applied", async () => {
    const { body } = await get("index");
    const shadowed = body.stories.find((s: any) => s.id === "shadowed");

    expect(shadowed.status).toBe("draft");
    expect(shadowed.raw_status).toBe("ready");
  });

  // Chronological, which is the order both chart collectors walk.
  it("serves the event stream oldest first, in events.json's shape", async () => {
    const { body } = await get("events");

    expect(body.events.map((e: any) => e.verb)).toEqual(["claim", "in-progress", "done"]);
    expect(body.events[2]).toMatchObject({
      verb: "done",
      story: "sooner",
      rfc: null,
      pr: "trails#5",
      actor: null,
      detail: null,
    });
  });

  // The action plucks columns instead of building records, for the 59k-row
  // live table. This is the response the records produced, key for key and in
  // key order, so the faster path cannot drift from the shape ringo parses.
  it("serves the bytes the Event records would have", async () => {
    const tc = await controllerTestCase(ReadModelsController, { Host: "127.0.0.1" });
    await tc.get("events");

    const records = await Event.order({ at: "asc", id: "asc" }).toArray();
    const fromRecords = records.map((event) => ({
      at: String(event.at),
      verb: event.verb,
      story: event.story_id ?? null,
      rfc: event.rfc_id ?? null,
      pr: event.pr ?? null,
      actor: event.actor ?? null,
      detail: event.detail ?? null,
    }));
    expect(tc.response.body).toBe(JSON.stringify({ events: fromRecords }));
  });

  it("is a 404 for anything arriving through the proxy", async () => {
    const { status } = await get("index", { "X-Forwarded-Host": "127.0.0.1" });

    expect(status).toBe(404);
  });
});
