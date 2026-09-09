import { describe, expect, it } from "vitest";
import { getFsAsync } from "@blazetrails/activesupport";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";

/**
 * Every page controller's view directory is the path the implicit lookup
 * derives, so no render has to name its template — and both are kebab-case,
 * like every other filename here.
 *
 * They agree because `ApplicationController.controllerPath` respells the
 * separator. trails derives the prefix with Rails' `underscore`, so the raw
 * derivation is `rfc_pages`; without the override every render would have to
 * carry `template: "rfc-pages/show"`, and a controller that forgot it did not
 * fall back but 500'd with a missing template at request time. #11 paid that
 * twice.
 *
 * So this suite checks the two halves that have to stay in step: the override
 * still produces kebab-case, and every directory on disk is one a controller
 * actually asks for. It fails on a directory renamed to snake_case, on a
 * controller added without a directory, and on the override being deleted
 * while the directories stay — which is what would happen if
 * `derive-kebab-case-view-prefixes` (RFC 0140) landed and the cleanup were
 * done by halves.
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
  const fs = await getFsAsync();
  const names = await fs.readdir!(VIEWS);
  const directories: string[] = [];
  for (const name of names) {
    const stat = await fs.stat!(`${VIEWS}/${name}`);
    if (stat.isDirectory()) directories.push(name);
  }
  return directories.sort();
}

describe("app/views", () => {
  it("derives a kebab-case prefix, the spelling every other filename uses", () => {
    expect(RfcPagesController.controllerPath()).toBe("rfc-pages");
    expect(StoryPagesController.controllerPath()).toBe("story-pages");
    // A single-word controller has no separator to respell; it must be
    // untouched rather than incidentally correct.
    expect(HomeController.controllerPath()).toBe("home");
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
