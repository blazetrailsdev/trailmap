import { describe, expect, it } from "vitest";
import { getFs } from "@blazetrails/ruby-compat";
import { ApplicationController } from "../../app/controllers/application-controller.js";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";

/**
 * Every page controller's view directory is the one the implicit lookup asks
 * for, so no render has to name its template — and it is kebab-case, like
 * every other filename here.
 *
 * Two things are true at once, and this suite holds both:
 *
 * - The VIEW prefix is kebab-case. That is the framework's spelling since
 *   trails#8670, and trailmap overrides nothing to get it.
 * - `controllerPath` is untouched. It also names the controller in routes,
 *   where a hyphen is not legal, and `ActionController::TestCase` generates the
 *   request's route from it. trailmap overrode `controllerPath` first, and no
 *   page controller could then be tested through the framework's own harness.
 *
 * It fails on a directory spelled with an underscore, on a controller added
 * without a directory, on a trails pin whose lookup is underscored again, on a
 * `localPrefixes` override coming back, and on a `controllerPath` override
 * coming back.
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

/** The directory a controller's own views are looked up in: its first prefix. */
function viewDirectory(controller: { _prefixes(): string[] }): string {
  return controller._prefixes()[0]!;
}

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
  it("looks views up under a kebab-case prefix, the spelling every other filename uses", () => {
    expect(viewDirectory(RfcPagesController)).toBe("rfc-pages");
    expect(viewDirectory(StoryPagesController)).toBe("story-pages");
    // A single-word controller has no separator to respell.
    expect(viewDirectory(HomeController)).toBe("home");
  });

  it("stops the prefix chain at ApplicationController, as Rails does", () => {
    expect(RfcPagesController._prefixes()).toEqual(["rfc-pages", "application"]);
  });

  it("leaves controllerPath, which routes and tests read, as the framework derives it", () => {
    expect(RfcPagesController.controllerPath()).toBe("rfc_pages");
    expect(StoryPagesController.controllerPath()).toBe("story_pages");
    expect(Object.hasOwn(ApplicationController, "controllerPath")).toBe(false);
  });

  it("takes the kebab-case prefix from the framework, with no override of its own", () => {
    expect(Object.hasOwn(ApplicationController, "localPrefixes")).toBe(false);
  });

  it("names each page controller's directory the way the implicit lookup does", async () => {
    const present = new Set(await viewDirectories());
    const missing = PAGE_CONTROLLERS.map(viewDirectory).filter(
      (prefix) => !present.has(prefix),
    );
    expect(missing).toEqual([]);
  });

  it("has no directory the implicit lookup would never reach", async () => {
    const owned = new Set([
      ...PAGE_CONTROLLERS.map(viewDirectory),
      ...NOT_A_CONTROLLER,
    ]);
    const orphans = (await viewDirectories()).filter((name) => !owned.has(name));
    expect(orphans).toEqual([]);
  });
});
