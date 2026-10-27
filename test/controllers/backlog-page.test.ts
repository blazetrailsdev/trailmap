import { beforeAll, describe, expect, it, vi } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc, Story, StoryPackage, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

/**
 * `/backlog`, the server-rendered story list. Separate from the story show
 * page's tests for the reason `rfc-list-page.test.ts` gives: this is about the
 * set — the tab predicates, the queue order, and the effective priority and
 * packages a story inherits from its RFC.
 */
async function index(filter?: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.get("index", { params: filter === undefined ? {} : { filter } });
  return { status: tc.response.status, body: tc.response.body };
}

/** The story ids the page lists, in the order it lists them. */
function listed(body: string): string[] {
  return [...body.matchAll(/class="row-title" href="\/story\/([^"]+)"/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    priority: 4,
    packages: ["activerecord"],
  });
  // A draft RFC ices everything under it: an idea, not yet a plan.
  await Rfc.create({ id: "0900-idea", status: "draft", title: "An idea" });

  await Story.create({
    id: "ready-one",
    rfc_id: "0136-trailmap",
    status: "ready",
    title: "First up",
    priority: 1,
    est_loc: 120,
    cluster: "pages",
    updated_on: "2026-01-01",
  });
  await StoryPackage.create({ story_id: "ready-one", package: "actionview" });
  await Story.create({ id: "ready-two", rfc_id: "0136-trailmap", status: "ready" });
  await Story.create({ id: "working", rfc_id: "0136-trailmap", status: "in-progress", pr: "trails#42" });
  await Story.create({ id: "stuck", rfc_id: "0136-trailmap", status: "blocked" });
  await Story.create({ id: "drafted", rfc_id: "0136-trailmap", status: "draft" });
  await Story.create({ id: "iced", rfc_id: "0900-idea", status: "ready" });
  await Story.create({ id: "iced-draft", rfc_id: "0900-idea", status: "draft" });
  // Finished, under a draft RFC: the row must not wear the icebox tag and the
  // tab must not list it — a done story does not become an idea again.
  await Story.create({ id: "iced-done", rfc_id: "0900-idea", status: "done" });
  await Story.create({ id: "shipped", rfc_id: "0136-trailmap", status: "done" });
  // Under a closed RFC: on no tab at all, not even Closed.
  await Rfc.create({ id: "0800-abandoned", status: "closed", title: "Abandoned" });
  await Story.create({ id: "shelved", rfc_id: "0800-abandoned", status: "done" });
});

describe("StoryPagesController#index", () => {
  it("renders the list server-side, with no fetch for the initial view", async () => {
    const { status, body } = await index();

    expect(status).toBe(200);
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain('<h1 class="page-title">Backlog</h1>');
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("<script");
  });

  it("opens on the work that could actually be picked, in status then queue order", async () => {
    const { body } = await index();

    expect(listed(body)).toEqual(["working", "ready-one", "ready-two", "stuck", "drafted"]);
  });

  it("marks the ready queue in pick order, reusing the queue the CLI ranks", async () => {
    const { body } = await index();

    expect(body).toContain('<span class="tag next">next up</span>');
    expect(body).toContain('<span class="tag queue">#2 in queue</span>');
    expect(body).toContain("2 in the ready queue");
  });

  it("counts each tab through the same predicate that fills it", async () => {
    const { body } = await index();

    expect(body).toContain(">5 Open</a>");
    expect(body).toContain(">2 Closed</a>");
    expect(body).toContain(">2 Ready</a>");
    expect(body).toContain(">1 Draft</a>");
    expect(body).toContain(">1 Blocked</a>");
    expect(body).toContain(">2 Icebox</a>");
  });

  /**
   * ringo's `matchesFilter` would put this story on Ready — its own comment
   * says a ready story under a draft RFC is still live work — but ringo's page
   * never sees a `ready` status here: the index it fetches carries the
   * EFFECTIVE status, and `effectiveStoryStatus` downgraded this one to draft
   * before the tab predicate ran. Reading the stored status instead advertised
   * work on the Ready tab that nothing could claim, which is what
   * `pnpm gate:lists` caught.
   */
  it("shows an iced ready story as the draft the index calls it, on neither Open nor Ready", async () => {
    expect(listed((await index()).body)).not.toContain("iced");
    expect(listed((await index("ready")).body)).not.toContain("iced");
    expect(listed((await index("icebox")).body)).toContain("iced");
  });

  /**
   * `allStories` (webhook/spawnloop.go:1373) drops these before ringo's page
   * sees them: the backlog is the work still in play, and a closed RFC's is
   * not. It is the only place a whole RFC's worth of stories leaves the list.
   */
  it("leaves out the stories under a closed RFC, which are no longer in play", async () => {
    for (const filter of ["open", "done", "ready", "draft", "blocked", "icebox"]) {
      expect(listed((await index(filter)).body)).not.toContain("shelved");
    }
    expect((await index("done")).body).toContain(">2 Closed</a>");
  });

  it("partitions the drafts: a draft under a draft RFC is iced, not waiting to be groomed", async () => {
    expect(listed((await index("draft")).body)).toEqual(["drafted"]);
    expect(listed((await index("icebox")).body)).toEqual(["iced", "iced-draft"]);
  });

  it("leaves a done story out of the icebox — it does not become an idea again", async () => {
    expect(listed((await index("done")).body)).toEqual(["iced-done", "shipped"]);
    expect(listed((await index("icebox")).body)).not.toContain("iced-done");
  });

  /**
   * The invariant the module exists for, at the row level rather than the tab
   * level: the label a row wears and the tab that would collect it are the
   * same predicate, so a story cannot be tagged `icebox` on one tab and be
   * absent from the Icebox tab.
   */
  it("tags exactly the rows the Icebox tab collects", async () => {
    const iced = listed((await index("icebox")).body);
    const readyRows = (await index("ready")).body.split('class="item-row"').slice(1);

    for (const row of readyRows) {
      const id = /class="row-title" href="\/story\/([^"]+)"/.exec(row)?.[1];
      expect(row.includes('class="tag icebox"')).toBe(iced.includes(id!));
    }
    expect(iced).toContain("iced");
  });

  it("shows the effective priority and packages, flagging the inherited ones", async () => {
    const { body } = await index();

    expect(body).toContain(">pri 1</span>");
    // ready-two authors neither, so both come from RFC 0136-trailmap.
    expect(body).toContain(">pri 4*</span>");
    expect(body).toContain(">actionview</span>");
    expect(body).toContain(">activerecord*</span>");
  });

  it("carries the metadata a picker reads before claiming", async () => {
    const { body } = await index();

    expect(body).toContain('<a href="/rfc/0136-trailmap">RFC 0136-trailmap</a>');
    expect(body).toContain("~120 LOC");
    expect(body).toMatch(/updated \d+d ago/);
    expect(body).toContain('<span class="tag">pages</span>');
  });

  it("falls back to Open for a filter it does not serve", async () => {
    expect(listed((await index("nonsense")).body)).toEqual(
      listed((await index("open")).body),
    );
  });

  it("says which slice is empty rather than showing a blank list", async () => {
    await Story.where({ id: "iced" }).updateAll({ rfc_id: "0136-trailmap" });
    await Story.where({ id: "iced-draft" }).updateAll({ rfc_id: "0136-trailmap" });

    expect((await index("icebox")).body).toContain("No stories under draft or postponed RFCs.");
  });

  // The page ranks from four plucked columns and loads records only for the
  // rows it draws. Loading every story was two and a half seconds a request.
  it("builds a record for each row it shows and for no other story", async () => {
    const built = vi.spyOn(Story, "_loadFromSql");
    try {
      const { body } = await index("blocked");
      const rows = body.split('class="item-row"').length - 1;

      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThan(await Story.count());
      expect(built).toHaveBeenCalledTimes(rows);
    } finally {
      built.mockRestore();
    }
  });
});
