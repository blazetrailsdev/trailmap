/**
 * `/backlog` is served a page at a time, and the pages are the whole tab.
 *
 * Its own database, apart from backlog-page.test.ts: these need a tab longer
 * than a page, and two hundred extra stories would change every count that
 * file asserts.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import {
  BACKLOG_PAGE_SIZE,
  StoryPagesController,
} from "../../app/controllers/story-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

const READY = 2 * BACKLOG_PAGE_SIZE + 5;

async function index(params: Record<string, string> = {}): Promise<string> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.get("index", { params });
  return tc.response.body;
}

function rowIds(body: string): string[] {
  return [...body.matchAll(/class="row-title" href="\/story\/([^"]+)"/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");
  await Rfc.create({ id: "0136-trailmap", status: "active", title: "Trailmap" });
  for (let n = 0; n < READY; n++) {
    await Story.create({ id: `story-${String(n).padStart(3, "0")}`, rfc_id: "0136-trailmap" });
  }
  await Story.where({ rfc_id: "0136-trailmap" }).updateAll({ status: "ready" });
  await Story.create({ id: "the-one-draft", rfc_id: "0136-trailmap" });
});

describe("StoryPagesController#index, paged", () => {
  it("serves one page of rows and says where it is in the tab", async () => {
    const body = await index({ filter: "ready" });

    expect(rowIds(body)).toHaveLength(BACKLOG_PAGE_SIZE);
    expect(body).toContain(`1&ndash;${BACKLOG_PAGE_SIZE} of ${READY} &middot; page 1 of 3`);
    expect(body).toContain('rel="next" href="/backlog?filter=ready&amp;page=2"');
    expect(body).not.toContain('rel="prev"');
  });

  it("covers the tab exactly once across its pages, in one order", async () => {
    const pages = [
      rowIds(await index({ filter: "ready", page: "1" })),
      rowIds(await index({ filter: "ready", page: "2" })),
      rowIds(await index({ filter: "ready", page: "3" })),
    ];

    expect(pages.map((ids) => ids.length)).toEqual([BACKLOG_PAGE_SIZE, BACKLOG_PAGE_SIZE, 5]);
    const all = pages.flat();
    expect(new Set(all).size).toBe(READY);
    expect(all).toEqual((await Story.claimable()).map((story) => story.id));
  });

  it("numbers a row by its place in the whole queue, not on the page", async () => {
    const body = await index({ filter: "ready", page: "2" });

    expect(body).not.toContain('class="tag next"');
    expect(body).toContain(`#${BACKLOG_PAGE_SIZE + 1} in queue`);
    expect(body).toContain(`#${2 * BACKLOG_PAGE_SIZE} in queue`);
  });

  it("keeps every tab's count a count of the whole tab", async () => {
    const body = await index({ filter: "ready", page: "3" });

    expect(body).toContain(`>${READY} Ready</a>`);
    expect(body).toContain(">1 Draft</a>");
  });

  it("shows the last page for a page past the end, and the first for nonsense", async () => {
    expect(rowIds(await index({ filter: "ready", page: "99" }))).toHaveLength(5);
    expect(await index({ filter: "ready", page: "99" })).toContain("page 3 of 3");
    expect(await index({ filter: "ready", page: "0" })).toContain("page 1 of 3");
    expect(await index({ filter: "ready", page: "two" })).toContain("page 1 of 3");
    expect(await index({ filter: "ready", page: "2abc" })).toContain("page 1 of 3");
    expect(await index({ filter: "ready", page: "1e3" })).toContain("page 1 of 3");
  });

  it("draws no page links for a tab that fits one page", async () => {
    const body = await index({ filter: "draft" });

    expect(rowIds(body)).toEqual(["the-one-draft"]);
    expect(body).not.toContain('class="pager"');
  });
});
