import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";

/**
 * Every page controller's view directory is the path the implicit lookup
 * derives, so no render has to name its template.
 *
 * That path is Rails' spelling: `RfcPagesController` looks under
 * `app/views/rfc_pages/`, underscored, in a tree whose other filenames are
 * kebab-case. trailmap used to respell it with an `ApplicationController.
 * controllerPath` override. That override is gone, and must stay gone:
 *
 * - trails settled the question the Rails way. `trails g controller` writes the
 *   underscored directory, and the framework will not alias the two spellings
 *   (blazetrailsdev/trails#7651).
 * - `controllerPath` is not only the view prefix. `ActionController::TestCase`
 *   generates the request's route from it, and a controller named `rfc-pages`
 *   matches no route — a hyphen is not a legal controller name in one. With
 *   the override, no page controller could be tested through the framework's
 *   own harness.
 *
 * So this suite checks the two halves that have to stay in step: the prefix is
 * the framework's own derivation, and every directory on disk is one a
 * controller actually asks for. It fails on a directory renamed to kebab-case,
 * on a controller added without a directory, and on the override coming back.
 */
const PAGE_CONTROLLERS = [
  DashboardController,
  HomeController,
  RfcPagesController,
  StoryPagesController,
];

/** The two directories that back no controller: layouts and shared partials. */
const NOT_A_CONTROLLER = ["layouts", "shared"];

const VIEWS = "app/views";

/** The directory names directly under `app/views`. */
async function viewDirectories(): Promise<string[]> {
  const fs = getFs();
  const names = await fs.readdir!(VIEWS);
  const directories: string[] = [];
  for (const name of names) {
    const stat = await fs.stat!(`${VIEWS}/${name}`);
    if (stat.isDirectory()) directories.push(name);
  }
  return directories.sort();
}

describe("app/views", () => {
  it("derives the prefix the framework does, underscored, with no override", () => {
    expect(RfcPagesController.controllerPath()).toBe("rfc_pages");
    expect(StoryPagesController.controllerPath()).toBe("story_pages");
    expect(HomeController.controllerPath()).toBe("home");
    // The override lived on ApplicationController; it must not come back.
    expect(Object.hasOwn(ApplicationController, "controllerPath")).toBe(false);
  });

  it("names each page controller's directory the way the implicit lookup does", async () => {
    const present = new Set(await viewDirectories());
    const missing = PAGE_CONTROLLERS.map((controller) => controller.controllerPath()).filter(
      (prefix) => !present.has(prefix),
    );
    expect(missing).toEqual([]);
  });

  it("has no directory the implicit lookup would never reach", async () => {
    const owned = new Set([
      ...PAGE_CONTROLLERS.map((controller) => controller.controllerPath()),
      ...NOT_A_CONTROLLER,
    ]);
    const orphans = (await viewDirectories()).filter((name) => !owned.has(name));
    expect(orphans).toEqual([]);
  });
});
