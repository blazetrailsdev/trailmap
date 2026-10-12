import { beforeAll, describe, expect, it, vi } from "vitest";
import { ActionController } from "@blazetrails/actionpack";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * `/rfcs`, the server-rendered RFC list.
 *
 * Its own file rather than more cases in `rfc-pages-controller.test.ts`: the
 * list is about a SET of RFCs — the tab counts, the ordering, the per-status
 * split of one RFC's stories — and the show page's fixture is one RFC with
 * enough stories to make a progress bar, which is the wrong shape for any of
 * that.
 */
async function index(status?: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.get("index", { params: status === undefined ? {} : { status } });
  return { status: tc.response.status, body: tc.response.body };
}

/** The RFC ids the page lists, in the order it lists them. */
function listed(body: string): string[] {
  return [...body.matchAll(/href="\/rfc\/([^"]+)"/g)].map((m) => m[1]!);
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    owner: "dean",
    priority: 2,
    created_on: "2026-01-01",
    clusters: ["pages"],
  });
  // Same explicit priority, fewer stories left — the tiebreak ringo applies
  // only when both sides set a priority.
  await Rfc.create({ id: "0100-alpha", status: "active", title: "Alpha", priority: 2 });
  await Rfc.create({ id: "0200-zeta", status: "active", title: "Zeta" });
  await Rfc.create({ id: "0002-empty", status: "draft", title: "An idea" });
  await Rfc.create({
    id: "0014-fixtures-adoption",
    status: "superseded",
    title: "Fixtures adoption",
    superseded_by: "0019-canonical-schema-burndown",
    created_on: "2024-01-01",
  });

  await Story.create({ id: "queued", rfc_id: "0136-trailmap", status: "ready" });
  await Story.create({ id: "working", rfc_id: "0136-trailmap", status: "in-progress" });
  await Story.create({ id: "stuck", rfc_id: "0136-trailmap", status: "blocked" });
  await Story.create({ id: "abandoned", rfc_id: "0136-trailmap", status: "closed" });
  await Story.create({ id: "alpha-one", rfc_id: "0100-alpha", status: "ready" });
  // Created last: an RFC auto-closes the moment every story it has is done
  // (rfc-close.ts), so a `done` story must never be the only one on it.
  await Story.create({ id: "shipped", rfc_id: "0136-trailmap", status: "done" });
});

describe("RfcPagesController#index", () => {
  it("renders the list server-side, with no fetch for the initial view", async () => {
    const { status, body } = await index();

    expect(status).toBe(200);
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain('<h1 class="page-title">RFCs</h1>');
    expect(body).toContain("trailmap");
    // The whole point of the port: ringo's shell fetches its rows.
    expect(body).not.toContain("fetch(");
    expect(body).not.toContain("<script");
  });

  it("shows the active RFCs by default, and ranks them the way ringo does", async () => {
    const { body } = await index();

    expect(listed(body)).toEqual(["0100-alpha", "0136-trailmap", "0200-zeta"]);
  });

  it("counts every status on the tabs, not just the one on show", async () => {
    const { body } = await index();

    expect(body).toContain(">3 active</a>");
    expect(body).toContain(">1 draft</a>");
    expect(body).toContain(">0 postponed</a>");
    expect(body).toContain(">1 superseded</a>");
    expect(body).toContain('href="/rfcs?status=draft"');
  });

  it("leaves the status off the rows, because the selected tab already says it", async () => {
    for (const status of ["active", "draft", "superseded"]) {
      const { body } = await index(status);

      expect(listed(body).length, status).toBeGreaterThan(0);
      expect(body, status).not.toContain('class="badge s-');
      // The one place the status is stated: the tab the list is filtered to.
      expect(body, status).toMatch(new RegExp(`class="tab active"[^>]*>\\d+ ${status}</a>`));
    }
  });

  it("filters to the requested status, and falls back to active for a bad one", async () => {
    expect(listed((await index("superseded")).body)).toEqual(["0014-fixtures-adoption"]);
    expect(listed((await index("nonsense")).body)).toEqual([
      "0100-alpha",
      "0136-trailmap",
      "0200-zeta",
    ]);
  });

  it("reports the same done/total the show page does, leaving closed stories out", async () => {
    const { body } = await index();

    // 5 stories, one closed: 4 count, 1 done.
    expect(body).toContain("1/4 done");
    expect(body).toContain("5 stories");
  });

  it("splits an RFC's stories into a bar that counts the closed ones", async () => {
    const { body } = await index();

    // Bar order is shipped → dead → moving → queued → stuck → not started.
    const segments = [...body.matchAll(/class="seg s-([a-z-]+)"/g)].map((m) => m[1]!);
    // 0100-alpha's single ready story leads; trailmap's five follow.
    expect(segments).toEqual(["ready", "done", "closed", "in-progress", "ready", "blocked"]);
    expect(body).toContain('title="1 closed"');
  });

  it("draws a longer bar for the RFC with more stories", async () => {
    const { body } = await index();

    const lengths = [...body.matchAll(/class="sbar" style="width:([\d.]+)%"/g)].map((m) => Number(m[1]));
    // 0100-alpha has one story and leads; trailmap has five, and is the scale.
    expect(lengths).toHaveLength(2);
    expect(lengths[0]).toBeLessThan(lengths[1]!);
    expect(lengths[1]).toBe(100);
    // Nothing exceeds the scale here, so nothing is marked as clamped.
    expect(body).not.toContain("sbarmore");
  });

  it("ages an open RFC and says nothing about a terminal one", async () => {
    expect((await index()).body).toMatch(/open \d+d/);
    expect((await index("superseded")).body).not.toMatch(/open \d+d/);
  });

  it("says which slice is empty rather than showing a blank list", async () => {
    const { body } = await index("postponed");

    expect(body).toContain("No postponed RFCs.");
  });

  // The page counts statuses; it has no use for the records. Loading them is
  // what made every tab take a second against 11,000 stories.
  it("counts stories without instantiating them", async () => {
    const built = vi.spyOn(Story, "_loadFromSql");
    try {
      await index("closed");
      expect(built).not.toHaveBeenCalled();
    } finally {
      built.mockRestore();
    }
  });
});
