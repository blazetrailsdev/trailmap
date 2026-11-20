/**
 * The RFC page's Refinements tab, and the endpoint that stores the reports it
 * shows: `Refinement` rows on Base, the summary attached.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { StringIO, env } from "@blazetrails/ruby-compat";
import { Rfc } from "../../app/models/rfc.ts";
import { Refinement } from "../../app/models/refinement.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { RfcRefinesController } from "../../app/controllers/rfc-refines-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function refinement(attrs: Record<string, unknown>, summary: string): Promise<Refinement> {
  const refine = await Refinement.create(attrs);
  await refine.summary.attach({ io: new StringIO(summary), filename: "summary.md", contentType: "text/markdown" });
  return refine;
}

async function summaryOf(refine: Refinement): Promise<string> {
  const blob = (await (await refine.summary.attachment)!.blob)!;
  expect(blob.content_type).toBe("text/markdown");
  return new TextDecoder().decode(await blob.download());
}

async function page(action: string, id: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.get(action, { params: { id } });
  return { status: tc.response.status, body: tc.response.body };
}

async function report(body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const tc = await controllerTestCase(RfcRefinesController, {
    Host: "127.0.0.1",
    Authorization: "Bearer refine-test-token",
  });
  await tc.post("create", { params: body, as: "json" });
  return { status: tc.response.status, body: JSON.parse(tc.response.body) };
}

describe("RfcRefinements", () => {
  beforeAll(() => {
    Object.assign(env, { TRAILMAP_INGEST_TOKEN: "refine-test-token" });
  });
  beforeEach(async () => {
    await Rfc.create({ id: "0002-quiet", status: "active", title: "Quiet" });
  });
  afterAll(() => {
    Reflect.deleteProperty(env, "TRAILMAP_INGEST_TOKEN");
  });

  it("requires the ingest token", async () => {
    const tc = await controllerTestCase(RfcRefinesController, { Host: "127.0.0.1" });
    await tc.post("create", { params: { kind: "rfc-refine", id: "0136-trailmap", outcome: "changed" }, as: "json" });

    expect(tc.response.status).toBe(401);
    expect(await Refinement.count()).toBe(0);
  });

  it("shows the latest refine report, then the earlier ones newest first", async () => {
    await refinement({ rfc_id: "0136-trailmap", outcome: "no-change", created_at: new Date("2026-11-01T09:00:00Z") }, "first pass");
    await refinement({ rfc_id: "0136-trailmap", outcome: "aborted", created_at: new Date("2026-11-02T09:00:00Z") }, "second pass");
    await refinement({ rfc_id: "0136-trailmap", outcome: "changed", created_at: new Date("2026-11-03T09:30:00Z") }, "# Report\n\nclosed **3**");

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
    await refinement({ rfc_id: "0136-trailmap", outcome: "changed" }, "s");

    const { body } = await page("show", "0136-trailmap");

    expect(body).toMatch(/class="tab active" href="\/rfc\/0136-trailmap" aria-current="page">Stories <span class="Counter">3<\/span>/);
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
    const [stored, ...rest] = await Refinement.forRfc("0136-trailmap").toArray();
    expect(rest).toEqual([]);
    expect([stored!.outcome, stored!.stories, await summaryOf(stored!)]).toEqual(["changed", 3, "# Report"]);
  });

  it("keeps the time an imported report gives as its created_at", async () => {
    const { status } = await report({
      kind: "rfc-refine",
      id: "0136-trailmap",
      outcome: "changed",
      summary: "imported",
      when: "2026-10-01T12:00:00Z",
    });

    expect(status).toBe(201);
    const [stored] = await Refinement.forRfc("0136-trailmap").toArray();
    expect(stored!.created_at.utc().iso8601()).toBe("2026-10-01T12:00:00Z");
    expect((await page("refinements", "0136-trailmap")).body).toContain("2026-10-01 12:00 UTC");
  });

  it("stores a null summary as an empty one", async () => {
    const { status } = await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "no-change", summary: null });

    expect(status).toBe(201);
    const [stored] = await Refinement.forRfc("0136-trailmap").toArray();
    expect([stored!.outcome, await summaryOf(stored!)]).toEqual(["no-change", ""]);
  });

  it("refuses a report for an unknown RFC, another kind, an unknown outcome, or a summary that is not a string", async () => {
    expect((await report({ kind: "rfc-refine", id: "9999-nope", outcome: "changed" })).status).toBe(404);
    expect((await report({ kind: "story", id: "0136-trailmap", outcome: "changed" })).status).toBe(400);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "maybe" })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: { a: 1 } })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: ["a"] })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", summary: false })).status).toBe(422);
    expect((await report({ kind: "rfc-refine", id: "0136-trailmap", outcome: "changed", when: "soon" })).status).toBe(422);
    expect(await Refinement.count()).toBe(0);
  });

  it("lists every report oldest first without its summary, and needs no token", async () => {
    await refinement({ rfc_id: "0002-quiet", outcome: "no-change", stories: 3, created_at: "2026-08-02T10:00:00Z" }, "later");
    await refinement({ rfc_id: "0002-quiet", outcome: "changed", stories: 2, created_at: "2026-08-01T10:00:00Z" }, "earlier");
    const tc = await controllerTestCase(RfcRefinesController, { Host: "127.0.0.1" });
    await tc.get("index", { params: { rfc: "0002-quiet" } });

    expect(tc.response.status).toBe(200);
    expect(JSON.parse(tc.response.body).map((r: any) => [r.rfc, r.when, r.outcome, r.stories])).toEqual([
      ["0002-quiet", "2026-08-01T10:00:00Z", "changed", 2],
      ["0002-quiet", "2026-08-02T10:00:00Z", "no-change", 3],
    ]);
  });

  it("answers the stored report for one it already has at that time", async () => {
    const first = await report({ kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z" });
    const again = await report({ kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z" });

    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect(await Refinement.count()).toBe(1);
  });

  it("keeps an imported stories count, zero included, and refuses one that is not a non-negative integer", async () => {
    const ok = await report({ kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", when: "2026-08-01T10:00:00Z", stories: 0 });
    expect(ok.status).toBe(201);
    expect((await Refinement.find(ok.body.id)).stories).toBe(0);

    for (const bad of [-1, 1.5, "3"]) {
      expect((await report({ kind: "rfc-refine", id: "0002-quiet", outcome: "changed", summary: "a", stories: bad })).status).toBe(422);
    }
  });
});
