import { beforeAll, describe, expect, it } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc, Story, StoryDep, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * ONE status vocabulary, across every page that shows one.
 *
 * The rule is written out in `app/views/shared/_status-badge`: a story status
 * a page shows is the EFFECTIVE one, `effectiveStoryStatus(rfcStatus,
 * story.status)`. This file pins the single case that made four pages
 * disagree — a story authored `ready` under a non-active RFC — over ONE
 * fixture, on all four at once.
 *
 * One fixture and one file is the point. Each page has its own test file and
 * each would have gone on passing while saying something different from the
 * others: the defect was never inside a page, it was between them, and only a
 * test that reads them together can see it.
 */
async function get(
  controller: typeof RfcPagesController | typeof StoryPagesController,
  action: string,
  params: Record<string, string> = {},
): Promise<string> {
  const tc = await controllerTestCase(controller);
  await tc.get(action, { params });
  expect(tc.response.status).toBe(200);
  return tc.response.body;
}

/** Every status a badge on the page states, in page order. */
function badges(body: string): string[] {
  return [...body.matchAll(/class="badge s-([a-z-]+)"/g)].map((m) => m[1]!);
}

/** The one status the page-header state pill states. */
function pill(body: string): string {
  return /class="state s-([a-z-]+)"/.exec(body)?.[1] ?? "";
}

/** The `/rfcs` progress bar of `rfcId`, as status -> segment width. */
function bar(body: string, rfcId: string): Map<string, string> {
  const row = body.slice(body.indexOf(`href="/rfc/${rfcId}"`));
  // Up to the bar's end, or the next row's title when the bar ends otherwise.
  const ends = [row.indexOf("</span></span>"), row.indexOf('class="row-title"')].filter((at) => at >= 0);
  const end = Math.min(...ends);
  const segments = new Map<string, string>();
  for (const m of row.slice(0, end).matchAll(/class="seg s-([a-z-]+)" style="width:([^"]+)"/g)) {
    segments.set(m[1]!, m[2]!);
  }
  return segments;
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");

  // Two RFCs holding the SAME authored status, so every assertion below is
  // about the parent and never about the story.
  await Rfc.create({ id: "0900-idea", status: "draft", title: "An idea" });
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap" });

  await Story.create({ id: "iced", rfc_id: "0900-idea", status: "ready", title: "Not yet" });
  await Story.create({ id: "iced-mate", rfc_id: "0900-idea", status: "draft" });
  await Story.create({ id: "live", rfc_id: "0136-trailmap", status: "ready", title: "Up next" });
  // Depends on the iced story, so the dep badge on `/story/held` is the same
  // question asked from a fifth place — and, being held on that dep, is itself
  // shown `blocked`, as ringo's `markDepBlocked` shows it. Under an RFC of its
  // own so the control below stays one story.
  await Rfc.create({ id: "0140-waits", status: "active", title: "waits" });
  await Story.create({ id: "held", rfc_id: "0140-waits", status: "ready", title: "Waits on iced" });
  await StoryDep.create({ story_id: "held", depends_on_id: "iced" });
});

describe("one status vocabulary", () => {
  it("shows the RFC page's row as the draft the queue sees", async () => {
    const body = await get(RfcPagesController, "show", { id: "0900-idea" });

    // Two stories, two badges — the RFC's own status is a state pill, not a badge.
    expect(badges(body)).toEqual(["draft", "draft"]);
    expect(body).not.toContain('class="badge s-ready"');
  });

  it("shows the backlog row as a draft, and never on the Ready tab", async () => {
    const ready = await get(StoryPagesController, "index", { filter: "ready" });
    expect(ready).not.toContain('href="/story/iced"');
    expect(ready).toContain('href="/story/live"');

    const icebox = await get(StoryPagesController, "index", { filter: "icebox" });
    expect(icebox).toContain('href="/story/iced"');
    expect(badges(icebox)).toEqual(["draft", "draft"]);
  });

  it("shows the story page's own state pill as a draft", async () => {
    expect(pill(await get(StoryPagesController, "show", { id: "iced" }))).toBe("draft");
    expect(pill(await get(StoryPagesController, "show", { id: "live" }))).toBe("ready");
  });

  it("shows a dependency on it as a draft, because it still gates", async () => {
    const body = await get(StoryPagesController, "show", { id: "held" });

    expect(badges(body)).toContain("draft");
    expect(badges(body)).not.toContain("ready");
  });

  it("shows a ready story held on an unfinished dep as blocked, everywhere", async () => {
    expect(pill(await get(StoryPagesController, "show", { id: "held" }))).toBe("blocked");
    expect(badges(await get(RfcPagesController, "show", { id: "0140-waits" }))).toEqual(["blocked"]);
    expect([...bar(await get(RfcPagesController, "index", { status: "active" }), "0140-waits")]).toEqual([
      ["blocked", "100%"],
    ]);
    const ready = await get(StoryPagesController, "index", { filter: "ready" });
    expect(ready).not.toContain('href="/story/held"');
  });

  it("segments the RFC list's bar as a draft", async () => {
    const draft = await get(RfcPagesController, "index", { status: "draft" });

    expect([...bar(draft, "0900-idea")]).toEqual([["draft", "100%"]]);
  });

  it("leaves the same authored status alone under an active RFC", async () => {
    // The control. Without it every assertion above passes for an
    // implementation that simply prints `draft` everywhere.
    const active = await get(RfcPagesController, "index", { status: "active" });
    expect([...bar(active, "0136-trailmap")]).toEqual([["ready", "100%"]]);

    const rfc = await get(RfcPagesController, "show", { id: "0136-trailmap" });
    expect(badges(rfc)).toContain("ready");
  });
});
