import { describe, expect, it } from "vitest";
import { getFsAsync } from "@blazetrails/activesupport";
import { DashboardController } from "../../app/controllers/dashboard-controller.js";
import { HomeController } from "../../app/controllers/home-controller.js";
import { RfcPagesController } from "../../app/controllers/rfc-pages-controller.js";
import { StoryPagesController } from "../../app/controllers/story-pages-controller.js";

/**
 * Every page controller's view directory is the path the implicit lookup
 * derives, so no render has to name its template.
 *
 * trails derives the view prefix with Rails' `underscore`, exactly as Rails
 * does: `RfcPagesController` looks under `app/views/rfc_pages/`. trailmap is
 * kebab-case everywhere else and `app/views/rfc-pages/` was originally named
 * to match — which meant every render carried `template: "rfc-pages/show"`,
 * and a controller that forgot it did not fall back but 500'd with a missing
 * template at request time.
 *
 * #11 paid that twice. This suite is what stops a third: it fails on a
 * directory renamed back to kebab-case, which is the mistake the surrounding
 * convention invites. CLAUDE.md carries the rule in prose beside it.
 *
 * The exception is meant to be temporary. `derive-kebab-case-view-prefixes`
 * (RFC 0140) proposes deriving the prefix as kebab-case in trails itself; if
 * that lands, these directories go back to kebab-case and this suite is what
 * fails, which is the intended way to be reminded.
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
