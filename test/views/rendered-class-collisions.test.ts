import { beforeAll, describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { migrateScratchDatabase } from "../models/schema.js";
import { Rfc, Story, loadModelSchemas } from "../../app/models/index.js";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";
import { STYLESHEET, boxRules, classListsIn, collisionsInList } from "../../scripts/class-collisions.js";
import { controllerTestCase } from "../support/controller-test-case.js";

/**
 * The class-collision rule (`scripts/class-collisions.ts`) over the class
 * lists the `.tse` pages actually render, so a list the template assembles at
 * render time — an `<%= %>` interpolation, a helper's `class:` option — is
 * read whole, where the source scan sees only its literal half.
 *
 * This file is the guaranteed floor: pages that need only the task database.
 * Every OTHER page is held to the same rule by `controllerTestCase` itself
 * (test/support/controller-test-case.ts), which checks every HTML response
 * any controller test renders: the repo tabs, the owner page, panes and
 * parity, with the data those tests already build. The dashboard
 * is not here: its rows are drawn in the browser, and `scripts/dashboard-e2e.ts`
 * checks the DOM it ends up with.
 */
type Page = [string, Parameters<typeof controllerTestCase>[0], string, Record<string, string>];
const PAGES: Page[] = [
  ["/rfcs", RfcPagesController, "index", {}],
  ["/rfc/0136-trailmap", RfcPagesController, "show", { id: "0136-trailmap" }],
  ["/backlog", StoryPagesController, "index", {}],
  ["/story/working", StoryPagesController, "show", { id: "working" }],
  ["/story/stuck", StoryPagesController, "show", { id: "stuck" }],
];

beforeAll(async () => {
  await migrateScratchDatabase();
  await loadModelSchemas();
  ApplicationController.prependViewPath("app/views");

  await Rfc.create({ id: "0136-trailmap", status: "active", title: "trailmap", owner: "dean", priority: 2 });
  await Rfc.create({ id: "0002-empty", status: "draft", title: "An idea" });
  await Story.create({ id: "queued", rfc_id: "0136-trailmap", status: "ready", title: "Queued", est_loc: 40 });
  await Story.create({ id: "working", rfc_id: "0136-trailmap", status: "in-progress" });
  await Story.create({ id: "stuck", rfc_id: "0136-trailmap", status: "blocked" });
  await Story.create({ id: "finished", rfc_id: "0136-trailmap", status: "done" });
});

describe("the rendered pages' class lists", () => {
  it("have no element wearing two classes that each lay out their own box", async () => {
    const rules = boxRules(await getFs().readFile(STYLESHEET, "utf8"));
    const found: string[] = [];
    for (const [path, controller, action, params] of PAGES) {
      const tc = await controllerTestCase(controller);
      await tc.get(action, { params });
      expect(tc.response.status, path).toBe(200);
      const lists = classListsIn(tc.response.body);
      expect(lists.length, path).toBeGreaterThan(5);
      for (const list of lists) for (const pair of collisionsInList(list, rules)) found.push(`${path}: class="${pair}"`);
    }
    expect(found).toEqual([]);
  });
});
