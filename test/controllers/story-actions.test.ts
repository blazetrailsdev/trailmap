import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Event, Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function page(id: string): Promise<string> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.get("show", { params: { id } });
  return tc.response.body;
}

async function post(action: string, params: Record<string, string>): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.post(action, { params });
  return { status: tc.response.status, body: tc.response.body };
}

async function story(id: string, status: string, priority: number | null = null): Promise<void> {
  await Story.create({ id, rfc_id: "0001-a", status: "ready", priority });
  await Story.where({ id }).updateAll({ status });
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  await migrateScratchDatabase();
  await loadModelSchemas();
  await Rfc.create({ id: "0001-a", status: "active", title: "A" });
  await story("a-draft", "draft");
  await story("a-ready", "ready");
  await story("a-pinned", "ready", 0);
  await story("a-claimed", "claimed");
  await story("a-blocked", "blocked");
  await story("a-done", "done");
  await story("a-closed", "closed");
  await story("v-ready", "draft");
  await story("v-top", "ready");
  await story("v-block", "ready");
  await story("v-close", "ready");
  await story("v-release", "claimed");
});

describe("the story page's buttons", () => {
  it("offers Mark ready only on a draft", async () => {
    expect(await page("a-draft")).toContain("Mark ready");
    expect(await page("a-ready")).not.toContain("Mark ready");
  });

  it("offers Top of queue for a queue status not already pinned", async () => {
    for (const id of ["a-draft", "a-ready", "a-blocked"]) expect(await page(id)).toContain("Top of queue");
    for (const id of ["a-pinned", "a-claimed", "a-done"]) expect(await page(id)).not.toContain("Top of queue");
  });

  it("offers Release claim only on a claimed story", async () => {
    expect(await page("a-claimed")).toContain("Release claim");
    expect(await page("a-ready")).not.toContain("Release claim");
  });

  it("offers Block unless the story is blocked or finished", async () => {
    expect(await page("a-ready")).toContain(">Block<");
    for (const id of ["a-blocked", "a-done", "a-closed"]) expect(await page(id)).not.toContain(">Block<");
  });

  it("relays Spawn worker to ringo with ringo's confirm, and offers nothing on a finished story", async () => {
    const body = await page("a-ready");
    expect(body).toContain('data-relay="spawnloop/story-spawn"');
    expect(body).toContain("Spawn a worker for a-ready now, using the current loop settings?");
    for (const id of ["a-done", "a-closed"]) {
      const finished = await page(id);
      expect(finished).not.toContain("Spawn worker");
      expect(finished).not.toContain("Close story");
    }
  });
});

describe("the story page's verbs", () => {
  it("marks a draft ready", async () => {
    expect((await post("markReady", { id: "v-ready" })).status).toBe(303);
    expect((await Story.find("v-ready")).status).toBe("ready");
  });

  it("pins to priority 0", async () => {
    expect((await post("topQueue", { id: "v-top" })).status).toBe(303);
    expect((await Story.find("v-top")).priority).toBe(0);
    expect(await Event.where({ verb: "priority", story_id: "v-top" }).count()).toBe(1);
  });

  it("blocks and closes with the reason given", async () => {
    await post("blockStory", { id: "v-block", reason: "waiting" });
    expect((await Story.find("v-block")).blocked_by).toBe("waiting");
    await post("closeStory", { id: "v-close", reason: "superseded" });
    expect((await Story.find("v-close")).closed_reason).toBe("superseded");
  });

  it("releases a claim", async () => {
    expect((await post("releaseClaim", { id: "v-release" })).status).toBe(303);
    expect((await Story.find("v-release")).status).toBe("ready");
  });

  it("shows the CLI's refusal for a blank reason", async () => {
    const closed = await post("closeStory", { id: "a-ready", reason: " " });
    expect(closed.status).toBe(422);
    expect(closed.body).toContain("close requires a reason");
    const blocked = await post("blockStory", { id: "a-ready", reason: "" });
    expect(blocked.status).toBe(422);
    expect(blocked.body).toContain("block requires a reason");
  });

  it("refuses a verb the page does not offer", async () => {
    const { status, body } = await post("markReady", { id: "a-ready" });
    expect(status).toBe(409);
    expect(body).toContain("cannot ready it");
    expect((await Story.find("a-ready")).status).toBe("ready");
  });

  it("answers 404 for an unknown story", async () => {
    expect((await post("topQueue", { id: "nope" })).status).toBe(404);
  });
});
