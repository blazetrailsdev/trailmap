/**
 * The RFC page's Refinements tab, and the endpoint that stores the reports it
 * shows. The reports live in the hub, so these need the hub test database.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Rfc } from "../../app/models/rfc.ts";
import { RfcRefine } from "../../app/models/rfc-refine.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { RfcRefinesController } from "../../app/controllers/rfc-refines-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";
import {
  connectHubTestDatabase,
  HUB_SETUP_TIMEOUT,
  hasHubTestDatabase,
  releaseHubTestDatabase,
  truncateHub,
} from "../support/hub-schema.ts";

async function page(action: string, id: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.get(action, { params: { id } });
  return { status: tc.response.status, body: tc.response.body };
}

async function report(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const tc = await controllerTestCase(RfcRefinesController, { Host: "127.0.0.1" });
  await tc.post("create", { params: body, as: "json" });
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
}

describe.skipIf(!hasHubTestDatabase())("RfcRefinements", () => {
  beforeAll(connectHubTestDatabase, HUB_SETUP_TIMEOUT);
  beforeEach(async () => {
    await Rfc.create({ id: "0002-quiet", status: "active", title: "Quiet" });
  });
  beforeEach(truncateHub);
  afterAll(releaseHubTestDatabase);

  it("shows the latest refine report, then the earlier ones newest first", async () => {
    await RfcRefine.create({
      rfc_id: "0136-trailmap",
      outcome: "no-change",
      summary: "first pass",
      created_at: new Date("2026-11-01T09:00:00Z"),
    });
    await RfcRefine.create({
      rfc_id: "0136-trailmap",
      outcome: "aborted",
      summary: "second pass",
      created_at: new Date("2026-11-02T09:00:00Z"),
    });
    await RfcRefine.create({
      rfc_id: "0136-trailmap",
      outcome: "changed",
      summary: "# Report\n\nclosed **3**",
      created_at: new Date("2026-11-03T09:30:00Z"),
    });

    const { status, body } = await page("refinements", "0136-trailmap");

    expect(status).toBe(200);
    expect(body).toMatch(/class="tab active" href="\/rfc\/0136-trailmap\/refinements" aria-current="page">Refinements <span class="Counter">3<\/span>/);
    expect(body).toContain('<span class="Label refine-changed">changed</span>');
    expect(body).toContain("2026-11-03 09:30 UTC");
    expect(body).toContain("<strong>3</strong>");
    expect(body).toContain("Earlier reports");
    expect(body.indexOf("second pass")).toBeLessThan(body.indexOf("first pass"));
    expect(body).not.toContain("No refine report yet");
  });

  it("says there is no refine report yet when there is none", async () => {
    const { status, body } = await page("refinements", "0002-quiet");

    expect(status).toBe(200);
    expect(body).toContain("No refine report yet. Run “Refine stories”");
    expect(body).toContain('Refinements <span class="Counter">0</span>');
    expect(body).not.toContain("Earlier reports");
  });

  it("counts the reports on the Stories tab too", async () => {
    await RfcRefine.create({ rfc_id: "0136-trailmap", outcome: "changed", summary: "s" });

    const { body } = await page("show", "0136-trailmap");

    expect(body).toMatch(/class="tab active" href="\/rfc\/0136-trailmap" aria-current="page">Stories <span class="Counter">0<\/span>/);
    expect(body).toContain('<a class="tab" href="/rfc/0136-trailmap/refinements">Refinements <span class="Counter">1</span></a>');
  });

  it("answers 404 for an unknown id on the Refinements tab", async () => {
    const { status, body } = await page("refinements", "9999-nope");

    expect(status).toBe(404);
    expect(body).toContain("9999-nope");
  });

  it("stores a refine report posted as kind=rfc-refine", async () => {
    const { status, body } = await report({
      kind: "rfc-refine",
      id: "0136-trailmap",
      outcome: "changed",
      pane: "%404",
      summary: "# Report",
    });

    expect(status).toBe(201);
    expect(body.outcome).toBe("changed");
    const stored = await RfcRefine.forRfc("0136-trailmap").toArray();
    expect(stored.map((r) => [r.outcome, r.summary])).toEqual([["changed", "# Report"]]);
  });

  it("stores a null summary as an empty one", async () => {
    const { status } = await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "no-change", summary: null });

    expect(status).toBe(201);
    const stored = await RfcRefine.forRfc("0136-trailmap").toArray();
    expect(stored.map((r) => [r.outcome, r.summary])).toEqual([["no-change", ""]]);
  });

  it("refuses a report for an unknown RFC, another kind, an unknown outcome, or a summary that is not a string", async () => {
    expect((await report({ kind: "rfc-refine", id: "9999-nope", outcome: "changed" })).status).toBe(404);
    expect((await report({ kind: "story", id: "0136-trailmap", outcome: "changed" })).status).toBe(400);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "maybe" })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: { a: 1 } })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: ["a"] })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: false })).status).toBe(422);
    expect(await RfcRefine.count()).toBe(0);
  });
});
