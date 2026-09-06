import { beforeAll, describe, expect, it } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { cwd, setEnv } from "@blazetrails/activesupport/process-adapter";
import { migrateScratchDatabase } from "../models/schema.js";
import {
  Rfc,
  Story,
  StoryDep,
  StoryPackage,
  StoryRfcDep,
  loadModelSchemas,
} from "../../app/models/index.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";

async function show(id: string): Promise<{ status: number; body: string }> {
  const tc = new ActionController.TestCase(StoryPagesController);
  await tc.get("show", { params: { id } });
  return { status: tc.response.status, body: tc.responseBody };
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  setEnv("TASKS_DIR", cwd());

  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    packages: '["trailties"]',
  });
  await Rfc.create({ id: "0061-ci", status: "closed", title: "CI failures" });

  await Story.create({
    id: "render-the-rfc-and-story-show-pages",
    rfc_id: "0136-trailmap",
    status: "claimed",
    title: "Serve /rfc/<id> and /story/<id> from trailmap",
    est_loc: 250,
    priority: 7,
    assignee: "an-agent",
    file_path: "README.md",
  });
  await Story.create({ id: "serve-the-read-verbs-as-json", rfc_id: "0136-trailmap", status: "done" });
  await Story.create({ id: "declared", rfc_id: "0136-trailmap", status: "ready" });
  await StoryPackage.create({ story_id: "declared", package: "actionview" });
  await StoryDep.create({
    story_id: "render-the-rfc-and-story-show-pages",
    depends_on_id: "serve-the-read-verbs-as-json",
  });
  // A dep on a story that is not in the index — an unknown status, not a
  // satisfied one, which is the distinction the page has to keep.
  await StoryDep.create({
    story_id: "render-the-rfc-and-story-show-pages",
    depends_on_id: "vanished",
  });
  await StoryRfcDep.create({ story_id: "render-the-rfc-and-story-show-pages", rfc_id: "0061-ci" });
});

describe("StoryPagesController", () => {
  it("renders the story's title and status through the app layout", async () => {
    const { status, body } = await show("render-the-rfc-and-story-show-pages");

    expect(status).toBe(200);
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("<h1>Serve /rfc/&lt;id&gt; and /story/&lt;id&gt; from trailmap</h1>");
    expect(body).toContain('<span class="badge s-claimed">claimed</span>');
  });

  it("shows the metadata the ready queue ranks on", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain("<dd>250</dd>");
    expect(body).toContain("<dd>p7</dd>");
    expect(body).toContain("<dd>an-agent</dd>");
    expect(body).toContain('<a href="/rfc/0136-trailmap">trailmap</a>');
  });

  it("lists both kinds of dependency with the status that gates them", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain('<a href="/story/serve-the-read-verbs-as-json">');
    expect(body).toContain('<span class="badge s-done">done</span>');
    expect(body).toContain('<a href="/rfc/0061-ci">0061-ci</a>');
    // The missing dep reads as unknown, not as resolved.
    expect(body).toContain('<a href="/story/vanished">');
    expect(body).toContain('<span class="badge s-unknown">unknown</span>');
  });

  it("inherits the RFC's packages when the story declares none", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain("Packages (from RFC)");
    expect(body).toContain("<dd>trailties</dd>");
  });

  it("shows a story's own packages without calling them inherited", async () => {
    const { body } = await show("declared");

    expect(body).toContain("<dt>Packages</dt>");
    expect(body).toContain("<dd>actionview</dd>");
    expect(body).not.toContain("(from RFC)");
  });

  it("renders the story's markdown from the checkout", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain('<article class="markdown">');
    expect(body).not.toContain("Could not read");
  });

  it("renders a story with no document without failing", async () => {
    const { status, body } = await show("declared");

    expect(status).toBe(200);
    expect(body).toContain("No document.");
  });

  it("answers 404 for an unknown id, and says which id", async () => {
    const { status, body } = await show("no-such-story");

    expect(status).toBe(404);
    expect(body).toContain("<h1>Story not found</h1>");
    expect(body).toContain("<code>no-such-story</code>");
  });
});
