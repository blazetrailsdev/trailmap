import { beforeAll, describe, expect, it } from "vitest";
import { setX } from "../support/config-x.ts";
import { ActionController } from "@blazetrails/actionpack";
import { Dir, setEnv } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.ts";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.ts";
import { ApplicationController } from "../../app/controllers/application-controller.ts";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.ts";
import { controllerTestCase } from "../support/controller-test-case.ts";

async function show(id: string): Promise<{ status: number; body: string }> {
  const tc = await controllerTestCase(RfcPagesController);
  await tc.get("show", { params: { id } });
  return { status: tc.response.status, body: tc.response.body };
}

beforeAll(async () => {
  ApplicationController.prependViewPath("app/views");
  // The document lives on disk, not in the database: `ingest` stores the path
  // and leaves the body in the checkout. This repo stands in for one.
  setX("tasks", "dir", Dir.pwd());

  await migrateScratchDatabase();
  await loadModelSchemas();

  await Rfc.create({
    id: "0136-trailmap",
    status: "active",
    title: "trailmap",
    owner: "dean",
    updated_on: "2026-09-05",
    file_path: "README.md",
  });
  await Rfc.create({ id: "0002-empty", status: "postponed", title: "Nothing here" });
  await Rfc.create({ id: "0003-parked", status: "draft", title: "Not started" });
  await Rfc.create({ id: "0004-priorities", status: "active", title: "All ready" });
  await Rfc.create({
    id: "0014-fixtures-adoption",
    status: "superseded",
    title: "Fixtures adoption",
    superseded_by: "0019-canonical-schema-burndown",
  });

  await Story.create({
    id: "queued",
    rfc_id: "0136-trailmap",
    status: "ready",
    est_loc: 250,
    cluster: "pages",
  });
  await Story.create({ id: "abandoned", rfc_id: "0136-trailmap", status: "closed" });
  // An estimate of 0 is "no estimate", as ringo and `/backlog` read it.
  await Story.create({ id: "working", rfc_id: "0136-trailmap", status: "in-progress", est_loc: 0 });
  // Created LAST: the RFC auto-closes the moment every story it has is done,
  // so a `done` story must never be the only one on it (rfc-close.ts).
  await Story.create({ id: "shipped", rfc_id: "0136-trailmap", status: "done", est_loc: 40 });

  // One status group, three priorities, created in an order none of the three
  // sorts would leave alone.
  await Story.create({ id: "a-late", rfc_id: "0004-priorities", status: "ready", priority: 7 });
  await Story.create({ id: "m-unset", rfc_id: "0004-priorities", status: "ready" });
  await Story.create({ id: "z-early", rfc_id: "0004-priorities", status: "ready", priority: 2 });

  // A `ready` story under a DRAFT RFC: the parent-RFC override applies to it,
  // and `held` sorts before it on priority alone if the override is ignored.
  await Story.create({ id: "parked-ready", rfc_id: "0003-parked", status: "ready", priority: 9 });
  await Story.create({ id: "held", rfc_id: "0003-parked", status: "blocked", priority: 1 });
});

describe("RfcPagesController", () => {
  it("renders the RFC's title and status through the app layout", async () => {
    const { status, body } = await show("0136-trailmap");

    expect(status).toBe(200);
    expect(body).toContain("<!DOCTYPE html>");
    expect(body).toContain('<nav class="nav">');
    expect(body).toContain("trailmap");
    expect(body).toContain('<span class="id">0136-trailmap</span>');
    // The page's OWN state is the solid header pill; the rows below use the
    // small badge. One vocabulary (#7), two emphases.
    expect(body).toContain('<span class="state s-active">active</span>');
  });

  it("lists the stories in ringo's order, actionable first, done last and closed just above it", async () => {
    const { body } = await show("0136-trailmap");

    const order = [...body.matchAll(/href="\/story\/([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["working", "queued", "abandoned", "shipped"]);
  });

  it("breaks a status tie on priority, unset last, as ringo's index does", async () => {
    const { body } = await show("0004-priorities");

    const order = [...body.matchAll(/href="\/story\/([^"]+)"/g)].map((m) => m[1]);
    // Priority ahead of id, and an unset priority behind both explicit ones
    // rather than ahead of them — neither the ingest order nor id order.
    expect(order).toEqual(["z-early", "a-late", "m-unset"]);
  });

  it("shows and ranks the effective status under a non-active RFC", async () => {
    const { body } = await show("0003-parked");

    const order = [...body.matchAll(/href="\/story\/([^"]+)"/g)].map((m) => m[1]);
    // `ready` under a draft RFC is a `draft`, so it sinks below `blocked`
    // despite holding the worse priority — and it says `draft` on the row,
    // rather than advertising work the ready queue will not offer.
    expect(order).toEqual(["held", "parked-ready"]);
    expect(body).toContain('<span class="badge s-draft">draft</span>');
    expect(body).not.toContain('<span class="badge s-ready">');
  });

  it("prints no estimate for a story estimated at zero", async () => {
    const { body } = await show("0136-trailmap");

    expect(body).not.toContain("working &middot; 0 loc");
    expect(body).toContain("queued &middot; 250 loc");
  });

  it("counts done against the total, leaving closed stories out", async () => {
    const { body } = await show("0136-trailmap");

    expect(body).toContain("1/3 done");
    expect(body).toContain("33% complete");
    expect(body).toContain('style="width:33%"');
  });

  it("renders the RFC's markdown from the checkout", async () => {
    const { body } = await show("0136-trailmap");

    expect(body).toContain('<article class="markdown">');
    expect(body).toContain("<h1>");
    expect(body).not.toContain("Could not read");
  });

  it("renders an RFC with no stories and no document without failing", async () => {
    const { status, body } = await show("0002-empty");

    expect(status).toBe(200);
    expect(body).toContain("Nothing here");
    expect(body).toContain("No stories under this RFC yet.");
    expect(body).toContain("No document.");
  });

  it("answers 404 for an unknown id, and says which id", async () => {
    const { status, body } = await show("0999-nope");

    expect(status).toBe(404);
    expect(body).toContain('<h1 class="page-title">RFC not found</h1>');
    expect(body).toContain("<code>0999-nope</code>");
  });

  /**
   * The two branches a reviewer flagged as most likely to diverge from
   * ringo's markup, pinned here because there is no automated diff against
   * ringo the way `pnpm gate` diffs the ready queue against the CLI.
   */
  it("links the superseding RFC, wrapping the id as ringo does", async () => {
    const { status, body } = await show("0014-fixtures-adoption");

    expect(status).toBe(200);
    expect(body).toContain('<div class="side-head">Superseded by</div>');
    expect(body).toContain(
      '<a href="/rfc/0019-canonical-schema-burndown"><code>0019-canonical-schema-burndown</code></a>',
    );
  });

  it("badges a superseded RFC through the shared vocabulary, not ringo's pill", async () => {
    const { body } = await show("0014-fixtures-adoption");

    // Deliberate divergence, established by #7: trailmap has ONE status
    // vocabulary rendered by `shared/_status-badge`. ringo spells this
    // `class="merged"` with the label "Superseded", pasted into each handler
    // (`rfcState`, webhook/rfcs.go:56).
    expect(body).toContain('<span class="state s-superseded">superseded</span>');
    expect(body).not.toContain('class="merged"');
  });
});
