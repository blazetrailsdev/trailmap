import { beforeAll, describe, expect, it } from "vitest";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * A `/backlog` row with an `est-loc` of 0. ringo's backlog draws the estimate
 * under `if (s.est_loc)`, so a zero prints nothing — the same as no estimate —
 * and `pnpm gate:lists` compares the row's estimate against ringo's. Three
 * stories authored with `est-loc: 0` turned that gate red while this page
 * printed `~0 LOC` for them.
 */
async function metaOf(id: string): Promise<string> {
  const tc = await controllerTestCase(StoryPagesController);
  await tc.get("index", { params: { filter: "icebox" } });
  const body: string = tc.response.body;
  const row = body.slice(body.indexOf(`href="/story/${id}"`));
  const meta = /<div class="row-meta">([\s\S]*?)<\/div>/.exec(row);
  if (meta === null) throw new Error(`no row for ${id}`);
  return meta[1]!;
}

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");

  await Rfc.create({ id: "0188-idea", status: "draft", title: "An idea" });
  await Story.create({ id: "zero", rfc_id: "0188-idea", status: "draft", est_loc: 0 });
  await Story.create({ id: "unsized", rfc_id: "0188-idea", status: "draft" });
  await Story.create({ id: "sized", rfc_id: "0188-idea", status: "draft", est_loc: 40 });
});

describe("StoryPagesController#index, a zero estimate", () => {
  it("prints no estimate for an est-loc of 0, as ringo does", async () => {
    const meta = await metaOf("zero");

    expect(meta).toContain("<code>zero</code>");
    expect(meta).not.toContain("LOC");
  });

  it("prints the same meta line for a zero estimate as for none", async () => {
    const strip = (meta: string, id: string) => meta.replaceAll(id, "ID");

    expect(strip(await metaOf("zero"), "zero")).toBe(strip(await metaOf("unsized"), "unsized"));
  });

  it("still prints a non-zero estimate", async () => {
    expect(await metaOf("sized")).toContain("~40 LOC");
  });
});
