import { beforeAll, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.js";
import { ActionController } from "@blazetrails/actionpack";
import { Dir, setEnv } from "@blazetrails/ruby-compat";
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
import { controllerTestCase } from "../support/controller-test-case.js";

async function show(id: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.get("show", { params: { id } });
  return { status: tc.response.status, body: tc.response.body };
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  setX("tasks", "dir", Dir.pwd());

  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    packages: ["trailties"],
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

  // Deps and packages inserted in REVERSE alphabetical order, so rowid order
  // and column order disagree and the page has to pick one. See the ordering
  // test below for why that distinction is the whole point.
  await Rfc.create({ id: "0002-zeta", status: "active", title: "Zeta" });
  await Rfc.create({ id: "0001-alpha", status: "active", title: "Alpha" });
  await Story.create({ id: "z-dep", rfc_id: "0136-trailmap", status: "done" });
  await Story.create({ id: "a-dep", rfc_id: "0136-trailmap", status: "done" });
  await Story.create({
    id: "ordered-deps",
    rfc_id: "0136-trailmap",
    status: "ready",
    title: "Deps in the order the file lists them",
  });
  await StoryDep.create({ story_id: "ordered-deps", depends_on_id: "z-dep" });
  await StoryDep.create({ story_id: "ordered-deps", depends_on_id: "a-dep" });
  await StoryRfcDep.create({ story_id: "ordered-deps", rfc_id: "0002-zeta" });
  await StoryRfcDep.create({ story_id: "ordered-deps", rfc_id: "0001-alpha" });
  await StoryPackage.create({ story_id: "ordered-deps", package: "zzz-last" });
  await StoryPackage.create({ story_id: "ordered-deps", package: "aaa-first" });
});

describe("StoryPagesController", () => {
  /**
   * The rowid order the three join tables are read in, pinned.
   *
   * `story_deps`, `story_rfc_deps` and `story_packages` carry no ordering
   * column: rowid IS the order the story's frontmatter listed them in, which
   * is what ringo shows and what the author wrote. Left unordered, SQLite
   * answers a `story_id =` filter from the index and hands the rows back
   * sorted by the indexed columns — alphabetically — which reads as a
   * deliberate ordering and is an accident of the query plan.
   *
   * `pnpm gate:pages` is what found that, and it cannot run in CI, so this is
   * the guard that keeps it fixed: every list here is inserted in reverse
   * alphabetical order, so an `.order({ rowid: "asc" })` that stops being
   * applied — or is rejected by a future query builder as an undeclared
   * column — flips all three and fails here rather than silently on the box.
   */
  it("lists deps, RFC deps and packages in rowid order, not alphabetically", async () => {
    const { status, body } = await show("ordered-deps");

    expect(status).toBe(200);
    expect([...body.matchAll(/href="\/story\/([^"]+)"/g)].map((m) => m[1])).toEqual([
      "z-dep",
      "a-dep",
    ]);
    expect([...body.matchAll(/href="\/rfc\/([^"]+)"/g)].map((m) => m[1])).toEqual([
      // The subhead and the sidebar both link the parent RFC; the dep RFCs
      // follow, in the order the story declared them.
      "0136-trailmap",
      "0002-zeta",
      "0001-alpha",
      "0136-trailmap",
    ]);
    expect(body.indexOf("zzz-last")).toBeLessThan(body.indexOf("aaa-first"));
  });

  it("renders the story's title and status through the app layout", async () => {
    const { status, body } = await show("render-the-rfc-and-story-show-pages");

    expect(status).toBe(200);
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain("Serve /rfc/&lt;id&gt; and /story/&lt;id&gt; from trailmap");
    expect(body).toContain('<span class="id">render-the-rfc-and-story-show-pages</span>');
    // Header state pill; the dep rows below use the small badge (#7).
    expect(body).toContain('<span class="state s-claimed">claimed</span>');
  });

  it("shows the metadata the ready queue ranks on", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    // The sidebar, GitHub-issue style: a small heading over each value.
    expect(body).toContain('<div class="side-head">Est LOC</div>');
    expect(body).toContain("250");
    expect(body).toContain('<div class="side-head">Priority</div>');
    expect(body).toContain("p7");
    expect(body).toContain('<div class="side-head">Assignee</div>');
    expect(body).toContain("an-agent");
    expect(body).toContain('<a href="/rfc/0136-trailmap">trailmap</a>');
  });

  it("lists both kinds of dependency with the status that gates them", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain('href="/story/serve-the-read-verbs-as-json"');
    expect(body).toContain('<span class="badge s-done">done</span>');
    expect(body).toContain('href="/rfc/0061-ci"');
    // The missing dep reads as unknown, not as resolved.
    expect(body).toContain('href="/story/vanished"');
    expect(body).toContain('<span class="badge s-unknown">unknown</span>');
  });

  it("inherits the RFC's packages when the story declares none", async () => {
    const { body } = await show("render-the-rfc-and-story-show-pages");

    expect(body).toContain("Packages (from RFC)");
    expect(body).toContain('<span class="badge">trailties</span>');
  });

  it("shows a story's own packages without calling them inherited", async () => {
    const { body } = await show("declared");

    expect(body).toContain('<div class="side-head">Packages</div>');
    expect(body).toContain('<span class="badge">actionview</span>');
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
    expect(body).toContain('<h1 class="page-title">Story not found</h1>');
    expect(body).toContain("<code>no-such-story</code>");
  });
});
